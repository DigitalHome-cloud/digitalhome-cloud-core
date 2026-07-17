# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

`@dhc/digitalhome-cloud-core` is the **schema-only** source of truth for the
DigitalHome.Cloud platform. v2.0.0 adopted the **Multi-Box Model**
(DH-SPEC-200); **v3.0.0** rebased the T-Box on Brick 1.5 + REC + ASHRAE 223P and
split it into a domain layer and a UI overlay (`SPEC-V3-Redesign.md`):

| Box   | Content                                                | Location in repo                 |
|-------|--------------------------------------------------------|----------------------------------|
| T-Box | Domain vocabulary (classes, properties, R-Box axioms, enum instances) | `schema/tbox/*.ttl` |
| C-Box | Norm profiles as SHACL shapes — one file per national standard        | `schema/cbox/<domain>/*.shapes.ttl` |
| A-Box | Instance data per Digital Home                         | Tenant data and the apps' demo homes are **not in this repo** (Designer-created, S3-stored). `schema/abox/` holds prototype / POC / example models only. |

The v3 layering, from the human/spatial level down to the physics:

- **REC** — spatial & administrative context (Site, Building, Room, Agent).
- **Brick 1.5** — equipment and points (what a device *is*, what it reports).
- **ASHRAE 223P** — connectivity topology (ConnectionPoints, Connections, media)
  — how things are physically wired and what flows through them.
- **`dhc:`** — gap filling *only*: what the three standards do not define.

No build scripts, no generated artifacts — just schema and tests. Downstream
apps (Modeler, Designer) parse these files directly at build or runtime.

> **This repo also hosts the platform's AWS Amplify Gen 2 backend** under
> `amplify/` (see next section). That is the *only* non-schema concern living
> here — it was moved out of the umbrella so there is exactly one `amplify/`
> level per repo.

## Amplify Gen 2 Backend

This repo owns the single platform backend (Cognito, AppSync/GraphQL,
DynamoDB, S3, Lambdas), defined in TypeScript under `amplify/`
(`backend.ts`, `auth/resource.ts`, `data/resource.ts`, `storage/resource.ts`,
`functions/*/`). It was moved here from the umbrella root because having an
`amplify/` directory at the umbrella *and* a submodule that Amplify Hosting
builds caused "amplify on two levels of a repo" conflicts.

Portal, Designer, and Modeler are **frontend-only consumers** — each commits
its own `src/amplify_outputs.json` (public Cognito/AppSync/S3 IDs).

```bash
# Local sandbox (one stack per developer) — run from THIS repo:
cd ~/digitalhomeCloud/digitalhome-cloud-darkfactory/repos/core
npm install
npx ampx sandbox                 # foreground watch; --once for one-shot
# propagate the regenerated outputs into each app:
cp amplify_outputs.json ../portal/src/
cp amplify_outputs.json ../designer/src/
cp amplify_outputs.json ../modeler/src/
```

- **CI/CD:** `amplify.yml` (this repo) runs `npm install` then
  `npx ampx pipeline-deploy --branch $AWS_BRANCH` on push — this is a
  backend-only Amplify Hosting app (the `frontend` phase only emits a stub
  `index.html`). Each frontend app's own `amplify.yml` pulls the deployed
  outputs via `npx ampx generate outputs --branch … --app-id …`.
- `npm install` (not `npm ci`) because this `package.json` serves both the
  ontology test harness *and* the Amplify backend, and the committed
  `package-lock.json` is not regenerated on every dependency change.
- **Stage is live:** branch `stage` → stage backend, consumed by the stage
  Designer (operational). Portal/Modeler outputs still point at the previous
  pool — re-point pending.
- For authoring patterns, sandbox workflow, and CDK escape hatches see the
  umbrella's `dhc-amplify-gen2` skill
  (`.claude/skills/dhc-amplify-gen2/SKILL.md`).
- `amplify_outputs.json`, `amplify_outputs.d.ts`, `.amplify/` are gitignored
  (per-developer sandbox state).

## Repository Layout

```
schema/
  tbox/
    Brick+extensions.ttl      ← Read-only baseline: Brick 1.5 + REC + ASHRAE 223P
    dhc-core.ttl              ← Classes, properties, R-Box axioms, enum instances (@en only)
    dhc-app-metadata.ttl      ← UI/UX overlay: designView, blockly*, @de/@fr labels
  draft/
    dhc-core.ttl              ← Staging for in-progress domain triples (gitignored)
    dhc-app-metadata.ttl      ← Staging for in-progress annotations (gitignored)
  cbox/
    cbox-manifest.json        ← Registry of published norm profiles — one per EDITION
    electrical/
      nfc14100-2008.shapes.ttl  ← NF C 14-100:2008 (FR — energy delivery)
      nfc15100-2015.shapes.ttl  ← NF C 15-100:2015 (FR — installation) — the base
      nfc15100-2024.shapes.ttl  ← NF C 15-100:2024 — DELTA over 2015; ⚠ illustrative rules
  abox/
    electrical-installation-house.ttl   ← Prototype / POC / example models (see below)
py-tools/
  ontology_explorer.py        ← The ONLY sanctioned writer for tbox/dhc-*.ttl
tests/
  _helpers/loadGraph.js       ← Shared n3/SHACL test utilities
  tbox/                       ← T-Box structural tests
  cbox/                       ← C-Box parse + conformance tests per norm
  fixtures/                   ← Valid/invalid A-Box fragments used by tests
```

> `dhc-core.schema.ttl`, `dhc-roles.ttl` and `context.jsonld` were removed in the
> v3 restructure (commit `5d76452`). The role catalog now lives in
> `schema/draft/dhc-core.ttl` awaiting promotion. This file used to say
> `tests/tbox/roles.test.js` fails until it is promoted and that the failure is
> intentional — **it passes**. Whether the test lost its teeth or the roles
> landed is unresolved; see `doc/parking-lot.md` § 3. Do not treat any failing
> test here as expected.

## Commands

```bash
npm install        # once
npm test           # vitest run — all T-Box + C-Box tests
npm run test:watch # iterative authoring
```

There is no `yarn build`, no `publish-ontology`, no codegen in this repo. Block
generation and ontology-graph assembly live in the Modeler.

## Conventions

### Naming

| Kind                        | Pattern                       | Example                          |
|-----------------------------|-------------------------------|----------------------------------|
| T-Box class                 | PascalCase                    | `dhc:DistributionBoard`          |
| T-Box property              | camelCase                     | `dhc:hasCircuit`                 |
| T-Box enum instance         | `{ClassName}_{Value}`         | `dhc:CircuitType_Lighting`       |
| Norm instance               | `Norm_{id uppercased}`        | `dhc:Norm_NFC15100`              |
| Norm edition instance       | `NormEdition_{id upper}_{year}` | `dhc:NormEdition_NFC15100_2024` |
| C-Box shape                 | `{Concept}Shape`              | `nfc15100:LightingCircuitShape`  |
| C-Box file                  | `{norm-id}-{year}.shapes.ttl` | `schema/cbox/electrical/nfc15100-2015.shapes.ttl` |
| C-Box namespace             | one per **edition** past the base | `https://digitalhome.cloud/cbox/nfc15100-2024#` |

### Required annotations

The v3 four-file split (see `SPEC-V3-Redesign.md`) decides *which file* each
triple lands in. The `ontology_explorer.py` splitter enforces it; the rules
below are asserted by `tests/tbox/core-schema.test.js`.

- **Trilingual labels**: every class, property, enum instance, norm, and SHACL
  shape message is labelled in `@en`, `@de`, `@fr` — but **split by file**:
  `@en` lives in `dhc-core.ttl`, `@de`/`@fr` in `dhc-app-metadata.ttl`.
  C-Box `sh:message` carries all three inline (the C-Box is not split).
- **Design view**: every T-Box class and property carries a `dhc:designView`
  value **in `dhc-app-metadata.ttl`** — never in `dhc-core.ttl`.
  `compliance` is reserved for `dhc:Norm`.
- **Gap-filling only**: `dhc:` defines what Brick, REC and 223P do not. Do not
  shadow an upstream predicate (`brick:feeds`, `rec:locatedIn`, `s223:contains`)
  with a same-named `dhc:` duplicate.
- **Anchor to real upstream classes**: a `dhc:` class that specializes an
  upstream one must name a parent that actually exists. `rdfs:subClassOf`
  pointing at an undefined URI is silently accepted by RDF and inherits
  nothing — the draft once named `s223:ElectricBreaker`, `s223:ElectricOutlet`
  and `s223:ElectricWire`, none of which exist (the real names are
  `s223:ElectricityBreaker`, `s223:ElectricityOutlet`, and — for a conductor —
  `s223:Connection`; there is no `s223:Wire`). `core-schema.test.js` guards this.

### Versioning

- `owl:versionInfo` in `dhc-core.ttl` and `version` in `package.json`
  move together. Both are `3.0.0`.
- T-Box breaking changes → major bump (new `vX.0.0` branch, never merged
  directly to `main`/`stage` until the whole platform cuts over).
- T-Box additive changes → minor bump.
- C-Box revisions → patch or minor per the norm profile's own version field in
  `cbox-manifest.json`.

## SHACL activation pattern (P3 `sh:or` guard)

C-Box shapes must only fire when their guard condition matches. `sh:condition`
on a NodeShape is non-standard and was shown not to fire in
`rdf-validate-shacl@0.6.0`; `sh:SPARQLTarget` was likewise unreliable in the
spike. The pattern that works across our validator stack is **P3 — `sh:or`
guard**:

```turtle
nfc15100:LightingCircuitShape
  a sh:NodeShape ;
  sh:targetClass dhc:Circuit ;
  dhc:normId "nfc15100" ;
  sh:or (
    # Guard: shape is a no-op unless the circuit is a Lighting circuit
    [ sh:not [ sh:property [
        sh:path dhc:hasCircuitType ; sh:hasValue dhc:CircuitType_Lighting ] ] ]
    # Real constraints, gathered in one branch
    [ sh:property [ sh:path dhc:maxPoints   ; sh:maxInclusive 8 ;   ... ] ;
      sh:property [ sh:path dhc:ratedCurrent; sh:maxInclusive 16 ;  ... ] ;
      sh:property [ sh:path dhc:crossSection; sh:minInclusive 1.5 ; ... ] ]
  ) .
```

Consequences to remember when writing tests:

- When an `sh:or` fails, the validator reports only the **outer** shape
  violation — the per-branch `sh:message` values are not surfaced. Tests assert
  on `result.sourceShape` (e.g. `/LightingCircuitShape/`), not on `message`.
- **The mirror case:** a plain `sh:property` shape (no `sh:or` guard, e.g.
  `nfc15100:RCDSensitivityShape`) reports the inner **blank node** as
  `sourceShape` — but *does* surface `sh:path` and `sh:message`. So the
  assertion target flips:

  | Shape form | `sourceShape` | `path` / `message` | Assert on |
  |---|---|---|---|
  | `sh:or` guarded | named shape | absent | `sourceShape` |
  | plain `sh:property` | blank node (`b280`) | present | `path` |

- **A guard literal's datatype must match the property's `rdfs:range`.**
  `sh:hasValue` compares RDF *terms*: `sh:hasValue 32` is `xsd:integer` and
  will never match a `dhc:ratedCurrent` of `"32"^^xsd:decimal`, so the guard
  never fires, the `sh:or` is always satisfied, and the shape becomes a
  permanent no-op reporting `conforms: true`. This silently disabled three
  shapes. `tests/cbox/guards.test.js` enforces it; prefer `sh:minInclusive` /
  `sh:maxInclusive`, which compare numerically and are immune.
- T-Box type triples (e.g. `dhc:Norm_NFC15100 a dhc:Norm`) must be present in
  the **data graph** being validated, not in the shapes graph. Each test file
  defines a `withTbox(fixture)` one-liner that prepends the T-Box for this
  reason. (It is *not* exported from `tests/_helpers/loadGraph.js`, despite
  what this file used to say — see `doc/parking-lot.md` § 3.)

## One C-Box profile per norm EDITION

Compliance is **computed, never declared**. `js-tools/build-abox.mjs` validates
an A-Box against every edition that has shapes and compares the verdicts:
passing the edition in force is compliant, passing an older one and failing the
current is **grandfathered** — lawful as built, re-qualified the moment anyone
modifies it, which is the state most of a real building is in. There is no
`dhc:builtUnder`; it existed briefly and was purged.

Four T-Box properties carry this, and all four fail silently when broken —
`tests/tbox/norm-editions.test.js` guards each:

| | |
|---|---|
| `dhc:shapesFile` | edition → its shapes. **The authority on which shapes exist — not the directory listing.** A verdict must be attributable to an edition to mean anything. |
| `dhc:supersedes` | edition → the one it replaces. Walked to build the effective rule set. |
| `dhc:latestEdition` | norm → the edition in force. Was *defined but never asserted* for months. |
| `dhc:editionOf` | edition → its norm. |

**Editions compose by concatenation.**
`effective(E) = shapesFile(E) + effective(supersedes(E))`, so an edition past
the base ships only its **delta**. Concatenation ANDs constraints: 2015 says
≥ 10 mm², 2024 says ≥ 16, both run, the stricter decides. Two rules follow:

- **An edition may add or tighten, never loosen.** If one ever relaxes a rule,
  this mechanism is wrong and must be replaced, not worked around.
- **A delta must never reuse a base shape IRI** (hence a namespace per edition).
  Reuse merges both editions' constraints onto one subject, so "does it pass
  2015?" can no longer be asked — nothing errors, the graph is valid, the
  comparison quietly answers something else.

`npm run build:abox` **fails** if a `dhc:shapesFile` names a missing file, or if
a `*.shapes.ttl` on disk is claimed by no edition — the latter would stop
running silently, and SHACL's answer to "nothing ran" is `conforms: true`.

> ⚠ **`nfc15100-2024.shapes.ttl` is ILLUSTRATIVE.** Nobody has read the
> published NF C 15-100:2024 text. It encodes plausible stand-ins so the
> machinery has something real to compute, marked `UNVERIFIED` on the header and
> every shape. Do not quote it. Replacing the numbers with the real text is
> parked (`doc/parking-lot.md` § 1b).

## Test protocol

Before committing any schema change:

1. `npm test` — all tests must pass.
2. When adding a class/property: extend `tests/tbox/core-schema.test.js` so the
   test catalog stays in sync.
3. When adding a C-Box shape: add a valid + invalid fixture pair under
   `tests/fixtures/` and assert both conformance outcomes in the norm's
   `tests/cbox/<norm>-<year>.test.js`.
4. When adding a norm profile: create
   `schema/cbox/<domain>/<norm>-<year>.shapes.ttl`, register it in
   `schema/cbox/cbox-manifest.json`, declare the `dhc:Norm_<ID>` **and**
   `dhc:NormEdition_<ID>_<year>` instances in the T-Box, point the edition at
   the file with `dhc:shapesFile`, and author
   `tests/cbox/<norm>-<year>.test.js`. All of it moves together — a profile
   whose shapes, Norm or edition are missing is a dangling reference, which is
   what `tests/cbox/guards.test.js` exists to catch, and an unclaimed shapes
   file fails the build outright.

### The C-Box is France-only, deliberately (v3.0.0)

Only `nfc15100` + `nfc14100` ship. DIN VDE 0100 (DE), AREI/RGIE (BE) and
BS 7671 (GB) were **removed** in v3.0.0 — shapes, tests, fixtures, manifest
profiles and `dhc:Norm` instances together — so that the norm layer can be got
right once, against one country, while `dhc-core` is prototyped. They return
after the core is released. **Do not re-add them as a tidy-up**; adding a norm
back means all four artifacts above, plus a valid *and* invalid fixture per
shape.

## What this repo does NOT do

- **No tenant A-Box data, and no app demo homes.** Real Digital Home instances
  live in S3 under the Designer's control. The demo homes the v1.0 apps
  (Portal, Designer, Operator) ship with belong to *them*, not here — the
  v2.0.0 `DE-DEMO-01` / `FR-DEMO-01` / `BE-DEMO-01` stay removed.
  See `schema/abox/` below for what this repo *does* keep.
- **No build artifacts.** `build/` is legacy and gitignored defensively.
- **No S3 publish.** The Modeler owns publication of `ontology-graph.json`,
  `blockly-blocks.json`, and `cbox-registry.json`.

## `schema/abox/` — prototypes, POCs and examples

This repo keeps A-Box models that **demonstrate a concept against the schema**.
They are deliberately separate from the demo homes the v1.0 apps use, which is
what stops the two being confused — the old blanket "no A-Box data" rule
conflated *tenant data* with *schema examples* and cost real work.

The model to copy is `experimental/Brick/examples/`: **one concept, end to end,
in 30–70 lines** — not a whole smart home. Upstream's median example is ~50
lines and its smallest complete one is 22. Keep each file to a single
`owl:Ontology` header, ≤6 distinct classes, and the one or two relationships
that carry the lesson. A prose comment header explaining the concept is the
convention (Brick's own examples do this; only 1 of 20 has a README).

`electrical-installation-house.ttl` is the exception that proves the rule — at
~370 lines it fuses a dozen concepts, and exists to prove the norm layer fires
end-to-end. It is a decomposition map for future examples, not a template.

Every example must satisfy `tests/tbox/abox-join.test.js`: each `dhc:` term it
uses has to exist in the T-Box. A term still sitting in `schema/draft/` is not
usable — promote it via `py-tools/ontology_explorer.py [4]` first. This is not
pedantry: undefined classes select no SHACL focus nodes, so a file referencing
them validates green while meaning nothing.

## Tooling

**`py-tools/ontology_explorer.py` is the only sanctioned writer** for
`schema/tbox/dhc-core.ttl` and `dhc-app-metadata.ttl`. One writer means one
splitter and one deterministic serializer, which is what keeps a vocabulary
move a reviewable local diff. Hand-editing those files survives until the next
promote, then the serializer rewrites the file and your edit may land in the
wrong view banner.

It has two front doors, sharing the same code path:

```bash
python3 py-tools/ontology_explorer.py                       # interactive (humans)
python3 py-tools/ontology_explorer.py --promote dhc:Circuit # scripted / agents
python3 py-tools/ontology_explorer.py --promote dhc:governedBy   # subjects, not just classes
python3 py-tools/ontology_explorer.py --purge   dhc:Norm_BS7671
```

Use the flags for scripted curation — **do not pipe stdin at the interactive
menu**. A prompt count that shifts by one silently desynchronises the stream,
and on EOF the menu loops forever rather than exiting. Flags are repeatable,
purges run before promotes, exit codes are real (`0` / `2`). Annotation review
is skipped by the flags: existing annotations still move, but *adding or
changing* one is a human call — use the menu.

**Do not adopt the Brick Python modules** (`brickschema`, `brick_model_summarizer`,
`brickschema_rdflib_sqlalchemy`). Validation is JavaScript —
`rdf-validate-shacl` via `tests/_helpers/loadGraph.js` — and our shapes are
pure SHACL Core, so there is nothing to gain and a JVM to lose. The one real
gap is *inference* (`sh:rule`), and when it is needed it is a build-time step
with `brick_tq_shacl`, not a test-time engine swap. Rationale:
[`doc/adr-0001-ontology-tooling.md`](doc/adr-0001-ontology-tooling.md).

## Related specs

- [`doc/adr-0001-ontology-tooling.md`](doc/adr-0001-ontology-tooling.md) — one
  writer, JS validator, no Brick Python, and where the C-Box sits in the pipeline.
- [`doc/prototyping-poc.md`](doc/prototyping-poc.md) — the v1.0 prototyping brief.
- [`doc/modeling.md`](doc/modeling.md) — REC spatial modelling concepts.
- `SPEC-V3-Redesign.md` — the REC → Brick → 223P → `dhc:` layering.
- `../../docs/specs/DH-SPEC-200-ontology-v2-multibox-architecture.md` — Multi-Box
  architecture, the design driver for v2.0.0.
- `../../docs/adr/0007-*.md` — core ontology ownership.
- `../../docs/adr/0012-*.md` — modular norm architecture (superseded by DH-SPEC-200).
