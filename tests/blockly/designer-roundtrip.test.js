/**
 * Round-trip fixture for the unified Blockly designer's combined Save file.
 *
 * `blockly/preview.html` **Save** downloads `{ version, electrical, spatial }` —
 * both workspaces together so cross-workspace placements survive — and **Load**
 * reads it back. This test guards the committed example
 * `blockly/examples/dhc-designer-demo.json` (a real no-edit Save output) at the
 * data level, without a browser:
 *
 *   1. shape round-trips (unwrap → rewrap is identity),
 *   2. every spatial `dhcb:Placement` resolves to an electrical leaf — the
 *      cross-workspace referential-integrity contract (a leaf's stable handle in
 *      the prototype is its `name` field; see doc/parking-lot.md § 4),
 *   3. the fixture stays a real cross-link demo (has placements, has leaves).
 *
 * If someone renames a starter leaf, drops a placeable block, or changes the
 * combined-file shape, this fails instead of the link silently going `(missing)`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../../blockly/examples/dhc-designer-demo.json', import.meta.url));

// Placeable electrical leaf types (mirrors PLACEABLE in preview.html).
const PLACEABLE = new Set([
  'dhcb:Socket', 'dhcb:Luminaire', 'dhcb:Electric_Vehicle_Charging_Station',
  'dhcb:Appliance', 'dhcb:Point', 'dhcb:SubDistributionBoard',
]);

/** Walk a Blockly serialization, yielding every block object (inputs + next). */
function* eachBlock(state) {
  const roots = state?.blocks?.blocks || [];
  const stack = [...roots];
  while (stack.length) {
    const b = stack.pop();
    if (!b || typeof b !== 'object') continue;
    yield b;
    for (const k of Object.keys(b.inputs || {})) {
      if (b.inputs[k].block) stack.push(b.inputs[k].block);
      if (b.inputs[k].shadow) stack.push(b.inputs[k].shadow);
    }
    if (b.next && b.next.block) stack.push(b.next.block);
  }
}

/** Electrical leaf handles = the `name` field of each placeable block. */
function electricalLeafNames(electrical) {
  const names = new Set();
  for (const b of eachBlock(electrical)) {
    if (PLACEABLE.has(b.type)) names.add((b.fields && b.fields.name) || '');
  }
  return names;
}

/**
 * Leaf IDs exactly as preview.html's leafRegistry() computes them: a point is
 * keyed by the consumer it rides on ("<consumer> / <point>"); everything else by
 * its own name. This is what a placement's LEAF value must match.
 */
function electricalLeafIds(electrical) {
  const ids = new Set();
  let auto = 0;
  const walk = (b, parent) => {
    if (!b || typeof b !== 'object') return;
    if (PLACEABLE.has(b.type)) {
      const nm = (b.fields && b.fields.name) || '';
      ids.add(b.type === 'dhcb:Point'
        ? (parent ? parent + ' / ' : '') + (nm || 'point#' + (++auto))
        : (nm || b.type + '#' + (++auto)));
    }
    const childParent = (b.fields && b.fields.name) || parent;
    for (const k of Object.keys(b.inputs || {})) {
      if (b.inputs[k].block) walk(b.inputs[k].block, childParent);
      if (b.inputs[k].shadow) walk(b.inputs[k].shadow, childParent);
    }
    if (b.next && b.next.block) walk(b.next.block, parent);
  };
  for (const b of electrical?.blocks?.blocks || []) walk(b, null);
  return ids;
}

/** Every spatial dhcb:Placement's referenced leaf (the LEAF field value). */
function spatialPlacements(spatial) {
  const refs = [];
  for (const b of eachBlock(spatial)) {
    if (b.type === 'dhcb:Placement') refs.push(b.fields && b.fields.LEAF);
  }
  return refs;
}

describe('unified designer — combined Save file round-trip', () => {
  const combined = JSON.parse(readFileSync(FIXTURE, 'utf8'));

  it('is a combined { version, electrical, spatial } file', () => {
    expect(combined.version).toBe('dhc-blockly-designer/1');
    expect(combined.electrical?.blocks?.blocks?.length).toBeGreaterThan(0);
    expect(combined.spatial?.blocks?.blocks?.length).toBeGreaterThan(0);
  });

  it('shape round-trips: unwrap → rewrap is identity', () => {
    const rewrapped = {
      version: 'dhc-blockly-designer/1',
      electrical: combined.electrical,
      spatial: combined.spatial,
    };
    expect(rewrapped).toEqual(combined);
  });

  it('every spatial placement resolves to an electrical leaf (referential integrity)', () => {
    const leaves = electricalLeafIds(combined.electrical);
    const placements = spatialPlacements(combined.spatial);
    expect(placements.length).toBeGreaterThan(0);          // it is a real cross-link demo
    for (const ref of placements) {
      expect(ref, `placement LEAF "${ref}" has no matching electrical leaf name`).toBeTruthy();
      expect(leaves.has(ref), `placement LEAF "${ref}" ∉ {${[...leaves].join(', ')}}`).toBe(true);
    }
  });

  it('electrical leaves are named (a name is the leaf handle)', () => {
    const leaves = electricalLeafNames(combined.electrical);
    expect(leaves.size).toBeGreaterThan(0);
    expect(leaves.has('')).toBe(false);                    // no unnamed placeable leaf
  });
});
