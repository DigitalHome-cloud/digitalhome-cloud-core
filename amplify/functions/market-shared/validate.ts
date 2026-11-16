// A seller's catalogue, checked before it is saved: Turtle, only that seller's
// articles, and the marketplace shapes (schema/market, closed: no prices).

import N3 from "n3";
import rdf from "@zazuko/env-node";
import SHACLValidator from "rdf-validate-shacl";
import { SHAPES } from "./market.generated";
import { MAX_GRAPH_BYTES, articlePrefix } from "./rules";

export interface Verdict { ok: boolean; problems: string[]; triples: number; articles: number }

const ARTICLE = "https://digitalhome.cloud/pro#Article";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
let shapes: ReturnType<typeof rdf.dataset> | undefined;

export async function validateListing(ttl: string, seller: string): Promise<Verdict> {
  const bad = (problems: string[], triples = 0): Verdict => ({ ok: false, problems, triples, articles: 0 });
  if (Buffer.byteLength(ttl, "utf8") > MAX_GRAPH_BYTES) return bad([`a catalogue is at most ${MAX_GRAPH_BYTES / 1024 / 1024} MB`]);
  let quads: N3.Quad[];
  try {
    quads = new N3.Parser().parse(ttl);
  } catch (err) {
    return bad([`not valid Turtle: ${(err as Error).message}`]);
  }
  const prefix = articlePrefix(seller);
  const problems: string[] = [];
  const outside = quads.find((q) => q.subject.termType !== "NamedNode" || !q.subject.value.startsWith(prefix));
  if (outside) problems.push(`a catalogue of ${seller} only describes ${prefix}… articles; ${outside.subject.value} is not one`);
  const subjects = new Set(quads.map((q) => q.subject.value));
  const typed = new Set(quads.filter((q) => q.predicate.value === RDF_TYPE && q.object.value === ARTICLE).map((q) => q.subject.value));
  const untyped = [...subjects].find((s) => !typed.has(s));
  if (untyped) problems.push(`${untyped} is not a dhp:Article`);
  const wrongType = quads.find((q) => q.predicate.value === RDF_TYPE && q.object.value !== ARTICLE);
  if (wrongType) problems.push(`only dhp:Article is allowed as a type, not ${wrongType.object.value}`);
  if (problems.length) return bad(problems, quads.length);

  shapes ??= (() => { const d = rdf.dataset(); d.addAll(new N3.Parser().parse(SHAPES)); return d; })();
  const data = rdf.dataset();
  data.addAll(quads);
  const report = await new SHACLValidator(shapes, { factory: rdf as any }).validate(data);
  const short = (iri: string) => iri.replace("https://digitalhome.cloud/pro#", "dhp:");
  const found = [...new Set(report.results.map((r: any) => {
    const where = r.focusNode?.value?.slice(prefix.length) ?? "?";
    const what = r.message?.[0]?.value ?? "invalid";
    return r.path?.value ? `${where}: ${what} (${short(r.path.value)})` : `${where}: ${what}`;
  }))] as string[];
  return { ok: report.conforms, problems: found.slice(0, 50), triples: quads.length, articles: typed.size };
}
