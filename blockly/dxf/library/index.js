/* VENDORED from repos/designer/src/export/dxf/ (canonical copy lives there).
 * Build-free ESM: relative imports carry .js; manifest is manifest.js. Do not hand-diverge;
 * re-vendor when the Designer engine changes. See blockly/README.md (Diagram / DXF). */
export { PAPER_SIZES, drawFrame, drawDlab5Frame, registerFrameBlocks } from "./frames.js";
export {
  registerNfc15100Symbols,
  NFC15100_SYMBOLS,
} from "./symbolsNfc15100.js";
export {
  registerCircuitBlocks,
  CIRCUIT_CATALOGUE,
  CIRCUIT_MANIFEST,
} from "./circuits.js";
export { buildDxfLibrary } from "./buildLibrary.js";
export { default as MANIFEST } from "./manifest.js";
