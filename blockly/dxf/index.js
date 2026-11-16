/* VENDORED from repos/designer/src/export/dxf/ (canonical copy lives there).
 * Build-free ESM: relative imports carry .js; manifest is manifest.js. Do not hand-diverge;
 * re-vendor when the Designer engine changes. See blockly/README.md (Diagram / DXF). */
/**
 * Public API for the NF C 15-100 DXF export module.
 *
 * v1 ships `exportUnifilaire`. Panel layout and architectural diagrams
 * follow the same signature: (input) => string (DXF text).
 */

import { aboxToUnifilaireInput } from "./fromAbox.js";
import { renderUnifilaire, renderUnifilaireSvg } from "./unifilaire.js";
import { buildDxfLibrary } from "./library/buildLibrary.js";

export { aboxToUnifilaireInput, renderUnifilaire, renderUnifilaireSvg, buildDxfLibrary };
export * from "./library/index.js";

export function exportUnifilaire(input) {
  return renderUnifilaire(input);
}

export function exportUnifilaireFromAbox(aboxJson, smartHomeId) {
  return renderUnifilaire(aboxToUnifilaireInput(aboxJson, smartHomeId));
}

export function exportUnifilaireSvg(input) {
  return renderUnifilaireSvg(input);
}

export function exportUnifilaireFromAboxSvg(aboxJson, smartHomeId) {
  return renderUnifilaireSvg(aboxToUnifilaireInput(aboxJson, smartHomeId));
}

export function exportLibrary(opts) {
  return buildDxfLibrary(opts);
}

export function downloadDxf(dxfText, filename) {
  if (typeof window === "undefined") return;
  const blob = new Blob([dxfText], { type: "application/dxf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
