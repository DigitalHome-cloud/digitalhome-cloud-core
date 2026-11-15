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
    Brick+extensions.ttl            read-only baseline: Brick 1.5 + REC + ASHRAE 223P
    dhc-core.ttl                    classes, properties, R-Box axioms, enum instances (@en)
    dhc-app-metadata.ttl            UI overlay: designView, blockly*, @de/@fr labels
  cbox/                           ← C-Box: SHACL profiles, one per norm EDITION
    cbox-manifest.json              registry of published profiles
    electrical/
      nfc14100-2008.shapes.ttl      NF C 14-100:2008  (FR — energy delivery)
      nfc15100-2015.shapes.ttl      NF C 15-100:2015  (FR — installation) — the base
      nfc15100-2024.shapes.ttl      NF C 15-100:2024  — delta over 2015; ⚠ illustrative
  abox/                           ← prototype / POC / example models only
    electrical-installation-house.ttl
js-tools/                         ← offline A-Box viewer + validator (see its README)
py-tools/
  ontology_explorer.py            ← the ONLY sanctioned writer for tbox/dhc-*.ttl
tests/
  _helpers/loadGraph.js           ← n3 + rdf-validate-shacl helpers
  tbox/                           ← T-Box structural tests
  cbox/                           ← per-edition SHACL conformance tests
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

**France only, deliberately** (since v3.0.0). DIN VDE 0100 (DE), AREI/RGIE (BE)
and BS 7671 (GB) were removed — shapes, tests, fixtures, manifest entries and
`dhc:Norm` instances together — so the norm layer could be got right against one
country first. They return once the core is released; re-adding one means all
four artifacts plus a valid *and* invalid fixture per shape. See CLAUDE.md.

One profile per **edition**, not per norm — that is what makes compliance
computable rather than declared:

| Norm | Edition | In force? | Profile file |
|---|---|---|---|
| NF C 14-100 | 2008 | no | `schema/cbox/electrical/nfc14100-2008.shapes.ttl` |
| NF C 14-100 | 2021 | **yes** | *(none — so nothing under this norm can be proven current)* |
| NF C 15-100 | 2015-A5 | no | `schema/cbox/electrical/nfc15100-2015.shapes.ttl` |
| NF C 15-100 | 2024 | **yes** | `schema/cbox/electrical/nfc15100-2024.shapes.ttl` — delta over 2015 |

An A-Box is validated against each, and the verdicts are compared: passing the
edition in force is compliant; passing an older one and failing the current is
**grandfathered** — lawful as built, re-qualified the moment it is modified.
Nothing in the A-Box declares this. See `js-tools/README.md` § Compliance and
CLAUDE.md § One C-Box profile per norm EDITION.

> ⚠ The NF C 15-100:2024 rules are **illustrative**, not sourced from the
> published text. They exist so the mechanism has something to compute, and are
> marked `UNVERIFIED` throughout.

A circuit can declare `dhc:governedBy` against **multiple** norms; each norm's
shapes are evaluated independently, and the worst verdict wins. See
`tests/fixtures/valid-fr-circuit-multi-norm.ttl` for a working example.

## License

This repository is licensed under the terms in [`LICENSE`](./LICENSE).

**Third-party content**, under its own license, not this repo's:

- `schema/abox/examples-brick-1.5/` — example models from the
  [Brick schema](https://brickschema.org/), © Brick Consortium, Inc., under
  **BSD 3-Clause**. Copied verbatim (unmodified) as reference material for the
  viewer. Full license and provenance:
  [`schema/abox/examples-brick-1.5/LICENSE`](./schema/abox/examples-brick-1.5/LICENSE)
  and its `README.md`.
- `schema/tbox/Brick+extensions.ttl` — the vendored upstream baseline vocabulary
  (Brick 1.5 + REC + ASHRAE 223P). The Brick ontology carries its own embedded
  `dcterms:license` (→ Brick's BSD 3-Clause); the file also bundles ASHRAE 223P
  and REC, which have their own terms. This predates the example set above and
  its licensing has not been separately audited — **worth a dedicated review**.

## Related documentation

- [DH-SPEC-200 — Ontology v2.0.0 Multi-Box Architecture](../../docs/specs/DH-SPEC-200-ontology-v2-multibox-architecture.md)
- [ADR 0007 — Semantic core ontology in core repo](../../docs/adr/0007-semantic-core-ontology-in-core-repo.md)
- [ADR 0012 — Modular ontology architecture](../../docs/adr/0012-modular-ontology-architecture.md) (superseded by DH-SPEC-200)
- `CLAUDE.md` — authoring conventions for AI agents
