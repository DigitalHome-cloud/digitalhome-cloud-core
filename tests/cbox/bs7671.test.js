import { describe, it, expect } from 'vitest';
import { readTtl, parseToStore, validateAgainst } from '../_helpers/loadGraph.js';

const shapesTtl = readTtl('schema/cbox/electrical/bs7671.shapes.ttl');
const tboxTtl = readTtl('schema/tbox/dhc-core.schema.ttl');
const withTbox = (fixture) => tboxTtl + '\n' + fixture;

describe('C-Box — bs7671.shapes.ttl', () => {
  it('parses cleanly', () => {
    const store = parseToStore(shapesTtl);
    expect(store.size).toBeGreaterThan(20);
  });

  it('conforms for valid UK ring final circuit', async () => {
    const data = readTtl('tests/fixtures/valid-gb-ring-final.ttl');
    const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
    expect(conforms, JSON.stringify(results, null, 2)).toBe(true);
  });
});
