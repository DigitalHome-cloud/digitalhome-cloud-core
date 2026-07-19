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
  connected (fed downstream, e.g. by a circuit).

This is the **root plus first blocks**, enough to prove the sub-system checks and
the board mutator. The complete toolbox (protection devices, circuits, wiring,
the DIN-rail modules the rows hold) is the follow-up.

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

The block templates reference two classes that do not exist yet —
`dhc:PowerDistributionSystem` and `dhc:SubDistributionBoard` — and put the
`dhc:neutralSystem` dropdown on the root, though that property is currently
domained to `dhc:EnergyDelivery`. The harness runs on static JSON without any of
these changes; only the future blockly→abox translator needs them. All are
recorded in `doc/parking-lot.md § 4`.
