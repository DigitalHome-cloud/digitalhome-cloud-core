import { describe, it, expect } from 'vitest';
import { readTtl, parseToStore, namedNode } from '../_helpers/loadGraph.js';

const DHC = 'https://digitalhome.cloud/ontology#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL = 'http://www.w3.org/2002/07/owl#';

// ── The dangling-reference bug class, one level up ────────────────────────
//
// tests/tbox/abox-join.test.js checks that every dhc: term an A-Box uses exists
// in the T-Box. Nothing checked the T-Box against ITSELF — so a promoted term
// can name a dhc: parent or range that is still sitting in schema/draft/, and
// everything passes.
//
// It is the same failure CLAUDE.md already warns about ("rdfs:subClassOf
// pointing at an undefined URI is silently accepted by RDF and inherits
// nothing"), and it is live: dhc:hasVehicle was promoted with
// rdfs:range dhc:Vehicle, and dhc:Barbecue with
// rdfs:subClassOf dhc:OutdoorFurniture, while both parents remain draft-only.
// The promote path moves a subject and its rdfs:domain properties — it does not
// follow ranges or parents, so a partial promotion is easy and silent.
//
// Consequences, none of which error: the class inherits no constraints, an
// OWL reasoner infers nothing, and a SHACL shape with sh:class on that range
// selects no focus nodes and reports conforms:true.
//
// schema/draft/ is gitignored, so these references point at something that does
// not exist in a fresh clone at all.

const tbox = parseToStore(
  readTtl('schema/tbox/dhc-core.ttl') + '\n' + readTtl('schema/tbox/dhc-app-metadata.ttl'),
);

const short = (v) => v.replace(DHC, 'dhc:');
const isDhc = (v) => v.startsWith(DHC);

// A term is "declared" if the T-Box says what kind of thing it is at all.
const declared = new Set(
  [...tbox.match(null, namedNode(`${RDF}type`), null)]
    .map((q) => q.subject.value)
    .filter(isDhc),
);

const danglingFor = (pred) =>
  [...tbox.match(null, namedNode(pred), null)]
    .filter((q) => isDhc(q.object.value) && !declared.has(q.object.value))
    .map((q) => `${short(q.subject.value)} → ${short(q.object.value)}`)
    .sort();

describe('T-Box — every dhc: term it references is declared in the T-Box', () => {
  it('the T-Box declares terms at all', () => {
    // Guards the guards: an empty `declared` set makes every filter below
    // report everything, and an empty T-Box makes them report nothing.
    expect(declared.size, 'no dhc: terms declared — every assertion here is vacuous').toBeGreaterThan(20);
  });

  it('no rdfs:subClassOf names an undeclared dhc: class', () => {
    // KNOWN, pinned rather than tolerated: dhc:OutdoorFurniture is still in
    // schema/draft/. Pinning the exact list means a NEW dangling parent fails
    // the suite while this one stays visible instead of being forgotten.
    expect(danglingFor(`${RDFS}subClassOf`)).toEqual(['dhc:Barbecue → dhc:OutdoorFurniture']);
  });

  it('no rdfs:range names an undeclared dhc: class', () => {
    // KNOWN: dhc:Vehicle is still in schema/draft/. dhc:hasVehicle's range
    // therefore resolves to nothing.
    expect(danglingFor(`${RDFS}range`)).toEqual(['dhc:hasVehicle → dhc:Vehicle']);
  });

  it('no rdfs:domain names an undeclared dhc: class', () => {
    expect(danglingFor(`${RDFS}domain`)).toEqual([]);
  });

  it('no owl:inverseOf names an undeclared dhc: property', () => {
    expect(danglingFor(`${OWL}inverseOf`)).toEqual([]);
  });
});

describe('T-Box — dhc: does not shadow an upstream predicate', () => {
  // CLAUDE.md § Gap-filling only: "Do not shadow an upstream predicate
  // (brick:feeds, rec:locatedIn, s223:contains) with a same-named dhc:
  // duplicate." schema/draft/dhc-core.ttl currently defines dhc:feeds, which is
  // exactly the named example — promoting it would fork the topology layer in
  // two, with the A-Box on brick:feeds and the vocabulary on dhc:feeds, and
  // nothing would report the split.
  //
  // Cheap to assert, and the draft is where it would arrive from.
  const shadowed = ['feeds', 'isFedBy', 'hasPart', 'isPartOf', 'hasPoint', 'controls', 'locatedIn', 'contains', 'hasLocation'];

  it('none of the upstream relationship names are declared as dhc: properties', () => {
    const offenders = shadowed.filter((n) =>
      [...tbox.match(namedNode(`${DHC}${n}`), namedNode(`${RDF}type`), null)].length > 0);
    expect(offenders, 'a dhc: duplicate of an upstream predicate forks the layer it duplicates').toEqual([]);
  });
});
