/**
 * Diagram glue (ES module) — bridges the classic-script harness IIFE to the
 * vendored, build-free DXF/SVG engine, and provides the localized wire-diagram
 * (schéma unifilaire) preview, DXF export, and the symbol legend.
 *
 *   dhcb: electrical Blockly JSON ─► blocklyToUnifilaireInput ─► neutral model
 *                                    ─► renderUnifilaireSvg / renderUnifilaire
 *
 * Publishes window.DHC_DIAGRAM (the harness's renderDiagram() retries until set).
 * No A-Box round-trip: the Blockly file is the diagram source (Phase 1).
 */
import { renderUnifilaire, renderUnifilaireSvg, downloadDxf } from './dxf/index.js';
import { blocklyToUnifilaireInput } from './dhcb-to-neutral.mjs';
import { createSvg } from './dxf/svgWriter.js';
import { registerNfc15100Symbols } from './dxf/library/symbolsNfc15100.js';
import MANIFEST from './dxf/library/manifest.js';

/* ── Diagram chrome localization (title, cartouche cells, "type" word) ─────── */
const I18N = {
  fr: { schemaTitle: 'Schéma unifilaire', typeWord: 'type',
    cartouche: { projet: 'Projet', smartHome: 'SmartHome', date: 'Date', echelle: 'Échelle', auteur: 'Auteur', verifie: 'Vérifié', indice: 'Indice', page: 'Page', format: 'Format' } },
  en: { schemaTitle: 'Single-line diagram', typeWord: 'type',
    cartouche: { projet: 'Project', smartHome: 'SmartHome', date: 'Date', echelle: 'Scale', auteur: 'Author', verifie: 'Checked', indice: 'Rev.', page: 'Page', format: 'Size' } },
  de: { schemaTitle: 'Übersichtsschaltplan (einpolig)', typeWord: 'Typ',
    cartouche: { projet: 'Projekt', smartHome: 'SmartHome', date: 'Datum', echelle: 'Maßstab', auteur: 'Autor', verifie: 'Geprüft', indice: 'Rev.', page: 'Seite', format: 'Format' } },
};
const i18nFor = (lang) => I18N[lang] || I18N.fr;

function buildInput(electricalState, smartHomeId, lang) {
  const input = blocklyToUnifilaireInput(electricalState, smartHomeId);
  input.i18n = i18nFor(lang);
  return input;
}

/* ── Symbol legend ─────────────────────────────────────────────────────────
 * Descriptions come from manifest.json's per-block label {fr,en}; a small DE map
 * fills German (else English fallback). Glyphs reuse the engine's block defs via
 * a single hidden <defs> SVG + one <use> per cell (see legend()). */
const SYMBOL_DE = {
  AGCP: 'Hauptschalter (AGCP)', MCB: 'Leitungsschutzschalter', SPD: 'Überspannungsschutz',
  CONTACTOR: 'Schütz', TELERUPTEUR: 'Stromstoßschalter', TRANSFO_TBT: 'Trafo (Kleinspannung)',
  SOCKET_16A: 'Steckdose 2P+E 16 A', SOCKET_20A: 'Steckdose 2P+E 20 A', SOCKET_32A: 'Steckdose 32 A',
  SOCKET_SPECIAL: 'Spezialsteckdose', SOCKET_RJ45: 'RJ45-Dose', SOCKET_TV: 'TV/SAT-Dose',
  JUNCTION_BOX: 'Abzweigdose', EARTH_BAR: 'Erdungsschiene', EARTH_ROD: 'Erder', EQUIPOTENTIAL: 'Potentialausgleich',
  LIGHT_CEILING: 'Deckenleuchte', LIGHT_WALL: 'Wandleuchte', LIGHT_RECESSED: 'Einbauleuchte', LIGHT_SPOT: 'Strahler', EMERGENCY_LIGHT: 'Sicherheitsleuchte (BAES)',
  SWITCH_SIMPLE: 'Ausschalter', SWITCH_2WAY: 'Wechselschalter', SWITCH_DOUBLE: 'Doppelschalter', DIMMER: 'Dimmer', PUSH_BUTTON: 'Taster', MOTION_SENSOR: 'Bewegungsmelder',
  WATER_HEATER: 'Warmwasserbereiter', VMC: 'Kontrollierte Wohnraumlüftung', ROLLER_SHUTTER: 'Rollladen',
  OVEN: 'Backofen', HOB: 'Kochfeld', WASHING_MACHINE: 'Waschmaschine', DISHWASHER: 'Geschirrspüler', MOTOR: 'Motor', BELL: 'Klingel',
  METER: 'Energiezähler', COMM_PANEL: 'Kommunikationsverteiler (ETEL)',
  BOX_HEATING: 'Konvektor / Wärmepumpe', BOX_IRVE: 'Ladepunkt (E-Fahrzeug)', DDR_30_AC: 'FI 30 mA Typ AC', DDR_30_A: 'FI 30 mA Typ A', DDR_30_F: 'FI 30 mA Typ F', DDR_30_B: 'FI 30 mA Typ B', DDR_300_AC: 'FI 300 mA Typ AC', DDR_300_A: 'FI 300 mA Typ A', CIRCUIT_END: 'Stromkreisende',
};
const CATEGORY_LABEL = {
  fr: { protection: 'Protection', terminaux: 'Terminaux', eclairage: 'Éclairage', commandes: 'Commandes', equipements: 'Équipements', comptage: 'Comptage', terre: 'Terre', divers: 'Divers' },
  en: { protection: 'Protection', terminaux: 'Terminals', eclairage: 'Lighting', commandes: 'Controls', equipements: 'Equipment', comptage: 'Metering', terre: 'Earthing', divers: 'Misc.' },
  de: { protection: 'Schutz', terminaux: 'Anschlüsse', eclairage: 'Beleuchtung', commandes: 'Steuerung', equipements: 'Geräte', comptage: 'Messung', terre: 'Erdung', divers: 'Sonstiges' },
};

function symbolDesc(entry, lang) {
  if (lang === 'de') return SYMBOL_DE[entry.name] || entry.label?.en || entry.name;
  return entry.label?.[lang] || entry.label?.en || entry.name;
}

// Mirror unifilaire.pickDdrBlock so "used in this diagram" is accurate.
function ddrBlock(rcd) {
  const ma = rcd.sensitivity === 300 ? 300 : 30;
  const t = ['AC', 'A', 'F', 'B'].includes(rcd.type) ? rcd.type : 'A';
  if (ma === 300 && !['AC', 'A'].includes(t)) return 'DDR_300_A';
  return `DDR_${ma}_${t}`;
}
function usedSymbols(electricalState, smartHomeId) {
  const input = blocklyToUnifilaireInput(electricalState, smartHomeId);
  const used = new Set(['AGCP', 'MCB']);
  for (const b of input.boards) {
    for (const r of b.rcds) used.add(ddrBlock(r));
    for (const c of b.circuits) used.add(c.symbol);
  }
  return used;
}

const cssId = (name) => String(name).replace(/[^a-zA-Z0-9_-]/g, '_');

// Map of block id → its <symbol> def, parsed once from a full engine render. Each
// legend glyph is a SELF-CONTAINED <svg> (own <defs> + same-svg <use>) — reliable,
// and lean (only that one symbol's def).
let _defMap = null;
function symbolDefMap() {
  if (_defMap) return _defMap;
  const s = createSvg();
  s.ensureLayer('SYMBOLS', 7);
  registerNfc15100Symbols(s);
  const full = s.toString();
  _defMap = {};
  const re = /<symbol id="(blk-[A-Za-z0-9_-]+)"[^>]*>[\s\S]*?<\/symbol>/g;
  let m;
  while ((m = re.exec(full))) _defMap[m[1]] = m[0];
  return _defMap;
}
function glyphSvg(useId) {
  const def = symbolDefMap()[useId] || '';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 24 24" preserveAspectRatio="xMidYMid meet">'
    + '<defs>' + def + '</defs>'
    + '<g stroke="#111" stroke-width="0.6" fill="none"><use href="#' + useId + '"/></g></svg>';
}

window.DHC_DIAGRAM = {
  renderSvgInto(el, electricalState, smartHomeId, lang) {
    el.innerHTML = renderUnifilaireSvg(buildInput(electricalState, smartHomeId, lang));
  },
  exportDxf(electricalState, smartHomeId, filename, lang) {
    downloadDxf(renderUnifilaire(buildInput(electricalState, smartHomeId, lang)), filename);
  },
  /** Legend model: the shared defs + one item per registered symbol. */
  legend(lang, electricalState, smartHomeId) {
    const used = electricalState ? usedSymbols(electricalState, smartHomeId) : new Set();
    const cat = CATEGORY_LABEL[lang] || CATEGORY_LABEL.fr;
    const items = MANIFEST.blocks
      .filter((b) => b.kind === 'symbol')
      .map((b) => ({
        name: b.name,
        glyph: glyphSvg('blk-' + cssId(b.name)),
        category: cat[b.category] || b.category || '',
        description: symbolDesc(b, lang),
        used: used.has(b.name),
      }));
    return { items };
  },
};
