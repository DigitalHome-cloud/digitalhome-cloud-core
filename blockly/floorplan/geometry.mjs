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
