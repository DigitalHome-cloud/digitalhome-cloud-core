// edgeDeviceApproval — AppSync resolver for the Portal edge-management UI.
//
// Dispatches on event.info.fieldName:
//   describeDeviceCode(user_code)          — device_info for the /link screen.
//   approveDeviceCode(user_code, home_id?) — registers the box to the caller.
//     home_id is OPTIONAL (two-step model): omit it to register the edge to the
//     user now and link it to a home later from "My Edges".
//   denyDeviceCode(user_code)              — rejects the pairing.
//   listMyEdges                            — the caller's registered edges.
//   linkEdgeToHome(edge_id, home_id?)      — assign/reassign (or, with no
//     home_id, unassign) an edge the caller owns to a home they own.
//
// Trust anchor: the Cognito login. Registration binds the edge to the caller's
// sub; home assignment always verifies the caller owns both the edge and home.

import {
  QueryCommand,
  UpdateItemCommand,
  GetItemCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import type { AppSyncResolverEvent, AppSyncIdentityCognito } from "aws-lambda";

const REGION = process.env.AWS_REGION || "eu-central-1";
const DEVICE_CODES_TABLE = process.env.DEVICE_CODES_TABLE_NAME!;
const DIGITALHOME_TABLE = process.env.DIGITALHOME_TABLE_NAME!;
const EDGE_REGISTRY_TABLE = process.env.EDGE_REGISTRY_TABLE_NAME!;
const ADMIN_GROUP = "dhc-admins";

const ddb = new DynamoDBClient({ region: REGION });

interface Args {
  user_code?: string;
  home_id?: string;
  edge_id?: string;
}
interface DeviceInfo {
  machine_id?: string;
  hostname?: string;
  lan_ip?: string;
  dhe_version?: string;
}
interface PendingRow {
  device_code: string;
  status: string;
  device_info?: DeviceInfo;
}

async function findByUserCode(userCode: string): Promise<PendingRow | null> {
  const idx = await ddb.send(
    new QueryCommand({
      TableName: DEVICE_CODES_TABLE,
      IndexName: "byUserCode",
      KeyConditionExpression: "user_code = :uc",
      ExpressionAttributeValues: marshall({ ":uc": userCode }),
      Limit: 1,
    })
  );
  if (!idx.Items || idx.Items.length === 0) return null;
  const key = unmarshall(idx.Items[0]);
  const res = await ddb.send(
    new GetItemCommand({
      TableName: DEVICE_CODES_TABLE,
      Key: marshall({ device_code: key.device_code }),
    })
  );
  if (!res.Item) return null;
  const row = unmarshall(res.Item);
  return {
    device_code: row.device_code as string,
    status: row.status as string,
    device_info: (row.device_info as DeviceInfo) || {},
  };
}

// Owner of the DigitalHome, or admin.
async function callerOwnsHome(
  sub: string,
  isAdmin: boolean,
  homeId: string
): Promise<boolean> {
  if (isAdmin) return true;
  const res = await ddb.send(
    new GetItemCommand({
      TableName: DIGITALHOME_TABLE,
      Key: marshall({ smartHomeId: homeId }),
    })
  );
  if (!res.Item) return false;
  const home = unmarshall(res.Item);
  const owners: string[] = Array.isArray(home.owners) ? home.owners : [];
  return owners.includes(sub);
}

function toEdgeSummary(row: Record<string, unknown>) {
  return {
    edge_id: (row.edge_id as string) ?? null,
    home_id: (row.home_id as string) ?? null,
    machine_id: (row.machine_id as string) ?? null,
    hostname: (row.hostname as string) ?? null,
    dhe_version: (row.dhe_version as string) ?? null,
    status: (row.status as string) ?? null,
    last_telemetry_at: (row.last_telemetry_at as string) ?? null,
    linked_at: (row.linked_at as string) ?? null,
  };
}

export const handler = async (event: AppSyncResolverEvent<Args>) => {
  if (!DEVICE_CODES_TABLE || !DIGITALHOME_TABLE || !EDGE_REGISTRY_TABLE) {
    throw new Error("Server misconfigured");
  }

  const identity = event.identity as AppSyncIdentityCognito | undefined;
  if (!identity?.sub) throw new Error("Unauthenticated");
  const sub = identity.sub;
  const isAdmin = (identity.groups || []).includes(ADMIN_GROUP);
  const field = event.info.fieldName;

  // ─── Edge-registry operations (no device_code) ──────────────────────────
  if (field === "listMyEdges") {
    const res = await ddb.send(
      new QueryCommand({
        TableName: EDGE_REGISTRY_TABLE,
        IndexName: "byOwner",
        KeyConditionExpression: "linked_by_cognito_sub = :s",
        ExpressionAttributeValues: marshall({ ":s": sub }),
      })
    );
    return (res.Items || []).map((i) => toEdgeSummary(unmarshall(i)));
  }

  if (field === "linkEdgeToHome") {
    const edgeId = (event.arguments.edge_id || "").trim();
    if (!edgeId) throw new Error("edge_id is required");
    const got = await ddb.send(
      new GetItemCommand({
        TableName: EDGE_REGISTRY_TABLE,
        Key: marshall({ edge_id: edgeId }),
      })
    );
    if (!got.Item) throw new Error("Edge not found");
    const edge = unmarshall(got.Item);
    // Must own the edge (registered it) or be an admin.
    if (!isAdmin && edge.linked_by_cognito_sub !== sub) {
      throw new Error("Not authorized for that edge");
    }

    const homeId = (event.arguments.home_id || "").trim();
    if (homeId) {
      if (!(await callerOwnsHome(sub, isAdmin, homeId))) {
        throw new Error("Not authorized for that home");
      }
      await ddb.send(
        new UpdateItemCommand({
          TableName: EDGE_REGISTRY_TABLE,
          Key: marshall({ edge_id: edgeId }),
          UpdateExpression: "SET home_id = :h",
          ExpressionAttributeValues: marshall({ ":h": homeId }),
        })
      );
      edge.home_id = homeId;
    } else {
      // Unassign — REMOVE the attribute so the byHomeId GSI drops it (a null
      // GSI key is not allowed; absence makes it a sparse-index no-op).
      await ddb.send(
        new UpdateItemCommand({
          TableName: EDGE_REGISTRY_TABLE,
          Key: marshall({ edge_id: edgeId }),
          UpdateExpression: "REMOVE home_id",
        })
      );
      edge.home_id = null;
    }
    return toEdgeSummary(edge);
  }

  // ─── Device-code operations (require a user_code) ───────────────────────
  const userCode = (event.arguments.user_code || "").trim().toUpperCase();
  if (!userCode) throw new Error("user_code is required");

  const pending = await findByUserCode(userCode);
  if (!pending) throw new Error("No pending device found for that code");

  if (field === "describeDeviceCode") {
    const di = pending.device_info || {};
    return {
      status: pending.status,
      hostname: di.hostname ?? null,
      lan_ip: di.lan_ip ?? null,
      dhe_version: di.dhe_version ?? null,
      machine_id: di.machine_id ?? null,
    };
  }

  if (pending.status !== "pending") {
    throw new Error(`Device code already ${pending.status}`);
  }

  const nowIso = new Date().toISOString();

  if (field === "denyDeviceCode") {
    await ddb.send(
      new UpdateItemCommand({
        TableName: DEVICE_CODES_TABLE,
        Key: marshall({ device_code: pending.device_code }),
        UpdateExpression: "SET #s = :denied",
        ConditionExpression: "#s = :pending",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: marshall({
          ":denied": "denied",
          ":pending": "pending",
        }),
      })
    );
    return { status: "denied", home_id: null };
  }

  if (field === "approveDeviceCode") {
    // Home is OPTIONAL (two-step). If given, the caller must own it.
    const homeId = (event.arguments.home_id || "").trim();
    if (homeId && !(await callerOwnsHome(sub, isAdmin, homeId))) {
      throw new Error("Not authorized for that home");
    }
    const sets = [
      "#s = :approved",
      "approved_by_sub = :sub",
      "approved_at = :now",
    ];
    const values: Record<string, unknown> = {
      ":approved": "approved",
      ":sub": sub,
      ":now": nowIso,
      ":pending": "pending",
    };
    if (homeId) {
      sets.push("home_id = :home");
      values[":home"] = homeId;
    }
    await ddb.send(
      new UpdateItemCommand({
        TableName: DEVICE_CODES_TABLE,
        Key: marshall({ device_code: pending.device_code }),
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression: "#s = :pending",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: marshall(values),
      })
    );
    return { status: "approved", home_id: homeId || null };
  }

  throw new Error(`Unsupported field: ${field}`);
};
