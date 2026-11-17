// edgeConfigurations — a home's configurations for edges (darkfactory
// ADR 0018). Auth: Bearer device_token; the home is named by its homeId and
// must be the edge's linked home or one of the linking person's homes.
//
//   POST /edge/v1/configurations/versions    { homeId }                          → { homeId, live, versions, options }
//   POST /edge/v1/configurations/get         { homeId, id }                      → { id, kind, version, url }
//   POST /edge/v1/configurations/option      { homeId, basedOn, label }          → { id, label, basedOn, status, version }
//   POST /edge/v1/configurations/save-option { homeId, option, baseVersion[, key] } → step 1 { status: ready, key, url, headers } · step 2 { status: ok | conflict | invalid }
//   POST /edge/v1/configurations/promote     { homeId, option }                  → { status: ok, id, version, summary } | conflict | invalid
//   POST /edge/v1/configurations/seed        { homeId, ttl }                     → the first live configuration, 0001-0000
//   POST /edge/v1/configurations/minor       { homeId, ttl[, expectedLive] }     → MMMM-mmmm+1, additions only
//   POST /edge/v1/configurations/withdraw    { homeId, id }                      → a live major that changed nothing is taken back
//   POST /edge/v1/configurations/tags        { homeId, count }                   → { homeId, tags: [t-…] }, blank QR tags (point 10)
//   POST /edge/v1/configurations/tag-bind    { homeId, tagId, item? }            → { tagId, homeId, item, boundAt }, a tag of this home
//
//   401 invalid/expired token · 410 revoked · 403 not this edge's home · 400 bad request (as every edge route)
//
// A promote, and a withdraw, is a person's act: the edge sends it only after
// a person confirmed it (a button or a confirmed chat proposal).

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { extractBearer, json, parseJsonBody } from "../edge-shared/http";
import { EDGE_REGISTRY_TABLE, verifyDeviceToken } from "../edge-shared/registry";
import { Forbidden, homeForEdge } from "../configurations-shared/access";
import * as api from "../configurations-shared/api";
import { bindTag, getTag, mintTags, publicTag } from "../configurations-shared/tags";
import { BadRequest } from "../configurations-shared/rules";

const ROUTES: Record<string, (home: string, a: Record<string, unknown>, by: string) => Promise<unknown>> = {
  versions: (home) => api.overview(home),
  get: (home, a) => api.get(home, a.id),
  option: api.createOption,
  "save-option": api.saveOption,
  promote: api.promote,
  seed: api.seed,
  minor: api.minor,
  withdraw: api.withdraw,
  tags: (home, a, by) => mintTags(home, a.count, by),
  // the chat turned an observation into a design item: the tag follows it
  "tag-bind": async (home, a, by) => {
    const tag = await getTag(a.tagId);
    if (!tag || tag.homeId !== home) throw new BadRequest("no such tag for this home");
    return publicTag(await bindTag(tag, a.item, by));
  },
};

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  if (!EDGE_REGISTRY_TABLE || !process.env.HOME_CONFIG_VERSIONS_TABLE_NAME) return json(500, { error: "server_misconfigured" });
  const verified = await verifyDeviceToken(extractBearer(event));
  if (verified.ok === false) {
    return verified.reason === "revoked" ? json(410, { error: "revoked" }) : json(401, { error: "invalid_token" });
  }
  const body = parseJsonBody<Record<string, unknown>>(event) || {};
  const path = event.rawPath || event.requestContext?.http?.path || "";
  const route = ROUTES[path.split("/configurations/")[1] ?? ""];
  if (!route) return json(404, { error: "not_found" });
  try {
    const home = await homeForEdge(body.homeId, verified.row);
    const out = await route(home.homeId!, body, `edge:${verified.row.edge_id}`);
    return json(200, out);
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: "invalid_request", description: err.message });
    if (err instanceof Forbidden) return json(403, { error: "forbidden" });
    console.error("[edgeConfigurations] failed", { edge: verified.row.edge_id, path, err });
    return json(500, { error: "server_error" });
  }
};
