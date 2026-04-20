import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, readTtl, parseToStore, namedNode } from '../_helpers/loadGraph.js';

const manifestPath = path.join(repoRoot, 'schema/cbox/cbox-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const tboxTtl = readTtl('schema/tbox/dhc-core.schema.ttl');
const tboxStore = parseToStore(tboxTtl);

describe('C-Box manifest', () => {
  it('declares version 2.0.0 and ≥1 profile', () => {
    expect(manifest.version).toBe('2.0.0');
    expect(manifest.profiles.length).toBeGreaterThan(0);
  });

  it('contains the 5 electrical profiles', () => {
    const ids = manifest.profiles.map(p => p.id);
    expect(new Set(ids)).toEqual(new Set([
      'nfc15100', 'nfc14100', 'din-vde-0100', 'arei-rgie', 'bs7671',
    ]));
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
