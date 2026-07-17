#!/usr/bin/env node
/**
 * build-abox.mjs — turn an A-Box TTL into graph.json + report.json for the viewer.
 *
 *   node js-tools/build-abox.mjs [schema/abox/<file>.ttl]
 *
 * Why a Node step at all, rather than parsing in the browser: SHACL validation
 * cannot run client-side here — rdf-validate-shacl depends on @zazuko/env-node,
 * which is Node-only. Doing the work here means the viewer reuses
 * tests/_helpers/loadGraph.js — the exact code behind the passing test suite —
 * so the picture on screen and `npm test` cannot disagree. It also means the
 * page only fetches JSON and needs no RDF library at all.
 *
 * This is a separate generator from the Modeler's, deliberately. The Modeler
 * draws a T-Box: its links come from class-level schema (rdfs:domain →
 * rdfs:range on dhc: object properties) and its parser drops every subject not
 * in the dhc: namespace. An A-Box needs the opposite — links from the instance
 * triples themselves, and no namespace filter at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readTtl, parseToStore, validateAgainst, repoRoot, namedNode } from '../tests/_helpers/loadGraph.js';

const RDF   = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS  = 'http://www.w3.org/2000/01/rdf-schema#';
const DHC   = 'https://digitalhome.cloud/ontology#';

const PREFIXES = {
  'https://digitalhome.cloud/ontology#': 'dhc',
  'https://brickschema.org/schema/Brick#': 'brick',
  'https://w3id.org/rec#': 'rec',
  'http://data.ashrae.org/standard223#': 's223',
  'http://qudt.org/vocab/unit/': 'unit',
  'http://www.w3.org/2000/01/rdf-schema#': 'rdfs',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#': 'rdf',
  'http://www.w3.org/2001/XMLSchema#': 'xsd',
  'https://digitalhome.cloud/cbox/nfc15100#': 'nfc15100',
  'https://digitalhome.cloud/cbox/nfc14100#': 'nfc14100',
};

const curie = (iri) => {
  for (const [ns, p] of Object.entries(PREFIXES)) if (iri.startsWith(ns)) return `${p}:${iri.slice(ns.length)}`;
  // A-Box individuals live under an ex: base that varies per file
  const m = /^https?:\/\/example\.org\/[^/]*\/?(.+)$/.exec(iri);
  return m ? `ex:${m[1]}` : iri;
};

// Every A-Box in schema/abox/ is built, so the viewer can switch source without
// a rebuild (validation is server-side — it cannot re-run in the page). An
// argument only decides which one the viewer opens first.
const ABOX_DIR = 'schema/abox';
const allAbox = fs.readdirSync(path.join(repoRoot, ABOX_DIR))
  .filter((f) => f.endsWith('.ttl'))
  .sort()
  .map((f) => `${ABOX_DIR}/${f}`);

if (allAbox.length === 0) {
  console.error(`✗ no .ttl files in ${ABOX_DIR}/`);
  process.exit(2);
}

const arg = process.argv[2];
const firstRel = arg ? (arg.startsWith('schema/') ? arg : `${ABOX_DIR}/${arg}`) : allAbox[0];
if (arg && !allAbox.includes(firstRel)) {
  console.error(`✗ ${firstRel} not found in ${ABOX_DIR}/`);
  process.exit(2);
}

// ── T-Box, loaded once ────────────────────────────────────────────────────
// Core + app-metadata only: enough for the rdf:type → dhc:designView join.
// Brick+extensions.ttl (3.5 MB) is deliberately NOT loaded — it contributes
// nothing to colouring and would dominate the build time.
const tboxTtl = readTtl('schema/tbox/dhc-core.ttl');
const metaTtl = readTtl('schema/tbox/dhc-app-metadata.ttl');
const tbox = parseToStore(tboxTtl + '\n' + metaTtl);

const viewOf = new Map();
for (const q of tbox.match(null, namedNode(`${DHC}designView`), null)) {
  viewOf.set(q.subject.value, q.object.value);
}

// ── shapes, loaded once ───────────────────────────────────────────────────
const SHACL = 'http://www.w3.org/ns/shacl#';
const shapeFiles = fs.readdirSync(path.join(repoRoot, 'schema/cbox/electrical'))
  .filter((f) => f.endsWith('.shapes.ttl'));

// Which classes does the C-Box actually LOOK AT? A node of any other class is
// never a focus node, so no shape can ever complain about it — that is a gap in
// norm coverage, not a pass. SHACL only reports failures, so "no violation" is
// indistinguishable from "never checked" unless we compute this set.
const targetClasses = new Set();
for (const f of shapeFiles) {
  const s = parseToStore(readTtl(`schema/cbox/electrical/${f}`));
  for (const q of s.match(null, namedNode(`${SHACL}targetClass`), null)) {
    targetClasses.add(curie(q.object.value));
  }
}

async function validate(aboxTtl) {
  const violationsByNode = new Map();
  const allResults = [];
  let conforms = true;
  for (const f of shapeFiles) {
    const shapes = readTtl(`schema/cbox/electrical/${f}`);
    // The T-Box must be in the DATA graph: shapes reference dhc:Norm instances
    // by sh:class / sh:hasValue, and SHACL resolves those against the data, not
    // the shapes graph. tests/_helpers withTbox() does the same.
    const { conforms: ok, results } = await validateAgainst(shapes, tboxTtl + '\n' + aboxTtl);
    if (!ok) conforms = false;
    for (const r of results) {
      const rec = {
        profile: f.replace('.shapes.ttl', ''),
        focus: r.focus,
        focusCurie: r.focus ? curie(r.focus) : null,
        // sh:or guards report the named shape but no message; plain sh:property
        // shapes report a blank-node sourceShape but DO carry path + message.
        // Keep both so the viewer can always say something useful.
        shape: r.sourceShape?.startsWith('http') ? curie(r.sourceShape) : null,
        path: r.path ? curie(r.path) : null,
        message: r.message || null,
      };
      allResults.push(rec);
      if (r.focus) {
        if (!violationsByNode.has(r.focus)) violationsByNode.set(r.focus, []);
        violationsByNode.get(r.focus).push(rec);
      }
    }
  }
  return { conforms, allResults, violationsByNode };
}


// ── build one A-Box's graph ───────────────────────────────────────────────
// Nodes: every NamedNode that is the subject of an rdf:type in the A-Box.
// Links: every A-Box triple whose object is another such NamedNode.
// Blank nodes are NOT nodes — the A-Box uses them for Brick entity properties
// (brick:tilt [ brick:hasUnit unit:DEG ; brick:value "30" ]); rendered they
// would be ~30 unlabelled dots. They are inlined onto the subject instead.
async function buildOne(rel) {
  const aboxTtl = readTtl(rel);
  const abox = parseToStore(aboxTtl);
  const { conforms, allResults, violationsByNode } = await validate(aboxTtl);

  const nodes = new Map();
  const ensure = (iri) => {
    if (!nodes.has(iri)) {
      nodes.set(iri, {
        id: iri, curie: curie(iri), label: null,
        types: [], designView: null, literals: {}, violations: [],
        checked: false, compliance: 'gap',
      });
    }
    return nodes.get(iri);
  };

  for (const q of abox.match(null, namedNode(`${RDF}type`), null)) {
    if (q.subject.termType !== 'NamedNode') continue;
    const n = ensure(q.subject.value);
    n.types.push(curie(q.object.value));
    const v = viewOf.get(q.object.value);
    if (v && !n.designView) n.designView = v;
  }

  const inlineBnode = (bn) => {
    const parts = [];
    for (const q of abox.match(bn, null, null)) {
      const p = curie(q.predicate.value);
      parts.push(`${p}=${q.object.termType === 'NamedNode' ? curie(q.object.value) : q.object.value}`);
    }
    return parts.join(' ');
  };

  const links = [];
  for (const q of abox.match(null, null, null)) {
    if (q.subject.termType !== 'NamedNode') continue;
    const p = q.predicate.value;
    if (p === `${RDF}type`) continue;
    const n = nodes.get(q.subject.value);
    if (!n) continue;

    if (q.object.termType === 'NamedNode') {
      if (nodes.has(q.object.value)) {
        links.push({ source: q.subject.value, target: q.object.value, property: curie(p) });
      } else {
        // points at something outside the A-Box (a Norm, a medium, a unit) —
        // an attribute of this node, not a topology edge
        n.literals[curie(p)] = curie(q.object.value);
      }
    } else if (q.object.termType === 'BlankNode') {
      n.literals[curie(p)] = inlineBnode(q.object);
    } else {
      if (p === `${RDFS}label`) n.label = q.object.value;
      else n.literals[curie(p)] = q.object.value;
    }
  }

  for (const [iri, v] of violationsByNode) {
    const n = nodes.get(iri);
    if (n) n.violations = v;
  }

  // ── compliance state ────────────────────────────────────────────────────
  // danger : a shape rejected it
  // ok     : a shape actually looked at it (its class is an sh:targetClass) and
  //          did not complain
  // gap    : NO shape targets its class, so nothing ever checked it. This is
  //          NOT a pass. SHACL reports only failures, so silence here means
  //          "unknown", and calling that green would be the same vacuous-green
  //          mistake documented in doc/prototyping-poc.md.
  for (const n of nodes.values()) {
    n.checked = n.types.some((t) => targetClasses.has(t));
    n.compliance = n.violations.length ? 'danger' : (n.checked ? 'ok' : 'gap');
  }

  const nodeList = [...nodes.values()].map((n) => ({ ...n, label: n.label || n.curie }));
  const tally = { ok: 0, gap: 0, danger: 0 };
  for (const n of nodeList) tally[n.compliance]++;

  return {
    graph: {
      version: JSON.parse(readTtl('package.json')).version,
      source: rel,
      generatedAt: new Date().toISOString(),
      targetClasses: [...targetClasses].sort(),
      tally,
      nodes: nodeList,
      links,
    },
    report: {
      source: rel,
      generatedAt: new Date().toISOString(),
      profiles: shapeFiles.map((f) => f.replace('.shapes.ttl', '')),
      conforms,
      violationCount: allResults.length,
      tally,
      results: allResults,
    },
  };
}

// ── build every A-Box ─────────────────────────────────────────────────────
const slug = (rel) => path.basename(rel, '.ttl');
const outDir = path.join(repoRoot, 'js-tools/data');
fs.mkdirSync(outDir, { recursive: true });

const index = { generatedAt: new Date().toISOString(), first: slug(firstRel), sources: [] };
let anyEmpty = false;

for (const rel of allAbox) {
  const { graph, report } = await buildOne(rel);
  const s = slug(rel);
  fs.writeFileSync(path.join(outDir, `${s}.graph.json`), JSON.stringify(graph, null, 2));
  fs.writeFileSync(path.join(outDir, `${s}.report.json`), JSON.stringify(report, null, 2));

  const circuits = graph.nodes.filter((n) => n.types.includes('dhc:Circuit')).length;
  index.sources.push({
    slug: s, source: rel, label: s.replace(/-/g, ' '),
    nodes: graph.nodes.length, links: graph.links.length,
    conforms: report.conforms, violations: report.violationCount, tally: graph.tally,
  });

  console.log(`  ${rel}`);
  console.log(`    nodes ${graph.nodes.length}  links ${graph.links.length}  circuits ${circuits}`);
  console.log(`    compliance  ok ${graph.tally.ok}   gap ${graph.tally.gap}   danger ${graph.tally.danger}`);
  console.log(`    conforms ${report.conforms}  violations ${report.violationCount}`);
  for (const r of report.results) console.log(`      ✗ ${r.focusCurie ?? '?'}  ${r.shape ?? r.path ?? ''}`);

  // An A-Box with no nodes or no links renders as a clean, entirely plausible
  // empty canvas, and SHACL reports conforms:true because it selected nothing.
  // Fail loudly — that exact silent-green failure has shipped here repeatedly.
  if (!graph.nodes.length || !graph.links.length) {
    console.error(`    ✗ EMPTY — the viewer would render nothing and look fine doing it`);
    anyEmpty = true;
  }
}

fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2));
console.log(`\n  shapes target: ${[...targetClasses].sort().join(', ')}`);
console.log(`  → js-tools/data/  (${index.sources.length} source(s) + index.json)`);
if (anyEmpty) process.exit(1);
