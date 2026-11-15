// edgeCatalogue — the global device catalogue (DeviceModel) for edges.
//
//   POST /edge/v1/catalogue      { since?, cursor? }   (auth: Bearer device_token)
//     → 200 { models: [...], cursor, now }
//       models changed after `since` (all of them without it), a page at a time:
//       call again with `cursor` until it is null, then keep `now` as the next
//       `since`. S3 paths and thumbnails are left out: they are the Portal's.
//
//   POST /edge/v1/catalogue/put  { model: {...} }      (auth: Bearer device_token)
//     → 200 { model, created }
//       creates or updates one model; only the fields sent change. Allowed
//       only while the person who linked the edge may edit the catalogue in
//       the Portal: dhc-admins with an authenticator app, asked of Cognito
//       on every call, never taken from the request.
//     → 403 { error: "not_allowed" }   400 { error: "invalid_model", description }
//
//   401 invalid/expired token · 410 revoked (as every edge route)

import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { ScanCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { json, extractBearer, parseJsonBody } from "../edge-shared/http";
import { ddb, marshall, unmarshall, verifyDeviceToken, EDGE_REGISTRY_TABLE } from "../edge-shared/registry";
import { VISIBLE, clean, fromCursor, mayWrite, since as parseSince, toCursor, view } from "./model";

const TABLE = process.env.DEVICEMODEL_TABLE_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;
const PAGE = 200;
const cognito = new CognitoIdentityProviderClient({});

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  if (!EDGE_REGISTRY_TABLE || !TABLE || !USER_POOL_ID) return json(500, { error: "server_misconfigured" });

  const verified = await verifyDeviceToken(extractBearer(event));
  if (verified.ok === false) {
    return verified.reason === "revoked" ? json(410, { error: "revoked" }) : json(401, { error: "invalid_token" });
  }
  const body = parseJsonBody<Record<string, unknown>>(event) || {};
  const path = event.rawPath || event.requestContext?.http?.path || "";
  try {
    if (path.endsWith("/catalogue/put")) return await put(body, verified.row.linked_by_cognito_sub || "");
    return await list(body);
  } catch (err) {
    const message = (err as Error).message || "bad request";
    return json(400, { error: path.endsWith("/put") ? "invalid_model" : "invalid_request", description: message });
  }
};

async function list(body: Record<string, unknown>): Promise<APIGatewayProxyResultV2> {
  const now = new Date().toISOString();
  const after = parseSince(body.since);
  const names: Record<string, string> = {};
  VISIBLE.forEach((k, i) => (names[`#f${i}`] = k));
  const res = await ddb.send(
    new ScanCommand({
      TableName: TABLE,
      Limit: PAGE,
      ExclusiveStartKey: fromCursor(body.cursor) as never,
      ProjectionExpression: Object.keys(names).join(", "),
      ExpressionAttributeNames: after ? { ...names, "#u": "updatedAt" } : names,
      ...(after ? { FilterExpression: "#u > :s", ExpressionAttributeValues: marshall({ ":s": after }) } : {}),
    })
  );
  const models = (res.Items || []).map((i) => view(unmarshall(i)));
  return json(200, { models, cursor: toCursor(res.LastEvaluatedKey as never), now });
}

async function allowed(sub: string): Promise<boolean> {
  if (!sub || !/^[0-9a-f-]{36}$/i.test(sub)) return false;
  try {
    const found = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Filter: `sub = "${sub}"`, Limit: 1 }));
    const username = found.Users?.[0]?.Username;
    if (!username) return false;
    const [groups, user] = await Promise.all([
      cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: USER_POOL_ID, Username: username })),
      cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username })),
    ]);
    return mayWrite((groups.Groups || []).map((g) => g.GroupName || ""), user.UserMFASettingList ?? []);
  } catch (err) {
    console.error("[edgeCatalogue] Cognito could not be asked; refusing the write", err);
    return false;
  }
}

async function put(body: Record<string, unknown>, sub: string): Promise<APIGatewayProxyResultV2> {
  const model = clean(body.model);                       // 400 before anyone is asked
  if (!(await allowed(sub))) return json(403, { error: "not_allowed" });

  const now = new Date().toISOString();
  const fields = Object.entries(model).filter(([k]) => k !== "modelNumber");
  const names: Record<string, string> = { "#t": "__typename", "#c": "createdAt", "#u": "updatedAt" };
  const values: Record<string, unknown> = { ":t": "DeviceModel", ":now": now };
  const sets = ["#t = :t", "#c = if_not_exists(#c, :now)", "#u = :now"];
  fields.forEach(([k, v], i) => {
    names[`#f${i}`] = k;
    values[`:v${i}`] = v;
    sets.push(`#f${i} = :v${i}`);
  });
  const res = await ddb.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: marshall({ modelNumber: model.modelNumber }),
      UpdateExpression: "SET " + sets.join(", "),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: marshall(values, { removeUndefinedValues: true }),
      ReturnValues: "ALL_NEW",
    })
  );
  const after = unmarshall(res.Attributes || {});
  console.log(`[edgeCatalogue] ${String(model.modelNumber)} written by an edge of ${sub}`);
  return json(200, { model: view(after), created: after.createdAt === now });
}
