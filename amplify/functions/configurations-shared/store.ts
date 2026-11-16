// A home's configurations (darkfactory ADR 0018): one live version, the
// versions before it, and the planning options.
//
//   HomeConfigVersions   (homeId, version)  one row per version, "0001-0000" …,
//                                           and one HEAD row naming the live one
//   S3 configurations/versions/<homeId>/<MMMM>-<mmmm>-<token>.ttl
//                                           each version's Turtle, written once
//   HomeConfigOptions    graph-store rows   the planning options <homeId>-pNN,
//                                           with homeId, basedOn, label, status
//
// The live configuration moves only by one DynamoDB transaction: the new
// version's row is put (if it does not exist) and HEAD is moved (if it still
// names the version the writer read). A writer that lost the race leaves an
// unreferenced object behind, never a wrong live version.

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  GetItemCommand, QueryCommand, TransactWriteItemsCommand, TransactionCanceledException, UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomBytes } from "node:crypto";
import { GraphStore, awsClients, type Clients, type GraphRow, type SaveResult } from "../graph-store/store";
import {
  BadRequest, additions, checkConfiguration, formatVersion, minorProblems, optionId, parse, parseVersion,
  splitOptionId, splitVersionId, summary, union, versionId, write,
} from "./rules";

const VERSIONS = () => process.env.HOME_CONFIG_VERSIONS_TABLE_NAME!;
const OPTIONS = () => process.env.HOME_CONFIG_OPTIONS_TABLE_NAME!;
const BUCKET = () => process.env.STORAGE_BUCKET_NAME!;
const HEAD = "HEAD";
const URL_TTL_S = 900;

export interface Head { homeId: string; version: "HEAD"; live: string; liveKey: string; optionSeq?: number; updatedAt: string }
export interface VersionRow {
  homeId: string; version: string; id: string; kind: "first" | "major" | "minor"; s3Key: string;
  basedOn?: string; fromOption?: string; triples: number; summary: string; at: string; by: string;
}
export type Status = "live" | "superseded" | "legacy";
export interface OptionRow extends GraphRow {
  homeId?: string; basedOn?: string; label?: string; status?: "open" | "promoted"; promotedTo?: string;
  createdAt?: string; createdBy?: string;
}

export type ChangeResult =
  | { status: "ok"; id: string; version: string; summary: string }
  | { status: "conflict"; live: string | null }
  | { status: "invalid"; problems: string[] };

const token = () => randomBytes(8).toString("hex");

export class HomeConfigs {
  readonly options: GraphStore;

  constructor(private readonly clients?: Clients) {
    this.options = new GraphStore({
      area: "configurations", table: OPTIONS, bucket: BUCKET, noun: "planning option", clients,
      validate: async (ttl) => checkConfiguration(ttl),
    });
  }

  private get c(): Clients {
    return this.clients ?? awsClients();
  }

  // ---------------------------------------------------------------- reading

  async head(home: string): Promise<Head | null> {
    const got = await this.c.ddb.send(new GetItemCommand({ TableName: VERSIONS(), Key: marshall({ homeId: home, version: HEAD }) }));
    return got.Item ? (unmarshall(got.Item) as Head) : null;
  }

  /** Every version of the home, newest first, each with its status. */
  async versions(home: string): Promise<Array<VersionRow & { status: Status }>> {
    const rows: VersionRow[] = [];
    let start: Record<string, any> | undefined;
    let head: Head | null = null;
    do {
      const res = await this.c.ddb.send(new QueryCommand({
        TableName: VERSIONS(), KeyConditionExpression: "homeId = :h",
        ExpressionAttributeValues: marshall({ ":h": home }), ExclusiveStartKey: start,
      }));
      for (const item of res.Items || []) {
        const r = unmarshall(item);
        if (r.version === HEAD) head = r as Head;
        else rows.push(r as VersionRow);
      }
      start = res.LastEvaluatedKey;
    } while (start);
    const live = head?.live ?? "";
    const liveMajor = live ? parseVersion(live).major : 0;
    return rows
      .sort((a, b) => b.version.localeCompare(a.version))
      .map((r) => ({ ...r, status: r.version === live ? "live" : parseVersion(r.version).major === liveMajor ? "superseded" : "legacy" }));
  }

  async version(home: string, version: string): Promise<VersionRow | null> {
    const got = await this.c.ddb.send(new GetItemCommand({ TableName: VERSIONS(), Key: marshall({ homeId: home, version }) }));
    return got.Item ? (unmarshall(got.Item) as VersionRow) : null;
  }

  /** A version by its id, or a 400. */
  async versionById(id: unknown): Promise<VersionRow> {
    const { homeId, version } = splitVersionId(id);
    const row = await this.version(homeId, version);
    if (!row) throw new BadRequest(`no configuration version ${id}`);
    return row;
  }

  url(key: string): Promise<string> {
    return this.c.sign(new GetObjectCommand({ Bucket: BUCKET(), Key: key }), URL_TTL_S);
  }

  async text(key: string): Promise<string> {
    const obj = await this.c.s3.send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }));
    return obj.Body!.transformToString("utf-8");
  }

  async listOptions(home: string): Promise<OptionRow[]> {
    return (await this.options.list<OptionRow>()).filter((o) => o.homeId === home);
  }

  async option(id: unknown): Promise<OptionRow> {
    const { homeId } = splitOptionId(id);
    const row = await this.options.get<OptionRow>(String(id));
    if (!row || row.homeId !== homeId) throw new BadRequest(`no planning option ${id}`);
    return row;
  }

  // ---------------------------------------------------------------- writing

  private async putVersionObject(home: string, version: string, ttl: string): Promise<string> {
    const key = `configurations/versions/${home}/${version}-${token()}.ttl`;
    await this.c.s3.send(new PutObjectCommand({
      Bucket: BUCKET(), Key: key, Body: ttl, ContentType: "text/turtle", IfNoneMatch: "*",
    }));
    return key;
  }

  /**
   * Make `row` the live version in one transaction: put its row, and move
   * HEAD from `from` (null: HEAD must not exist yet). `extra` are more
   * conditional writes of the same transaction (closing the promoted option).
   */
  private async commitVersion(row: VersionRow, from: string | null, extra: any[] = []): Promise<boolean> {
    const now = row.at;
    const headWrite = from === null
      ? { Put: {
          TableName: VERSIONS(),
          Item: marshall({ homeId: row.homeId, version: HEAD, live: row.version, liveKey: row.s3Key, optionSeq: 0, updatedAt: now }),
          ConditionExpression: "attribute_not_exists(homeId)",
        } }
      : { Update: {
          TableName: VERSIONS(), Key: marshall({ homeId: row.homeId, version: HEAD }),
          UpdateExpression: "SET live = :v, liveKey = :k, updatedAt = :now",
          ConditionExpression: "live = :from",
          ExpressionAttributeValues: marshall({ ":v": row.version, ":k": row.s3Key, ":now": now, ":from": from }),
        } };
    try {
      await this.c.ddb.send(new TransactWriteItemsCommand({ TransactItems: [
        { Put: { TableName: VERSIONS(), Item: marshall(row, { removeUndefinedValues: true }), ConditionExpression: "attribute_not_exists(homeId)" } },
        headWrite,
        ...extra,
      ] }));
      return true;
    } catch (err) {
      if (err instanceof TransactionCanceledException) return false;
      throw err;
    }
  }

  /** A home's first configuration, 0001-0000: only while it has none. */
  async seedFirstLive(home: string, ttl: string, by: string): Promise<ChangeResult> {
    const check = checkConfiguration(ttl);
    if (!check.ok) return { status: "invalid", problems: check.problems };
    if (await this.head(home)) return { status: "conflict", live: (await this.head(home))!.live };
    const version = formatVersion({ major: 1, minor: 0 });
    const row: VersionRow = {
      homeId: home, version, id: versionId(home, version), kind: "first", s3Key: await this.putVersionObject(home, version, ttl),
      triples: check.triples, summary: summary([], parse(ttl)), at: new Date().toISOString(), by,
    };
    if (!(await this.commitVersion(row, null))) return { status: "conflict", live: (await this.head(home))?.live ?? null };
    return { status: "ok", id: row.id, version, summary: row.summary };
  }

  /** Components added to the live configuration: MMMM-mmmm+1 (the minor rule). */
  async addMinor(home: string, ttl: string, by: string, expectedLive?: string): Promise<ChangeResult> {
    const head = await this.head(home);
    if (!head) return { status: "invalid", problems: ["this home has no live configuration yet"] };
    if (expectedLive && expectedLive !== head.live) return { status: "conflict", live: head.live };
    const check = checkConfiguration(ttl);
    if (!check.ok) return { status: "invalid", problems: check.problems };
    const live = parse(await this.text(head.liveKey));
    const next = parse(ttl);
    const problems = minorProblems(live, next);
    if (problems.length) return { status: "invalid", problems };
    const cur = parseVersion(head.live);
    const version = formatVersion({ major: cur.major, minor: cur.minor + 1 });
    const row: VersionRow = {
      homeId: home, version, id: versionId(home, version), kind: "minor", s3Key: await this.putVersionObject(home, version, ttl),
      basedOn: versionId(home, head.live), triples: check.triples, summary: summary(live, next), at: new Date().toISOString(), by,
    };
    if (!(await this.commitVersion(row, head.live))) return { status: "conflict", live: (await this.head(home))?.live ?? null };
    return { status: "ok", id: row.id, version, summary: row.summary };
  }

  /** A new planning option, starting as a copy of `basedOn`. */
  async createOption(home: string, basedOn: string, label: string, by: string): Promise<OptionRow> {
    const base = await this.versionById(basedOn);
    if (base.homeId !== home) throw new BadRequest(`${basedOn} is not a version of this home`);
    const name = String(label ?? "").trim();
    if (!name || name.length > 80) throw new BadRequest("an option has a label of 1 to 80 characters");
    const seq = await this.c.ddb.send(new UpdateItemCommand({
      TableName: VERSIONS(), Key: marshall({ homeId: home, version: HEAD }),
      UpdateExpression: "ADD optionSeq :one", ConditionExpression: "attribute_exists(homeId)",
      ExpressionAttributeValues: marshall({ ":one": 1 }), ReturnValues: "UPDATED_NEW",
    }));
    const n = Number(unmarshall(seq.Attributes || {}).optionSeq);
    const id = optionId(home, n);
    const row = await this.options.ensure<OptionRow>(id, by);
    const now = new Date().toISOString();
    await this.c.ddb.send(new UpdateItemCommand({
      TableName: OPTIONS(), Key: marshall({ id }),
      UpdateExpression: "SET homeId = :h, basedOn = :b, label = :l, #s = :open, createdAt = :now, createdBy = :by",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: marshall({ ":h": home, ":b": base.id, ":l": name, ":open": "open", ":now": now, ":by": by }),
    }));
    const saved = await this.options.write(row, await this.text(base.s3Key), by, { trusted: true });
    if (saved.status !== "ok") throw new Error(`option ${id}: first save ${saved.status}`);
    return { ...row, homeId: home, basedOn: base.id, label: name, status: "open", version: saved.version, createdAt: now, createdBy: by };
  }

  /** Save an option's graph (the graph-store's check on the version read). */
  async saveOption(id: string, key: string, baseVersion: number, by: string): Promise<SaveResult> {
    const row = await this.option(id);
    if (row.status !== "open") throw new BadRequest(`${id} was promoted to ${row.promotedTo}; it is closed`);
    return this.options.commit(row, key, baseVersion, by);
  }

  /**
   * The option becomes the live configuration, MMMM+1-0000, with the minors
   * added since it was taken merged in. The live version it replaces becomes
   * legacy, and the option is closed.
   */
  async promote(id: string, by: string): Promise<ChangeResult> {
    const opt = await this.option(id);
    const home = opt.homeId!;
    if (opt.status !== "open") return { status: "invalid", problems: [`${id} was already promoted to ${opt.promotedTo}`] };
    if (!opt.version) return { status: "invalid", problems: [`${id} is empty`] };
    const head = await this.head(home);
    if (!head) return { status: "invalid", problems: ["this home has no live configuration"] };
    const base = await this.versionById(opt.basedOn);
    const live = parseVersion(head.live);
    if (parseVersion(base.version).major !== live.major) {
      return { status: "invalid", problems: [`${id} is based on ${base.version}, but ${head.live} is live: rebase it on the live version first`] };
    }
    const liveQuads = parse(await this.text(head.liveKey));
    const merged = union(parse(await this.options.read(opt)), additions(parse(await this.text(base.s3Key)), liveQuads));
    const ttl = await write(merged);
    const check = checkConfiguration(ttl);
    if (!check.ok) return { status: "invalid", problems: check.problems };
    const version = formatVersion({ major: live.major + 1, minor: 0 });
    const row: VersionRow = {
      homeId: home, version, id: versionId(home, version), kind: "major", s3Key: await this.putVersionObject(home, version, ttl),
      basedOn: base.id, fromOption: id, triples: check.triples, summary: summary(liveQuads, merged), at: new Date().toISOString(), by,
    };
    const close = { Update: {
      TableName: OPTIONS(), Key: marshall({ id }),
      UpdateExpression: "SET #s = :done, promotedTo = :to",
      ConditionExpression: "#s = :open AND version = :v",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: marshall({ ":done": "promoted", ":to": row.id, ":open": "open", ":v": opt.version }),
    } };
    if (!(await this.commitVersion(row, head.live, [close]))) return { status: "conflict", live: (await this.head(home))?.live ?? null };
    return { status: "ok", id: row.id, version, summary: row.summary };
  }
}

let configs = new HomeConfigs();
/** Tests only: run against fake clients. */
export const useClients = (clients?: Clients) => { configs = new HomeConfigs(clients); };
export const store = () => configs;
