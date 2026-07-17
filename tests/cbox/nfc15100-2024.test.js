import { describe, it, expect } from 'vitest';
import { readTtl, parseToStore, validateAgainst, namedNode } from '../_helpers/loadGraph.js';

const SHACL = 'http://www.w3.org/ns/shacl#';
const DHC = 'https://digitalhome.cloud/ontology#';

// ⚠ The rules under test are ILLUSTRATIVE, not sourced from the published
// NF C 15-100:2024 text. See the header of nfc15100-2024.shapes.ttl. What is
// being tested here is the MECHANISM — that a per-edition delta fires, that it
// fires only where it should, and that the older edition still answers
// independently. Swap in the real numbers and these tests keep their meaning.

const deltaTtl = readTtl('schema/cbox/electrical/nfc15100-2024.shapes.ttl');
const baseTtl = readTtl('schema/cbox/electrical/nfc15100-2015.shapes.ttl');
const tboxTtl = readTtl('schema/tbox/dhc-core.ttl');
const withTbox = (fixture) => tboxTtl + '\n' + fixture;

// The effective 2024 rule set is the delta concatenated onto its base, exactly
// as build-abox.mjs assembles it by walking dhc:supersedes. Testing the delta
// ALONE would be testing something that never runs.
const effective2024 = deltaTtl + '\n' + baseTtl;

describe('C-Box — nfc15100-2024.shapes.ttl (delta)', () => {
  const store = parseToStore(deltaTtl);

  it('parses and declares shapes', () => {
    const shapes = [...store.match(null, namedNode(`${SHACL}targetClass`), null)];
    expect(shapes.length, 'an empty delta would pass every test below vacuously').toBeGreaterThan(0);
  });

  it('every shape is marked UNVERIFIED', () => {
    // The marker is the only thing standing between an illustrative number and
    // someone quoting it as law. A shape gets read on its own far more often
    // than a file header does, so the marker has to be ON the shape.
    const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
    const shapes = [...new Set([...store.match(null, namedNode(`${SHACL}targetClass`), null)].map(q => q.subject.value))];
    const unmarked = shapes.filter((s) => {
      const comments = [...store.match(namedNode(s), namedNode(`${RDFS}comment`), null)].map(q => q.object.value);
      return !comments.some(c => c.includes('UNVERIFIED'));
    });
    expect(unmarked, 'an illustrative rule with no marker is indistinguishable from law').toEqual([]);
  });
});

describe('IRVE 32 A single-phase — the tightening (10 mm² → 16 mm²)', () => {
  // This shape is the reason the "gap" state exists on screen. Both directions
  // matter and both are asserted: it must fire on 10 mm², and the 2015 shapes
  // must NOT — otherwise "grandfathered" collapses into "broken".

  it('16 mm² conforms under 2024', async () => {
    const data = readTtl('tests/fixtures/valid-fr-2024-irve-32a.ttl');
    const { conforms, results } = await validateAgainst(effective2024, withTbox(data));
    expect(results, 'a compliant circuit must produce no results — false positives are as bad as no-ops').toEqual([]);
    expect(conforms).toBe(true);
  });

  it('10 mm² is REJECTED under 2024', async () => {
    const data = readTtl('tests/fixtures/invalid-fr-2024-irve-32a-undersized.ttl');
    const { conforms, results } = await validateAgainst(effective2024, withTbox(data));
    expect(conforms, 'the 2024 delta is a no-op — yellow can never appear').toBe(false);
    // sh:or guarded shapes report the named shape and no message (CLAUDE.md).
    expect(results.some(r => /IRVE32AMono2024Shape/.test(r.sourceShape ?? ''))).toBe(true);
  });

  it('…and the SAME file conforms under 2015 — that pair IS grandfathering', async () => {
    // The load-bearing assertion in this file. If 2015 also rejected it, the
    // installation would simply be non-compliant. It is the difference between
    // the two verdicts that makes it lawful-as-built, and that difference is
    // the only thing distinguishing yellow from red.
    const data = readTtl('tests/fixtures/invalid-fr-2024-irve-32a-undersized.ttl');
    const { conforms, results } = await validateAgainst(baseTtl, withTbox(data));
    expect(results, '10 mm² is CORRECT under 2015 — rejecting it here would make a lawful pool look broken').toEqual([]);
    expect(conforms).toBe(true);
  });
});

describe('energy storage — the coverage expansion', () => {
  // A different kind of delta: 2024 does not tighten a number, it brings a
  // class into scope that 2015 never looked at. Worth its own test because a
  // model that only ever compares numbers cannot express it.

  it('a governed battery conforms under 2024', async () => {
    const data = readTtl('tests/fixtures/valid-fr-2024-irve-32a.ttl');
    const { results } = await validateAgainst(effective2024, withTbox(data));
    expect(results.filter(r => /ESSGovernanceShape/.test(r.sourceShape ?? ''))).toEqual([]);
  });

  it('an ungoverned battery is REJECTED under 2024', async () => {
    const data = readTtl('tests/fixtures/invalid-fr-2024-ess-ungoverned.ttl');
    const { conforms, results } = await validateAgainst(effective2024, withTbox(data));
    expect(conforms).toBe(false);
    // Plain sh:property shape (no sh:or guard) → blank-node sourceShape, but it
    // DOES carry sh:path. Assert on the path, per CLAUDE.md's table.
    expect(results.some(r => r.path === `${DHC}governedBy`)).toBe(true);
  });

  it('…and the same battery conforms under 2015 — because NOTHING TARGETS IT', async () => {
    // The trap, asserted rather than assumed. This "pass" is not approval, it
    // is the absence of any rule: SHACL reports only failures, so out-of-scope
    // and checked-and-clean are the same silence. The viewer draws the
    // difference as transparency; without this test, someone would eventually
    // read the 2015 green as a verdict.
    const data = readTtl('tests/fixtures/invalid-fr-2024-ess-ungoverned.ttl');
    const { conforms } = await validateAgainst(baseTtl, withTbox(data));
    expect(conforms, 'a 2015 shape now targets brick:Battery — the coverage-expansion demo is gone').toBe(true);

    const base = parseToStore(baseTtl);
    const targets = [...base.match(null, namedNode(`${SHACL}targetClass`), null)].map(q => q.object.value);
    expect(targets, '2015 must not target a battery — that is what makes 2024 an expansion').not.toContain('https://brickschema.org/schema/Brick#Battery');
  });
});
