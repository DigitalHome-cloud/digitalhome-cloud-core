import { describe, it, expect } from 'vitest';
import { readTtl, parseToStore, namedNode } from '../_helpers/loadGraph.js';

const DHC = 'https://digitalhome.cloud/ontology#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const S223 = 'http://data.ashrae.org/standard223#';
const BRICK = 'https://brickschema.org/schema/Brick#';

const ttl = readTtl('schema/tbox/dhc-core.ttl');
const store = parseToStore(ttl);
const metaStore = parseToStore(readTtl('schema/tbox/dhc-app-metadata.ttl'));

function subjects(predicate, object) {
  return [...store.match(null, predicate, object)].map(q => q.subject.value);
}

describe('T-Box — dhc-core.ttl', () => {
  it('parses cleanly', () => {
    expect(store.size).toBeGreaterThan(100);
  });

  it('declares version 3.0.0', () => {
    const versions = [...store.match(null, namedNode(`${OWL}versionInfo`), null)]
      .map(q => q.object.value);
    expect(versions).toContain('3.0.0');
  });

  it('contains no v1 module URIs (dhc-nfc15100:, dhc-nfc14100:)', () => {
    expect(ttl).not.toMatch(/dhc-nfc15100:/);
    expect(ttl).not.toMatch(/dhc-nfc14100:/);
  });

  it('contains no lingering dhc:Guideline references', () => {
    expect(ttl).not.toMatch(/\bdhc:Guideline\b/);
    expect(ttl).not.toMatch(/\bdhc:guidelineCategory\b/);
    expect(ttl).not.toMatch(/\bdhc:guidelineWeight\b/);
  });

  // Scoped to France while the v3 core is prototyped. DIN VDE 0100 (DE),
  // AREI/RGIE (BE) and BS 7671 (GB) were removed in v3.0.0 — shapes, tests,
  // fixtures, manifest profiles and Norm instances together, so nothing
  // dangles. They return once dhc-core is released.
  it('promotes Norm to a first-class class with exactly 2 instances (FR only)', () => {
    const normClass = subjects(namedNode(`${RDF}type`), namedNode(`${OWL}Class`))
      .filter(s => s === `${DHC}Norm`);
    expect(normClass).toHaveLength(1);

    const normInstances = subjects(namedNode(`${RDF}type`), namedNode(`${DHC}Norm`));
    expect(normInstances).toHaveLength(2);
    expect(new Set(normInstances)).toEqual(new Set([
      `${DHC}Norm_NFC14100`,
      `${DHC}Norm_NFC15100`,
    ]));
  });

  it('declares exactly 8 CircuitType instances', () => {
    const types = subjects(namedNode(`${RDF}type`), namedNode(`${DHC}CircuitType`));
    expect(types).toHaveLength(8);
    expect(new Set(types)).toEqual(new Set([
      `${DHC}CircuitType_Lighting`,
      `${DHC}CircuitType_Socket`,
      `${DHC}CircuitType_DedicatedAppliance`,
      `${DHC}CircuitType_Cooking`,
      `${DHC}CircuitType_Heating`,
      `${DHC}CircuitType_WaterHeater`,
      `${DHC}CircuitType_IRVE`,
      `${DHC}CircuitType_FloorHeating`,
    ]));
  });

  it('introduces the dhc:dedicated boolean property on Circuit', () => {
    const quads = [...store.match(namedNode(`${DHC}dedicated`), null, null)];
    const byPred = Object.fromEntries(quads.map(q => [q.predicate.value, q.object.value]));
    expect(byPred[`${RDFS}domain`]).toBe(`${DHC}Circuit`);
    expect(byPred[`${RDFS}range`]).toBe('http://www.w3.org/2001/XMLSchema#boolean');
  });

  // ── v3 four-file split (SPEC-V3-Redesign.md) ────────────────────────────
  // dhc-core.ttl carries domain semantics + @en only. Localized labels and
  // every dhc:designView / blockly* annotation belong to dhc-app-metadata.ttl.

  it('every owl:Class carries an @en rdfs:label', () => {
    const classes = subjects(namedNode(`${RDF}type`), namedNode(`${OWL}Class`));
    const missing = classes.filter(cls =>
      ![...store.match(namedNode(cls), namedNode(`${RDFS}label`), null)]
        .some(q => q.object.language === 'en'));
    expect(missing).toEqual([]);
  });

  it('carries no @de/@fr labels — those live in dhc-app-metadata.ttl', () => {
    const localized = [...store.match(null, namedNode(`${RDFS}label`), null)]
      .filter(q => ['de', 'fr'].includes(q.object.language))
      .map(q => `${q.subject.value} @${q.object.language}`);
    expect(localized).toEqual([]);

    // and the overlay really does provide them
    const deInMeta = [...metaStore.match(null, namedNode(`${RDFS}label`), null)]
      .filter(q => q.object.language === 'de');
    expect(deInMeta.length).toBeGreaterThan(0);
  });

  it('carries no dhc:designView — that annotation lives in dhc-app-metadata.ttl', () => {
    const inCore = [...store.match(null, namedNode(`${DHC}designView`), null)];
    expect(inCore).toEqual([]);

    const inMeta = [...metaStore.match(null, namedNode(`${DHC}designView`), null)];
    expect(inMeta.length).toBeGreaterThan(0);
  });

  it('reserves the "compliance" design view for dhc:Norm (in app-metadata)', () => {
    const views = [...metaStore.match(
      namedNode(`${DHC}Norm`), namedNode(`${DHC}designView`), null,
    )].map(q => q.object.value);
    expect(views).toContain('compliance');
  });

  // ── v3 gap-filling rule (SPEC-V3-Redesign.md) ───────────────────────────
  // "DHC Core defines classes and properties that don't exist in Brick, REC
  // or 223P." Topology predicates are owned upstream — dhc: must not shadow
  // brick:feeds, rec:locatedIn or s223:contains with same-named duplicates.

  it('does not redefine predicates already owned by Brick/REC/223P', () => {
    for (const p of ['feeds', 'locatedIn', 'contains']) {
      const hits = [...store.match(namedNode(`${DHC}${p}`), null, null)];
      expect(hits, `dhc:${p} duplicates an upstream predicate`).toEqual([]);
    }
  });
});

// ── Anchoring of the electrical vocabulary ────────────────────────────────
// Every dhc: electrical class is a thin specialization of a real upstream
// class, so it inherits that class's SHACL constraints. This guards a real
// failure mode: rdfs:subClassOf pointing at a URI that does not exist is
// silently accepted by RDF, the class inherits nothing, and no test notices.
// The draft previously named s223:ElectricBreaker / s223:ElectricOutlet /
// s223:ElectricWire — none of which exist.

describe('T-Box — electrical classes anchor to real upstream classes', () => {
  // Expected *transitive* upstream anchor. dhc:RCD reaches
  // s223:ElectricityBreaker through dhc:ProtectionDevice, so a direct-parent
  // check would be both wrong and brittle.
  const EXPECTED_ANCHORS = {
    Circuit: `${S223}System`,
    ProtectionDevice: `${S223}ElectricityBreaker`,
    RCD: `${S223}ElectricityBreaker`,
    RCBO: `${S223}ElectricityBreaker`,
    WiringSegment: `${S223}Connection`,
    Socket: `${S223}ElectricityOutlet`,
    Distribution: `${S223}Junction`,
    BusBar: `${S223}Junction`,
    DistributionBoard: `${BRICK}Breaker_Panel`,
    EnergyMeter: `${BRICK}Electrical_Meter`,
    EmergencyDisconnect: `${BRICK}Building_Disconnect_Switch`,
  };

  const upstream = parseToStore(readTtl('schema/tbox/Brick+extensions.ttl'));

  // rdfs:subClassOf* closure, following dhc: links inside the core graph
  function ancestors(uri, seen = new Set()) {
    for (const q of store.match(namedNode(uri), namedNode(`${RDFS}subClassOf`), null)) {
      const parent = q.object.value;
      if (seen.has(parent)) continue;
      seen.add(parent);
      if (parent.startsWith(DHC)) ancestors(parent, seen);
    }
    return seen;
  }

  for (const [cls, anchor] of Object.entries(EXPECTED_ANCHORS)) {
    const pretty = anchor.replace(S223, 's223:').replace(BRICK, 'brick:');
    it(`dhc:${cls} resolves to ${pretty}, which exists upstream`, () => {
      // No skip-if-unpromoted escape hatch: every class listed here is expected
      // in the T-Box. A missing class is a real failure — electrical-installation-house.ttl once
      // typed instances as dhc:RCD / dhc:Socket / dhc:BusBar while all three
      // were still draft-only, and nothing caught it.
      const declared = [...store.match(
        namedNode(`${DHC}${cls}`), namedNode(`${RDFS}subClassOf`), null,
      )];
      expect(declared.length, `dhc:${cls} is absent from dhc-core.ttl (still in draft?)`)
        .toBeGreaterThan(0);

      expect([...ancestors(`${DHC}${cls}`)], `dhc:${cls} does not reach ${anchor}`)
        .toContain(anchor);

      const defined = [...upstream.match(namedNode(anchor), null, null)].length;
      expect(defined, `${anchor} is not defined in Brick+extensions.ttl`).toBeGreaterThan(0);
    });
  }
});
