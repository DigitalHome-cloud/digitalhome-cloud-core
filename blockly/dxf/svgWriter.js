/* VENDORED from repos/designer/src/export/dxf/ (canonical copy lives there).
 * Build-free ESM: relative imports carry .js; manifest is manifest.js. Do not hand-diverge;
 * re-vendor when the Designer engine changes. See blockly/README.md (Diagram / DXF). */
/**
 * SVG emitter mirroring the public surface of `dxfWriter.js`.
 *
 * Lets `unifilaire.js` and the library modules produce an in-browser preview
 * from the same entity calls without a DXF parser. DXF model space (y-up, mm)
 * is translated to SVG (y-down) by negating y at emit time; viewBox is derived
 * from the tracked bounds.
 *
 * Supported primitives: line, circle, arc, text, rect (as 4 lines), insert,
 * addBlock, ensureLayer, imagePlaceholder. Matches dxfWriter.js exactly.
 */

export function createSvg() {
  const layers = new Map();
  const blocks = new Map();
  const entities = [];
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  function track(x, y) {
    if (x < bounds.minX) bounds.minX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y > bounds.maxY) bounds.maxY = y;
  }

  function ensureLayer(name, color = 7) {
    if (!layers.has(name)) layers.set(name, { name, color });
  }

  function entityApi(sink, trackBounds) {
    return {
      line(x1, y1, x2, y2) {
        if (trackBounds) { track(x1, y1); track(x2, y2); }
        sink.push(`<line x1="${n(x1)}" y1="${n(-y1)}" x2="${n(x2)}" y2="${n(-y2)}"/>`);
      },
      circle(cx, cy, r) {
        if (trackBounds) { track(cx - r, cy - r); track(cx + r, cy + r); }
        sink.push(`<circle cx="${n(cx)}" cy="${n(-cy)}" r="${n(r)}"/>`);
      },
      arc(cx, cy, r, startDeg, endDeg) {
        if (trackBounds) { track(cx - r, cy - r); track(cx + r, cy + r); }
        const rad = (d) => (d * Math.PI) / 180;
        const x1 = cx + r * Math.cos(rad(startDeg));
        const y1 = cy + r * Math.sin(rad(startDeg));
        const x2 = cx + r * Math.cos(rad(endDeg));
        const y2 = cy + r * Math.sin(rad(endDeg));
        let sweep = endDeg - startDeg;
        while (sweep < 0) sweep += 360;
        const large = sweep > 180 ? 1 : 0;
        // DXF CCW in y-up == SVG "sweep-flag=1" after y-flip.
        sink.push(
          `<path d="M ${n(x1)} ${n(-y1)} A ${n(r)} ${n(r)} 0 ${large} 1 ${n(x2)} ${n(-y2)}"/>`,
        );
      },
      text(x, y, height, value, { align = "left" } = {}) {
        const s = String(value ?? "");
        if (trackBounds) { track(x, y); track(x + s.length * height * 0.6, y + height); }
        const anchor = align === "center" ? "middle" : "start";
        sink.push(
          `<text x="${n(x)}" y="${n(-y)}" font-size="${n(height)}" text-anchor="${anchor}" font-family="monospace" fill="#000" stroke="none">${esc(s)}</text>`,
        );
      },
      rect(x, y, w, h, opts = {}) {
        this.line(x, y, x + w, y, opts);
        this.line(x + w, y, x + w, y + h, opts);
        this.line(x + w, y + h, x, y + h, opts);
        this.line(x, y + h, x, y, opts);
      },
      insert(blockName, x, y, { rotation = 0 } = {}) {
        if (trackBounds) track(x, y);
        const rot = rotation ? ` rotate(${n(-rotation)})` : "";
        sink.push(`<use href="#blk-${cssId(blockName)}" transform="translate(${n(x)} ${n(-y)})${rot}"/>`);
      },
    };
  }

  const api = entityApi(entities, true);

  function addBlock(name, drawFn) {
    if (blocks.has(name)) return;
    const ents = [];
    drawFn(entityApi(ents, false));
    blocks.set(name, ents);
  }

  return {
    ensureLayer,
    addBlock,
    ...api,
    imagePlaceholder(file, x, y, w, h, { layer = "0" } = {}) {
      ensureLayer(layer);
      api.rect(x, y, w, h);
      api.line(x, y, x + w, y + h);
      api.line(x + w, y, x, y + h);
      api.text(x + 2, y + h - 5, 3, `[IMAGE] ${file}`);
      api.text(x + 2, y + 2, 2, `${w} × ${h} mm`);
    },
    toString() {
      if (!Number.isFinite(bounds.minX)) {
        bounds.minX = 0; bounds.minY = 0; bounds.maxX = 100; bounds.maxY = 100;
      }
      const pad = 5;
      const minX = bounds.minX - pad;
      const maxY = bounds.maxY + pad;
      const w = bounds.maxX - bounds.minX + 2 * pad;
      const h = bounds.maxY - bounds.minY + 2 * pad;
      const defs = [];
      for (const [name, ents] of blocks.entries()) {
        defs.push(`<symbol id="blk-${cssId(name)}" overflow="visible">${ents.join("")}</symbol>`);
      }
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(minX)} ${n(-maxY)} ${n(w)} ${n(h)}" preserveAspectRatio="xMidYMid meet">` +
        `<defs>${defs.join("")}</defs>` +
        `<g stroke="#000" stroke-width="0.2" fill="none" vector-effect="non-scaling-stroke">${entities.join("")}</g>` +
        `</svg>`
      );
    },
  };
}

function n(v) {
  return Number(v).toFixed(3);
}

function cssId(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
