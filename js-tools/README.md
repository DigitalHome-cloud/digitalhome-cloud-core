# js-tools — offline A-Box viewer

See and validate the models in `schema/abox/` without Gatsby, without AWS, and
without a network.

```bash
npm run preview:abox                                   # the default A-Box
bash scripts/preview-abox.sh schema/abox/other.ttl     # a specific one
bash scripts/preview-abox.sh schema/abox/other.ttl 8790  # …on another port
npm run build:abox                                     # regenerate JSON only
```

The launcher builds `data/{graph,report}.json`, serves this directory, and opens
the viewer. Ctrl-C to stop.

Sibling of `py-tools/`: **Python curates the T-Box, JavaScript views and
validates it.**

## What you see

- **Nodes** — A-Box individuals. **Boxes are equipment, spheres are not.**
  Which is which is read from the ontology (`brick:Equipment` ∪ `s223:Equipment`
  and their transitive subclasses), never hand-listed — so `dhc:Circuit`
  (`⊑ s223:System`), `dhc:WiringSegment` (`⊑ s223:Connection`) and `dhc:Socket`
  (`⊑ s223:ElectricityOutlet`) correctly stay spheres, and a new class lands in
  the right shape without anyone remembering to update a list.
- **Links** — the actual instance triples, drawn by **kind** (below).
- **Click any legend row to filter** — nodes *or* edges; **All** resets.
- **Model picker** — every A-Box in `schema/abox/` is prebuilt, so switching is
  a fetch, not a revalidation. A model with violations is marked `— n⚠`.
- **Log pane** — the whole chain: counts, circuits found, which classes the
  shapes target, which *edition* the shapes implement, the conformance verdict.
- **Linkable views** — `?colour=compliance&model=<slug>`.

### Four kinds of edge

Because "where a thing is", "what it is part of", "what energy flows through it"
and "what commands it" are different questions that should not look alike:

| Kind | Predicates | Drawn |
|---|---|---|
| **spatial** | `rec:locatedIn`, `rec:isLocationOf`, `rec:includes`, `rec:hasPart`, `brick:hasLocation` | thin green |
| **structural** | `brick:hasPart`/`isPartOf`, `dhc:hasProtection`, `dhc:hasWiring`, `s223:hasMember`, `s223:hasConnectionPoint` | grey |
| **flow** | `brick:feeds`, `s223:connectsThrough` | blue, **moving dots** |
| **control** | `brick:controls` | pink, **moving blocks** |

Flow and control move because they are the two that describe something
*happening*. The mapping lives in `EDGE_CLASS` in `build-abox.mjs`; a predicate
that isn't in it is drawn orange as `other` **and reported at the end of the
build**, so new modelling surfaces as a question rather than a default.

### Three colour modes

| Mode | Colours by | Tells you |
|---|---|---|
| **design view** | the class's `dhc:designView` | the house palette — electrical blue, spatial green, … reads like the Modeler |
| **compliance** | per-node norm state | **see below** — the only mode that ghosts nodes |
| **standard** | the namespace of `rdf:type` | which standard defines each thing — dhc 29 / brick 10 / rec 3 / s223 3 on the demo house, i.e. the "dhc: only fills gaps" principle made visible |

Note "standard" colours by the **type's** namespace, not the individual's:
every A-Box individual is an `ex:`, so colouring by the subject IRI paints all
45 nodes one colour and says nothing.

### Compliance — computed, on two channels

A prototype of what the Designer will show properly.

**Nothing in the A-Box declares its compliance.** `build-abox.mjs` validates the
model against *every* norm edition that has shapes and compares the verdicts.
That is the whole idea: the A-Box says what is built, the C-Box says what each
edition requires, and the state falls out of the difference.

| colour | Meaning |
|---|---|
| 🟢 **ok** | passes the newest edition we hold rules for |
| 🟡 **gap** | passes an older edition, **fails the current one** — lawful as built; changing it triggers the current one |
| 🔴 **danger** | fails even the **oldest** edition we hold — it was never compliant |
| ⬜ **unchecked** | no shape in any edition targets its class — nothing ever looked at it |

| opacity | Meaning |
|---|---|
| solid | we hold rules for the edition in force, so the colour means what it says |
| **ghosted** | we **cannot speak to the edition in force** — either nothing targets this class, or its norm's current edition has no shapes |

Demo house: **11 ok · 1 gap · 1 danger · 67 unchecked**, of which **71 ghosted**
(80 nodes).

**Colour and opacity are separate on purpose.** Colour is the verdict against
the best edition we hold. Opacity is whether we hold the right one. Those are
different claims — "the rule says no" versus "we have no rule" — and this viewer
conflated them once already, burying the one actionable state under a field of
things nobody had checked. A node can be **green and ghosted**: the NF C 14-100
nodes pass the 2008 rules we hold while 2021 is in force and unimplemented.
"Passes what we checked" and "we checked the right thing" are two facts, so they
get two channels.

**Yellow is the state most of a real building is in, and it is the useful one.**
A pool wired to an old NF C 15-100 is legal and stays legal — until you add a
circuit, at which point the current edition applies to the work. Same for a
Brussels house under an old RGIE the moment you add PV. Not non-compliance, not
ignorance: a known, dated delta, and exactly what an owner needs to see *before*
commissioning work. `ex:circuit-ev` is the worked example — 10 mm² satisfies
`nfc15100:IRVE32AMonoShape` (≥ 10) and fails `nfc15100-2024:IRVE32AMono2024Shape`
(≥ 16), so it is yellow without anything in the A-Box saying so.

An earlier cut asked the A-Box to declare `dhc:builtUnder <edition>` per element
instead. It was removed: it asks the modeller for something they usually do not
know (a surveyed installation rarely records its edition), and it can only say
*that* there is a delta to current, never *what* it is. Two shapes files can.

**Transparent is the C-Box's problem, not the building's.** No shape targets
those classes, so nothing checked them. SHACL reports only failures, which makes
an unchecked node silent for exactly the same reason a *conforming* one is.
Colouring it green would be the vacuous-green mistake in `doc/prototyping-poc.md`.
Note `ex:board-resi9` is ghosted *while declaring* `dhc:governedBy` — the norm
claims jurisdiction and our C-Box has no rule, which the inspector says in as
many words. That is the coverage gap (`doc/parking-lot.md` § 1) made visible.

### How editions compose

`dhc:shapesFile` on each `dhc:NormEdition` is the authority on which shapes
exist — **not** the directory listing, because a verdict has to be attributable
to an edition to mean anything. An edition's effective rule set is its own file
concatenated with every file down the `dhc:supersedes` chain:

```
effective(2024) = nfc15100-2024.shapes.ttl + nfc15100-2015.shapes.ttl
```

so `nfc15100-2024.shapes.ttl` carries only the **delta**. Concatenation ANDs
constraints: 2015 says ≥ 10 mm², 2024 says ≥ 16, both run, the stricter decides.

Two consequences worth knowing before touching this:

- **An edition can add or tighten, never loosen.** If a future edition ever
  relaxes a rule, this mechanism is the wrong one and must be replaced rather
  than worked around.
- **A delta must never reuse a base shape IRI.** Reuse it and RDF merges both
  definitions onto one subject, so "does it pass 2015?" can no longer be asked —
  nothing errors, the graph is valid, the comparison just quietly answers
  something else. `tests/cbox/guards.test.js` enforces the disjointness.

The build **fails** if a `dhc:shapesFile` names a missing file, or if a
`*.shapes.ttl` on disk is claimed by no edition — the latter would otherwise
stop running silently, and SHACL's answer to "nothing ran" is `conforms: true`.

> ⚠ **The NF C 15-100:2024 rules are illustrative, not law.** Nobody has read
> the published text. They are plausible stand-ins so the machinery has
> something real to compute, marked `UNVERIFIED` on the file header and on every
> shape. Do not quote them.

## How it is built

```
scripts/preview-abox.sh
  └─ node js-tools/build-abox.mjs schema/abox/<file>.ttl
        reads   schema/abox/<file>.ttl
                schema/tbox/{dhc-core,dhc-app-metadata}.ttl   (designView + the edition chain)
                schema/cbox/electrical/*.shapes.ttl           ← via dhc:shapesFile, NOT readdir
                schema/tbox/Brick+extensions.ttl              (equipment closure — ~1s)
        runs    one SHACL pass PER EDITION, oldest → newest
        reuses  tests/_helpers/loadGraph.js                    ← the test suite's own validator
        writes  js-tools/data/{graph,report}.json              (gitignored)
  └─ python3 ThreadingTCPServer  →  abox-viewer.html
```

### Why a Node build step rather than parsing in the page

SHACL cannot run in the browser here: `rdf-validate-shacl` depends on
`@zazuko/env-node`, which is Node-only. Validating in Node means the viewer
reuses **`tests/_helpers/loadGraph.js` — the exact code behind the passing test
suite** — so what you see and what `npm test` says cannot disagree. It also
means the page fetches only JSON and needs no RDF library at all.

### Why it is genuinely offline

Two files are committed, and the second one needs explaining:

- `vendor/3d-force-graph.min.js` (1.2 MB, v1.79.1) — its UMD build is
  self-contained: `ForceGraph3D` global, three.js inlined.
- `vendor/three.module.min.js` (691 KB, r170) — **a second copy of three**, on
  purpose. The UMD bundle inlines three r180 but exports *only* `ForceGraph3D`,
  so there is no way to reach a geometry constructor through it — and box nodes
  and block particles need one. (`three@0.170` ships no classic UMD build, only
  ESM/webgpu, so this half has to be a module. Classic scripts run before
  deferred module scripts, so `ForceGraph3D` is already global when it loads.)

Two three instances, ten revisions apart, is normally a warning sign. It works
here for a documented reason rather than by luck: three identifies types with
duck-typing flags (`isObject3D`, `isMesh`, `isBufferGeometry`) and
`material.type` strings, never `instanceof`, precisely so foreign objects
interoperate — an r170 `Mesh` renders fine under the r180 renderer. Confirmed on
screen before shipping, not assumed.

To refresh either:

```bash
cp ../modeler/node_modules/3d-force-graph/dist/3d-force-graph.min.js js-tools/vendor/
cp ../modeler/node_modules/three/build/three.module.min.js          js-tools/vendor/
```

This is a deliberate departure from the Blockly harnesses this tool is modelled
on. **They are not offline**, despite the name: `blockly/preview.html` and
`experimental/blockly/1-spatial/` both load Blockly from `unpkg.com` and fail
without internet; `2-factory` pulls Google Fonts. There is even a vendored
`blockly.min.js` in `experimental/blockly/` that nothing important uses — a
different major version from the CDN one the demo actually loads. Here, zero
`https://` appears anywhere in `abox-viewer.html`; verify with:

```bash
grep -c "https://" js-tools/abox-viewer.html      # → 0
```

To refresh the vendored library:

```bash
cp ../modeler/node_modules/3d-force-graph/dist/3d-force-graph.min.js js-tools/vendor/
```

## Why this is not the Modeler's viewer

The Modeler renders the **T-Box** — ~48 classes and their properties. It cannot
be pointed at an A-Box, for two structural reasons: its links come from
class-level schema (`rdfs:domain` → `rdfs:range` on `dhc:` object properties),
never from instance triples; and its parser filters every subject through
`startsWith("https://digitalhome.cloud/ontology#")`, which discards `ex:`,
`brick:`, `rec:` and `s223:` outright.

So `build-abox.mjs` is a parallel generator, not a patch. It keys nodes on the
full IRI, walks the store for instance triples, and applies no namespace filter.
The renderer is the same underlying library the Modeler uses
(`react-force-graph-3d` wraps `3d-force-graph`), and the palette is shared — so
the two look like relatives, as they should.

## Conventions

- **Blank nodes are inlined, not drawn.** The A-Box uses them for Brick entity
  properties (`brick:tilt [ brick:hasUnit unit:DEG ; brick:value "30" ]`); as
  nodes they would be ~30 unlabelled dots. They appear as `key=value` text in
  the inspector instead.
- **Literals are inspector fields**, never nodes.
- **IRIs outside the A-Box** (a `dhc:Norm`, a `dhc:NormEdition`, a `unit:`, an
  `s223:` medium) are attributes of the node that references them, not topology
  edges. Only A-Box-to-A-Box references become links.
- **Repeated predicates accumulate.** `ex:gtl` is `dhc:governedBy` two norms.
  Assigning would keep only the last — silently, while the inspector looked
  complete.
- **`Brick+extensions.ttl` IS loaded**, for the equipment closure only (~1s of
  the build). It is not needed for colouring — `dhc-app-metadata.ttl` carries
  `designView` for Brick classes — but node *shape* is derived from
  `rdfs:subClassOf*`, and that hierarchy only exists upstream.

## The build fails loudly rather than looking fine

A graph with no nodes or no links renders as a clean, plausible, empty canvas —
and the viewer says `conforms: true` because SHACL selected nothing. That is the
silent-green failure this repo has produced repeatedly (see
`doc/prototyping-poc.md`). `build-abox.mjs` exits non-zero instead, and the page
says so in red rather than looking fine. Same for a `dhc:shapesFile` naming a
file that does not exist, a shapes file no edition claims, and a T-Box with no
`dhc:latestEdition`.

### The bar for `electrical-installation-house.ttl`

Two numbers, not one — a single "N violations" is ambiguous once more than one
edition is checked, and the two mean opposite things:

| Against | Expected | Because |
|---|---|---|
| **:2015** (superseded) | exactly **1** — `ex:circuit-ev-legacy` / `nfc15100:IRVE32AMonoShape` | the deliberate defect. **If this ever conforms the chain is broken — do not "fix" it by correcting the cross-section.** |
| **:2024** (in force) | **`ex:circuit-ev` must be reported** | otherwise the delta is a no-op, yellow never appears, and the whole edition mechanism reports success while proving nothing |

`tests/tbox/norm-editions.test.js` asserts both against the built graph, plus
that the model exercises `ok` **and** `gap` **and** `danger`. To check the delta
by hand: raise `ex:circuit-ev`'s `dhc:crossSection` to `16.0` and rebuild — it
must turn **green**. If it stays yellow, the 2024 shapes are not firing.
