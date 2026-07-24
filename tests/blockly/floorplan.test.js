/**
 * Floor-plan sketch geometry — the pure layer shared by the React island
 * (floorplan-app.jsx) and this guard. Structure is mastered by the Spatial
 * Blockly workspace; here we only assert the geometry invariants: every room
 * gets a rectangle, saved geometry is preserved, corner-resize keeps the
 * opposite edge fixed and honours a minimum size, and — the load-bearing one —
 * a point can never be dragged outside the room it is linked to.
 */
import { describe, it, expect } from 'vitest';
import {
  METER, PTPAD, withGeometry, pointPos, moveOrResize, clampPointToRoom,
} from '../../blockly/floorplan/geometry.mjs';

const rooms = [
  { key: 'a', area: 24 },
  { key: 'b', area: 12 },
  { key: 'c', area: 9 },
];

describe('floor-plan auto-layout (withGeometry)', () => {
  it('gives every room a positive-size rectangle when none is saved', () => {
    const rects = withGeometry(rooms, {});
    for (const r of rooms) {
      expect(rects[r.key]).toBeTruthy();
      expect(rects[r.key].w).toBeGreaterThan(0);
      expect(rects[r.key].h).toBeGreaterThan(0);
    }
  });

  it('preserves a saved rect and only auto-places the rest', () => {
    const saved = { rooms: { b: { x: 500, y: 500, w: 111, h: 222 } } };
    const rects = withGeometry(rooms, saved);
    expect(rects.b).toEqual(saved.rooms.b);           // untouched
    expect(rects.a).not.toEqual(saved.rooms.b);       // others still auto-laid
  });

  it('scales a room roughly to its area (bigger area → bigger rect)', () => {
    const rects = withGeometry(rooms, {});
    const areaOf = (k) => rects[k].w * rects[k].h;
    expect(areaOf('a')).toBeGreaterThan(areaOf('c')); // 24 m² > 9 m²
  });
});

describe('floor-plan corner-resize (moveOrResize)', () => {
  const rect = { x: 100, y: 100, w: 200, h: 160 };

  it('move translates without changing size', () => {
    expect(moveOrResize(rect, 'move', 40, -25)).toEqual({ x: 140, y: 75, w: 200, h: 160 });
  });

  it('dragging the SE corner grows w/h, origin fixed', () => {
    expect(moveOrResize(rect, 'se', 30, 20)).toEqual({ x: 100, y: 100, w: 230, h: 180 });
  });

  it('dragging the NW corner moves the origin but keeps the SE edge fixed', () => {
    const out = moveOrResize(rect, 'nw', 50, 40);
    expect(out.x + out.w).toBe(rect.x + rect.w);       // right edge unmoved
    expect(out.y + out.h).toBe(rect.y + rect.h);       // bottom edge unmoved
  });

  it('never shrinks a room below the minimum side', () => {
    const out = moveOrResize(rect, 'se', -9999, -9999);
    expect(out.w).toBeGreaterThanOrEqual(40);
    expect(out.h).toBeGreaterThanOrEqual(40);
  });
});

describe('floor-plan point clamp (a point stays in its linked room)', () => {
  const room = { x: 100, y: 100, w: 200, h: 160 };
  const start = { x: 150, y: 150 };

  it('keeps a point inside the room walls for any drag delta', () => {
    for (const [dx, dy] of [[9999, 9999], [-9999, -9999], [9999, -9999], [0, 5000]]) {
      const p = clampPointToRoom(start, dx, dy, room);
      expect(p.x).toBeGreaterThanOrEqual(room.x + PTPAD);
      expect(p.x).toBeLessThanOrEqual(room.x + room.w - PTPAD);
      expect(p.y).toBeGreaterThanOrEqual(room.y + PTPAD);
      expect(p.y).toBeLessThanOrEqual(room.y + room.h - PTPAD);
    }
  });

  it('a small in-bounds drag moves the point freely', () => {
    expect(clampPointToRoom(start, 20, -10, room)).toEqual({ x: 170, y: 140 });
  });

  it('default point positions land inside their room', () => {
    const rc = { x: 0, y: 0, w: 4 * METER, h: 3 * METER };
    for (let i = 0; i < 6; i++) {
      const p = pointPos(rc, { key: 'p' + i }, i, {});
      expect(p.x).toBeGreaterThanOrEqual(rc.x);
      expect(p.y).toBeGreaterThanOrEqual(rc.y);
    }
  });
});
