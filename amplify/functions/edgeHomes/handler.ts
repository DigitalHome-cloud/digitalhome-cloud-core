// edgeHomes — POST /edge/v1/homes (auth: Bearer device_token).
//
// Answers which homes this edge may work for: every DigitalHome whose owners
// include the person who linked the edge (EdgeRegistry.linked_by_cognito_sub),
// plus the home the edge itself is linked to. The person is taken from the
// token's registry row, never from the request body.
//
//   200 → { homes: [{ smartHomeId, homeId, label, city, postalCode, country, isDemo, linked }] }
//
// homeId is the home's permanent id (ADR 0018); a home made before it existed
// gets one here, once.
//   401 → invalid/expired token   (edge re-runs device flow)
//   410 → box revoked
//
// The owner's own addresses go to the owner's own edge; nothing else does.

import { GetItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { json, extractBearer } from "../edge-shared/http";
import {
  ddb,
  marshall,
  unmarshall,
  verifyDeviceToken,
  EDGE_REGISTRY_TABLE,
} from "../edge-shared/registry";
import { ensureHomeId } from "../home-id/home-id";

const DIGITALHOME_TABLE = process.env.DIGITALHOME_TABLE_NAME!;

interface HomeRow {
  smartHomeId: string;
  homeId?: string;
  owners?: string[];
  city?: string;
  postalCode?: string;
  country?: string;
  addressLine1?: string;
  isDemo?: boolean;
}

const view = (h: HomeRow, linkedId: string) => ({
  smartHomeId: h.smartHomeId,
  homeId: h.homeId || "",
  label: [h.addressLine1, h.city].filter(Boolean).join(", ") || h.smartHomeId,
  city: h.city || "",
  postalCode: h.postalCode || "",
  country: h.country || "",
  isDemo: !!h.isDemo,
  linked: h.smartHomeId === linkedId,
});

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  if (!EDGE_REGISTRY_TABLE || !DIGITALHOME_TABLE)
    return json(500, { error: "server_misconfigured" });

  const verified = await verifyDeviceToken(extractBearer(event));
  if (verified.ok === false) {
    return verified.reason === "revoked"
      ? json(410, { error: "revoked" })
      : json(401, { error: "invalid_token" });
  }
  const { row } = verified;
  const sub = row.linked_by_cognito_sub || "";
  const linkedId = row.home_id || "";

  const found = new Map<string, HomeRow>();
  if (sub) {
    // A person has a handful of homes; the table is small. A Scan with a
    // filter is enough until an owner index is worth its cost.
    let start: Record<string, any> | undefined;
    do {
      const res = await ddb.send(
        new ScanCommand({
          TableName: DIGITALHOME_TABLE,
          FilterExpression: "contains(#o, :sub)",
          ExpressionAttributeNames: { "#o": "owners" },
          ExpressionAttributeValues: marshall({ ":sub": sub }),
          ExclusiveStartKey: start,
        })
      );
      for (const item of res.Items || []) {
        const h = unmarshall(item) as HomeRow;
        if (h.smartHomeId) found.set(h.smartHomeId, h);
      }
      start = res.LastEvaluatedKey;
    } while (start);
  }
  if (linkedId && !found.has(linkedId)) {
    const res = await ddb.send(
      new GetItemCommand({
        TableName: DIGITALHOME_TABLE,
        Key: marshall({ smartHomeId: linkedId }),
      })
    );
    if (res.Item) found.set(linkedId, unmarshall(res.Item) as HomeRow);
  }

  for (const h of found.values()) await ensureHomeId(ddb, DIGITALHOME_TABLE, h);
  const homes = [...found.values()]
    .map((h) => view(h, linkedId))
    .sort((a, b) => Number(b.linked) - Number(a.linked) || a.label.localeCompare(b.label));
  return json(200, { homes });
};
