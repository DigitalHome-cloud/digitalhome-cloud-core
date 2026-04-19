import { describe, it, expect } from 'vitest';
import { readTtl, parseToStore, namedNode } from '../_helpers/loadGraph.js';

const DHC = 'https://digitalhome.cloud/ontology#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';

const ttl = readTtl('schema/tbox/dhc-core.schema.ttl');
const store = parseToStore(ttl);

// DH-SPEC-201 §8.1 / §9.4 mapping: designView → default disposition
const DEFAULT_DISPOSITION_BY_VIEW = {
  spatial: 'excluded',
  governance: 'excluded',
  compliance: 'excluded',
  automation: 'variable',
  building: 'block',
  electrical: 'block',
  plumbing: 'block',
  heating: 'block',
  network: 'block',
};

function singleObject(subject, predicate) {
  const quads = [...store.match(namedNode(subject), namedNode(predicate), null)];
  return quads.length > 0 ? quads[0].object.value : undefined;
}

describe('T-Box — Blockly annotation properties', () => {
  it('declares the four dhc:blockly* annotation properties', () => {
    const expected = [
      `${DHC}blocklyDisposition`,
      `${DHC}blocklyCategory`,
      `${DHC}blocklyParentProperty`,
      `${DHC}blocklyFieldType`,
    ];
    for (const iri of expected) {
      const quads = [...store.match(
        namedNode(iri),
        namedNode(`${RDF}type`),
        namedNode(`${OWL}AnnotationProperty`),
      )];
      expect(quads, `missing owl:AnnotationProperty declaration for ${iri}`).toHaveLength(1);
    }
  });

  it('declares dhc:defaultValue as an rdf:Property', () => {
    const quads = [...store.match(
      namedNode(`${DHC}defaultValue`),
      namedNode(`${RDF}type`),
      namedNode(`${RDF}Property`),
    )];
    expect(quads).toHaveLength(1);
  });

  it('annotation properties carry trilingual labels', () => {
    const iris = [
      `${DHC}blocklyDisposition`,
      `${DHC}blocklyCategory`,
      `${DHC}blocklyParentProperty`,
      `${DHC}blocklyFieldType`,
      `${DHC}defaultValue`,
    ];
    for (const iri of iris) {
      const langs = [...store.match(namedNode(iri), namedNode(`${RDFS}label`), null)]
        .map(q => q.object.language);
      for (const lang of ['en', 'de', 'fr']) {
        expect(langs, `${iri} missing @${lang} label`).toContain(lang);
      }
    }
  });

  it('spot-check: dhc:Circuit is a block with hasCircuit as parent property', () => {
    expect(singleObject(`${DHC}Circuit`, `${DHC}blocklyDisposition`)).toBe('block');
    expect(singleObject(`${DHC}Circuit`, `${DHC}blocklyParentProperty`)).toBe(`${DHC}hasCircuit`);
  });

  it('spot-check: dhc:Group is a variable', () => {
    // Group inherits the automation default via designView mapping.
    const explicit = singleObject(`${DHC}Group`, `${DHC}blocklyDisposition`);
    const view = singleObject(`${DHC}Group`, `${DHC}designView`);
    const effective = explicit ?? DEFAULT_DISPOSITION_BY_VIEW[view];
    expect(effective).toBe('variable');
  });

  it('spot-check: dhc:RealEstate is excluded', () => {
    const explicit = singleObject(`${DHC}RealEstate`, `${DHC}blocklyDisposition`);
    const view = singleObject(`${DHC}RealEstate`, `${DHC}designView`);
    const effective = explicit ?? DEFAULT_DISPOSITION_BY_VIEW[view];
    expect(effective).toBe('excluded');
  });

  it('spot-check: dhc:CircuitType is explicitly excluded (enum class)', () => {
    expect(singleObject(`${DHC}CircuitType`, `${DHC}blocklyDisposition`)).toBe('excluded');
  });

  it('spot-check: dhc:BuildingElement is explicitly excluded (abstract base)', () => {
    expect(singleObject(`${DHC}BuildingElement`, `${DHC}blocklyDisposition`)).toBe('excluded');
  });

  it('every owl:Class has either explicit blocklyDisposition or a designView with a default mapping', () => {
    const classes = [...store.match(null, namedNode(`${RDF}type`), namedNode(`${OWL}Class`))]
      .map(q => q.subject.value);
    const missing = [];
    for (const cls of classes) {
      const explicit = singleObject(cls, `${DHC}blocklyDisposition`);
      if (explicit) continue;
      const view = singleObject(cls, `${DHC}designView`);
      if (!view || !(view in DEFAULT_DISPOSITION_BY_VIEW)) {
        missing.push(`${cls} (designView=${view ?? '∅'})`);
      }
    }
    expect(missing, 'classes without dispositional resolution').toEqual([]);
  });

  it('dhc:Equipment, EquipmentType, ElectricVehicle, ChargingStation carry a designView', () => {
    for (const cls of ['Equipment', 'EquipmentType', 'ElectricVehicle', 'ChargingStation']) {
      const view = singleObject(`${DHC}${cls}`, `${DHC}designView`);
      expect(view, `${cls} missing dhc:designView`).toBeTruthy();
    }
  });
});
