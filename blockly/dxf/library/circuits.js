/* VENDORED from repos/designer/src/export/dxf/ (canonical copy lives there).
 * Build-free ESM: relative imports carry .js; manifest is manifest.js. Do not hand-diverge;
 * re-vendor when the Designer engine changes. See blockly/README.md (Diagram / DXF). */
/**
 * Bibliothèque de blocs « circuit » NF C 15-100.
 *
 * Chaque bloc est un mini-schéma unifilaire prêt à insérer, représentant un
 * circuit terminal normalisé :
 *
 *     ●   ← point d'insertion (connexion au jeu de barres / DDR)
 *     │
 *     ▢   ← disjoncteur divisionnaire (MCB)
 *     │
 *   2,5mm²← section du conducteur
 *     │
 *   ┌───┐ ← cartouche circuit : intensité + désignation
 *   │16A│
 *   │PRI│
 *   └───┘
 *     │
 *     ⊗   ← symbole du terminal (prise, point lumineux, plaque…)
 *
 * Dimensions : 20 mm × 46 mm. Origine (0, 0) = point d'insertion en haut.
 * Tous les blocs s'alignent ainsi sur un jeu de barres horizontal :
 *   dxf.insert("CIRCUIT_SOCKET_16A", x, busY, { layer: "SYMBOLS" });
 *
 * Nomenclature normalisée NF C 15-100 §771 (tableau 771E) :
 *
 *   Éclairage                10 A · 1,5 mm² · max 8 points
 *   Prises commandées        10 A · 1,5 mm²
 *   Prises 16 A              16 A · 2,5 mm² · max 8 (ou 12 en cuisine)
 *   Prises 20 A              20 A · 2,5 mm² · max 12
 *   Plaque / cuisson         32 A · 6 mm²   · dédié mono (ou 20 A / 2,5 tri)
 *   Four                     20 A · 2,5 mm² · dédié
 *   Lave-linge               20 A · 2,5 mm² · dédié (DDR type A)
 *   Lave-vaisselle           20 A · 2,5 mm² · dédié (DDR type A)
 *   Sèche-linge              20 A · 2,5 mm² · dédié
 *   Congélateur              16 A · 2,5 mm² · dédié (DDR dédié conseillé)
 *   Chauffe-eau              20 A · 2,5 mm² · dédié
 *   Chauffage ≤ 2250 W       16 A · 1,5 mm²
 *   Chauffage ≤ 3500 W       20 A · 2,5 mm²
 *   Chauffage ≤ 4500 W       25 A · 4 mm²
 *   Chauffage ≤ 5750 W       32 A · 6 mm²
 *   VMC                       2 A · 1,5 mm² · dédié
 *   Volets roulants          16 A · 1,5 mm²
 *   IRVE (recharge VE)       32 A · 6 mm²   · DDR type B ou F
 *   Sonnerie / transfo TBT    2 A · 1,5 mm²
 *   Communication (ETEL)     attente RJ45
 */

import manifest from "./manifest.js";

const L = "SYMBOLS";

/**
 * Catalogue of circuit blocks, derived from `manifest.json`. Each entry:
 *   { name, rating (A), section (mm²), label (fr), terminal, group }
 * Normative metadata (NF C 15-100 clause, T-box class, rcdType hint) is
 * held in the manifest and exposed via `CIRCUIT_MANIFEST`.
 */
export const CIRCUIT_MANIFEST = manifest.blocks.filter((b) => b.kind === "circuit");

export const CIRCUIT_CATALOGUE = CIRCUIT_MANIFEST.map((b) => ({
  name: b.name,
  rating: b.abox?.rating,
  section: b.abox?.section,
  label: b.label?.fr || b.name,
  terminal: b.abox?.terminal,
  group: b.category,
}));

/**
 * Inscrit tous les blocs circuit dans le document DXF. Requiert que
 * `registerNfc15100Symbols(dxf)` ait été appelé au préalable (pour les
 * symboles terminaux).
 */
export function registerCircuitBlocks(dxf) {
  dxf.ensureLayer(L, 7);

  // Petits blocs terminaux spécifiques (absents du catalogue principal).
  dxf.addBlock("BOX_HEATING", (d) => {
    d.rect(-3, -3, 6, 6);
    d.text(-2, -1, 2, "CV");
  });
  dxf.addBlock("BOX_IRVE", (d) => {
    d.rect(-4, -3, 8, 6);
    d.text(-3, -1, 2, "IRVE");
  });

  for (const c of CIRCUIT_CATALOGUE) {
    dxf.addBlock(c.name, (d) => drawCircuitBlock(d, c));
  }
}

/**
 * Dessin normalisé d'un bloc circuit autour de l'origine.
 * Hauteur totale : 46 mm · largeur : 20 mm.
 * Origine (0, 0) = point d'insertion en haut (connexion au DDR / jeu de barres).
 */
function drawCircuitBlock(d, c) {
  const W = 20;
  const topY = 0;
  const mcbY = -6;          // centre du disjoncteur
  const sectionY = -13;     // étiquette section
  const boxTop = -16;
  const boxH = 18;
  const boxBottom = boxTop - boxH;
  const terminalY = boxBottom - 6;

  // Conducteur vertical : point d'insertion → disjoncteur
  d.line(0, topY, 0, mcbY + 5);

  // Disjoncteur divisionnaire (même géométrie que MCB)
  d.rect(-3, mcbY - 5, 6, 10);
  d.line(-2, mcbY + 2, 2, mcbY - 2);
  d.arc(0, mcbY - 1.5, 1.2, 0, 180);

  // Courant nominal, à côté du disjoncteur
  d.text(4, mcbY - 1.5, 2.5, `${formatRating(c.rating)} A`);

  // Section du câble
  d.line(0, mcbY - 5, 0, sectionY + 2);
  d.text(2, sectionY, 2, `${formatSection(c.section)} mm²`);

  // Cartouche circuit (désignation)
  d.line(0, sectionY - 1, 0, boxTop);
  d.rect(-W / 2, boxBottom, W, boxH);
  // Désignation sur 1-2 lignes
  wrapAndDraw(d, c.label, -W / 2 + 1, boxTop - 4, W - 2, 2.2, 2);

  // Ligne vers le terminal
  d.line(0, boxBottom, 0, terminalY + 3);

  // Terminal symbolique
  d.insert(c.terminal, 0, terminalY, { layer: L });
}

function formatRating(n) {
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}
function formatSection(n) {
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}

function wrapAndDraw(d, text, x, yTop, maxWidth, height, maxLines) {
  const charW = height * 0.65;
  const maxChars = Math.max(1, Math.floor(maxWidth / charW));
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const trial = line ? line + " " + w : w;
    if (trial.length > maxChars) {
      if (line) lines.push(line);
      line = w.length > maxChars ? w.slice(0, maxChars - 1) + "…" : w;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((l, i) => d.text(x, yTop - i * (height + 1), height, l));
}
