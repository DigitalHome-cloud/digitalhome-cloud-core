/* VENDORED from repos/designer/src/export/dxf/ (canonical copy lives there).
 * Build-free ESM: relative imports carry .js; manifest is manifest.js. Do not hand-diverge;
 * re-vendor when the Designer engine changes. See blockly/README.md (Diagram / DXF). */
/**
 * ISO 216 paper frames with NF C 15-100-style DLAB5 cartouche.
 *
 * Frames are registered as importable DXF BLOCKs so they can be modified
 * in LibreCAD and re-exported:
 *
 *   registerFrameBlocks(dxf)
 *   → defines FRAME_A4, FRAME_A3, FRAME_A2, FRAME_A1 as BLOCKs
 *     (border + margins + centering marks + empty cartouche grid + DLAB5 logo)
 *
 *   drawDlab5Frame(dxf, { size, origin, cartouche })
 *   → INSERTs the block at `origin`, then overlays only the variable cartouche
 *     TEXT entities (title, project, date, revision …) on CARTOUCHE_LAYER
 *
 * Sizes (landscape, mm):
 *   A4: 297 × 210
 *   A3: 420 × 297
 *   A2: 594 × 420
 *   A1: 841 × 594
 */

export const PAPER_SIZES = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
  A2: { w: 594, h: 420 },
  A1: { w: 841, h: 594 },
};

const FRAME_LAYER = "FRAME";
const CARTOUCHE_LAYER = "TITLE_BLOCK";

const CARTOUCHE_SIZE = {
  A4: { W: 120, H: 36, isSmall: true },
  A3: { W: 180, H: 50, isSmall: false },
  A2: { W: 180, H: 50, isSmall: false },
  A1: { W: 180, H: 50, isSmall: false },
};

/**
 * Register FRAME_A4 / FRAME_A3 / FRAME_A2 / FRAME_A1 as BLOCKs.
 * Each block contains the static parts of the frame: border, inner margin,
 * centering marks, paper-size label, DLAB5 cartouche grid + logo.
 * Variable cartouche fields (title, project, date …) are drawn as overlaid
 * TEXT entities by `drawDlab5Frame`.
 */
export function registerFrameBlocks(dxf, labels = {}) {
  dxf.ensureLayer(FRAME_LAYER, 7);
  dxf.ensureLayer(CARTOUCHE_LAYER, 7);

  for (const size of Object.keys(PAPER_SIZES)) {
    dxf.addBlock(`FRAME_${size}`, (d) => drawFrameBlockBody(d, size, labels));
  }
}

function drawFrameBlockBody(d, size, labels = {}) {
  const { w, h } = PAPER_SIZES[size];

  // Outer trim + inner margin (20 mm binding, 10 mm others — ISO 7200)
  d.rect(0, 0, w, h);
  const ml = 20, mr = 10, mt = 10, mb = 10;
  d.rect(ml, mb, w - ml - mr, h - mt - mb);

  // Centering marks at midpoints
  const mark = 5;
  d.line(w / 2, 0, w / 2, mark);
  d.line(w / 2, h, w / 2, h - mark);
  d.line(0, h / 2, mark, h / 2);
  d.line(w, h / 2, w - mark, h / 2);

  // Paper size label
  d.text(ml + 2, h - mt - 5, 3, `${labels.format || "Format"} ${size}`);

  // Static cartouche grid + DLAB5 logo (bottom-right)
  drawDlab5CartoucheGrid(d, { x: w - mr, y: mb, size, labels });
}

/**
 * Insert a frame block at `origin` and overlay the variable cartouche fields.
 * Call `registerFrameBlocks(dxf)` once before using.
 */
export function drawDlab5Frame(dxf, { size = "A3", origin = { x: 0, y: 0 }, cartouche = {} } = {}) {
  const paper = PAPER_SIZES[size];
  if (!paper) throw new Error(`Unknown paper size: ${size}`);

  dxf.ensureLayer(FRAME_LAYER, 7);
  dxf.ensureLayer(CARTOUCHE_LAYER, 7);
  // `addBlock` is idempotent (early-return on duplicate), so calling this
  // from `drawDlab5Frame` is safe even when the library already registered.
  registerFrameBlocks(dxf);

  const { x, y } = origin;
  dxf.insert(`FRAME_${size}`, x, y, { layer: FRAME_LAYER });

  // Overlay the variable cartouche fields.
  const { w: pw } = paper;
  const mr = 10, mb = 10;
  drawDlab5CartoucheValues(dxf, { x: x + pw - mr, y: y + mb, size, fields: cartouche });
}

/**
 * Generic-frame alias kept for backward compatibility. Maps to DLAB5.
 */
export function drawFrame(dxf, opts = {}) {
  drawDlab5Frame(dxf, opts);
}

/**
 * Draw the fixed geometry of the DLAB5 6-cell cartouche: grid lines + DLAB5
 * logo + "Digital Lab 5" / "Conforme NF C 15-100" static text + cell labels.
 * Anchor: bottom-right of the inner margin at (x, y); cartouche extends
 * leftward by W and upward by H.
 *
 * Grid layout:
 *   +----------------------+----------------------+
 *   | DLAB5 (logo/cell)    | Titre du document    |
 *   +----------+-----------+----------+-----------+
 *   | Projet   | SmartHome | Date     | Échelle   |
 *   +----------+-----------+----------+-----------+
 *   | Auteur   | Vérifié   | Indice   | Page      |
 *   +----------+-----------+----------+-----------+
 */
function drawDlab5CartoucheGrid(d, { x, y, size, labels = {} }) {
  const L = {
    projet: "Projet", smartHome: "SmartHome", date: "Date", echelle: "Échelle",
    auteur: "Auteur", verifie: "Vérifié", indice: "Indice", page: "Page", ...labels,
  };
  const { W, H, isSmall } = CARTOUCHE_SIZE[size];
  const x0 = x - W;
  const y0 = y;
  const rowH = H / 3;
  const colW = W / 4;
  const logoW = W / 2;

  d.rect(x0, y0, W, H);
  d.line(x0, y0 + rowH, x0 + W, y0 + rowH);
  d.line(x0, y0 + 2 * rowH, x0 + W, y0 + 2 * rowH);
  d.line(x0 + logoW, y0 + 2 * rowH, x0 + logoW, y0 + H);
  for (let i = 1; i < 4; i++) {
    d.line(x0 + i * colW, y0, x0 + i * colW, y0 + 2 * rowH);
  }

  // DLAB5 logo (top-left cell) + static captions
  const logoSize = isSmall ? 5 : 7;
  const pad = 2;
  d.text(x0 + pad, y0 + 2 * rowH + (rowH - logoSize) / 2, logoSize, "DLAB5");
  d.text(x0 + pad, y0 + 2 * rowH + pad, 1.8, "Digital Lab 5 — DigitalHome.Cloud");
  d.text(x0 + logoW + pad, y0 + 2 * rowH + pad, 1.8, "Conforme NF C 15-100");

  // Cell labels (middle + bottom rows)
  const cellLabels = [
    { row: "mid", col: 0, text: L.projet },
    { row: "mid", col: 1, text: L.smartHome },
    { row: "mid", col: 2, text: L.date },
    { row: "mid", col: 3, text: L.echelle },
    { row: "bot", col: 0, text: L.auteur },
    { row: "bot", col: 1, text: L.verifie },
    { row: "bot", col: 2, text: L.indice },
    { row: "bot", col: 3, text: L.page },
  ];
  for (const { row, col, text } of cellLabels) {
    const cx = x0 + col * colW + pad;
    const cy = (row === "mid" ? y0 + rowH : y0) + rowH - 1.8 - pad;
    d.text(cx, cy, 1.8, text);
  }
}

/**
 * Overlay variable text into the cartouche cells. Coordinates mirror
 * `drawDlab5CartoucheGrid`.
 */
function drawDlab5CartoucheValues(dxf, { x, y, size, fields }) {
  const { W, H, isSmall } = CARTOUCHE_SIZE[size];
  const x0 = x - W;
  const y0 = y;
  const rowH = H / 3;
  const colW = W / 4;
  const logoW = W / 2;
  const pad = 2;
  const valueH = isSmall ? 2.2 : 2.8;
  const titleH = isSmall ? 3 : 4;

  const t = cartoucheText(fields);

  // Top-right cell: title
  fitText(dxf, x0 + logoW + pad, y0 + 2 * rowH + rowH - titleH - pad, logoW - 2 * pad, titleH, t.title);

  // Middle row
  fitText(dxf, x0 + 0 * colW + pad, y0 + rowH + pad, colW - 2 * pad, valueH, t.project);
  fitText(dxf, x0 + 1 * colW + pad, y0 + rowH + pad, colW - 2 * pad, valueH, t.smartHomeId);
  fitText(dxf, x0 + 2 * colW + pad, y0 + rowH + pad, colW - 2 * pad, valueH, t.date);
  fitText(dxf, x0 + 3 * colW + pad, y0 + rowH + pad, colW - 2 * pad, valueH, t.scale);

  // Bottom row
  fitText(dxf, x0 + 0 * colW + pad, y0 + pad, colW - 2 * pad, valueH, t.author);
  fitText(dxf, x0 + 1 * colW + pad, y0 + pad, colW - 2 * pad, valueH, t.checkedBy);
  fitText(dxf, x0 + 2 * colW + pad, y0 + pad, colW - 2 * pad, valueH, t.revision);
  fitText(dxf, x0 + 3 * colW + pad, y0 + pad, colW - 2 * pad, valueH, t.page);
}

function fitText(dxf, x, y, maxWidth, height, text) {
  if (!text) return;
  const s = String(text);
  const charW = height * 0.7;
  const maxChars = Math.max(1, Math.floor(maxWidth / charW));
  let out = s;
  if (s.length > maxChars) {
    out = maxChars > 1 ? s.slice(0, maxChars - 1) + "…" : s.slice(0, 1);
  }
  dxf.text(x, y, height, out, { layer: CARTOUCHE_LAYER });
}

function cartoucheText(fields = {}) {
  return {
    title: fields.title || "Schéma unifilaire",
    project: fields.project || fields.smartHomeId || "—",
    smartHomeId: fields.smartHomeId || "—",
    date: fields.date || new Date().toISOString().slice(0, 10),
    scale: fields.scale || "1:1",
    author: fields.author || "DigitalHome.Cloud",
    checkedBy: fields.checkedBy || "—",
    revision: fields.revision || "A",
    page: fields.page || "1/1",
  };
}
