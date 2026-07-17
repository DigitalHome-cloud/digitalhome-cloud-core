import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, readTtl, parseToStore, namedNode } from '../_helpers/loadGraph.js';

const manifestPath = path.join(repoRoot, 'schema/cbox/cbox-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const tboxTtl = readTtl('schema/tbox/dhc-core.ttl');
const tboxStore = parseToStore(tboxTtl);

describe('C-Box manifest', () => {
  it('declares version 3.0.0 and ≥1 profile', () => {
    expect(manifest.version).toBe('3.0.0');
    expect(manifest.profiles.length).toBeGreaterThan(0);
  });

  // Scoped to France while the v3 core is prototyped. DIN VDE 0100 (DE),
  // AREI/RGIE (BE) and BS 7671 (GB) were removed in v3.0.0 — shapes, tests,
  // fixtures and Norm instances together — and return once dhc-core is
  // released. Keeping a profile whose shapes or Norm no longer exist is the
  // dangling-reference failure the guards tests exist to prevent.
  it('contains the 2 French electrical profiles', () => {
    const ids = manifest.profiles.map(p => p.id);
    expect(new Set(ids)).toEqual(new Set(['nfc15100', 'nfc14100']));
  });

  it('every profile is French while the core is prototyped', () => {
    expect(manifest.profiles.map(p => p.country)).toEqual(['FR', 'FR']);
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
