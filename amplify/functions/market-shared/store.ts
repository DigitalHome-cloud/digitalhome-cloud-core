// The marketplace store. One row per seller in MarketSeller, holding its
// catalogue's version and where that version's Turtle is in S3. The version
// moves forward only by a conditional update naming the version the writer
// read (template-dlab5-cloud ADR-0007, as the Mediathek's Graph table): a
// stale write is refused with the current version, and the writer merges.
//
// The Turtle itself is in S3, not in the row: a wholesaler's catalogue is far
// larger than a DynamoDB item. Every saved version keeps its own object
// (market/graphs/<seller>/v<n>-<token>.ttl), so a lost race never overwrites
// the winner's file, and older versions stay as history.

import { randomBytes } from "node:crypto";
import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  BadRequest, FILE_EXT, FileSpec, KINDS, STAGING, b64OfHex, fileKey, sellerId, stagingKey,
} from "./rules";
import { validateListing } from "./validate";

const ddb = new DynamoDBClient({});
// Presigned PUTs carry their checksum as a header S3 verifies; the SDK must
// not add one of its own.
const s3 = new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED" });
const TABLE = () => process.env.MARKET_SELLER_TABLE_NAME!;
const BUCKET = () => process.env.STORAGE_BUCKET_NAME!;
const URL_TTL_S = 900;

export interface Seller {
  id: string;
  name: string;
  kind: string;
  version: number;
  triples?: number;
  articles?: number;
  s3Key?: string;
  updatedAt?: string;
  updatedBy?: string;
  createdAt?: string;
}

export type SaveResult =
  | { status: "ok"; version: number; triples: number; articles: number }
  | { status: "conflict"; current: { version: number; url: string | null } }
  | { status: "invalid"; problems: string[] };

const token = () => randomBytes(16).toString("hex");

export async function listSellers(): Promise<Seller[]> {
  const out: Seller[] = [];
  let start: Record<string, any> | undefined;
  do {
    const res = await ddb.send(new ScanCommand({ TableName: TABLE(), ExclusiveStartKey: start }));
    (res.Items || []).forEach((i) => out.push(unmarshall(i) as Seller));
    start = res.LastEvaluatedKey;
  } while (start);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function getSeller(id: string): Promise<Seller | null> {
  const got = await ddb.send(new GetItemCommand({ TableName: TABLE(), Key: marshall({ id: sellerId(id) }) }));
  return got.Item ? (unmarshall(got.Item) as Seller) : null;
}

export async function createSeller(id: string, name: string, kind: string, by: string): Promise<Seller> {
  sellerId(id);
  const label = String(name ?? "").trim();
  if (!label || label.length > 120) throw new BadRequest("a seller's name is 1 to 120 characters");
  if (!(KINDS as readonly string[]).includes(kind)) throw new BadRequest(`kind is one of ${KINDS.join(", ")}`);
  const row: Seller = { id, name: label, kind, version: 0, triples: 0, articles: 0, createdAt: new Date().toISOString(), updatedBy: by };
  try {
    await ddb.send(new PutItemCommand({
      TableName: TABLE(), Item: marshall(row), ConditionExpression: "attribute_not_exists(id)",
    }));
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) throw new BadRequest(`there is a seller ${id} already`);
    throw err;
  }
  return row;
}

/** A 15-minute link to the seller's current catalogue; null before its first save. */
export async function graphUrl(seller: Seller): Promise<string | null> {
  if (!seller.version || !seller.s3Key) return null;
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET(), Key: seller.s3Key }), { expiresIn: URL_TTL_S });
}

/** A fresh staging key for a seller (a save's step 1, or a server-side write). */
export const stagingKeyFor = (seller: string) => stagingKey(seller, token());

/** Step 1 of a save: where to PUT the new Turtle (a private staging key). */
export async function stageUpload(seller: Seller): Promise<{ key: string; url: string; headers: Record<string, string> }> {
  const key = stagingKeyFor(seller.id);
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: BUCKET(), Key: key, ContentType: "text/turtle" }),
    { expiresIn: URL_TTL_S });
  return { key, url, headers: { "Content-Type": "text/turtle" } };
}

/**
 * Step 2: check the staged Turtle and make it the next version, if the
 * catalogue is still at `baseVersion`. The staged object is removed either way.
 */
export async function commit(seller: Seller, key: string, baseVersion: number, by: string): Promise<SaveResult> {
  const m = STAGING.exec(String(key ?? ""));
  if (!m || m[1] !== seller.id) throw new BadRequest("key must be a staging key of this seller (from step 1)");
  if (!Number.isInteger(baseVersion) || baseVersion < 0) throw new BadRequest("baseVersion is the version you read, 0 for a new catalogue");
  try {
    if (baseVersion !== seller.version) return { status: "conflict", current: { version: seller.version, url: await graphUrl(seller) } };
    let ttl: string;
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }));
      ttl = await obj.Body!.transformToString("utf-8");
    } catch {
      throw new BadRequest("nothing was uploaded to that key");
    }
    const verdict = await validateListing(ttl, seller.id);
    if (!verdict.ok) return { status: "invalid", problems: verdict.problems };

    const version = baseVersion + 1;
    const dest = `market/graphs/${seller.id}/v${version}-${token()}.ttl`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET(), Key: dest, Body: ttl, ContentType: "text/turtle" }));
    const now = new Date().toISOString();
    try {
      await ddb.send(new UpdateItemCommand({
        TableName: TABLE(),
        Key: marshall({ id: seller.id }),
        UpdateExpression: "SET version = :v, s3Key = :k, triples = :t, articles = :a, updatedAt = :now, updatedBy = :by",
        ConditionExpression: "version = :base",
        ExpressionAttributeValues: marshall({
          ":v": version, ":k": dest, ":t": verdict.triples, ":a": verdict.articles, ":now": now, ":by": by, ":base": baseVersion,
        }),
      }));
    } catch (err) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: dest }));
      if (!(err instanceof ConditionalCheckFailedException)) throw err;
      const current = (await getSeller(seller.id))!;
      return { status: "conflict", current: { version: current.version, url: await graphUrl(current) } };
    }
    return { status: "ok", version, triples: verdict.triples, articles: verdict.articles };
  } finally {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key })).catch(() => undefined);
  }
}

async function storedChecksum(key: string): Promise<string | null | undefined> {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key, ChecksumMode: "ENABLED" }));
    return r.ChecksumSHA256 ?? null;
  } catch (err) {
    if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return undefined;
    throw err;
  }
}

/**
 * Presigned PUTs for a seller's images and datasheets, each bound to its
 * SHA-256 (S3 verifies the body) and write-once (If-None-Match). Files
 * already there come back as `exists`. The same pattern as the Mediathek's
 * media uploads.
 */
export async function uploads(seller: Seller, files: FileSpec[]) {
  return Promise.all(files.map(async (f) => {
    const key = fileKey(seller.id, f.sha256, f.ext);
    const name = `${f.sha256}.${f.ext}`;
    if ((await storedChecksum(key)) !== undefined) return { name, key, exists: true };
    const headers = {
      "Content-Type": FILE_EXT[f.ext],
      "x-amz-checksum-sha256": b64OfHex(f.sha256),
      "If-None-Match": "*",
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    const url = await getSignedUrl(s3, new PutObjectCommand({
      Bucket: BUCKET(), Key: key, ContentType: headers["Content-Type"], ChecksumSHA256: headers["x-amz-checksum-sha256"],
      CacheControl: headers["Cache-Control"], IfNoneMatch: "*",
    }), { expiresIn: 3600, unhoistableHeaders: new Set(["x-amz-checksum-sha256", "if-none-match"]) });
    return { name, key, exists: false, url, headers };
  }));
}
