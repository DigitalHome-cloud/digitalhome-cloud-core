import { describe, it, expect } from 'vitest';
import { readTtl, parseToStore, validateAgainst, namedNode } from '../_helpers/loadGraph.js';

const SHACL = 'http://www.w3.org/ns/shacl#';
const DHC = 'https://digitalhome.cloud/ontology#';

const shapesTtl = readTtl('schema/cbox/electrical/nfc15100.shapes.ttl');
const tboxTtl = readTtl('schema/tbox/dhc-core.schema.ttl');
const withTbox = (fixture) => tboxTtl + '\n' + fixture;

describe('C-Box — nfc15100.shapes.ttl', () => {
  const store = parseToStore(shapesTtl);

  it('parses cleanly', () => {
    expect(store.size).toBeGreaterThan(100);
  });

  it('every shape referencing sh:targetClass points at a T-Box class', () => {
    const tboxStore = parseToStore(tboxTtl);
    const targets = [...store.match(null, namedNode(`${SHACL}targetClass`), null)]
      .map(q => q.object.value);
    for (const t of targets) {
      const hits = [...tboxStore.match(namedNode(t), null, null)].length;
      expect(hits, `T-Box missing class ${t}`).toBeGreaterThan(0);
    }
  });

  it('every sh:path points at a dhc: property defined in T-Box', () => {
    const tboxStore = parseToStore(tboxTtl);
    const paths = [...store.match(null, namedNode(`${SHACL}path`), null)]
      .map(q => q.object)
      .filter(o => o.termType === 'NamedNode' && o.value.startsWith(DHC))
      .map(o => o.value);
    for (const p of paths) {
      const hits = [...tboxStore.match(namedNode(p), null, null)].length;
      expect(hits, `T-Box missing property ${p}`).toBeGreaterThan(0);
    }
  });

  it('defines dhc:defaultValue on at least 4 property blank nodes', () => {
    const defaults = [...store.match(null, namedNode(`${DHC}defaultValue`), null)];
    expect(defaults.length, 'expected ≥ 4 defaultValue attachments').toBeGreaterThanOrEqual(4);
    for (const q of defaults) {
      const pathQuads = [...store.match(q.subject, namedNode(`${SHACL}path`), null)];
      expect(pathQuads.length, `default at ${q.subject.value} lacks sh:path`).toBeGreaterThan(0);
    }
  });

  describe('validation', () => {
    it('conforms for valid lighting circuit', async () => {
      const data = readTtl('tests/fixtures/valid-fr-lighting-circuit.ttl');
      const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
      expect(conforms, JSON.stringify(results, null, 2)).toBe(true);
    });

    it('flags too-many-points on lighting circuit', async () => {
      const data = readTtl('tests/fixtures/invalid-fr-lighting-circuit-too-many-points.ttl');
      const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
      expect(conforms).toBe(false);
      expect(results.some(r => /LightingCircuitShape/.test(r.sourceShape || ''))).toBe(true);
    });

    it('flags overcurrent on lighting circuit', async () => {
      const data = readTtl('tests/fixtures/invalid-fr-lighting-circuit-overcurrent.ttl');
      const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
      expect(conforms).toBe(false);
      expect(results.some(r => /LightingCircuitShape/.test(r.sourceShape || ''))).toBe(true);
    });

    it('conforms for valid 16 A socket circuit', async () => {
      const data = readTtl('tests/fixtures/valid-fr-socket-16a.ttl');
      const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
      expect(conforms, JSON.stringify(results, null, 2)).toBe(true);
    });

    it('flags too-many-sockets on 16 A socket circuit', async () => {
      const data = readTtl('tests/fixtures/invalid-fr-socket-16a-too-many-sockets.ttl');
      const { conforms } = await validateAgainst(shapesTtl, withTbox(data));
      expect(conforms).toBe(false);
    });

    it('conforms for valid three-phase cooking', async () => {
      const data = readTtl('tests/fixtures/valid-fr-cooking-tri.ttl');
      const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
      expect(conforms, JSON.stringify(results, null, 2)).toBe(true);
    });

    it('flags undersized wire on three-phase cooking', async () => {
      const data = readTtl('tests/fixtures/invalid-fr-cooking-tri-undersized-wire.ttl');
      const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
      expect(conforms).toBe(false);
      expect(results.some(r => /CookingTriShape/.test(r.sourceShape || ''))).toBe(true);
    });

    it('conforms for multi-norm circuit (composability)', async () => {
      const data = readTtl('tests/fixtures/valid-fr-circuit-multi-norm.ttl');
      const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
      expect(conforms, JSON.stringify(results, null, 2)).toBe(true);
    });
  });
});
