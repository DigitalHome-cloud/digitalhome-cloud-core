// A home's permanent, meaningless id (ADR 0018): "h-" and ten characters.
//
// The SmartHome ID is made from the address (createDigitalHome →
// computeSmartHomeId) and is a name, not an identity: everything keyed per
// home from ADR 0018 on — configuration versions, planning options, the vault
// — uses the homeId instead, so a name can be corrected without moving data.
//
// The alphabet leaves out 0, 1, l, o and i: someone reads an id off a screen
// and types it (the Mediathek's ADR-0003). Randomness is crypto's, never
// Math.random, which is seeded per process.
//
// Homes made before the homeId existed get one the first time a function
// needs it (ensureHomeId): a conditional update that only ever sets it once,
// so two Lambdas racing agree on the same id.

import { ConditionalCheckFailedException, GetItemCommand, ScanCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { webcrypto } from "node:crypto";

export const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const HOME_ID = /^h-[abcdefghjkmnpqrstuvwxyz23456789]{10}$/;

interface Ddb { send(command: any): Promise<any> }

export function mintHomeId(): string {
  // 31 symbols: reject bytes ≥ 248 so every symbol is equally likely
  const out: string[] = [];
  while (out.length < 10) {
    const bytes = webcrypto.getRandomValues(new Uint8Array(16));
    for (const b of bytes) {
      if (b < 248 && out.length < 10) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return "h-" + out.join("");
}

export interface HomeRow {
  smartHomeId: string;
  homeId?: string;
  owners?: string[];
  isDemo?: boolean;
}

/** The row's homeId, minted and stored once if it has none yet. */
export async function ensureHomeId(ddb: Ddb, table: string, row: HomeRow): Promise<string> {
  if (row.homeId && HOME_ID.test(row.homeId)) return row.homeId;
  const homeId = mintHomeId();
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: table,
      Key: marshall({ smartHomeId: row.smartHomeId }),
      UpdateExpression: "SET homeId = :h",
      ConditionExpression: "attribute_exists(smartHomeId) AND attribute_not_exists(homeId)",
      ExpressionAttributeValues: marshall({ ":h": homeId }),
    }));
    row.homeId = homeId;
    return homeId;
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
    // someone else minted it first (or the home is gone): take theirs
    const got = await ddb.send(new GetItemCommand({ TableName: table, Key: marshall({ smartHomeId: row.smartHomeId }) }));
    const now = got.Item ? (unmarshall(got.Item) as HomeRow) : null;
    if (!now?.homeId) throw new Error(`DigitalHome ${row.smartHomeId} not found`);
    row.homeId = now.homeId;
    return now.homeId;
  }
}

/** The DigitalHome row with this homeId, or null. The table holds a person's
 *  handful of homes; a filtered Scan is enough until an index pays off. */
export async function findByHomeId(ddb: Ddb, table: string, homeId: string): Promise<HomeRow | null> {
  if (!HOME_ID.test(homeId)) return null;
  let start: Record<string, any> | undefined;
  do {
    const res = await ddb.send(new ScanCommand({
      TableName: table,
      FilterExpression: "homeId = :h",
      ExpressionAttributeValues: marshall({ ":h": homeId }),
      ExclusiveStartKey: start,
    }));
    const item = (res.Items || [])[0];
    if (item) return unmarshall(item) as HomeRow;
    start = res.LastEvaluatedKey;
  } while (start);
  return null;
}

/** May this caller (Cognito sub or username, and groups) work on the home? */
export function mayUse(home: HomeRow, who: { sub?: string; username?: string; groups?: string[] }): boolean {
  if ((who.groups || []).includes("dhc-admins")) return true;
  const owners = home.owners || [];
  return (!!who.sub && owners.includes(who.sub)) || (!!who.username && owners.includes(who.username));
}
