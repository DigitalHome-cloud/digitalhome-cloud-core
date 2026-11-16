/* VENDORED from repos/designer/src/export/dxf/ (canonical copy lives there).
 * Build-free ESM: relative imports carry .js; manifest is manifest.js. Do not hand-diverge;
 * re-vendor when the Designer engine changes. See blockly/README.md (Diagram / DXF). */
/**
 * Minimal AutoCAD R12 ASCII DXF writer.
 *
 * Only the entities we need for NF C 15-100 schemas: LINE, CIRCLE, ARC, TEXT,
 * INSERT, plus BLOCK definitions and named LAYERS. Output validates in
 * LibreCAD, QCAD, and AutoCAD.
 *
 * Intentionally dependency-free: the approved plan called for `dxf-writer`,
 * but a ~150-line hand-rolled writer keeps the Gatsby bundle lean and avoids
 * pulling another package. Swap in dxf-writer later if we need SPLINE/HATCH.
 */

export function createDxf() {
  const layers = new Map();
  const blocks = new Map();
  const entities = [];

  function ensureLayer(name, color = 7) {
    if (!layers.has(name)) layers.set(name, { name, color });
  }

  function addBlock(name, drawFn) {
    if (blocks.has(name)) return;
    const ents = [];
    const api = entityApi(ents, () => "0");
    drawFn(api);
    blocks.set(name, ents);
  }

  const api = entityApi(entities, () => "0");

  return {
    ensureLayer,
    addBlock,
    ...api,
    insert(blockName, x, y, { rotation = 0, layer = "0" } = {}) {
      ensureLayer(layer);
      entities.push([
        ["0", "INSERT"],
        ["8", layer],
        ["2", blockName],
        ["10", num(x)],
        ["20", num(y)],
        ["30", "0.0"],
        ["50", num(rotation)],
      ]);
    },
    /**
     * Placeholder rendering for a raster picture. Draws a bounding rectangle
     * and a label indicating the source file. Acts as the stub for the
     * future AC1015 IMAGE/IMAGEDEF entity emission (see library/README
     * § Follow-ups). `file` is stored in a comment-like TEXT so a future
     * reader can locate the source. Coordinates are bottom-left origin.
     */
    imagePlaceholder(file, x, y, widthMm, heightMm, { layer = "0" } = {}) {
      ensureLayer(layer);
      api.rect(x, y, widthMm, heightMm, { layer });
      api.line(x, y, x + widthMm, y + heightMm, { layer });
      api.line(x + widthMm, y, x, y + heightMm, { layer });
      api.text(x + 2, y + heightMm - 5, 3, `[IMAGE] ${file}`, { layer });
      api.text(x + 2, y + 2, 2, `${widthMm} × ${heightMm} mm`, { layer });
    },
    toString() {
      return render(layers, blocks, entities);
    },
  };
}

function entityApi(sink, defaultLayer) {
  return {
    line(x1, y1, x2, y2, { layer = defaultLayer() } = {}) {
      sink.push([
        ["0", "LINE"],
        ["8", layer],
        ["10", num(x1)], ["20", num(y1)], ["30", "0.0"],
        ["11", num(x2)], ["21", num(y2)], ["31", "0.0"],
      ]);
    },
    circle(cx, cy, r, { layer = defaultLayer() } = {}) {
      sink.push([
        ["0", "CIRCLE"],
        ["8", layer],
        ["10", num(cx)], ["20", num(cy)], ["30", "0.0"],
        ["40", num(r)],
      ]);
    },
    arc(cx, cy, r, startDeg, endDeg, { layer = defaultLayer() } = {}) {
      sink.push([
        ["0", "ARC"],
        ["8", layer],
        ["10", num(cx)], ["20", num(cy)], ["30", "0.0"],
        ["40", num(r)],
        ["50", num(startDeg)], ["51", num(endDeg)],
      ]);
    },
    text(x, y, height, value, { layer = defaultLayer(), align = "left" } = {}) {
      const rec = [
        ["0", "TEXT"],
        ["8", layer],
        ["10", num(x)], ["20", num(y)], ["30", "0.0"],
        ["40", num(height)],
        ["1", escapeDxfText(value)],
      ];
      if (align === "center") {
        rec.push(["72", "1"], ["11", num(x)], ["21", num(y)], ["31", "0.0"]);
      }
      sink.push(rec);
    },
    rect(x, y, w, h, opts = {}) {
      this.line(x, y, x + w, y, opts);
      this.line(x + w, y, x + w, y + h, opts);
      this.line(x + w, y + h, x, y + h, opts);
      this.line(x, y + h, x, y, opts);
    },
    insert(blockName, x, y, { rotation = 0, layer = defaultLayer() } = {}) {
      sink.push([
        ["0", "INSERT"],
        ["8", layer],
        ["2", blockName],
        ["10", num(x)],
        ["20", num(y)],
        ["30", "0.0"],
        ["50", num(rotation)],
      ]);
    },
  };
}

function num(n) {
  return Number(n).toFixed(4);
}

/**
 * DXF TEXT values must be ASCII. Non-ASCII chars are encoded as \U+XXXX
 * (AutoCAD Unicode escape), which LibreCAD / QCAD / AutoCAD all decode.
 * Backslashes and control chars are escaped too.
 */
function escapeDxfText(value) {
  const s = String(value ?? "");
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code < 0x20 || code === 0x5e) continue; // skip controls + caret
    if (code === 0x5c) { out += "\\\\"; continue; } // backslash
    if (code < 0x80) { out += ch; continue; }
    out += "\\U+" + code.toString(16).toUpperCase().padStart(4, "0");
  }
  return out;
}

function emit(pairs) {
  const out = [];
  for (const [code, value] of pairs) {
    out.push(String(code));
    out.push(String(value));
  }
  return out.join("\n");
}

function render(layers, blocks, entities) {
  const parts = [];

  parts.push(emit([["0", "SECTION"], ["2", "HEADER"],
    ["9", "$ACADVER"], ["1", "AC1009"],
    ["9", "$DWGCODEPAGE"], ["3", "ANSI_1252"],
    ["9", "$INSUNITS"], ["70", "4"],
    ["0", "ENDSEC"],
  ]));

  const tableRecords = [["0", "SECTION"], ["2", "TABLES"],
    ["0", "TABLE"], ["2", "LAYER"], ["70", String(layers.size || 1)]];
  if (layers.size === 0) {
    tableRecords.push(["0", "LAYER"], ["2", "0"], ["70", "0"], ["62", "7"], ["6", "CONTINUOUS"]);
  } else {
    for (const { name, color } of layers.values()) {
      tableRecords.push(["0", "LAYER"], ["2", name], ["70", "0"], ["62", String(color)], ["6", "CONTINUOUS"]);
    }
  }
  tableRecords.push(["0", "ENDTAB"], ["0", "ENDSEC"]);
  parts.push(emit(tableRecords));

  const blockSec = [["0", "SECTION"], ["2", "BLOCKS"]];
  for (const [name, ents] of blocks.entries()) {
    blockSec.push(
      ["0", "BLOCK"], ["8", "0"], ["2", name], ["70", "0"],
      ["10", "0.0"], ["20", "0.0"], ["30", "0.0"],
      ["3", name], ["1", ""],
    );
    for (const ent of ents) for (const p of ent) blockSec.push(p);
    blockSec.push(["0", "ENDBLK"], ["8", "0"]);
  }
  blockSec.push(["0", "ENDSEC"]);
  parts.push(emit(blockSec));

  const entSec = [["0", "SECTION"], ["2", "ENTITIES"]];
  for (const ent of entities) for (const p of ent) entSec.push(p);
  entSec.push(["0", "ENDSEC"]);
  parts.push(emit(entSec));

  parts.push(emit([["0", "EOF"]]));
  return parts.join("\n") + "\n";
}
