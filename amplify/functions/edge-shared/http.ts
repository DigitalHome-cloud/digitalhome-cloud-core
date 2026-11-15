// HTTP helpers for the edge API Gateway (HTTP API v2) Lambdas.
//
// Wire-contract invariants the edge client enforces (do not "improve" these):
//   - Success MUST be HTTP 200 exactly. 201/204 are read as errors by the edge
//     and cause infinite backoff.
//   - RFC 8628 token errors MUST be HTTP 400 with a JSON body {"error": "..."}
//     using the exact strings authorization_pending | slow_down |
//     access_denied | expired_token.
//   - /telemetry uses 401 and 410 precisely.
//   - All bodies are JSON (the edge sends application/json, not form-encoded).

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

export function json(
  statusCode: number,
  body: unknown
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

// RFC 8628 error response: always HTTP 400 + {"error": "<code>"}.
export type OAuthErrorCode =
  | "authorization_pending"
  | "slow_down"
  | "access_denied"
  | "expired_token"
  | "invalid_request";

export function oauthError(error: OAuthErrorCode): APIGatewayProxyResultV2 {
  return json(400, { error });
}

// Parse a JSON request body, transparently decoding base64 (API Gateway sets
// isBase64Encoded for some client encodings). Returns null on empty/invalid.
export function parseJsonBody<T = Record<string, unknown>>(
  event: APIGatewayProxyEventV2
): T | null {
  if (!event.body) return null;
  let raw = event.body;
  if (event.isBase64Encoded) {
    raw = Buffer.from(raw, "base64").toString("utf-8");
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// Extract the bearer token from the Authorization header (case-insensitive
// header name and scheme). Returns null if absent/malformed.
export function extractBearer(event: APIGatewayProxyEventV2): string | null {
  const headers = event.headers || {};
  const auth =
    headers.authorization ?? headers.Authorization ?? headers.AUTHORIZATION;
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1].trim() : null;
}

// Build the cloud_endpoints object echoed in the token response. The edge
// currently IGNORES this (it derives endpoints from its configured base URL),
// but the spec returns it, so we include it for forward-compatibility. Base is
// derived from the request so it is correct on any stage/custom-domain URL.
export function buildCloudEndpoints(
  event: APIGatewayProxyEventV2,
  edgeId: string,
  homeId: string
): Record<string, string> {
  const domain = event.requestContext?.domainName;
  const base = domain ? `https://${domain}/edge/v1` : "/edge/v1";
  return {
    telemetry: `${base}/telemetry`,
    cbox_pull: `${base}/homes/${homeId}/cbox`,
    flow_push: `${base}/homes/${homeId}/flows`,
    lake_ingest: `${base}/homes/${homeId}/lake`,
    deploy_channel: `wss://push.digitalhome.cloud/edge/v1/${edgeId}`,
  };
}
