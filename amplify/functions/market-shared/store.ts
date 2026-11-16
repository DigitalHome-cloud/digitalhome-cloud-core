// The marketplace store. One row per seller in MarketSeller, holding its
// catalogue's version and where that version's Turtle is in S3. The versioned
// graph itself (conditional version update, one S3 object per version, the
// two-step save) is graph-store's, shared with the board templates; this file
// adds what only sellers have: creating one, and its images and datasheets.

import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GraphStore, type Clients } from "../graph-store/store";
import { BadRequest, FILE_EXT, FileSpec, KINDS, b64OfHex, fileKey, sellerId } from "./rules";
import { validateListing } from "./validate";

const ddb = new DynamoDBClient({});
// Presigned PUTs carry their checksum as a header S3 verifies; the SDK must
// not add one of its own.
const s3 = new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED" });
const TABLE = () => process.env.MARKET_SELLER_TABLE_NAME!;
const BUCKET = () => process.env.STORAGE_BUCKET_NAME!;

/** The sellers' catalogues as versioned graphs (market/graphs/<seller>/v<n>-<token>.ttl). */
export const marketGraphs = (clients?: Clients) => new GraphStore({
  area: "market", table: TABLE, bucket: BUCKET, noun: "catalogue", clients,
  validate: async (ttl, id) => {
    const v = await validateListing(ttl, id);
    return { ok: v.ok, problems: v.problems, triples: v.triples, counts: { articles: v.articles } };
  },
});
let graphs = marketGraphs();
/** Tests only: run the store against fake clients. */
export const useClients = (clients?: Clients) => { graphs = marketGraphs(clients); };

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

export const listSellers = (): Promise<Seller[]> => graphs.list<Seller>();

export async function getSeller(id: string): Promise<Seller | null> {
  return graphs.get<Seller>(sellerId(id));
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
export const graphUrl = (seller: Seller): Promise<string | null> => graphs.url(seller);

/** The seller's current catalogue as Turtle ("" before its first save). */
export const readGraph = (seller: Seller): Promise<string> => graphs.read(seller);

const asSave = (r: Awaited<ReturnType<GraphStore["commit"]>>): SaveResult =>
  r.status === "ok" ? { status: "ok", version: r.version, triples: r.triples, articles: r.counts.articles ?? 0 } : r;

/** A server-side save of a whole catalogue on top of the version `seller` holds. */
export async function writeGraph(seller: Seller, ttl: string, by: string): Promise<SaveResult> {
  return asSave(await graphs.write(seller, ttl, by));
}

/** A fresh staging key for a seller (a save's step 1, or a server-side write). */
export const stagingKeyFor = (seller: string) => graphs.stagingKey(seller);

/** Step 1 of a save: where to PUT the new Turtle (a private staging key). */
export const stageUpload = (seller: Seller) => graphs.stageUpload(seller.id);

/**
 * Step 2: check the staged Turtle and make it the next version, if the
 * catalogue is still at `baseVersion`. The staged object is removed either way.
 */
export async function commit(seller: Seller, key: string, baseVersion: number, by: string): Promise<SaveResult> {
  return asSave(await graphs.commit(seller, key, baseVersion, by));
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
