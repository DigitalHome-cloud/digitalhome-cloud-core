import { describe, it, expect } from 'vitest';
import { readTtl, parseToStore, validateAgainst, namedNode } from '../_helpers/loadGraph.js';

const SHACL = 'http://www.w3.org/ns/shacl#';
const DHC = 'https://digitalhome.cloud/ontology#';

const shapesTtl = readTtl('schema/cbox/electrical/nfc15100-2015.shapes.ttl');
const tboxTtl = readTtl('schema/tbox/dhc-core.ttl');
const withTbox = (fixture) => tboxTtl + '\n' + fixture;

describe('C-Box — nfc15100-2015.shapes.ttl', () => {
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

    // ── IRVE (EV charging) ────────────────────────────────────────────────
    // These fixtures did not exist, which is exactly why IRVE32AMonoShape sat
    // permanently dead: its guard compared an xsd:integer literal against an
    // xsd:decimal property, so it could never fire and nothing ever noticed.

    it('conforms for valid 32 A IRVE circuit', async () => {
      const data = readTtl('tests/fixtures/valid-fr-irve-32a.ttl');
      const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
      expect(conforms, JSON.stringify(results, null, 2)).toBe(true);
    });

    it('flags undersized wire on 32 A single-phase IRVE circuit', async () => {
      const data = readTtl('tests/fixtures/invalid-fr-irve-32a-undersized.ttl');
      const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
      expect(conforms).toBe(false);
      expect(results.some(r => /IRVE32AMonoShape/.test(r.sourceShape || ''))).toBe(true);
    });

    // ── Residual-current protection ───────────────────────────────────────

    it('conforms for an RCD-protected circuit', async () => {
      const data = readTtl('tests/fixtures/valid-fr-rcd-protected-circuit.ttl');
      const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
      expect(conforms, JSON.stringify(results, null, 2)).toBe(true);
    });

    // NB: RCDSensitivityShape and CircuitRCDProtectionShape are plain
    // sh:property shapes, not sh:or guards. The validator therefore reports
    // the inner *blank node* as sourceShape — but does surface sh:path and
    // sh:message. That is the mirror image of the sh:or case (named
    // sourceShape, no message). Assert on path here, on sourceShape there.

    it('flags an RCD coarser than 30 mA', async () => {
      const data = readTtl('tests/fixtures/invalid-fr-rcd-oversensitive.ttl');
      const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
      expect(conforms).toBe(false);
      expect(results.some(r => r.path === `${DHC}sensitivityMA`)).toBe(true);
    });

    it('flags a circuit with no residual current device', async () => {
      const data = readTtl('tests/fixtures/invalid-fr-circuit-no-rcd.ttl');
      const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
      expect(conforms).toBe(false);
      expect(results.some(r => r.path === `${DHC}hasProtection`)).toBe(true);
    });

    it('flags a Type AC RCD on an IRVE circuit', async () => {
      const data = readTtl('tests/fixtures/invalid-fr-irve-type-ac-rcd.ttl');
      const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
      expect(conforms).toBe(false);
      expect(results.some(r => /TypeARCDShape/.test(r.sourceShape || ''))).toBe(true);
    });

    it('conforms for multi-norm circuit (composability)', async () => {
      const data = readTtl('tests/fixtures/valid-fr-circuit-multi-norm.ttl');
      const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
      expect(conforms, JSON.stringify(results, null, 2)).toBe(true);
    });
  });
});
