import { describe, it, expect } from 'vitest';
import { readTtl, parseToStore, validateAgainst, namedNode } from '../_helpers/loadGraph.js';

const DHC = 'https://digitalhome.cloud/ontology#';

const shapesTtl = readTtl('schema/cbox/electrical/bs7671.shapes.ttl');
const tboxTtl = readTtl('schema/tbox/dhc-core.schema.ttl');
const withTbox = (fixture) => tboxTtl + '\n' + fixture;

describe('C-Box — bs7671.shapes.ttl', () => {
  it('parses cleanly', () => {
    const store = parseToStore(shapesTtl);
    expect(store.size).toBeGreaterThan(20);
  });

  it('defines at least 3 dhc:defaultValue attachments', () => {
    const store = parseToStore(shapesTtl);
    const defaults = [...store.match(null, namedNode(`${DHC}defaultValue`), null)];
    expect(defaults.length).toBeGreaterThanOrEqual(3);
  });

  it('conforms for valid UK ring final circuit', async () => {
    const data = readTtl('tests/fixtures/valid-gb-ring-final.ttl');
    const { conforms, results } = await validateAgainst(shapesTtl, withTbox(data));
    expect(conforms, JSON.stringify(results, null, 2)).toBe(true);
  });
});
