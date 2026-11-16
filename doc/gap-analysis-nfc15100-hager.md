# Gap analysis — NF C 15-100 worked examples (Hager guide)

Modeling the Hager *guide NF C 15-100* worked layouts (doc pp. 46–51) as Blockly
demos exercised the block set end-to-end and surfaced what the platform can and
cannot yet represent. The demos live in `blockly/examples/*.designer.json`
(combined `{electrical, spatial}`, loadable via `preview.html?load=…`); this doc is
the paired **gap register**. It complements `doc/parking-lot.md` (§ 1 C-Box
coverage, § 4 Blockly translator) — new gaps here, cross-referenced there.

## The five demos

| File | Source (Hager) | Config |
|---|---|---|
| `t1-pac-airair.designer.json` | p. 48 | T1 — heat pump air/air + collective DHW |
| `t2-chauffage-filpilote.designer.json` | p. 49 | T2 — electric heating (fil pilote) + thermodynamic DHW |
| `t3-gaz.designer.json` | p. 50 | T3 — individual gas boiler + thermodynamic DHW |
| `t4-maison-pac-aireau.designer.json` | p. 51 | T4 detached house — heat pump air/water (type F) |
| `comm-grade3.designer.json` | pp. 46–47 | Communication (VDI) panel, grade 3 |

Each: rows = `DistributionBoard` rails; each *inter. diff.* per row = an `RCD` token
referenced by that row's circuits; breakers = `Circuit` (exact A / mm² / type from
the guide); one representative named load per circuit, **placed into its room** in
the spatial workspace (the cross-workspace link). All placements resolve
(`tests/blockly/designer-roundtrip.test.js`).

## Per-example: modeled / approximated / missing

| Concept in the guide | Status | Note |
|---|---|---|
| Rows (rangées) + per-row 30 mA differential | ✅ modeled | `DistributionBoard` rails + one `RCD` token per rail (type A / AC / F, 40 A / 63 A) |
| Circuits (A, mm², 1-ph) | ✅ modeled | `Circuit` — ratedCurrent, crossSection, phase, dedicated |
| Cooking / lighting / socket / water-heater / heating / floor-heating / EV | ✅ modeled | existing `CircuitType` values |
| Ventilation (VMC), shutters (store/volet), heat pump | ✅ **added this pass** | new `CircuitType` dropdown values (T-Box enum still a gap — below) |
| DB (disjoncteur de branchement) rating | ⚠ partial | `EmergencyDisconnect.ratedCurrent` only |
| DB integral 500 mA **type-S selective** differential | ⚠ approximated | 500 mA + selectivity `S` **added to `RCD`**, but the DB block has no own differential; modeled as a note, not on the DB |
| Contracted power (kVA), single-phase | ✅ modeled | `EnergyDelivery` |
| VDI / communication panel (grade 2·3, DTI/DTIO, RJ45, TV/SAT, box) | ✅ **first-pass built** | new `CommunicationPanel` + `DTI`/`InternetBox`/`RJ45Outlet`/`TVOutlet` |
| Fil-pilote energy manager (EK482) | 🔶 approximated | `IoTDevice` (Controller) on a rail |
| RE2020 consumption indicator + TIC (EC453/EC410 essensya) | 🔶 approximated | `IoTDevice` (Energy monitor) + a `Point` |
| Contactor — heures creuses / heat-pump (ETS221B, NGT720/732) | ❌ not modeled | controlled circuit drawn directly; contactor omitted |
| Circuit→room location | ✅ modeled | `Placement` leaves in each room |
| Reinforced **type F** protection (T4) | ✅ modeled | `RCD` rcdType `F` |

## Consolidated gap register

### A. Blocks (still missing, after this pass)
- **`dhcb:Contactor`** — a rail module that switches a downstream circuit on a
  command (heures-creuses tariff, heat-pump control). Today the controlled circuit
  is drawn directly and the contactor is dropped.
- **First-class fil-pilote / energy manager** — EK482 drives heating zones over the
  pilot wire; currently a generic `IoTDevice`. Needs zone outputs + ordered comfort
  states (confort/éco/hors-gel/arrêt).
- **RE2020 consumption indicator** — EC453/EC410 + TIC (télé-information client) as a
  measurement device with per-circuit CT inputs; currently a generic `IoTDevice` + a
  `Point`.
- **DB own differential** — the 500 mA type-S selective differential integral to the
  `EmergencyDisconnect` (added to `RCD`, but the DB block itself can't carry it), plus
  collective-vs-individual and the DB's adjustable rating band (15/30/45 A).

### B. T-Box (gap-filled `dhc:`; promote via the `dhc-ontology-explorer` skill)
The harness legitimately **leads** the T-Box (it runs on static JSON); the
translator (`parking-lot.md § 4`) needs these to exist:
- **CircuitType enum instances**: `dhc:CircuitType_Ventilation`, `_Shutters`,
  `_HeatPump` (values already emitted by the Blockly dropdown).
- **VDI classes**: `dhc:CommunicationPanel`, `dhc:DTI`, `dhc:InternetBox`,
  `dhc:RJ45Outlet`, `dhc:TVOutlet` (Brick has no residential VDI vocabulary; these
  are `dhc:` gap-fill). Add trilingual labels + a **`communication` designView**.
- **`dhc:Contactor`** (a switching device); **fil-pilote / pilot-wire** property or
  class; **`dhc:selectivity`** (instantaneous / S) on the differential; **DB**
  differential (500 mA / type-S) + kVA + collective/individual.
- `dhc:Placement` (the room↔leaf edge) is already parked (§ 4) — it stays an edge,
  not a class.

### C. C-Box (norm shapes the examples require but that are not yet written)
The guide encodes NF C 15-100 rules the C-Box does not check (cross-ref the coverage
gap, `parking-lot.md § 1`):
- **Dedicated circuits** — cooktop (32 A / 6 mm²), oven (20 A / 2.5), washing machine
  (20 A / 2.5), dishwasher (20 A / 2.5), water heater (20 A / 2.5): each on its own
  circuit at the specified rating/section.
- **Type-A 30 mA differential required** for the cooking and washing-machine circuits,
  and **≥ 1 type-A 30 mA per installation**.
- **Max points per circuit** — 8 sockets on a 16 A socket circuit; ≥ 6 sockets in the
  kitchen; lighting-point limits (lighting is partly covered already).
- **DB 500 mA type-S** upstream, **selective** above the 30 mA row differentials.
- **Per-dwelling minimum circuit counts** (T1 … T4 baselines).
- **Reinforced (type F/HI)** for heat pumps and other high-inrush / sensitive loads.

### D. What this pass added
- `CircuitType` += Ventilation / Shutters / Heat pump; `RCD` += 500 mA sensitivity +
  `selectivity` (instantaneous / S). — `blockly/electrical-blocks.json`.
- VDI block set + **Communication** toolbox category + `dhc_vdi_outlets_mutator`. —
  `electrical-blocks.json`, `electrical-toolbox.json`, `registerPlugins-electrical.js`.
- `RJ45Outlet` / `TVOutlet` are **placeable leaves** (`PLACEABLE` in `preview.html`).
- Five combined demos + a `tests/blockly/designer-roundtrip.test.js` guard over every
  `*.designer.json`; the sync-skill lint (`dhc-blockly-sync-examples`) knows the new
  mutator and files.

## Cross-references
- `doc/parking-lot.md § 4` — dhcb↔abox translator, NanoID leaf identity (these demos
  ride the same placement/leaf model).
- `doc/parking-lot.md § 1` — C-Box A-Box coverage gap (the § C rules land there).
- `.claude/skills/dhc-ontology-explorer` — sole writer for the § B T-Box terms.
- `.claude/skills/dhc-electrical-installation-design` — the A-Box authoring path once
  the translator exists.
