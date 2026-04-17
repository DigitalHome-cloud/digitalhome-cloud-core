# digitalhome-cloud-core

Core ontology, norm modules, demo instances, and build tooling for the DigitalHome.Cloud platform.

## Structure

```
src/
  ontology/           ← Core T-Box schema (TTL) + JSON-LD context
    dhc-core.schema.ttl
    dhc-roles.ttl
    context.jsonld
  modules/            ← Norm-specific extension modules
    module-manifest.json
    dhc-nfc14100-electrical.ttl
    dhc-nfc15100-electrical.ttl
  instances/          ← Demo A-Box instance data
    DE-DEMO-01.ttl
    FR-DEMO-01.ttl
    BE-DEMO-01.ttl
scripts/
  parse-ontology.js           ← TTL → ontology-graph.json (3D viewer data)
  generate-blockly-toolbox.js ← TTL → Blockly block definitions + toolbox
  publish-ontology.js         ← Upload build artifacts to S3
  blockly-overrides.json      ← Hand-maintained overrides for block generation
build/                ← Generated (gitignored)
  ontology-graph.json
  blockly-blocks.json
  blockly-toolbox.json
```

## Commands

```bash
yarn build                      # parse ontology + generate blockly toolbox
yarn parse-ontology             # only parse → build/ontology-graph.json
yarn generate-blockly-toolbox   # only generate → build/blockly-*.json
yarn publish-ontology           # upload build/ artifacts to S3
```

## Consumers

- **Modeler** — imports `build/ontology-graph.json` for the 3D viewer
- **Designer** — imports `build/blockly-blocks.json` + `build/blockly-toolbox.json` for the Blockly workspace (also fetched from S3 at runtime)
- **Portal** — references `src/ontology/context.jsonld` for JSON-LD serialization

## Versioning

The core ontology follows semantic versioning via `owl:versionInfo` in `dhc-core.schema.ttl`. The `package.json` version tracks the ontology version.
