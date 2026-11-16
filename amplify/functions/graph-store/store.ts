// A store of versioned Turtle graphs, one per id: the marketplace (one graph
// per seller) and the board templates (one graph per norm edition) both use it.
//
// One row per id in a DynamoDB table holds the graph's version and where that
// version's Turtle is in S3. The version moves forward only by a conditional
// update naming the version the writer read (template-dlab5-cloud ADR-0007, as
// the Mediathek's Graph table): a stale write is refused with the current
// version, and the writer merges.
//
// The Turtle is in S3, not in the row: a wholesaler's catalogue is far larger
// than a DynamoDB item. Every saved version keeps its own object
// (<area>/graphs/<id>/v<n>-<token>.ttl), so a lost race never overwrites the
// winner's file, and older versions stay as history. A save is two steps: PUT
// the Turtle to a private staging key, then commit it, which validates it and
// makes it the next version. The staged object is removed either way.

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
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const GRAPH_ID = /^[a-z][a-z0-9-]{1,39}$/;
const URL_TTL_S = 900;

import { BadRequest } from "./errors";
export { BadRequest };

export interface GraphRow {
  id: string;
  version: number;
  s3Key?: string;
  triples?: number;
  updatedAt?: string;
  updatedBy?: string;
}

/** A validator's answer. `counts` are stored on the row (articles, templates …). */
export interface Verdict { ok: boolean; problems: string[]; triples: number; counts?: Record<string, number> }

export type SaveResult =
  | { status: "ok"; version: number; triples: number; counts: Record<string, number> }
  | { status: "conflict"; current: { version: number; url: string | null } }
  | { status: "invalid"; problems: string[] };

/** What the store needs from AWS; tests pass fakes. */
export interface Clients {
  ddb: { send(command: any): Promise<any> };
  s3: { send(command: any): Promise<any> };
  sign(command: GetObjectCommand | PutObjectCommand, expiresIn: number): Promise<string>;
}

let defaults: Clients | undefined;
export function awsClients(): Clients {
  if (!defaults) {
    // Presigned PUTs carry their checksum as a header S3 verifies; the SDK
    // must not add one of its own.
    const s3 = new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED" });
    defaults = {
      ddb: new DynamoDBClient({}),
      s3,
      sign: (command, expiresIn) => getSignedUrl(s3, command, { expiresIn }),
    };
  }
  return defaults;
}

export interface StoreOptions {
  /** The key prefix in S3: <area>/graphs/…, <area>/staging/…. */
  area: string;
  table: () => string;
  bucket: () => string;
  validate: (ttl: string, id: string) => Promise<Verdict>;
  /**
   * Rewrites an untrusted save before it is validated, given the current
   * version's Turtle ("" before the first save). The templates use it to keep
   * the verification facts out of the uploader's hands.
   */
  prepare?: (ttl: string, current: string, id: string) => Promise<string> | string;
  /** What "a graph" is called in messages: "catalogue", "template set". */
  noun?: string;
  clients?: Clients;
}

const token = () => randomBytes(16).toString("hex");

export class GraphStore {
  readonly staging: RegExp;
  private readonly noun: string;

  constructor(private readonly o: StoreOptions) {
    if (!/^[a-z][a-z0-9-]*$/.test(o.area)) throw new Error(`bad area ${o.area}`);
    this.staging = new RegExp(`^${o.area}\\/staging\\/([a-z][a-z0-9-]{1,39})\\/[0-9a-f]{32}\\.ttl$`);
    this.noun = o.noun ?? "graph";
  }

  private get c(): Clients {
    return this.o.clients ?? awsClients();
  }

  id(v: unknown): string {
    const id = String(v ?? "");
    if (!GRAPH_ID.test(id)) throw new BadRequest("an id is 2 to 40 lowercase letters, digits and -, starting with a letter");
    return id;
  }

  stagingKey(id: string): string {
    return `${this.o.area}/staging/${this.id(id)}/${token()}.ttl`;
  }

  async list<R extends GraphRow = GraphRow>(): Promise<R[]> {
    const out: R[] = [];
    let start: Record<string, any> | undefined;
    do {
      const res = await this.c.ddb.send(new ScanCommand({ TableName: this.o.table(), ExclusiveStartKey: start }));
      (res.Items || []).forEach((i: any) => out.push(unmarshall(i) as R));
      start = res.LastEvaluatedKey;
    } while (start);
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  async get<R extends GraphRow = GraphRow>(id: string): Promise<R | null> {
    const got = await this.c.ddb.send(new GetItemCommand({ TableName: this.o.table(), Key: marshall({ id: this.id(id) }) }));
    return got.Item ? (unmarshall(got.Item) as R) : null;
  }

  /** The row of `id`, made at version 0 if there is none yet. */
  async ensure<R extends GraphRow = GraphRow>(id: string, by: string): Promise<R> {
    const row: GraphRow = { id: this.id(id), version: 0, triples: 0, updatedBy: by, updatedAt: new Date().toISOString() };
    try {
      await this.c.ddb.send(new PutItemCommand({
        TableName: this.o.table(), Item: marshall(row), ConditionExpression: "attribute_not_exists(id)",
      }));
    } catch (err) {
      if (!(err instanceof ConditionalCheckFailedException)) throw err;
    }
    return (await this.get<R>(id))!;
  }

  /** A 15-minute link to the current version; null before the first save. */
  async url(row: GraphRow): Promise<string | null> {
    if (!row.version || !row.s3Key) return null;
    return this.c.sign(new GetObjectCommand({ Bucket: this.o.bucket(), Key: row.s3Key }), URL_TTL_S);
  }

  /** The current version as Turtle ("" before the first save). */
  async read(row: GraphRow): Promise<string> {
    if (!row.version || !row.s3Key) return "";
    const obj = await this.c.s3.send(new GetObjectCommand({ Bucket: this.o.bucket(), Key: row.s3Key }));
    return obj.Body!.transformToString("utf-8");
  }

  /** Step 1 of a save: where to PUT the new Turtle (a private staging key). */
  async stageUpload(id: string): Promise<{ key: string; url: string; headers: Record<string, string> }> {
    const key = this.stagingKey(id);
    const url = await this.c.sign(new PutObjectCommand({ Bucket: this.o.bucket(), Key: key, ContentType: "text/turtle" }), URL_TTL_S);
    return { key, url, headers: { "Content-Type": "text/turtle" } };
  }

  /**
   * A server-side save of a whole graph on top of the version `row` holds.
   * `trusted` skips `prepare`: only for a write the Lambda composed itself.
   */
  async write(row: GraphRow, ttl: string, by: string, opts: { trusted?: boolean } = {}): Promise<SaveResult> {
    const key = this.stagingKey(row.id);
    await this.c.s3.send(new PutObjectCommand({ Bucket: this.o.bucket(), Key: key, Body: ttl, ContentType: "text/turtle" }));
    return this.commit(row, key, row.version, by, opts);
  }

  /**
   * Step 2: check the staged Turtle and make it the next version, if the graph
   * is still at `baseVersion`. The staged object is removed either way.
   */
  async commit(row: GraphRow, key: string, baseVersion: number, by: string, opts: { trusted?: boolean } = {}): Promise<SaveResult> {
    const m = this.staging.exec(String(key ?? ""));
    if (!m || m[1] !== row.id) throw new BadRequest(`key must be a staging key of this ${this.noun} (from step 1)`);
    if (!Number.isInteger(baseVersion) || baseVersion < 0) {
      throw new BadRequest(`baseVersion is the version you read, 0 for a new ${this.noun}`);
    }
    const bucket = this.o.bucket();
    try {
      if (baseVersion !== row.version) return { status: "conflict", current: { version: row.version, url: await this.url(row) } };
      let ttl: string;
      try {
        const obj = await this.c.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        ttl = await obj.Body!.transformToString("utf-8");
      } catch {
        throw new BadRequest("nothing was uploaded to that key");
      }
      if (this.o.prepare && !opts.trusted) ttl = await this.o.prepare(ttl, await this.read(row), row.id);
      const verdict = await this.o.validate(ttl, row.id);
      if (!verdict.ok) return { status: "invalid", problems: verdict.problems };

      const version = baseVersion + 1;
      const dest = `${this.o.area}/graphs/${row.id}/v${version}-${token()}.ttl`;
      await this.c.s3.send(new PutObjectCommand({ Bucket: bucket, Key: dest, Body: ttl, ContentType: "text/turtle" }));
      const counts = verdict.counts ?? {};
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {
        ":v": version, ":k": dest, ":t": verdict.triples, ":now": new Date().toISOString(), ":by": by, ":base": baseVersion,
      };
      const sets = ["version = :v", "s3Key = :k", "triples = :t", "updatedAt = :now", "updatedBy = :by"];
      Object.entries(counts).forEach(([field, n], i) => {
        names[`#c${i}`] = field;
        values[`:c${i}`] = n;
        sets.push(`#c${i} = :c${i}`);
      });
      try {
        await this.c.ddb.send(new UpdateItemCommand({
          TableName: this.o.table(),
          Key: marshall({ id: row.id }),
          UpdateExpression: `SET ${sets.join(", ")}`,
          ConditionExpression: "version = :base",
          ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
          ExpressionAttributeValues: marshall(values),
        }));
      } catch (err) {
        await this.c.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: dest }));
        if (!(err instanceof ConditionalCheckFailedException)) throw err;
        const current = (await this.get(row.id))!;
        return { status: "conflict", current: { version: current.version, url: await this.url(current) } };
      }
      return { status: "ok", version, triples: verdict.triples, counts };
    } finally {
      await this.c.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
    }
  }
}
