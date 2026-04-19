import { describe, it, expect } from 'vitest';
import { readTtl, parseToStore, namedNode } from '../_helpers/loadGraph.js';

const DHC = 'https://digitalhome.cloud/ontology#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';

const ttl = readTtl('schema/tbox/dhc-core.schema.ttl');
const store = parseToStore(ttl);

function subjects(predicate, object) {
  return [...store.match(null, predicate, object)].map(q => q.subject.value);
}

describe('T-Box — dhc-core.schema.ttl', () => {
  it('parses cleanly', () => {
    expect(store.size).toBeGreaterThan(500);
  });

  it('declares version 2.1.0', () => {
    const versions = [...store.match(null, namedNode(`${OWL}versionInfo`), null)]
      .map(q => q.object.value);
    expect(versions).toContain('2.1.0');
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

  it('promotes Norm to a first-class class with exactly 5 instances', () => {
    const normClass = subjects(namedNode(`${RDF}type`), namedNode(`${OWL}Class`))
      .filter(s => s === `${DHC}Norm`);
    expect(normClass).toHaveLength(1);

    const normInstances = subjects(namedNode(`${RDF}type`), namedNode(`${DHC}Norm`));
    expect(normInstances).toHaveLength(5);
    expect(new Set(normInstances)).toEqual(new Set([
      `${DHC}Norm_NFC14100`,
      `${DHC}Norm_NFC15100`,
      `${DHC}Norm_DINVDE0100`,
      `${DHC}Norm_AREI_RGIE`,
      `${DHC}Norm_BS7671`,
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

  it('declares R-Box axioms: feeds TransitiveProperty, locatedIn inverse of contains', () => {
    const feedsIsTransitive = [...store.match(
      namedNode(`${DHC}feeds`),
      namedNode(`${RDF}type`),
      namedNode(`${OWL}TransitiveProperty`),
    )].length;
    expect(feedsIsTransitive).toBe(1);

    const locatedInverse = [...store.match(
      namedNode(`${DHC}locatedIn`),
      namedNode(`${OWL}inverseOf`),
      namedNode(`${DHC}contains`),
    )].length;
    expect(locatedInverse).toBe(1);

    const containsIsProp = [...store.match(
      namedNode(`${DHC}contains`),
      namedNode(`${RDF}type`),
      namedNode(`${OWL}ObjectProperty`),
    )].length;
    expect(containsIsProp).toBe(1);
  });

  it('introduces the dhc:dedicated boolean property on Circuit', () => {
    const quads = [...store.match(namedNode(`${DHC}dedicated`), null, null)];
    const byPred = Object.fromEntries(quads.map(q => [q.predicate.value, q.object.value]));
    expect(byPred[`${RDFS}domain`]).toBe(`${DHC}Circuit`);
    expect(byPred[`${RDFS}range`]).toBe('http://www.w3.org/2001/XMLSchema#boolean');
  });

  it('every owl:Class has at least @en, @de, @fr rdfs:label', () => {
    const classes = subjects(namedNode(`${RDF}type`), namedNode(`${OWL}Class`));
    const missing = [];
    for (const cls of classes) {
      const labels = [...store.match(namedNode(cls), namedNode(`${RDFS}label`), null)]
        .map(q => q.object.language);
      for (const lang of ['en', 'de', 'fr']) {
        if (!labels.includes(lang)) {
          missing.push(`${cls} missing @${lang}`);
          break;
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('declares new "compliance" design view on dhc:Norm', () => {
    const viewQuads = [...store.match(
      namedNode(`${DHC}Norm`),
      namedNode(`${DHC}designView`),
      null,
    )];
    const values = viewQuads.map(q => q.object.value);
    expect(values).toContain('compliance');
  });
});
