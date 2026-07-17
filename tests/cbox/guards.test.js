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
    // nfc15100.shapes.ttl declares normVersion "2015-A5", so it implements the
    // 2015 edition — not dhc:latestEdition (2024), which has no shapes yet.
    const forNfc15100 = [...tbox.match(
      namedNode(`${DHC}NormEdition_NFC15100_2015`), namedNode(`${DHC}shapesFile`), null,
    )].map(q => q.object.value);
    expect(forNfc15100).toEqual(['cbox/electrical/nfc15100.shapes.ttl']);

    const on2024 = [...tbox.match(
      namedNode(`${DHC}NormEdition_NFC15100_2024`), namedNode(`${DHC}shapesFile`), null,
    )];
    expect(on2024, 'NFC15100:2024 must not claim shapes that were never authored').toEqual([]);
  });
});
