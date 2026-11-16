/* VENDORED from repos/designer/src/export/dxf/ (canonical copy lives there).
 * Build-free ESM: relative imports carry .js; manifest is manifest.js. Do not hand-diverge;
 * re-vendor when the Designer engine changes. See blockly/README.md (Diagram / DXF). */
/**
 * Build a single DXF "library" file that contains:
 *   - every paper frame (A4, A3, A2, A1) as an importable BLOCK
 *   - a palette sheet of every NF C 15-100 symbol with its block name
 *   - a palette sheet of every circuit block with its block name
 *   - (optional) a palette sheet of raster pictures declared in manifest.json
 *
 * Use case: open the file in LibreCAD / QCAD / AutoCAD, then copy-paste
 * blocks into project drawings. All blocks are defined in the BLOCKS section
 * so they are available for INSERT by name even after copy.
 *
 * Source of truth for the catalogue is `manifest.json`; draw implementations
 * live in `frames.js`, `symbolsNfc15100.js`, `circuits.js`.
 */

import { createDxf } from "../dxfWriter.js";
import { PAPER_SIZES, registerFrameBlocks, drawDlab5Frame } from "./frames.js";
import { registerNfc15100Symbols, NFC15100_SYMBOLS } from "./symbolsNfc15100.js";
import { registerCircuitBlocks, CIRCUIT_CATALOGUE } from "./circuits.js";
import manifest from "./manifest.js";

const SHEET_GAP = 50;
const PICTURES = manifest.blocks.filter((b) => b.kind === "picture");

export function buildDxfLibrary({ author = "DLAB5", date } = {}) {
  const dxf = createDxf();
  registerFrameBlocks(dxf);
  registerNfc15100Symbols(dxf);
  registerCircuitBlocks(dxf);
  registerPictureBlocks(dxf);

  const today = date || new Date().toISOString().slice(0, 10);
  let cursorY = 0;

  // One frame per ISO size: insert the BLOCK and overlay cartouche fields.
  for (const size of ["A4", "A3", "A2", "A1"]) {
    const paper = PAPER_SIZES[size];
    drawDlab5Frame(dxf, {
      size,
      origin: { x: 0, y: cursorY },
      cartouche: {
        title: `Gabarit ${size} — DLAB5`,
        project: "Bibliothèque NF C 15-100",
        smartHomeId: "—",
        scale: "1:1",
        author,
        checkedBy: "—",
        revision: "A",
        page: "1/1",
        date: today,
      },
    });
    cursorY += paper.h + SHEET_GAP;
  }

  // Symbol palette
  drawSymbolPalette(dxf, { x: 0, y: cursorY });
  cursorY += 30 + Math.ceil(NFC15100_SYMBOLS.length / 6) * 30 + SHEET_GAP;

  // Circuit palette
  drawCircuitPalette(dxf, { x: 0, y: cursorY });
  cursorY += 30 + Math.ceil(CIRCUIT_CATALOGUE.length / 5) * 60 + SHEET_GAP;

  // Picture palette (if any declared in manifest)
  if (PICTURES.length > 0) {
    drawPicturePalette(dxf, { x: 0, y: cursorY });
  }

  return dxf.toString();
}

/**
 * Register raster pictures from the manifest as BLOCKs. Each block renders
 * a placeholder (bounding rect + filename label) — a future AC1015 bump
 * will replace this with a real IMAGE entity (see README § Follow-ups).
 */
function registerPictureBlocks(dxf) {
  for (const p of PICTURES) {
    const { file, widthMm = 80, heightMm = 60 } = p.source || {};
    dxf.addBlock(p.name, (d) => {
      d.imagePlaceholder(file || p.name, -widthMm / 2, -heightMm / 2, widthMm, heightMm);
    });
  }
}

function drawSymbolPalette(dxf, { x, y }) {
  const cols = 6;
  const cellW = 40;
  const cellH = 30;
  const PAL = "SYMBOL_PALETTE";
  dxf.ensureLayer(PAL, 7);

  const paletteW = cols * cellW;
  const rows = Math.ceil(NFC15100_SYMBOLS.length / cols);
  const paletteH = rows * cellH + 30;

  dxf.rect(x, y, paletteW, paletteH, { layer: PAL });
  dxf.text(x + 5, y + paletteH - 10, 5, "Bibliothèque de symboles NF C 15-100 — DLAB5", { layer: PAL });
  dxf.text(x + 5, y + paletteH - 20, 2.5, "Importer comme blocs · insérer par nom", { layer: PAL });

  NFC15100_SYMBOLS.forEach((name, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = x + col * cellW + cellW / 2;
    const cy = y + (rows - 1 - row) * cellH + cellH / 2;

    dxf.rect(x + col * cellW, y + (rows - 1 - row) * cellH, cellW, cellH, { layer: PAL });
    dxf.insert(name, cx, cy + 2, { layer: "SYMBOLS" });
    dxf.text(x + col * cellW + 2, y + (rows - 1 - row) * cellH + 2, 2, name, { layer: PAL });
  });
}

function drawCircuitPalette(dxf, { x, y }) {
  const cols = 5;
  const cellW = 50;
  const cellH = 60;
  const PAL = "CIRCUIT_PALETTE";
  dxf.ensureLayer(PAL, 7);

  const rows = Math.ceil(CIRCUIT_CATALOGUE.length / cols);
  const paletteW = cols * cellW;
  const paletteH = rows * cellH + 30;

  dxf.rect(x, y, paletteW, paletteH, { layer: PAL });
  dxf.text(x + 5, y + paletteH - 10, 5, "Bibliothèque de circuits NF C 15-100 — DLAB5", { layer: PAL });
  dxf.text(x + 5, y + paletteH - 20, 2.5, "Bloc prêt à insérer : disjoncteur + section + désignation + terminal", { layer: PAL });

  CIRCUIT_CATALOGUE.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = x + col * cellW;
    const cellY = y + (rows - 1 - row) * cellH;

    dxf.rect(cellX, cellY, cellW, cellH, { layer: PAL });
    dxf.insert(c.name, cellX + cellW / 2, cellY + cellH - 4, { layer: "SYMBOLS" });
    dxf.text(cellX + 1, cellY + 1, 1.8, c.name, { layer: PAL });
  });
}

function drawPicturePalette(dxf, { x, y }) {
  const cols = 3;
  const cellW = 120;
  const cellH = 90;
  const PAL = "PICTURE_PALETTE";
  dxf.ensureLayer(PAL, 7);

  const rows = Math.ceil(PICTURES.length / cols);
  const paletteW = cols * cellW;
  const paletteH = rows * cellH + 30;

  dxf.rect(x, y, paletteW, paletteH, { layer: PAL });
  dxf.text(x + 5, y + paletteH - 10, 5, "Photothèque — DLAB5", { layer: PAL });
  dxf.text(x + 5, y + paletteH - 20, 2.5, "Images raster insérées comme blocs (placeholder · IMAGE à venir)", { layer: PAL });

  PICTURES.forEach((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = x + col * cellW;
    const cellY = y + (rows - 1 - row) * cellH;
    dxf.rect(cellX, cellY, cellW, cellH, { layer: PAL });
    dxf.insert(p.name, cellX + cellW / 2, cellY + cellH / 2, { layer: "SYMBOLS" });
    dxf.text(cellX + 2, cellY + 2, 1.8, p.name, { layer: PAL });
  });
}
