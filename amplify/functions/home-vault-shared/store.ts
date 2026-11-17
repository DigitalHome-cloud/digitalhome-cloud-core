// A home's vault (darkfactory ADR 0019): photos, documents, videos and other
// files, kept once per fingerprint, each tagged with the configuration
// versions (and planning options) it documents, one or several. What is taken from the
// Mediathek: write-once originals by SHA-256, a dry run before the upload,
// thumbnails made on the edge, originals of documents downloaded as an
// attachment, nothing over 5 GB.
//
//   HomeVaultItems (homeId, sha256)   kind, name, size, contentType, takenAt,
//                                     caption, tags (version and option ids),
//                                     uploadedBy/At, thumb; configVersion is
//                                     the single tag of older rows, read as one
//   S3 tenant/{homeId}/vault/originals/sha256/<hash>.<ext>   written once
//      tenant/{homeId}/vault/derived/<hash>/thumb.webp       a photo's thumbnail
//
// tenant/ is granted to no Cognito role; only the vault Lambdas sign for it.

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  ConditionalCheckFailedException, GetItemCommand, PutItemCommand, QueryCommand, UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { awsClients, type Clients } from "../graph-store/store";
import { BadRequest, OPTION_ID, VERSION_ID } from "../configurations-shared/rules";

const TABLE = () => process.env.HOME_VAULT_TABLE_NAME!;
const BUCKET = () => process.env.STORAGE_BUCKET_NAME!;
const URL_TTL_S = 300;
export const MAX_BYTES = 5 * 1024 ** 3;              // one PUT
const SHA256 = /^[0-9a-f]{64}$/;

const KINDS: Record<string, string[]> = {
  photo: ["jpg", "jpeg", "png", "webp", "heic", "heif", "gif", "tif", "tiff"],
  video: ["mp4", "mov", "m4v", "avi", "mkv", "webm", "3gp"],
  document: ["pdf", "doc", "docx", "odt", "rtf", "txt", "md", "csv", "xls", "xlsx", "ods", "ppt", "pptx", "odp", "dwg", "dxf"],
};
const INLINE = new Set(["jpg", "jpeg", "png", "webp", "gif"]);   // shown in the page; all else is downloaded

export function extOf(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name);
  return m ? m[1].toLowerCase() : "bin";
}

export const kindOf = (name: string) =>
  Object.entries(KINDS).find(([, exts]) => exts.includes(extOf(name)))?.[0] ?? "other";

export interface VaultItem {
  homeId: string; sha256: string; kind: string; name: string; size: number; contentType: string;
  takenAt?: string; caption?: string; configVersion?: string; tags?: string[]; thumb?: boolean;
  uploadedAt: string; uploadedBy: string;
}

const MAX_TAGS = 20;
// what a survey photo shows: never an address, only ids and short words
export const SUBJECT_TAG = /^(survey|item:[a-z][a-z0-9-]{2,60}|kind:[a-z_]{2,20}|room:[\p{L}\p{N} ._'-]{1,40})$/u;

/** An item's tags: its tags, and the single configVersion of an older row. */
export const tagsOf = (i: { tags?: string[]; configVersion?: string }) =>
  [...new Set([...(i.configVersion ? [i.configVersion] : []), ...(i.tags ?? [])])].sort();

export interface FileOffer {
  sha256: string; size: number; name: string; contentType?: string;
  takenAt?: string; caption?: string; configVersion?: string; thumb?: boolean;
}

const original = (home: string, sha: string, name: string) => `tenant/${home}/vault/originals/sha256/${sha}.${extOf(name)}`;
const thumbKey = (home: string, sha: string) => `tenant/${home}/vault/derived/${sha}/thumb.webp`;

function offer(f: FileOffer): FileOffer {
  const sha256 = String(f?.sha256 ?? "").toLowerCase();
  if (!SHA256.test(sha256)) throw new BadRequest("sha256 is the file's SHA-256 in hex");
  const name = String(f.name ?? "").trim().replace(/[\\/]/g, "_");
  if (!name || name.length > 200) throw new BadRequest("a file has a name of 1 to 200 characters");
  const size = Number(f.size);
  if (!Number.isInteger(size) || size < 0) throw new BadRequest("size is the file's length in bytes");
  return { ...f, sha256, name, size };
}

export class HomeVault {
  constructor(private readonly clients?: Clients) {}

  private get c(): Clients {
    return this.clients ?? awsClients();
  }

  /** A group must be a version or an option of this home (or none). */
  /** A tag: a version or option of this home, or what a survey photo shows
   *  (survey, item:<id>, kind:<word>, room:<name>; ADR 0018 point 10). */
  label(home: string, v: unknown): string | undefined {
    const g = String(v ?? "").trim();
    if (SUBJECT_TAG.test(g)) return g;
    return this.group(home, g);
  }

  group(home: string, v: unknown): string | undefined {
    const g = String(v ?? "").trim();
    if (!g) return undefined;
    const m = VERSION_ID.exec(g) ?? OPTION_ID.exec(g);
    if (!m || m[1] !== home) throw new BadRequest(`${g} is not a configuration version or option of this home`);
    return g;
  }

  /** The items; with `tag`, those that carry it. Every item comes with its tags. */
  async items(home: string, tag?: string): Promise<Array<VaultItem & { tags: string[]; thumbUrl: string | null }>> {
    const rows: VaultItem[] = [];
    let start: Record<string, any> | undefined;
    do {
      const res = await this.c.ddb.send(new QueryCommand({
        TableName: TABLE(), KeyConditionExpression: "homeId = :h",
        ExpressionAttributeValues: marshall({ ":h": home }), ExclusiveStartKey: start,
      }));
      (res.Items || []).forEach((i: any) => { const r = unmarshall(i) as VaultItem; rows.push({ ...r, tags: tagsOf(r) }); });
      start = res.LastEvaluatedKey;
    } while (start);
    const want = tag ? this.label(home, tag) : undefined;
    const shown = rows
      .filter((r) => !want || r.tags!.includes(want))
      .sort((a, b) => (a.tags![0] ?? "").localeCompare(b.tags![0] ?? "") || (a.takenAt ?? a.uploadedAt).localeCompare(b.takenAt ?? b.uploadedAt));
    return Promise.all(shown.map(async (r) => ({
      ...r, tags: r.tags!,
      thumbUrl: r.thumb ? await this.c.sign(new GetObjectCommand({ Bucket: BUCKET(), Key: thumbKey(home, r.sha256) }), URL_TTL_S) : null,
    })));
  }

  async item(home: string, sha256: string): Promise<VaultItem | null> {
    const got = await this.c.ddb.send(new GetItemCommand({ TableName: TABLE(), Key: marshall({ homeId: home, sha256: String(sha256).toLowerCase() }) }));
    return got.Item ? (unmarshall(got.Item) as VaultItem) : null;
  }

  /**
   * The dry run, and the upload links: for each file, "known" (the vault has
   * it), "too_large", or "new" with a presigned PUT for the original (sent with
   * If-None-Match: *, so nothing is ever overwritten) and, for a photo whose
   * edge made one, for its thumbnail. dryRun: the statuses only.
   */
  async upload(home: string, files: FileOffer[], dryRun: boolean) {
    if (!Array.isArray(files) || !files.length || files.length > 100) throw new BadRequest("files: 1 to 100 files");
    const out = [];
    for (const raw of files) {
      const f = offer(raw);
      if (await this.item(home, f.sha256)) { out.push({ sha256: f.sha256, name: f.name, status: "known" }); continue; }
      if (f.size > MAX_BYTES) { out.push({ sha256: f.sha256, name: f.name, status: "too_large" }); continue; }
      if (dryRun) { out.push({ sha256: f.sha256, name: f.name, status: "new", kind: kindOf(f.name) }); continue; }
      const contentType = String(f.contentType || "application/octet-stream");
      const put = await this.c.sign(new PutObjectCommand({
        Bucket: BUCKET(), Key: original(home, f.sha256, f.name), ContentType: contentType, IfNoneMatch: "*",
      }), URL_TTL_S);
      const thumb = kindOf(f.name) === "photo" && f.thumb
        ? await this.c.sign(new PutObjectCommand({ Bucket: BUCKET(), Key: thumbKey(home, f.sha256), ContentType: "image/webp" }), URL_TTL_S)
        : null;
      out.push({
        sha256: f.sha256, name: f.name, status: "new", kind: kindOf(f.name),
        url: put, headers: { "Content-Type": contentType, "If-None-Match": "*" },
        thumbUrl: thumb, thumbHeaders: thumb ? { "Content-Type": "image/webp" } : null,
      });
    }
    return { files: out };
  }

  /** After the PUT: the catalogue row, once the original is really there. */
  async commit(home: string, raw: FileOffer, by: string): Promise<{ status: "ok" | "known"; item: VaultItem }> {
    const f = offer(raw);
    const known = await this.item(home, f.sha256);
    if (known) return { status: "known", item: known };
    const key = original(home, f.sha256, f.name);
    let size: number;
    try {
      size = Number((await this.c.s3.send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }))).ContentLength);
    } catch {
      throw new BadRequest(`nothing was uploaded for ${f.name}`);
    }
    if (size !== f.size) throw new BadRequest(`${f.name}: ${size} bytes arrived, ${f.size} were announced`);
    let thumb = false;
    if (f.thumb && kindOf(f.name) === "photo") {
      thumb = await this.c.s3.send(new HeadObjectCommand({ Bucket: BUCKET(), Key: thumbKey(home, f.sha256) })).then(() => true, () => false);
    }
    const item: VaultItem = {
      homeId: home, sha256: f.sha256, kind: kindOf(f.name), name: f.name, size, contentType: String(f.contentType || "application/octet-stream"),
      ...(f.takenAt ? { takenAt: String(f.takenAt) } : {}),
      ...(f.caption ? { caption: String(f.caption).slice(0, 500) } : {}),
      ...(this.group(home, f.configVersion) ? { tags: [this.group(home, f.configVersion)!] } : {}),
      thumb, uploadedAt: new Date().toISOString(), uploadedBy: by,
    };
    try {
      await this.c.ddb.send(new PutItemCommand({ TableName: TABLE(), Item: marshall(item), ConditionExpression: "attribute_not_exists(homeId)" }));
    } catch (err) {
      if (!(err instanceof ConditionalCheckFailedException)) throw err;
      return { status: "known", item: (await this.item(home, f.sha256))! };
    }
    return { status: "ok", item };
  }

  /** A 5-minute link to the original: shown for a common photo, downloaded for everything else. */
  async url(home: string, sha256: string): Promise<string> {
    const it = await this.item(home, sha256);
    if (!it) throw new BadRequest(`no item ${sha256} in this vault`);
    const inline = INLINE.has(extOf(it.name));
    return this.c.sign(new GetObjectCommand({
      Bucket: BUCKET(), Key: original(home, it.sha256, it.name),
      ResponseContentType: it.contentType,
      ResponseContentDisposition: `${inline ? "inline" : "attachment"}; filename="${it.name.replace(/[^\x20-\x7e]|"/g, "_")}"`,
    }), URL_TTL_S);
  }

  private async writeTags(home: string, sha256: string, tags: string[]): Promise<VaultItem & { tags: string[] }> {
    const key = marshall({ homeId: home, sha256: String(sha256).toLowerCase() });
    await this.c.ddb.send(new UpdateItemCommand({
      TableName: TABLE(), Key: key, ConditionExpression: "attribute_exists(homeId)",
      ...(tags.length
        ? { UpdateExpression: "SET tags = :t REMOVE configVersion", ExpressionAttributeValues: marshall({ ":t": tags }) }
        : { UpdateExpression: "REMOVE tags, configVersion" }),
    }));
    const it = (await this.item(home, sha256))!;
    return { ...it, tags: tagsOf(it) };
  }

  /** Replace an item's tags by one (or none): "file it under". */
  async setGroup(home: string, sha256: string, configVersion: unknown): Promise<VaultItem & { tags: string[] }> {
    const g = this.group(home, configVersion);
    if (!(await this.item(home, sha256))) throw new BadRequest(`no item ${sha256} in this vault`);
    return this.writeTags(home, sha256, g ? [g] : []);
  }

  /**
   * Add and remove tags on several items at once (a multiple selection).
   * Each tag is a version or an option of this home, or a survey subject.
   */
  async tag(home: string, sha256s: unknown, add: unknown = [], remove: unknown = []): Promise<Array<{ sha256: string; tags: string[] }>> {
    const list = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x));
    const shas = [...new Set(list(sha256s).map((s) => s.toLowerCase()))];
    if (!shas.length || shas.length > 500) throw new BadRequest("sha256s: 1 to 500 items");
    const plus = list(add).map((t) => this.label(home, t)!).filter(Boolean);
    const minus = new Set(list(remove).map((t) => this.label(home, t)!).filter(Boolean));
    if (!plus.length && !minus.size) throw new BadRequest("say which tags to add or remove");
    const out = [];
    for (const sha of shas) {
      const it = await this.item(home, sha);
      if (!it) throw new BadRequest(`no item ${sha} in this vault`);
      const next = [...new Set([...tagsOf(it), ...plus])].filter((t) => !minus.has(t)).sort();
      if (next.length > MAX_TAGS) throw new BadRequest(`an item has at most ${MAX_TAGS} tags`);
      out.push({ sha256: sha, tags: (await this.writeTags(home, sha, next)).tags });
    }
    return out;
  }

  /** When an option is promoted, what is tagged with it is tagged with the new version instead. */
  async regroup(home: string, from: string, to: string): Promise<number> {
    const items = (await this.items(home)).filter((i) => i.tags.includes(from));
    for (const it of items) await this.tag(home, [it.sha256], [to], [from]);
    return items.length;
  }
}

let vault = new HomeVault();
/** Tests only. */
export const useClients = (clients?: Clients) => { vault = new HomeVault(clients); };
export const homeVault = () => vault;
