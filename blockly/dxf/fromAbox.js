/* VENDORED from repos/designer/src/export/dxf/ (canonical copy lives there).
 * Build-free ESM: relative imports carry .js; manifest is manifest.js. Do not hand-diverge;
 * re-vendor when the Designer engine changes. See blockly/README.md (Diagram / DXF). */
/**
 * Adapter: Designer A-Box JSON (nodes/links from aboxSerializer.serializeToJSON)
 * → neutral input model consumed by the diagram renderers.
 *
 * The mapping is intentionally forgiving: the Blockly workspace may be
 * incomplete while a user is designing. Missing protections default to sane
 * NF C 15-100 values so the exported DXF always renders.
 */

const CIRCUIT_CLASS_RX = /Circuit/i;
const RCD_CLASS_RX = /(DifferentialSwitch|Rcd|ResidualCurrent)/i;
const BREAKER_CLASS_RX = /(CircuitBreaker|Breaker|Mcb)/i;
const AGCP_CLASS_RX = /(Agcp|BranchCircuitBreaker|MainDisconnect)/i;
const BOARD_CLASS_RX = /(DistributionBoard|Tgbt)/i;

function shortId(iri) {
  const s = String(iri || "");
  const hash = s.split("/").pop();
  return hash?.slice(0, 6) || "?";
}

function classOf(type) {
  return (type || "").split(":").pop();
}

export function aboxToUnifilaireInput({ nodes = [], links = [] }, smartHomeId) {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const outgoing = new Map();
  for (const l of links) {
    if (!outgoing.has(l.source)) outgoing.set(l.source, []);
    outgoing.get(l.source).push(l);
  }

  const board = nodes.find((n) => BOARD_CLASS_RX.test(classOf(n.type))) || null;
  const agcp = nodes.find((n) => AGCP_CLASS_RX.test(classOf(n.type))) || null;

  const rcds = nodes
    .filter((n) => RCD_CLASS_RX.test(classOf(n.type)))
    .map((n) => ({
      id: shortId(n.id),
      label: n.label || "DDR 30 mA",
      sensitivity: Number(n.properties?.SENSITIVITY) || 30,
      type: n.properties?.RCD_TYPE || "AC",
      feeds: (outgoing.get(n.id) || [])
        .map((l) => byId.get(l.target))
        .filter((t) => t && CIRCUIT_CLASS_RX.test(classOf(t.type)))
        .map((t) => shortId(t.id)),
    }));

  const circuits = nodes
    .filter((n) => CIRCUIT_CLASS_RX.test(classOf(n.type)))
    .map((n) => {
      const cls = classOf(n.type);
      const defaults = circuitDefaults(cls);
      return {
        id: shortId(n.id),
        label: n.label || cls,
        ontologyClass: n.type,
        breaker: {
          rating: Number(n.properties?.BREAKER_RATING) || defaults.breaker,
          curve: n.properties?.BREAKER_CURVE || "C",
        },
        wire: {
          section: Number(n.properties?.WIRE_SECTION) || defaults.wire,
          conductor: "Cu",
        },
        maxPoints: Number(n.properties?.MAX_POINTS) || defaults.maxPoints,
      };
    });

  // If no RCD was modeled, wrap all circuits under a default 30 mA AC DDR so
  // the unifilaire is still legible.
  if (rcds.length === 0 && circuits.length > 0) {
    rcds.push({
      id: "DDR1",
      label: "DDR 30 mA (type A) — défaut",
      sensitivity: 30,
      type: "A",
      feeds: circuits.map((c) => c.id),
    });
  }

  return {
    smartHomeId: smartHomeId || "UNKNOWN",
    generatedAt: new Date().toISOString(),
    delivery: {
      supplyType: "monophase",
      agcp: {
        rating: Number(agcp?.properties?.RATING) || 60,
        label: agcp?.label || "AGCP",
      },
    },
    boards: [
      {
        id: board ? shortId(board.id) : "TGBT",
        label: board?.label || "Tableau de répartition",
        rcds,
        circuits,
      },
    ],
  };
}

function circuitDefaults(className) {
  const c = (className || "").toLowerCase();
  if (c.includes("lighting")) return { breaker: 16, wire: 1.5, maxPoints: 8 };
  if (c.includes("cooking") || c.includes("cuisson")) return { breaker: 32, wire: 6, maxPoints: 1 };
  if (c.includes("heat")) return { breaker: 20, wire: 2.5, maxPoints: 1 };
  if (c.includes("socket") || c.includes("prise")) return { breaker: 16, wire: 2.5, maxPoints: 8 };
  return { breaker: 16, wire: 2.5, maxPoints: 8 };
}
