import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, readTtl, parseToStore, namedNode } from '../_helpers/loadGraph.js';

const manifestPath = path.join(repoRoot, 'schema/cbox/cbox-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const tboxTtl = readTtl('schema/tbox/dhc-core.ttl');
const tboxStore = parseToStore(tboxTtl);

describe('C-Box manifest', () => {
  it('declares version 3.1.0 and ≥1 profile', () => {
    // 3.1.0 = one profile per EDITION, not per norm. Compliance is computed by
    // validating against each edition and comparing verdicts; a single profile
    // per norm cannot express that.
    expect(manifest.version).toBe('3.1.0');
    expect(manifest.profiles.length).toBeGreaterThan(0);
  });

  // Scoped to France while the v3 core is prototyped. DIN VDE 0100 (DE),
  // AREI/RGIE (BE) and BS 7671 (GB) were removed in v3.0.0 — shapes, tests,
  // fixtures and Norm instances together — and return once dhc-core is
  // released. Keeping a profile whose shapes or Norm no longer exist is the
  // dangling-reference failure the guards tests exist to prevent.
  it('contains the French electrical profiles, one per edition', () => {
    const ids = manifest.profiles.map(p => p.id);
    expect(new Set(ids)).toEqual(new Set(['nfc15100-2015', 'nfc15100-2024', 'nfc14100-2008']));
  });

  it('every profile is French while the core is prototyped', () => {
    expect(manifest.profiles.map(p => p.country)).toEqual(manifest.profiles.map(() => 'FR'));
  });

  // The T-Box's dhc:shapesFile is authoritative; this manifest mirrors it so
  // downstream apps can enumerate profiles without parsing Turtle. Two copies
  // of one fact drift silently unless something compares them — and a manifest
  // pointing at the wrong edition's shapes would mislabel every verdict.
  it.each(manifest.profiles)('profile $id: edition + file agree with the T-Box dhc:shapesFile', (profile) => {
    const DHC = 'https://digitalhome.cloud/ontology#';
    expect(profile.edition, `${profile.id} names no edition`).toBeTruthy();
    const iri = profile.edition.replace(/^dhc:/, DHC);
    const declared = [...tboxStore.match(namedNode(iri), namedNode(`${DHC}shapesFile`), null)]
      .map(q => q.object.value);
    expect(declared, `${profile.edition} declares no dhc:shapesFile`).toHaveLength(1);
    expect(declared[0]).toBe(`cbox/${profile.file}`);
  });

  // A delta is meaningless alone — it must name what it sits on top of, and the
  // T-Box's dhc:supersedes is what build-abox.mjs actually walks to concatenate.
  it('every delta profile requires the profile of the edition it supersedes', () => {
    for (const p of manifest.profiles.filter(p => p.delta)) {
      expect(p.requires.length, `${p.id} is a delta but requires nothing`).toBeGreaterThan(0);
      for (const req of p.requires) {
        expect(manifest.profiles.map(x => x.id), `${p.id} requires unknown profile ${req}`).toContain(req);
      }
    }
  });

  it.each(manifest.profiles)('profile $id: file path resolves on disk', (profile) => {
    const full = path.join(path.dirname(manifestPath), profile.file);
    expect(fs.existsSync(full), `missing ${full}`).toBe(true);
  });

  it.each(manifest.profiles)('profile $id: norm IRI resolves in T-Box', (profile) => {
    const iri = profile.norm.replace(/^dhc:/, 'https://digitalhome.cloud/ontology#');
    const hits = [...tboxStore.match(namedNode(iri), null, null)];
    expect(hits.length, `T-Box has no triples with ${profile.norm}`).toBeGreaterThan(0);
  });

  it.each(manifest.profiles)('profile $id: has trilingual labels and required metadata', (profile) => {
    expect(profile.label.en).toBeTruthy();
    expect(profile.label.de).toBeTruthy();
    expect(profile.label.fr).toBeTruthy();
    expect(profile.country).toMatch(/^[A-Z]{2}$/);
    expect(profile.domain).toBe('electrical');
    expect(profile.version).toBeTruthy();
  });
});
