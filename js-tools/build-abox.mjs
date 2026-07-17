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
const BRICK = 'https://brickschema.org/schema/Brick#';
const S223  = 'http://data.ashrae.org/standard223#';

const PREFIXES = {
  'https://digitalhome.cloud/ontology#': 'dhc',
  'https://brickschema.org/schema/Brick#': 'brick',
  'https://w3id.org/rec#': 'rec',
  'http://data.ashrae.org/standard223#': 's223',
  'http://qudt.org/vocab/unit/': 'unit',
  'http://www.w3.org/2000/01/rdf-schema#': 'rdfs',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#': 'rdf',
  'http://www.w3.org/2001/XMLSchema#': 'xsd',
  // One namespace per EDITION for anything but the base: a delta profile must
  // not reuse the base's shape IRIs, or concatenating the two would merge two
  // editions' constraints onto one shape and the comparison would answer the
  // wrong question. Longest-prefix order matters — nfc15100-2024# would never
  // match if nfc15100# were tested first, but they are distinct namespaces so
  // neither is a prefix of the other.
  'https://digitalhome.cloud/cbox/nfc15100-2024#': 'nfc15100-2024',
  'https://digitalhome.cloud/cbox/nfc15100#': 'nfc15100',
  'https://digitalhome.cloud/cbox/nfc14100#': 'nfc14100',
};

const curie = (iri) => {
  for (const [ns, p] of Object.entries(PREFIXES)) if (iri.startsWith(ns)) return `${p}:${iri.slice(ns.length)}`;
  // A-Box individuals live under an example base that varies per file — the DHC
  // models use http://example.org/<slug>/ ; upstream Brick examples use all of
  // http://example.com/<slug># , http://example.com# , http://example.com/# .
  // Shorten anything on an example.(org|com) host to its trailing local name
  // rather than leaving a full IRI as the node label. Scoped to example hosts so
  // it never mangles a real vocabulary IRI (those are matched by PREFIXES
  // above; only instance IRIs reach this fallback).
  if (/^https?:\/\/example\.(?:org|com)[/#]/.test(iri)) {
    const local = iri.split(/[/#]/).filter(Boolean).pop();
    if (local) return `ex:${local}`;
  }
  return iri;
};

// ── what kind of relationship is this edge? ───────────────────────────────
// Four kinds, because they answer different questions and should not look alike:
//   spatial    — where a thing is
//   structural — what a thing is made of / belongs to
//   flow       — what energy actually moves through (drawn with moving particles)
//   control    — what commands what (drawn with moving blocks)
// Unlisted predicates become 'other' and are REPORTED at the end of the build
// rather than quietly bucketed, so a newly-modelled predicate shows up as a
// question instead of silently rendering as an ordinary line.
const EDGE_CLASS = {
  'rec:locatedIn': 'spatial',
  'rec:isLocationOf': 'spatial',
  'rec:includes': 'spatial',
  'rec:hasPart': 'spatial',
  'brick:hasLocation': 'spatial',
  'brick:isLocationOf': 'spatial',

  'brick:hasPart': 'structural',
  'brick:isPartOf': 'structural',
  'rec:isPartOf': 'structural',
  'dhc:hasProtection': 'structural',
  'dhc:hasWiring': 'structural',
  'dhc:hasCircuit': 'structural',
  's223:hasMember': 'structural',
  's223:hasConnectionPoint': 'structural',
  's223:contains': 'structural',
  's223:mapsTo': 'structural',
  // Metering topology: which meter measures / sub-meters which — structural, a
  // fixed hierarchy, not a live flow. Common across the submeter_hierarchies
  // and *_meter reference models.
  'brick:meters': 'structural',
  'brick:isMeteredBy': 'structural',
  'brick:hasSubMeter': 'structural',
  'brick:isSubMeterOf': 'structural',
  // Point attachment: an equipment "hosts" / "has point" a sensor or setpoint.
  // Which thing a point belongs to is structure; the command relation is
  // brick:controls (below).
  'brick:hosts': 'structural',
  'brick:isPointOf': 'structural',

  'brick:feeds': 'flow',
  'brick:isFedBy': 'flow',
  's223:connectsThrough': 'flow',
  's223:connectsTo': 'flow',
  's223:cnx': 'flow',
  'rec:sourcePoint': 'flow',

  'brick:controls': 'control',
  'brick:isControlledBy': 'control',
  'brick:hasPoint': 'control',
};
// Reported at build end so a newly-modelled predicate surfaces as a question.
// That discipline is OURS — external reference models use whatever upstream
// vocabulary they use, and we neither control it nor want to be nagged about it,
// so only our own files feed this set (see the `record` arg).
const unclassified = new Set();
const edgeClassOf = (c, record) => {
  const k = EDGE_CLASS[c];
  if (!k && record) unclassified.add(c);
  return k ?? 'other';
};

// Every A-Box in schema/abox/ is built, so the viewer can switch source without
// a rebuild (validation is server-side — it cannot re-run in the page). An
// argument only decides which one the viewer opens first.
const ABOX_DIR = 'schema/abox';
// Recursive, because reference models live in subfolders. The subfolder IS the
// signal: a .ttl directly under schema/abox/ is OURS — validated against the
// C-Box, held to the deliberate-defect discipline. A .ttl in any subfolder is an
// external REFERENCE (e.g. examples-brick-1.5/) — rendered so it can be browsed,
// but not validated (it carries no norm layer) and not held to our tests.
const walk = (dir) => fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? walk(`${dir}/${e.name}`)
    : e.name.endsWith('.ttl') ? [`${dir}/${e.name}`] : []);
const allAbox = walk(ABOX_DIR).sort();
const isReference = (rel) => rel.slice(ABOX_DIR.length + 1).includes('/');

if (allAbox.length === 0) {
  console.error(`✗ no .ttl files in ${ABOX_DIR}/`);
  process.exit(2);
}

// slug is a basename (subfolders flatten), so two files could collide and the
// second would silently overwrite the first's data. Refuse rather than pick.
{
  const bySlug = new Map();
  const clashes = [];
  for (const rel of allAbox) {
    const s = path.basename(rel, '.ttl');
    if (bySlug.has(s)) clashes.push(`${s}: ${bySlug.get(s)} and ${rel}`);
    bySlug.set(s, rel);
  }
  if (clashes.length) {
    console.error('✗ two A-Box files share a basename — their generated data would collide:');
    for (const c of clashes) console.error(`    ${c}`);
    process.exit(2);
  }
}

const arg = process.argv[2];
const firstRel = arg ? (arg.startsWith('schema/') ? arg : `${ABOX_DIR}/${arg}`) : allAbox[0];
if (arg && !allAbox.includes(firstRel)) {
  console.error(`✗ ${firstRel} not found in ${ABOX_DIR}/`);
  process.exit(2);
}

// ── T-Box, loaded once ────────────────────────────────────────────────────
// Core + app-metadata: the rdf:type → dhc:designView join and the norm-edition
// chain (dhc:editionOf / dhc:latestEdition).
const tboxTtl = readTtl('schema/tbox/dhc-core.ttl');
const metaTtl = readTtl('schema/tbox/dhc-app-metadata.ttl');
const tbox = parseToStore(tboxTtl + '\n' + metaTtl);

const viewOf = new Map();
for (const q of tbox.match(null, namedNode(`${DHC}designView`), null)) {
  viewOf.set(q.subject.value, q.object.value);
}

// ── the norm-edition chain ────────────────────────────────────────────────
// Compliance is COMPUTED here, not declared by the A-Box. The A-Box says what
// is built; the T-Box says which editions exist and which shapes implement
// each; this file validates against every implemented edition and compares the
// verdicts. Passing the latest is compliant. Passing an older one but failing
// the latest is GRANDFATHERED — lawful as built, re-qualified the moment anyone
// modifies it, which is the state most of a real building is in.
//
// dhc:builtUnder does NOT decide this. An earlier design made it the verdict
// source, which asked the modeller to know something a surveyed installation
// rarely records. It is back on a narrower footing — optional EVIDENCE that
// only refines what "fails the edition in force" means (grandfathered vs.
// illegal-as-built vs. unknown). The computation above is what actually judges
// compliance; see the state machine in buildOne().
//
//   dhc:editionOf     edition → its norm
//   dhc:latestEdition norm    → the edition in force
//   dhc:supersedes    edition → the one it replaces  (the upgrade path)
//   dhc:shapesFile    edition → the shapes implementing it
// Each of these is functional — one norm has one edition in force, one edition
// has one predecessor and one shapes file. RDF does not know that. A second
// triple would make Map.set silently keep the LAST one, and the consequences
// are all invisible: a duplicate dhc:shapesFile means one of the two files
// never runs; a duplicate dhc:supersedes drops a branch of the chain out of
// effectiveShapes, so an edition quietly enforces fewer rules and more nodes
// pass. Fail on the ambiguity rather than pick.
const single = (pred, label) => {
  const m = new Map();
  const dupes = [];
  for (const q of tbox.match(null, namedNode(`${DHC}${pred}`), null)) {
    if (m.has(q.subject.value)) dupes.push(`${curie(q.subject.value)} → ${curie(m.get(q.subject.value))} AND ${curie(q.object.value)}`);
    m.set(q.subject.value, q.object.value);
  }
  if (dupes.length) {
    console.error(`✗ dhc:${pred} is not functional in the T-Box — ${label}:`);
    for (const d of dupes) console.error(`    ${d}`);
    process.exit(2);
  }
  return m;
};
const editionOf     = single('editionOf', 'an edition belonging to two norms cannot be compared to either');
const latestEdition = single('latestEdition', 'a norm with two editions in force has none');
const supersedes    = single('supersedes', 'a dropped branch means an edition enforces fewer rules and more nodes pass');
const shapesFileOf  = single('shapesFile', 'one of the two files would never run, and SHACL is silent about shapes that never ran');

if (latestEdition.size === 0) {
  // Every governed node would silently fall back to "edition undeclared". The
  // property was defined but never asserted for exactly this long, so guard it.
  console.error('✗ no dhc:latestEdition asserted in the T-Box — every node would report an undeclared edition');
  process.exit(2);
}
if (shapesFileOf.size === 0) {
  console.error('✗ no dhc:NormEdition declares a dhc:shapesFile — nothing would be validated, and SHACL would report conforms:true');
  process.exit(2);
}

// ── equipment, derived from the class hierarchy ───────────────────────────
// The viewer draws equipment as boxes and everything else as spheres. Which is
// which is read from the ontology, never hand-listed: brick:Equipment and
// s223:Equipment plus their transitive subclasses. That correctly excludes
// dhc:Circuit (⊑ s223:System), dhc:WiringSegment (⊑ s223:Connection) and
// dhc:Socket (⊑ s223:ElectricityOutlet) — none of which are devices — and it
// cannot drift when a class is added. Costs ~1s to parse Brick+extensions.ttl.
const hierarchy = parseToStore(tboxTtl + '\n' + readTtl('schema/tbox/Brick+extensions.ttl'));
const equipment = new Set([`${BRICK}Equipment`, `${S223}Equipment`]);
for (let grew = true; grew; ) {
  grew = false;
  for (const q of hierarchy.match(null, namedNode(`${RDFS}subClassOf`), null)) {
    if (equipment.has(q.object.value) && !equipment.has(q.subject.value)) {
      equipment.add(q.subject.value);
      grew = true;
    }
  }
}
const equipmentCuries = new Set([...equipment].map(curie));

// ── shapes, driven by editions ────────────────────────────────────────────
// The T-Box's dhc:shapesFile is the authority on which shapes exist, NOT the
// directory listing. Reading the directory would happily validate a file no
// edition claims — and then we could not say which edition its verdict was
// about, which is the whole question here.
const SHACL = 'http://www.w3.org/ns/shacl#';
const CBOX_DIR = 'schema/cbox/electrical';

// Both directions of the disk↔T-Box join must fail loudly. A missing file means
// an edition silently stops being validated; an unclaimed file means shapes run
// under no edition, or (worse) stop running when the driver changed and nobody
// notices, because SHACL's answer to "nothing ran" is conforms:true.
const onDisk = new Set(fs.readdirSync(path.join(repoRoot, CBOX_DIR)).filter((f) => f.endsWith('.shapes.ttl')));
const claimed = new Set();
const missing = [];
for (const [edition, rel] of shapesFileOf) {
  const base = path.basename(rel);
  if (!fs.existsSync(path.join(repoRoot, 'schema', rel))) missing.push(`${curie(edition)} → schema/${rel}`);
  else claimed.add(base);
}
if (missing.length) {
  console.error(`✗ dhc:shapesFile names ${missing.length} file(s) that do not exist — that edition would silently stop being checked:`);
  for (const m of missing) console.error(`    ${m}`);
  process.exit(2);
}
const unclaimed = [...onDisk].filter((f) => !claimed.has(f));
if (unclaimed.length) {
  console.error(`✗ ${unclaimed.length} shapes file(s) on disk that no dhc:NormEdition claims via dhc:shapesFile:`);
  for (const f of unclaimed) console.error(`    ${CBOX_DIR}/${f}`);
  console.error('  Every shapes file must be bound to the edition it implements, or its verdict means nothing.');
  process.exit(2);
}

// The effective rule set for an edition is its own file plus every file down
// the dhc:supersedes chain. 2024 ships only its DELTA over 2015; concatenating
// ANDs the constraints, so an edition can add or tighten but never loosen —
// documented in nfc15100-2024.shapes.ttl's header and doc/parking-lot.md.
function effectiveShapes(edition) {
  const parts = [];
  const seen = new Set();
  for (let e = edition; e && !seen.has(e); e = supersedes.get(e)) {
    seen.add(e);
    const rel = shapesFileOf.get(e);
    if (rel) parts.push(readTtl(`schema/${rel}`));
  }
  return parts.join('\n');
}

// One run per edition that implements shapes, ordered oldest → newest so that
// "violates the oldest we hold" (never was compliant) can be told apart from
// "violates only the newest" (grandfathered).
// The `seen` guard is not decoration. effectiveShapes() has one; without the
// same here a dhc:supersedes cycle spins forever with no output — and the T-Box
// test only rejects self-supersession (A → A), so a two-edition cycle
// (A → B → A) passes every test and hangs the build.
const chainDepth = (e) => {
  const seen = new Set();
  let d = 0;
  for (let c = e; c && supersedes.get(c) && !seen.has(c); c = supersedes.get(c)) { seen.add(c); d++; }
  return d;
};
const runs = [...shapesFileOf.keys()]
  .map((edition) => ({
    edition,
    norm: editionOf.get(edition),
    depth: chainDepth(edition),
    shapesTtl: effectiveShapes(edition),
  }))
  .sort((a, b) => a.depth - b.depth);

// Which classes does each edition actually LOOK AT? A node of any other class is
// never a focus node, so no shape can ever complain about it — that is a gap in
// norm coverage, not a pass. SHACL only reports failures, so "no violation" is
// indistinguishable from "never checked" unless we compute this set. Tracked
// per edition now, because an edition can WIDEN coverage: NF C 15-100:2024
// brings energy storage into scope, so a battery is a focus node under 2024 and
// under nothing at all in 2015.
const targetClasses = new Set();                 // union, for the "checked at all" question
for (const r of runs) {
  r.targets = new Set();
  const s = parseToStore(r.shapesTtl);
  for (const q of s.match(null, namedNode(`${SHACL}targetClass`), null)) {
    r.targets.add(curie(q.object.value));
    targetClasses.add(curie(q.object.value));
  }
}

// Per norm: the editions we can actually check, oldest first, and whether the
// newest of them IS the edition in force. If it is not, no node under that norm
// can honestly be called compliant-with-current — we simply do not hold the
// rules. That is the C-Box's gap, not the building's, so it is an opacity
// channel in the viewer rather than a colour.
const implementedByNorm = new Map();
for (const r of runs) {
  if (!implementedByNorm.has(r.norm)) implementedByNorm.set(r.norm, []);
  implementedByNorm.get(r.norm).push(r);
}
const editionCoverage = [];
for (const [norm, rs] of implementedByNorm) {
  const newest = rs[rs.length - 1];
  const latest = latestEdition.get(norm);
  editionCoverage.push({
    norm: curie(norm),
    implements: rs.map((r) => curie(r.edition)),
    newestImplemented: curie(newest.edition),
    latest: latest ? curie(latest) : null,
    // The only question that matters: can we speak to the edition in force?
    assessable: !!latest && latest === newest.edition,
  });
}

// Note there is no aggregate `conforms` here. SHACL's own per-run boolean is
// the wrong shape for the question: a violation under a SUPERSEDED edition is
// the grandfathering signal, not non-compliance, so OR-ing the runs together
// answers nothing. Folding a four-state lattice to a boolean is only honest
// once the states exist — so the caller does it, as "no node is danger".
async function validate(aboxTtl) {
  const violationsByNode = new Map();
  const allResults = [];
  // focus IRI → Set of edition IRIs it violates
  const violatedEditions = new Map();
  for (const r of runs) {
    // The T-Box must be in the DATA graph: shapes reference dhc:Norm instances
    // by sh:class / sh:hasValue, and SHACL resolves those against the data, not
    // the shapes graph. tests/_helpers withTbox() does the same.
    const { results } = await validateAgainst(r.shapesTtl, tboxTtl + '\n' + aboxTtl);
    for (const res of results) {
      const rec = {
        edition: curie(r.edition),
        norm: curie(r.norm),
        profile: path.basename(shapesFileOf.get(r.edition), '.shapes.ttl'),
        focus: res.focus,
        focusCurie: res.focus ? curie(res.focus) : null,
        // sh:or guards report the named shape but no message; plain sh:property
        // shapes report a blank-node sourceShape but DO carry path + message.
        // Keep both so the viewer can always say something useful.
        shape: res.sourceShape?.startsWith('http') ? curie(res.sourceShape) : null,
        path: res.path ? curie(res.path) : null,
        message: res.message || null,
      };
      allResults.push(rec);
      if (res.focus) {
        if (!violatedEditions.has(res.focus)) violatedEditions.set(res.focus, new Set());
        violatedEditions.get(res.focus).add(r.edition);
        if (!violationsByNode.has(res.focus)) violationsByNode.set(res.focus, []);
        violationsByNode.get(res.focus).push(rec);
      }
    }
  }
  return { allResults, violationsByNode, violatedEditions };
}


// ── build one A-Box's graph ───────────────────────────────────────────────
// Nodes: every NamedNode that is the subject of an rdf:type in the A-Box.
// Links: every A-Box triple whose object is another such NamedNode.
// Blank nodes are NOT nodes — the A-Box uses them for Brick entity properties
// (brick:tilt [ brick:hasUnit unit:DEG ; brick:value "30" ]); rendered they
// would be ~30 unlabelled dots. They are inlined onto the subject instead.
async function buildOne(rel, reference = false) {
  const aboxTtl = readTtl(rel);
  const abox = parseToStore(aboxTtl);
  // Reference models are not governed by the C-Box, so validating them is both
  // pointless (they have no dhc: focus nodes) and slow (soda_brick is 5.5k
  // lines). Skip it: every node ends up 'unchecked', which is the truthful
  // state — no norm layer has an opinion on a stock Brick model.
  const { allResults, violationsByNode, violatedEditions } = reference
    ? { allResults: [], violationsByNode: new Map(), violatedEditions: new Map() }
    : await validate(aboxTtl);

  const nodes = new Map();
  const ensure = (iri) => {
    if (!nodes.has(iri)) {
      nodes.set(iri, {
        id: iri, curie: curie(iri), label: null,
        // types are curies for display; typeIris keeps the full IRIs because the
        // subclass closure has to be walked in the same terms the data graph
        // uses. Shortening first and matching on strings is what let a node
        // SHACL had rejected report "nothing looked at it".
        types: [], typeIris: [], designView: null, literals: {}, violations: [],
        checked: false, compliance: 'unchecked', complianceWhy: null,
        ghosted: false, shape: 'sphere',
      });
    }
    return nodes.get(iri);
  };

  // The ontology header triple (<...> a owl:Ontology) is document metadata, not
  // an A-Box individual — the same category as the blank nodes excluded below.
  // Upstream Brick examples carry one; rendered it is a lone unconnected node
  // labelled with a full IRI. This viewer shows instances, so skip it.
  const OWL_ONTOLOGY = 'http://www.w3.org/2002/07/owl#Ontology';
  for (const q of abox.match(null, namedNode(`${RDF}type`), null)) {
    if (q.subject.termType !== 'NamedNode') continue;
    if (q.object.value === OWL_ONTOLOGY) continue;
    const n = ensure(q.subject.value);
    n.types.push(curie(q.object.value));
    n.typeIris.push(q.object.value);
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

  // A predicate may legitimately repeat (ex:gtl is governedBy two norms, and
  // built under one edition of each). Assigning would keep only the last —
  // silently, and the inspector would look perfectly complete while lying.
  const addLit = (n, key, val) => {
    n.literals[key] = n.literals[key] ? `${n.literals[key]}, ${val}` : val;
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
        const c = curie(p);
        links.push({ source: q.subject.value, target: q.object.value, property: c, kind: edgeClassOf(c, !reference) });
      } else {
        // points at something outside the A-Box (a Norm, a NormEdition, a
        // medium, a unit) — an attribute of this node, not a topology edge
        addLit(n, curie(p), curie(q.object.value));
      }
    } else if (q.object.termType === 'BlankNode') {
      addLit(n, curie(p), inlineBnode(q.object));
    } else {
      if (p === `${RDFS}label`) n.label = q.object.value;
      else addLit(n, curie(p), q.object.value);
    }
  }

  for (const [iri, v] of violationsByNode) {
    const n = nodes.get(iri);
    if (n) n.violations = v;
  }

  // ── compliance state ────────────────────────────────────────────────────
  // COMPUTED, not declared. Nothing in the A-Box says which edition anything
  // was built to; the state falls out of validating against each edition's
  // shapes and comparing the verdicts.
  //
  // TWO CHANNELS, deliberately:
  //
  //   colour  — the verdict against the best edition we hold.
  //   opacity — whether we hold the edition actually in force.
  //
  // Folding them into one scale is a mistake this tool already made once: the
  // first cut painted "we have no rule for this" the same yellow as "built to
  // an older edition", and buried the actionable signal under 33 nodes of
  // ignorance. They are different claims and they belong on different axes.
  //
  //   danger    : violates the OLDEST edition we can check. It was never
  //               compliant, under any rules we hold. This is the emergency.
  //   gap       : passes an older edition, fails the newest we hold.
  //               GRANDFATHERED — lawful as built, re-qualified the moment
  //               anyone modifies or extends it. This is the state most of an
  //               existing building is in, and the one worth knowing BEFORE
  //               commissioning work. ex:circuit-ev is the worked example:
  //               10 mm² satisfies :2015 and fails :2024.
  //   ok        : passes the newest edition we hold.
  //   unchecked : no shape in ANY edition targets its class. NOT a pass —
  //               SHACL reports only failures, so silence here is
  //               indistinguishable from conformance. Colouring it green would
  //               be the vacuous-green mistake in doc/prototyping-poc.md.
  //
  // ghosted    : orthogonal to all four. Either nothing checked it, or the
  //              edition in force for its norm has no shapes at all, so no
  //              verdict against CURRENT is possible. NF C 14-100:2021 is
  //              exactly that — its nodes pass the 2008 rules we hold and we
  //              cannot speak to 2021, so they are green-but-ghosted rather
  //              than green. That is the C-Box's gap, not the building's.
  //
  // Note a node may declare dhc:governedBy and still be 'unchecked': the norm
  // claims jurisdiction, our C-Box has no rule. ex:board-resi9 is exactly that,
  // and the transparency is the C-Box coverage gap made visible.
  // sh:targetClass selects by SUBCLASS CLOSURE, and it resolves that closure
  // against the DATA graph — which here is tboxTtl + aboxTtl, nothing else.
  // Matching a node's asserted rdf:type against sh:targetClass by string
  // equality therefore answers a different question than the validator did.
  //
  // dhc:RCBO ⊑ dhc:RCD, so nfc15100:RCDSensitivityShape *does* select an RCBO —
  // but its type curie is 'dhc:RCBO' and the shape's target is 'dhc:RCD', so a
  // string match says "no shape targets this class" about a node SHACL just
  // rejected. The skill actively recommends RCBO ("satisfies all three for
  // free"), so this is a live trap, not a hypothetical.
  //
  // Deliberately NOT the `hierarchy` store used for the equipment closure: that
  // one includes Brick+extensions.ttl, which the validator never sees. Using it
  // here would claim SHACL selects Brick subtypes of brick:Battery. It does not
  // — Brick's hierarchy is not in the data graph.
  const dataGraph = parseToStore(tboxTtl + '\n' + aboxTtl);
  const superOf = new Map();
  const closure = (t) => {
    if (superOf.has(t)) return superOf.get(t);
    const seen = new Set([t]);
    for (const queue = [t]; queue.length; ) {
      for (const q of dataGraph.match(namedNode(queue.pop()), namedNode(`${RDFS}subClassOf`), null)) {
        if (!seen.has(q.object.value)) { seen.add(q.object.value); queue.push(q.object.value); }
      }
    }
    const curies = new Set([...seen].map(curie));
    superOf.set(t, curies);
    return curies;
  };
  // Every class this node answers to, asserted or inherited.
  const selectableAs = (n) => {
    const all = new Set();
    for (const t of n.typeIris) for (const c of closure(t)) all.add(c);
    return all;
  };

  const RANK = { ok: 0, gap: 1, danger: 2 };
  for (const n of nodes.values()) {
    const kinds = selectableAs(n);
    n.checked = [...kinds].some((t) => targetClasses.has(t));
    n.shape = n.types.some((t) => equipmentCuries.has(t)) ? 'box' : 'sphere';

    // Which norms are in play? TWO sources, and they answer different questions:
    //   targeting — a norm whose shapes actually select this node. ex:rcd-main
    //               declares no governedBy at all yet is checked by
    //               nfc15100:RCDSensitivityShape, so governedBy alone would miss it.
    //   declared  — a norm the node claims via dhc:governedBy. If nothing under
    //               that norm targets it, the norm claims jurisdiction and we
    //               hold no rule — which must not read as a clean bill of health.
    //               ex:gtl declares both NF C 14-100 and NF C 15-100; only the
    //               latter has a shape for a technical space.
    const targeting = [...implementedByNorm.entries()]
      .filter(([, rs]) => rs.some((r) => [...kinds].some((t) => r.targets.has(t))))
      .map(([norm]) => norm);
    const declared = [...abox.match(namedNode(n.id), namedNode(`${DHC}governedBy`), null)].map((q) => q.object.value);
    const norms = [...new Set([...targeting, ...declared])];

    const bad = violatedEditions.get(n.id) ?? new Set();

    // dhc:builtUnder is EVIDENCE, not a verdict. It only refines what "fails the
    // edition in force" means: with it, the failure is checkable (did the thing
    // pass the edition it claims to have been built to?); without it — the
    // normal case for a reverse-engineered installation — grandfathering cannot
    // be asserted, only suspected, and the node is ghosted to say so.
    const builtUnder = [...abox.match(namedNode(n.id), namedNode(`${DHC}builtUnder`), null)].map((q) => q.object.value);

    // THE FLOOR, and it is unconditional. If a shape rejected this node, it is
    // 'danger' — full stop, before any reasoning about which norm or edition
    // applies. The previous state machine had exactly this as its first branch;
    // dropping it meant a rejected node whose class matching failed for ANY
    // reason fell through to 'unchecked' and rendered near-transparent,
    // captioned "nothing looked at it", while n.violations held the rejection.
    // Reasoning is allowed to be wrong. It is not allowed to overrule a fact.
    if (n.violations.length && !norms.length) {
      n.compliance = 'danger';
      n.ghosted = false;
      n.complianceWhy = `rejected by ${n.violations.map((v) => `${v.edition} ${v.shape ?? v.path ?? ''}`.trim()).join(', ')} — though no edition appears to target ${n.types.join(', ')}, which means this tool's class matching disagrees with the validator's. The rejection is the fact; trust it.`;
      continue;
    }

    const per = [];
    for (const norm of norms) {
      // Only the editions that actually target this node's class. An edition
      // that widens coverage (2024 brings storage into scope) must not make a
      // battery look "grandfathered" under a 2015 that never saw it.
      //
      // `kinds`, not `n.types` — the subclass closure again. Matching asserted
      // types here while discovering the norm via the closure is exactly the
      // half-fix the RCBO probe caught: the norm was found, this filter came
      // back empty, and a REJECTED node reported "the norm claims jurisdiction
      // and we hold no rule".
      const rs = (implementedByNorm.get(norm) ?? []).filter((r) => [...kinds].some((t) => r.targets.has(t)));
      const latest = latestEdition.get(norm);
      if (!rs.length) {
        // Claimed but unruled. No verdict — and definitely not a pass.
        per.push({
          norm, state: null, assessable: false,
          why: `declares dhc:governedBy ${curie(norm)}, but no edition of it has a shape for ${n.types.join(', ')} — the norm claims jurisdiction and we hold no rule`,
        });
        continue;
      }
      const oldest = rs[0], newest = rs[rs.length - 1];
      const assessable = !!latest && latest === newest.edition;

      // The editions of THIS norm the node claims, split by whether we actually
      // hold shapes for them. A claim we cannot validate is not evidence.
      const claimed = builtUnder.filter((b) => editionOf.get(b) === norm);
      const claimedCheckable = claimed.filter((b) => shapesFileOf.has(b));

      let state, why, ghost = !assessable;
      if (bad.has(oldest.edition)) {
        // Fails the oldest edition we hold — never lawful under anything we can
        // check. builtUnder cannot rescue this; it can only sharpen the story.
        state = 'danger';
        why = claimedCheckable.some((b) => bad.has(b))
          ? `fails ${curie(oldest.edition)}, the oldest edition we hold — including ${claimedCheckable.filter((b) => bad.has(b)).map(curie).join(', ')}, the very edition it claims to have been built under. Never lawful, even as built.`
          : `rejected under ${curie(oldest.edition)}, the oldest edition we can check — it was never compliant`;
      } else if (bad.has(newest.edition)) {
        // Passes an older edition, fails the one in force. What that MEANS
        // depends entirely on the evidence.
        if (claimedCheckable.some((b) => bad.has(b))) {
          // It fails an edition it claims to have been built under → the claim
          // is false. Not grandfathered — illegal as built. This is the state
          // builtUnder exists to expose, and it was invisible before.
          state = 'danger';
          why = `declares dhc:builtUnder ${claimedCheckable.filter((b) => bad.has(b)).map(curie).join(', ')} but fails those very rules — illegal as built, not grandfathered`;
        } else if (claimedCheckable.length) {
          // Passes every declared edition we can check, fails only a later one
          // → genuinely grandfathered. KNOWN, so solid, not ghosted.
          state = 'gap'; ghost = false;
          why = `built under ${claimedCheckable.map(curie).join(', ')}, passes it, fails ${curie(newest.edition)} — grandfathered: lawful as built, re-qualified the moment it is modified`;
        } else if (claimed.length) {
          // Declares an edition we hold no shapes for → the claim is
          // unverifiable. Suspected grandfathered, not proven.
          state = 'gap'; ghost = true;
          why = `fails ${curie(newest.edition)}; declares dhc:builtUnder ${claimed.map(curie).join(', ')} but we hold no shapes for that edition, so the grandfathering claim cannot be checked`;
        } else {
          // No evidence at all — the normal reverse-engineered case. Fails
          // current; whether it predates the tightening is simply unrecorded.
          // Must NOT read as "don't worry, grandfathered": a brand-new
          // undersized install produces this exact verdict.
          state = 'gap'; ghost = true;
          why = `fails ${curie(newest.edition)}, the edition in force, but passes ${curie(oldest.edition)}; no dhc:builtUnder, so whether it was lawful WHEN BUILT is unrecorded — grandfathered and newly-illegal look identical here`;
        }
      } else {
        state = 'ok';
        why = assessable
          ? `passes ${curie(newest.edition)}, the edition in force`
          : `passes ${curie(newest.edition)}, but that is not ${latest ? curie(latest) : 'the edition in force'} — no shapes exist for the current edition, so this is unproven against it`;
      }
      per.push({ norm, state, why, assessable, ghost });
    }

    const verdicts = per.filter((p) => p.state);
    if (!verdicts.length) {
      n.compliance = 'unchecked';
      n.ghosted = true;
      n.complianceWhy = per.length
        ? per.map((p) => p.why).join('; ')
        : `no shape in any edition targets ${n.types.join(', ') || 'its class'} — nothing checked it`;
      continue;
    }

    // Worst wins. ex:gtl answers to both NF C 14-100 and NF C 15-100; being
    // clean under one does not excuse the other.
    verdicts.sort((a, b) => RANK[b.state] - RANK[a.state]);
    n.compliance = verdicts[0].state;
    // Ghosted if ANY reason in play leaves us unable to stand behind the
    // colour: no shapes for the edition in force (assessable=false), a norm
    // that merely claims jurisdiction, OR a gap we cannot confirm is
    // grandfathered rather than newly-illegal (the per-verdict ghost flag). A
    // KNOWN grandfathered node — builtUnder present and verified — is solid.
    n.ghosted = per.some((p) => p.ghost || (p.state === null && !p.assessable));
    n.complianceWhy = per.map((p) => `${curie(p.norm)}: ${p.why}`).join('; ');
  }

  // ── the safety net ────────────────────────────────────────────────────────
  // A violation must never coexist with 'ok' or 'unchecked'. This CANNOT be an
  // unconditional violations→danger floor — ex:circuit-ev carries a violation
  // (under 2024) and is 'gap' by design; that is the whole grandfathering
  // mechanism. But if the reasoning above lands on ok/unchecked while SHACL
  // rejected the node, the reasoning is wrong somewhere — most likely the class
  // matching disagreeing with the validator's focus-node selection, which is
  // precisely how a rejected RCBO once rendered near-transparent, captioned
  // "nothing looked at it". Reasoning may be wrong; it may not overrule a fact.
  for (const n of nodes.values()) {
    if (n.violations.length && (n.compliance === 'ok' || n.compliance === 'unchecked')) {
      const concluded = n.compliance;
      n.compliance = 'danger';
      n.ghosted = false;
      n.complianceWhy = `rejected by ${n.violations.map((v) => `${v.edition} ${v.shape ?? v.path ?? ''}`.trim()).join(', ')} — yet this tool's own reasoning concluded "${concluded}", so its class matching disagrees with the validator's. The rejection is the fact; trust it.`;
    }
  }

  const nodeList = [...nodes.values()].map((n) => ({ ...n, label: n.label || n.curie }));
  const tally = { ok: 0, gap: 0, danger: 0, unchecked: 0 };
  for (const n of nodeList) tally[n.compliance]++;
  tally.ghosted = nodeList.filter((n) => n.ghosted).length;

  // conforms = NO NODE IS 'danger'. Not SHACL's per-run boolean OR-ed together,
  // which was wrong twice over: it could never be falsified by NF C 14-100 (its
  // edition in force has no shapes, so no 14-100 run is ever "latest" and a
  // failing meter left conforms:true), and it WAS falsified by the deliberately
  // grandfathered EV circuit, welding it to false and killing the "if this file
  // ever conforms, the chain is broken" tripwire. An alarm that cannot stop
  // ringing is not an alarm.
  const conforms = tally.danger === 0;
  const edgeTally = {};
  for (const l of links) edgeTally[l.kind] = (edgeTally[l.kind] ?? 0) + 1;
  // Per-edition violation counts. The old single "violations: N" contract is
  // ambiguous once more than one edition is checked — against 2015 the demo
  // house has exactly one violation, against 2024 it also has the grandfathered
  // EV circuit, and those two numbers mean opposite things.
  const byEdition = {};
  for (const r of runs) byEdition[curie(r.edition)] = allResults.filter((x) => x.edition === curie(r.edition)).length;

  return {
    graph: {
      version: JSON.parse(readTtl('package.json')).version,
      source: rel,
      generatedAt: new Date().toISOString(),
      targetClasses: [...targetClasses].sort(),
      editionCoverage,
      tally,
      edgeTally,
      nodes: nodeList,
      links,
    },
    report: {
      source: rel,
      generatedAt: new Date().toISOString(),
      editions: runs.map((r) => ({
        edition: curie(r.edition),
        norm: curie(r.norm),
        profile: path.basename(shapesFileOf.get(r.edition), '.shapes.ttl'),
        isLatest: latestEdition.get(r.norm) === r.edition,
        targets: [...r.targets].sort(),
      })),
      editionCoverage,
      conforms,
      violationCount: allResults.length,
      violationsByEdition: byEdition,
      tally,
      edgeTally,
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
let refOk = 0, refSkipped = 0;

for (const rel of allAbox) {
  const ref = isReference(rel);
  const s = slug(rel);

  // A reference file is external and unverified, so its failure must not take
  // the build down — warn and skip. Our own files stay fatal: a parse error or
  // empty graph in electrical-installation-house.ttl is a real regression.
  let built;
  try {
    built = await buildOne(rel, ref);
  } catch (err) {
    if (ref) { console.warn(`  ⚠ skipped ${rel} — ${err.message.split('\n')[0]}`); refSkipped++; continue; }
    throw err;
  }
  const { graph, report } = built;

  if (!graph.nodes.length || !graph.links.length) {
    // An empty graph renders as a clean, plausible, empty canvas while SHACL
    // reports conforms:true — the silent-green failure this repo keeps hitting.
    // Fatal for our files; for a reference model (e.g. a sensor-only Brick
    // sample with no relationships) it is just not worth showing.
    if (ref) { console.warn(`  ⚠ skipped ${rel} — no nodes or no links to draw`); refSkipped++; continue; }
    console.error(`  ✗ ${rel} EMPTY — the viewer would render nothing and look fine doing it`);
    anyEmpty = true;
    continue;
  }

  fs.writeFileSync(path.join(outDir, `${s}.graph.json`), JSON.stringify(graph, null, 2));
  fs.writeFileSync(path.join(outDir, `${s}.report.json`), JSON.stringify(report, null, 2));
  index.sources.push({
    slug: s, source: rel, label: s.replace(/[-_]/g, ' '),
    reference: ref,
    group: ref ? path.basename(path.dirname(rel)) : null,
    nodes: graph.nodes.length, links: graph.links.length,
    conforms: report.conforms, violations: report.violationCount, tally: graph.tally,
  });

  if (ref) {
    // Terse — 30 of these, none validated, all 'unchecked'. One line each.
    refOk++;
    console.log(`  · ${s}  (${graph.nodes.length} nodes, ${graph.links.length} links) — reference, not validated`);
    continue;
  }

  const circuits = graph.nodes.filter((n) => n.types.includes('dhc:Circuit')).length;
  console.log(`  ${rel}`);
  console.log(`    nodes ${graph.nodes.length}  links ${graph.links.length}  circuits ${circuits}`);
  console.log(`    compliance  ok ${graph.tally.ok}   gap ${graph.tally.gap}   danger ${graph.tally.danger}   unchecked ${graph.tally.unchecked}   (ghosted ${graph.tally.ghosted})`);
  console.log(`    edges       ${Object.entries(graph.edgeTally).map(([k, v]) => `${k} ${v}`).join('   ')}`);
  // Per edition, not in aggregate. "conforms" is the verdict against the
  // edition in force; violations under a superseded edition are the
  // grandfathering signal, not non-compliance, and printing one number for both
  // is how the two get confused.
  console.log(`    conforms ${report.conforms}  (= no node is danger; grandfathered nodes do not count against it)`);
  for (const e of report.editions) {
    const rs = report.results.filter((r) => r.edition === e.edition);
    console.log(`      ${e.edition}${e.isLatest ? ' (in force)' : ' (superseded)'}: ${rs.length} violation(s)`);
    for (const r of rs) console.log(`        ✗ ${r.focusCurie ?? '?'}  ${r.shape ?? r.path ?? ''}`);
  }
}
if (refOk || refSkipped) console.log(`  reference models: ${refOk} shown, ${refSkipped} skipped`);

fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2));
console.log(`\n  shapes target: ${[...targetClasses].sort().join(', ')}`);
for (const e of editionCoverage) {
  if (e.assessable) {
    console.log(`  ${e.norm}: shapes for ${e.implements.join(' → ')} — the newest IS the edition in force, so "ok" is proven against current`);
  } else {
    console.log(`  ⚠ ${e.norm}: shapes for ${e.implements.join(' → ')}, but the edition in force is ${e.latest ?? '(none declared)'} — no shapes implement it, so nothing under this norm can be proven current. Those nodes are drawn GHOSTED: the gap is ours, not the building's.`);
  }
}
if (unclassified.size) {
  console.log(`  ⚠ predicates with no edge kind (drawn as 'other'): ${[...unclassified].sort().join(', ')}`);
  console.log(`    add them to EDGE_CLASS in this file — an unclassified edge is a modelling question, not a default`);
}
console.log(`  → js-tools/data/  (${index.sources.length} source(s) + index.json)`);
if (anyEmpty) process.exit(1);
