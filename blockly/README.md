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
IT), and three statement slots gated by type-check:

| Slot | `check` | Starter blocks |
|---|---|---|
| **sources** — energy generators | `source` | `dhc:EnergyDelivery`, `brick:PV_Generation_System`, `brick:Battery` |
| **control & routing** — inverter, board | `route` | `brick:Inverter`, `dhc:DistributionBoard` |
| **sinks** — consumers | `sink` | `dhc:Socket`, `brick:Luminaire`, `brick:Electric_Vehicle_Charging_Station` |

The slot `check` (`source`/`route`/`sink`) is a UI type-tag that gates which
block drops where — a sink can't be dropped in the sources slot. It is **not** an
ontology term. On the eventual **blockly→abox** translation, every slot member
becomes a `brick:hasPart` / `brick:isPartOf` edge of the system (which is why the
root is a `brick:System`).

This is the **root block only**, with a minimal-but-real block per slot to prove
the checks. The complete toolbox (all classes, full field sets, and mutators for
circuits→protection→wiring and a board with N breakers) is the follow-up.

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

The block templates reference one class that does not exist yet —
`dhc:PowerDistributionSystem` — and put the `dhc:neutralSystem` dropdown on it,
though that property is currently domained to `dhc:EnergyDelivery`. The harness
runs on static JSON without either change; only the future blockly→abox
translator needs them. Both are recorded in `doc/parking-lot.md`.
