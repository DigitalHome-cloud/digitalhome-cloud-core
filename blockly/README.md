# blockly — offline-ish Blockly authoring harnesses

Standalone sandboxes for iterating on the DHC Blockly **block + toolbox JSON**
that the Designer consumes. Sibling of `js-tools/` (which *views* finished
models); this one *authors* the structure.

```bash
npm run preview:blockly:electrical    # electrical installation designer → :8767
npm run preview:blockly:spatial       # spatial hierarchy designer      → :8765
```

Each opens a Blockly workspace, its toolbox, and a starter workspace. Drag blocks,
edit fields, **Save** to download the workspace JSON. Ctrl-C to stop the server.

> ⚠ **Not offline.** Unlike `js-tools/`, these harnesses load Blockly from
> `https://unpkg.com/blockly@11.2.2` and need a network connection. Vendoring a
> local `blockly.min.js` (to match the `js-tools` `grep -c https:// = 0`
> invariant) is deferred — see `doc/parking-lot.md`.

## Harnesses

| Harness | Files | Root block |
|---|---|---|
| **electrical** | `electrical-{blocks,toolbox,workspace}.json` + `electrical-preview.html` | `dhc:PowerDistributionSystem` |
| **spatial** | `dhc-spatial-{blocks,toolbox,workspace}.json` + `preview.html` | `dhc:DigitalHome` |

Both share `registerPlugins.js` (variable-arity mutators, loaded after Blockly,
before the block defs).

## The electrical harness

The root block **`dhc:PowerDistributionSystem`** (⊑ `brick:System`) has a name
field, a **neutral-system** dropdown (the earthing arrangement / *régime de
neutre* — reusing the existing `dhc:neutralSystem` property: TT / TN-S / TN-C /
IT), a **medium** dropdown (`s223:hasMedium` — the electrical system, e.g.
`s223:AC-230VLN-1Ph-50Hz` or `s223:AC-400VLL-230VLN-3Ph-50Hz`), and three
statement slots — framed as the installation's **sub-systems** — gated by
type-check:

| Sub-system slot | `check` | Blocks |
|---|---|---|
| **① source** — energy generators | `source` | `dhc:EnergyDelivery`, `brick:PV_Generation_System`, `brick:Battery` |
| **② routing** — inverter & boards | `route` | `brick:Inverter`, `dhc:DistributionBoard` |
| **③ load** — consumers | `sink` | `dhc:Socket`, `brick:Luminaire`, `brick:Electric_Vehicle_Charging_Station`, `dhc:SubDistributionBoard` |

The slot `check` (`source`/`route`/`sink`) is a UI type-tag that gates which
block drops where — a sink can't be dropped in the sources slot. It is **not** an
ontology term. On the eventual **blockly→abox** translation, every slot member
becomes a `brick:hasPart` / `brick:isPartOf` edge of the system (which is why the
root is a `brick:System`).

**Grid delivery** (`dhc:EnergyDelivery`) carries the energy provider and the
**subscribed / contracted power** in kVA (`dhc:contractedPowerKVA`, the Enedis
tiers 3…36).

**Distribution boards** come in two forms, both with a ⚙ **row mutator**
(`dhc_board_mutator` in `registerPlugins-electrical.js`) that adds/removes rows =
**DIN rails**; each rail is a statement slot that accepts `module` blocks
(breakers / RCDs / circuits — the follow-up toolbox):

- **`dhc:DistributionBoard`** — the main board, `route`-connected (in the routing
  sub-system).
- **`dhc:SubDistributionBoard`** — a secondary / divisional board, `sink`-
  connected (fed downstream by a circuit).

## Circuits and variable linking

Rather than nest loads inside their circuit (cluttered), the toolbox links them
by a **typed Blockly variable** — a flat, readable model.

- **`dhc:Circuit`** is the *protected-line definition* — a `module` block that
  sits on a board rail. It binds a **`Circuit`-typed variable** (`field_variable
  CIRCUIT_VAR`, e.g. `CB_Sockets_LR`) and carries the fields the C-Box validates
  (`hasCircuitType`, `ratedCurrent`, `crossSection`, `phase`, `maxPoints`,
  `dedicated`) **plus** its protection (MCB/RCBO + `rcdType`/`sensitivityMA`).
  `dhc:RCD` is an optional differential *incomer* module on the same rail.
- **Loads** (`dhc:Socket`, `brick:Luminaire`, EV charger, `dhc:Appliance`,
  `dhc:SubDistributionBoard`) each have a **"protected by"** `field_variable`
  (`FED_BY`, `variableTypes: ["Circuit"]`) whose dropdown lists **only circuit
  tokens** — so a load can only be fed by a defined circuit. The native
  **Circuit lines** toolbox category is the variable flyout (Circuit and
  Differential tokens, plus buttons to create each).

### Where the differential (RCD) is defined

The **`dhc:RCD` block is where a differential is defined** — it owns a
`Differential`-typed token (`ID_Main`, `ID_Garage`, …) and carries `rcdType`,
`sensitivityMA`, `ratedCurrent`. A **`dhc:Circuit`** references its differential
through a `differential` `field_variable` (`variableTypes: ["Differential"]`).
**Reference-sharing is how the topology is expressed**, so both what old and new
editions require is representable:

| Topology | How to draw it |
|---|---|
| **one per install** (older NF C 15-100 allows it) | one `dhc:RCD`; **every** circuit's `differential ▾` points to it |
| **one per rail / per group** (newer editions) | one `dhc:RCD` per rail; each rail's circuits point to that rail's token |
| **one per circuit** (RCBO) | circuit `protection = RCBO` — it is its own integral differential |

This mirrors the reference A-Box, where a single `ex:rcd-main` appears in every
circuit's `dhc:hasProtection`. **The blocks only *represent* the topology; which
one is legal is the C-Box edition's call** — exactly the per-edition compliance
the viewer already computes. So the designer draws freely and the norm layer
judges (old edition passes one-per-install; a newer edition's shape would fail it
and demand per-rail).

The token represents a **`dhc:Circuit`** (the unit the C-Box targets — 24 shapes),
not a bare breaker. On **blockly→abox** the translator pairs each load's `FED_BY`
with the circuit's `CIRCUIT_VAR` and emits `dhc:Circuit` +`dhc:hasProtection`
+`dhc:hasWiring`, with the load as the circuit's `dhc:feedsEquipment` /
`brick:feeds` target. It must also **validate referential integrity** — every
referenced token has exactly one definition (no dangling, no duplicate). See
`doc/parking-lot.md § 4`.

This is the **core residential set**. The rarer classes (`dhc:Contactor`,
`dhc:EquipotentialBonding`, `dhc:Distribution`/`BusBar`, PV panel/array sub-parts,
explicit L/N/PE `dhc:WiringSegment` blocks) and the translator itself are the
follow-up.

## Localization

English (`electrical-blocks.json`) is the base. Each other locale is a
`lang/<lang>.json` file that overrides `messageN` / `tooltip` / (where a label is
translatable) `argsN` per block type, plus a `ui` map for the chrome — **deltas
only, no double-maintenance**. The header **Language** switch (EN / DE / FR, also
linkable as `?lang=de`) re-defines the blocks from the base merged with the
overrides and re-injects the workspace, preserving its state. `de.json` and
`fr.json` are populated for the electrical blocks; add a locale by copying one and
translating. (Mutator-generated row labels — "rail 1", "rail 2" — come from the
plugin, not the block JSON, so they are not yet localized.)

## Block-def format

`electrical-blocks.json` is a `{ "blocks": [ … ] }` array fed to
`Blockly.defineBlocksWithJsonArray`. Conventions:

- **Block `type` is the ontology curie** it represents (e.g. `dhc:Socket`). It
  collides by name with the A-Box class on purpose — that *is* the mapping.
- **`data: "dhc:blocklyBlockTemplate=<curie>"`** carries the same mapping in the
  serialized workspace, so a saved file names its templates without the block
  registry.
- **Children stack via `previousStatement` / `nextStatement` type-checks**; the
  parent exposes matching `input_statement` slots with a `check`.
- **Distinct input names** are required — Blockly rejects a block whose inputs
  share a name (the reason the first-draft root, with four `"NAME"` args, could
  not load).

## Ontology dependencies (parked)

The block templates reference classes that do not exist yet —
`dhc:PowerDistributionSystem`, `dhc:SubDistributionBoard`, `dhc:Appliance` — and
put the `dhc:neutralSystem` dropdown on the root, though that property is
currently domained to `dhc:EnergyDelivery`. There is also no property for a
breaker **curve** (B/C/D), so that field is omitted for now. The harness runs on
static JSON without any of these changes; only the future blockly→abox translator
needs them. All are recorded in `doc/parking-lot.md § 4`.
