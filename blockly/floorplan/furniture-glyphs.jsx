/*
 * Furniture glyph library for the floor-plan sketch — top-down architectural
 * icons + a catalog, lazy-loaded into the harness and exposed as
 * window.DHC_FURNITURE = { FurnitureGlyph, FURNITURE_CATALOG }.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ATTRIBUTION — Apache License 2.0
 * Adapted from **Arcada** (https://github.com/mehanix/arcada), an open-source
 * floor-planner © the Arcada authors, licensed under the Apache License, Version
 * 2.0. See blockly/floorplan/THIRD-PARTY-NOTICES.md for the notice and license.
 *
 * Changes from the upstream Work: the item list — names, real-world dimensions
 * (metres) and category grouping — is taken from Arcada's backend seed data
 * (arcada-backend/seed_data/furniture.json + categories.json); each item is
 * **re-drawn here as a self-contained vector SVG glyph** (Arcada ships low-res
 * raster PNGs embedded in SVG — none of its artwork/PIXI code is used), variants
 * share a glyph, the Wall/door/window/room-label/point items were dropped (the DHC
 * view draws those), and the module is namespaced onto window.DHC_FURNITURE.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Each glyph draws inside its local rect (0,0,w,h) in pixels; the caller sizes it
 * by width_m × METER. Compiled by Babel-standalone alongside floorplan-app.jsx.
 */
(function () {
  const STROKE = '#1a1a1a';
  const FILL_LIGHT = '#fafaf7';
  const FILL_SOFT = '#e8e4d8';
  const FILL_RUG = 'rgba(176,148,108,0.18)';
  const SW = 1.5;

  function rect(w, h, r = 6, fill = FILL_LIGHT) {
    return <rect x="0" y="0" width={w} height={h} rx={r} ry={r} fill={fill} stroke={STROKE} strokeWidth={SW} />;
  }

  const Glyphs = {
    sofa: (w, h) => (
      <g>
        {rect(w, h, 10)}
        <path d={`M 6 6 H ${w - 6} V ${h * 0.35} H 6 Z`} fill={FILL_SOFT} stroke={STROKE} strokeWidth={SW} />
        <line x1={w / 2} y1={h * 0.4} x2={w / 2} y2={h - 6} stroke={STROKE} strokeWidth={SW} />
        <line x1={w * 0.04} y1={h * 0.35} x2={w * 0.04} y2={h - 8} stroke={STROKE} strokeWidth={SW} />
        <line x1={w - w * 0.04} y1={h * 0.35} x2={w - w * 0.04} y2={h - 8} stroke={STROKE} strokeWidth={SW} />
      </g>
    ),
    armchair: (w, h) => (
      <g>
        {rect(w, h, 10)}
        <path d={`M 5 5 H ${w - 5} V ${h * 0.4} H 5 Z`} fill={FILL_SOFT} stroke={STROKE} strokeWidth={SW} />
        <line x1="6" y1={h * 0.4} x2="6" y2={h - 6} stroke={STROKE} strokeWidth={SW} />
        <line x1={w - 6} y1={h * 0.4} x2={w - 6} y2={h - 6} stroke={STROKE} strokeWidth={SW} />
      </g>
    ),
    chair: (w, h) => (
      <g>
        {rect(w, h, 4)}
        <path d={`M 3 3 H ${w - 3} V ${h * 0.25} H 3 Z`} fill={FILL_SOFT} stroke={STROKE} strokeWidth={SW} />
      </g>
    ),
    'coffee-table': (w, h) => (
      <g>
        {rect(w, h, 8, FILL_SOFT)}
        <rect x="6" y="6" width={w - 12} height={h - 12} rx="3" fill="none" stroke={STROKE} strokeWidth="1" opacity="0.4" />
      </g>
    ),
    'dining-table': (w, h) => (
      <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 2} ry={h / 2 - 2} fill={FILL_SOFT} stroke={STROKE} strokeWidth={SW} />
    ),
    desk: (w, h) => (
      <g>
        {rect(w, h, 4, FILL_SOFT)}
        <line x1="0" y1={h - 8} x2={w} y2={h - 8} stroke={STROKE} strokeWidth="1" opacity="0.4" />
      </g>
    ),
    bed: (w, h) => (
      <g>
        {rect(w, h, 6)}
        <rect x="4" y="4" width={w - 8} height={h * 0.12} rx="3" fill={FILL_SOFT} stroke={STROKE} strokeWidth={SW} />
        <rect x={w * 0.08} y={h * 0.18} width={w * 0.36} height={h * 0.18} rx="4" fill="#fff" stroke={STROKE} strokeWidth="1" />
        <rect x={w * 0.56} y={h * 0.18} width={w * 0.36} height={h * 0.18} rx="4" fill="#fff" stroke={STROKE} strokeWidth="1" />
        <line x1="6" y1={h * 0.62} x2={w - 6} y2={h * 0.62} stroke={STROKE} strokeWidth="1" opacity="0.5" />
      </g>
    ),
    nightstand: (w, h) => (
      <g>
        {rect(w, h, 3)}
        <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) * 0.22} fill="none" stroke={STROKE} strokeWidth="1" opacity="0.5" />
      </g>
    ),
    fridge: (w, h) => (
      <g>
        {rect(w, h, 3)}
        <line x1="0" y1={h * 0.4} x2={w} y2={h * 0.4} stroke={STROKE} strokeWidth="1" />
        <rect x={w * 0.78} y={h * 0.12} width="2" height={h * 0.22} fill={STROKE} />
        <rect x={w * 0.78} y={h * 0.55} width="2" height={h * 0.3} fill={STROKE} />
      </g>
    ),
    stove: (w, h) => {
      const cx1 = w * 0.28, cx2 = w * 0.72, cy1 = h * 0.3, cy2 = h * 0.7, r = Math.min(w, h) * 0.16;
      return (
        <g>
          {rect(w, h, 3, FILL_SOFT)}
          {[[cx1, cy1], [cx2, cy1], [cx1, cy2], [cx2, cy2]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={r} fill="#fff" stroke={STROKE} strokeWidth="1.2" />
          ))}
        </g>
      );
    },
    sink: (w, h) => (
      <g>
        {rect(w, h, 4)}
        <rect x="4" y="4" width={w - 8} height={h - 8} rx="3" fill="none" stroke={STROKE} strokeWidth="1" />
        <circle cx={w * 0.5} cy={h * 0.4} r="3" fill={STROKE} />
      </g>
    ),
    toilet: (w, h) => (
      <g>
        <rect x="4" y="0" width={w - 8} height={h * 0.32} rx="2" fill={FILL_SOFT} stroke={STROKE} strokeWidth={SW} />
        <ellipse cx={w / 2} cy={h * 0.65} rx={w / 2 - 2} ry={h * 0.32} fill={FILL_LIGHT} stroke={STROKE} strokeWidth={SW} />
      </g>
    ),
    bathtub: (w, h) => (
      <g>
        {rect(w, h, 8)}
        <rect x="6" y="6" width={w - 12} height={h - 12} rx="6" fill="#eef5fa" stroke={STROKE} strokeWidth="1" />
        <circle cx={w - 14} cy={h / 2} r="2.5" fill={STROKE} />
      </g>
    ),
    rug: (w, h) => (
      <rect x="2" y="2" width={w - 4} height={h - 4} rx="8" fill={FILL_RUG} stroke="#b0946c" strokeWidth="1.2" strokeDasharray="6 4" />
    ),
    plant: (w, h) => {
      const r = Math.min(w, h) / 2 - 1, cx = w / 2, cy = h / 2;
      return (
        <g>
          <circle cx={cx} cy={cy} r={r} fill={FILL_LIGHT} stroke={STROKE} strokeWidth={SW} />
          {[0, 72, 144, 216, 288].map((a, i) => {
            const rad = (a * Math.PI) / 180;
            return <circle key={i} cx={cx + Math.cos(rad) * r * 0.55} cy={cy + Math.sin(rad) * r * 0.55} r={r * 0.32} fill="#6b8e5e" stroke={STROKE} strokeWidth="1" opacity="0.85" />;
          })}
          <circle cx={cx} cy={cy} r={r * 0.25} fill="#5a7a4e" stroke={STROKE} strokeWidth="1" />
        </g>
      );
    },
    tv: (w, h) => (
      <g>
        <rect x="0" y="0" width={w} height={h} rx="2" fill="#1a1a1a" stroke={STROKE} strokeWidth={SW} />
        <rect x="2" y="2" width={w - 4} height={h - 4} rx="1" fill="#2a3a4a" stroke="none" />
      </g>
    ),
    stool: (w, h) => (
      <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 2 - 2} fill={FILL_LIGHT} stroke={STROKE} strokeWidth={SW} />
    ),
    'round-table': (w, h) => (
      <g>
        <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 2 - 2} fill={FILL_SOFT} stroke={STROKE} strokeWidth={SW} />
        <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 2 - 8} fill="none" stroke={STROKE} strokeWidth="1" opacity="0.35" />
      </g>
    ),
    'side-table': (w, h) => (
      <g>
        {rect(w, h, 3, FILL_SOFT)}
        <rect x="4" y="4" width={w - 8} height={h - 8} rx="2" fill="none" stroke={STROKE} strokeWidth="1" opacity="0.4" />
      </g>
    ),
    wardrobe: (w, h) => (
      <g>
        {rect(w, h, 3)}
        <line x1={w / 2} y1="3" x2={w / 2} y2={h - 3} stroke={STROKE} strokeWidth="1" />
        <circle cx={w / 2 - 4} cy={h / 2} r="1.5" fill={STROKE} />
        <circle cx={w / 2 + 4} cy={h / 2} r="1.5" fill={STROKE} />
      </g>
    ),
    dresser: (w, h) => (
      <g>
        {rect(w, h, 3)}
        {[0.33, 0.66].map((fy, i) => <line key={i} x1="3" y1={h * fy} x2={w - 3} y2={h * fy} stroke={STROKE} strokeWidth="1" />)}
        {[0.165, 0.5, 0.83].map((fy, i) => <circle key={i} cx={w / 2} cy={h * fy} r="1.6" fill={STROKE} />)}
      </g>
    ),
    bookshelf: (w, h) => (
      <g>
        {rect(w, h, 2, FILL_SOFT)}
        {[0.33, 0.66].map((fy, i) => <line key={i} x1="2" y1={h * fy} x2={w - 2} y2={h * fy} stroke={STROKE} strokeWidth="1" />)}
        {[0.15, 0.3, 0.45, 0.6, 0.75].map((fx, i) => <line key={i} x1={w * fx} y1="3" x2={w * fx} y2={h * 0.3} stroke={STROKE} strokeWidth="0.8" opacity="0.6" />)}
      </g>
    ),
    oven: (w, h) => (
      <g>
        {rect(w, h, 3)}
        {[0.25, 0.5, 0.75].map((fx, i) => <circle key={i} cx={w * fx} cy={h * 0.15} r={Math.min(w, h) * 0.06} fill="none" stroke={STROKE} strokeWidth="1" />)}
        <rect x="4" y={h * 0.28} width={w - 8} height={h * 0.62} rx="2" fill="none" stroke={STROKE} strokeWidth="1" />
        <line x1={w * 0.3} y1={h * 0.4} x2={w * 0.7} y2={h * 0.4} stroke={STROKE} strokeWidth="1.5" />
      </g>
    ),
    dishwasher: (w, h) => (
      <g>
        {rect(w, h, 3, FILL_SOFT)}
        <line x1={w * 0.2} y1={h * 0.15} x2={w * 0.8} y2={h * 0.15} stroke={STROKE} strokeWidth="2" />
        <rect x="5" y={h * 0.28} width={w - 10} height={h * 0.6} rx="2" fill="none" stroke={STROKE} strokeWidth="1" />
      </g>
    ),
    'washing-machine': (w, h) => (
      <g>
        {rect(w, h, 3)}
        <line x1="4" y1={h * 0.22} x2={w - 4} y2={h * 0.22} stroke={STROKE} strokeWidth="0.8" opacity="0.5" />
        <circle cx={w / 2} cy={h * 0.58} r={Math.min(w, h) * 0.3} fill="#eef5fa" stroke={STROKE} strokeWidth="1.2" />
        <circle cx={w / 2} cy={h * 0.58} r={Math.min(w, h) * 0.16} fill="none" stroke={STROKE} strokeWidth="1" />
      </g>
    ),
    shower: (w, h) => (
      <g>
        {rect(w, h, 3)}
        <path d={`M 4 4 A ${w - 8} ${h - 8} 0 0 1 ${w - 4} ${h - 4}`} fill="none" stroke={STROKE} strokeWidth="1" opacity="0.45" />
        <circle cx={w - 9} cy="9" r="2.5" fill="none" stroke={STROKE} strokeWidth="1.2" />
        <circle cx={w / 2} cy={h / 2} r="2" fill={STROKE} />
      </g>
    ),
    bidet: (w, h) => (
      <g>
        <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 2} ry={h / 2 - 2} fill={FILL_LIGHT} stroke={STROKE} strokeWidth={SW} />
        <circle cx={w / 2} cy={h * 0.4} r="2" fill={STROKE} />
      </g>
    ),
    counter: (w, h) => (
      <g>
        {rect(w, h, 2, FILL_SOFT)}
        <rect x="3" y="3" width={w - 6} height={h - 6} rx="1" fill="none" stroke={STROKE} strokeWidth="1" opacity="0.35" />
      </g>
    ),
    box: (w, h) => rect(w, h, 3),
    staircase: (w, h) => {
      const along = w >= h, n = Math.max(4, Math.round((along ? w : h) / 12));
      const steps = [];
      for (let i = 1; i < n; i++) {
        const f = i / n;
        steps.push(along
          ? <line key={i} x1={w * f} y1="2" x2={w * f} y2={h - 2} stroke={STROKE} strokeWidth="1" />
          : <line key={i} x1="2" y1={h * f} x2={w - 2} y2={h * f} stroke={STROKE} strokeWidth="1" />);
      }
      return (
        <g>
          {rect(w, h, 2, FILL_SOFT)}
          {steps}
          <line x1={w * 0.5} y1={h * 0.5} x2={along ? w - 4 : w * 0.5} y2={along ? h * 0.5 : h - 4}
                stroke={STROKE} strokeWidth="1.5" markerEnd="" opacity="0.6" />
        </g>
      );
    },
    car: (w, h) => (
      <g>
        <rect x="1" y="1" width={w - 2} height={h - 2} rx={Math.min(w, h) * 0.18} fill={FILL_SOFT} stroke={STROKE} strokeWidth={SW} />
        <rect x={w * 0.2} y={h * 0.16} width={w * 0.6} height={h * 0.26} rx="2" fill="#cdd7e5" stroke={STROKE} strokeWidth="1" />
        <rect x={w * 0.2} y={h * 0.58} width={w * 0.6} height={h * 0.26} rx="2" fill="#cdd7e5" stroke={STROKE} strokeWidth="1" />
      </g>
    ),
  };

  function FurnitureGlyph({ texture, width, height }) {
    const G = Glyphs[texture];
    if (G) return G(width, height);
    return (
      <g>
        <rect x="0" y="0" width={width} height={height} rx="4" fill={FILL_SOFT} stroke={STROKE} strokeWidth={SW} strokeDasharray="4 3" />
        <text x={width / 2} y={height / 2 + 4} fontSize="10" textAnchor="middle" fill={STROKE} fontFamily="monospace">{texture}</text>
      </g>
    );
  }

  // Catalog (display name + category + real dimensions in metres) — from Arcada.
  // Full catalog — item names, real-world dimensions (metres) and categories are
  // Arcada's (seed_data/furniture.json); `texture` maps each to one of our vector
  // glyphs above (variants share a glyph — the name/size differentiate them). The
  // Wall category (door/window) is omitted: the DHC view places those via its own
  // Door/Window tools.
  const FURNITURE_CATALOG = {
    Bedroom: [
      { texture: 'bed', name: 'Double bed', width: 1.6, height: 2.0 },
      { texture: 'bed', name: 'Single bed', width: 1.0, height: 2.0 },
      { texture: 'nightstand', name: 'Bedside table 1', width: 0.8, height: 0.5 },
      { texture: 'nightstand', name: 'Bedside table 2', width: 0.8, height: 0.5 },
      { texture: 'rug', name: 'Bedside rug', width: 0.8, height: 1.2 },
      { texture: 'dresser', name: 'Wardrobe — small', width: 1.5, height: 1.0 },
      { texture: 'wardrobe', name: 'Wardrobe — large', width: 2.5, height: 0.8 },
      { texture: 'plant', name: 'Large plant', width: 1.0, height: 1.0 },
      { texture: 'armchair', name: 'Lounge chair', width: 0.8, height: 0.9 },
      { texture: 'chair', name: 'Chair', width: 0.6, height: 0.6 },
      { texture: 'rug', name: 'Oval rug', width: 1.5, height: 1.0 },
      { texture: 'coffee-table', name: 'Table', width: 1.2, height: 0.8 },
      { texture: 'round-table', name: 'Round table — small', width: 0.6, height: 0.6 },
    ],
    Kitchen: [
      { texture: 'stove', name: 'Stove — 4 spots', width: 0.6, height: 0.6 },
      { texture: 'stove', name: 'Stove — 5 spots', width: 0.8, height: 0.6 },
      { texture: 'fridge', name: 'Fridge', width: 0.6, height: 0.6 },
      { texture: 'sink', name: 'Sink', width: 1.0, height: 0.6 },
      { texture: 'counter', name: 'Bar counter', width: 1.6, height: 0.6 },
      { texture: 'stool', name: 'Bar stool', width: 0.55, height: 0.5 },
      { texture: 'counter', name: 'Fume hood', width: 0.6, height: 0.4 },
      { texture: 'sink', name: 'Double kitchen sink', width: 1.2, height: 0.6 },
      { texture: 'sink', name: 'Kitchen sink — corner', width: 1.0, height: 0.55 },
      { texture: 'counter', name: 'Countertop — corner', width: 0.9, height: 0.9 },
      { texture: 'coffee-table', name: 'Table — small', width: 1.2, height: 0.8 },
      { texture: 'counter', name: 'Countertop', width: 0.63, height: 0.63 },
      { texture: 'coffee-table', name: 'Dinner table — 4 people', width: 1.0, height: 1.0 },
      { texture: 'dining-table', name: 'Dinner table — 6 people', width: 1.6, height: 0.9 },
      { texture: 'chair', name: 'Dinner chair 1', width: 0.7, height: 0.7 },
      { texture: 'chair', name: 'Dinner chair 2', width: 0.6, height: 0.85 },
      { texture: 'oven', name: 'Oven', width: 0.6, height: 0.6 },
      { texture: 'dishwasher', name: 'Dishwasher', width: 0.7, height: 0.7 },
    ],
    'Living Room': [
      { texture: 'armchair', name: 'Armchair', width: 1.2, height: 1.0 },
      { texture: 'sofa', name: 'Couch — 2 seats', width: 1.8, height: 1.0 },
      { texture: 'sofa', name: 'Couch', width: 2.4, height: 1.0 },
      { texture: 'plant', name: 'Plant 1', width: 0.6, height: 0.6 },
      { texture: 'plant', name: 'Plant 2', width: 0.6, height: 0.6 },
      { texture: 'plant', name: 'Plant 3', width: 0.6, height: 0.6 },
      { texture: 'armchair', name: 'Sectional couch — seat', width: 0.7, height: 0.7 },
      { texture: 'armchair', name: 'Sectional couch — corner', width: 0.7, height: 0.7 },
      { texture: 'tv', name: 'TV', width: 1.1, height: 0.15 },
      { texture: 'coffee-table', name: 'Coffee table', width: 1.2, height: 0.65 },
      { texture: 'rug', name: 'Rug', width: 3.0, height: 2.0 },
    ],
    Bathroom: [
      { texture: 'bathtub', name: 'Bathtub', width: 1.0, height: 2.0 },
      { texture: 'bathtub', name: 'Bathtub — corner', width: 2.0, height: 2.0 },
      { texture: 'bathtub', name: 'Bathtub — oval', width: 1.2, height: 2.0 },
      { texture: 'sink', name: 'Sink', width: 0.8, height: 0.6 },
      { texture: 'sink', name: 'Corner sink', width: 0.7, height: 0.7 },
      { texture: 'sink', name: 'Round sink', width: 0.7, height: 0.7 },
      { texture: 'toilet', name: 'Toilet', width: 0.7, height: 1.0 },
      { texture: 'bidet', name: 'Bidet', width: 0.6, height: 0.8 },
      { texture: 'shower', name: 'Shower', width: 1.1, height: 1.1 },
      { texture: 'washing-machine', name: 'Washing machine', width: 0.7, height: 0.7 },
    ],
    Office: [
      { texture: 'chair', name: 'Chair', width: 0.6, height: 0.6 },
      { texture: 'tv', name: 'Computer monitor', width: 0.8, height: 0.1 },
      { texture: 'box', name: 'Computer', width: 0.8, height: 0.4 },
      { texture: 'desk', name: 'Corner desk', width: 1.0, height: 1.5 },
      { texture: 'desk', name: 'Desk', width: 1.2, height: 0.8 },
      { texture: 'bookshelf', name: 'Bookshelf', width: 0.9, height: 0.3 },
    ],
    Structural: [
      { texture: 'staircase', name: 'Staircase — small', width: 2.0, height: 1.6 },
      { texture: 'staircase', name: 'Staircase — medium', width: 2.0, height: 2.0 },
      { texture: 'staircase', name: 'Staircase — long', width: 2.0, height: 4.0 },
      { texture: 'staircase', name: 'Staircase — corner', width: 3.0, height: 3.0 },
      { texture: 'staircase', name: 'Staircase — round', width: 3.0, height: 3.0 },
      { texture: 'box', name: 'Stair cover', width: 1.0, height: 1.5 },
    ],
    Other: [
      { texture: 'bookshelf', name: 'Shoe rack', width: 1.1, height: 0.4 },
      { texture: 'rug', name: 'Welcome mat', width: 0.6, height: 0.3 },
      { texture: 'stool', name: 'Plate', width: 0.25, height: 0.2 },
      { texture: 'box', name: 'Generic object', width: 0.5, height: 0.5 },
      { texture: 'car', name: 'Car', width: 4.0, height: 2.0 },
    ],
  };

  window.DHC_FURNITURE = { FurnitureGlyph, FURNITURE_CATALOG };
})();
