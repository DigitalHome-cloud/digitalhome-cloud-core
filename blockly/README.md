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

## Wire diagram (schéma unifilaire) — Diagram tab

A third top tab, **Diagram**, renders the single-line electrical diagram (NF C
15-100 *schéma unifilaire*) **straight from the electrical Blockly file — no A-Box
round-trip**. `Export DXF` (header) downloads it as an AC1009 DXF for LibreCAD /
QCAD / AutoCAD; `?view=diagram` deep-links to it (`&legend=1` also opens the legend).

- **Localized** (EN / DE / FR, follows the Language switch): the diagram title, the
  cartouche cell labels, the "type" word, and the legend/toolbar chrome. The engine's
  hardcoded French is now parameterized via `input.i18n` (`diagram.js` supplies the
  active-language pack; default stays French).
- **Zoom** — `−` / `Fit` / `＋` buttons and Ctrl+wheel over the canvas.
- **Symbol legend** (`Legend` button) — every IEC 60617 symbol as a rendered glyph
  with a localized description and its block name, grouped by category, with a
  **"used in this diagram"** filter and a ✓ badge on the symbols the active diagram
  actually draws. Each glyph is a self-contained `<svg>` (own `<defs>` + `<use>`)
  parsed once from the engine's block set.

The pipeline reuses the Designer's self-contained DXF/SVG engine, **vendored** into
`blockly/dxf/` (canonical copy stays in `repos/designer/src/export/dxf/`; the vendored
copy adds `.js` to relative imports and ships `manifest.js` so it loads build-free as
native ESM). The **neutral input model** is the render pivot:

```
dhcb: electrical JSON ─► blocklyToUnifilaireInput ─► { delivery, boards:[{ rcds, circuits }] }
   (blockly/dhcb-to-neutral.mjs)                        ─► renderUnifilaireSvg  (preview)
                                                         ─► renderUnifilaire     (DXF)
```

`dhcb-to-neutral.mjs` reads the board's rails and the **variable links**: each
`dhcb:Circuit`'s `DIFFERENTIAL` variable matches an `dhcb:RCD`'s `RCD_VAR`, which
groups circuits under their differential (RCBO / unmatched circuits fall under a
catch-all DDR so nothing is dropped). It also picks each circuit's **terminal
consumer symbol** — from the sink it feeds (`dhcb:Socket`→`SOCKET_16/20/32A`,
`dhcb:Luminaire`→`LIGHT_CEILING`, `dhcb:Appliance` `Oven`→`OVEN`, … ) or, if no
sink, from the circuit type — using the IEC 60617 symbols in
`blockly/dxf/library/symbolsNfc15100.js`. `unifilaire` draws `circuit.symbol` at the
circuit end (falling back to the generic `CIRCUIT_END`). `blockly/diagram.js` is the ES-module glue that
publishes `window.DHC_DIAGRAM` for the classic-script page. `tests/blockly/diagram.test.js`
guards the pipeline over every demo.

> The same neutral model will later be fed by an **A-Box** source (`fromAbox.js`, also
> vendored) and by the bidirectional `dhcb:↔A-Box` translator — so diagrams come from
> either the Blockly file or the A-Box. Phase 1 (this) is Blockly-only. See
> `doc/parking-lot.md § 4`.

## Floor-plan sketch — Floor plan tab

A fourth top tab, **Floor plan**, is a sketch view of the *spatial* structure:
each **room** of the active building level is drawn as a **draggable, resizable
rectangle** with dotted "sketch" walls, and each of the room's **points** (its
`dhcb:Sensor` / `Alarm` / `Setpoint` children and `dhcb:Placement`s) is a marker
**clamped inside the room it is linked to** — a point can only be placed in its
own room. A floor switcher pages through the levels; `−` / `Fit` / `＋` and wheel
zoom navigate the canvas; `?view=floorplan` deep-links to it.

**Blockly is the master.** Which buildings, levels, rooms and points *exist* is
read from the Spatial workspace **every time the tab opens** — adding or removing
them stays in the Spatial tab, and re-entering Floor plan picks up the change.
The two structural dimensions both surface: the floor switcher lists one entry
per **building × level** (`Main House · Ground floor`). Buildings/levels/rooms
hang off `hasPart_*` *statement* inputs, so a sibling counts whether it sits in
its own mutator slot **or is stacked on the previous one via a next-connection**
(the natural drag-snap) — `blockly/floorplan/spatial-parse.mjs` flattens both.
This view owns only **geometry** (a cosmetic sketch — it does **not** feed the
ontology), stored in a `floorplan` layer of the combined Save file:

```
{ version:'dhc-blockly-designer/1', electrical, spatial, floorplan: {
    rooms:    { <blockId>: { x,y,w,h,            // rectangle (default)
                         poly?:[{x,y}…],         // free polygon once "rectangle off"
                         walls?:{ <edge>:{ standard, thickness, partial?, height? } } } },
    points:    { <blockId>: {x,y} },
    openings:  { <id>: { room,edge,t,width, kind:'door'|'window', flipH?,flipV? } },
    furniture: { <id>: { type, name, floor, x,y, rot, w,h } } } }
```

A room with no saved geometry gets an **auto-layout** rectangle (row-packed,
scaled by `area_M2`); saved geometry is preserved, so a room added later in
Spatial shows up with a default rect while the others keep their positions. The
layer is additive — older files (rects only, no `poly`/`walls`/`openings`) still
load.

**Sketch tools** (a mode selector in the bar — `Select · Split · Wall · Door ·
Window`):
- **Select** — drag rooms, polygon vertices, points, and openings.
- **Turn off rectangle** (room properties) — convert a room to a free **polygon**;
  its corners become draggable vertex handles; *Reset to rectangle* reverts.
- **Split** — click a wall to insert a corner (rectangle → polygon).
- **Wall** — click an edge to promote it to a thick **standard wall** (toggle).
  Select a standard wall to edit its **thickness**, or turn off *Reaches ceiling*
  to make it a **partial-height** wall (rendered dashed & faded, with a height).
- **Door / Window** — click a wall to place an opening (door with a swing arc,
  window as a band); drag it along the wall, edit its width, delete it, and for a
  door **flip the hinge** (left/right) and **swing side** (in/out).
- **Furniture** — open the library (Arcada's full catalog, ~65 items across
  Bedroom / Kitchen / Living Room / Bathroom / Office / Structural / Other, with a
  **search filter** and scroll), click an item to drop it on the plan, then **drag**
  to move and **rotate** in 15° steps (or delete). Furniture is a per-floor overlay.
  Items are rendered as our own vector glyphs (variants share a glyph); Arcada's
  low-res raster artwork is **not** used — see the attribution below.
- **Points** clamp to their room's outline — rectangle **or** polygon
  (`clampPointToPoly`).

**Stable identity.** Rooms and points are keyed by their **Blockly block `id`**
(`spatial-parse.mjs`), so **renaming or retyping a room in Spatial keeps its
sketch** — only the room's attributes update. The harness's `Blockly.serialization`
save/load carries those ids; an id-less hand-authored example falls back to a
`building/level/room` **path** key (rename-fragile) until it is first saved.

**Implementation — a lazy React island.** `blockly/floorplan/floorplan-app.jsx`
is a self-contained React 18 component, **compiled in the browser by
Babel-standalone** and loaded only on first activation of the tab (so the
Electrical / Spatial / Diagram startup is untouched). React, ReactDOM and Babel
come from the same CDN posture as Blockly (unpkg; offline vendoring parked). The
pure logic is factored into ESM modules **shared** by the island (browser dynamic
import → `window.DHC_FLOORPLAN_*`) and the vitest guards, so each invariant is
written once: `geometry.mjs` (auto-layout, corner-resize, the polygon maths —
`roomPoly` / `polyEdges` / `splitEdge` / `moveVertex` / `pointInPoly` /
`clampPointToPoly` — → `tests/blockly/floorplan.test.js`) and `spatial-parse.mjs`
(the dhcb: Spatial serialization → floors, incl. stacked levels/buildings →
`tests/blockly/spatial-parse.test.js`). A `window.DHC_FLOORPLAN_HOST` bridge passes
`states.spatial` in and takes geometry edits back into `states.floorplan`, so
**Save + autosave** persist the sketch. The door/window glyphs (swing arc, band)
and the thick-wall render idiom follow the prototype; the editing interactions are
our own. The **furniture** library (`furniture-glyphs.jsx`, `Furniture` tool) is
adapted from **Arcada**.

> **License / attribution:** the floor-plan view is adapted from a prototype
> derived from **Arcada** (https://github.com/mehanix/arcada), an open-source floor
> planner under the **Apache License 2.0**. The furniture **catalog** and the
> serialized floor-plan **data shape** come from Arcada; the furniture glyphs are
> re-drawn as our own SVG and all editing/Blockly-integration code is original.
> Attribution, the license text, and our statement of changes are in
> [`blockly/floorplan/THIRD-PARTY-NOTICES.md`](floorplan/THIRD-PARTY-NOTICES.md) +
> [`LICENSE-Arcada-Apache-2.0.txt`](floorplan/LICENSE-Arcada-Apache-2.0.txt).
> Apache-2.0 is permissive (no copyleft). Runtime deps **React (MIT, Meta)** and
> **Babel (MIT, OpenJS Foundation)** load from a CDN.

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
