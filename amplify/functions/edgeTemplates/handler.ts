// edgeTemplates — the board templates for edges, read only (darkfactory
// ADR-0017). An edge caches each edition's graph and fetches it again when
// the version moves; templates are written in the Portal, never by an edge.
//
//   POST /edge/v1/templates/editions        → { editions: [{ edition, label, norm, latest, supersedes, version, templates, updatedAt }] }
//   POST /edge/v1/templates/get { edition } → { edition, version, url }   (url: 15 min; null before the first save)
//
//   401 invalid/expired token · 410 revoked · 400 no such edition (as every edge route)

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { extractBearer, json, parseJsonBody } from "../edge-shared/http";
import { EDGE_REGISTRY_TABLE, verifyDeviceToken } from "../edge-shared/registry";
import { BadRequest } from "../templates-shared/rules";
import { edition, listEditions, store } from "../templates-shared/store";

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  if (!EDGE_REGISTRY_TABLE || !process.env.NORM_TEMPLATES_TABLE_NAME) return json(500, { error: "server_misconfigured" });
  const verified = await verifyDeviceToken(extractBearer(event));
  if (verified.ok === false) {
    return verified.reason === "revoked" ? json(410, { error: "revoked" }) : json(401, { error: "invalid_token" });
  }
  const body = parseJsonBody<Record<string, unknown>>(event) || {};
  const path = event.rawPath || event.requestContext?.http?.path || "";
  try {
    if (path.endsWith("/templates/editions")) {
      return json(200, {
        editions: (await listEditions()).map((e) => ({
          edition: e.id, label: e.label, norm: e.norm, latest: e.latest, supersedes: e.supersedes,
          version: e.version, templates: e.templates, updatedAt: e.updatedAt,
        })),
      });
    }
    if (path.endsWith("/templates/get")) {
      const ed = edition(body.edition);
      const row = await store().get(ed.id);
      return json(200, { edition: ed.id, version: row?.version ?? 0, url: row ? await store().url(row) : null });
    }
    return json(404, { error: "not_found" });
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: "invalid_request", description: err.message });
    console.error("[edgeTemplates] failed", { edge: verified.row.edge_id, err });
    return json(500, { error: "server_error" });
  }
};
