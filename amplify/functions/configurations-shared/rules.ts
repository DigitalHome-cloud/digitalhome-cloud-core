// What a configuration version is and what a minor may be (darkfactory
// ADR 0018). Pure functions: ids, version numbers, the minor rule, and the
// additions a promote carries into an option. No AWS here.

import N3 from "n3";
import { BadRequest } from "../graph-store/errors";
import { HOME_ID } from "../home-id/home-id";

export { BadRequest };

export const DHC = "https://digitalhome.cloud/ontology#";
export const DHP = "https://digitalhome.cloud/pro#";
export const REC = "https://w3id.org/rec#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

export const MAX_GRAPH_BYTES = 2 * 1024 * 1024;
/** "0001-0000": the major and minor running numbers. */
export const VERSION = /^([0-9]{4})-([0-9]{4})$/;
/** "<homeId>-0001-0000" */
export const VERSION_ID = /^(h-[a-z2-9]{10})-([0-9]{4})-([0-9]{4})$/;
/** "<homeId>-p01" */
export const OPTION_ID = /^(h-[a-z2-9]{10})-p([0-9]{2,3})$/;

/** A board, its protection and the spaces are the structure: a minor never adds or changes them. */
export const STRUCTURAL = new Set([
  `${DHC}DistributionBoard`, `${DHC}RCD`, `${DHC}Circuit`, `${DHC}ProtectionDevice`,
  `${DHC}Contactor`, `${DHC}SurgeProtector`, `${DHP}UnidentifiedDevice`,
  `${REC}Space`, `${REC}Room`, `${REC}Level`, `${REC}Building`, `${REC}Architecture`,
]);

export function homeId(v: unknown): string {
  const id = String(v ?? "");
  if (!HOME_ID.test(id)) throw new BadRequest("homeId is h- and ten letters or digits");
  return id;
}

export interface Version { major: number; minor: number }

export function parseVersion(v: unknown): Version {
  const m = VERSION.exec(String(v ?? ""));
  if (!m) throw new BadRequest("a version is MMMM-mmmm, e.g. 0001-0000");
  return { major: Number(m[1]), minor: Number(m[2]) };
}

export const formatVersion = ({ major, minor }: Version): string => {
  if (major > 9999 || minor > 9999) throw new BadRequest("version numbers end at 9999");
  return `${String(major).padStart(4, "0")}-${String(minor).padStart(4, "0")}`;
};

export const versionId = (home: string, version: string) => `${home}-${version}`;

/** "<homeId>-0002-0001" → its home and version, or a 400. */
export function splitVersionId(id: unknown): { homeId: string; version: string } {
  const m = VERSION_ID.exec(String(id ?? ""));
  if (!m) throw new BadRequest("a configuration version id is <homeId>-MMMM-mmmm");
  return { homeId: m[1], version: `${m[2]}-${m[3]}` };
}

export function splitOptionId(id: unknown): { homeId: string; n: number } {
  const m = OPTION_ID.exec(String(id ?? ""));
  if (!m) throw new BadRequest("a planning option id is <homeId>-pNN");
  return { homeId: m[1], n: Number(m[2]) };
}

export const optionId = (home: string, n: number) => `${home}-p${String(n).padStart(2, "0")}`;

// ------------------------------------------------------------------ graphs

export type Quads = N3.Quad[];

export function parse(ttl: string): Quads {
  if (Buffer.byteLength(ttl, "utf8") > MAX_GRAPH_BYTES) throw new BadRequest("a configuration is at most 2 MB of Turtle");
  try {
    return new N3.Parser().parse(ttl);
  } catch (err) {
    throw new BadRequest(`not Turtle: ${(err as Error).message}`);
  }
}

export function write(quads: Quads): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = new N3.Writer({ prefixes: { dhc: DHC, dhp: DHP, rec: REC } });
    w.addQuads(quads);
    w.end((err, out) => (err ? reject(err) : resolve(out)));
  });
}

const key = (q: N3.Quad) => `${q.subject.id} ${q.predicate.id} ${q.object.id}`;
const index = (quads: Quads) => new Map(quads.map((q) => [key(q), q]));

/** A configuration is checked before it is kept: Turtle, not empty, not too big. */
export function checkConfiguration(ttl: string): { ok: boolean; problems: string[]; triples: number } {
  try {
    const quads = parse(ttl);
    if (!quads.length) return { ok: false, problems: ["the configuration is empty"], triples: 0 };
    if (quads.some((q) => q.subject.termType === "BlankNode")) {
      return { ok: false, problems: ["every node has an IRI (no blank nodes), so versions can be compared"], triples: quads.length };
    }
    return { ok: true, problems: [], triples: quads.length };
  } catch (err) {
    return { ok: false, problems: [(err as Error).message], triples: 0 };
  }
}

/**
 * May `next` follow `live` as a minor version? Nothing removed; every added
 * statement about a node `live` does not have; no new node of a structural
 * class. New nodes may point to existing ones.
 */
export function minorProblems(live: Quads, next: Quads): string[] {
  const before = index(live), after = index(next);
  const problems: string[] = [];
  const removed = [...before.keys()].filter((k) => !after.has(k));
  if (removed.length) problems.push(`${removed.length} statement(s) removed or changed`);
  const known = new Set(live.map((q) => q.subject.id));
  const added = [...after.values()].filter((q) => !before.has(key(q)));
  const onKnown = new Set(added.filter((q) => known.has(q.subject.id)).map((q) => q.subject.id));
  if (onKnown.size) problems.push(`${onKnown.size} existing node(s) changed`);
  const structural = new Set(added.filter((q) => q.predicate.id === RDF_TYPE && STRUCTURAL.has(q.object.id)).map((q) => q.subject.id));
  if (structural.size) problems.push(`${structural.size} new board, protection, circuit or space node(s)`);
  if (problems.length) return [...problems, "needs a planning option"];
  return added.length ? [] : ["nothing was added"];
}

/** What `later` has that `earlier` has not: the minors since an option was taken. */
export function additions(earlier: Quads, later: Quads): Quads {
  const before = index(earlier);
  return later.filter((q) => !before.has(key(q)));
}

/** The union of two graphs, each statement once. */
export function union(a: Quads, b: Quads): Quads {
  return [...index([...a, ...b]).values()];
}

/** One line for a version's history: "+3 nodes, −1 node, ~2 nodes". */
export function summary(before: Quads, after: Quads): string {
  const subjects = (qs: Quads) => {
    const m = new Map<string, Set<string>>();
    for (const q of qs) {
      if (!m.has(q.subject.id)) m.set(q.subject.id, new Set());
      m.get(q.subject.id)!.add(`${q.predicate.id} ${q.object.id}`);
    }
    return m;
  };
  const a = subjects(before), b = subjects(after);
  let added = 0, removed = 0, changed = 0;
  for (const s of b.keys()) if (!a.has(s)) added++;
  for (const [s, facts] of a) {
    const now = b.get(s);
    if (!now) removed++;
    else if (now.size !== facts.size || [...facts].some((f) => !now.has(f))) changed++;
  }
  const n = (k: number, what: string) => `${k} node${k === 1 ? "" : "s"}${what}`;
  const parts = [added && "+" + n(added, ""), removed && "−" + n(removed, ""), changed && "~" + n(changed, "")].filter(Boolean);
  return parts.join(", ") || "no change";
}
