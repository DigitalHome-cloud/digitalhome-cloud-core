# ADR 0001 (core): Ontology tooling — one writer, a JS validator, no Brick Python

Core-local ADR. The umbrella's `docs/adr/` covers decisions that cross repos;
this one is confined to `repos/core` and is numbered separately.

## Status

Accepted

## Date

2026-07

## Context

Two questions came up while prototyping the electrical model for v1.0:

1. **`py-tools/ontology_explorer.py` is built for humans, but agents drive it.**
   It is the only sanctioned writer for the four DHC T-Box files. A single
   session moved 30+ subjects through it by piping stdin at the interactive
   menu. Should it change, and how?

2. **Brick ships Python modules** — `brickschema`, `brick_tq_shacl`,
   `brick_model_summarizer`, `brickschema_rdflib_sqlalchemy`, all installed in
   `.venv`. What are they for, and should we adopt them? The repo already
   validates SHACL in JavaScript (`rdf-validate-shacl` via vitest), so any
   adoption means either two validators or a migration.

Behind both: **where does the C-Box sit in the pipeline?** The working sketch
was `TBox(.ttl) → [toolset] → ABox(.ttl,.jsonld) → wiring diagram`, with
`CBox.ttl → ???` — the arrow had nowhere to go.

## Decision

### 1. The C-Box is a gate, not a stage

It produces no artifact. It is a **check over the union of T-Box + A-Box**, and
its output is a verdict:

```
  ontology_explorer.py ──> T-Box ──┐
                                   ├──> A-Box (.ttl) ──> .jsonld ──> wiring diagram
  Designer / hand-authoring ───────┘        │
                                            │
                    C-Box (.shapes.ttl) ────┴──> SHACL ──> conforms + violations
                    (profile per country
                     from cbox-manifest.json)
```

It runs at three moments: **test time** (vitest), **design time** (the Designer
shows violations on the home being edited), **build time** (the Modeler
publishes `cbox-registry.json` to S3 so the Designer knows which profile
applies).

### 2. `ontology_explorer.py` stays the single writer, and gains `--promote` / `--purge`

The human-oriented design is kept. It earned that: 30+ vocabulary moves in one
session stayed reviewable as local diffs **because every write goes through one
splitter and one deterministic serializer**. Two writers would mean two
opinions about where a triple lands.

What was actually wrong was the *automation seam*, not the design. Driving the
menu by piping stdin is brittle in two specific ways:

- a prompt count that shifts by one silently desynchronises the stream, and the
  wrong answer lands on the wrong question;
- on EOF `_ask()` returns `""`, the class prompt falls back to `last`, and the
  menu **loops forever** instead of exiting.

So: non-interactive flags, as a **thin wrapper over the same functions** —
`load_graph()`, `promote_dhc_class()`, `purge_dhc_class_everywhere()`,
`_serialize_all()`, `_reload()`. Not a second implementation.

```bash
python3 ontology_explorer.py                       # interactive menu (humans)
python3 ontology_explorer.py --promote dhc:Circuit
python3 ontology_explorer.py --promote dhc:governedBy   # properties work too
python3 ontology_explorer.py --purge   dhc:Norm_BS7671
```

Both flags are repeatable; purges run before promotes, because correcting a
definition is purge → re-draft → promote. Exit codes are real (`0` success,
`2` not-found / refused), so scripts can branch.

Two behaviours worth stating because they are not obvious:

- **Subjects, not just classes.** `promote_dhc_class()` is subject-based, so
  `--promote dhc:governedBy` works. This matters: `dhc:governedBy` deliberately
  has no `rdfs:domain`, so **no class promotion would ever reach it**.
- **Annotation review is skipped** (equivalent to answering `n`).
  `promote_dhc_class()` already moves the annotations that exist; the
  interactive loop is for *adding or changing* them, which is human judgement.

### 3. No Brick Python modules in `repos/core`

| Module | Reason to exist | Verdict |
|---|---|---|
| `brickschema` | `rdflib.Graph` + `load_file` + reasoner dispatch | **No.** Its `.validate()` silently routes to TopQuadrant/Java when `brick_tq_shacl` is importable — a behaviour switch behind your back. The explorer uses bare `rdflib` deliberately |
| `brick_tq_shacl` | Wraps TopQuadrant's Java SHACL engine; the only implementation that fires `sh:rule` | **Not yet** — but the one with real future value. See below |
| `brick_model_summarizer` | Summarises commercial HVAC (AHUs, VAV boxes, chillers) | **No.** Wrong domain; returns nothing for a house |
| `brickschema_rdflib_sqlalchemy` | rdflib graphs in Postgres with changeset tables | **No.** Git + TTL already versions the graphs |

Note `reasonable` is **not installed**, so `expand("brick")` / `expand("owlrl")`
raise `ImportError`; only `expand("rdfs")` works today.

### 4. The JS harness stays the validator

`tests/_helpers/loadGraph.js` is the whole surface: **n3** (TTL → queryable
store), **@zazuko/env-node** (RDF/JS datasets — and, verified, lossless
`text/turtle` ↔ `application/ld+json` in both directions), **rdf-validate-shacl**
(pinned `^0.6.0`, resolves to **0.6.5**).

Its one documented limitation — no SHACL-SPARQL constraints, no SHACL-AF rules
— **costs nothing today**: `grep -c "sh:sparql\|sh:rule"` returns **0** across
the C-Box, `dhc-core.ttl` and `dhc-app-metadata.ttl`. Pure SHACL Core.

The `.jsonld` arm of the pipeline therefore needs no Python: the round-trip is
~10 lines of JS against packages already installed.

### 5. When inference is needed, it is a build step — never a test-time swap

The one **genuine** gap is inference, not validation. `Brick+extensions.ttl`
carries **7,381 `sh:TripleRule`, 65 `sh:SPARQLRule`, 78 `sh:sparql`**, and
nothing in the JS stack can fire any of them. It is invisible today only
because every shape we wrote targets classes we assert ourselves. It bites the
day a shape or query needs a **Brick-derived** triple (e.g. `brick:measures`,
which exists only after inference).

When that day comes:

```
A-Box.ttl ──> brick_tq_shacl.infer(+ Brick T-Box) ──> A-Box-expanded.ttl (committed)
                                                              │
                          JS harness validates Core shapes ───┘
```

Java stays confined to an occasional authoring step; the test loop stays fast
and dependency-light. This is what `experimental/.../01-Generate-ABOX.py` was
gesturing at with `g.expand()` and its pre-reasoned JSON-LD cache — with the
right engine (rules, not RDFS) and namespaces that resolve.

### 6. The explorer's skill lives in this repo, not the umbrella

`dhc-ontology-explorer` existed as two byte-identical copies — one at the
umbrella `.claude/skills/`, one directory-scoped under
`repos/core/.claude/skills/`. Both were registered; editing one silently left
the other stale.

The scoped copy is the single home: the explorer only exists in this repo, and
a directory-scoped skill wins over an unscoped one when the files being changed
are here. The umbrella copy was deleted.

This is not theoretical. Its sibling `dhc-build-blockly-elements-for-spatial-modeling`
is duplicated the same way and **had already drifted within a single session** —
one copy was edited, the other silently kept a stale "Do NOT trigger" list. A
skill that lives in two places has no source of truth; it has two, and one of
them is wrong.

> Note: neither `.claude/skills/` tree is git-tracked, so a deletion there is
> irreversible. Back up before removing.

## Consequences

- **One writer, two front doors.** Humans use the menu; scripts use the flags;
  both share the splitter and serializer, so output is identical either way.
- **The explorer's skill has one home** — `repos/core/.claude/skills/`.
  Do not re-create the umbrella copy.
- **`py-tools/` is explorer-only.** `onto_tree.py` and its `.conf`s were removed
  (referenced nowhere; recoverable via git).
- **No JVM in CI.** Validation stays in-process in Node.
- **We accept a known blind spot**: no Brick-derived triples until the build-time
  inference step exists. Documented rather than silently tolerated — every shape
  must currently target a class the A-Box asserts directly.
- **`context.jsonld` is gone** (deleted April 2026). JSON-LD export works but
  emits expanded IRIs; if S3 consumers want the compacted form, that file must
  come back. The Modeler's publish already handles its absence conditionally.
- Re-adding a norm profile means four artifacts together — shapes, manifest
  entry, `dhc:Norm` instance, tests — plus a valid *and* invalid fixture.
  `tests/cbox/guards.test.js` catches the dangling cases.

## Related

- `CLAUDE.md` § SHACL activation pattern — the P3 `sh:or` guard and the
  reporting rules that follow from it
- `.claude/skills/dhc-ontology-explorer/SKILL.md` (in **this** repo — the
  directory-scoped copy; the umbrella duplicate was removed) — the curator's
  contract, including the `--promote` / `--purge` contract
- `SPEC-V3-Redesign.md` — the REC → Brick → 223P → `dhc:` layering
