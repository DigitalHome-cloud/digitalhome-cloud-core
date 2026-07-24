/* VENDORED from repos/designer/src/export/dxf/ (canonical copy lives there).
 * Build-free ESM: relative imports carry .js; manifest is manifest.js. Do not hand-diverge;
 * re-vendor when the Designer engine changes. See blockly/README.md (Diagram / DXF). */
/**
 * NF C 15-100 / IEC 60617 symbol catalogue — registered as importable DXF BLOCKs.
 *
 * Unit: millimetre. All blocks are drawn around origin (0,0) so they insert cleanly.
 * Layer: SYMBOLS (entities inside blocks reference layer "0" by DXF convention so
 * the INSERT's layer takes effect).
 *
 * Coverage:
 *   Protection:   AGCP, DDR (30/300 mA × type AC/A/F/B), MCB, SPD, contactor,
 *                 télérupteur, transformateur TBT
 *   Terminaux:    prise 2P+T 16/20/32 A, prise spécialisée, RJ45, TV/SAT,
 *                 boîte de dérivation, bornier de terre
 *   Éclairage:    point lumineux (plafond / applique / encastré), projecteur,
 *                 bloc de secours (BAES)
 *   Commandes:    interrupteur simple, va-et-vient, double, variateur,
 *                 bouton-poussoir, détecteur de mouvement
 *   Équipements:  chauffe-eau, VMC, volet roulant, four, plaque, lave-linge,
 *                 lave-vaisselle, moteur, sonnerie
 *   Comptage:     compteur, tableau de communication
 *   Terre:        piquet de terre, liaison équipotentielle
 *   Divers:       circuit-end marker
 *
 * Call `registerNfc15100Symbols(dxf)` once per DXF document before using
 * `dxf.insert(blockName, x, y, { layer: "SYMBOLS" })`.
 */

import manifest from "./manifest.js";

/**
 * List of symbol block names derived from the manifest. Source of truth for
 * normative metadata (IEC 60617 code, NF C 15-100 clause, T-box class) is
 * `manifest.json`; the draw code lives in this file.
 */
export const NFC15100_SYMBOLS = manifest.blocks
  .filter((b) => b.kind === "symbol" && b.source?.module === "./symbolsNfc15100.js")
  .map((b) => b.name);

export function registerNfc15100Symbols(dxf) {
  dxf.ensureLayer("SYMBOLS", 7);

  // === PROTECTION ===

  dxf.addBlock("AGCP", (d) => {
    d.rect(-5, -7, 10, 14);
    d.line(-3, 3, 3, -3);
    d.line(0, 7, 0, 11);
    d.line(0, -7, 0, -11);
    d.text(-4, -1, 2, "AGCP");
    d.text(-4, -5, 1.5, "500mA-S");
  });

  // Differential RCD generator: sensitivity in mA, type AC/A/F/B
  const ddr = (mA, type) => (d) => {
    d.rect(-5, -6, 10, 12);
    d.line(-4, 3, 4, -3);
    d.line(-4, -3, 4, 3);
    d.line(0, 6, 0, 10);
    d.line(0, -6, 0, -10);
    d.text(-4, -5, 1.5, `${mA}mA`);
    d.text(2, -5, 1.8, type);
  };
  dxf.addBlock("DDR_30_AC", ddr(30, "AC"));
  dxf.addBlock("DDR_30_A", ddr(30, "A"));
  dxf.addBlock("DDR_30_F", ddr(30, "F"));
  dxf.addBlock("DDR_30_B", ddr(30, "B"));
  dxf.addBlock("DDR_300_AC", ddr(300, "AC"));
  dxf.addBlock("DDR_300_A", ddr(300, "A"));

  dxf.addBlock("MCB", (d) => {
    d.rect(-3, -5, 6, 10);
    d.line(-2, 2, 2, -2);
    d.arc(0, -1.5, 1.2, 0, 180);
    d.line(0, 5, 0, 8);
    d.line(0, -5, 0, -8);
  });

  dxf.addBlock("SPD", (d) => {
    d.rect(-3, -4, 6, 8);
    d.line(-2, 2, 2, 2);
    d.line(-2, 2, 0, -2);
    d.line(2, 2, 0, -2);
    d.line(0, 4, 0, 7);
    d.line(0, -4, 0, -7);
    d.text(-2, -3.5, 1.5, "SPD");
  });

  dxf.addBlock("CONTACTOR", (d) => {
    d.rect(-3, -5, 6, 10);
    d.line(-2, 2, 2, -2);
    d.arc(0, -2, 1, 0, 180);
    d.line(0, 5, 0, 8);
    d.line(0, -5, 0, -8);
    d.text(-1.5, 3.5, 1.5, "KM");
  });

  dxf.addBlock("TELERUPTEUR", (d) => {
    d.rect(-3, -4, 6, 8);
    d.line(-2, 1.5, 2, -1.5);
    d.circle(-2, -2, 0.4);
    d.line(0, 4, 0, 7);
    d.line(0, -4, 0, -7);
    d.text(-1.5, 2.5, 1.5, "TL");
  });

  dxf.addBlock("TRANSFO_TBT", (d) => {
    d.circle(-1.5, 0, 2.5);
    d.circle(1.5, 0, 2.5);
    d.line(0, 5, 0, 3);
    d.line(0, -5, 0, -3);
    d.text(-2, -7, 1.5, "TBT");
  });

  // === TERMINAUX ===

  const socket = (label) => (d) => {
    d.circle(0, 0, 3);
    d.line(-3, 0, 3, 0);
    d.line(0, 0, 0, -1.5);
    d.text(-1.5, 3.5, 1.8, label);
  };
  dxf.addBlock("SOCKET_16A", socket("16"));
  dxf.addBlock("SOCKET_20A", socket("20"));
  dxf.addBlock("SOCKET_32A", socket("32"));

  dxf.addBlock("SOCKET_SPECIAL", (d) => {
    d.circle(0, 0, 3);
    d.line(-3, 0, 3, 0);
    d.line(0, 0, 0, -1.5);
    d.line(-2, -2, 2, 2);
    d.text(-1.5, 3.5, 1.8, "SP");
  });

  dxf.addBlock("SOCKET_RJ45", (d) => {
    d.rect(-2.5, -2.5, 5, 5);
    d.line(-1.5, 0, 1.5, 0);
    d.line(-1.5, 1, 1.5, 1);
    d.text(-2, 3, 1.5, "RJ45");
  });

  dxf.addBlock("SOCKET_TV", (d) => {
    d.rect(-3, -3, 6, 6);
    d.circle(0, 0, 1);
    d.text(-1, 3.5, 1.5, "TV");
  });

  dxf.addBlock("JUNCTION_BOX", (d) => {
    d.rect(-2, -2, 4, 4);
    d.line(-2, -2, 2, 2);
    d.line(-2, 2, 2, -2);
  });

  dxf.addBlock("EARTH_BAR", (d) => {
    d.line(-6, 0, 6, 0);
    for (let i = -5; i <= 5; i += 2) d.line(i, 0, i, -2);
    d.text(-4, 1.5, 1.5, "PE");
  });

  // === ÉCLAIRAGE ===

  dxf.addBlock("LIGHT_CEILING", (d) => {
    d.circle(0, 0, 3);
    d.line(-2.1, -2.1, 2.1, 2.1);
    d.line(-2.1, 2.1, 2.1, -2.1);
  });

  dxf.addBlock("LIGHT_WALL", (d) => {
    d.arc(0, 0, 3, 0, 180);
    d.line(-3, 0, 3, 0);
    d.line(-2.1, 2.1, 2.1, 2.1);
  });

  dxf.addBlock("LIGHT_RECESSED", (d) => {
    d.circle(0, 0, 3);
    d.circle(0, 0, 2);
    d.line(-2.1, -2.1, 2.1, 2.1);
    d.line(-2.1, 2.1, 2.1, -2.1);
  });

  dxf.addBlock("LIGHT_SPOT", (d) => {
    d.circle(0, 0, 2);
    d.line(0, 2, 0, 4);
    d.line(-2, 0, -4, 0);
    d.line(2, 0, 4, 0);
    d.line(0, -2, 0, -4);
  });

  dxf.addBlock("EMERGENCY_LIGHT", (d) => {
    d.rect(-3, -2, 6, 4);
    d.text(-1.5, -1, 2.5, "BAES");
  });

  // === COMMANDES ===

  dxf.addBlock("SWITCH_SIMPLE", (d) => {
    d.circle(0, 0, 1);
    d.line(0, 1, 2, 3);
    d.line(0, 0, 0, -3);
  });

  dxf.addBlock("SWITCH_2WAY", (d) => {
    d.circle(0, 0, 1);
    d.line(0, 1, 2, 3);
    d.line(0, 0, 0, -3);
    d.text(2.5, 2, 1.2, "VV");
  });

  dxf.addBlock("SWITCH_DOUBLE", (d) => {
    d.circle(-1.2, 0, 1);
    d.circle(1.2, 0, 1);
    d.line(-1.2, 1, 0.2, 3);
    d.line(1.2, 1, 2.6, 3);
    d.line(0, 0, 0, -3);
  });

  dxf.addBlock("DIMMER", (d) => {
    d.circle(0, 0, 1.5);
    d.line(0, 0, 1.5, 1.5);
    d.line(0, 2, 0, -3);
    d.text(2, -0.5, 1.2, "VAR");
  });

  dxf.addBlock("PUSH_BUTTON", (d) => {
    d.circle(0, 0, 1);
    d.line(-1.5, 0, -3, 0);
    d.line(0, 0, 0, -3);
    d.text(-3, 1.5, 1.2, "BP");
  });

  dxf.addBlock("MOTION_SENSOR", (d) => {
    d.circle(0, 0, 2.5);
    d.line(-2, -2, 2, -2);
    d.text(-2.5, -4, 1.5, "DM");
  });

  // === ÉQUIPEMENTS ===

  const boxLabel = (label, w = 6, h = 6) => (d) => {
    d.rect(-w / 2, -h / 2, w, h);
    d.text(-w / 2 + 0.5, -1, 1.8, label);
  };
  dxf.addBlock("WATER_HEATER", boxLabel("ECS"));
  dxf.addBlock("VMC", boxLabel("VMC"));
  dxf.addBlock("ROLLER_SHUTTER", boxLabel("VR"));
  dxf.addBlock("OVEN", boxLabel("Four"));
  dxf.addBlock("HOB", boxLabel("Plaque", 8));
  dxf.addBlock("WASHING_MACHINE", boxLabel("LL"));
  dxf.addBlock("DISHWASHER", boxLabel("LV"));

  dxf.addBlock("MOTOR", (d) => {
    d.circle(0, 0, 3);
    d.text(-1, -1, 2.5, "M");
  });

  dxf.addBlock("BELL", (d) => {
    d.arc(0, 0, 3, 0, 180);
    d.line(-3, 0, 3, 0);
    d.circle(0, 0.5, 0.4);
  });

  // === COMPTAGE ===

  dxf.addBlock("METER", (d) => {
    d.rect(-5, -3, 10, 6);
    d.text(-4, -1, 2, "kWh");
  });

  dxf.addBlock("COMM_PANEL", (d) => {
    d.rect(-6, -4, 12, 8);
    d.line(-6, 0, 6, 0);
    d.text(-5, 1, 1.8, "ETEL");
    d.text(-5, -3, 1.5, "RJ45 x N");
  });

  // === TERRE ===

  dxf.addBlock("EARTH_ROD", (d) => {
    d.line(0, 3, 0, 0);
    d.line(-3, 0, 3, 0);
    d.line(-2, -1, 2, -1);
    d.line(-1, -2, 1, -2);
  });

  dxf.addBlock("EQUIPOTENTIAL", (d) => {
    d.line(-3, 0, 3, 0);
    d.line(-2, -1, 2, -1);
    d.line(0, 0, 0, 3);
    d.text(1, 1, 1.5, "LEP");
  });

  // === DIVERS ===

  dxf.addBlock("CIRCUIT_END", (d) => {
    d.circle(0, 0, 0.6);
    d.line(0, 0, 0, -3);
  });

  // Declared in manifest.json but previously undrawn — registered here so
  // heating and EV circuits get a real terminal symbol (closes the Hager gap).
  dxf.addBlock("BOX_HEATING", (d) => {          // convecteur / radiateur
    d.rect(-4, -3, 8, 6);
    d.line(-2.5, -1.2, 2.5, -1.2);
    d.line(-2.5, 0, 2.5, 0);
    d.line(-2.5, 1.2, 2.5, 1.2);
  });
  dxf.addBlock("BOX_IRVE", boxLabel("IRVE", 8));   // borne de recharge VE
}
