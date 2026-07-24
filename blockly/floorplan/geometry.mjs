/*
 * Pure geometry for the floor-plan sketch view — no React, no DOM. The island
 * (floorplan-app.jsx) loads this via a browser dynamic import and reads it off
 * window.DHC_FLOORPLAN_GEOM; the vitest guard imports it directly. One source
 * for the auto-layout, the point-in-room clamp and the corner-resize maths.
 *
 * Geometry is the sketch's own layer; the Spatial Blockly workspace masters the
 * structure (which rooms/points exist). Units: px, METER px per metre.
 */
export const METER = 40; // px per metre in the sketch
export const GAP = 0.8 * METER; // auto-layout gap between rooms
export const PTPAD = 10; // keep points this far inside a room's walls
const MIN_SIDE = 40; // a room can't be resized below this (px)

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Give rooms without saved geometry a default rectangle (row-pack by area).
// Rooms already present in `geom.rooms` keep their saved rect untouched.
export function withGeometry(rooms, geom = {}) {
  const rects = {};
  let x = GAP, y = GAP, rowH = 0;
  const maxW = 1000;
  for (const r of rooms) {
    if (geom.rooms?.[r.key]) { rects[r.key] = geom.rooms[r.key]; continue; }
    const side = Math.max(2.2, Math.sqrt(r.area)); // metres → a squarish room
    const w = Math.round(side * METER), h = Math.round((r.area / side) * METER);
    if (x + w > maxW) { x = GAP; y += rowH + GAP; rowH = 0; }
    rects[r.key] = { x, y, w, h };
    x += w + GAP; rowH = Math.max(rowH, h);
  }
  return rects;
}

// Default position for a point with no saved geometry: an inner grid.
export function pointPos(room, pt, idx, geom = {}) {
  if (geom.points?.[pt.key]) return geom.points[pt.key];
  const cols = Math.max(1, Math.floor((room.w - 2 * PTPAD) / 40));
  return { x: room.x + PTPAD + 20 + (idx % cols) * 40, y: room.y + PTPAD + 20 + Math.floor(idx / cols) * 34 };
}

// Move or corner-resize a room rect. `mode` is 'move' or a compass of n/e/s/w.
// (dx,dy) is the pointer delta from where the drag began; `rect` is the rect at
// drag start. West/north edges move the origin so the opposite edge stays put.
export function moveOrResize(rect, mode, dx, dy) {
  let { x, y, w, h } = rect;
  if (mode === 'move') { x += dx; y += dy; }
  else {
    if (mode.includes('e')) w = Math.max(MIN_SIDE, rect.w + dx);
    if (mode.includes('s')) h = Math.max(MIN_SIDE, rect.h + dy);
    if (mode.includes('w')) { w = Math.max(MIN_SIDE, rect.w - dx); x = rect.x + (rect.w - w); }
    if (mode.includes('n')) { h = Math.max(MIN_SIDE, rect.h - dy); y = rect.y + (rect.h - h); }
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

// A point may only sit inside the room it is linked to — clamp to the walls
// (minus PTPAD). `start` is the point at drag start, (dx,dy) the pointer delta.
export function clampPointToRoom(start, dx, dy, room) {
  return {
    x: Math.round(clamp(start.x + dx, room.x + PTPAD, room.x + room.w - PTPAD)),
    y: Math.round(clamp(start.y + dy, room.y + PTPAD, room.y + room.h - PTPAD)),
  };
}

/* ── Phase 2: polygon rooms, edges, walls & openings ──────────────────────────
 * A room is a rectangle by default; "turn off rectangle" persists `poly`, a list
 * of vertices, which then wins over {x,y,w,h}. Edges wrap (last→first); edge `i`
 * runs from vertex i to vertex i+1. Standard walls and door/window openings hang
 * off an edge index. All pure — shared with the vitest guard. */

// A room's outline as a vertex list: its polygon, else the 4 rect corners
// (NW, NE, SE, SW — clockwise). Used everywhere the room shape is drawn/edited.
export function roomPoly(room) {
  if (room?.poly?.length >= 3) return room.poly;
  const { x, y, w, h } = room;
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

// Edges of a vertex ring, wrapping last→first. angle is radians of the a→b dir.
export function polyEdges(verts) {
  return verts.map((a, i) => {
    const b = verts[(i + 1) % verts.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    return { i, a, b, len: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
  });
}

// Insert a vertex at param t (0..1) along edge `edgeIdx`, returning a new ring.
export function splitEdge(verts, edgeIdx, t = 0.5) {
  const a = verts[edgeIdx], b = verts[(edgeIdx + 1) % verts.length];
  const p = edgePointAt(a, b, clamp(t, 0, 1));
  const out = verts.slice();
  out.splice(edgeIdx + 1, 0, { x: Math.round(p.x), y: Math.round(p.y) });
  return out;
}

// Move one vertex of a ring by (dx,dy), returning a new ring (rounded).
export function moveVertex(verts, idx, dx, dy) {
  return verts.map((v, i) => (i === idx ? { x: Math.round(v.x + dx), y: Math.round(v.y + dy) } : v));
}

// The point at param t (0..1) along the segment a→b.
export function edgePointAt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Nearest point on segment a→b to p, plus its param t — the projection foot.
export function projectToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  return { t, point: { x: a.x + dx * t, y: a.y + dy * t } };
}

// Even-odd ray cast: is p strictly inside the polygon ring?
export function pointInPoly(p, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const a = verts[i], b = verts[j];
    if (((a.y > p.y) !== (b.y > p.y)) &&
        (p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)) inside = !inside;
  }
  return inside;
}

// Polygon analogue of clampPointToRoom: a point may only sit inside its room.
// Inside → keep; outside → project onto the nearest edge and step `pad` inward.
export function clampPointToPoly(start, dx, dy, verts, pad = PTPAD) {
  const p = { x: start.x + dx, y: start.y + dy };
  if (pointInPoly(p, verts)) return { x: Math.round(p.x), y: Math.round(p.y) };
  let best = null;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    const { point } = projectToSegment(p, a, b);
    const d = Math.hypot(point.x - p.x, point.y - p.y);
    if (!best || d < best.d) {
      // inward normal of edge a→b (interior is to the left for a CW ring)
      const ex = b.x - a.x, ey = b.y - a.y, el = Math.hypot(ex, ey) || 1;
      best = { d, point, nx: ey / el, ny: -ex / el };
    }
  }
  let q = { x: best.point.x + best.nx * pad, y: best.point.y + best.ny * pad };
  if (!pointInPoly(q, verts)) q = { x: best.point.x - best.nx * pad, y: best.point.y - best.ny * pad };
  return { x: Math.round(q.x), y: Math.round(q.y) };
}
