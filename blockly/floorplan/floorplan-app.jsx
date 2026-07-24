/*
 * Floor-plan sketch — React island embedded in the unified harness (preview.html),
 * lazy-loaded on first "Floor plan" tab activation. Reuses the look/feel of the
 * experimental prototype (experimental/floor-planner, MIT) but is a focused Phase-1
 * build: rooms from the Spatial Blockly (master) drawn as draggable/resizable
 * rectangles, points clamped inside their linked room, geometry persisted to a
 * `floorplan` layer via window.DHC_FLOORPLAN_HOST.
 *
 * Deps: React 18 + ReactDOM (UMD globals), compiled by Babel-standalone at load.
 * Structure = Blockly (dhcb: spatial); geometry = this view. No A-Box, no build.
 */
(function () {
  // Pure helpers shared with the vitest guard; the harness loads them before
  // mounting us. geometry = auto-layout / resize / point-clamp; parse walks the
  // dhcb: Spatial serialization → floors (Blockly masters the structure, incl.
  // levels stacked via next-connections — handled in spatial-parse.mjs).
  const G = window.DHC_FLOORPLAN_GEOM;
  const { METER, GAP, PTPAD, clamp, withGeometry, pointPos } = G;
  const { parseSpatial } = window.DHC_FLOORPLAN_PARSE;

  const THEME = {
    bg: '#0d1929', grid: 'rgba(148,163,184,0.16)', wall: '#cbd5f5', label: '#94a3b8',
    room: 'rgba(59,130,246,0.07)', roomStroke: 'rgba(148,163,184,0.55)', accent: '#22c55e',
    point: '#a855f7', placement: '#3b82f6',
  };

  // svg user-space point from a client event
  function svgPt(svg, clientX, clientY) {
    const p = svg.createSVGPoint(); p.x = clientX; p.y = clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }

  const { useState, useRef, useMemo, useEffect } = React;

  function App({ host }) {
    const spatial = useMemo(() => parseSpatial(host.getSpatial()), [host]);
    const [geom, setGeom] = useState(() => host.getFloorplan() || {});
    const [floorIdx, setFloorIdx] = useState(0);
    const [sel, setSel] = useState(null);                       // {type:'room'|'point', key}
    const [view, setView] = useState({ scale: 1, x: 40, y: 40 });
    const svgRef = useRef(null);
    const drag = useRef(null);

    const floor = spatial.floors[floorIdx];
    const rects = useMemo(() => floor ? withGeometry(floor.rooms, geom) : {}, [floor, geom]);

    function persist(next) { setGeom(next); host.setFloorplan(next); }
    function setRoomRect(key, rect) {
      persist({ ...geom, rooms: { ...(geom.rooms || {}), [key]: rect } });
    }
    function setPointPos(key, pos) {
      persist({ ...geom, points: { ...(geom.points || {}), [key]: pos } });
    }

    // ── pointer drag (rooms: move/resize; points: move clamped to room) ──
    function onPointerDown(e, kind, key, mode, room) {
      e.stopPropagation();
      const svg = svgRef.current;
      const p = svgPt(svg, e.clientX, e.clientY);
      setSel({ type: kind === 'pt' ? 'point' : 'room', key });
      const rect = kind === 'room' ? rects[key] : null;
      const pos = kind === 'pt' ? (geom.points?.[key] || { x: p.x, y: p.y }) : null;
      drag.current = { kind, key, mode, room, startX: p.x, startY: p.y, rect, pos };
      svg.setPointerCapture?.(e.pointerId);
    }
    function onPointerMove(e) {
      const d = drag.current; if (!d) return;
      const p = svgPt(svgRef.current, e.clientX, e.clientY);
      const dx = p.x - d.startX, dy = p.y - d.startY;
      if (d.kind === 'room') {
        setRoomRect(d.key, G.moveOrResize(d.rect, d.mode, dx, dy));
      } else {                                                  // point: clamp inside its room
        setPointPos(d.key, G.clampPointToRoom(d.pos, dx, dy, d.room));
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
    const selPt = sel?.type === 'point';

    return (
      <div className="fp-wrap">
        <div className="fp-bar">
          <select className="fp-select" value={floorIdx} onChange={(e) => { setFloorIdx(+e.target.value); setSel(null); }}>
            {spatial.floors.map((f, i) => <option key={f.key} value={i}>{f.label}</option>)}
          </select>
          <span className="fp-sep" />
          <button className="fp-btn" onClick={() => setScale(1 / 1.25)} title="Zoom out">−</button>
          <button className="fp-btn" onClick={() => setView({ scale: 1, x: 40, y: 40 })} title="Reset">Fit</button>
          <button className="fp-btn" onClick={() => setScale(1.25)} title="Zoom in">＋</button>
          <span className="fp-hint">{floor.rooms.length} rooms · drag to move, corners to resize · points clamp to their room</span>
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
                const isSel = sel?.type === 'room' && sel.key === r.key;
                return (
                  <g key={r.key}>
                    {/* room = dotted "sketch" walls + subtle fill */}
                    <rect x={rc.x} y={rc.y} width={rc.w} height={rc.h}
                          fill={THEME.room} stroke={isSel ? THEME.accent : THEME.roomStroke}
                          strokeWidth={isSel ? 2 : 1.5} strokeDasharray="6 5" rx="2"
                          style={{ cursor: 'move' }}
                          onPointerDown={(e) => onPointerDown(e, 'room', r.key, 'move', rc)} />
                    <text x={rc.x + 8} y={rc.y + 18} fontSize="13" fill={THEME.wall}
                          fontFamily="system-ui, sans-serif" pointerEvents="none">{r.name}</text>
                    <text x={rc.x + 8} y={rc.y + 33} fontSize="10" fill={THEME.label}
                          fontFamily="ui-monospace, Menlo, monospace" pointerEvents="none">
                      {r.roomType} · {r.area} m²</text>
                    {/* resize handles when selected */}
                    {isSel && [['nw', 0, 0], ['ne', rc.w, 0], ['sw', 0, rc.h], ['se', rc.w, rc.h]].map(([m, hx, hy]) => (
                      <rect key={m} x={rc.x + hx - 5} y={rc.y + hy - 5} width="10" height="10"
                            fill="#fff" stroke={THEME.accent} strokeWidth="1.5"
                            style={{ cursor: (m === 'nw' || m === 'se') ? 'nwse-resize' : 'nesw-resize' }}
                            onPointerDown={(e) => onPointerDown(e, 'room', r.key, m, rc)} />
                    ))}
                    {/* points — clamped inside this room */}
                    {r.points.map((pt, pi) => {
                      const pp = pointPos(rc, pt, pi, geom);
                      const isPS = sel?.type === 'point' && sel.key === pt.key;
                      const col = pt.isPlacement ? THEME.placement : THEME.point;
                      return (
                        <g key={pt.key} transform={`translate(${pp.x} ${pp.y})`}
                           style={{ cursor: 'grab' }}
                           onPointerDown={(e) => onPointerDown(e, 'pt', pt.key, 'move', rc)}>
                          <circle r="7" fill={col} stroke={isPS ? '#fff' : 'rgba(0,0,0,0.4)'} strokeWidth={isPS ? 2 : 1} />
                          <text x="11" y="4" fontSize="10" fill={THEME.label}
                                fontFamily="ui-monospace, Menlo, monospace" pointerEvents="none">{pt.label}</text>
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          </div>
          <aside className="fp-props">
            <div className="fp-props-h">Properties</div>
            {selRoom ? (
              <div className="fp-props-b">
                <div className="fp-prow"><span>Room</span><b>{selRoom.name}</b></div>
                <div className="fp-prow"><span>Type</span><b>{selRoom.roomType || '—'}</b></div>
                <div className="fp-prow"><span>Area</span><b>{selRoom.area} m²</b></div>
                <div className="fp-prow"><span>Size</span><b>{(rects[selRoom.key].w / METER).toFixed(1)} × {(rects[selRoom.key].h / METER).toFixed(1)} m</b></div>
                <div className="fp-prow"><span>Points</span><b>{selRoom.points.length}</b></div>
                <div className="fp-note">Structure is edited in the <b>Spatial</b> tab (Blockly is the master). This view stores layout only.</div>
              </div>
            ) : selPt ? (
              <div className="fp-props-b"><div className="fp-prow"><span>Point</span><b>{sel.key.split(':').pop()}</b></div>
                <div className="fp-note">Drag to reposition — a point stays inside its linked room.</div></div>
            ) : (
              <div className="fp-props-b fp-muted">Select a room or point.</div>
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
