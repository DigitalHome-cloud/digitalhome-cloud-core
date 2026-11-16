/**
 * Adapter: dhcb: electrical Blockly serialization → the neutral input model the
 * DXF/SVG engine (blockly/dxf/) renders. The Blockly file is the diagram source —
 * NO A-Box round-trip (that is fromAbox.js / Phase 2).
 *
 * Mirrors blockly/dxf/fromAbox.js's aboxToUnifilaireInput, but reads the dhcb:
 * block structure and its VARIABLE LINKS instead of {nodes,links} + class regexes:
 *   dhcb:EmergencyDisconnect → delivery.agcp
 *   dhcb:DistributionBoard   → the (single) board
 *   dhcb:RCD                 → rcds[], keyed by its RCD_VAR id
 *   dhcb:Circuit             → circuits[]; its DIFFERENTIAL var id → the RCD's
 *                              RCD_VAR id → the circuit joins that rcd.feeds[].
 *
 * unifilaire renders circuits ONLY via rcd.feeds, so any circuit not fed by an RCD
 * (RCBO / unmatched differential / no RCD at all) is gathered under a catch-all DDR.
 */

/* Consumer/terminal symbol picking — block names registered by
 * blockly/dxf/library/symbolsNfc15100.js. The symbol shown at a circuit's end is
 * the consumer it feeds (the sink via FED_BY), else inferred from the circuit type.
 * Unmapped → the engine's generic CIRCUIT_END. */
function socketByRating(r) { return r >= 32 ? 'SOCKET_32A' : r >= 20 ? 'SOCKET_20A' : 'SOCKET_16A'; }
const APPLIANCE_SYMBOL = {
  'Oven': 'OVEN', 'Dishwasher': 'DISHWASHER', 'Washing machine': 'WASHING_MACHINE',
  'Dryer': 'WASHING_MACHINE', 'Water heater': 'WATER_HEATER',
};
const CIRCUIT_TYPE_SYMBOL = {
  'dhc:CircuitType_Lighting': 'LIGHT_CEILING',
  'dhc:CircuitType_Cooking': 'HOB',
  'dhc:CircuitType_WaterHeater': 'WATER_HEATER',
  'dhc:CircuitType_Heating': 'BOX_HEATING',
  'dhc:CircuitType_FloorHeating': 'BOX_HEATING',
  'dhc:CircuitType_HeatPump': 'MOTOR',
  'dhc:CircuitType_Ventilation': 'VMC',
  'dhc:CircuitType_Shutters': 'ROLLER_SHUTTER',
  'dhc:CircuitType_IRVE': 'BOX_IRVE',
};
function symbolFor(circuit, sink) {
  const rating = circuit.breaker.rating;
  if (sink) {
    if (sink.blockType === 'dhcb:Socket') return socketByRating(rating);
    if (sink.blockType === 'dhcb:Luminaire') return 'LIGHT_CEILING';
    if (sink.blockType === 'dhcb:Electric_Vehicle_Charging_Station') return 'BOX_IRVE';
    if (sink.blockType === 'dhcb:Appliance' && APPLIANCE_SYMBOL[sink.applianceType]) return APPLIANCE_SYMBOL[sink.applianceType];
  }
  if (circuit.ontologyClass === 'dhc:CircuitType_Socket') return socketByRating(rating);
  return CIRCUIT_TYPE_SYMBOL[circuit.ontologyClass] || 'CIRCUIT_END';
}

export function blocklyToUnifilaireInput(electrical, smartHomeId) {
  const varName = {};
  for (const v of (electrical?.variables || [])) varName[v.id] = v.name;

  let agcp = null;
  let board = null;
  const rcds = [];
  const circuits = [];
  const rcdByVar = {};
  const sinkByCircuitVar = {};   // circuit var id → the consumer it feeds (for the terminal symbol)

  const walk = (b) => {
    if (!b || typeof b !== 'object') return;
    const t = b.type;
    const f = b.fields || {};
    if (t === 'dhcb:EmergencyDisconnect') {
      agcp = { rating: Number(f.ratedCurrent) || 60, label: f.name || 'AGCP' };
    } else if (t === 'dhcb:DistributionBoard' && !board) {
      board = { id: 'TGBT', label: f.name || 'Tableau de répartition' };
    } else if (t === 'dhcb:RCD') {
      const vid = f.RCD_VAR && f.RCD_VAR.id;
      const id = (vid && varName[vid]) || vid || f.name || 'DDR' + (rcds.length + 1);
      const rcd = {
        id,
        label: f.name || 'DDR',
        sensitivity: Number(f.sensitivityMA) || 30,
        type: f.rcdType || 'AC',
        feeds: [],
      };
      rcds.push(rcd);
      if (vid) rcdByVar[vid] = rcd;
    } else if (t === 'dhcb:Circuit') {
      const cvid = f.CIRCUIT_VAR && f.CIRCUIT_VAR.id;
      const id = (cvid && varName[cvid]) || cvid || f.name || 'C' + (circuits.length + 1);
      const c = {
        id,
        label: f.name || id,
        ontologyClass: f.hasCircuitType || null,
        breaker: { rating: Number(f.ratedCurrent) || 16, curve: 'C' }, // dhcb: has no curve → default C (parked gap)
        wire: { section: Number(f.crossSection) || 2.5, conductor: 'Cu' },
        maxPoints: Number(f.maxPoints) || 8,
        _diffVar: (f.DIFFERENTIAL && f.DIFFERENTIAL.id) || null,
        _circVar: cvid,
      };
      circuits.push(c);
    } else if (t === 'dhcb:Socket' || t === 'dhcb:Luminaire' ||
               t === 'dhcb:Electric_Vehicle_Charging_Station' || t === 'dhcb:Appliance') {
      const fed = f.FED_BY && f.FED_BY.id;
      if (fed && !sinkByCircuitVar[fed]) sinkByCircuitVar[fed] = { blockType: t, applianceType: f.applianceType };
    }
    const inp = b.inputs || {};
    for (const k of Object.keys(inp)) {
      if (inp[k].block) walk(inp[k].block);
      if (inp[k].shadow) walk(inp[k].shadow);
    }
    if (b.next && b.next.block) walk(b.next.block);
  };
  for (const tb of (electrical?.blocks?.blocks || [])) walk(tb);

  // Link circuits to their RCD (DIFFERENTIAL ↔ RCD_VAR) and pick each circuit's
  // terminal consumer symbol (the sink it feeds, else its circuit type).
  for (const c of circuits) {
    const rcd = c._diffVar && rcdByVar[c._diffVar];
    if (rcd) rcd.feeds.push(c.id);
    c.symbol = symbolFor(c, c._circVar && sinkByCircuitVar[c._circVar]);
  }
  // Catch-all for circuits fed by no RCD (RCBO / unmatched / no RCD modeled at all),
  // so every circuit renders (unifilaire draws only via rcd.feeds).
  const fed = new Set(rcds.flatMap((r) => r.feeds));
  const orphans = circuits.filter((c) => !fed.has(c.id));
  if (orphans.length) {
    rcds.push({
      id: 'DDR-DEF',
      label: rcds.length ? 'RCBO / non-groupé' : 'DDR 30 mA (type A) — défaut',
      sensitivity: 30,
      type: 'A',
      feeds: orphans.map((c) => c.id),
    });
  }
  for (const c of circuits) { delete c._diffVar; delete c._circVar; }

  return {
    smartHomeId: smartHomeId || 'UNKNOWN',
    generatedAt: new Date().toISOString(),
    delivery: {
      supplyType: 'monophase',
      agcp: agcp || { rating: 60, label: 'AGCP' },
    },
    boards: [
      {
        id: board ? board.id : 'TGBT',
        label: board ? board.label : 'Tableau de répartition',
        rcds,
        circuits,
      },
    ],
  };
}
