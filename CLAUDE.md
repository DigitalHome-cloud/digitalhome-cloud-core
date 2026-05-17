# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

`@dhc/digitalhome-cloud-core` is the **schema-only** source of truth for the
DigitalHome.Cloud platform, restructured in v2.0.0 to follow the **Multi-Box
Model** (DH-SPEC-200):

| Box   | Content                                                | Location in repo                 |
|-------|--------------------------------------------------------|----------------------------------|
| T-Box | Domain vocabulary (classes, properties, R-Box axioms, enum instances) | `schema/tbox/*.ttl` |
| C-Box | Norm profiles as SHACL shapes — one file per national standard        | `schema/cbox/<domain>/*.shapes.ttl` |
| A-Box | Instance data per Digital Home                         | **Not in this repo.** Created by the Designer app, stored in S3. |

No build scripts, no generated artifacts, no demo instances — just schema and
tests. Downstream apps (Modeler, Designer) parse these files directly at build
or runtime.

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
    dhc-core.schema.ttl       ← Classes, properties, R-Box axioms, enum instances
    dhc-roles.ttl             ← Role instances (Owner, Designer, Installer, …)
    context.jsonld            ← JSON-LD context for A-Box serialization
  cbox/
    cbox-manifest.json        ← Registry of published norm profiles
    electrical/
      nfc14100.shapes.ttl     ← NF C 14-100 (FR — energy delivery)
      nfc15100.shapes.ttl     ← NF C 15-100 (FR — installation)
      din-vde-0100.shapes.ttl ← DIN VDE 0100 (DE)
      arei-rgie.shapes.ttl    ← AREI/RGIE (BE)
      bs7671.shapes.ttl       ← BS 7671 (UK)
tests/
  _helpers/loadGraph.js       ← Shared n3/SHACL test utilities
  tbox/                       ← T-Box structural tests
  cbox/                       ← C-Box parse + conformance tests per norm
  fixtures/                   ← Valid/invalid A-Box fragments used by tests
```

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
| C-Box shape                 | `{Concept}Shape`              | `nfc15100:LightingCircuitShape`  |
| C-Box file                  | `{norm-id}.shapes.ttl`        | `schema/cbox/electrical/bs7671.shapes.ttl` |

### Required annotations

- **Trilingual labels**: every class, property, enum instance, norm, and SHACL
  shape message carries `rdfs:label` (or `sh:message`) in `@en`, `@de`, `@fr`.
- **Design view**: every T-Box class and property carries a `dhc:designView`
  value. `compliance` is reserved for `dhc:Norm`.

### Versioning

- `owl:versionInfo` in `dhc-core.schema.ttl` and `version` in `package.json`
  move together.
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
- T-Box type triples (e.g. `dhc:Norm_NFC15100 a dhc:Norm`) must be present in
  the **data graph** being validated, not in the shapes graph. The
  `withTbox(fixture)` helper in `tests/_helpers/loadGraph.js` prepends the
  T-Box to each fixture for this reason.

## Test protocol

Before committing any schema change:

1. `npm test` — all 50+ tests must pass.
2. When adding a class/property: extend `tests/tbox/core-schema.test.js` so the
   test catalog stays in sync.
3. When adding a C-Box shape: add a valid + invalid fixture pair under
   `tests/fixtures/` and assert both conformance outcomes in the norm's
   `tests/cbox/<norm>.test.js`.
4. When adding a new norm profile: create `schema/cbox/<domain>/<norm>.shapes.ttl`,
   register it in `schema/cbox/cbox-manifest.json`, declare the `dhc:Norm_<ID>`
   instance in the T-Box, and author `tests/cbox/<norm>.test.js`.

## What this repo does NOT do

- **No A-Box data.** Demo homes (`DE-DEMO-01`, `FR-DEMO-01`, `BE-DEMO-01`) were
  removed in v2.0.0. A-Box lives in S3 under the Designer's control.
- **No build artifacts.** `build/` is legacy and gitignored defensively.
- **No S3 publish.** The Modeler owns publication of `ontology-graph.json`,
  `blockly-blocks.json`, and `cbox-registry.json` in v2.

## Related specs

- `docs/specs/DH-SPEC-200-ontology-v2-multibox-architecture.md` — Multi-Box
  architecture, the design driver for v2.0.0.
- `docs/adr/0007-*.md` — core ontology ownership.
- `docs/adr/0012-*.md` — modular norm architecture (superseded by DH-SPEC-200).
