// Blank tags (darkfactory ADR 0018 point 10): QR codes printed before the
// item they will stand for is known. A tag is minted for one home; on site
// a person binds it to an item of that home's configuration, and may bind
// it again later without reprinting. The code holds /id/?t=<tagId> only.
//
// Who: the caller has already been allowed for the home (access.ts). A tag
// is read or bound by its home's owners; the tag id alone grants nothing.

import { GetItemCommand, PutItemCommand, UpdateItemCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { webcrypto } from "node:crypto";
import { ALPHABET } from "../home-id/home-id";
import { BadRequest } from "./rules";

export const TAG_ID = /^t-[abcdefghjkmnpqrstuvwxyz23456789]{10}$/;
export const ITEM_ID = /^[a-z][a-z0-9-]{2,60}$/;
export const MAX_MINT = 200;
const MAX_HISTORY = 20;

let ddb: { send(command: any): Promise<any> } = new DynamoDBClient({});
/** Tests only. */
export const useTagDdb = (client: { send(command: any): Promise<any> }) => { ddb = client; };
const TABLE = () => process.env.HOME_TAGS_TABLE_NAME!;

export interface HomeTag {
  tagId: string;
  homeId: string;
  item?: string | null;
  mintedAt: string;
  mintedBy: string;
  boundAt?: string | null;
  boundBy?: string | null;
  history?: { item: string | null; by: string; at: string }[];
}

export function mintTagId(): string {
  const out: string[] = [];
  while (out.length < 10) {
    for (const b of webcrypto.getRandomValues(new Uint8Array(16))) {
      if (b < 248 && out.length < 10) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return "t-" + out.join("");
}

export function checkTagId(id: unknown): string {
  const s = String(id ?? "");
  if (!TAG_ID.test(s)) throw new BadRequest("a tag id looks like t- and ten letters or digits");
  return s;
}

/** The tag, or null. */
export async function getTag(id: unknown): Promise<HomeTag | null> {
  const res = await ddb.send(new GetItemCommand({ TableName: TABLE(), Key: marshall({ tagId: checkTagId(id) }) }));
  return res.Item ? (unmarshall(res.Item) as HomeTag) : null;
}

/** Mint `count` blank tags for a home. */
export async function mintTags(home: string, count: unknown, by: string): Promise<{ homeId: string; tags: string[] }> {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > MAX_MINT) throw new BadRequest(`mint 1 to ${MAX_MINT} tags at a time`);
  const at = new Date().toISOString();
  const tags: string[] = [];
  while (tags.length < n) {
    const tagId = mintTagId();
    try {
      await ddb.send(new PutItemCommand({
        TableName: TABLE(),
        Item: marshall({ tagId, homeId: home, item: null, mintedAt: at, mintedBy: by, history: [] }),
        ConditionExpression: "attribute_not_exists(tagId)",
      }));
      tags.push(tagId);
    } catch (err) {
      if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err;   // taken: draw again
    }
  }
  return { homeId: home, tags };
}

/** Bind the tag to an item of its home, or unbind it (item null or ""). */
export async function bindTag(tag: HomeTag, item: unknown, by: string): Promise<HomeTag> {
  const next = item === null || item === undefined || item === "" ? null : String(item);
  if (next !== null && !ITEM_ID.test(next)) throw new BadRequest("an item id is letters, digits and dashes");
  const at = new Date().toISOString();
  const history = [...(tag.history || []), { item: tag.item ?? null, by: tag.boundBy || tag.mintedBy, at: tag.boundAt || tag.mintedAt }]
    .slice(-MAX_HISTORY);
  await ddb.send(new UpdateItemCommand({
    TableName: TABLE(),
    Key: marshall({ tagId: tag.tagId }),
    UpdateExpression: "SET #i = :i, boundAt = :at, boundBy = :by, history = :h",
    ConditionExpression: "attribute_exists(tagId) AND homeId = :home",
    ExpressionAttributeNames: { "#i": "item" },
    ExpressionAttributeValues: marshall({ ":i": next, ":at": at, ":by": by, ":h": history, ":home": tag.homeId }),
  }));
  return { ...tag, item: next, boundAt: at, boundBy: by, history };
}

/** What the Portal gets back: no history, no who. */
export const publicTag = (t: HomeTag) => ({ tagId: t.tagId, homeId: t.homeId, item: t.item ?? null, boundAt: t.boundAt ?? null });
