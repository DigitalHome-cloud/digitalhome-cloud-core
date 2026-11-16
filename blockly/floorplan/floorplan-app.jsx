/*
 * Floor-plan sketch — React island embedded in the unified harness (preview.html),
 * lazy-loaded on first "Floor plan" tab activation. Reuses the look/feel of the
 * experimental prototype (experimental/floor-planner, MIT).
 *
 * Phase 1: rooms from the Spatial Blockly (master) as draggable/resizable
 *   rectangles; points clamped inside their linked room.
 * Phase 2: "turn off rectangle" → free polygon (drag/split vertices); promote an
 *   edge to a standard (thick) wall; place doors & windows on a wall and slide
 *   them along it. All geometry is a cosmetic layer persisted to `floorplan` via
 *   window.DHC_FLOORPLAN_HOST — Blockly still masters which rooms/points exist.
 *
 * Deps: React 18 + ReactDOM (UMD globals), compiled by Babel-standalone at load.
 */
(function () {
  // Pure helpers shared with the vitest guard; the harness loads them before
  // mounting us. geometry = layout / resize / polygon maths; parse walks the
  // dhcb: Spatial serialization → floors (see spatial-parse.mjs).
  const G = window.DHC_FLOORPLAN_GEOM;
  const { METER, PTPAD, clamp, withGeometry, pointPos, roomPoly, polyEdges } = G;
  const { parseSpatial } = window.DHC_FLOORPLAN_PARSE;

  const THEME = {
    bg: '#0d1929', grid: 'rgba(148,163,184,0.16)', wall: '#cbd5f5', label: '#94a3b8',
    room: 'rgba(59,130,246,0.07)', roomStroke: 'rgba(148,163,184,0.55)', accent: '#22c55e',
    point: '#a855f7', placement: '#3b82f6', opening: '#e2e8f0',
  };
  const DOOR_W = 0.8, WIN_W = 1.0;   // default opening widths (metres)
  const WALL_TH = 0.16;              // standard wall thickness (metres)
  const TOOLS = [['select', 'Select'], ['split', 'Split'], ['wall', 'Wall'], ['door', 'Door'], ['window', 'Window'], ['furniture', 'Furniture']];
  // Arcada-derived furniture glyphs (Apache-2.0), loaded before this island.
  const FurnitureGlyph = window.DHC_FURNITURE?.FurnitureGlyph;
  const FURNITURE_CATALOG = window.DHC_FURNITURE?.FURNITURE_CATALOG || {};

  // bounding box of a vertex ring — used for labels / default point grid.
  function bbox(verts) {
    const xs = verts.map((v) => v.x), ys = verts.map((v) => v.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  // svg user-space point from a client event
  function svgPt(svg, clientX, clientY) {
    const p = svg.createSVGPoint(); p.x = clientX; p.y = clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }

  const { useState, useRef, useMemo } = React;

  function App({ host }) {
    const spatial = useMemo(() => parseSpatial(host.getSpatial()), [host]);
    const [geom, setGeom] = useState(() => host.getFloorplan() || {});
    const [floorIdx, setFloorIdx] = useState(0);
    const [sel, setSel] = useState(null);              // {type:'room'|'point'|'opening', key}
    const [tool, setTool] = useState('select');
    const [furnQuery, setFurnQuery] = useState('');
    const [view, setView] = useState({ scale: 1, x: 40, y: 40 });
    const svgRef = useRef(null);
    const drag = useRef(null);

    const floor = spatial.floors[floorIdx];
    const rects = useMemo(() => floor ? withGeometry(floor.rooms, geom) : {}, [floor, geom]);

    // ── persistence helpers (everything routes back to states.floorplan) ──
    function persist(next) { setGeom(next); host.setFloorplan(next); }
    function setRoom(key, patch) {
      persist({ ...geom, rooms: { ...(geom.rooms || {}), [key]: { ...rects[key], ...patch } } });
    }
    function setPointPos(key, pos) {
      persist({ ...geom, points: { ...(geom.points || {}), [key]: pos } });
    }
    function toggleWall(key, edgeIdx) {
      const walls = { ...(rects[key].walls || {}) };
      if (walls[edgeIdx]?.standard) delete walls[edgeIdx];
      else walls[edgeIdx] = { standard: true, thickness: WALL_TH };
      setRoom(key, { walls });
    }
    function setWall(key, edgeIdx, patch) {
      const walls = { ...(rects[key].walls || {}) };
      walls[edgeIdx] = { standard: true, thickness: WALL_TH, ...(walls[edgeIdx] || {}), ...patch };
      setRoom(key, { walls });
    }
    function removeWall(key, edgeIdx) {
      const walls = { ...(rects[key].walls || {}) }; delete walls[edgeIdx];
      setRoom(key, { walls }); setSel(null);
    }
    function addOpening(roomKey, edge, t, kind) {
      const width = kind === 'door' ? DOOR_W : WIN_W;
      const id = `${roomKey}@e${edge}#${Object.keys(geom.openings || {}).length}`;
      persist({ ...geom, openings: { ...(geom.openings || {}), [id]: { room: roomKey, edge, t: clamp(t, 0, 1), width, kind } } });
      setSel({ type: 'opening', key: id });
    }
    function setOpening(id, patch) {
      persist({ ...geom, openings: { ...(geom.openings || {}), [id]: { ...geom.openings[id], ...patch } } });
    }
    function removeOpening(id) {
      const next = { ...(geom.openings || {}) }; delete next[id];
      persist({ ...geom, openings: next }); setSel(null);
    }
    // ── furniture (a free décor layer on the active floor) ──
    function addFurniture(item) {
      const id = 'f' + Date.now().toString(36) + Math.floor(Math.random() * 1000);
      const cx = (500 - view.x) / view.scale, cy = (350 - view.y) / view.scale;   // view centre in world px
      const f = { type: item.texture, name: item.name, floor: floor.key, rot: 0, w: item.width, h: item.height,
        x: Math.round(cx - (item.width * METER) / 2), y: Math.round(cy - (item.height * METER) / 2) };
      persist({ ...geom, furniture: { ...(geom.furniture || {}), [id]: f } });
      setSel({ type: 'furniture', key: id }); setTool('select');
    }
    function setFurniture(id, patch) {
      persist({ ...geom, furniture: { ...(geom.furniture || {}), [id]: { ...geom.furniture[id], ...patch } } });
    }
    function removeFurniture(id) {
      const next = { ...(geom.furniture || {}) }; delete next[id];
      persist({ ...geom, furniture: next }); setSel(null);
    }

    // ── pointer drag — rooms (move/resize), vertices, points, openings ──
    function startDrag(e, spec) {
      e.stopPropagation();
      const p = svgPt(svgRef.current, e.clientX, e.clientY);
      drag.current = { ...spec, startX: p.x, startY: p.y };
      svgRef.current.setPointerCapture?.(e.pointerId);
    }
    function onRoomDown(e, key, rc) {
      setSel({ type: 'room', key });
      if (tool !== 'select') return;                   // tool modes act on edges, not the body
      const isPoly = rc.poly?.length >= 3;
      startDrag(e, { kind: 'room', key, mode: 'move', rc, isPoly, startVerts: roomPoly(rc) });
    }
    function onHandleDown(e, key, mode, rc) { setSel({ type: 'room', key }); startDrag(e, { kind: 'room', key, mode, rc, isPoly: false }); }
    function onVertexDown(e, key, rc, idx) { setSel({ type: 'room', key }); startDrag(e, { kind: 'vertex', key, idx, startVerts: roomPoly(rc) }); }
    function onPointDown(e, key, verts) {
      setSel({ type: 'point', key });
      startDrag(e, { kind: 'pt', key, verts, pos: geom.points?.[key] || svgPt(svgRef.current, e.clientX, e.clientY) });
    }
    function onOpeningDown(e, id) {
      setSel({ type: 'opening', key: id });
      if (tool === 'select') startDrag(e, { kind: 'opening', key: id });
    }
    function onFurnitureDown(e, id, f) {
      setSel({ type: 'furniture', key: id });
      if (tool === 'select') startDrag(e, { kind: 'furniture', key: id, fx: f.x, fy: f.y });
    }
    function onEdgeDown(e, key, rc, edge) {
      if (tool === 'select') {
        if (rc.walls?.[edge.i]?.standard) { e.stopPropagation(); setSel({ type: 'wall', key, edge: edge.i }); return; }
        return onRoomDown(e, key, rc);
      }
      e.stopPropagation();
      setSel({ type: 'room', key });
      const p = svgPt(svgRef.current, e.clientX, e.clientY);
      const t = G.projectToSegment(p, edge.a, edge.b).t;
      if (tool === 'split') setRoom(key, { poly: G.splitEdge(roomPoly(rc), edge.i, t) });
      else if (tool === 'wall') toggleWall(key, edge.i);
      else if (tool === 'door' || tool === 'window') addOpening(key, edge.i, t, tool);
    }

    function onPointerMove(e) {
      const d = drag.current; if (!d) return;
      const p = svgPt(svgRef.current, e.clientX, e.clientY);
      const dx = p.x - d.startX, dy = p.y - d.startY;
      if (d.kind === 'room' && d.isPoly) {
        setRoom(d.key, { poly: d.startVerts.map((v) => ({ x: Math.round(v.x + dx), y: Math.round(v.y + dy) })) });
      } else if (d.kind === 'room') {
        setRoom(d.key, G.moveOrResize(d.rc, d.mode, dx, dy));
      } else if (d.kind === 'vertex') {
        setRoom(d.key, { poly: G.moveVertex(d.startVerts, d.idx, dx, dy) });
      } else if (d.kind === 'pt') {
        setPointPos(d.key, G.clampPointToPoly(d.pos, dx, dy, d.verts, PTPAD));
      } else if (d.kind === 'opening') {
        const op = geom.openings[d.key]; const rc = rects[op.room]; if (!rc) return;
        const edge = polyEdges(roomPoly(rc))[op.edge]; if (!edge) return;
        const t = G.projectToSegment(p, edge.a, edge.b).t;
        const margin = edge.len ? (op.width * METER) / 2 / edge.len : 0;
        setOpening(d.key, { t: clamp(t, margin, 1 - margin) });
      } else if (d.kind === 'furniture') {
        setFurniture(d.key, { x: Math.round(d.fx + dx), y: Math.round(d.fy + dy) });
      }
    }
    function onPointerUp() { drag.current = null; }

    // ── background pan + wheel zoom ──
    function onBgDown(e) {
      setSel(null);
      const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      const move = (ev) => setView((v) => ({ ...v, x: start.vx + (ev.clientX - start.x), y: start.vy + (ev.clientY - start.y) }));
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    }
    function onWheel(e) {
      e.preventDefault();
      const r = svgRef.current.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setView((v) => {
        const s = clamp(v.scale * f, 0.3, 4);
        return { scale: s, x: mx - ((mx - v.x) / v.scale) * s, y: my - ((my - v.y) / v.scale) * s };
      });
    }
    const setScale = (f) => setView((v) => ({ ...v, scale: clamp(v.scale * f, 0.3, 4) }));

    if (!spatial.floors.length) {
      return React.createElement('div', { className: 'fp-empty' },
        'No building levels in the Spatial workspace yet. Add a building → level → rooms in the Spatial tab.');
    }

    const vb = `${-view.x / view.scale} ${-view.y / view.scale} ${1000 / view.scale} ${700 / view.scale}`;
    const selRoom = sel?.type === 'room' && floor.rooms.find((r) => r.key === sel.key);
    const selOp = sel?.type === 'opening' && geom.openings?.[sel.key];
    const selWall = sel?.type === 'wall' && rects[sel.key]?.walls?.[sel.edge];
    const selFurn = sel?.type === 'furniture' && geom.furniture?.[sel.key];
    const floorFurniture = Object.entries(geom.furniture || {}).filter(([, f]) => !f.floor || f.floor === floor.key);
    const edgeCursor = tool === 'select' ? 'move' : 'crosshair';

    // openings on rooms of the active floor
    const floorOpenings = Object.entries(geom.openings || {}).filter(([, op]) => rects[op.room]);

    return (
      <div className="fp-wrap">
        <div className="fp-bar">
          <select className="fp-select" value={floorIdx} onChange={(e) => { setFloorIdx(+e.target.value); setSel(null); }}>
            {spatial.floors.map((f, i) => <option key={f.key} value={i}>{f.label}</option>)}
          </select>
          <span className="fp-sep" />
          {TOOLS.map(([id, lbl]) => (
            <button key={id} className={'fp-tool' + (tool === id ? ' active' : '')}
                    onClick={() => setTool(id)} title={id}>{lbl}</button>
          ))}
          <span className="fp-sep" />
          <button className="fp-btn" onClick={() => setScale(1 / 1.25)} title="Zoom out">−</button>
          <button className="fp-btn" onClick={() => setView({ scale: 1, x: 40, y: 40 })} title="Reset">Fit</button>
          <button className="fp-btn" onClick={() => setScale(1.25)} title="Zoom in">＋</button>
          <span className="fp-hint">
            {tool === 'select' ? 'drag rooms · vertices · points · openings · furniture'
              : tool === 'split' ? 'click a wall to add a corner'
              : tool === 'wall' ? 'click an edge to toggle a standard wall'
              : tool === 'furniture' ? 'pick an item from the library →'
              : `click a wall to place a ${tool}`}
          </span>
        </div>
        <div className="fp-body">
          <div className="fp-canvas">
            <svg ref={svgRef} width="100%" height="100%" viewBox={vb}
                 style={{ background: THEME.bg, display: 'block' }}
                 onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel} onPointerDown={onBgDown}>
              <defs>
                <pattern id="fp-grid" width={METER} height={METER} patternUnits="userSpaceOnUse">
                  <path d={`M ${METER} 0 L 0 0 0 ${METER}`} fill="none" stroke={THEME.grid} strokeWidth="1" />
                </pattern>
              </defs>
              <rect x="-5000" y="-5000" width="10000" height="10000" fill="url(#fp-grid)" pointerEvents="none" />

              {floor.rooms.map((r) => {
                const rc = rects[r.key]; if (!rc) return null;
                const verts = roomPoly(rc);
                const edges = polyEdges(verts);
                const box = bbox(verts);
                const isPoly = rc.poly?.length >= 3;
                const isSel = sel?.type === 'room' && sel.key === r.key;
                const pts = verts.map((v) => `${v.x},${v.y}`).join(' ');
                return (
                  <g key={r.key}>
                    {/* room fill (move / select) */}
                    <polygon points={pts} fill={THEME.room} stroke="none"
                             style={{ cursor: tool === 'select' ? 'move' : 'default' }}
                             onPointerDown={(e) => onRoomDown(e, r.key, rc)} />
                    {/* edges: dotted sketch line or thick standard wall + a wide hit target */}
                    {edges.map((e) => {
                      const w = rc.walls?.[e.i];
                      const standard = w?.standard;
                      const partial = standard && w.partial;               // doesn't reach the ceiling
                      const wallSel = sel?.type === 'wall' && sel.key === r.key && sel.edge === e.i;
                      return (
                        <g key={e.i}>
                          <line x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y}
                                stroke={standard ? (wallSel ? THEME.accent : THEME.wall) : (isSel ? THEME.accent : THEME.roomStroke)}
                                strokeWidth={standard ? (w.thickness || WALL_TH) * METER : (isSel ? 2 : 1.5)}
                                strokeOpacity={partial ? 0.6 : 1}
                                strokeDasharray={standard ? (partial ? '8 5' : undefined) : '6 5'}
                                strokeLinecap="round" pointerEvents="none" />
                          <line x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y}
                                stroke="transparent" strokeWidth="12" style={{ cursor: edgeCursor }}
                                onPointerDown={(ev) => onEdgeDown(ev, r.key, rc, e)} />
                        </g>
                      );
                    })}
                    <text x={box.x + 8} y={box.y + 18} fontSize="13" fill={THEME.wall}
                          fontFamily="system-ui, sans-serif" pointerEvents="none">{r.name}</text>
                    <text x={box.x + 8} y={box.y + 33} fontSize="10" fill={THEME.label}
                          fontFamily="ui-monospace, Menlo, monospace" pointerEvents="none">
                      {r.roomType} · {r.area} m²</text>

                    {/* selection handles: rect → 4 corner resize; polygon → per-vertex */}
                    {isSel && !isPoly && [['nw', 0, 0], ['ne', rc.w, 0], ['sw', 0, rc.h], ['se', rc.w, rc.h]].map(([m, hx, hy]) => (
                      <rect key={m} x={rc.x + hx - 5} y={rc.y + hy - 5} width="10" height="10"
                            fill="#fff" stroke={THEME.accent} strokeWidth="1.5"
                            style={{ cursor: (m === 'nw' || m === 'se') ? 'nwse-resize' : 'nesw-resize' }}
                            onPointerDown={(e) => onHandleDown(e, r.key, m, rc)} />
                    ))}
                    {isSel && isPoly && verts.map((v, idx) => (
                      <rect key={idx} x={v.x - 5} y={v.y - 5} width="10" height="10"
                            fill="#fff" stroke={THEME.accent} strokeWidth="1.5" style={{ cursor: 'grab' }}
                            onPointerDown={(e) => onVertexDown(e, r.key, rc, idx)} />
                    ))}

                    {/* points — clamped inside this room */}
                    {r.points.map((pt, pi) => {
                      const pp = pointPos(box, pt, pi, geom);
                      const isPS = sel?.type === 'point' && sel.key === pt.key;
                      const col = pt.isPlacement ? THEME.placement : THEME.point;
                      return (
                        <g key={pt.key} transform={`translate(${pp.x} ${pp.y})`}
                           style={{ cursor: 'grab' }} onPointerDown={(e) => onPointDown(e, pt.key, verts)}>
                          <circle r="7" fill={col} stroke={isPS ? '#fff' : 'rgba(0,0,0,0.4)'} strokeWidth={isPS ? 2 : 1} />
                          <text x="11" y="4" fontSize="10" fill={THEME.label}
                                fontFamily="ui-monospace, Menlo, monospace" pointerEvents="none">{pt.label}</text>
                        </g>
                      );
                    })}
                  </g>
                );
              })}

              {/* doors & windows — a slab/band on a wall, slidable along it */}
              {floorOpenings.map(([id, op]) => {
                const rc = rects[op.room]; const edge = polyEdges(roomPoly(rc))[op.edge]; if (!edge) return null;
                const a = G.edgePointAt(edge.a, edge.b, op.t);
                const deg = (edge.angle * 180) / Math.PI;
                const w = op.width * METER, isS = selOp && sel.key === id;
                const stroke = isS ? THEME.accent : THEME.opening;
                return (
                  <g key={id} transform={`translate(${a.x} ${a.y}) rotate(${deg})`}
                     style={{ cursor: tool === 'select' ? 'grab' : 'pointer' }}
                     onPointerDown={(e) => onOpeningDown(e, id)}>
                    {/* erase the wall under the opening */}
                    <rect x={-w / 2} y={-5} width={w} height={10} fill={THEME.bg} />
                    {op.kind === 'door' ? (
                      // scale mirrors the hinge (flipH) and swing side (flipV)
                      <g transform={`scale(${op.flipH ? -1 : 1} ${op.flipV ? -1 : 1})`} fill="none" stroke={stroke} strokeWidth="1.5">
                        <line x1={-w / 2} y1={0} x2={-w / 2} y2={-w} />
                        <path d={`M ${-w / 2} ${-w} A ${w} ${w} 0 0 1 ${w / 2} 0`} strokeDasharray="3 3" />
                      </g>
                    ) : (
                      <g stroke={stroke} strokeWidth="1.5">
                        <rect x={-w / 2} y={-3} width={w} height={6} fill="rgba(226,232,240,0.12)" />
                        <line x1={-w / 2} y1={0} x2={w / 2} y2={0} />
                      </g>
                    )}
                    <rect x={-w / 2} y={-6} width={w} height={12} fill="transparent" />
                  </g>
                );
              })}

              {/* furniture — a free décor layer (Arcada glyphs), draggable/rotatable */}
              {FurnitureGlyph && floorFurniture.map(([id, f]) => {
                const wpx = f.w * METER, hpx = f.h * METER;
                const isS = sel?.type === 'furniture' && sel.key === id;
                return (
                  <g key={id} transform={`translate(${f.x} ${f.y}) rotate(${f.rot || 0} ${wpx / 2} ${hpx / 2})`}
                     style={{ cursor: tool === 'select' ? 'grab' : 'default' }}
                     onPointerDown={(e) => onFurnitureDown(e, id, f)}>
                    <FurnitureGlyph texture={f.type} width={wpx} height={hpx} />
                    {isS && <rect x={-3} y={-3} width={wpx + 6} height={hpx + 6} fill="none"
                                  stroke={THEME.accent} strokeWidth="1.5" strokeDasharray="4 3" />}
                  </g>
                );
              })}
            </svg>
          </div>
          <aside className="fp-props">
            <div className="fp-props-h">{tool === 'furniture' ? 'Furniture library' : 'Properties'}</div>
            {tool === 'furniture' ? (() => {
              const q = furnQuery.trim().toLowerCase();
              const cats = Object.entries(FURNITURE_CATALOG)
                .map(([cat, items]) => [cat, q ? items.filter((it) => it.name.toLowerCase().includes(q) || cat.toLowerCase().includes(q)) : items])
                .filter(([, items]) => items.length);
              const total = cats.reduce((n, [, items]) => n + items.length, 0);
              return (
                <React.Fragment>
                  <div className="fp-pal-search-row">
                    <input className="fp-pal-search" type="text" placeholder="Filter furniture…"
                           value={furnQuery} onChange={(e) => setFurnQuery(e.target.value)} />
                  </div>
                  <div className="fp-props-b fp-scroll">
                    {cats.map(([cat, items]) => (
                      <div key={cat}>
                        <div className="fp-pal-cat">{cat}</div>
                        <div className="fp-pal-grid">
                          {items.map((it) => (
                            <button key={it.texture} className="fp-pal-item" title={`${it.name} · ${it.width}×${it.height} m`}
                                    onClick={() => addFurniture(it)}>
                              <svg viewBox={`-1 -1 ${it.width * METER + 2} ${it.height * METER + 2}`} preserveAspectRatio="xMidYMid meet">
                                <FurnitureGlyph texture={it.texture} width={it.width * METER} height={it.height * METER} />
                              </svg>
                              <span>{it.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {!total && <div className="fp-muted" style={{ padding: '12px 2px' }}>No furniture matches “{furnQuery}”.</div>}
                    <div className="fp-note">Click an item to drop it on the plan, then drag &amp; rotate it. Furniture glyphs are adapted from <b>Arcada</b> (Apache-2.0) — a sketch overlay.</div>
                  </div>
                </React.Fragment>
              );
            })() : selRoom ? (() => {
              const rc = rects[selRoom.key]; const isPoly = rc.poly?.length >= 3;
              const box = bbox(roomPoly(rc)); const wallCount = Object.keys(rc.walls || {}).length;
              return (
                <div className="fp-props-b">
                  <div className="fp-prow"><span>Room</span><b>{selRoom.name}</b></div>
                  <div className="fp-prow"><span>Type</span><b>{selRoom.roomType || '—'}</b></div>
                  <div className="fp-prow"><span>Area</span><b>{selRoom.area} m²</b></div>
                  <div className="fp-prow"><span>Shape</span><b>{isPoly ? `polygon · ${rc.poly.length} pts` : 'rectangle'}</b></div>
                  <div className="fp-prow"><span>Bounds</span><b>{(box.w / METER).toFixed(1)} × {(box.h / METER).toFixed(1)} m</b></div>
                  <div className="fp-prow"><span>Std walls</span><b>{wallCount}</b></div>
                  <div className="fp-prow"><span>Points</span><b>{selRoom.points.length}</b></div>
                  <button className="fp-btn fp-wide"
                          onClick={() => setRoom(selRoom.key, { poly: isPoly ? null : roomPoly(rc) })}>
                    {isPoly ? 'Reset to rectangle' : 'Turn off rectangle'}
                  </button>
                  <div className="fp-note">Structure is edited in the <b>Spatial</b> tab (Blockly is the master). This view stores the sketch — shape, walls, doors/windows — only.</div>
                </div>
              );
            })() : selWall ? (
              <div className="fp-props-b">
                <div className="fp-prow"><span>Wall</span><b>edge {sel.edge}</b></div>
                <div className="fp-prow"><span>Thickness</span><b>{(selWall.thickness || WALL_TH).toFixed(2)} m</b></div>
                <div className="fp-prow fp-stepper">
                  <button className="fp-btn" onClick={() => setWall(sel.key, sel.edge, { thickness: Math.max(0.05, +((selWall.thickness || WALL_TH) - 0.05).toFixed(2)) })}>−</button>
                  <button className="fp-btn" onClick={() => setWall(sel.key, sel.edge, { thickness: Math.min(0.5, +((selWall.thickness || WALL_TH) + 0.05).toFixed(2)) })}>＋</button>
                </div>
                <label className="fp-prow fp-check"><span>Reaches ceiling</span>
                  <input type="checkbox" checked={!selWall.partial}
                         onChange={(e) => setWall(sel.key, sel.edge, { partial: !e.target.checked, height: e.target.checked ? null : (selWall.height || 1.0) })} />
                </label>
                {selWall.partial && (
                  <React.Fragment>
                    <div className="fp-prow"><span>Height</span><b>{(selWall.height || 1.0).toFixed(1)} m</b></div>
                    <div className="fp-prow fp-stepper">
                      <button className="fp-btn" onClick={() => setWall(sel.key, sel.edge, { height: Math.max(0.3, +((selWall.height || 1.0) - 0.1).toFixed(1)) })}>−</button>
                      <button className="fp-btn" onClick={() => setWall(sel.key, sel.edge, { height: Math.min(2.4, +((selWall.height || 1.0) + 0.1).toFixed(1)) })}>＋</button>
                    </div>
                  </React.Fragment>
                )}
                <button className="fp-btn fp-wide fp-danger" onClick={() => removeWall(sel.key, sel.edge)}>Remove wall</button>
                <div className="fp-note">A partial-height wall (below the ceiling) renders dashed & faded.</div>
              </div>
            ) : selOp ? (
              <div className="fp-props-b">
                <div className="fp-prow"><span>Opening</span><b style={{ textTransform: 'capitalize' }}>{selOp.kind}</b></div>
                <div className="fp-prow"><span>Width</span><b>{selOp.width.toFixed(2)} m</b></div>
                <div className="fp-prow fp-stepper">
                  <button className="fp-btn" onClick={() => setOpening(sel.key, { width: Math.max(0.4, +(selOp.width - 0.1).toFixed(2)) })}>−</button>
                  <button className="fp-btn" onClick={() => setOpening(sel.key, { width: Math.min(2.4, +(selOp.width + 0.1).toFixed(2)) })}>＋</button>
                </div>
                {selOp.kind === 'door' && (
                  <div className="fp-prow fp-stepper">
                    <button className="fp-btn" onClick={() => setOpening(sel.key, { flipH: !selOp.flipH })}>Hinge ⇄</button>
                    <button className="fp-btn" onClick={() => setOpening(sel.key, { flipV: !selOp.flipV })}>Swing ⇅</button>
                  </div>
                )}
                <button className="fp-btn fp-wide fp-danger" onClick={() => removeOpening(sel.key)}>Delete opening</button>
                <div className="fp-note">Drag it along the wall to reposition{selOp.kind === 'door' ? '; flip the hinge or swing side' : ''}. A sketch overlay.</div>
              </div>
            ) : selFurn ? (
              <div className="fp-props-b">
                <div className="fp-prow"><span>Furniture</span><b>{selFurn.name || selFurn.type}</b></div>
                <div className="fp-prow"><span>Size</span><b>{selFurn.w} × {selFurn.h} m</b></div>
                <div className="fp-prow"><span>Rotation</span><b>{Math.round(selFurn.rot || 0)}°</b></div>
                <div className="fp-prow fp-stepper">
                  <button className="fp-btn" onClick={() => setFurniture(sel.key, { rot: ((selFurn.rot || 0) - 15 + 360) % 360 })}>⟲ 15°</button>
                  <button className="fp-btn" onClick={() => setFurniture(sel.key, { rot: ((selFurn.rot || 0) + 15) % 360 })}>⟳ 15°</button>
                </div>
                <button className="fp-btn fp-wide fp-danger" onClick={() => removeFurniture(sel.key)}>Delete furniture</button>
                <div className="fp-note">Drag to move; rotate in 15° steps. Pick more from the <b>Furniture</b> tool.</div>
              </div>
            ) : sel?.type === 'point' ? (
              <div className="fp-props-b"><div className="fp-prow"><span>Point</span><b>{sel.key.split(':').pop()}</b></div>
                <div className="fp-note">Drag to reposition — a point stays inside its linked room.</div></div>
            ) : (
              <div className="fp-props-b fp-muted">Select a room, point, opening or furniture. Use the tools to reshape walls, add doors/windows, or place furniture.</div>
            )}
          </aside>
        </div>
      </div>
    );
  }

  // ── Mount / refresh — the harness calls this on Floor-plan tab activation. A
  // changing key remounts App so it re-reads the (master) Spatial structure; the
  // geometry persists in the host (states.floorplan). ──
  let root = null;
  window.DHC_mountFloorplan = function (el) {
    const host = window.DHC_FLOORPLAN_HOST;
    if (!host) return;
    if (!root) root = ReactDOM.createRoot(el);
    root.render(React.createElement(App, { host, key: Date.now() }));
  };
})();
