# Core — parking lot

Known work in `repos/core`, not scheduled. Modeler-side items live in
`repos/modeler/PARKING-LOT.md`.

Items already owned by a doc are **linked, not repeated** —
`doc/adr-0001-ontology-tooling.md` § Consequences and the
`dhc-electrical-installation-design` skill § Known gaps both carry their own
lists, and duplicating them here would be the double-maintenance this repo keeps
paying for.

---

## 1. The C-Box checks a quarter of the model (A-Box coverage gap)

Measured on `schema/abox/electrical-installation-house.ttl` via
`npm run build:abox` — visible as the field of ghosted nodes in the viewer's
**compliance** mode:

```
ok 11   ·   gap 1   ·   danger 1   ·   unchecked 67        (80 nodes)
```

**`unchecked` (67) is this item**: no shape targets those classes, so nothing
ever looked at them. It is not a pass. SHACL reports only failures, so an
unchecked node is silent for exactly the same reason a conforming one is.

The count grew from 33/45 when the A-Box gained its full energy flow — the
conductor-level chain to the EV and washing machine is ~35 new wiring segments
and connection points, none of which any shape looks at. The *ratio* barely
moved. Modelling more of the building did not make the C-Box cover more of it.

Do not confuse it with **`gap`**, which is a different thing entirely and not a
defect in the C-Box: those nodes *were* checked and *passed* an older edition,
and fail the current one — lawful as built, re-qualified the moment anyone
touches them. That is a fact about the building. `unchecked` is a fact about us.
The viewer conflated the two until the two-channel model landed; see
`js-tools/README.md` § Compliance.

The C-Box targets seven classes:
`brick:Battery` (2024 only), `dhc:Circuit`, `dhc:ElectricalTechnicalSpace`,
`dhc:EmergencyDisconnect`, `dhc:EnergyDelivery`, `dhc:EnergyMeter`, `dhc:RCD`.

Everything else is unvalidated. What that leaves untouched:

| Count | Class | Why it matters |
|---|---|---|
| 20 | `dhc:WiringSegment` | the cables — cross-section is half of what the norm is about |
| 7 | `dhc:ProtectionDevice` | the breakers — NF C 15-100 is largely *about* protection sizing |
| 21 | `s223:*ConnectionPoint` | inlet/outlet/bidirectional; 223P's own shapes check this structurally, not ours |
| 2 | `dhc:Socket` | socket counts/types per room are norm-governed |
| 1 | `dhc:DistributionBoard` | the Resi9 board; referenced by `GTLShape` via `sh:class` but never a `sh:targetClass` |
| 1 | `dhc:BusBar` | — |
| 2 | inverter (`brick:Photovoltaic_Inverter` + `s223:ElectricEnergyInverter`) | the Deye — see § 1d |
| 8 | other `brick:` equipment | PV array/panel/system, luminaires, EVSEs, controller |
| 3 | `rec:Room` | — |
| 1 | `s223:ClothesWasher` | — |

### The sharpest instance: intent is never compared to fact

The design deliberately carries **both**:

```turtle
ex:circuit-lgt-lr a dhc:Circuit ;
    dhc:ratedCurrent "10"^^xsd:decimal .        # design intent — what the C-Box reads
ex:brk-lgt-lr a dhc:ProtectionDevice ;
    brick:ratedCurrentOutput [ brick:value "10"^^xsd:decimal ] .   # device fact
```

`grep -rn "ratedCurrentOutput" schema/cbox/` returns **nothing**. The two must
agree, and no rule says so. A circuit declaring 10 A protected by a breaker
rated 32 A conforms today. Same for `dhc:crossSection` on the circuit vs on the
`dhc:WiringSegment` it names via `dhc:hasWiring`.

### Shapes worth authoring

Each needs a **valid *and* invalid fixture** — a shape without a failing fixture
is unproven, which is exactly how three shapes stayed dead (`IRVE32AMonoShape`,
`IRVE32ATriShape`, the BS 7671 ring-final shape; see the electrical-installation
skill § the mandatory negative fixture).

- `ProtectionDeviceShape` — declares `dhc:ratedCurrent`; standard rating
  (6/10/16/20/25/32/40/63 A).
- `CircuitProtectionAgreementShape` — the circuit's `dhc:ratedCurrent` equals
  its `dhc:hasProtection`'s. Sequence path
  `( dhc:hasProtection brick:ratedCurrentOutput brick:value )`; mind the
  datatype rule — `guards.test.js` enforces it.
- `WiringSegmentShape` — `dhc:crossSection` present and a standard section
  (1.5/2.5/4/6/10/16 mm²); agrees with the circuit's.
- `DistributionBoardShape` — sits in an `ElectricalTechnicalSpace`, has ≥1
  `dhc:RCD`, and every `brick:hasPart` breaker belongs to a circuit.
- `SocketShape` / room-level socket counts — NF C 15-100 minimum socket counts
  per room type. Needs `rec:Room` subtypes first.

Note the honest ceiling: **shapes can only check what the A-Box asserts.**
Several NF C 15-100 rules (bathroom zones, minimum circuit counts per dwelling
area) need spatial data the model does not yet carry.

## 1b. ~~No shapes for the current edition~~ — DONE for NF C 15-100, open for NF C 14-100

**Resolved for NF C 15-100.** `nfc15100-2024.shapes.ttl` now exists,
`dhc:NormEdition_NFC15100_2024` declares it, and compliance is computed by
validating against each edition and comparing verdicts. Green means "passes the
edition in force". `dhc:builtUnder` was purged as a verdict source and re-added
as optional *evidence*: it separates a confirmed-grandfathered `gap` (solid)
from an illegal-as-built `danger` and from an unconfirmed `gap` (ghosted) — see
`js-tools/README.md` § gap, and the worked `schema/abox/compliance-states.ttl`.
`ex:circuit-ev` is the grandfathering case, now with its 2015 evidence.

**But the 2024 rules are ILLUSTRATIVE.** Nobody has read the published NF C
15-100:2024 text. Two plausible stand-ins are encoded — an IRVE cross-section
tightening (10 → 16 mm²) and energy storage coming into scope — marked
`UNVERIFIED` on the file header and every shape. **Replacing them with the real
text is the outstanding work**; the shape IRIs, tests and wiring survive the
swap, only the numbers change.

**Still open: NF C 14-100 has no shapes for the edition in force.**
`dhc:NormEdition_NFC14100_2008` now exists and claims the shapes file (which
closes the old mismatch — the manifest said `normVersion 2008` while the only
declared edition was 2021, invisible to every test). But 2021 is
`dhc:latestEdition` and implements nothing, so `ex:delivery`, `ex:meter` and
`ex:agcp` render **green-but-ghosted**: they pass the 2008 rules we hold, and we
cannot speak to 2021. `tests/tbox/norm-editions.test.js` pins that as an explicit
expected exception (`toEqual(['dhc:Norm_NFC14100'])`) so it cannot quietly spread
to another norm. Authoring `nfc14100-2021.shapes.ttl` as a delta is the fix.

## 1c. Editions compose by concatenation — which cannot express a loosening

`effective(E) = shapesFile(E) + effective(supersedes(E))`. Concatenation **ANDs**
constraints, so an edition may add or tighten and the stricter rule decides.
That covers what norm editions actually do, and it avoids duplicating ~640 lines
per edition, which would drift.

It has no way to express an edition **relaxing** a rule. If one ever does, this
mechanism is wrong and must be replaced — not worked around by deleting the base
constraint, which would silently rewrite history for every model validated
against the older edition.

Related, and enforced by `tests/cbox/guards.test.js`: a delta must never reuse a
base shape IRI. Reuse merges both editions' constraints onto one subject, so
"does it pass 2015?" can no longer be asked. Nothing errors — the graph is valid
and the comparison just answers a different question.

## 1d. Nothing checks that a source can carry its load

`ex:inverter` (Deye, 6 kW) sits between a 63 A / 9 kVA AGCP and the whole
distribution board, which hangs off its single outbound port. That is how the
A-Box models it, deliberately and per the owner's description — and no shape
looks at it, because none targets `brick:Photovoltaic_Inverter` /
`s223:ElectricEnergyInverter` at all (the node is `unchecked`).

A real rule would be something like: an inverter feeding a `dhc:DistributionBoard`
must have `brick:ratedPowerOutput` ≥ the upstream `dhc:EmergencyDisconnect`'s
`dhc:ratedCurrent` × supply voltage, **or** the board must be split into a
backup sub-board. This is the same shape of gap as § 1's "intent is never
compared to fact": the numbers are all in the model and nothing relates them.

## 2. Known gaps owned elsewhere — do not restate here
- **`nfc14100` shapes carry no P3 guard** — they fire on every instance of their
  target class → skill § Known gaps.
- **Norm profiles are country-scoped only by which shapes file you load**;
  nothing guards on `dhc:governedBy` → skill § Known gaps.
- **Inference (`sh:rule`) is unavailable in the JS stack** — 7,381 Brick
  `sh:TripleRule` cannot fire; the answer is a build-time
  `brick_tq_shacl.infer` step, not a validator swap →
  `doc/adr-0001-ontology-tooling.md` § 5.

## 3. Smaller

- **`ex:washing-machine` has no water outlet.** It is typed
  `brick:Equipment, s223:ClothesWasher`; 223P's `ClothesWasher` shape requires at
  least one outlet on medium `Fluid-Water` — the drain. Unsatisfied, and nothing
  reports it: `build-abox.mjs` parses `Brick+extensions.ttl` only for the
  equipment closure and never runs its ~3237 shapes. Modelling the drain means
  starting a plumbing domain, which is not a thing to do to satisfy a class
  axiom. Two honest options when it matters: run the upstream 223P shapes as a
  separate structural check (skill § Verification protocol step 7 already
  describes this and nothing does it), or drop back to `brick:Equipment`.
  Note the Brick type must stay either way — `dhc:powerRating` has
  `rdfs:domain brick:Equipment`, so retyping to 223P alone silently violates it.
- **`brick:Inverter` ships with `rdfs:label "claude_to_do"@fr`** in
  `schema/tbox/dhc-app-metadata.ttl` — a placeholder translation in a committed
  T-Box file. Fix via `ontology_explorer.py`'s interactive annotation review;
  adding or changing an annotation is deliberately a human call, so the
  `--promote` flag will not do it.
- **`withTbox()` is cited at a path where it does not exist.** `CLAUDE.md`
  § SHACL activation pattern and `build-abox.mjs` both say it lives in
  `tests/_helpers/loadGraph.js`. It does not — each test file defines its own
  one-liner (`const withTbox = (f) => tboxTtl + '\n' + f`). Either export it or
  fix both references.
- **`tests/tbox/roles.test.js` passes.** `CLAUDE.md` § Commands and § Test
  protocol both say it fails until the role catalog is promoted out of
  `schema/draft/`, and that the failure is intentional. It is green. Whichever
  is stale — the doc or the test's coverage — the "expected failure" note is
  now actively misleading.

- **C-Box is France-only by design** (v3.0.0). DIN VDE 0100 / AREI-RGIE /
  BS 7671 return once the core is released — all four artifacts together
  (shapes, manifest entry, `dhc:Norm`, tests + fixture pair). See `CLAUDE.md`
  § "The C-Box is France-only, deliberately". **Not** a tidy-up task.
- **The single-line diagram is unported.**
  `experimental/dhc-modelling/py-tools/02-brick-pipeline.py` still reads the
  fabricated namespaces and `brick:Loop`, and its `../schema/` copy is deleted.
  `js-tools/` now renders the graph; a printable single-line drawing is a
  different artifact and still missing.
- **`schema/draft/` is untracked** — the remaining ~54 draft classes exist only
  on disk, with no git history. Losing that directory loses them.

## 4. Electrical Blockly designer — the model changes it assumes

The `blockly/` electrical harness (`blockly/electrical-*.json`) authors an
installation structure whose root is `dhc:PowerDistributionSystem` with
source / route / sink slots. Two T-Box changes are **assumed by the block
templates but not yet made** — the harness runs on static JSON without them; only
the future **blockly→abox translator** needs them, so they are parked here rather
than promoted now.

- **`dhc:PowerDistributionSystem` does not exist.** Intended
  `rdfs:subClassOf brick:System`, so its source/route/sink members translate to
  `brick:hasPart` / `brick:isPartOf` edges of the system. Promote via
  `py-tools/ontology_explorer.py` with the `electrical` `dhc:designView` +
  `@de`/`@fr` overlay (`tests/tbox/annotation-coverage.test.js` gates it). **Open
  design question**: how it relates to the existing `dhc:DigitalHome → building →
  dhc:Circuit` spine and to `dhc:DistributionBoard` — is the PDS a sibling system
  that *references* the board, or a container that *holds* the electrical spine?
  Resolve before the translator, not before the harness.

- **`dhc:SubDistributionBoard` does not exist.** The harness has two board
  blocks — a main board (`dhc:DistributionBoard`, exists) placed in the routing
  sub-system, and a secondary board placed as a downstream sink. The secondary
  block's type/template is `dhc:SubDistributionBoard`, intended
  `rdfs:subClassOf dhc:DistributionBoard`. Promote it with the same electrical
  overlay, or (simpler) drop the block and express "secondary" with a role field
  on `dhc:DistributionBoard` — decide alongside the PDS relationship above. The
  board blocks' **rows = DIN rails** are a UI grouping with no ontology term yet;
  on translation a rail is most naturally a `brick:hasPart` bag of the modules it
  carries, not a class of its own.

- **`dhc:neutralSystem` is domained to `dhc:EnergyDelivery`** (`dhc-core.ttl`).
  The root block puts the *régime de neutre* dropdown on the PDS. Asserting
  `dhc:neutralSystem` on a `dhc:PowerDistributionSystem` would, under RDFS, infer
  that the PDS is also an `EnergyDelivery` — wrong. Either **drop the
  `rdfs:domain`** (as `dhc:ratedCurrent` and `dhc:crossSection` already do,
  deliberately, for exactly this reason) or move it to the PDS. Separately, the
  value set **TT / TN-S / TN-C / IT** currently lives only in the property's
  `rdfs:comment` as a free `xsd:string`; formalizing it with `sh:in` would let the
  C-Box check it and keep the Blockly dropdown and the ontology in lockstep.

- **`dhc:Appliance` does not exist.** The generic consumer block (washing
  machine / dishwasher / oven / water heater / dryer via an `applianceType`
  dropdown) uses type/template `dhc:Appliance`, intended `⊑ brick:Equipment`. Two
  honest options: promote it, or drop it and map each `applianceType` value to its
  specific Brick/223P class (`s223:ClothesWasher`, `s223:Dishwasher`, an oven
  class, …) in the translator. Note `dhc:powerRating` has `rdfs:domain
  brick:Equipment`, so whatever type is emitted must be a `brick:Equipment`.

- **No breaker *curve* property (B/C/D).** The circuit block omits it because
  `dhc-core` has none. If curve selectivity ever matters to a norm rule, add e.g.
  `dhc:breakerCurve` (enum B/C/D) alongside `dhc:ratedCurrent`.

- **The blockly→abox translator (the big parked item).** The complete toolbox
  authors everything a residential A-Box needs, but nothing yet turns the
  workspace JSON into TTL. The Designer's `src/blockly/aboxSerializer.js` already
  maps the predicate vocabulary (`hasProtection`, `hasWiring`, `feedsEquipment`,
  `hasCircuitType`, `hasPart`, `feeds`) and is the natural starting point. The
  electrical harness adds a **variable-linking** contract the translator must
  honour:
  - Each `dhc:Circuit` block → a `dhc:Circuit` with `dhc:hasCircuitType` /
    `ratedCurrent` / `crossSection` / `phase` / `maxPoints` / `dedicated`;
    `dhc:hasProtection` → a `dhc:ProtectionDevice` (or `dhc:RCBO`) at the same
    `dhc:ratedCurrent` (+ a `dhc:RCD` with `rcdType` / `sensitivityMA` when
    differential); `dhc:hasWiring` → L/N/PE `dhc:WiringSegment`s at `crossSection`
    (inferred — the harness deliberately does not draw individual conductors).
  - Each load's **`FED_BY`** variable is paired with the matching circuit's
    **`CIRCUIT_VAR`**; emit the load as that circuit's `dhc:feedsEquipment` /
    `brick:feeds` target.
  - **Referential-integrity validation**: every referenced circuit token has
    **exactly one** defining `dhc:Circuit` block. Flag **dangling** references
    (a load protected by an undefined line) and **duplicate** definitions (two
    circuits binding one token). This check is the price of trading structural
    nesting for reference tokens, and it is exactly the kind of pre-flight the
    C-Box cannot do (it validates the emitted A-Box, not the Blockly graph).

- **Offline vendoring is deferred.** The harness loads Blockly from
  `unpkg.com` (a deliberate, user-approved shortcut), so it breaks the `js-tools`
  `grep -c https:// = 0` invariant and needs a network. Vendoring a local
  `blockly.min.js` (12.5.1 is already on disk in the Designer/Modeler
  `node_modules`, but the harness targets the Blockly-11 API, so a compat pass is
  part of the job) is the fix when the harness needs to run air-gapped.
