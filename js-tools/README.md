# js-tools — offline A-Box viewer

See and validate the models in `schema/abox/` without Gatsby, without AWS, and
without a network.

```bash
npm run preview:abox                                   # the default A-Box
bash scripts/preview-abox.sh schema/abox/other.ttl     # a specific one
bash scripts/preview-abox.sh schema/abox/other.ttl 8790  # …on another port
npm run build:abox                                     # regenerate JSON only
```

The launcher builds `data/{graph,report}.json`, serves this directory, and opens
the viewer. Ctrl-C to stop.

Sibling of `py-tools/`: **Python curates the T-Box, JavaScript views and
validates it.**

## Adding a model to the viewer

Drop a `.ttl` under `schema/abox/` and run `npm run build:abox` (or
`npm run preview:abox`). It appears in the picker. That is the whole mechanism —
`build-abox.mjs` walks `schema/abox/` **recursively**, builds one graph per file
into `data/<basename>.json`, and the viewer reads `data/index.json`. No
registration list.

**Where you put it decides how it is treated** — the subfolder is the signal:

| Location | Treated as | Validated? | In tests? |
|---|---|---|---|
| `schema/abox/*.ttl` (top level) | **ours** | yes — against the C-Box, per edition | yes; must carry a deliberate defect |
| `schema/abox/<folder>/*.ttl` | **reference** | no — rendered only | no |

A reference model (e.g. `examples-brick-1.5/`) is external, carries no norm
layer, and is drawn so it can be browsed — every node comes out `unchecked`,
which is the truthful state: nothing governs a stock Brick model. Skipping
validation also keeps the build fast (some samples are thousands of triples).
Reference files are grouped in the picker under their folder name.

**Robustness differs by treatment too.** A reference file that fails to parse, or
has no A-Box-to-A-Box links to draw (e.g. a sensor-only sample whose relations
all go to blank nodes), is **skipped with a warning** — one bad external file
never takes the build down. The same failure in one of *our* top-level files is
**fatal**, because there it is a real regression.

Basenames must be unique across the whole tree (they name the generated data
files); the build refuses a collision rather than letting one silently overwrite
the other.

## What you see

- **Nodes** — A-Box individuals, each drawn as a **per-class glyph** (a lamp is
  a sphere, a breaker a tall box, the grid source an octahedron, …). The glyph is
  resolved from the class by subclass closure, never hand-listed — see
  [Per-class glyphs](#per-class-glyphs). A toggle swaps the 3-D primitives for
  flat IEC-style symbols.
- **Links** — the actual instance triples, drawn by **kind** (below).
- **Click any legend row to filter** — nodes, edges, *or* a group row (which
  collapses the group); **All** resets.
- **Model picker** — every A-Box in `schema/abox/` is prebuilt, so switching is
  a fetch, not a revalidation. A model with violations is marked `— n⚠`.
- **Log pane** — the whole chain: counts, circuits found, which classes the
  shapes target, which *edition* the shapes implement, the conformance verdict.
- **Linkable views** — every control is a query param, so any state is a URL:
  `?model=<slug>&mode=modelling|designing&colour=<mode>&group=none|zone|circuit|composition&symbols=flat&trace=<curie|id-suffix>`.

### Two modes: modelling and designing

Two audiences want opposite things from the same graph, so the header has a
**mode** switch that gates what the rest of the UI can show.

| Mode | For | Colour options | Compliance |
|---|---|---|---|
| **modelling** | reading the model — classes, properties, descriptions, the vocabulary | design view · standard | **never shown** |
| **designing** | analysing the model against a chosen set of norm editions | compliance · design view | **only shown here** |

- **Modelling** leads the inspector with the node's **class + description** and a
  **properties** table — every predicate carries the label and comment from
  `data/vocab.json` (built from `dhc-core` + the annotation overlay). With no node
  selected it shows the **Vocabulary catalog**: the classes / object properties /
  data properties the model actually uses, each with its description; click one to
  isolate what it touches. Compliance colour, ghosting and violation markers are
  all suppressed — a modeller never sees a red node.
- **Designing** adds a **Norms…** modal that lists `report.editions` grouped by
  norm (plus an empty good-practices category — no norm declares
  `dhc:normCategory "BestPractice"` yet). Ticking a subset **recomputes each
  node's displayed verdict client-side** from its `targetedEditions` /
  `violatedEditions` — worst-wins, with the same grandfathering and ghosting rules
  the build uses (fails the oldest selected edition ⇒ danger; passes it, fails the
  newest ⇒ gap; none selected target it ⇒ unchecked). **The built verdict is never
  rewritten** — this is a display recompute, so `npm test` and the page cannot
  disagree. On the full edition set it reproduces the build's verdict exactly.

### Four kinds of edge

Because "where a thing is", "what it is part of", "what energy flows through it"
and "what commands it" are different questions that should not look alike:

| Kind | Predicates | Drawn |
|---|---|---|
| **spatial** | `rec:locatedIn`, `rec:isLocationOf`, `rec:includes`, `rec:hasPart`, `brick:hasLocation` | thin green |
| **structural** | `brick:hasPart`/`isPartOf`, `dhc:hasProtection`, `dhc:hasWiring`, `s223:hasMember`, `s223:hasConnectionPoint` | grey |
| **flow** | `brick:feeds`, `s223:connectsThrough` | blue, **moving dots** |
| **control** | `brick:controls` | pink, **moving blocks** |

Flow and control move because they are the two that describe something
*happening*. The mapping lives in `EDGE_CLASS` in `build-abox.mjs`; a predicate
that isn't in it is drawn orange as `other` **and reported at the end of the
build**, so new modelling surfaces as a question rather than a default.

### Per-class glyphs

Each node's shape is chosen from its `rdf:type` by **subclass closure** — the
same fixpoint walk over `rdfs:subClassOf` that decides equipment, so a new class
lands on the right glyph the moment it is subtyped, with nothing to hand-edit.
The map is an ordered priority list (`GLYPH_ROOTS` in `build-abox.mjs`): the
first glyph whose root set contains any of the node's types wins, so specific
loads beat the generic `appliance` fallback (a `Luminaire ⊑ Equipment` is a lamp,
not a box). `build-abox.mjs` writes the resolved `glyph` onto each node.

| Glyph | Shape (3-D) | Root classes |
|---|---|---|
| `bulb` | glowing sphere | `brick:Luminaire`, `brick:Lighting_Equipment` |
| `socket` | short disc | `dhc:Socket`, `s223:ElectricityOutlet` |
| `breaker` | tall thin box | `dhc:ProtectionDevice`/`RCD`/`RCBO`/`EmergencyDisconnect`, `s223:ElectricityBreaker` |
| `panel` | wide flat box | `dhc:DistributionBoard` |
| `meter` | squat cylinder | `dhc:EnergyMeter`, `brick:Meter` |
| `inverter` | box | `brick:Inverter`, `s223:ElectricEnergyInverter` |
| `battery` | upright cylinder | `brick:Battery`, `s223:Battery`, `brick:Energy_Storage` |
| `pv` | thin flat panel | `brick:PV_Panel`/`PV_Array`/`PV_Generation_System` |
| `charger` | tapered post | `brick:Electric_Vehicle_Charging_Station` |
| `delivery` | octahedron | `dhc:EnergyDelivery` (the grid source) |
| `busbar` | long thin bar | `dhc:BusBar`, `s223:Junction` |
| `circuit` | torus | `dhc:Circuit` |
| `wire` | thin rod | `dhc:WiringSegment`, `s223:Connection` |
| `port` | tetrahedron | `s223:ConnectionPoint` |
| `controller` | small octahedron | `brick:Controller` |
| `sensor` | small sphere | `brick:Point` |
| `building` | house (body + roof) | `dhc:DigitalHome`/`DetachedHouse`, `rec:Building` |
| `room` | floor plate | `rec:Room`/`Space`, `dhc:ElectricalTechnicalSpace` |
| `appliance` | cube | `s223:Equipment`, `brick:Equipment` (fallback) |

The **symbols** header button toggles the 3-D primitives for **flat IEC-style
symbols** — each glyph drawn once on a `<canvas>` → `CanvasTexture` → billboarded
sprite. Both are built offline from primitives and canvas only; no SVG, no
network. Geometry and materials are shared across nodes (one geometry per glyph, a
~20-entry material cache keyed `colour|opacity`), which is what keeps the
1695-node `soda_brick` sample interactive.

### Grouping

The **group** selector wraps related nodes in a translucent hull, derived from
the edges — nothing is hand-assigned:

| Group by | Membership predicates |
|---|---|
| **zone** | `rec:locatedIn`, `brick:hasLocation`, `rec:isLocationOf` |
| **circuit** | `s223:hasMember` |
| **composition** | `brick:hasPart`, `s223:contains`, `rec:includes`, `rec:hasPart`, `brick:isPartOf` |

Each group gets a tinted hull that follows the live layout (repositioned every
engine tick; the renderer never raycasts it, so it can't steal a node click). The
legend lists every group; **clicking a group row collapses it** into a single
super-node — members folded, internal links dropped, external links re-pointed and
de-duplicated — and clicking again expands it. A collapsed group's edition arrays
are the **union** of its members', so its compliance colour is worst-wins from the
same client-side recompute. Collapse is also the perf lever on a large graph.

### Upstream supply trace

The **Consumers** button lists the leaf loads (the `socket`/`bulb`/`charger`/
`appliance` glyphs) grouped by zone. Picking one — or the **Trace supply
upstream** button in any electrical/automation node's inspector — reverse-walks
the supply: it follows **flow** (`brick:feeds`, `s223:connectsThrough`/
`connectsTo`) and **control** (`brick:controls`) edges backward to every source,
then keeps only the `electrical`/`automation` nodes, so rooms and the building
drop out. The traced chain replaces the graph (grouping and hulls suspend while a
trace is active); **All** or **Clear trace** resets. Linkable as
`?trace=<curie|id-suffix>`. On the demo house, `ex:socket-lr-1` resolves to
socket → breaker → board → inverter → {AGCP, PV array, battery} → meter →
`ex:delivery`.

### Three colour modes

The colour dropdown offers different modes per view — **compliance** only in
designing, **standard** only in modelling; **design view** in both.

| Mode | Colours by | Tells you |
|---|---|---|
| **design view** | the class's `dhc:designView` | the house palette — electrical blue, spatial green, … reads like the Modeler |
| **compliance** | per-node norm state | **see below** — the only mode that ghosts nodes |
| **standard** | the namespace of `rdf:type` | which standard defines each thing — dhc 29 / brick 10 / rec 3 / s223 3 on the demo house, i.e. the "dhc: only fills gaps" principle made visible |

Note "standard" colours by the **type's** namespace, not the individual's:
every A-Box individual is an `ex:`, so colouring by the subject IRI paints all
45 nodes one colour and says nothing.

### Compliance — computed, on two channels

A prototype of what the Designer will show properly.

**Nothing in the A-Box declares its compliance.** `build-abox.mjs` validates the
model against *every* norm edition that has shapes and compares the verdicts.
That is the whole idea: the A-Box says what is built, the C-Box says what each
edition requires, and the state falls out of the difference.

| colour | Meaning |
|---|---|
| 🟢 **ok** | passes the newest edition we hold rules for |
| 🟡 **gap** | passes an older edition, **fails the current one** — fails today but passed when the older edition applied |
| 🔴 **danger** | fails even the **oldest** edition we hold, **or** fails the very edition it claims (`dhc:builtUnder`) to have been built to |
| ⬜ **unchecked** | no shape in any edition targets its class — nothing ever looked at it |

| opacity | Meaning |
|---|---|
| solid | the colour means what it says — we hold rules for the edition in force, or a `gap` is confirmed grandfathered by evidence |
| **ghosted** | the colour is provisional — we cannot speak to the edition in force (nothing targets this class, or its current edition has no shapes), **or** a `gap` whose grandfathering we cannot confirm |

Demo house: **11 ok · 1 gap · 1 danger · 72 unchecked**, most ghosted (85 nodes).
The focused `compliance-states.ttl` shows all states side by side.

**Colour and opacity are separate on purpose.** Colour is the rule-verdict.
Opacity is our confidence that the colour means what it says. Different claims —
"the rule says no" versus "we cannot stand behind this" — and this viewer
conflated them once, burying the actionable state under a field of things nobody
had checked. A node can be **green and ghosted** (NF C 14-100 nodes pass the 2008
rules we hold while 2021 is in force and unimplemented) or **yellow and ghosted**
(below).

### `gap` (yellow) — and why `dhc:builtUnder` is the difference between two of them

Yellow is the state most of a real building is in. A pool wired to an old
NF C 15-100 is legal and stays legal — until you add a circuit, at which point
the current edition applies to the work. Same for a Brussels house under an old
RGIE the moment you add PV. Not non-compliance: a known, dated delta, exactly
what an owner needs to see *before* commissioning work.

But "fails the current edition, passed an older one" is not automatically
grandfathered. A circuit installed **last week** in 10 mm² produces the identical
rule-verdict as a 2015 pool — and it is an illegal new install, not a lawful old
one. The rules cannot tell them apart; only *when it was built* can, and that is
what `dhc:builtUnder` optionally supplies:

| `dhc:builtUnder` present? | then a "fails-current" node is… |
|---|---|
| passes the edition it names | 🟡 solid — **grandfathered**, lawful as built. `ex:circuit-ev` (built 2015, passes 2015, fails 2024). |
| **fails** the edition it names | 🔴 **illegal as built** — the claim is false. `compliance-states.ttl`'s `ex:ev-illegal` (claims 2024, fails 2024). |
| absent (the normal survey case) | 🟡 **ghosted** — grandfathered and newly-illegal are indistinguishable, so neither is asserted. |

`dhc:builtUnder` is **optional evidence, never a verdict source.** An earlier
design made it the verdict and was reverted — it demanded a build edition a
survey rarely records. As evidence it is finally *checkable*: nothing before
verified that a thing declaring "built to 2015" actually passed 2015. Add it only
when the edition is genuinely known (a designed home); leave it off a
reverse-engineered one and accept the honest ghosted yellow.

**Transparent (unchecked) is the C-Box's problem, not the building's.** No shape
targets those classes, so nothing checked them. SHACL reports only failures, so
an unchecked node is silent for the same reason a *conforming* one is. Colouring
it green would be the vacuous-green mistake — a graph that "passes" only because
nothing was checked.

**Transparent is the C-Box's problem, not the building's.** No shape targets
those classes, so nothing checked them. SHACL reports only failures, which makes
an unchecked node silent for exactly the same reason a *conforming* one is.
Colouring it green would be the vacuous-green mistake — passing only for lack of
a rule. Note `ex:board-resi9` is ghosted *while declaring* `dhc:governedBy` — the norm
claims jurisdiction and our C-Box has no rule, which the inspector says in as
many words. That is the coverage gap (`doc/parking-lot.md` § 1) made visible.

### How editions compose

`dhc:shapesFile` on each `dhc:NormEdition` is the authority on which shapes
exist — **not** the directory listing, because a verdict has to be attributable
to an edition to mean anything. An edition's effective rule set is its own file
concatenated with every file down the `dhc:supersedes` chain:

```
effective(2024) = nfc15100-2024.shapes.ttl + nfc15100-2015.shapes.ttl
```

so `nfc15100-2024.shapes.ttl` carries only the **delta**. Concatenation ANDs
constraints: 2015 says ≥ 10 mm², 2024 says ≥ 16, both run, the stricter decides.

Two consequences worth knowing before touching this:

- **An edition can add or tighten, never loosen.** If a future edition ever
  relaxes a rule, this mechanism is the wrong one and must be replaced rather
  than worked around.
- **A delta must never reuse a base shape IRI.** Reuse it and RDF merges both
  definitions onto one subject, so "does it pass 2015?" can no longer be asked —
  nothing errors, the graph is valid, the comparison just quietly answers
  something else. `tests/cbox/guards.test.js` enforces the disjointness.

The build **fails** if a `dhc:shapesFile` names a missing file, or if a
`*.shapes.ttl` on disk is claimed by no edition — the latter would otherwise
stop running silently, and SHACL's answer to "nothing ran" is `conforms: true`.

> ⚠ **The NF C 15-100:2024 rules are illustrative, not law.** Nobody has read
> the published text. They are plausible stand-ins so the machinery has
> something real to compute, marked `UNVERIFIED` on the file header and on every
> shape. Do not quote them.

## How it is built

```
scripts/preview-abox.sh
  └─ node js-tools/build-abox.mjs schema/abox/<file>.ttl
        reads   schema/abox/<file>.ttl
                schema/tbox/{dhc-core,dhc-app-metadata}.ttl   (designView + the edition chain)
                schema/cbox/electrical/*.shapes.ttl           ← via dhc:shapesFile, NOT readdir
                schema/tbox/Brick+extensions.ttl              (equipment closure — ~1s)
        runs    one SHACL pass PER EDITION, oldest → newest
        reuses  tests/_helpers/loadGraph.js                    ← the test suite's own validator
        writes  js-tools/data/{graph,report}.json              (gitignored)
                js-tools/data/vocab.json                        (one per build: dhc-core + overlay, for the modelling catalog)
  └─ python3 ThreadingTCPServer  →  abox-viewer.html
```

### Why a Node build step rather than parsing in the page

SHACL cannot run in the browser here: `rdf-validate-shacl` depends on
`@zazuko/env-node`, which is Node-only. Validating in Node means the viewer
reuses **`tests/_helpers/loadGraph.js` — the exact code behind the passing test
suite** — so what you see and what `npm test` says cannot disagree. It also
means the page fetches only JSON and needs no RDF library at all.

### Why it is genuinely offline

Two files are committed, and the second one needs explaining:

- `vendor/3d-force-graph.min.js` (1.2 MB, v1.79.1) — its UMD build is
  self-contained: `ForceGraph3D` global, three.js inlined.
- `vendor/three.module.min.js` (691 KB, r170) — **a second copy of three**, on
  purpose. The UMD bundle inlines three r180 but exports *only* `ForceGraph3D`,
  so there is no way to reach a geometry constructor through it — and box nodes
  and block particles need one. (`three@0.170` ships no classic UMD build, only
  ESM/webgpu, so this half has to be a module. Classic scripts run before
  deferred module scripts, so `ForceGraph3D` is already global when it loads.)

Two three instances, ten revisions apart, is normally a warning sign. It works
here for a documented reason rather than by luck: three identifies types with
duck-typing flags (`isObject3D`, `isMesh`, `isBufferGeometry`) and
`material.type` strings, never `instanceof`, precisely so foreign objects
interoperate — an r170 `Mesh` renders fine under the r180 renderer. Confirmed on
screen before shipping, not assumed.

To refresh either:

```bash
cp ../modeler/node_modules/3d-force-graph/dist/3d-force-graph.min.js js-tools/vendor/
cp ../modeler/node_modules/three/build/three.module.min.js          js-tools/vendor/
```

This is a deliberate departure from the Blockly harnesses this tool is modelled
on. **They are not offline**, despite the name: `blockly/preview.html` and
`experimental/blockly/1-spatial/` both load Blockly from `unpkg.com` and fail
without internet; `2-factory` pulls Google Fonts. There is even a vendored
`blockly.min.js` in `experimental/blockly/` that nothing important uses — a
different major version from the CDN one the demo actually loads. Here, zero
`https://` appears anywhere in `abox-viewer.html`; verify with:

```bash
grep -c "https://" js-tools/abox-viewer.html      # → 0
```

To refresh the vendored library:

```bash
cp ../modeler/node_modules/3d-force-graph/dist/3d-force-graph.min.js js-tools/vendor/
```

## Why this is not the Modeler's viewer

The Modeler renders the **T-Box** — ~48 classes and their properties. It cannot
be pointed at an A-Box, for two structural reasons: its links come from
class-level schema (`rdfs:domain` → `rdfs:range` on `dhc:` object properties),
never from instance triples; and its parser filters every subject through
`startsWith("https://digitalhome.cloud/ontology#")`, which discards `ex:`,
`brick:`, `rec:` and `s223:` outright.

So `build-abox.mjs` is a parallel generator, not a patch. It keys nodes on the
full IRI, walks the store for instance triples, and applies no namespace filter.
The renderer is the same underlying library the Modeler uses
(`react-force-graph-3d` wraps `3d-force-graph`), and the palette is shared — so
the two look like relatives, as they should.

## Conventions

- **Blank nodes are inlined, not drawn.** The A-Box uses them for Brick entity
  properties (`brick:tilt [ brick:hasUnit unit:DEG ; brick:value "30" ]`); as
  nodes they would be ~30 unlabelled dots. They appear as `key=value` text in
  the inspector instead.
- **Literals are inspector fields**, never nodes.
- **IRIs outside the A-Box** (a `dhc:Norm`, a `dhc:NormEdition`, a `unit:`, an
  `s223:` medium) are attributes of the node that references them, not topology
  edges. Only A-Box-to-A-Box references become links.
- **Repeated predicates accumulate.** `ex:gtl` is `dhc:governedBy` two norms.
  Assigning would keep only the last — silently, while the inspector looked
  complete.
- **`Brick+extensions.ttl` IS loaded**, for the equipment closure only (~1s of
  the build). It is not needed for colouring — `dhc-app-metadata.ttl` carries
  `designView` for Brick classes — but node *shape* is derived from
  `rdfs:subClassOf*`, and that hierarchy only exists upstream.

## The build fails loudly rather than looking fine

A graph with no nodes or no links renders as a clean, plausible, empty canvas —
and the viewer says `conforms: true` because SHACL selected nothing. That is the
silent-green failure this repo has produced repeatedly. `build-abox.mjs` exits
non-zero instead, and the page says so in red rather than looking fine. Same for
a `dhc:shapesFile` naming a
file that does not exist, a shapes file no edition claims, and a T-Box with no
`dhc:latestEdition`.

### The bar for `electrical-installation-house.ttl`

Two numbers, not one — a single "N violations" is ambiguous once more than one
edition is checked, and the two mean opposite things:

| Against | Expected | Because |
|---|---|---|
| **:2015** (superseded) | exactly **1** — `ex:circuit-ev-legacy` / `nfc15100:IRVE32AMonoShape` | the deliberate defect. **If this stops being reported the chain is broken — do not "fix" it by correcting the cross-section.** |
| **:2024** (in force) | **`ex:circuit-ev` must be reported** | otherwise the delta is a no-op, yellow never appears, and the whole edition mechanism reports success while proving nothing |

**`conforms` means "no node is `danger`"** — not SHACL's per-run boolean. That
distinction is load-bearing in both directions. OR-ing the runs together could
never be falsified by NF C 14-100 (its edition in force has no shapes, so no
14-100 run is ever the latest one, so a failing meter still left `conforms:
true`), and it *was* falsified by `ex:circuit-ev` — which fails :2024 **by
design**, being grandfathered. That welded `conforms` to false and killed the
"if this file ever conforms, the chain is broken" tripwire: it could no longer
conform for the right reason. An alarm that cannot stop ringing is not an alarm.

`tests/tbox/norm-editions.test.js` asserts both rows against the built graph,
plus that the model exercises `ok` **and** `gap` **and** `danger`. Those tests
used to be written with `it.runIf(built)` — and since `js-tools/data/` is
gitignored and `npm test` did not build it, they **silently skipped** on a fresh
clone. The guards against vacuous success were themselves vacuous. `npm test`
now runs `build:abox` first and the tests fail loudly if the artifact is missing
or older than the A-Box.

To check the delta by hand: raise `ex:circuit-ev`'s `dhc:crossSection` to `16.0`
and rebuild — it must turn **green**. If it stays yellow, the 2024 shapes are
not firing.
