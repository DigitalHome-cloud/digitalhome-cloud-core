// Who says a template is right. dht:verified, dht:checkedBy and dht:checkedAt
// are never taken from an upload: a save keeps a template's stored
// verification only when the template's content is unchanged, and sets
// dht:verified false otherwise. Only verify() — the verifyTemplate call, made
// by a signed-in editor — sets verified true, with that person and the time.

import N3 from "n3";
import { BadRequest, DHC, DHT } from "./rules";

const { namedNode, literal } = N3.DataFactory;
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const TEMPLATE = `${DHT}BoardTemplate`;
const VERIFICATION = new Set([`${DHT}verified`, `${DHT}checkedBy`, `${DHT}checkedAt`]);

const parse = (ttl: string): N3.Quad[] => (ttl ? new N3.Parser().parse(ttl) : []);
const templatesIn = (quads: N3.Quad[]) =>
  new Set(quads.filter((q) => q.predicate.value === RDF_TYPE && q.object.value === TEMPLATE).map((q) => q.subject.value));
const within = (t: string) => (q: N3.Quad) => q.subject.value === t || q.subject.value.startsWith(`${t}/`);
const key = (q: N3.Quad) => `${q.subject.id} ${q.predicate.id} ${q.object.id}`;

/** A template's content: its own facts and its parts', without the verification. */
function content(quads: N3.Quad[], t: string): string {
  return quads.filter(within(t)).filter((q) => !VERIFICATION.has(q.predicate.value)).map(key).sort().join("\n");
}

export function write(quads: N3.Quad[]): Promise<string> {
  const w = new N3.Writer({
    prefixes: { dht: DHT, dhc: DHC, rdfs: "http://www.w3.org/2000/01/rdf-schema#", xsd: XSD },
  });
  w.addQuads(quads);
  return new Promise((res, rej) => w.end((err, out) => (err ? rej(err) : res(out))));
}

/** `prepare` for an untrusted save. Unparseable Turtle is passed on for the validator to refuse. */
export async function keepVerification(ttl: string, currentTtl: string): Promise<string> {
  let next: N3.Quad[];
  try {
    next = parse(ttl);
  } catch {
    return ttl;
  }
  const current = parse(currentTtl);
  const before = templatesIn(current);
  const out = next.filter((q) => !(VERIFICATION.has(q.predicate.value)));
  for (const t of templatesIn(next)) {
    if (before.has(t) && content(current, t) === content(next, t)) {
      const kept = current.filter((q) => q.subject.value === t && VERIFICATION.has(q.predicate.value));
      if (kept.length) { out.push(...kept); continue; }
    }
    out.push(N3.DataFactory.quad(namedNode(t), namedNode(`${DHT}verified`), literal("false", namedNode(`${XSD}boolean`))));
  }
  return write(out);
}

/** The current graph with one template marked verified by `by` at `at` (ISO time). */
export async function verify(currentTtl: string, template: string, by: string, at: string): Promise<string> {
  const quads = parse(currentTtl);
  if (!templatesIn(quads).has(template)) throw new BadRequest(`there is no template ${template}`);
  const out = quads.filter((q) => !(q.subject.value === template && VERIFICATION.has(q.predicate.value)));
  const t = namedNode(template);
  out.push(
    N3.DataFactory.quad(t, namedNode(`${DHT}verified`), literal("true", namedNode(`${XSD}boolean`))),
    N3.DataFactory.quad(t, namedNode(`${DHT}checkedBy`), literal(by)),
    N3.DataFactory.quad(t, namedNode(`${DHT}checkedAt`), literal(at, namedNode(`${XSD}dateTime`))),
  );
  return write(out);
}

/** The templates of a graph and whether each is verified (for listings). */
export function summary(ttl: string): Array<{ iri: string; verified: boolean; checkedBy: string | null; checkedAt: string | null }> {
  const quads = parse(ttl);
  const get = (t: string, p: string) => quads.find((q) => q.subject.value === t && q.predicate.value === `${DHT}${p}`)?.object.value ?? null;
  return [...templatesIn(quads)].sort().map((iri) => ({
    iri, verified: get(iri, "verified") === "true", checkedBy: get(iri, "checkedBy"), checkedAt: get(iri, "checkedAt"),
  }));
}
