// The one-time move from the DeviceModel table (the Portal's old Catalog) to
// the marketplace: every model becomes an article of the seller
// `digitalhome-cloud`, and the files found under its old asset folder
// (public/catalogue/devices/<type>/<model>/{img,docs,specs}/) are copied to
// public/market/digitalhome-cloud/sha256/ by content. Run by a dhc-admin from
// the Portal, once per environment. It can be run again: articles already in
// the catalogue are left as they are, so nothing typed since is overwritten.

import { createHash } from "node:crypto";
import N3 from "n3";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { FILE_EXT, articleIri, b64OfHex, fileKey } from "../market-shared/rules";
import { commit, graphUrl, stagingKeyFor, type Seller } from "../market-shared/store";

const ddb = new DynamoDBClient({});
const s3 = new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED" });
const BUCKET = () => process.env.STORAGE_BUCKET_NAME!;
const { namedNode, literal } = N3.DataFactory;
const DHP = "https://digitalhome.cloud/pro#";
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const LABEL = namedNode("http://www.w3.org/2000/01/rdf-schema#label");
const XSD_DECIMAL = namedNode("http://www.w3.org/2001/XMLSchema#decimal");
const p = (local: string) => namedNode(DHP + local);
const CATEGORIES = ["COMPUTING_IT", "CONTROLLERS_AUTOMATION", "FACILITIES_APPLIANCES", "MEDIA_COMMUNICATION", "SECURITY_MONITORING"];
const POWER = ["FIXED", "SOCKET", "BATTERY", "ACCU"];
const CAPABILITIES: Record<string, string> = {
  hasActorCapability: "actor", hasSensorCapability: "sensor", hasControllerCapability: "controller", hasIOTCapability: "iot",
};

export interface ImportReport {
  status: string;
  version?: number;
  models: number;
  added: number;
  kept: number;
  files: number;
  notes: string[];
  problems?: string[];
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/[\u0000-\u001f]+/g, " ").slice(0, max) : "");
const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;|]/) : []).map((x) => String(x).trim()).filter(Boolean);

/** One DeviceModel row as article statements; values the shapes would refuse are left out and noted. */
export function modelQuads(m: Record<string, unknown>, seller: string, notes: string[]): N3.Quad[] {
  const quads: N3.Quad[] = [];
  const ref = text(m.modelNumber, 80);
  if (!ref) return quads;
  const a = namedNode(articleIri(seller, ref));
  const add = (pred: N3.NamedNode, obj: N3.Term) => quads.push(N3.DataFactory.quad(a, pred, obj as any));
  add(RDF_TYPE, p("Article"));
  add(p("partner"), literal(seller));
  add(p("reference"), literal(ref));
  const label = text(m.description, 1000);
  if (label) add(LABEL, literal(label));
  for (const k of ["brand", "deviceType"]) if (text(m[k], 80)) add(p(k), literal(text(m[k], 80)));
  if (m.category) CATEGORIES.includes(String(m.category)) ? add(p("category"), literal(String(m.category)))
    : notes.push(`${ref}: category ${m.category} left out`);
  if (m.powerSource) POWER.includes(String(m.powerSource)) ? add(p("powerSource"), literal(String(m.powerSource)))
    : notes.push(`${ref}: power source ${m.powerSource} left out`);
  for (const k of ["voltageV", "currentA", "powerW"]) {
    const n = Number(m[k]);
    if (m[k] != null && Number.isFinite(n) && n >= 0) add(p(k), literal(String(n), XSD_DECIMAL));
  }
  for (const [flag, cap] of Object.entries(CAPABILITIES)) if (m[flag] === true) add(p("capability"), literal(cap));
  for (const r of list(m.region).map((x) => x.toUpperCase())) {
    const market = r === "EUROPE" ? "EU" : r;
    /^(EU|[A-Z]{2})$/.test(market) ? add(p("usableIn"), literal(market)) : notes.push(`${ref}: region “${r}” left out`);
  }
  for (const st of list(m.standards).slice(0, 20)) add(p("conformsTo"), literal(st.slice(0, 80)));
  for (const c of list(m.compatibleClasses).slice(0, 20)) add(p("compatibleClass"), literal(c.slice(0, 120)));
  return quads;
}

/** Copy one old asset by content; returns "<sha256>.<ext>" or null. */
async function copyFile(key: string, notes: string[]): Promise<string | null> {
  const ext = (key.split(".").pop() || "").toLowerCase();
  if (!FILE_EXT[ext]) return null;
  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }));
  const body = Buffer.from(await obj.Body!.transformToByteArray());
  if (body.length === 0 || body.length > 25 * 1024 * 1024) {
    notes.push(`${key}: skipped (size ${body.length} bytes)`);
    return null;
  }
  const sha = createHash("sha256").update(body).digest("hex");
  const dest = fileKey("digitalhome-cloud", sha, ext === "jpeg" ? "jpg" : ext);
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET(), Key: dest }));
  } catch {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET(), Key: dest, Body: body, ContentType: FILE_EXT[ext], ChecksumSHA256: b64OfHex(sha),
      CacheControl: "public, max-age=31536000, immutable",
    }));
  }
  return dest.split("/").pop()!;
}

async function oldFiles(deviceType: string, modelNumber: string): Promise<string[]> {
  const res = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET(), Prefix: `public/catalogue/devices/${deviceType}/${modelNumber}/`, MaxKeys: 50,
  }));
  return (res.Contents || []).map((o) => o.Key!).filter(Boolean).sort();
}

export async function importDeviceModels(seller: Seller, by: string): Promise<ImportReport> {
  const notes: string[] = [];
  const quads: N3.Quad[] = [];
  // what the catalogue already holds
  let existing: N3.Quad[] = [];
  const url = await graphUrl(seller);
  if (url) existing = new N3.Parser().parse(await (await fetch(url)).text());
  const have = new Set(existing.map((q) => q.subject.value));

  const rows: Record<string, unknown>[] = [];
  let start: Record<string, any> | undefined;
  do {
    const res = await ddb.send(new ScanCommand({ TableName: process.env.DEVICEMODEL_TABLE_NAME!, ExclusiveStartKey: start }));
    (res.Items || []).forEach((i) => rows.push(unmarshall(i)));
    start = res.LastEvaluatedKey;
  } while (start);

  let added = 0, files = 0;
  for (const m of rows) {
    const ref = text(m.modelNumber, 80);
    if (!ref) continue;
    const a = namedNode(articleIri(seller.id, ref));
    if (have.has(a.value)) continue;
    quads.push(...modelQuads(m, seller.id, notes));
    const add = (pred: N3.NamedNode, obj: N3.Term) => quads.push(N3.DataFactory.quad(a, pred, obj as any));
    const deviceType = String(m.deviceType ?? "");
    let images = 0, sheets = 0;
    for (const key of deviceType ? await oldFiles(deviceType, ref) : []) {
      const isImage = /\/img\/[^/]+\.(jpe?g|png|webp)$/i.test(key);
      const isSheet = /\/(docs|specs)\/[^/]+\.pdf$/i.test(key);
      if (!(isImage && images < 10) && !(isSheet && sheets < 10)) continue;
      const name = await copyFile(key, notes);
      if (!name) continue;
      add(p(isImage ? "image" : "datasheet"), literal(name));
      isImage ? images++ : sheets++;
      files++;
    }
    added++;
  }
  if (!added) return { status: "ok", version: seller.version, models: rows.length, added: 0, kept: have.size, files, notes };

  const writer = new N3.Writer({ prefixes: { dhp: DHP, rdfs: "http://www.w3.org/2000/01/rdf-schema#" } });
  writer.addQuads([...existing, ...quads]);
  const ttl: string = await new Promise((ok, fail) => writer.end((err: unknown, out: string) => (err ? fail(err) : ok(out))));
  const key = stagingKeyFor(seller.id);
  await s3.send(new PutObjectCommand({ Bucket: BUCKET(), Key: key, Body: ttl, ContentType: "text/turtle" }));
  const r = await commit(seller, key, seller.version, by);
  if (r.status === "invalid") return { status: "invalid", models: rows.length, added: 0, kept: have.size, files, notes, problems: r.problems };
  if (r.status === "conflict") return { status: "conflict", models: rows.length, added: 0, kept: have.size, files, notes };
  return { status: "ok", version: r.version, models: rows.length, added, kept: have.size, files, notes: notes.slice(0, 100) };
}
