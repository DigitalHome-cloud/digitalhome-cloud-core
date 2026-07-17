import { describe, it, expect } from 'vitest';
import { readTtl, parseToStore, namedNode } from '../_helpers/loadGraph.js';
import fs from 'node:fs';
import path from 'node:path';

const SHACL = 'http://www.w3.org/ns/shacl#';
const DHC = 'https://digitalhome.cloud/ontology#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';

const tbox = parseToStore(readTtl('schema/tbox/dhc-core.ttl'));

const CBOX_DIR = 'schema/cbox/electrical';
const shapeFiles = fs.readdirSync(
  path.join(new URL('../..', import.meta.url).pathname, CBOX_DIR),
).filter(f => f.endsWith('.shapes.ttl'));

// ── The dead-guard bug class ──────────────────────────────────────────────
//
// sh:hasValue matches RDF *terms*, not numbers. `sh:hasValue 32` is an
// xsd:integer; dhc:ratedCurrent is always xsd:decimal. The guard therefore
// never matches, sh:not is always true, the enclosing sh:or is always
// satisfied — and the shape can NEVER fire. It reports conforms:true forever.
//
// This silently disabled nfc15100:IRVE32AMonoShape, nfc15100:IRVE32ATriShape
// and bs7671:RingFinalCircuitShape_GB. Nothing noticed, because a shape that
// cannot fire looks exactly like a shape with nothing to complain about.
//
// The T-Box declares rdfs:range on every one of these properties, so the
// check is mechanical. sh:minInclusive / sh:maxInclusive compare numerically
// and are immune — this only concerns term-matching constraints.

describe('C-Box — guard literals match their property datatype', () => {
  for (const file of shapeFiles) {
    const shapes = parseToStore(readTtl(`${CBOX_DIR}/${file}`));

    it(`${file}: every sh:hasValue literal matches the sh:path property's rdfs:range`, () => {
      const offenders = [];

      // Each property shape carrying both sh:path and sh:hasValue
      for (const pathQ of shapes.match(null, namedNode(`${SHACL}path`), null)) {
        const subject = pathQ.subject;
        const prop = pathQ.object;
        if (prop.termType !== 'NamedNode' || !prop.value.startsWith(DHC)) continue;

        const range = [...tbox.match(prop, namedNode(`${RDFS}range`), null)][0]?.object.value;
        if (!range) continue; // no declared range → nothing to check against

        for (const hv of shapes.match(subject, namedNode(`${SHACL}hasValue`), null)) {
          if (hv.object.termType !== 'Literal') continue; // IRI values (enums) are fine
          const dt = hv.object.datatype?.value;
          if (dt !== range) {
            offenders.push(
              `${prop.value.replace(DHC, 'dhc:')} declares range ${range.split('#')[1]} ` +
              `but sh:hasValue "${hv.object.value}" is ${dt?.split('#')[1] ?? 'plain'} ` +
              `— this guard can never match, disabling the whole shape`,
            );
          }
        }
      }

      expect(offenders).toEqual([]);
    });
  }
});

// ── dhc:shapesFile must point at a file that exists ───────────────────────
//
// The T-Box models shapes per NormEdition; reality ships one profile per norm
// under cbox/electrical/. Four editions carried paths into a per-edition
// layout that never existed (cbox/nfc15100/nfc15100-2024.shapes.ttl). Dead
// metadata nothing checked. An edition with no authored shapes now simply
// omits dhc:shapesFile rather than pointing at a fiction.

describe('T-Box — every dhc:shapesFile resolves to a real file', () => {
  const repoRoot = new URL('../..', import.meta.url).pathname;

  it('no NormEdition points at a shapes file that does not exist', () => {
    const declared = [...tbox.match(null, namedNode(`${DHC}shapesFile`), null)]
      .map(q => ({ edition: q.subject.value.replace(DHC, 'dhc:'), file: q.object.value }));

    const broken = declared
      .filter(({ file }) => !fs.existsSync(path.join(repoRoot, 'schema', file)))
      .map(({ edition, file }) => `${edition} -> schema/${file} (no such file)`);

    expect(broken).toEqual([]);
  });

  it('the editions that do declare shapes agree with the profile version', () => {
    // Each edition names the file implementing IT. nfc15100-2015.shapes.ttl
    // declares normVersion "2015-A5"; nfc15100-2024.shapes.ttl declares "2024"
    // and carries only the delta.
    const forNfc15100 = [...tbox.match(
      namedNode(`${DHC}NormEdition_NFC15100_2015`), namedNode(`${DHC}shapesFile`), null,
    )].map(q => q.object.value);
    expect(forNfc15100).toEqual(['cbox/electrical/nfc15100-2015.shapes.ttl']);

    // This assertion used to be the exact opposite — "NFC15100:2024 must not
    // claim shapes that were never authored" — and it was right at the time.
    // The edition in force having no shapes is what made every "ok" mean
    // "passes the 2015 rules", never "compliant today". Now the shapes exist
    // (illustrative, and loudly marked so), and the invariant flips: the
    // edition in force MUST declare shapes, or the whole comparison degrades to
    // pass/fail against whichever edition we happen to hold.
    const on2024 = [...tbox.match(
      namedNode(`${DHC}NormEdition_NFC15100_2024`), namedNode(`${DHC}shapesFile`), null,
    )].map(q => q.object.value);
    expect(on2024, 'the edition in force must declare shapes — otherwise nothing can be proven current').toEqual(['cbox/electrical/nfc15100-2024.shapes.ttl']);
  });
});

// ── The unclaimed-shapes bug class ────────────────────────────────────────
//
// build-abox.mjs drives validation from dhc:shapesFile, not from the directory
// listing, because a verdict has to be attributable to an EDITION to mean
// anything. The cost of that choice: a shapes file no edition claims silently
// stops running. And SHACL's answer to "nothing ran" is conforms:true — the
// same green as "checked everything, all fine".
//
// The build fails loudly on this. So does this test, one layer earlier and
// without needing an A-Box.

describe('C-Box — every shapes file is claimed by exactly one edition', () => {
  const claims = [...tbox.match(null, namedNode(`${DHC}shapesFile`), null)]
    .map(q => ({ edition: q.subject.value.replace(DHC, 'dhc:'), file: path.basename(q.object.value) }));

  it('no shapes file on disk is orphaned', () => {
    const claimed = new Set(claims.map(c => c.file));
    const orphans = shapeFiles.filter(f => !claimed.has(f));
    expect(orphans, 'shapes that run under no edition, or stop running entirely').toEqual([]);
  });

  it('no two editions claim the same file', () => {
    // Two editions sharing a file makes their verdicts identical, so the
    // ok/gap comparison silently answers "nothing ever changed".
    const seen = new Map();
    const dupes = [];
    for (const c of claims) {
      if (seen.has(c.file)) dupes.push(`${c.file}: ${seen.get(c.file)} and ${c.edition}`);
      seen.set(c.file, c.edition);
    }
    expect(dupes).toEqual([]);
  });
});

// ── The overridden-shape bug class ────────────────────────────────────────
//
// An edition's effective rule set is its own file concatenated with every file
// down the dhc:supersedes chain. Concatenation ANDs constraints, which is what
// makes a tightening work: 2015 says ≥ 10 mm², 2024 says ≥ 16, both run, the
// stricter one decides.
//
// It only works because the two are DIFFERENT shapes. Reuse an IRI and RDF
// merges the two definitions onto one subject — sh:minInclusive 10 AND 16 on a
// single property shape — and the "does it pass 2015?" question can no longer
// be asked, because the 2015 shape no longer exists in isolation. Nothing
// errors; the graph is perfectly valid; the comparison just quietly answers
// something else.

describe('C-Box — a delta never reuses a base shape IRI', () => {
  const shapeIrisIn = (file) => {
    const s = parseToStore(readTtl(`${CBOX_DIR}/${file}`));
    return new Set([...s.match(null, namedNode(`${SHACL}targetClass`), null)].map(q => q.subject.value));
  };

  it('nfc15100-2024 introduces only new shape IRIs', () => {
    const base = shapeIrisIn('nfc15100-2015.shapes.ttl');
    const overlap = [...shapeIrisIn('nfc15100-2024.shapes.ttl')].filter(i => base.has(i));
    expect(overlap, 'a delta shape sharing the base IRI merges the two editions into one').toEqual([]);
  });

  it('and it is not vacuous — the delta actually carries shapes', () => {
    // Guards the guard: an empty delta file passes the test above trivially.
    expect(shapeIrisIn('nfc15100-2024.shapes.ttl').size).toBeGreaterThan(0);
  });
});
