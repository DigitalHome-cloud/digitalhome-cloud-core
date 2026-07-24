/**
 * Spatial → floors parse for the floor-plan view. The Spatial Blockly is the
 * master; buildings/levels/rooms hang off `hasPart_*` STATEMENT inputs, so a
 * sibling can be either in its own mutator slot OR stacked on the previous one
 * via a next-connection (the natural drag-snap). Both must surface as floors —
 * this guards the bug where a stacked second level was invisible to the sketch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSpatial } from '../../blockly/floorplan/spatial-parse.mjs';

const BLK = fileURLToPath(new URL('../../blockly/', import.meta.url));

// helpers to build a serialization by hand
const room = (name) => ({ type: 'dhcb:Room', fields: { name }, inputs: {} });
const level = (name, rooms) => ({
  type: 'dhcb:Level', fields: { name },
  // rooms in one statement slot, chained via next (the drag-snap shape)
  inputs: rooms.length ? { hasPart_0: { block: chain(rooms) } } : {},
});
const chain = (blocks) => blocks.reduceRight((next, b) => (next ? { ...b, next: { block: next } } : b), null);
const home = (building) => ({ blocks: { blocks: [{ type: 'dhcb:DigitalHome', fields: { smartHomeId: 'DE-DEMO' }, inputs: { hasPart_0: { block: building } } }] } });

describe('parseSpatial — levels added either way', () => {
  it('reads a second level placed in its own building mutator slot', () => {
    const bld = {
      type: 'dhcb:DetachedHouse', fields: { name: 'Main House' },
      inputs: { hasPart_0: { block: level('Ground floor', [room('Living')]) },
                hasPart_1: { block: level('First floor', [room('Bed 1')]) } },
    };
    const floors = parseSpatial(home(bld)).floors;
    expect(floors.map((f) => f.label)).toEqual(['Main House · Ground floor', 'Main House · First floor']);
  });

  it('reads a second level STACKED on the first via a next-connection', () => {
    const bld = {
      type: 'dhcb:DetachedHouse', fields: { name: 'Main House' },
      inputs: { hasPart_0: { block: chain([level('Ground floor', [room('Living')]), level('First floor', [room('Bed 1')])]) } },
    };
    const floors = parseSpatial(home(bld)).floors;
    expect(floors).toHaveLength(2);                             // ← the bug: was 1
    expect(floors.map((f) => f.label)).toEqual(['Main House · Ground floor', 'Main House · First floor']);
    expect(floors[1].rooms.map((r) => r.name)).toEqual(['Bed 1']);
  });

  it('reads rooms stacked via next-connections within a level', () => {
    const bld = {
      type: 'dhcb:DetachedHouse', fields: { name: 'H' },
      inputs: { hasPart_0: { block: level('L0', [room('A'), room('B'), room('C')]) } },
    };
    expect(parseSpatial(home(bld)).floors[0].rooms.map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });

  it('reads multiple buildings stacked on the DigitalHome', () => {
    const a = { type: 'dhcb:DetachedHouse', fields: { name: 'House A' }, inputs: { hasPart_0: { block: level('L0', [room('r')]) } } };
    const b = { type: 'dhcb:VirtualBuilding', fields: { name: 'Annex' }, inputs: { hasPart_0: { block: level('L0', [room('s')]) } } };
    const spatial = { blocks: { blocks: [{ type: 'dhcb:DigitalHome', inputs: { hasPart_0: { block: chain([a, b]) } } }] } };
    expect(parseSpatial(spatial).floors.map((f) => f.label)).toEqual(['House A · L0', 'Annex · L0']);
  });
});

describe('parseSpatial — room identity survives rename/retype (block id keys)', () => {
  // one home / building / level wrapping a single room block (optionally with ids)
  const wrap = (roomBlock) => {
    const lvl = { type: 'dhcb:Level', fields: { name: 'L0' }, inputs: { hasPart_0: { block: roomBlock } } };
    const bld = { type: 'dhcb:DetachedHouse', fields: { name: 'H' }, inputs: { hasPart_0: { block: lvl } } };
    return { blocks: { blocks: [{ type: 'dhcb:DigitalHome', inputs: { hasPart_0: { block: bld } } }] } };
  };
  const roomWithId = (name, roomType) => ({
    type: 'dhcb:Room', id: 'ROOM_ID_1', fields: { name, 'rec:RoomType': roomType },
    inputs: { hasPoint_0: { block: { type: 'dhcb:Sensor', id: 'PT_ID_1', fields: { pointId: 'temp' } } } },
  });

  it('keys the room by its block id, not its name', () => {
    const before = parseSpatial(wrap(roomWithId('Kitchen', 'rec:Kitchen'))).floors[0].rooms[0];
    const after = parseSpatial(wrap(roomWithId('Cuisine', 'rec:LivingRoom'))).floors[0].rooms[0];
    expect(before.key).toBe('ROOM_ID_1');
    expect(after.key).toBe('ROOM_ID_1');               // ← same key despite name+type change
    expect(before.name).toBe('Kitchen');
    expect(after.name).toBe('Cuisine');                // attributes updated
    expect(after.points[0].key).toBe('PT_ID_1');       // points keyed by id too
  });

  it('falls back to the name-path when a block has no id', () => {
    const spatial = wrap({ type: 'dhcb:Room', fields: { name: 'Bath' }, inputs: {} });
    expect(parseSpatial(spatial).floors[0].rooms[0].key).toBe('0/0/Bath');
  });
});

describe('parseSpatial — the shipped demos still parse', () => {
  const demos = readdirSync(BLK + 'examples').filter((f) => f.endsWith('.designer.json'));
  it.each(demos)('%s yields at least one floor with rooms', (f) => {
    const spatial = JSON.parse(readFileSync(BLK + 'examples/' + f, 'utf8')).spatial;
    if (!spatial) return;                                       // some demos are electrical-only
    const { floors } = parseSpatial(spatial);
    expect(floors.length).toBeGreaterThan(0);
    expect(floors.some((fl) => fl.rooms.length > 0)).toBe(true);
  });
});
