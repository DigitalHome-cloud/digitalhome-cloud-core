#!/usr/bin/env node
/**
 * publish-ontology.js
 *
 * Uploads compiled ontology artifacts to S3 at versioned paths.
 * Uses the AWS SDK default credential chain (env vars, ~/.aws, IAM role, etc.).
 *
 * Uploads:
 *   public/ontology/v{VERSION}/ontology-graph.json
 *   public/ontology/v{VERSION}/context.jsonld
 *   public/ontology/latest/ontology-graph.json
 *   public/ontology/latest/context.jsonld
 */

const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const BUCKET = "digitalhome-cloudec099-main";
const REGION = "eu-central-1";

const GRAPH_PATH = path.resolve(__dirname, "../build/ontology-graph.json");
const CONTEXT_PATH = path.resolve(
  __dirname,
  "../src/ontology/context.jsonld"
);
const BLOCKLY_BLOCKS_PATH = path.resolve(__dirname, "../build/blockly-blocks.json");
const BLOCKLY_TOOLBOX_PATH = path.resolve(__dirname, "../build/blockly-toolbox.json");
const MODULES_DIR = path.resolve(__dirname, "../src/modules");
const MANIFEST_PATH = path.resolve(MODULES_DIR, "module-manifest.json");

// Read ontology graph and extract version
const graphJson = fs.readFileSync(GRAPH_PATH, "utf-8");
const graph = JSON.parse(graphJson);
const version = graph.meta?.version;

if (!version) {
  console.error(
    "Error: No version found in ontology-graph.json meta field. Run `yarn parse-ontology` first."
  );
  process.exit(1);
}

// Read context.jsonld
if (!fs.existsSync(CONTEXT_PATH)) {
  console.error(`Error: context.jsonld not found at ${CONTEXT_PATH}`);
  process.exit(1);
}
const contextJson = fs.readFileSync(CONTEXT_PATH, "utf-8");

// Read blockly artifacts (optional — only uploaded if they exist)
const hasBlocklyArtifacts =
  fs.existsSync(BLOCKLY_BLOCKS_PATH) && fs.existsSync(BLOCKLY_TOOLBOX_PATH);
let blocklyBlocksJson, blocklyToolboxJson;
if (hasBlocklyArtifacts) {
  blocklyBlocksJson = fs.readFileSync(BLOCKLY_BLOCKS_PATH, "utf-8");
  blocklyToolboxJson = fs.readFileSync(BLOCKLY_TOOLBOX_PATH, "utf-8");
}

const s3 = new S3Client({ region: REGION });

async function upload(key, body, contentType) {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  await s3.send(cmd);
  console.log(`  Uploaded s3://${BUCKET}/${key}`);
}

async function main() {
  console.log(`Publishing ontology v${version} to S3...`);

  // Versioned paths
  await upload(
    `public/ontology/v${version}/ontology-graph.json`,
    graphJson,
    "application/json"
  );
  await upload(
    `public/ontology/v${version}/context.jsonld`,
    contextJson,
    "application/ld+json"
  );

  // Latest alias
  await upload(
    "public/ontology/latest/ontology-graph.json",
    graphJson,
    "application/json"
  );
  await upload(
    "public/ontology/latest/context.jsonld",
    contextJson,
    "application/ld+json"
  );

  // Blockly toolbox artifacts
  if (hasBlocklyArtifacts) {
    console.log("\nPublishing Blockly toolbox artifacts...");
    await upload(
      `public/ontology/v${version}/blockly-blocks.json`,
      blocklyBlocksJson,
      "application/json"
    );
    await upload(
      `public/ontology/v${version}/blockly-toolbox.json`,
      blocklyToolboxJson,
      "application/json"
    );
    await upload(
      "public/ontology/latest/blockly-blocks.json",
      blocklyBlocksJson,
      "application/json"
    );
    await upload(
      "public/ontology/latest/blockly-toolbox.json",
      blocklyToolboxJson,
      "application/json"
    );
  }

  // Module files
  if (fs.existsSync(MANIFEST_PATH)) {
    console.log("\nPublishing module files...");
    const manifestJson = fs.readFileSync(MANIFEST_PATH, "utf-8");
    await upload(
      `public/ontology/v${version}/modules/module-manifest.json`,
      manifestJson,
      "application/json"
    );
    await upload(
      "public/ontology/latest/modules/module-manifest.json",
      manifestJson,
      "application/json"
    );

    const manifest = JSON.parse(manifestJson);
    for (const mod of manifest.modules) {
      const modTtlPath = path.resolve(MODULES_DIR, mod.file);
      if (fs.existsSync(modTtlPath)) {
        const modTtl = fs.readFileSync(modTtlPath, "utf-8");
        await upload(
          `public/ontology/v${version}/modules/${mod.file}`,
          modTtl,
          "text/turtle"
        );
        await upload(
          `public/ontology/latest/modules/${mod.file}`,
          modTtl,
          "text/turtle"
        );
      }
    }
  }

  console.log(`\nDone. Ontology v${version} published.`);
}

main().catch((err) => {
  console.error("Publish failed:", err.message);
  process.exit(1);
});
