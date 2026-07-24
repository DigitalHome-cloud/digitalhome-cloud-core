/**
 * Wire-diagram (schéma unifilaire) pipeline: dhcb: electrical Blockly JSON →
 * blocklyToUnifilaireInput → neutral model → the vendored DXF/SVG engine.
 * Guards that every worked demo (and the starter) produces a coherent neutral
 * model (board + AGCP, every circuit fed by an RCD) and renders valid SVG + AC1009
 * DXF — all from the Blockly file, no A-Box.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blocklyToUnifilaireInput } from '../../blockly/dhcb-to-neutral.mjs';
import { renderUnifilaire, renderUnifilaireSvg } from '../../blockly/dxf/index.js';

const BLK = fileURLToPath(new URL('../../blockly/', import.meta.url));

// Symbol block names actually registered by the engine (draw functions).
const REGISTERED = new Set(
  (readFileSync(BLK + 'dxf/library/symbolsNfc15100.js', 'utf8').match(/addBlock\("[A-Z0-9_]+"/g) || [])
    .map((s) => s.slice(10, -1)),
);

// electrical states to render: the starter + every combined demo's `electrical`.
const cases = [
  ['electrical-workspace.json', JSON.parse(readFileSync(BLK + 'electrical-workspace.json', 'utf8'))],
  ...readdirSync(BLK + 'examples')
    .filter((f) => f.endsWith('.designer.json'))
    .map((f) => [f, JSON.parse(readFileSync(BLK + 'examples/' + f, 'utf8')).electrical]),
];

describe.each(cases)('unifilaire from Blockly — %s', (name, electrical) => {
  const input = blocklyToUnifilaireInput(electrical, name);

  it('produces a neutral model with a board and an AGCP', () => {
    expect(input.boards).toHaveLength(1);
    expect(input.delivery.agcp.rating).toBeGreaterThan(0);
    expect(typeof input.boards[0].label).toBe('string');
  });

  it('every circuit is fed by some RCD (nothing dropped from the drawing)', () => {
    const b = input.boards[0];
    const fed = new Set(b.rcds.flatMap((r) => r.feeds));
    for (const c of b.circuits) {
      expect(fed.has(c.id), `${name}: circuit "${c.id}" is fed by no RCD`).toBe(true);
    }
  });

  it('every circuit has a registered consumer symbol (no CIRCUIT_END gap)', () => {
    for (const c of input.boards[0].circuits) {
      expect(REGISTERED.has(c.symbol), `${name}: "${c.label}" → unregistered symbol ${c.symbol}`).toBe(true);
      expect(c.symbol, `${name}: "${c.label}" fell through to CIRCUIT_END`).not.toBe('CIRCUIT_END');
    }
  });

  it('renders localized chrome (FR/EN/DE title + cartouche)', () => {
    const de = renderUnifilaireSvg({ ...input, i18n: { schemaTitle: 'Übersichtsschaltplan', typeWord: 'Typ', cartouche: { projet: 'Projekt', echelle: 'Maßstab' } } });
    expect(de).toContain('Übersichtsschaltplan');
    expect(de).toContain('Projekt');
    expect(de).toContain('Maßstab');
  });

  it('renders valid SVG and AC1009 DXF', () => {
    const svg = renderUnifilaireSvg(input);
    const dxf = renderUnifilaire(input);
    expect(svg.trimStart().startsWith('<svg')).toBe(true);
    expect(svg.length).toBeGreaterThan(1000);
    expect(dxf).toContain('AC1009');
    expect(dxf.length).toBeGreaterThan(1000);
  });
});

// A focused check on the T4 panel: its three rangées → three RCDs (A / AC / F).
describe('unifilaire — T4 panel structure', () => {
  const t4 = JSON.parse(readFileSync(BLK + 'examples/t4-maison-pac-aireau.designer.json', 'utf8')).electrical;
  const b = blocklyToUnifilaireInput(t4, 'T4').boards[0];

  it('has three RCDs including a type-F reinforced group', () => {
    expect(b.rcds.length).toBe(3);
    expect(b.rcds.map((r) => r.type).sort()).toEqual(['A', 'AC', 'F']);
    expect(b.circuits.length).toBeGreaterThanOrEqual(15);
  });

  it('assigns each circuit a consumer terminal symbol from the fed sink / circuit type', () => {
    const symbols = new Set(b.circuits.map((c) => c.symbol));
    // every circuit has a symbol string
    expect(b.circuits.every((c) => typeof c.symbol === 'string' && c.symbol.length)).toBe(true);
    // the T4 consumers resolve to the right IEC symbols
    for (const expected of ['HOB', 'OVEN', 'WASHING_MACHINE', 'DISHWASHER', 'LIGHT_CEILING', 'ROLLER_SHUTTER', 'VMC', 'MOTOR', 'SOCKET_16A']) {
      expect(symbols.has(expected), `T4 diagram missing symbol ${expected}`).toBe(true);
    }
  });
});
