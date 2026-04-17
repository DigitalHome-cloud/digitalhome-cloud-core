#!/usr/bin/env node
/**
 * generate-blockly-toolbox.js
 *
 * Parses dhc-core.schema.ttl and module TTL files, then generates
 * Blockly block definitions and a toolbox configuration for the
 * SmartHome Designer.
 *
 * Module discovery: reads src/modules/module-manifest.json
 * Module blocks inherit containment/reference properties from their
 * Core superclass.
 *
 * Output:
 *   build/blockly-blocks.json   — array of Blockly block definitions
 *   build/blockly-toolbox.json  — categoryToolbox config grouped by designView
 */

const fs = require("fs");
const path = require("path");

const TTL_PATH = path.resolve(
  __dirname,
  "../src/ontology/dhc-core.schema.ttl"
);
const MODULES_DIR = path.resolve(__dirname, "../src/modules");
const MANIFEST_PATH = path.resolve(MODULES_DIR, "module-manifest.json");
const OVERRIDES_PATH = path.resolve(__dirname, "blockly-overrides.json");
const BUILD_DIR = path.resolve(__dirname, "../build");
if (!fs.existsSync(BUILD_DIR)) fs.mkdirSync(BUILD_DIR, { recursive: true });
const BLOCKS_OUT = path.resolve(BUILD_DIR, "blockly-blocks.json");
const TOOLBOX_OUT = path.resolve(BUILD_DIR, "blockly-toolbox.json");

// Scope filter: only these designViews produce blocks
const DEFAULT_SCOPE = ["spatial", "electrical", "shared"];

// XSD type → Blockly field type mapping
const XSD_TO_BLOCKLY = {
  "xsd:string": "field_input",
  "xsd:integer": "field_number",
  "xsd:decimal": "field_number",
  "xsd:boolean": "field_checkbox",
  "xsd:dateTime": "field_input",
};

// Containment object properties → statement_input
const CONTAINMENT_PROPERTIES = [
  "dhc:hasSpace",
  "dhc:hasFloor",
  "dhc:hasArea",
  "dhc:hasCircuit",
  "dhc:feedsEquipment",
  "dhc:hasEquipment",
  "dhc:hasBuildingElement",
  "dhc:hasWiring",
  "dhc:feeds",
];

// Reference object properties → value_input
const REFERENCE_PROPERTIES = [
  "dhc:belongsToZone",
  "dhc:hasEquipmentType",
  "dhc:hasProtection",
  "dhc:hasCircuitType",
  "dhc:connectedToNetwork",
  "dhc:hasPart",
  "dhc:locatedIn",
];

// View colours matching OntologyGraph.js VIEW_COLOURS
const VIEW_COLOURS = {
  spatial: 142,     // green hue
  building: 36,     // amber hue
  electrical: 220,  // blue hue
  plumbing: 186,    // cyan hue
  heating: 0,       // red hue
  network: 270,     // purple hue
  governance: 25,   // orange hue
  automation: 330,  // pink hue
  shared: 230,      // gray-blue hue
};

// View labels for toolbox categories
const VIEW_LABELS = {
  spatial: "Spatial",
  electrical: "Electrical",
  shared: "Shared",
  building: "Building",
  plumbing: "Plumbing",
  heating: "Heating / HVAC",
  network: "Network",
  governance: "Governance",
  automation: "Automation",
};

/**
 * Humanize a PascalCase local name by stripping known module prefixes
 * and inserting spaces with number+unit awareness.
 * e.g. "Nfc15100SocketCircuit16A_8Sockets" → "Socket Circuit 16A — 8 Sockets"
 *      "FloorHeating5400W40ADedicated" → "Floor Heating 5400W 40A Dedicated"
 */
function humanizeLocalName(localName) {
  // Strip known module prefixes
  let name = localName
    .replace(/^Nfc15100/, "")
    .replace(/^Nfc14100/, "")
    .replace(/^Nf14/, "");

  // Replace underscores with " — " separator
  name = name.replace(/_/g, " — ");

  // Insert spaces: between lowercase/digit and uppercase
  name = name.replace(/([a-z])([A-Z])/g, "$1 $2");
  // Between digit and uppercase letter (but not units like W, A)
  name = name.replace(/(\d)([A-Z][a-z])/g, "$1 $2");
  // Between uppercase acronym run and next capitalized word
  name = name.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

  return name.trim();
}

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
 * Parse a TTL file into an array of entities.
 * Supports both dhc: and module-prefixed subjects (e.g. dhc-nfc15100:ClassName).
 */
function parseTTL(ttlContent, prefixFilter) {
  const rawBlocks = ttlContent.split(/\n\s*\n/);

  // Split compact multi-definition blocks
  const blocks = [];
  for (const raw of rawBlocks) {
    const lines = raw.split("\n");
    let current = [];
    for (const line of lines) {
      if (/^\S+:\w+\s+a\s+owl:/.test(line.trim()) && current.length > 0) {
        blocks.push(current.join("\n"));
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) {
      blocks.push(current.join("\n"));
    }
  }

  // Subject regex: match prefixed names like dhc:X or dhc-nfc15100:X
  const subjectRe = prefixFilter
    ? new RegExp(`^(${prefixFilter}:\\w+)\\s*\\n?\\s+a\\s+(owl:\\w+)`, "m")
    : /^([\w-]+:\w+)\s*\n?\s+a\s+(owl:\w+)/m;
  const subjectReCompact = prefixFilter
    ? new RegExp(`^(${prefixFilter}:\\w+)\\s+a\\s+(owl:\\w+)\\s*;`, "m")
    : /^([\w-]+:\w+)\s+a\s+(owl:\w+)\s*;/m;

  const entities = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (
      !trimmed ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("@prefix") ||
      trimmed.startsWith("<")
    ) {
      continue;
    }

    let parsed = null;
    let m = trimmed.match(subjectRe);
    if (m) {
      parsed = { id: m[1], owlType: m[2] };
    } else {
      m = trimmed.match(subjectReCompact);
      if (m) {
        parsed = { id: m[1], owlType: m[2] };
      }
    }
    if (!parsed) continue;

    const { id, owlType } = parsed;
    if (id === "dhc:designView") continue;

    const label = extractField(trimmed, "rdfs:label") || humanizeLocalName(id.split(":").pop());
    const comment = extractField(trimmed, "rdfs:comment");
    const view = extractDesignView(trimmed);
    const superClass = extractObject(trimmed, "rdfs:subClassOf");
    const domain = extractObject(trimmed, "rdfs:domain");
    const range = extractObject(trimmed, "rdfs:range");

    let type;
    switch (owlType) {
      case "owl:Class":
        type = "class";
        break;
      case "owl:ObjectProperty":
        type = "objectProperty";
        break;
      case "owl:DatatypeProperty":
        type = "datatypeProperty";
        break;
      default:
        type = owlType;
    }

    entities.push({ id, type, label, comment, view, superClass, domain, range });
  }

  return entities;
}

/**
 * Convert a prefixed class ID to a Blockly block type name.
 * dhc:ClassName → dhc_class_name
 * dhc-nfc15100:LightingCircuit → dhc_nfc15100_lighting_circuit
 * dhc-nfc15100:GTL → dhc_nfc15100_gtl
 * dhc-nfc14100:NF14EnergyMeter → dhc_nfc14100_nf14_energy_meter
 * dhc-nfc15100:IRVE32AMono → dhc_nfc15100_irve_32a_mono
 */
function classIdToBlockType(classId) {
  const [prefix, localName] = classId.split(":");
  const normalizedPrefix = prefix.replace(/-/g, "_");

  // Handle camelCase/PascalCase with acronym awareness:
  // Insert underscore before a capital that follows a lowercase, OR
  // before a capital that starts a new word after an acronym run
  const snake = localName
    // Insert _ between lowercase/digit and uppercase: "energy" + "Meter" → "energy_Meter"
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    // Insert _ between consecutive uppercase and a lowercase: "NF14E" + "nergy" → "NF14_Energy"
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();

  return `${normalizedPrefix}_${snake}`;
}

// ── Main ──

// Load overrides
let overrides = {};
if (fs.existsSync(OVERRIDES_PATH)) {
  overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf-8"));
}

// Parse Core TTL
const coreTtl = fs.readFileSync(TTL_PATH, "utf-8");
const coreEntities = parseTTL(coreTtl, "dhc");

// Index Core entities
const classMap = new Map();
const datatypeProps = [];
const objectProps = [];

for (const e of coreEntities) {
  if (e.type === "class") {
    classMap.set(e.id, { ...e, source: "core" });
  } else if (e.type === "datatypeProperty") {
    datatypeProps.push(e);
  } else if (e.type === "objectProperty") {
    objectProps.push(e);
  }
}

// Load modules
const modules = [];
if (fs.existsSync(MANIFEST_PATH)) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  for (const mod of manifest.modules) {
    const modTtlPath = path.resolve(MODULES_DIR, mod.file);
    if (!fs.existsSync(modTtlPath)) {
      console.warn(`Warning: Module TTL not found: ${modTtlPath}`);
      continue;
    }
    const modTtl = fs.readFileSync(modTtlPath, "utf-8");
    const prefix = mod.id; // e.g. "dhc-nfc14100-electrical" → we need the TTL prefix
    // Extract the module prefix from the TTL file
    const prefixMatch = modTtl.match(/@prefix\s+([\w-]+):\s+<[^>]+>\s*\./);
    const modPrefix = prefixMatch ? prefixMatch[1] : null;

    if (!modPrefix || modPrefix === "dhc") {
      // Skip standard prefixes, find the module-specific one
      const allPrefixes = [...modTtl.matchAll(/@prefix\s+([\w-]+):\s+<[^>]+>\s*\./g)];
      const modulePrefix = allPrefixes.find(
        (p) => !["dhc", "owl", "rdf", "rdfs", "xsd", "dcterms"].includes(p[1])
      );
      if (modulePrefix) {
        const entities = parseTTL(modTtl, modulePrefix[1]);
        for (const e of entities) {
          if (e.type === "class") {
            classMap.set(e.id, { ...e, source: "module", moduleId: mod.id, toolboxCategory: mod.toolboxCategory });
          } else if (e.type === "datatypeProperty") {
            datatypeProps.push(e);
          } else if (e.type === "objectProperty") {
            objectProps.push(e);
          }
        }
        modules.push({ ...mod, prefix: modulePrefix[1] });
      }
    } else {
      const entities = parseTTL(modTtl, modPrefix);
      for (const e of entities) {
        if (e.type === "class") {
          classMap.set(e.id, { ...e, source: "module", moduleId: mod.id, toolboxCategory: mod.toolboxCategory });
        } else if (e.type === "datatypeProperty") {
          datatypeProps.push(e);
        } else if (e.type === "objectProperty") {
          objectProps.push(e);
        }
      }
      modules.push({ ...mod, prefix: modPrefix });
    }
  }
}

// Determine scope
const scope = overrides.scope || DEFAULT_SCOPE;

// Determine which classes get blocks
function getEffectiveView(cls) {
  const localName = cls.id.split(":").pop();
  if (overrides.viewOverrides && overrides.viewOverrides[localName]) {
    return overrides.viewOverrides[localName];
  }
  return cls.view || null;
}

function isInScope(cls) {
  const view = getEffectiveView(cls);
  if (!view) {
    if (scope.includes("shared")) {
      const localName = cls.id.split(":").pop();
      const sharedClasses = overrides.sharedClasses || [
        "Equipment",
        "EquipmentType",
      ];
      return sharedClasses.includes(localName);
    }
    return false;
  }
  return scope.includes(view);
}

/**
 * Collect inherited containment and reference properties for a class.
 * Walks up the superclass chain and collects object properties from parent classes.
 */
function getInheritedObjectProps(classId) {
  const inherited = [];
  const visited = new Set();
  let current = classMap.get(classId);

  while (current && current.superClass && !visited.has(current.superClass)) {
    visited.add(current.superClass);
    const parent = classMap.get(current.superClass);
    if (parent) {
      // Collect object properties where the parent is the domain
      const parentObjProps = objectProps.filter((p) => p.domain === current.superClass);
      inherited.push(...parentObjProps);
    }
    current = parent;
  }

  return inherited;
}

// Build Blockly block definitions
const blocklyBlocks = [];
const toolboxCategories = {};
const moduleToolboxCategories = {};

for (const [classId, cls] of classMap) {
  if (!isInScope(cls)) continue;

  const blockType = classIdToBlockType(classId);
  const effectiveView = getEffectiveView(cls) || "shared";
  const colour = VIEW_COLOURS[effectiveView] || VIEW_COLOURS.shared;

  // Apply label overrides from blockly-overrides.json
  const classLabel = (overrides.labelOverrides && overrides.labelOverrides[classId])
    ? overrides.labelOverrides[classId]
    : cls.label;

  // Collect datatype properties for this class (direct + inherited from superclass chain)
  const directDataProps = datatypeProps.filter((p) => p.domain === classId);
  const inheritedDataProps = [];
  if (cls.source === "module" && cls.superClass) {
    // Inherit datatype properties from parent Core class
    const visited = new Set();
    let parentId = cls.superClass;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      inheritedDataProps.push(...datatypeProps.filter((p) => p.domain === parentId));
      const parent = classMap.get(parentId);
      parentId = parent ? parent.superClass : null;
    }
  }
  const classDataProps = [...directDataProps, ...inheritedDataProps];

  // Collect object properties (direct + inherited)
  const directObjProps = objectProps.filter((p) => p.domain === classId);
  const inheritedObjProps = cls.source === "module" ? getInheritedObjectProps(classId) : [];
  const classObjectProps = [...directObjProps, ...inheritedObjProps];

  // Build block definition
  const blockDef = {
    type: blockType,
    ontologyClass: classId,
    designView: effectiveView,
    colour: colour,
    message0: "",
    args0: [],
    inputsInline: false,
    tooltip: cls.comment || classLabel,
  };

  const messageParts = [];
  const args = [];
  let argIndex = 0;

  // LABEL field (always first)
  messageParts.push(`${classLabel} %${argIndex + 1}`);
  args.push({
    type: "field_input",
    name: "LABEL",
    text: classLabel,
  });
  argIndex++;

  // Datatype property fields
  const seenProps = new Set();
  for (const dp of classDataProps) {
    if (seenProps.has(dp.id)) continue;
    seenProps.add(dp.id);

    const dpLocalName = dp.id
      .replace("dhc:", "")
      .replace(/([A-Z])/g, (m) => "_" + m)
      .toUpperCase();
    const fieldName = dpLocalName;
    const fieldType = XSD_TO_BLOCKLY[dp.range] || "field_input";

    // Check for dropdown overrides
    const overrideKey = dp.id.replace("dhc:", "");
    if (overrides.dropdowns && overrides.dropdowns[overrideKey]) {
      messageParts.push(`${dp.label} %${argIndex + 1}`);
      args.push({
        type: "field_dropdown",
        name: fieldName,
        options: overrides.dropdowns[overrideKey],
      });
    } else if (fieldType === "field_number") {
      const isInteger = dp.range === "xsd:integer";
      const fieldDef = {
        type: "field_number",
        name: fieldName,
        value: 0,
      };
      if (isInteger) {
        fieldDef.precision = 1;
      }
      // Check for default value overrides
      if (overrides.defaults && overrides.defaults[overrideKey] !== undefined) {
        fieldDef.value = overrides.defaults[overrideKey];
      }
      messageParts.push(`${dp.label} %${argIndex + 1}`);
      args.push(fieldDef);
    } else if (fieldType === "field_checkbox") {
      messageParts.push(`${dp.label} %${argIndex + 1}`);
      args.push({
        type: "field_checkbox",
        name: fieldName,
        checked: false,
      });
    } else {
      messageParts.push(`${dp.label} %${argIndex + 1}`);
      args.push({
        type: "field_input",
        name: fieldName,
        text: "",
      });
    }
    argIndex++;
  }

  // Apply moduleDefaults — override existing field values and add missing fields
  if (cls.source === "module" && overrides.moduleDefaults && overrides.moduleDefaults[classId]) {
    const defaults = overrides.moduleDefaults[classId];
    const existingFieldNames = new Set(args.map((a) => a.name));

    // First pass: update existing fields
    for (const arg of args) {
      if (defaults[arg.name] !== undefined) {
        const val = defaults[arg.name];
        if (arg.type === "field_number") {
          arg.value = val;
        } else if (arg.type === "field_input") {
          arg.text = String(val);
        } else if (arg.type === "field_dropdown") {
          arg.default = String(val);
        }
      }
    }

    // Second pass: add fields that don't exist yet (from moduleDefaults)
    for (const [fieldName, val] of Object.entries(defaults)) {
      if (!existingFieldNames.has(fieldName)) {
        // Look up the property in the ontology to get label and type
        const propLocalName = fieldName.toLowerCase().replace(/_/g, "");
        const matchingProp = datatypeProps.find((p) => {
          const pName = p.id.replace("dhc:", "").toLowerCase();
          return pName === propLocalName;
        });

        const propLabel = matchingProp ? matchingProp.label : fieldName.replace(/_/g, " ").toLowerCase();
        const overrideKey = matchingProp ? matchingProp.id.replace("dhc:", "") : null;

        // Check if this should be a dropdown
        if (overrideKey && overrides.dropdowns && overrides.dropdowns[overrideKey]) {
          messageParts.push(`${propLabel} %${argIndex + 1}`);
          const dropdownArg = {
            type: "field_dropdown",
            name: fieldName,
            options: overrides.dropdowns[overrideKey],
            default: String(val),
          };
          args.push(dropdownArg);
        } else if (typeof val === "number") {
          messageParts.push(`${propLabel} %${argIndex + 1}`);
          args.push({
            type: "field_number",
            name: fieldName,
            value: val,
          });
        } else {
          messageParts.push(`${propLabel} %${argIndex + 1}`);
          args.push({
            type: "field_input",
            name: fieldName,
            text: String(val),
          });
        }
        argIndex++;
      }
    }
  }

  blockDef.message0 = messageParts.join("\n");
  blockDef.args0 = args;

  // Statement inputs (containment properties)
  let extraMessageIndex = 1;
  const seenInputs = new Set();
  for (const op of classObjectProps) {
    if (CONTAINMENT_PROPERTIES.includes(op.id) && !seenInputs.has(op.id)) {
      seenInputs.add(op.id);
      const inputName = op.id.replace("dhc:", "").toUpperCase();
      const msgKey = `message${extraMessageIndex}`;
      const argsKey = `args${extraMessageIndex}`;
      blockDef[msgKey] = `${op.label} %1`;
      blockDef[argsKey] = [
        {
          type: "input_statement",
          name: inputName,
          check: op.range ? op.range.replace("dhc:", "dhc_") : null,
        },
      ];
      extraMessageIndex++;
    }
  }

  // Value inputs (reference properties)
  for (const op of classObjectProps) {
    if (REFERENCE_PROPERTIES.includes(op.id) && !seenInputs.has(op.id)) {
      seenInputs.add(op.id);
      const inputName = op.id.replace("dhc:", "").toUpperCase();
      const msgKey = `message${extraMessageIndex}`;
      const argsKey = `args${extraMessageIndex}`;
      blockDef[msgKey] = `${op.label} %1`;
      blockDef[argsKey] = [
        {
          type: "input_value",
          name: inputName,
          check: op.range ? op.range.replace("dhc:", "dhc_") : null,
        },
      ];
      extraMessageIndex++;
    }
  }

  // previousStatement / nextStatement
  blockDef.nextStatement = null;

  if (
    cls.superClass === "dhc:Equipment" ||
    classId === "dhc:Equipment"
  ) {
    // Equipment subclasses can appear in multiple contexts
    blockDef.previousStatement = "dhc_Equipment";
  } else if (cls.source === "module" && cls.superClass === "dhc:Circuit") {
    // Module circuit subclasses nest in DistributionBoard HASCIRCUIT like core Circuit
    blockDef.previousStatement = "dhc_Circuit";
  } else if (cls.source === "module" && cls.superClass === "dhc:ElectricalTechnicalSpace") {
    // Module technical spaces nest like Space
    blockDef.previousStatement = classIdToBlockType("dhc:ElectricalTechnicalSpace");
  } else {
    blockDef.previousStatement = blockType;
  }

  blocklyBlocks.push(blockDef);

  // Add to toolbox category
  if (cls.source === "module" && cls.toolboxCategory) {
    // Module blocks go into nested subcategories
    if (!moduleToolboxCategories[cls.toolboxCategory]) {
      moduleToolboxCategories[cls.toolboxCategory] = [];
    }
    moduleToolboxCategories[cls.toolboxCategory].push({
      kind: "block",
      type: blockType,
    });
  } else {
    const categoryKey = effectiveView;
    if (!toolboxCategories[categoryKey]) {
      toolboxCategories[categoryKey] = [];
    }
    toolboxCategories[categoryKey].push({
      kind: "block",
      type: blockType,
    });
  }
}

// Build the categoryToolbox structure
const toolboxConfig = {
  kind: "categoryToolbox",
  contents: [],
};

// Order: spatial, electrical (with module subcategories), shared
const categoryOrder = ["spatial", "electrical", "shared"];
for (const viewKey of categoryOrder) {
  if (toolboxCategories[viewKey] || (viewKey === "electrical" && Object.keys(moduleToolboxCategories).length > 0)) {
    const categoryContents = toolboxCategories[viewKey] ? [...toolboxCategories[viewKey]] : [];

    // For electrical view, add module subcategories
    if (viewKey === "electrical") {
      const electricalCategory = {
        kind: "category",
        name: VIEW_LABELS[viewKey] || viewKey,
        colour: VIEW_COLOURS[viewKey] || 0,
        contents: [
          // Core electrical blocks first
          ...categoryContents,
          // Module subcategories
          ...Object.entries(moduleToolboxCategories).map(([catName, blocks]) => ({
            kind: "category",
            name: catName,
            colour: VIEW_COLOURS.electrical,
            contents: blocks,
          })),
        ],
      };
      toolboxConfig.contents.push(electricalCategory);
    } else {
      toolboxConfig.contents.push({
        kind: "category",
        name: VIEW_LABELS[viewKey] || viewKey,
        colour: VIEW_COLOURS[viewKey] || 0,
        contents: categoryContents,
      });
    }
  }
}

// Add any remaining categories not in the order
for (const viewKey of Object.keys(toolboxCategories)) {
  if (!categoryOrder.includes(viewKey)) {
    toolboxConfig.contents.push({
      kind: "category",
      name: VIEW_LABELS[viewKey] || viewKey,
      colour: VIEW_COLOURS[viewKey] || 0,
      contents: toolboxCategories[viewKey],
    });
  }
}

// Write output files
fs.writeFileSync(BLOCKS_OUT, JSON.stringify(blocklyBlocks, null, 2));
fs.writeFileSync(TOOLBOX_OUT, JSON.stringify(toolboxConfig, null, 2));

const coreBlockCount = blocklyBlocks.filter((b) => !b.ontologyClass.includes("-")).length;
const moduleBlockCount = blocklyBlocks.length - coreBlockCount;
console.log(`Generated ${blocklyBlocks.length} Blockly block definitions (${coreBlockCount} core + ${moduleBlockCount} module)`);
console.log(
  `Toolbox categories: ${toolboxConfig.contents.map((c) => c.name).join(", ")}`
);
if (modules.length > 0) {
  console.log(`Modules loaded: ${modules.map((m) => m.id).join(", ")}`);
}
console.log(`Output: ${BLOCKS_OUT}`);
console.log(`Output: ${TOOLBOX_OUT}`);
