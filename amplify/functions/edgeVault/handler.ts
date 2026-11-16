// edgeVault — a home's vault for edges (darkfactory ADR 0019). Auth: Bearer
// device_token; the home (homeId) must be the edge's linked home or one of the
// linking person's homes.
//
//   POST /edge/v1/vault/items  { homeId[, configVersion] }       → { homeId, items: [...] }
//   POST /edge/v1/vault/upload { homeId, files: [...], dryRun }  → { files: [{ sha256, status: known | new | too_large, url?, headers?, thumbUrl? }] }
//   POST /edge/v1/vault/commit { homeId, sha256, name, size, … } → { status: ok | known, sha256, configVersion }
//   POST /edge/v1/vault/url    { homeId, sha256 }                → { url }   (5 min)
//   POST /edge/v1/vault/group  { homeId, sha256, configVersion } → { status: ok, … }   (replaces its tags)
//   POST /edge/v1/vault/tag    { homeId, sha256s, add?, remove? } → { status: ok, items: [{ sha256, tags }] }
//
//   401 invalid/expired token · 410 revoked · 403 not this edge's home · 400 bad request

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { extractBearer, json, parseJsonBody } from "../edge-shared/http";
import { EDGE_REGISTRY_TABLE, verifyDeviceToken } from "../edge-shared/registry";
import { Forbidden, homeForEdge } from "../configurations-shared/access";
import { BadRequest } from "../configurations-shared/rules";
import * as api from "../home-vault-shared/api";

const ROUTES: Record<string, (home: string, a: Record<string, unknown>, by: string) => Promise<unknown>> = {
  items: api.items, upload: api.upload, commit: api.commit, url: api.url, group: api.group, tag: api.tag,
};

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  if (!EDGE_REGISTRY_TABLE || !process.env.HOME_VAULT_TABLE_NAME) return json(500, { error: "server_misconfigured" });
  const verified = await verifyDeviceToken(extractBearer(event));
  if (verified.ok === false) {
    return verified.reason === "revoked" ? json(410, { error: "revoked" }) : json(401, { error: "invalid_token" });
  }
  const body = parseJsonBody<Record<string, unknown>>(event) || {};
  const path = event.rawPath || event.requestContext?.http?.path || "";
  const route = ROUTES[path.split("/vault/")[1] ?? ""];
  if (!route) return json(404, { error: "not_found" });
  try {
    const home = await homeForEdge(body.homeId, verified.row);
    return json(200, await route(home.homeId!, body, `edge:${verified.row.edge_id}`));
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: "invalid_request", description: err.message });
    if (err instanceof Forbidden) return json(403, { error: "forbidden" });
    console.error("[edgeVault] failed", { edge: verified.row.edge_id, path, err });
    return json(500, { error: "server_error" });
  }
};
