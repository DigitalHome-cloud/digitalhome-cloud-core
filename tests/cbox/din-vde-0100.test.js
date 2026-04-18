import { describe, it, expect } from 'vitest';
import { readTtl, parseToStore, validateAgainst } from '../_helpers/loadGraph.js';

const shapesTtl = readTtl('schema/cbox/electrical/din-vde-0100.shapes.ttl');
const tboxTtl = readTtl('schema/tbox/dhc-core.schema.ttl');
const withTbox = (fixture) => tboxTtl + '\n' + fixture;

describe('C-Box — din-vde-0100.shapes.ttl', () => {
  it('parses cleanly', () => {
    const store = parseToStore(shapesTtl);
    expect(store.size).toBeGreaterThan(20);
  });

  it('conforms for valid DE lighting circuit (16 A acceptable)', async () => {
    const data = readTtl('tests/fixtures/valid-de-lighting-circuit.ttl');
    const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
    expect(conforms, JSON.stringify(results, null, 2)).toBe(true);
  });

  it('flags DE socket circuit missing RCD protection', async () => {
    const data = readTtl('tests/fixtures/invalid-de-socket-no-rcd.ttl');
    const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
    expect(conforms).toBe(false);
    expect(results.some(r => /RCD|FI|protection|Protection/.test(r.message || ''))).toBe(true);
  });
});
