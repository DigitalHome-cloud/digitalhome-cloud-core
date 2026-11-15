// A seller's articles as JSON, for the Portal: read them, and edit one by
// sending the article as it was read and as it should be. The difference is
// applied to the CURRENT catalogue — a three-way merge at the level of one
// article — so a change someone else made meanwhile to another fact survives.
// Two values for a single fact is a conflict, as on the edges.

import N3 from "n3";
import { articleIri } from "./rules";

const DHP = "https://digitalhome.cloud/pro#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const XSD_DECIMAL = "http://www.w3.org/2001/XMLSchema#decimal";
const NORM = "https://digitalhome.cloud/ontology#";
const { namedNode, literal, quad } = N3.DataFactory;

/** One value each. */
export const SINGLE = ["label", "brand", "deviceType", "category", "powerSource", "voltageV", "currentA", "powerW", "ean", "etimClass"] as const;
/** Any number of values. approvedFor holds norm names, e.g. "Norm_NFC15100". */
export const LISTS = ["capability", "usableIn", "approvedFor", "conformsTo", "compatibleClass", "image", "datasheet"] as const;
const NUMBERS = new Set(["voltageV", "currentA", "powerW"]);

export type Article = { reference: string } & Partial<Record<(typeof SINGLE)[number], string | number>>
  & Partial<Record<(typeof LISTS)[number], string[]>>;

const pred = (k: string) => (k === "label" ? LABEL : DHP + k);
const keyOf = (iri: string) => (iri === LABEL ? "label" : iri.startsWith(DHP) ? iri.slice(DHP.length) : null);

export function parse(ttl: string): N3.Quad[] {
  return ttl.trim() ? new N3.Parser().parse(ttl) : [];
}

export async function write(quads: N3.Quad[]): Promise<string> {
  const w = new N3.Writer({ prefixes: { dhp: DHP, rdfs: "http://www.w3.org/2000/01/rdf-schema#", dhc: NORM } });
  w.addQuads(quads);
  return new Promise((ok, fail) => w.end((err: unknown, out: string) => (err ? fail(err) : ok(out))));
}

/** The plain-label/dhp facts of one subject as an Article. Language-tagged labels are left to the edges. */
export function toArticle(quads: N3.Quad[]): Article | null {
  const ref = quads.find((q) => q.predicate.value === DHP + "reference")?.object.value;
  if (!ref) return null;
  const a: Record<string, unknown> = { reference: ref };
  for (const q of quads) {
    const k = keyOf(q.predicate.value);
    if (!k || k === "reference" || k === "partner") continue;
    if (k === "label" && (q.object as N3.Literal).language) continue;
    const v = k === "approvedFor" ? q.object.value.replace(NORM, "") : NUMBERS.has(k) ? Number(q.object.value) : q.object.value;
    if ((LISTS as readonly string[]).includes(k)) ((a[k] ??= []) as unknown[]).push(v);
    else if ((SINGLE as readonly string[]).includes(k)) a[k] = a[k] === undefined ? v : a[k];
  }
  for (const k of LISTS) if (Array.isArray(a[k])) (a[k] as string[]).sort();
  return a as Article;
}

/** Facts as comparable "key\u0000value" strings. */
export function facts(a: Article | null): Set<string> {
  const out = new Set<string>();
  if (!a) return out;
  for (const k of SINGLE) {
    const v = a[k];
    if (v !== undefined && v !== null && v !== "") out.add(`${k}\u0000${NUMBERS.has(k) ? Number(v) : String(v).trim()}`);
  }
  for (const k of LISTS) for (const v of a[k] || []) if (String(v).trim()) out.add(`${k}\u0000${String(v).trim()}`);
  return out;
}

function quadsOf(seller: string, reference: string, fs: Set<string>): N3.Quad[] {
  const s = namedNode(articleIri(seller, reference));
  const out = [
    quad(s, namedNode(RDF_TYPE), namedNode(DHP + "Article")),
    quad(s, namedNode(DHP + "partner"), literal(seller)),
    quad(s, namedNode(DHP + "reference"), literal(reference)),
  ];
  for (const f of fs) {
    const [k, v] = f.split("\u0000");
    const o = k === "approvedFor" ? namedNode(NORM + v) : NUMBERS.has(k) ? literal(v, namedNode(XSD_DECIMAL)) : literal(v);
    out.push(quad(s, namedNode(pred(k)), o as any));
  }
  return out;
}

export interface Conflict { property: string; mine: string[]; theirs: string[] }
export type Edit =
  | { status: "ok"; quads: N3.Quad[]; article: Article | null }
  | { status: "conflict"; conflicts: Conflict[]; message?: string };

/**
 * Apply one article's change (before → after; after null deletes it; before
 * null creates it) to the current catalogue's statements.
 */
export function applyEdit(seller: string, current: N3.Quad[], reference: string,
                          before: Article | null, after: Article | null): Edit {
  const ref = String(reference ?? "").trim();
  if (!ref) return { status: "conflict", conflicts: [], message: "an article needs a reference" };
  const iri = articleIri(seller, ref);
  const mine = current.filter((q) => q.subject.value === iri);
  const rest = current.filter((q) => q.subject.value !== iri);
  const now = mine.length ? toArticle(mine) : null;
  if (before && !now) return { status: "conflict", conflicts: [], message: `${ref} was removed meanwhile` };
  if (!before && now && after) return { status: "conflict", conflicts: [], message: `there is an article ${ref} already` };
  if (!after) return { status: "ok", quads: rest, article: null };

  const b = facts(before), a = facts(after), c = facts(now);
  const merged = new Set([...c].filter((f) => !(b.has(f) && !a.has(f))));
  for (const f of a) if (!b.has(f)) merged.add(f);
  const conflicts: Conflict[] = [];
  for (const k of SINGLE) {
    const vals = [...merged].filter((f) => f.startsWith(k + "\u0000")).map((f) => f.split("\u0000")[1]);
    if (vals.length > 1) {
      const mineV = [...a].filter((f) => f.startsWith(k + "\u0000")).map((f) => f.split("\u0000")[1]);
      conflicts.push({ property: k, mine: mineV, theirs: vals.filter((v) => !mineV.includes(v)) });
    }
  }
  if (conflicts.length) return { status: "conflict", conflicts };
  // language-tagged labels are not edited here: keep them
  const kept = mine.filter((q) => q.predicate.value === LABEL && (q.object as N3.Literal).language);
  const next = [...quadsOf(seller, ref, merged), ...kept];
  return { status: "ok", quads: [...rest, ...next], article: toArticle(next) };
}

/** Every article of a catalogue, grouped by subject. */
export function articles(quads: N3.Quad[]): Article[] {
  const by = new Map<string, N3.Quad[]>();
  for (const q of quads) (by.get(q.subject.value) ?? by.set(q.subject.value, []).get(q.subject.value)!).push(q);
  return [...by.values()].map(toArticle).filter((a): a is Article => !!a)
    .sort((x, y) => String(x.brand ?? "").localeCompare(String(y.brand ?? "")) || x.reference.localeCompare(y.reference));
}
