# blockly — offline-ish Blockly authoring harness

A standalone sandbox for iterating on the DHC Blockly **block + toolbox JSON**
that the Designer consumes. Sibling of `js-tools/` (which *views* finished
models); this one *authors* the structure. **One page, two workspaces** — an
`Electrical` and a `Spatial` designer, switched by the top tabs.

```bash
npm run preview:blockly               # unified designer, Electrical tab → :8767
npm run preview:blockly:spatial       # …opens on the Spatial tab (?ws=spatial)
npm run preview:blockly:electrical    # …opens on the Electrical tab (explicit)
```

All three run one script (`scripts/preview-blockly.sh [electrical|spatial]`) and
open the **same page** (`preview.html`) on the same port; they differ only in the
initial tab. Drag blocks, edit fields, **Save** to download *both*
workspaces as one combined file and **Load** to open one back (a combined file, a
single-workspace file, or `?load=<url>` to open one by link — e.g. the worked
example boards in `blockly/examples/board{1,2}.workspace.json`, two real 3-phase
boards reverse-engineered from photos, which load into the active workspace).
Ctrl-C to stop the server. *(Loading is schema-fragile today — a file saved
against an older block schema may not open; see the "persist the A-Box, regenerate
the workspace" item in `doc/parking-lot.md`.)*

> ⚠ **Not offline.** Unlike `js-tools/`, this harness loads Blockly from
> `https://unpkg.com/blockly@11.2.2` and needs a network connection. Vendoring a
> local `blockly.min.js` (to match the `js-tools` `grep -c https:// = 0`
> invariant) is deferred — see `doc/parking-lot.md`.

## The unified page

| Workspace | Files | Plugins | Root block |
|---|---|---|---|
| **Electrical** | `electrical-{blocks,toolbox,workspace}.json` | `registerPlugins-electrical.js` | `dhcb:PowerDistributionSystem` |
| **Spatial** | `spatial-{blocks,toolbox,workspace}.json` | `registerPlugins-spatial.js` | `dhcb:DigitalHome` |

`preview.html` loads both block sets and both plugin files up front (mutator names
and `dhcb:` types are all distinct), and swaps toolbox + theme + starter when you
switch tabs. Each tab shows its **full toolbox** — the old electrical
Sources/Routing/Sinks view-filter tabs are gone; those are toolbox categories now.
Switching preserves each workspace's in-memory state; **Save** captures both so
**cross-workspace placements survive** (see below).

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

### Wiring segments and automation points

- **`dhcb:WiringSegment`** — a rail module for a circuit's cable run, carrying
  `cableType`, `crossSection` and `length`, and a `wiring of ▾` reference to its
  `Circuit` token (→ `dhc:hasWiring`). Draw it to record cable lengths/types; skip
  it and the translator infers L/N/PE conductors from the circuit's cross-section.
- **`dhcb:Point`** — one automation-point block with a `pointType` dropdown over
  the seven `brick:Point` roots (`Sensor`/`Setpoint`/`Command`/`Status`/`Alarm`/
  `Parameter`/`Point`), drawn purple, `output: brick:Point`. It **plugs into a
  device's `⚙` point slots** and translates to `brick:hasPoint`. Nesting (not
  variable-linking) is used because a point belongs to exactly one device —
  Brick's `hasPoint` containment.
- **Nearly every device can host points.** The `dhc_points_mutator` (a
  device→points *value* mutator) is on all sources and sinks, the meter, AGCP,
  surge protector, the **RCD** and the **circuit/breaker** (remote-controllable
  protection). Only the root, the wiring segment, and the point itself can't.
- **Boards stay rows-only.** A distribution board is not itself a point host —
  its `dhc_board_mutator` manages only DIN rails. To give a board automation,
  drop a **`dhcb:IoTDevice`** onto a rail: a DIN-mounted IoT/smart module
  (gateway / energy monitor / smart relay / controller, purple) that consumes a
  `dinSlots` count of rail modules and carries its own points via the
  `dhc_points_mutator`. This keeps one mutator per block and models reality — the
  board is dumb copper; the smart bit is a module you add.

This is the **core residential set**. The rarer classes (`dhc:Contactor`,
`dhc:EquipotentialBonding`, `dhc:Distribution`/`BusBar`, PV panel/array sub-parts)
and the translator itself are the follow-up.

## The spatial harness

The **Spatial** tab authors the site → building → level → room → point spine.
Root `dhcb:DigitalHome` (a `rec:Site`) holds **places** (buildings + outdoor
areas) via a ⚙ mutator; a building (`dhcb:DetachedHouse` / `RowHouse` /
`SemiDetachedHouse` / `VirtualBuilding`) holds **levels** (`dhcb:Level` = `rec:Level`);
a level holds **rooms** (`dhcb:Room` = `rec:Room`, with a ~55-value `rec:RoomType`
dropdown); a room holds **contents** — native points (`dhcb:Sensor` / `dhcb:Alarm`
/ `dhcb:Setpoint`, each `output: brick:Point`, → `brick:hasPoint`) **and**
placements of electrical leaves (below). Outdoor areas (`dhcb:Garden` / `Parking`
/ `PoolArea`) take the **same contents** mutator, so an outdoor socket, an EV
charger on the driveway, or garden lighting can be placed there too. All four mutators
(`dhc_home_places_mutator`, `dhc_building_levels_mutator`, `dhc_level_rooms_mutator`,
`dhc_room_contents_mutator`) are thin configs over the same generic
statement/value factories the electrical harness uses. The slot `check` tags
(`rec:Architecture` / `rec:Level` / `rec:Room`, and `["brick:Point","leaf"]` on a
room's contents) are UI type-gates, **not** RDF.

## Cross-workspace linking (electrical leaves → spatial rooms)

A socket, luminaire, EV charger, appliance or automation point defined in the
**Electrical** workspace is a *leaf* that physically lives somewhere. The
**Spatial** workspace places it: a **`dhcb:Placement`** block (drawn electrical-blue,
from the **Placements** toolbox category) carries a **dropdown of the current
electrical leaves** and plugs into a room's (or outdoor area's) contents slot. On
`blockly→abox` a placement becomes `<leaf> rec:locatedIn <room>`. A **point** leaf
is labelled by the consumer it rides on (`<consumer> · point <name>`); a
`dhcb:Socket` / `dhcb:Luminaire` carries a `quantity` (how many outlets / bulbs),
which shows in the placement label (`… ×6`).

The reverse view lives on the **Electrical** tab: the right panel shows
**Leaves placed** `placed/total`, and every leaf block **not yet placed** in a
spatial room carries a ⚠ badge — so you can see at a glance what still needs a
home. (Computed from the spatial placements; it is the UI complement to the
parked dangling-reference pre-flight.)

- The bridge is a **shared, in-memory leaf registry**: `preview.html` projects the
  Electrical workspace's serialization into `window.DHC_LEAF_OPTIONS()` — a list of
  `{ id, label, blockType, ontologyClass, fedBy }` — which the placement dropdown
  reads live. Add or rename a leaf in Electrical, switch to Spatial, and it appears.
- **Leaf identity is the leaf's `name`** in this prototype (so the starter
  placements resolve with no ids stored on electrical blocks). A stored id whose
  leaf was deleted shows `⚠ … (missing)` rather than being dropped.
- This in-memory registry is the **stand-in for a backend/GraphQL leaf query** in
  the online app — same shape, swappable. Identity moves to the NanoID = A-Box IRI,
  and dangling links become a pre-flight check. See `doc/parking-lot.md § 4`.

`dhcb:Placement` is defined in code (in `registerPlugins-spatial.js`) rather than
block JSON, because a **dynamic** dropdown (options computed at open time) can't be
expressed in static `defineBlocksWithJsonArray` options.

## New / Save / Load / autosave

- **New** resets **both** workspaces to a blank root-only design (`dhcb:PowerDistributionSystem`
  + `dhcb:DigitalHome`). If the current design differs from the last New / Save /
  Load, a guard first offers **Save & New** / **Discard & New** / **Cancel** — the
  "dirty" check is a serialization compare at click time, so it never depends on
  catching a Blockly change event.
- **Save** downloads a combined `{ version, electrical, spatial }` file — both
  workspaces together, so cross-workspace placements persist. **Load** (and
  `?load=<url>`) accepts either that combined shape **or** a bare single-workspace
  Blockly state (which loads into the active tab) — so the single-state example
  boards in `examples/` still open. `?ws=electrical|spatial` picks the initial tab.
- **Autosave & restore.** The current state of both workspaces is kept in browser
  `localStorage` and restored on reopen (a restored design counts as dirty, so New
  guards it). New / Load overwrite it. This is per-browser convenience, *not* the
  durable format — that is still an exported file (and, ultimately, the A-Box; see
  `doc/parking-lot.md § 4`).

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

- **Block `type` is in the `dhcb:` (dhc-blockly) namespace** — e.g.
  `dhcb:Socket`, `dhcb:Circuit`, `dhcb:PowerDistributionSystem`. A block is a
  UI/design artifact, **not** its ontology class (several — the PDS, the sub-board,
  the generic appliance — have no class at all), so the block registry keeps its
  own namespace. **`dhcb:` is never emitted to RDF** — it is not an RDF prefix.
- **The ontology class lives in `data: "dhc:blocklyBlockTemplate=<curie>"`** — the
  *only* thing that maps a block to RDF (e.g. `dhcb:Luminaire` →
  `data=…=brick:Luminaire`; `dhcb:Socket` → `dhc:Socket`). `dhc:blocklyBlockTemplate`
  is a real `owl:AnnotationProperty` in `dhc-app-metadata.ttl`. The translator
  (parked) reads `data`, never the `type`.
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
needs them. All are recorded in `doc/parking-lot.md § 4`, which also plans the
overlay's **annotation shift** — retiring the T-Box→block generation annotations
(now superseded by this hand-authored harness) and adding an
`s223:hasExternalReference`-style `dhc:hasBlocklyReference` so the emitted A-Box
reflects the Blockly program structure.
