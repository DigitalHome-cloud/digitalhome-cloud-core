import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readTtl, parseToStore, namedNode, repoRoot } from '../_helpers/loadGraph.js';

const DHC = 'https://digitalhome.cloud/ontology#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

const tbox = parseToStore(
  readTtl('schema/tbox/dhc-core.ttl') + '\n' + readTtl('schema/tbox/dhc-app-metadata.ttl'),
);
const abox = parseToStore(readTtl('schema/abox/electrical-installation-house.ttl'));

const short = (v) => v.replace(DHC, 'dhc:');
const subjects = (pred) => [...tbox.match(null, namedNode(`${DHC}${pred}`), null)];
const objectsOf = (s, pred, store = tbox) =>
  [...store.match(namedNode(s), namedNode(`${DHC}${pred}`), null)].map((q) => q.object.value);
const typed = (cls) =>
  [...tbox.match(null, namedNode(`${RDF}type`), namedNode(`${DHC}${cls}`))].map((q) => q.subject.value);

// ── The grandfathering chain ──────────────────────────────────────────────
//
// Compliance is COMPUTED: js-tools/build-abox.mjs validates the A-Box against
// every edition that declares dhc:shapesFile and compares the verdicts. Green
// means "passes the edition in force"; yellow means "passes an older one and
// fails the current" — grandfathered.
//
// That rests entirely on four T-Box properties, and every one of them fails
// silently when broken:
//
//   dhc:editionOf     edition → norm.        Unresolvable ⇒ no norm ⇒ no verdict.
//   dhc:latestEdition norm → edition in force. Missing ⇒ nothing can be called
//                     current, so nothing is ever honestly green.
//   dhc:supersedes    the chain build-abox walks to concatenate a delta onto its
//                     base. Broken ⇒ the 2024 run silently loses the 2015 rules
//                     and reports far too little.
//   dhc:shapesFile    edition → the shapes implementing it. Missing ⇒ that
//                     edition is never validated at all, and SHACL's answer to
//                     "nothing ran" is conforms:true.
//
// dhc:latestEdition was DEFINED for months and never once ASSERTED — it parsed,
// it had a label, and every occurrence in the file was inside an rdfs:comment.
// Nothing noticed, because nothing read it yet.
//
// So these are not schema-tidiness assertions. Each one, if it fails, means the
// compliance colouring silently lies rather than errors.

describe('norm editions — the chain that makes grandfathering computable', () => {
  const norms = typed('Norm');
  const editions = typed('NormEdition');

  it('the T-Box declares norms and editions at all', () => {
    // Guards the guards: every assertion below is vacuously true over an empty
    // set, so a rename that empties these would turn this whole file green.
    expect(norms.length, 'no dhc:Norm instances').toBeGreaterThan(0);
    expect(editions.length, 'no dhc:NormEdition instances').toBeGreaterThan(0);
  });

  it('every dhc:Norm asserts exactly one dhc:latestEdition', () => {
    const bad = norms
      .map((n) => ({ n: short(n), count: objectsOf(n, 'latestEdition').length }))
      .filter((x) => x.count !== 1);
    expect(bad, 'a norm with no latestEdition makes every node under it "edition undeclared"').toEqual([]);
  });

  it('every dhc:NormEdition asserts dhc:editionOf a declared dhc:Norm', () => {
    const declared = new Set(norms);
    const bad = editions
      .map((e) => ({ e: short(e), of: objectsOf(e, 'editionOf') }))
      .filter((x) => x.of.length !== 1 || !declared.has(x.of[0]))
      .map((x) => `${x.e} → ${x.of.map(short).join(', ') || '(none)'}`);
    expect(bad, 'an edition that resolves to no norm cannot be compared to a latest').toEqual([]);
  });

  it('dhc:latestEdition round-trips: the latest edition is an edition OF that norm', () => {
    const bad = [];
    for (const n of norms) {
      for (const e of objectsOf(n, 'latestEdition')) {
        const back = objectsOf(e, 'editionOf');
        if (!back.includes(n)) bad.push(`${short(n)} → ${short(e)} → ${back.map(short).join(', ') || '(none)'}`);
      }
    }
    // Without this, Norm_A could name an edition of Norm_B and every
    // comparison would quietly answer the wrong question.
    expect(bad, 'latestEdition points at an edition belonging to another norm').toEqual([]);
  });

  it('dhc:supersedes never forms a cycle, and never crosses norms', () => {
    const bad = [];
    for (const q of subjects('supersedes')) {
      const [a, b] = [q.subject.value, q.object.value];
      if (a === b) bad.push(`${short(a)} supersedes itself`);
      const [na, nb] = [objectsOf(a, 'editionOf')[0], objectsOf(b, 'editionOf')[0]];
      if (na && nb && na !== nb) bad.push(`${short(a)} supersedes ${short(b)} across norms`);
    }
    expect(bad).toEqual([]);
  });
});

describe('the edition→shapes binding', () => {
  const editions = typed('NormEdition');

  it('the edition in force declares shapes for every norm that has any', () => {
    // The sharpest one. If the LATEST edition has no shapes, every node under
    // that norm is validated against superseded rules and can never honestly be
    // called compliant — which is precisely the state NF C 14-100 is in, and
    // why its nodes render ghosted rather than green. Asserting it for norms
    // that have shapes at all keeps that an explicit, visible exception instead
    // of a silent default.
    const withShapes = typed('Norm').filter((n) =>
      editions.some((e) => objectsOf(e, 'editionOf')[0] === n && objectsOf(e, 'shapesFile').length));
    const bad = withShapes
      .filter((n) => {
        const latest = objectsOf(n, 'latestEdition')[0];
        return !latest || objectsOf(latest, 'shapesFile').length === 0;
      })
      .map(short);
    expect(bad, 'norm whose edition in force has no shapes — nothing under it can be proven current').toEqual(['dhc:Norm_NFC14100']);
  });

  it('every edition that declares shapes resolves to a norm with a latestEdition', () => {
    // The precise condition under which the state machine cannot tell current
    // from superseded. `undefined` is not "not superseded" — it is "no idea",
    // and an earlier cut of this logic painted exactly that green.
    const bad = editions
      .filter((e) => objectsOf(e, 'shapesFile').length)
      .filter((e) => {
        const norm = objectsOf(e, 'editionOf')[0];
        return !norm || objectsOf(norm, 'latestEdition').length === 0;
      })
      .map(short);
    expect(bad, 'unresolvable edition — compliance would be uncomputable, not green').toEqual([]);
  });

  it('a delta edition can reach its base through dhc:supersedes', () => {
    // build-abox.mjs builds the effective rule set by walking this chain. An
    // edition with shapes but no path to another edition with shapes is either
    // a base (fine) or a delta that silently lost its base (not fine: it would
    // then enforce ONLY its own two rules and report almost everything as
    // passing).
    const withShapes = editions.filter((e) => objectsOf(e, 'shapesFile').length);
    const reaches = (e) => {
      for (let c = objectsOf(e, 'supersedes')[0]; c; c = objectsOf(c, 'supersedes')[0]) {
        if (objectsOf(c, 'shapesFile').length) return true;
      }
      return false;
    };
    // NFC15100:2024 ships a delta, so it MUST reach 2015.
    expect(reaches(`${DHC}NormEdition_NFC15100_2024`), 'the 2024 delta cannot reach the 2015 base — it would enforce only its own rules').toBe(true);
    expect(withShapes.length, 'no edition declares shapes at all').toBeGreaterThan(1);
  });
});

describe('the reference A-Box exercises every compliance state', () => {
  // This is the anti-vacuity bar for the whole edition mechanism, and it is
  // load-bearing. The states are COMPUTED now — nothing in the A-Box declares
  // them — so a dead 2024 shape, a broken supersedes link, or a guard with the
  // wrong datatype does not throw. It just quietly produces a model where
  // everything is green, which looks like success.
  //
  // It reads the BUILT graph, so it tests what the viewer actually shows.
  //
  // That artifact is gitignored and `npm test` does not build it. This block
  // therefore used to be written with `it.runIf(built)` — which meant that on a
  // fresh clone, in CI, or for anyone who had not happened to run
  // `npm run build:abox` first, the three tests guarding the whole mechanism
  // SKIPPED and vitest reported green.
  //
  // The guards against vacuous success were themselves vacuous. Fail loudly
  // instead: a skipped test and a passing test look identical in a summary line.
  const graphPath = 'js-tools/data/electrical-installation-house.graph.json';
  const full = path.join(repoRoot, graphPath);
  const built = fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, 'utf8')) : null;

  it('the built graph exists — run `npm run build:abox` first', () => {
    expect(built, `${graphPath} is missing. It is gitignored and npm test does not build it, so these assertions cannot run. Run: npm run build:abox`).toBeTruthy();
  });

  it('the built graph is current — it was generated from the A-Box as it stands', () => {
    // A stale artifact is worse than a missing one: it asserts against what a
    // PREVIOUS version of the state machine produced, so the tests pass while
    // describing code that no longer exists.
    const src = fs.statSync(path.join(repoRoot, 'schema/abox/electrical-installation-house.ttl')).mtimeMs;
    const gen = fs.statSync(full).mtimeMs;
    expect(gen, 'the A-Box is newer than the built graph — rebuild before trusting these').toBeGreaterThan(src);
  });

  it('demonstrates ok AND gap AND danger', () => {
    const t = built.tally;
    expect(t.ok, 'nothing passes the edition in force').toBeGreaterThan(0);
    expect(t.gap, 'nothing is grandfathered — the state this whole mechanism exists for is unexercised').toBeGreaterThan(0);
    expect(t.danger, 'nothing fails — the deliberate defect stopped being reported').toBeGreaterThan(0);
  });

  it('ex:circuit-ev is the KNOWN grandfathering case: gap, and solid', () => {
    // The single most important node in the model. 10 mm² satisfies :2015 and
    // fails :2024. If this ever goes green, the 2024 delta is a no-op — and if
    // it goes ghosted, its dhc:builtUnder evidence stopped being read, so the
    // tool can no longer tell a documented grandfathered circuit from one whose
    // history is unknown.
    const n = built.nodes.find((x) => x.curie === 'ex:circuit-ev');
    expect(n, 'ex:circuit-ev missing from the built graph').toBeTruthy();
    expect(n.compliance, `should be grandfathered, got "${n?.compliance}" — the 2024 delta is not firing`).toBe('gap');
    expect(n.ghosted, 'it declares dhc:builtUnder 2015 and passes it, so grandfathering is KNOWN — it must be solid, not ghosted').toBe(false);
  });

  it('ex:circuit-ev-legacy still fails the OLDEST edition', () => {
    // The deliberate defect. It must fail 2015, not merely 2024 — failing only
    // the current edition would make it grandfathered, i.e. lawful, which is
    // the opposite of what the file exists to demonstrate.
    const n = built.nodes.find((x) => x.curie === 'ex:circuit-ev-legacy');
    expect(n?.compliance, 'the deliberate defect is no longer reported as never-compliant').toBe('danger');
  });
});

describe('compliance-states.ttl — every state, one knob apart', () => {
  // The state machine's builtUnder logic is where the F1 design decision lives,
  // and it is the highest-risk code in the tool. This example isolates it: five
  // IRVE circuits differing only in cross-section and dhc:builtUnder. Asserted
  // against the built graph, so it tests what the viewer shows.
  const full = path.join(repoRoot, 'js-tools/data/compliance-states.graph.json');
  const built = fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, 'utf8')) : null;
  const stateOf = (curie) => {
    const n = built?.nodes.find((x) => x.curie === curie);
    return n ? `${n.compliance}/${n.ghosted ? 'ghost' : 'solid'}` : '(missing)';
  };

  it('the built graph exists — run `npm run build:abox` first', () => {
    expect(built, 'js-tools/data/compliance-states.graph.json is missing; run: npm run build:abox').toBeTruthy();
  });

  // Each case names the fact that produces it, so a regression points at a cause.
  it('ok — meets the edition in force (16 mm²)', () => {
    expect(stateOf('ex:ev-current')).toBe('ok/solid');
  });
  it('gap SOLID — builtUnder 2015, passes it, fails 2024: KNOWN grandfathered', () => {
    expect(stateOf('ex:ev-grandfathered')).toBe('gap/solid');
  });
  it('gap GHOSTED — same wire, no builtUnder: cannot tell grandfathered from newly-illegal', () => {
    // The heart of the F1 decision. If this ever reads solid, the tool is
    // asserting a lawfulness it cannot compute.
    expect(stateOf('ex:ev-unknown')).toBe('gap/ghost');
  });
  it('danger — builtUnder 2024, fails 2024: illegal as built, not grandfathered', () => {
    // Differs from ex:ev-grandfathered by ONE triple (the claimed edition).
    // Same cross-section; the evidence is the whole difference. This state was
    // invisible while compliance was declared rather than checked.
    expect(stateOf('ex:ev-illegal')).toBe('danger/solid');
  });
  it('danger — 1.5 mm², fails even the oldest edition: never compliant', () => {
    expect(stateOf('ex:ev-never')).toBe('danger/solid');
  });

  it('conforms is false (two danger), and the gaps do not count against it', () => {
    const r = JSON.parse(fs.readFileSync(path.join(repoRoot, 'js-tools/data/compliance-states.report.json'), 'utf8'));
    expect(r.conforms, 'two circuits are danger — this must not conform').toBe(false);
    expect(built.tally.danger).toBe(2);
    expect(built.tally.gap).toBe(2);
  });
});
