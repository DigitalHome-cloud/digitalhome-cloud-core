// edgeMarket — the digitalhome.cloud marketplace for edges. A seller's
// catalogue is one Turtle graph with a version; an edge merges it with its
// own copy statement by statement against the version it last synced, as the
// Mediathek's A-Box sync does (template-dlab5-cloud ADR-0007).
//
//   POST /edge/v1/market/sellers                       → { sellers: [{ id, name, kind, version, articles, updatedAt, mayEdit }] }
//   POST /edge/v1/market/graphs/get  { name }          → { name, version, url }   (url: 15 min; null before the first save)
//   POST /edge/v1/market/graphs/put  { name, baseVersion }
//                                                      → { key, url, headers }    (PUT the Turtle there, then:)
//   POST /edge/v1/market/graphs/put  { name, baseVersion, key, commit: true }
//                                                      → 200 { version, triples, articles }
//                                                        409 { error: "version_conflict", current: { version, url } }
//                                                        422 { error: "invalid", problems }
//   POST /edge/v1/market/uploads     { seller, files: [{ sha256, ext, size }] }
//                                                      → { files: [{ name, key, exists, url?, headers? }] }
//
// Writing (put, uploads) needs the person who linked the edge to be an editor
// of that seller (group market-<id>) or a platform admin, with an
// authenticator app — asked of Cognito on every call, never taken from the
// request. 403 { error: "not_allowed" } otherwise. Reading is open to every
// linked edge: the marketplace is the platform's, not a home's.
//
//   401 invalid/expired token · 410 revoked · 404 no such seller (as every edge route)

import {
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { extractBearer, json, parseJsonBody } from "../edge-shared/http";
import { EDGE_REGISTRY_TABLE, verifyDeviceToken } from "../edge-shared/registry";
import { BadRequest, cleanFiles, mayEdit, sellerId } from "../market-shared/rules";
import { commit, getSeller, graphUrl, listSellers, stageUpload, uploads, type Seller } from "../market-shared/store";

const USER_POOL_ID = process.env.USER_POOL_ID!;
const cognito = new CognitoIdentityProviderClient({});

/** The linker's groups and MFA settings; nulls when Cognito could not be asked (→ no writes). */
async function linker(sub: string): Promise<{ groups: string[] | null; mfa: string[] | null }> {
  if (!sub || !/^[0-9a-f-]{36}$/i.test(sub)) return { groups: null, mfa: null };
  try {
    const found = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Filter: `sub = "${sub}"`, Limit: 1 }));
    const username = found.Users?.[0]?.Username;
    if (!username) return { groups: null, mfa: null };
    const [groups, user] = await Promise.all([
      cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: USER_POOL_ID, Username: username, Limit: 60 })),
      cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username })),
    ]);
    return { groups: (groups.Groups || []).map((g) => g.GroupName || ""), mfa: user.UserMFASettingList ?? [] };
  } catch (err) {
    console.error("[edgeMarket] Cognito could not be asked; no writes for this call", err);
    return { groups: null, mfa: null };
  }
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  if (!EDGE_REGISTRY_TABLE || !USER_POOL_ID || !process.env.MARKET_SELLER_TABLE_NAME) {
    return json(500, { error: "server_misconfigured" });
  }
  const verified = await verifyDeviceToken(extractBearer(event));
  if (verified.ok === false) {
    return verified.reason === "revoked" ? json(410, { error: "revoked" }) : json(401, { error: "invalid_token" });
  }
  const sub = verified.row.linked_by_cognito_sub || "";
  const body = parseJsonBody<Record<string, unknown>>(event) || {};
  const path = event.rawPath || event.requestContext?.http?.path || "";
  const seller = async (v: unknown): Promise<Seller> => {
    const s = await getSeller(sellerId(v));
    if (!s) throw new NotFound();
    return s;
  };
  const editor = async (s: Seller) => {
    const who = await linker(sub);
    return mayEdit(who.groups, who.mfa, s.id);
  };
  try {
    if (path.endsWith("/market/sellers")) {
      const [all, who] = await Promise.all([listSellers(), linker(sub)]);
      return json(200, {
        sellers: all.map((s) => ({
          id: s.id, name: s.name, kind: s.kind, version: s.version, articles: s.articles ?? 0,
          updatedAt: s.updatedAt ?? null, mayEdit: mayEdit(who.groups, who.mfa, s.id),
        })),
      });
    }
    if (path.endsWith("/market/graphs/get")) {
      const s = await seller(body.name);
      return json(200, { name: s.id, version: s.version, url: await graphUrl(s) });
    }
    if (path.endsWith("/market/graphs/put")) {
      const s = await seller(body.name);
      if (!(await editor(s))) return json(403, { error: "not_allowed" });
      const base = Number(body.baseVersion ?? -1);
      if (!body.commit) {
        if (base !== s.version) return json(409, { error: "version_conflict", current: { version: s.version, url: await graphUrl(s) } });
        return json(200, await stageUpload(s));
      }
      const r = await commit(s, String(body.key ?? ""), base, `edge:${verified.row.edge_id}`);
      if (r.status === "conflict") return json(409, { error: "version_conflict", current: r.current });
      if (r.status === "invalid") return json(422, { error: "invalid", problems: r.problems });
      console.log(`[edgeMarket] ${s.id} v${r.version} (${r.articles} articles) from edge ${verified.row.edge_id}`);
      return json(200, r);
    }
    if (path.endsWith("/market/uploads")) {
      const s = await seller(body.seller);
      const files = cleanFiles(body.files);
      if (!(await editor(s))) return json(403, { error: "not_allowed" });
      return json(200, { files: await uploads(s, files) });
    }
    return json(404, { error: "not_found" });
  } catch (err) {
    if (err instanceof NotFound) return json(404, { error: "not_found", message: "no such seller in the marketplace" });
    if (err instanceof BadRequest) return json(400, { error: "invalid_request", description: err.message });
    console.error("[edgeMarket] failed", { edge: verified.row.edge_id, err });
    return json(500, { error: "server_error" });
  }
};

class NotFound extends Error {}
