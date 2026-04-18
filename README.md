# @dhc/digitalhome-cloud-core

Schema-only source of truth for the DigitalHome.Cloud platform — domain
vocabulary plus national-norm compliance profiles, versioned as a git
repository.

**Branch `v2.0.0` — Multi-Box refactor in progress.** This is a breaking
restructure per [DH-SPEC-200](../../docs/specs/DH-SPEC-200-ontology-v2-multibox-architecture.md).
Do not merge to `main` or `stage` until the Modeler v2 work lands.

## Structure

```
schema/
  tbox/                           ← T-Box: norm-agnostic domain vocabulary
    dhc-core.schema.ttl             classes, properties, R-Box axioms, enum instances
    dhc-roles.ttl                   role instances (Owner, Designer, Installer, …)
    context.jsonld                  JSON-LD context for A-Box serialization
  cbox/                           ← C-Box: per-norm SHACL profiles
    cbox-manifest.json              registry of published norm profiles
    electrical/
      nfc14100.shapes.ttl           NF C 14-100   (FR — energy delivery)
      nfc15100.shapes.ttl           NF C 15-100   (FR — installation)
      din-vde-0100.shapes.ttl       DIN VDE 0100  (DE)
      arei-rgie.shapes.ttl          AREI / RGIE   (BE)
      bs7671.shapes.ttl             BS 7671       (UK)
tests/
  _helpers/loadGraph.js           ← n3 + rdf-validate-shacl helpers
  tbox/                           ← T-Box structural tests
  cbox/                           ← per-norm SHACL conformance tests
  fixtures/                       ← valid / invalid A-Box fragments
```

A-Box instance data (individual homes) is **not** in this repository. The
Designer app writes A-Box to S3.

## Commands

```bash
npm install
npm test           # vitest run
npm run test:watch # iterative authoring
```

## Consumers

- **Modeler** — parses `schema/tbox/*.ttl` and `schema/cbox/**/*.shapes.ttl` to
  generate the ontology graph, Blockly blocks, and C-Box registry. Publishes
  those artifacts to S3.
- **Designer** — fetches the Modeler's artifacts from S3 at runtime; displays
  SHACL violations from the C-Box profile(s) active on the current home.
- **Portal** — references `schema/tbox/context.jsonld` when serializing
  JSON-LD.

## Breaking changes vs. v1.2.0

| Area                | v1.2.0                                             | v2.0.0                                             |
|---------------------|----------------------------------------------------|----------------------------------------------------|
| Package name        | `@dhc/core`                                        | `@dhc/digitalhome-cloud-core`                      |
| Layout              | `src/ontology/`, `src/modules/`, `src/instances/`  | `schema/tbox/`, `schema/cbox/`, no instances       |
| Norm encoding       | T-Box subclasses (`dhc-nfc15100:LightingCircuit`)  | SHACL shapes activated by `dhc:Norm` + `dhc:CircuitType` guards |
| Composability       | Not possible (single inheritance chain)            | Any circuit may carry multiple `dhc:governedBy` norms |
| `dhc:Guideline`     | Class with weight/category properties              | Promoted to `dhc:Norm` with richer metadata (country, version, domain) |
| Build scripts       | `parse-ontology`, `generate-blockly-toolbox`, `publish-ontology` | Removed — build logic lives in the Modeler |
| Demo A-Box          | `src/instances/{DE,FR,BE}-DEMO-01.ttl`             | Removed — A-Box never in this repo                 |
| Tests               | None                                               | 50 vitest cases over T-Box + all 5 C-Box profiles  |

## Supported norms

| Norm        | Country | Profile file                                          |
|-------------|---------|-------------------------------------------------------|
| NF C 14-100 | FR      | `schema/cbox/electrical/nfc14100.shapes.ttl`          |
| NF C 15-100 | FR      | `schema/cbox/electrical/nfc15100.shapes.ttl`          |
| DIN VDE 0100| DE      | `schema/cbox/electrical/din-vde-0100.shapes.ttl`      |
| AREI / RGIE | BE      | `schema/cbox/electrical/arei-rgie.shapes.ttl`         |
| BS 7671     | UK      | `schema/cbox/electrical/bs7671.shapes.ttl`            |

A circuit can declare `dhc:governedBy` against **multiple** norms; each norm's
shapes are evaluated independently. See
`tests/fixtures/valid-fr-circuit-multi-norm.ttl` for a working example.

## Related documentation

- [DH-SPEC-200 — Ontology v2.0.0 Multi-Box Architecture](../../docs/specs/DH-SPEC-200-ontology-v2-multibox-architecture.md)
- [ADR 0007 — Semantic core ontology in core repo](../../docs/adr/0007-semantic-core-ontology-in-core-repo.md)
- [ADR 0012 — Modular ontology architecture](../../docs/adr/0012-modular-ontology-architecture.md) (superseded by DH-SPEC-200)
- `CLAUDE.md` — authoring conventions for AI agents
