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

- **Nodes** — A-Box individuals. **Click a legend colour to filter** the graph
  to (or away from) that bucket; **All** resets.
- **Links** — the actual instance triples (`dhc:hasProtection`, `brick:feeds`,
  `s223:connectsThrough`, …). Hover for the predicate.
- **Model picker** — every A-Box in `schema/abox/` is prebuilt, so switching is
  a fetch, not a revalidation. A model with violations is marked `— n⚠`.
- **Log pane** — the whole chain: counts, circuits found, which classes the
  shapes target, the conformance verdict.

### Three colour modes

| Mode | Colours by | Tells you |
|---|---|---|
| **design view** | the class's `dhc:designView` | the house palette — electrical blue, spatial green, … reads like the Modeler |
| **compliance** | per-node norm state | **see below** |
| **standard** | the namespace of `rdf:type` | which standard defines each thing — dhc 29 / brick 10 / rec 3 / s223 3 on the demo house, i.e. the "dhc: only fills gaps" principle made visible |

Note "standard" colours by the **type's** namespace, not the individual's:
every A-Box individual is an `ex:`, so colouring by the subject IRI paints all
45 nodes one colour and says nothing.

### Compliance — green / yellow / red

A prototype of what the Designer will show properly.

| | Meaning |
|---|---|
| 🟢 **ok** | a shape actually looked at this node and did not complain |
| 🟡 **gap** | **no shape targets its class — nothing checked it** |
| 🔴 **danger** | a shape rejected it |

**Yellow is not "nearly fine" — it is "unknown".** SHACL reports only failures,
so a node no shape targets is silent for the same reason a *conforming* node
is. Colouring that green would be the vacuous-green mistake documented in
`doc/prototyping-poc.md`. The C-Box currently targets six classes —
`dhc:Circuit`, `ElectricalTechnicalSpace`, `EmergencyDisconnect`,
`EnergyDelivery`, `EnergyMeter`, `RCD` — so on the demo house the split is
**11 ok / 33 gap / 1 danger**: the norm layer covers about a quarter of the
model. Nothing validates the seven breakers, the four cables, or the
distribution board. Switch to compliance mode and the sea of yellow is the
point.

## How it is built

```
scripts/preview-abox.sh
  └─ node js-tools/build-abox.mjs schema/abox/<file>.ttl
        reads   schema/abox/<file>.ttl
                schema/cbox/electrical/*.shapes.ttl
                schema/tbox/{dhc-core,dhc-app-metadata}.ttl   (rdf:type → designView)
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

`vendor/3d-force-graph.min.js` (1.2 MB, v1.79.1) is committed. Its UMD build is
self-contained — `ForceGraph3D` global, **three.js inlined** — so one file is
the whole renderer. (Worth knowing: `three@0.170` no longer ships a classic UMD
build, only ESM/webgpu, so vendoring it separately would not have worked.)

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
- **IRIs outside the A-Box** (a `dhc:Norm`, a `unit:`, an `s223:` medium) are
  attributes of the node that references them, not topology edges. Only
  A-Box-to-A-Box references become links.
- **`Brick+extensions.ttl` is not loaded** — 3.5 MB, and it contributes nothing
  to colouring. `dhc-app-metadata.ttl` carries the `designView` annotations for
  Brick classes anyway.

## The build fails loudly on an empty graph

A graph with no nodes or no links renders as a clean, plausible, empty canvas —
and the viewer says `conforms: true` because SHACL selected nothing. That is the
silent-green failure this repo has produced repeatedly (see
`doc/prototyping-poc.md`). `build-abox.mjs` exits non-zero instead, and the page
says so in red rather than looking fine.

If the viewer ever shows **`conforms: true`** for
`electrical-installation-house.ttl`, that is a bug, not good news: the file
carries a deliberate 32 A IRVE circuit on 1.5 mm² that **must** be reported by
`nfc15100:IRVE32AMonoShape`.
