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
  roomPoly, polyEdges, splitEdge, moveVertex, edgePointAt, pointInPoly, clampPointToPoly,
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

describe('floor-plan polygon rooms (Phase 2)', () => {
  const rect = { x: 100, y: 100, w: 200, h: 160 };

  it('roomPoly turns a rect into 4 clockwise corners, and passes a poly through', () => {
    expect(roomPoly(rect)).toEqual([
      { x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 260 }, { x: 100, y: 260 },
    ]);
    const poly = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 15 }, { x: 0, y: 10 }];
    expect(roomPoly({ ...rect, poly })).toBe(poly);
  });

  it('polyEdges wraps last→first with lengths', () => {
    const edges = polyEdges(roomPoly(rect));
    expect(edges).toHaveLength(4);
    expect(edges[0].len).toBe(200);                    // top edge
    expect(edges[1].len).toBe(160);                    // right edge
    expect(edges[3].a).toEqual({ x: 100, y: 260 });    // last edge starts at SW…
    expect(edges[3].b).toEqual({ x: 100, y: 100 });    // …and wraps back to NW
  });

  it('splitEdge inserts a vertex mid-edge (count +1) at the right spot', () => {
    const out = splitEdge(roomPoly(rect), 0, 0.5);     // top edge midpoint
    expect(out).toHaveLength(5);
    expect(out[1]).toEqual({ x: 200, y: 100 });
  });

  it('moveVertex moves only the named vertex', () => {
    const out = moveVertex(roomPoly(rect), 2, 30, -20);
    expect(out[2]).toEqual({ x: 330, y: 240 });
    expect(out[0]).toEqual({ x: 100, y: 100 });        // others untouched
  });

  it('edgePointAt interpolates along a segment', () => {
    expect(edgePointAt({ x: 0, y: 0 }, { x: 100, y: 40 }, 0.25)).toEqual({ x: 25, y: 10 });
  });

  it('pointInPoly distinguishes inside from outside on an L-shape', () => {
    // L-shape: notch cut out of the top-right quadrant
    const L = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 100, y: 40 },
               { x: 100, y: 100 }, { x: 0, y: 100 }];
    expect(pointInPoly({ x: 20, y: 20 }, L)).toBe(true);   // in the tall part
    expect(pointInPoly({ x: 80, y: 20 }, L)).toBe(false);  // in the cut-out notch
    expect(pointInPoly({ x: 80, y: 70 }, L)).toBe(true);   // in the foot
  });

  it('clampPointToPoly keeps an outside drag on/inside the polygon', () => {
    const poly = roomPoly(rect);
    for (const [dx, dy] of [[9999, 0], [0, 9999], [-9999, -9999], [9999, 9999]]) {
      const p = clampPointToPoly({ x: 200, y: 180 }, dx, dy, poly, PTPAD);
      expect(pointInPoly(p, poly) || onBoundary(p, poly)).toBe(true);
    }
  });

  it('clampPointToPoly leaves an in-bounds drag alone', () => {
    const poly = roomPoly(rect);
    expect(clampPointToPoly({ x: 200, y: 180 }, 10, -5, poly, PTPAD)).toEqual({ x: 210, y: 175 });
  });
});

// a point is "on the boundary" if it sits within 1.5px of some edge (rounding slack)
function onBoundary(p, verts) {
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const d = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
    if (d <= 1.5 + PTPAD) return true;
  }
  return false;
}
