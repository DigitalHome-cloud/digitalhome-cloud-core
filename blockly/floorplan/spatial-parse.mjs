/*
 * Parse the dhcb: Spatial Blockly serialization into the flat
 * { smartHomeId, floors:[{ key, label, rooms:[{ key, name, roomType, area, points }] }] }
 * the floor-plan view consumes. Pure (no React/DOM) so it is shared by the
 * island (floorplan-app.jsx, via window.DHC_FLOORPLAN_PARSE) and the vitest guard.
 *
 * The Spatial workspace is the MASTER of structure. Buildings, levels and rooms
 * hang off `hasPart_*` **statement** inputs (dhc_*_mutator), so siblings can be
 * EITHER in their own mutator slot OR stacked on each other via next-connections
 * — `childBlocks` flattens both. Points (`hasPoint_*`) are value slots, one each.
 */
const ROOM_TYPE_SHORT = (t) => (t || '').split(':').pop().replace(/([a-z])([A-Z])/g, '$1 $2');
const BUILDINGS = new Set(['dhcb:DetachedHouse', 'dhcb:RowHouse', 'dhcb:SemiDetachedHouse', 'dhcb:VirtualBuilding']);

// All child blocks under a block's `prefix*` statement inputs — including blocks
// stacked via next-connections within a single slot (the natural drag-snap), not
// just the first of each slot.
function childBlocks(b, prefix) {
  const out = [];
  for (const [k, v] of Object.entries(b?.inputs || {})) {
    if (!k.startsWith(prefix)) continue;
    let blk = v.block;
    while (blk) { out.push(blk); blk = blk.next?.block; }
  }
  return out;
}

export function parseSpatial(spatial) {
  const root = spatial?.blocks?.blocks?.[0];
  if (!root) return { smartHomeId: '—', floors: [] };
  const floors = [];
  childBlocks(root, 'hasPart_').forEach((bld, bi) => {
    if (!BUILDINGS.has(bld.type)) return;                       // skip outdoor areas
    const bName = bld.fields?.name || bld.type.split(':').pop();
    childBlocks(bld, 'hasPart_').forEach((lvl, li) => {
      if (lvl.type !== 'dhcb:Level') return;
      const fKey = `${bi}/${li}`;
      const rooms = childBlocks(lvl, 'hasPart_').filter((r) => r.type === 'dhcb:Room').map((r) => {
        const rName = r.fields?.name || 'Room';
        const rKey = `${fKey}/${rName}`;
        const points = Object.entries(r.inputs || {})
          .filter(([k]) => k.startsWith('hasPoint_')).map(([, v]) => v.block).filter(Boolean)
          .map((p, pi) => {
            const isPlacement = p.type === 'dhcb:Placement';
            const label = isPlacement ? (p.fields?.LEAF || 'placement')
              : (p.fields?.pointId || ROOM_TYPE_SHORT(p.fields?.sensorType || p.fields?.alarmType || p.fields?.setpointType || p.type));
            return { key: `${rKey}#${pi}:${label}`, label, isPlacement };
          });
        return { key: rKey, name: rName, roomType: ROOM_TYPE_SHORT(r.fields?.['rec:RoomType']), area: Number(r.fields?.area_M2) || 12, points };
      });
      floors.push({ key: fKey, label: `${bName} · ${lvl.fields?.name || 'Level ' + (lvl.fields?.levelNumber ?? li)}`, rooms });
    });
  });
  return { smartHomeId: root.fields?.smartHomeId || '—', floors };
}
