import { describe, it, expect } from 'vitest';
import { readTtl, parseToStore, validateAgainst } from '../_helpers/loadGraph.js';

const shapesTtl = readTtl('schema/cbox/electrical/nfc14100.shapes.ttl');
const tboxTtl = readTtl('schema/tbox/dhc-core.schema.ttl');
const withTbox = (fixture) => tboxTtl + '\n' + fixture;

describe('C-Box — nfc14100.shapes.ttl', () => {
  it('parses cleanly', () => {
    const store = parseToStore(shapesTtl);
    expect(store.size).toBeGreaterThan(20);
  });

  it('conforms for a valid energy-delivery setup', async () => {
    const data = readTtl('tests/fixtures/valid-fr-energy-delivery.ttl');
    const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
    expect(conforms, JSON.stringify(results, null, 2)).toBe(true);
  });

  it('flags energy meter with no location', async () => {
    const data = readTtl('tests/fixtures/invalid-fr-energy-meter-no-space.ttl');
    const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
    expect(conforms).toBe(false);
    expect(results.some(r => /locatedIn|ElectricalTechnicalSpace|técnica|Technikraum|technique/.test(r.message || ''))).toBe(true);
  });
});
