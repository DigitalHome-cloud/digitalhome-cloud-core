#!/usr/bin/env node
/**
 * parse-ontology.js
 *
 * Reads dhc-core.schema.ttl and module TTL files, then produces
 * build/ontology-graph.json with { meta, nodes, links } for the
 * 3D force-graph viewer.
 *
 * Module discovery: reads src/modules/module-manifest.json
 */

const fs = require("fs");
const path = require("path");

const TTL_PATH = path.resolve(
  __dirname,
  "../src/ontology/dhc-core.schema.ttl"
);
const MODULES_DIR = path.resolve(__dirname, "../src/modules");
const MANIFEST_PATH = path.resolve(MODULES_DIR, "module-manifest.json");
const BUILD_DIR = path.resolve(__dirname, "../build");
if (!fs.existsSync(BUILD_DIR)) fs.mkdirSync(BUILD_DIR, { recursive: true });
const OUT_PATH = path.resolve(BUILD_DIR, "ontology-graph.json");

// ── TTL Parsing helpers ──

function extractField(block, predicate) {
  const re = new RegExp(predicate + '\\s+"([^"]*)"(?:@en)?', "m");
  const m = block.match(re);
  return m ? m[1] : null;
}

function extractObject(block, predicate) {
  const re = new RegExp(predicate + "\\s+(\\S+?)\\s*[;.]", "m");
  const m = block.match(re);
  return m ? m[1] : null;
}

function extractDesignView(block) {
  const m = block.match(/dhc:designView\s+"([^"]+)"/);
  return m ? m[1] : null;
}

/**
 * Parse a TTL file into entities.
 * Returns { meta, entities } where meta contains ontology-level version/label.
 */
function parseTTLFile(ttlContent) {
  const blocks = ttlContent.split(/\n\s*\n/);

  // Extract ontology-level metadata
  const meta = { version: null, label: null };
  for (const block of blocks) {
    if (block.includes("a owl:Ontology")) {
      const versionMatch = block.match(/owl:versionInfo\s+"([^"]+)"/);
      if (versionMatch) meta.version = versionMatch[1];
      const labelMatch = block.match(/rdfs:label\s+"([^"]+)"(?:@\w+)?/);
      if (labelMatch) meta.label = labelMatch[1];
      break;
    }
  }

  // Subject regex: match any prefixed name
  const subjectRe = /^([\w-]+:\w+)\s*\n?\s+a\s+(owl:\w+)/m;
  const subjectReCompact = /^([\w-]+:\w+)\s+a\s+(owl:\w+)\s*;/m;

  const entities = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("@prefix") || trimmed.startsWith("<")) {
      continue;
    }

    // Handle compact multi-definition blocks
    const lines = trimmed.split("\n");
    const subBlocks = [];
    let current = [];
    for (const line of lines) {
      if (/^[\w-]+:\w+\s+a\s+owl:/.test(line.trim()) && current.length > 0) {
        subBlocks.push(current.join("\n"));
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) subBlocks.push(current.join("\n"));

    for (const sub of subBlocks) {
      let parsed = null;
      let m = sub.match(subjectRe);
      if (m) {
        parsed = { id: m[1], owlType: m[2] };
      } else {
        m = sub.match(subjectReCompact);
        if (m) parsed = { id: m[1], owlType: m[2] };
      }
      if (!parsed) continue;

      const { id, owlType } = parsed;
      if (id === "dhc:designView") continue;

      const label = extractField(sub, "rdfs:label") || id.split(":").pop();
      const comment = extractField(sub, "rdfs:comment");
      const view = extractDesignView(sub);
      const superClass = extractObject(sub, "rdfs:subClassOf");
      const domain = extractObject(sub, "rdfs:domain");
      const range = extractObject(sub, "rdfs:range");

      let type;
      switch (owlType) {
        case "owl:Class": type = "class"; break;
        case "owl:ObjectProperty": type = "objectProperty"; break;
        case "owl:DatatypeProperty": type = "datatypeProperty"; break;
        case "owl:AnnotationProperty": type = "annotationProperty"; break;
        default: type = owlType;
      }

      const node = { id, label, type };
      if (view) node.view = view;
      if (comment) node.comment = comment;
      if (superClass) node.superClass = superClass;
      if (domain) node.domain = domain;
      if (range) node.range = range;

      entities.push(node);
    }
  }

  return { meta, entities };
}

// ── Main ──

// Parse Core TTL
const coreTtl = fs.readFileSync(TTL_PATH, "utf-8");
const { meta, entities: coreEntities } = parseTTLFile(coreTtl);

const nodes = [...coreEntities];
const nodeIds = new Set(coreEntities.map((n) => n.id));

// Parse modules
const loadedModules = [];
if (fs.existsSync(MANIFEST_PATH)) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  for (const mod of manifest.modules) {
    const modTtlPath = path.resolve(MODULES_DIR, mod.file);
    if (!fs.existsSync(modTtlPath)) {
      console.warn(`Warning: Module TTL not found: ${modTtlPath}`);
      continue;
    }
    const modTtl = fs.readFileSync(modTtlPath, "utf-8");
    const { entities: modEntities } = parseTTLFile(modTtl);

    for (const entity of modEntities) {
      entity.module = mod.id;
      nodes.push(entity);
      nodeIds.add(entity.id);
    }
    loadedModules.push({ id: mod.id, version: mod.version, label: mod.label });
  }
}

// Build links
const links = [];
for (const node of nodes) {
  if (node.superClass && nodeIds.has(node.superClass)) {
    links.push({
      source: node.id,
      target: node.superClass,
      label: "subClassOf",
      type: "subClassOf",
    });
  }

  if (node.type === "objectProperty") {
    if (node.domain && nodeIds.has(node.domain) && node.range && nodeIds.has(node.range)) {
      links.push({
        source: node.domain,
        target: node.range,
        label: node.label,
        type: "objectProperty",
      });
    }
  }

  if (node.type === "datatypeProperty" && node.domain && nodeIds.has(node.domain)) {
    links.push({
      source: node.id,
      target: node.domain,
      label: "domain",
      type: "domain",
    });
  }
}

// Add modules array to meta
if (loadedModules.length > 0) {
  meta.modules = loadedModules;
}

const graph = { meta, nodes, links };

fs.writeFileSync(OUT_PATH, JSON.stringify(graph, null, 2));

console.log(
  `Parsed ${nodes.filter((n) => n.type === "class").length} classes, ` +
    `${nodes.filter((n) => n.type === "objectProperty").length} object properties, ` +
    `${nodes.filter((n) => n.type === "datatypeProperty").length} datatype properties`
);
if (loadedModules.length > 0) {
  console.log(`Modules loaded: ${loadedModules.map((m) => m.id).join(", ")}`);
}
console.log(`${links.length} links generated`);
console.log(`Output: ${OUT_PATH}`);
