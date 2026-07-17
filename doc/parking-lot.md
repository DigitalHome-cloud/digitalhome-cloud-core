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
`npm run build:abox` — visible as a sea of yellow in the viewer's **compliance**
mode:

```
ok 11   ·   gap 33   ·   danger 1        (45 nodes)
```

**"gap" means no shape targets that class — nothing ever checked it.** It is
not a pass. SHACL reports only failures, so an unchecked node is silent for
exactly the same reason a conforming one is.

The C-Box targets six classes:
`dhc:Circuit`, `dhc:ElectricalTechnicalSpace`, `dhc:EmergencyDisconnect`,
`dhc:EnergyDelivery`, `dhc:EnergyMeter`, `dhc:RCD`.

Everything else is unvalidated. What that leaves untouched:

| Count | Class | Why it matters |
|---|---|---|
| 7 | `dhc:ProtectionDevice` | the breakers — NF C 15-100 is largely *about* protection sizing |
| 4 | `dhc:WiringSegment` | the cables — cross-section is the other half of the norm |
| 2 | `dhc:Socket` | socket counts/types per room are norm-governed |
| 1 | `dhc:DistributionBoard` | the Resi9 board itself; referenced by `GTLShape` via `sh:class` but never a `sh:targetClass` |
| 1 | `dhc:BusBar` | — |
| 10 | `brick:*` equipment | PV array/panel/system, inverter, luminaires, EVSE, controller |
| 3 | `rec:Room` | — |
| 3 | `s223:*ConnectionPoint` | the 223P topology is structurally checked by 223P's own shapes, not ours |

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
is unproven, which is exactly how three shapes stayed dead
(`doc/prototyping-poc.md`).

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

## 2. Known gaps owned elsewhere — do not restate here

- **No shapes for `NormEdition_NFC15100_2024`** although it is
  `dhc:latestEdition`; compliance is validated against 2015-A5 →
  `doc/adr-0001-ontology-tooling.md`, enforced by `tests/cbox/guards.test.js`.
- **`nfc14100` shapes carry no P3 guard** — they fire on every instance of their
  target class → skill § Known gaps.
- **Norm profiles are country-scoped only by which shapes file you load**;
  nothing guards on `dhc:governedBy` → skill § Known gaps.
- **Inference (`sh:rule`) is unavailable in the JS stack** — 7,381 Brick
  `sh:TripleRule` cannot fire; the answer is a build-time
  `brick_tq_shacl.infer` step, not a validator swap →
  `doc/adr-0001-ontology-tooling.md` § 5.

## 3. Smaller

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
