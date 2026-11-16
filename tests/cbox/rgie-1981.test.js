import { describe, it, expect } from 'vitest';
import { readTtl, parseToStore, validateAgainst } from '../_helpers/loadGraph.js';

// RGIE 1981 is a DRAFT (see the shapes file's header): these tests pin what
// the draft says, so a correction after reading the text is a visible change.
const shapesTtl = readTtl('schema/cbox/electrical/rgie-1981.shapes.ttl');
const tboxTtl = readTtl('schema/tbox/dhc-core.ttl');
const withTbox = (fixture) => tboxTtl + '\n' + fixture;
const EX = 'http://example.org/';

describe('C-Box — rgie-1981.shapes.ttl (draft)', () => {
  it('parses cleanly and names the Belgian norm', () => {
    const store = parseToStore(shapesTtl);
    expect(store.size).toBeGreaterThan(40);
    expect(shapesTtl).toMatch(/dhc:normCountry\s+"BE"/);
  });

  it('conforms for a board built as the draft wants', async () => {
    const { conforms, results } = await validateAgainst(shapesTtl, withTbox(readTtl('tests/fixtures/valid-be-rgie-1981.ttl')));
    expect(conforms, JSON.stringify(results, null, 2)).toBe(true);
  });

  it('flags each breach on its own node, and nothing on the 30 mA device', async () => {
    const { conforms, results } = await validateAgainst(shapesTtl, withTbox(readTtl('tests/fixtures/invalid-be-rgie-1981.ttl')));
    expect(conforms).toBe(false);
    // a result inside an sh:or or a property shape reports a blank node as
    // its source, so the breach is recognised by node and by message
    const on = (node) => results.filter(r => r.focus === EX + node);
    const said = (node, re) => on(node).some(r => re.test(r.message || ''));
    expect(said('be-rcd-500', /300 mA/)).toBe(true);
    expect(on('be-sockets-thin').length).toBeGreaterThan(0);
    expect(on('be-light-20').length).toBeGreaterThan(0);
    expect(on('be-oven-25-on-25').length).toBeGreaterThan(0);
    expect(said('be-no-rcd', /general differential/)).toBe(true);
    expect(on('be-rcd-30')).toHaveLength(0);
  });

  it('a 2.5 mm² circuit at 20 A passes the section rule, at 25 A it does not', async () => {
    const ttl = (a) => `@prefix dhc: <https://digitalhome.cloud/ontology#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${EX}r> a dhc:RCD ; dhc:sensitivityMA "300"^^xsd:decimal .
      <${EX}c> a dhc:Circuit ; dhc:ratedCurrent "${a}"^^xsd:decimal ; dhc:crossSection "2.5"^^xsd:decimal ; dhc:hasProtection <${EX}r> .`;
    expect((await validateAgainst(shapesTtl, withTbox(ttl(20)))).conforms).toBe(true);
    expect((await validateAgainst(shapesTtl, withTbox(ttl(25)))).conforms).toBe(false);
  });
});
