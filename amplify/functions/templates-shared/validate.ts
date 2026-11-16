// A norm edition's template graph, checked before it is saved: Turtle, only
// that edition's templates and their parts, the template shapes
// (schema/templates), and the edition's own effective norm shapes — its
// dhc:shapesFile plus every file down dhc:supersedes, as js-tools/build-abox
// computes them. A template that breaks its edition is refused.

import N3 from "n3";
import rdf from "@zazuko/env-node";
import SHACLValidator from "rdf-validate-shacl";
import { NORM_SHAPES, TBOX, TEMPLATE_SHAPES } from "./templates.generated";
import { DHC, DHT, ID_BASE, MAX_GRAPH_BYTES, PART_ID, editionIdOf, editionIri, editionPrefix } from "./rules";
import type { Verdict } from "../graph-store/store";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const TEMPLATE = `${DHT}BoardTemplate`;
const PART_TYPES = new Set([`${DHC}RCD`, `${DHC}Circuit`]);

export interface Edition { id: string; iri: string; norm: string; label: string; supersedes: string | null; latest: boolean }

let tbox: N3.Quad[] | undefined;
let editionsCache: Edition[] | undefined;
const shapesCache = new Map<string, ReturnType<typeof rdf.dataset>>();

const tboxQuads = () => (tbox ??= new N3.Parser().parse(TBOX));
const one = (s: string, p: string) => tboxQuads().find((q) => q.subject.value === s && q.predicate.value === p)?.object;

/** The editions templates can be kept for: every dhc:NormEdition that has shapes. */
export function editions(): Edition[] {
  if (editionsCache) return editionsCache;
  const latest = new Set(tboxQuads().filter((q) => q.predicate.value === `${DHC}latestEdition`).map((q) => q.object.value));
  editionsCache = tboxQuads()
    .filter((q) => q.predicate.value === `${DHC}shapesFile`)
    .map((q) => q.subject.value)
    .flatMap((iri) => {
      const id = editionIdOf(iri);
      if (!id) return [];
      const label = tboxQuads().find((q) => q.subject.value === iri && q.predicate.value === "http://www.w3.org/2000/01/rdf-schema#label"
        && (q.object as N3.Literal).language === "en")?.object.value ?? id;
      const sup = one(iri, `${DHC}supersedes`)?.value;
      return [{ id, iri, norm: one(iri, `${DHC}editionOf`)?.value ?? "", label,
        supersedes: sup ? editionIdOf(sup) : null, latest: latest.has(iri) }];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return editionsCache;
}

export const editionOf = (id: string): Edition | undefined => editions().find((e) => e.id === id);

/** The edition's own shapes plus every file down dhc:supersedes. */
export function effectiveShapes(edition: Edition): ReturnType<typeof rdf.dataset> {
  const cached = shapesCache.get(edition.id);
  if (cached) return cached;
  const d = rdf.dataset();
  const seen = new Set<string>();
  for (let e: string | undefined = edition.iri; e && !seen.has(e); e = one(e, `${DHC}supersedes`)?.value) {
    seen.add(e);
    const file = one(e, `${DHC}shapesFile`)?.value;
    if (!file) continue;
    const ttl = NORM_SHAPES[file];
    if (ttl === undefined) throw new Error(`${e} names ${file}, which is not bundled (run scripts/sync-template-shapes.mjs)`);
    d.addAll(new N3.Parser().parse(ttl));
  }
  shapesCache.set(edition.id, d);
  return d;
}

let templateShapes: ReturnType<typeof rdf.dataset> | undefined;

const XSD_DECIMAL = "http://www.w3.org/2001/XMLSchema#decimal";

/**
 * A decimal in its shortest text: 32.0 → "32", 2.50 → "2.5". The norm shapes'
 * guards use sh:hasValue "32"^^xsd:decimal, which compares RDF TERMS, so the
 * Turtle shorthand 32.0 would never match and the rule would silently not
 * run (core CLAUDE.md, the guard-literal trap). Only the data the validator
 * sees is changed; the graph is stored as written.
 */
function canonicalDecimals(quads: N3.Quad[]): N3.Quad[] {
  return quads.map((q) => {
    const o = q.object;
    if (o.termType !== "Literal" || o.datatype.value !== XSD_DECIMAL || !/^[+-]?\d*\.?\d+$/.test(o.value)) return q;
    let v = o.value.replace(/^\+/, "");
    if (v.includes(".")) v = v.replace(/0+$/, "").replace(/\.$/, "");
    v = v.replace(/^(-?)0+(?=\d)/, "$1").replace(/^(-?)\./, "$10.");
    if (v === "-0") v = "0";
    return v === o.value ? q : N3.DataFactory.quad(q.subject, q.predicate, N3.DataFactory.literal(v, o.datatype), q.graph);
  });
}

async function shacl(shapes: ReturnType<typeof rdf.dataset>, quads: N3.Quad[]) {
  const data = rdf.dataset();
  data.addAll(tboxQuads());                 // the type facts (dhc:Norm_NFC15100 a dhc:Norm …) the shapes look up
  data.addAll(canonicalDecimals(quads));
  return new SHACLValidator(shapes, { factory: rdf as any }).validate(data);
}

/** The template a subject belongs to: <prefix><template> or <prefix><template>/<part>. */
function ownerOf(iri: string, prefix: string): { template: string; part: string | null } | null {
  if (!iri.startsWith(prefix)) return null;
  const [template, part, ...rest] = iri.slice(prefix.length).split("/");
  if (rest.length || !PART_ID.test(template) || (part !== undefined && !PART_ID.test(part))) return null;
  return { template: prefix + template, part: part ?? null };
}

export async function validateTemplates(ttl: string, edition: string): Promise<Verdict> {
  const bad = (problems: string[], triples = 0): Verdict => ({ ok: false, problems: problems.slice(0, 50), triples });
  const ed = editionOf(edition);
  if (!ed) return bad([`${edition} is not an edition with norm shapes (one of ${editions().map((e) => e.id).join(", ")})`]);
  if (Buffer.byteLength(ttl, "utf8") > MAX_GRAPH_BYTES) return bad([`a template graph is at most ${MAX_GRAPH_BYTES / 1024 / 1024} MB`]);
  let quads: N3.Quad[];
  try {
    quads = new N3.Parser().parse(ttl);
  } catch (err) {
    return bad([`not valid Turtle: ${(err as Error).message}`]);
  }
  const prefix = editionPrefix(edition);
  const problems: string[] = [];
  const templates = new Set(quads.filter((q) => q.predicate.value === RDF_TYPE && q.object.value === TEMPLATE).map((q) => q.subject.value));
  const linked = new Set(quads.filter((q) => q.predicate.value === `${DHT}hasRCD` || q.predicate.value === `${DHT}hasCircuit`)
    .map((q) => `${q.subject.value} ${q.object.value}`));

  for (const q of quads) {
    const s = q.subject;
    const owner = s.termType === "NamedNode" ? ownerOf(s.value, prefix) : null;
    if (!owner) { problems.push(`${s.value}: a ${edition} template graph only describes ${prefix}<template>[/<part>]`); continue; }
    if (!templates.has(owner.template)) { problems.push(`${s.value}: its template ${owner.template} is not a dht:BoardTemplate here`); continue; }
    if (q.object.termType === "NamedNode" && q.object.value.startsWith(ID_BASE)) {
      const to = ownerOf(q.object.value, prefix);
      if (!to || to.template !== owner.template) problems.push(`${s.value}: points at ${q.object.value}, outside its own template`);
    }
    if (q.predicate.value === RDF_TYPE) {
      const ok = owner.part === null ? q.object.value === TEMPLATE : PART_TYPES.has(q.object.value);
      if (!ok) problems.push(`${s.value}: may not be a ${q.object.value}`);
    }
  }
  const parts = new Set(quads.map((q) => q.subject.value).filter((s) => ownerOf(s, prefix)?.part));
  for (const p of parts) {
    const t = ownerOf(p, prefix)!.template;
    if (!linked.has(`${t} ${p}`)) problems.push(`${p}: not listed by its template (dht:hasRCD / dht:hasCircuit)`);
  }
  for (const t of templates) {
    const forEd = quads.filter((q) => q.subject.value === t && q.predicate.value === `${DHT}forEdition`).map((q) => q.object.value);
    if (forEd.some((e) => e !== ed.iri)) problems.push(`${t}: is in the ${edition} graph, so it is for ${ed.iri}`);
  }
  const wrongNorm = quads.find((q) => q.predicate.value === `${DHC}governedBy` && q.object.value !== ed.norm);
  if (wrongNorm) problems.push(`${wrongNorm.subject.value}: a ${edition} circuit is governed by ${ed.norm}`);
  if (problems.length) return bad([...new Set(problems)], quads.length);

  templateShapes ??= (() => { const d = rdf.dataset(); d.addAll(new N3.Parser().parse(TEMPLATE_SHAPES)); return d; })();
  const short = (iri: string) => iri.startsWith(prefix) ? iri.slice(prefix.length) : iri.replace(DHC, "dhc:").replace(DHT, "dht:");
  const english = (r: any) => (r.message || []).find((m: any) => m.language === "en")?.value ?? r.message?.[0]?.value;
  const wellFormed = await shacl(templateShapes, quads);
  if (!wellFormed.conforms) {
    return bad([...new Set(wellFormed.results.map((r: any) => {
      const where = short(r.focusNode?.value ?? "?");
      const what = english(r) ?? "invalid";
      return r.path?.value ? `${where}: ${what} (${short(r.path.value)})` : `${where}: ${what}`;
    }))] as string[], quads.length);
  }
  const norm = await shacl(effectiveShapes(ed), quads);
  if (!norm.conforms) {
    return bad([...new Set(norm.results.map((r: any) => {
      const where = short(r.focusNode?.value ?? "?");
      const shape = r.sourceShape?.termType === "NamedNode" ? r.sourceShape.value.replace(/^.*[#/]/, "") : null;
      const what = english(r) ?? (shape ? `breaks ${shape}` : "breaks a rule");
      return `${where}: ${edition}: ${what}${shape && english(r) ? ` (${shape})` : ""}`;
    }))] as string[], quads.length);
  }
  return { ok: true, problems: [], triples: quads.length, counts: { templates: templates.size } };
}
