import { describe, it, expect } from 'vitest';
import { readTtl, parseToStore, namedNode } from '../_helpers/loadGraph.js';

describe('T-Box — dhc-roles.ttl', () => {
  const ttl = readTtl('schema/tbox/dhc-roles.ttl');
  const store = parseToStore(ttl);

  it('parses cleanly', () => {
    expect(store.size).toBeGreaterThan(0);
  });

  it('declares expected role vocabulary entries', () => {
    const dhc = 'https://digitalhome.cloud/ontology#';
    for (const role of ['Role_Owner', 'Role_Designer', 'Role_Installer']) {
      const hits = [...store.match(namedNode(`${dhc}${role}`), null, null)];
      expect(hits.length, `role ${role} not found`).toBeGreaterThan(0);
    }
  });
});
