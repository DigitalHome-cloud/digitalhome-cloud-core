/* VENDORED from repos/designer/src/export/dxf/ (canonical copy lives there).
 * Build-free ESM: relative imports carry .js; manifest is manifest.js. Do not hand-diverge;
 * re-vendor when the Designer engine changes. See blockly/README.md (Diagram / DXF). */
/**
 * Schéma unifilaire renderer (NF C 15-100).
 *
 * Layout (mm, model space):
 *   - AGCP at top centre
 *   - Horizontal distribution bus below AGCP
 *   - RCDs (interrupteurs différentiels) hang from the bus
 *   - Breakers + circuit labels drop from each RCD
 *
 * Layers:
 *   SYMBOLS      — IEC 60617 symbol blocks
 *   WIRES        — distribution bus + vertical feeders
 *   LABELS       — circuit ID, wire section, breaker rating, equipment
 *   TITLE_BLOCK  — cartouche
 */

import { createDxf } from "./dxfWriter.js";
import { createSvg } from "./svgWriter.js";
import { registerNfc15100Symbols } from "./library/symbolsNfc15100.js";
import { drawDlab5Frame, PAPER_SIZES, registerFrameBlocks } from "./library/frames.js";

const LAYERS = {
  SYMBOLS: { name: "SYMBOLS", color: 7 },
  WIRES: { name: "WIRES", color: 5 },
  LABELS: { name: "LABELS", color: 3 },
};

const SPACING = {
  circuitDx: 30,
  rcdGap: 20,
  busY: 200,
  circuitYTop: 170,
  breakerY: 140,
  labelTopY: 115,
  equipmentY: 80,
};

export function renderUnifilaire(input) {
  return renderUnifilaireWith(input, createDxf);
}

export function renderUnifilaireSvg(input) {
  return renderUnifilaireWith(input, createSvg);
}

function renderUnifilaireWith(input, createWriter) {
  const i18n = input.i18n || {};   // { schemaTitle, typeWord, cartouche:{…} } — defaults FR
  const dxf = createWriter();
  for (const { name, color } of Object.values(LAYERS)) dxf.ensureLayer(name, color);
  registerFrameBlocks(dxf, i18n.cartouche || {});
  registerNfc15100Symbols(dxf);

  const board = input.boards[0];
  const totalCircuits = board.circuits.length || 1;
  const width = totalCircuits * SPACING.circuitDx + 60;

  // Pick smallest ISO frame that fits the schema width (+ margins).
  const paperSize = pickPaper(width + 40, 240);
  const paper = PAPER_SIZES[paperSize];
  const frameOriginX = -20;
  const frameOriginY = -20;
  drawDlab5Frame(dxf, {
    size: paperSize,
    origin: { x: frameOriginX, y: frameOriginY },
    cartouche: {
      title: `${i18n.schemaTitle || "Schéma unifilaire"} — ${board.label}`,
      project: input.smartHomeId,
      smartHomeId: input.smartHomeId,
      scale: "1:1",
      author: "DigitalHome.Cloud Designer",
      revision: "A",
    },
  });

  // AGCP
  const agcpX = width / 2;
  dxf.insert("AGCP", agcpX, SPACING.busY + 40, { layer: LAYERS.SYMBOLS.name });
  dxf.text(agcpX + 6, SPACING.busY + 42, 3, `${input.delivery.agcp.rating} A`, { layer: LAYERS.LABELS.name });
  dxf.line(agcpX, SPACING.busY + 30, agcpX, SPACING.busY, { layer: LAYERS.WIRES.name });

  // Distribution bus
  dxf.line(20, SPACING.busY, width - 20, SPACING.busY, { layer: LAYERS.WIRES.name });

  // Build circuit lookup
  const circuitById = new Map(board.circuits.map((c) => [c.id, c]));
  let cursorX = 30;

  for (const rcd of board.rcds) {
    const feedCircuits = rcd.feeds.map((id) => circuitById.get(id)).filter(Boolean);
    if (feedCircuits.length === 0) continue;

    const groupStartX = cursorX;
    const groupEndX = cursorX + (feedCircuits.length - 1) * SPACING.circuitDx;
    const groupCenterX = (groupStartX + groupEndX) / 2;

    // Drop from bus to RCD
    dxf.line(groupCenterX, SPACING.busY, groupCenterX, SPACING.busY - 15, { layer: LAYERS.WIRES.name });
    dxf.insert(pickDdrBlock(rcd), groupCenterX, SPACING.busY - 25, { layer: LAYERS.SYMBOLS.name });
    dxf.text(groupCenterX + 6, SPACING.busY - 23, 2.5, `${rcd.label} (${i18n.typeWord || "type"} ${rcd.type})`, { layer: LAYERS.LABELS.name });

    // RCD sub-bus
    const subBusY = SPACING.busY - 40;
    dxf.line(groupCenterX, SPACING.busY - 33, groupCenterX, subBusY, { layer: LAYERS.WIRES.name });
    dxf.line(groupStartX, subBusY, groupEndX, subBusY, { layer: LAYERS.WIRES.name });

    for (const c of feedCircuits) {
      const x = cursorX;
      // Drop to breaker
      dxf.line(x, subBusY, x, SPACING.breakerY + 7, { layer: LAYERS.WIRES.name });
      dxf.insert("MCB", x, SPACING.breakerY, { layer: LAYERS.SYMBOLS.name });
      dxf.text(x + 4, SPACING.breakerY + 1, 2.5, `${c.breaker.rating} A ${c.breaker.curve}`, { layer: LAYERS.LABELS.name });

      // Wire to circuit
      dxf.line(x, SPACING.breakerY - 7, x, SPACING.labelTopY, { layer: LAYERS.WIRES.name });
      dxf.text(x + 1, (SPACING.breakerY + SPACING.labelTopY) / 2, 2, `${formatSection(c.wire.section)} mm²`, { layer: LAYERS.LABELS.name });

      // Circuit box
      dxf.rect(x - 8, SPACING.equipmentY, 16, 30, { layer: LAYERS.LABELS.name });
      dxf.text(x - 7, SPACING.labelTopY - 5, 2.5, c.id, { layer: LAYERS.LABELS.name });
      wrapText(dxf, c.label, x - 7, SPACING.labelTopY - 10, 14, 2, LAYERS.LABELS.name);
      // Consumer/terminal symbol: c.symbol (picked by the adapter from the sink /
      // circuit type) if present, else the generic terminal. [Local enhancement over
      // the Designer's canonical copy — candidate to upstream.]
      dxf.insert(c.symbol || "CIRCUIT_END", x, SPACING.equipmentY + 8, { layer: LAYERS.SYMBOLS.name });

      cursorX += SPACING.circuitDx;
    }

    cursorX += SPACING.rcdGap;
  }

  return dxf.toString();
}

function pickDdrBlock(rcd) {
  const ma = rcd.sensitivity === 300 ? 300 : 30;
  const t = ["AC", "A", "F", "B"].includes(rcd.type) ? rcd.type : "A";
  const name = `DDR_${ma}_${t}`;
  if (ma === 300 && !["AC", "A"].includes(t)) return "DDR_300_A";
  return name;
}

function pickPaper(neededW, neededH) {
  for (const size of ["A4", "A3", "A2", "A1"]) {
    const p = PAPER_SIZES[size];
    if (p.w >= neededW && p.h >= neededH) return size;
  }
  return "A1";
}

function formatSection(n) {
  return Number.isInteger(n) ? `${n}` : String(n).replace(".", ",");
}

function wrapText(dxf, text, x, y, maxChars, h, layer) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > maxChars) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = (line ? line + " " : "") + w;
    }
  }
  if (line) lines.push(line);
  lines.slice(0, 4).forEach((l, i) => dxf.text(x, y - i * (h + 1), h, l, { layer }));
}
