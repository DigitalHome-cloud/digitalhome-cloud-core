# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DigitalHome.Cloud Core — the ontology, norm modules, demo instances, and build tooling that underpin the entire DigitalHome.Cloud platform. This repo is the single source of truth for the domain vocabulary used by the Modeler, Designer, and Portal apps.

## Commands

- `yarn build` — Parse ontology + generate Blockly toolbox (outputs to `build/`)
- `yarn parse-ontology` — Parse TTL → `build/ontology-graph.json`
- `yarn generate-blockly-toolbox` — Parse TTL → `build/blockly-blocks.json` + `build/blockly-toolbox.json`
- `yarn publish-ontology` — Upload `build/` artifacts to S3 (requires AWS credentials)

## Structure

```
src/
  ontology/           ← Core T-Box: classes, properties, design views, context
  modules/            ← Norm extension modules (NF C 14-100, NF C 15-100)
  instances/          ← Demo A-Box instance data (DE-DEMO, FR-DEMO, BE-DEMO)
scripts/              ← Build scripts (parse, generate, publish)
build/                ← Generated artifacts (gitignored)
```

## Key Files

### Source (src/)

| File | What it defines |
|------|----------------|
| `src/ontology/dhc-core.schema.ttl` | Core ontology — ~76 classes, ~91 properties across 8 design views |
| `src/ontology/dhc-roles.ttl` | Role and agent definitions (Owner, Designer, Installer, etc.) |
| `src/ontology/context.jsonld` | JSON-LD context for runtime A-Box serialization |
| `src/modules/module-manifest.json` | Module discovery config (id, file, category, countries) |
| `src/modules/dhc-nfc14100-electrical.ttl` | NF C 14-100 energy delivery module (France) |
| `src/modules/dhc-nfc15100-electrical.ttl` | NF C 15-100 electrical installation module (France) |

### Build scripts (scripts/)

| Script | Input | Output |
|--------|-------|--------|
| `parse-ontology.js` | Core TTL + module TTLs | `build/ontology-graph.json` (nodes, links, meta) |
| `generate-blockly-toolbox.js` | Core TTL + module TTLs + overrides | `build/blockly-blocks.json` + `build/blockly-toolbox.json` |
| `publish-ontology.js` | `build/` artifacts + `src/ontology/context.jsonld` | S3 uploads to `public/ontology/v{VERSION}/` and `latest/` |
| `blockly-overrides.json` | — | Hand-maintained: dropdown values, module defaults, view overrides |

## Ontology Conventions

- All classes use `dhc:` prefix (core) or `dhc-nfc14100:`/`dhc-nfc15100:` (modules)
- Design views: spatial, building, electrical, plumbing, heating, network, governance, automation, shared
- Version tracked via `owl:versionInfo` in the ontology header
- Non-breaking additions only between minor versions; breaking changes require a major bump

## Consumers

The Modeler and Designer apps import build artifacts. After running `yarn build`, copy outputs:
- `build/ontology-graph.json` → `repos/modeler/src/data/ontology-graph.json`
- `build/blockly-blocks.json` → `repos/designer/src/data/blockly-blocks.json`
- `build/blockly-toolbox.json` → `repos/designer/src/data/blockly-toolbox.json`

Or publish to S3 via `yarn publish-ontology` and let apps fetch at runtime.

## Multi-Repo Ecosystem

| App | Repo | Consumes |
|-----|------|----------|
| Portal | `repos/portal/` | `src/ontology/context.jsonld` |
| Designer | `repos/designer/` | `build/blockly-blocks.json`, `build/blockly-toolbox.json` |
| Modeler | `repos/modeler/` | `build/ontology-graph.json` |
