import { describe, it, expect } from 'vitest';
import { readTtl, parseToStore, namedNode } from '../_helpers/loadGraph.js';
import fs from 'node:fs';
import path from 'node:path';

const DHC = 'https://digitalhome.cloud/ontology#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

const tbox = parseToStore(
  readTtl('schema/tbox/dhc-core.ttl') + '\n' + readTtl('schema/tbox/dhc-app-metadata.ttl'),
);

const repoRoot = new URL('../..', import.meta.url).pathname;
const fixtures = fs.readdirSync(path.join(repoRoot, 'tests/fixtures'))
  .filter(f => f.endsWith('.ttl'))
  .map(f => `tests/fixtures/${f}`);
// Globbed, not listed. A hardcoded list means a new example under schema/abox/
// is covered by nothing at all — and the failure mode it would miss is exactly
// the one below: a fabricated dhc: term selects no focus nodes, so the file
// validates green while meaning nothing. The check has to arrive with the file,
// not with someone remembering to add a line here.
const models = fs.readdirSync(path.join(repoRoot, 'schema/abox'))
  .filter(f => f.endsWith('.ttl'))
  .map(f => `schema/abox/${f}`);
const aboxes = [...models, ...fixtures];

// Guards the guard: if schema/abox/ is empty or renamed, every it() below
// vanishes and the suite reports green having tested nothing.
describe('A-Box — there are models to check', () => {
  it('schema/abox/ is not empty', () => {
    expect(models.length, 'no A-Box models found — every join test below would vanish silently').toBeGreaterThan(0);
  });
});

// ── The fabricated-term bug class ─────────────────────────────────────────
//
// RDF accepts any IRI. Typing an instance as a class that does not exist, or
// hanging a predicate that was never declared, produces no error: the file
// parses, and SHACL simply finds no focus nodes for the missing class and
// reports conforms:true.
//
// This is the A-Box analogue of the sh:path/sh:targetClass join check in
// tests/cbox/nfc15100.test.js. It exists because the reference A-Box — the
// file whose whole job is to demonstrate the discipline — shipped referencing
// dhc:cableSpec (invented; the real property is dhc:wiring) plus dhc:RCD,
// dhc:Socket and dhc:BusBar while those were still draft-only. Everything
// validated green.
//
// A term living in schema/draft/ is NOT usable from an A-Box. Promote it via
// py-tools/ontology_explorer.py [4] first.

describe('A-Box — every dhc: term resolves in the T-Box', () => {
  for (const rel of aboxes) {
    const store = parseToStore(readTtl(rel));

    it(`${rel}: classes are declared`, () => {
      const used = new Set(
        [...store.match(null, namedNode(`${RDF}type`), null)]
          .map(q => q.object.value)
          .filter(v => v.startsWith(DHC)),
      );
      const missing = [...used]
        .filter(c => [...tbox.match(namedNode(c), null, null)].length === 0)
        .map(c => c.replace(DHC, 'dhc:'));
      expect(missing, 'undefined class — still in schema/draft/, or invented').toEqual([]);
    });

    it(`${rel}: predicates are declared`, () => {
      const used = new Set(
        [...store.match(null, null, null)]
          .map(q => q.predicate.value)
          .filter(v => v.startsWith(DHC)),
      );
      const missing = [...used]
        .filter(p => [...tbox.match(namedNode(p), null, null)].length === 0)
        .map(p => p.replace(DHC, 'dhc:'));
      expect(missing, 'undefined predicate — still in schema/draft/, or invented').toEqual([]);
    });
  }
});
