// edgeToken — POST /edge/v1/token (unauthenticated; the device_code is the
// proof of identity).
//
// RFC 8628 token endpoint, polled by the edge every `interval` seconds after
// device_authorization. Behaviour by DeviceCodes.status:
//   - missing / expired  → 400 expired_token   (does not reveal prior existence)
//   - polled too fast     → 400 slow_down
//   - pending             → 400 authorization_pending
//   - denied              → 400 access_denied
//   - approved            → 200 with device_token + edge_id + home_id
//
// On approval we (idempotently) create/refresh the EdgeRegistry row, mint the
// device_token (storing only its sha256), and delete the consumed DeviceCodes
// row. Success MUST be HTTP 200 exactly.

import {
  GetItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  json,
  oauthError,
  parseJsonBody,
  buildCloudEndpoints,
} from "../edge-shared/http";
import {
  generateEdgeId,
  generateDeviceToken,
  sha256,
  DEVICE_TOKEN_TTL_S,
  POLL_INTERVAL_S,
} from "../edge-shared/codes";
import {
  ddb,
  marshall,
  unmarshall,
  DEVICE_CODES_TABLE,
  EDGE_REGISTRY_TABLE,
} from "../edge-shared/registry";

const DEVICE_FLOW_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const SCOPE = "edge.link edge.telemetry edge.cbox edge.lake";

interface TokenBody {
  grant_type?: string;
  device_code?: string;
  client_id?: string;
}

interface DeviceCodeRow {
  device_code: string;
  user_code: string;
  status: "pending" | "approved" | "denied";
  device_info?: { machine_id?: string };
  approved_by_sub?: string | null;
  home_id?: string | null;
  poll_count?: number;
  last_poll_at?: string | null;
  expires_at?: number; // unix epoch seconds
}

// Re-link dedup: if this machine already has a linked EdgeRegistry row for the
// same home, reuse its edge_id so a re-pair doesn't orphan the old record.
async function findExistingEdgeId(
  machineId: string | undefined,
  homeId: string
): Promise<string | null> {
  if (!machineId) return null;
  const res = await ddb.send(
    new QueryCommand({
      TableName: EDGE_REGISTRY_TABLE,
      IndexName: "byMachineId",
      KeyConditionExpression: "machine_id = :m",
      ExpressionAttributeValues: marshall({ ":m": machineId }),
    })
  );
  const rows = (res.Items || []).map((i) => unmarshall(i));
  const match = rows.find((r) => r.home_id === homeId);
  return match ? (match.edge_id as string) : null;
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  if (!DEVICE_CODES_TABLE || !EDGE_REGISTRY_TABLE) {
    return json(500, { error: "server_misconfigured" });
  }

  const body = parseJsonBody<TokenBody>(event);
  if (!body || body.grant_type !== DEVICE_FLOW_GRANT || !body.device_code) {
    return oauthError("invalid_request");
  }

  const got = await ddb.send(
    new GetItemCommand({
      TableName: DEVICE_CODES_TABLE,
      Key: marshall({ device_code: body.device_code }),
    })
  );
  // Missing (never existed OR already TTL-swept/consumed) → expired_token.
  // Deliberately identical to the true-expiry path so we don't leak existence.
  if (!got.Item) return oauthError("expired_token");
  const row = unmarshall(got.Item) as DeviceCodeRow;

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Hard expiry check (TTL delete can lag by minutes).
  if (row.expires_at && nowMs / 1000 > row.expires_at) {
    return oauthError("expired_token");
  }

  // Rate limit: the edge floors polling at POLL_INTERVAL_S. If it polled faster
  // than that, answer slow_down. Always record the poll for abuse metrics.
  const lastPollMs = row.last_poll_at ? Date.parse(row.last_poll_at) : 0;
  const tooFast = lastPollMs > 0 && nowMs - lastPollMs < POLL_INTERVAL_S * 1000;
  await ddb.send(
    new UpdateItemCommand({
      TableName: DEVICE_CODES_TABLE,
      Key: marshall({ device_code: body.device_code }),
      UpdateExpression:
        "SET last_poll_at = :now ADD poll_count :one",
      ExpressionAttributeValues: marshall({ ":now": nowIso, ":one": 1 }),
    })
  );
  if (tooFast) return oauthError("slow_down");

  if (row.status === "pending") return oauthError("authorization_pending");
  if (row.status === "denied") return oauthError("access_denied");
  // status === "approved" falls through.

  const homeId = row.home_id;
  const approvedBy = row.approved_by_sub;
  if (!homeId || !approvedBy) {
    // Approved but missing binding — treat as not-yet-usable rather than error.
    return oauthError("authorization_pending");
  }

  const machineId = row.device_info?.machine_id;
  const existingEdgeId = await findExistingEdgeId(machineId, homeId);
  const edgeId = existingEdgeId || generateEdgeId();

  const deviceToken = generateDeviceToken(edgeId);
  const tokenHash = sha256(deviceToken);
  const tokenExpiresIso = new Date(
    nowMs + DEVICE_TOKEN_TTL_S * 1000
  ).toISOString();

  // Upsert the durable registry row. On re-link we overwrite the token hash and
  // keep first_seen_at via if_not_exists.
  await ddb.send(
    new PutItemCommand({
      TableName: EDGE_REGISTRY_TABLE,
      Item: marshall(
        {
          edge_id: edgeId,
          machine_id: machineId || null,
          home_id: homeId,
          linked_by_cognito_sub: approvedBy,
          device_token_hash: tokenHash,
          device_token_expires: tokenExpiresIso,
          previous_token_hash: null,
          previous_token_expires: null,
          status: "linked",
          first_seen_at: nowIso,
          last_telemetry_at: null,
          last_heartbeat_at: null,
          linked_at: nowIso,
          revoked_at: null,
          revoked_reason: null,
        },
        { removeUndefinedValues: true }
      ),
    })
  );

  // Consume the pairing code so it can't be replayed.
  await ddb.send(
    new DeleteItemCommand({
      TableName: DEVICE_CODES_TABLE,
      Key: marshall({ device_code: body.device_code }),
    })
  );

  return json(200, {
    access_token: deviceToken,
    token_type: "Bearer",
    expires_in: DEVICE_TOKEN_TTL_S,
    edge_id: edgeId,
    home_id: homeId,
    scope: SCOPE,
    cloud_endpoints: buildCloudEndpoints(event, edgeId, homeId),
    interval: POLL_INTERVAL_S,
  });
};
