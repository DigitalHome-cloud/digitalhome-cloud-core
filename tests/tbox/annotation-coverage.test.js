import { describe, it, expect } from 'vitest';
import { readTtl, parseToStore, namedNode } from '../_helpers/loadGraph.js';
import fs from 'node:fs';
import path from 'node:path';

const DHC = 'https://digitalhome.cloud/ontology#';
const BRICK = 'https://brickschema.org/schema/Brick#';
const S223 = 'http://data.ashrae.org/standard223#';
const REC = 'https://w3id.org/rec#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL = 'http://www.w3.org/2002/07/owl#';

const DESIGN_VIEW = `${DHC}designView`;
const DESIGN_VIEWS = new Set(['governance', 'spatial', 'building', 'electrical',
  'plumbing', 'heating', 'network', 'automation', 'compliance']);
// The four vocabularies the DHC UI overlay covers. A reference A-Box may name a
// protocol or versioned namespace (bacnet:, ref:, brick_v_1_0_2:, bldg:) — those
// are not DHC entities to annotate, and filtering to these four URIs excludes
// them without needing to load the 3.5 MB Brick+extensions.ttl here. The
// authoritative scope check is `ontology_explorer.py --scan`; this is its
// lighter twin inside the JS suite.
const VOCAB = [DHC, BRICK, S223, REC];
const inVocab = (iri) => VOCAB.some((ns) => iri.startsWith(ns));

const repoRoot = new URL('../..', import.meta.url).pathname;

// ── The annotation-coverage bug class ─────────────────────────────────────
//
// dhc-app-metadata.ttl skins the T-Box for the apps: every in-scope class and
// property needs a dhc:designView + @de + @fr so the SmartHome Designer can
// place it in a toolbox tab and label it. Nothing kept that aligned with the
// entities the models actually use — so classes drifted in unannotated, and
// `claude_to_do` placeholders (the explorer's "fill later" marker) sat for
// months. This test is what makes the iterative "add an A-Box example → the
// class comes into scope" loop safe: a new class fails here until annotated.
//
// Entities I could not translate confidently would be pinned here rather than
// guessed. The list is empty — the reconciliation closed the whole gap.
const KNOWN_INCOMPLETE = new Set([]);

const core = parseToStore(readTtl('schema/tbox/dhc-core.ttl'));
const meta = parseToStore(readTtl('schema/tbox/dhc-app-metadata.ttl'));
// Brick + REC + 223P baseline: needed only to answer "is this class DEFINED in
// our T-Box?". An A-Box may reference a canonical brick: class our vendored file
// does not carry (brick:Boiler, a brick:Apartment declared inline in an example,
// a brick:*Shape) — those cannot be annotated (the mass-update's resolve_name
// requires the entity to exist), so they are out of scope, exactly as the
// Python --scan computes it.
const brick = parseToStore(readTtl('schema/tbox/Brick+extensions.ttl'));
const definedInTbox = (iri) =>
  [...core.match(namedNode(iri), null, null)].length > 0 ||
  [...brick.match(namedNode(iri), null, null)].length > 0;

// Every class an A-Box individual is typed as, across schema/abox/** (recursive),
// restricted to the DHC vocabularies AND actually defined in the T-Box.
const aboxDir = path.join(repoRoot, 'schema/abox');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name))
  : e.name.endsWith('.ttl') ? [path.join(dir, e.name)] : []);
const usedTypes = new Set();
for (const f of walk(aboxDir)) {
  const store = parseToStore(fs.readFileSync(f, 'utf8'));
  for (const q of store.match(null, namedNode(`${RDF}type`), null)) {
    if (q.object.termType === 'NamedNode' && inVocab(q.object.value) && definedInTbox(q.object.value)) {
      usedTypes.add(q.object.value);
    }
  }
}

// dhc-core vocabulary: classes, properties, and enum individuals.
const coreVocab = new Set();
for (const t of [`${OWL}Class`, `${OWL}ObjectProperty`, `${OWL}DatatypeProperty`]) {
  for (const q of core.match(null, namedNode(`${RDF}type`), namedNode(t))) {
    if (q.subject.value.startsWith(DHC)) coreVocab.add(q.subject.value);
  }
}
for (const q of core.match(null, namedNode(`${RDF}type`), null)) {
  if (q.subject.value.startsWith(DHC) && q.object.value.startsWith(DHC)) coreVocab.add(q.subject.value);
}

// Everything already annotated in the overlay (minus the annotation vocabulary
// itself and the ontology header) is, by being there, in scope and must be complete.
const hasType = (store, s, t) =>
  [...store.match(namedNode(s), namedNode(`${RDF}type`), namedNode(t))].length > 0;
const annotated = new Set();
for (const q of meta.match(null, null, null)) {
  const s = q.subject.value;
  if (q.subject.termType !== 'NamedNode') continue;
  if (hasType(meta, s, `${OWL}AnnotationProperty`)) continue;  // the vocabulary itself
  if (hasType(meta, s, `${OWL}Ontology`)) continue;            // the header
  annotated.add(s);
}

const inScope = [...new Set([...usedTypes, ...coreVocab, ...annotated])].filter(inVocab).sort();

const short = (iri) => {
  for (const [ns, p] of [[DHC, 'dhc'], [BRICK, 'brick'], [S223, 's223'], [REC, 'rec']]) {
    if (iri.startsWith(ns)) return `${p}:${iri.slice(ns.length)}`;
  }
  return iri;
};
const labelsIn = (iri) => [...meta.match(namedNode(iri), namedNode(`${RDFS}label`), null)]
  .map((q) => q.object).filter((o) => o.termType === 'Literal');

describe('annotation coverage — every in-scope entity is fully skinned for the apps', () => {
  it('the in-scope set is non-empty and actually recursive over schema/abox/**', () => {
    // Guards the guard: a scoping bug that empties this set would make every
    // assertion below vacuously pass. The reference Brick examples alone push
    // this well past 100 — a non-recursive glob would see only the ~2 top-level.
    expect(inScope.length, 'in-scope set is empty — scan/scope is misconfigured').toBeGreaterThan(100);
  });

  it('no `claude_to_do` placeholder survives anywhere in the overlay', () => {
    const stuck = [];
    for (const q of meta.match(null, null, null)) {
      if (q.object.termType === 'Literal' && String(q.object.value) === 'claude_to_do') {
        stuck.push(`${short(q.subject.value)} ${short(q.predicate.value)}`);
      }
    }
    expect(stuck, 'unfilled claude_to_do markers remain — run the reconcile (ontology_explorer.py --scan/--massupdate)').toEqual([]);
  });

  it('every in-scope entity has dhc:designView + @de + @fr, and designView is a valid enum', () => {
    const bad = [];
    for (const e of inScope) {
      if (KNOWN_INCOMPLETE.has(short(e))) continue;
      const miss = [];
      const dv = [...meta.match(namedNode(e), namedNode(DESIGN_VIEW), null)].map((q) => String(q.object.value));
      if (!dv.length) miss.push('designView');
      else if (!dv.every((v) => DESIGN_VIEWS.has(v))) miss.push(`designView∉enum(${dv})`);
      const langs = new Set(labelsIn(e).map((o) => o.language));
      if (!langs.has('de')) miss.push('@de');
      if (!langs.has('fr')) miss.push('@fr');
      if (miss.length) bad.push(`${short(e)} — ${miss.join(', ')}`);
    }
    expect(bad, `${bad.length} in-scope entities are not fully annotated`).toEqual([]);
  });

  it('every dhc-core class and property is present in the overlay', () => {
    // The tightest loop: a new dhc-core term must be skinned before it ships.
    const absent = [...coreVocab].filter((e) => !KNOWN_INCOMPLETE.has(short(e))
      && [...meta.match(namedNode(e), null, null)].length === 0).map(short).sort();
    expect(absent, 'dhc-core terms with no UI overlay at all').toEqual([]);
  });
});
