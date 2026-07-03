// edgeDeviceApproval — AppSync resolver for the Portal /link page.
//
// Dispatches on event.info.fieldName:
//   approveDeviceCode(user_code, home_id) — binds a pending device_code to a
//     home the CALLER is authorized for (owner of the DigitalHome, or admin),
//     flipping its status to "approved" so the edge's next /token poll succeeds.
//   denyDeviceCode(user_code)             — flips status to "denied".
//
// Auth trust anchor: the Cognito login. We never trust the edge; the persisted
// home binding requires an authenticated owner here (spec §2).

import {
  QueryCommand,
  UpdateItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import type { AppSyncResolverEvent, AppSyncIdentityCognito } from "aws-lambda";

const REGION = process.env.AWS_REGION || "eu-central-1";
const DEVICE_CODES_TABLE = process.env.DEVICE_CODES_TABLE_NAME!;
const DIGITALHOME_TABLE = process.env.DIGITALHOME_TABLE_NAME!;
const ADMIN_GROUP = "dhc-admins";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
const ddb = new DynamoDBClient({ region: REGION });

interface ApprovalArgs {
  user_code?: string;
  home_id?: string;
}
interface ApprovalPayload {
  status: string;
  home_id: string | null;
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

// Look up the pending pairing row by the human user_code (GSI1 is KEYS_ONLY, so
// re-read the base row to get device_info). Returns null if none live.
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

// Authorize the caller for a home: owner listed on the DigitalHome, or admin.
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

interface DeviceCodeInfoPayload {
  status: string;
  hostname: string | null;
  lan_ip: string | null;
  dhe_version: string | null;
  machine_id: string | null;
}

export const handler = async (
  event: AppSyncResolverEvent<ApprovalArgs>
): Promise<ApprovalPayload | DeviceCodeInfoPayload> => {
  if (!DEVICE_CODES_TABLE || !DIGITALHOME_TABLE) {
    throw new Error("Server misconfigured");
  }

  const identity = event.identity as AppSyncIdentityCognito | undefined;
  if (!identity?.sub) throw new Error("Unauthenticated");
  const sub = identity.sub;
  const groups = identity.groups || [];
  const isAdmin = groups.includes(ADMIN_GROUP);

  const field = event.info.fieldName;
  const userCode = (event.arguments.user_code || "").trim().toUpperCase();
  if (!userCode) throw new Error("user_code is required");

  const pending = await findByUserCode(userCode);
  // Same generic error for missing/expired so we don't reveal code existence.
  if (!pending) throw new Error("No pending device found for that code");

  // describeDeviceCode — read-only device_info for the approval screen. Allowed
  // for any status so a re-opened /link can still show what happened.
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

  // approve/deny mutate — only valid while still pending.
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
    const homeId = (event.arguments.home_id || "").trim();
    if (!homeId) throw new Error("home_id is required");
    if (!(await callerOwnsHome(sub, isAdmin, homeId))) {
      throw new Error("Not authorized for that home");
    }
    await ddb.send(
      new UpdateItemCommand({
        TableName: DEVICE_CODES_TABLE,
        Key: marshall({ device_code: pending.device_code }),
        UpdateExpression:
          "SET #s = :approved, home_id = :home, approved_by_sub = :sub, approved_at = :now",
        ConditionExpression: "#s = :pending",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: marshall({
          ":approved": "approved",
          ":home": homeId,
          ":sub": sub,
          ":now": nowIso,
          ":pending": "pending",
        }),
      })
    );
    return { status: "approved", home_id: homeId };
  }

  throw new Error(`Unsupported field: ${field}`);
};
