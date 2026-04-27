#!/usr/bin/env python3
"""
DHC Ontology Explorer v2.0
==========================
Interactive loop for navigating Brick + REC + s223 + DHC ontologies.

Features:
  - Interactive loop with search (?term), last-class memory
  - Full property extraction: SHACL sh:property + rdfs:domain + qudt:hasQuantityKind
  - Inherited properties from ancestor chain
  - Output: stdout (text table) or .csv file (; separator)
  - Three directions: [1] subclass tree, [2] parent chain, [3] properties table

Usage:
  python ontology_explorer.py     # interactive

Requires: pip install rdflib
"""

import sys, os, csv, io, json as _json
from collections import defaultdict
from pathlib import Path
from typing import Optional

try:
    from rdflib import Graph, Namespace, URIRef, BNode, RDF, RDFS, OWL, Literal
    from rdflib.namespace import SKOS, XSD
except ImportError:
    sys.exit("rdflib required: pip install rdflib")

# ── Ontology files (edit for your setup) ──────────────────────────────────────
def _resolve(rel):
    return str(Path(__file__).resolve().parent / rel)

# Read-only baseline (Brick + REC + s223)
BRICK_FILE = _resolve("../schema/tbox/Brick+extensions.ttl")

# T-Box destination files (written by option [4] / [5])
TBOX_CORE     = _resolve("../schema/tbox/dhc-core.ttl")
TBOX_METADATA = _resolve("../schema/tbox/dhc-app-metadata.ttl")

# Draft sources (shrink as classes are promoted)
DRAFT_CORE     = _resolve("../schema/draft/dhc-core.ttl")
DRAFT_METADATA = _resolve("../schema/draft/dhc-app-metadata.ttl")

# Order matters: tbox loaded first, then drafts (per SPEC-V3)
ONTOLOGY_FILES = [BRICK_FILE, TBOX_CORE, TBOX_METADATA, DRAFT_CORE, DRAFT_METADATA]

# View sections (ordered) used by the structured serializer
VIEWS = ["governance", "spatial", "building", "electrical",
         "plumbing", "heating", "network", "automation", "compliance"]

DHC_NS_STR = "https://digitalhome.cloud/ontology#"
DHC = Namespace(DHC_NS_STR)

# Application annotation predicates kept in dhc-app-metadata.ttl, never in dhc-core.ttl
APP_ANNOTATION_PREDS = {
    DHC["designView"], DHC["blocklyDisposition"], DHC["blocklyCategory"],
    DHC["blocklyParentProperty"], DHC["blocklyFieldType"],
    DHC["blocklyBlockTemplate"], DHC["defaultValue"],
}
LOCALIZED_LANGS = {"de", "fr"}

# ── Namespaces ────────────────────────────────────────────────────────────────
KNOWN_NS = {
    "dhc":"https://digitalhome.cloud/ontology#", "rec":"https://w3id.org/rec#",
    "brick":"https://brickschema.org/schema/Brick#", "s223":"http://data.ashrae.org/standard223#",
    "sh":"http://www.w3.org/ns/shacl#", "owl":"http://www.w3.org/2002/07/owl#",
    "rdf":"http://www.w3.org/1999/02/22-rdf-syntax-ns#", "rdfs":"http://www.w3.org/2000/01/rdf-schema#",
    "xsd":"http://www.w3.org/2001/XMLSchema#", "skos":"http://www.w3.org/2004/02/skos/core#",
    "dcterms":"http://purl.org/dc/terms/", "qudt":"http://qudt.org/schema/qudt/",
    "unit":"http://qudt.org/vocab/unit/", "ref":"https://brickschema.org/schema/Brick/ref#",
    "bacnet":"http://data.ashrae.org/bacnet/2020#",
}
SH = Namespace("http://www.w3.org/ns/shacl#")
QUDT = Namespace("http://qudt.org/schema/qudt/")

def make_shortener(g):
    ns = dict(KNOWN_NS)
    for p, u in g.namespaces():
        if p: ns[str(p)] = str(u)
    srt = sorted(ns.items(), key=lambda kv: -len(kv[1]))
    def shorten(uri):
        if uri is None: return ""
        s = str(uri)
        for p, b in srt:
            if s.startswith(b): return f"{p}:{s[len(b):]}"
        return s.split("#")[-1] if "#" in s else s.split("/")[-1]
    return shorten

def resolve_name(name, g):
    name = name.strip()
    ns = dict(KNOWN_NS)
    for p, u in g.namespaces():
        if p: ns[str(p)] = str(u)
    if ":" in name:
        pfx, local = name.split(":", 1)
        if pfx in ns:
            uri = URIRef(ns[pfx] + local)
            if any(g.triples((uri, None, None))) or any(g.triples((None, None, uri))): return uri
    for pfx, base in ns.items():
        uri = URIRef(base + name)
        if any(g.triples((uri, None, None))) or any(g.triples((None, None, uri))): return uri
    return None

def load_graph():
    """Returns (union, file_graphs) where file_graphs[path] is a per-file Graph.
    union holds all triples for navigation; per-file graphs are used by the
    promote/delete/serialize machinery so we know which file each triple lives in."""
    union = Graph()
    file_graphs = {}
    for f in ONTOLOGY_FILES:
        fg = Graph()
        if not Path(f).exists():
            print(f"  [skip] {f}", file=sys.stderr)
            file_graphs[f] = fg
            continue
        try:
            fg.parse(f, format="turtle")
            for t in fg: union.add(t)
            for p, u in fg.namespaces(): union.bind(p, u)
            print(f"  Loaded {Path(f).name}: {len(fg):,} triples", file=sys.stderr)
        except Exception as e:
            print(f"  [error] {f}: {e}", file=sys.stderr)
        file_graphs[f] = fg
    return union, file_graphs

# ── Helpers ───────────────────────────────────────────────────────────────────
def get_label(g, uri, lang="en"):
    for _, _, o in g.triples((uri, RDFS.label, None)):
        if isinstance(o, Literal) and o.language == lang: return str(o)
    for _, _, o in g.triples((uri, RDFS.label, None)):
        if isinstance(o, Literal): return str(o)
    return ""

def get_definition(g, uri):
    v = g.value(uri, SKOS.definition)
    if v is None: v = g.value(uri, RDFS.comment)
    return str(v) if v else ""

def is_deprecated(g, uri):
    return (uri, RDF.type, OWL.DeprecatedClass) in g

def get_children(g, c):
    return sorted([s for s in g.subjects(RDFS.subClassOf, c) if isinstance(s, URIRef)], key=str)

def get_parents(g, c):
    return sorted([o for o in g.objects(c, RDFS.subClassOf) if isinstance(o, URIRef)], key=str)

def ancestors(uri, g):
    seen, chain, q = set(), [], [URIRef(uri)]
    while q:
        cur = q.pop(0)
        for _, _, p in g.triples((cur, RDFS.subClassOf, None)):
            if isinstance(p, URIRef) and str(p) not in seen:
                seen.add(str(p)); chain.append(str(p)); q.append(p)
    return chain

_desc_cache = {}
def count_desc(g, c):
    k = str(c)
    if k in _desc_cache: return _desc_cache[k]
    ch = get_children(g, c)
    t = len(ch)
    for x in ch: t += count_desc(g, x)
    _desc_cache[k] = t
    return t

def search_classes(g, query):
    q = query.lower()
    return sorted([s for s in g.subjects(RDF.type, OWL.Class)
                   if isinstance(s, URIRef) and (q in str(s).split("#")[-1].lower() or q in get_label(g, s).lower())], key=str)

# ── Property extraction (SHACL + rdfs:domain + qudt) ─────────────────────────
def get_own_properties(cls, g, shorten):
    props, seen = [], set()
    # 1. SHACL
    for _, _, pn in g.triples((cls, SH.property, None)):
        path = g.value(pn, SH.path)
        if path is None or str(path) in seen: continue
        seen.add(str(path))
        dt = g.value(pn, SH.datatype)
        sc = g.value(pn, SH["class"])
        sn = g.value(pn, SH.node)
        mn = g.value(pn, SH["minCount"])
        mx = g.value(pn, SH["maxCount"])
        pu = URIRef(str(path))
        pt = "object" if (pu, RDF.type, OWL.ObjectProperty) in g else "data" if (pu, RDF.type, OWL.DatatypeProperty) in g else "shacl"
        rh = shorten(dt) if dt else (shorten(sc) if sc else (shorten(sn) if sn else ""))
        cs = []
        if mn: cs.append(f"min={mn}")
        if mx: cs.append(f"max={mx}")
        props.append({"path": shorten(path), "path_uri": str(path), "source": "sh:property",
                       "type": pt, "range": rh, "constraints": cs,
                       "description": get_label(g, pu) or get_definition(g, pu)})
    # 2. rdfs:domain
    for dp in g.subjects(RDFS.domain, cls):
        if not isinstance(dp, URIRef) or str(dp) in seen: continue
        if not ((dp, RDF.type, OWL.DatatypeProperty) in g or (dp, RDF.type, OWL.ObjectProperty) in g): continue
        seen.add(str(dp))
        rng = g.value(dp, RDFS.range)
        pt = "data" if (dp, RDF.type, OWL.DatatypeProperty) in g else "object"
        props.append({"path": shorten(dp), "path_uri": str(dp), "source": "rdfs:domain",
                       "type": pt, "range": shorten(rng) if rng else "", "constraints": [],
                       "description": get_label(g, dp) or get_definition(g, dp)})
    # 3. qudt
    for _, _, qk in g.triples((cls, QUDT.hasQuantityKind, None)):
        if str(qk) in seen: continue
        seen.add(str(qk))
        props.append({"path": shorten(qk), "path_uri": str(qk), "source": "qudt",
                       "type": "annotation", "range": "", "constraints": [],
                       "description": get_label(g, qk) if isinstance(qk, URIRef) else ""})
    # 4. owl:AnnotationProperty assertions (e.g. dhc:designView, dhc:appGuidance)
    _SKIP_NS = (
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
        "http://www.w3.org/2000/01/rdf-schema#",
        "http://www.w3.org/2002/07/owl#",
        "http://www.w3.org/ns/shacl#",
        "http://www.w3.org/2004/02/skos/core#",
        "http://qudt.org/schema/qudt/",
    )
    for pred, obj in g.predicate_objects(cls):
        if not isinstance(pred, URIRef): continue
        if any(str(pred).startswith(ns) for ns in _SKIP_NS): continue
        if str(pred) in seen: continue
        if (pred, RDF.type, OWL.AnnotationProperty) not in g: continue
        seen.add(str(pred))
        val = str(obj) if obj else ""
        props.append({"path": shorten(pred), "path_uri": str(pred), "source": "annotation",
                       "type": "annotation", "range": val, "constraints": [],
                       "description": get_label(g, pred) or ""})
    return props

def get_all_properties(cls_uri, g, shorten):
    own = get_own_properties(URIRef(cls_uri), g, shorten)
    inh, seen = [], {p["path_uri"] for p in own}
    for anc in ancestors(cls_uri, g):
        for p in get_own_properties(URIRef(anc), g, shorten):
            if p["path_uri"] not in seen:
                seen.add(p["path_uri"])
                pp = dict(p); pp["inherited_from"] = shorten(URIRef(anc))
                inh.append(pp)
    return own, inh

def fmt_prop(p, indent="  "):
    ar = {"object":"→","data":"=","shacl":"▸","annotation":"~"}.get(p["type"],"·")
    s = f"{indent}{ar} {p['path']}"
    if p["range"]: s += f" : {p['range']}"
    if p["constraints"]: s += f"  [{', '.join(p['constraints'])}]"
    if p.get("inherited_from"): s += f"  (from {p['inherited_from']})"
    return s

# ── Direction 1: Tree ─────────────────────────────────────────────────────────
def do_tree(g, sh, cls, indent=0, visited=None, maxd=99, show_p=False, rows=None):
    if visited is None: visited = set()
    if cls in visited or indent > maxd: return
    visited.add(cls)
    nm = sh(cls); lb = get_label(g, cls); nd = count_desc(g, cls)
    ls = f" — {lb}" if lb and lb != nm.split(":")[-1] else ""
    ds = f"  [{nd}]" if nd > 5 else ""
    dep = " [DEPRECATED]" if is_deprecated(g, cls) else ""
    if rows is not None:
        rows.append({"depth":indent,"class":nm,"label":lb,"descendants":nd,"deprecated":is_deprecated(g,cls)})
    else:
        print("  "*indent + nm + ls + ds + dep)
    if show_p and rows is None:
        for p in get_own_properties(cls, g, sh):
            print(fmt_prop(p, "  "*(indent+1)))
    for ch in get_children(g, cls):
        do_tree(g, sh, ch, indent+1, visited, maxd, show_p, rows)

# ── Direction 2: Parents ──────────────────────────────────────────────────────
def do_parents(g, sh, cls, show_p=True, rows=None):
    visited, queue = set(), [(cls, 0)]
    while queue:
        uri, depth = queue.pop(0)
        if uri in visited: continue
        visited.add(uri)
        ref = URIRef(uri) if isinstance(uri, str) else uri
        nm = sh(ref); lb = get_label(g, ref); defn = get_definition(g, ref)
        dep = " [DEPRECATED]" if is_deprecated(g, ref) else ""
        ls = f" — {lb}" if lb and lb != nm.split(":")[-1] else ""
        pfx = "↑ " if depth > 0 else ""
        own = get_own_properties(ref, g, sh) if show_p else []
        if rows is not None:
            rows.append({"depth":depth,"class":nm,"label":lb,"deprecated":is_deprecated(g,ref),
                         "definition":defn[:80] if defn else "","own_props":len(own)})
        else:
            print(f"{'  '*depth}{pfx}{nm}{ls}{dep}")
            if defn: print(f"{'  '*depth}  {defn[:120]}")
            for p in own:
                print(fmt_prop(p, "  "*depth + "    "))
        for _, _, par in sorted(g.triples((ref, RDFS.subClassOf, None)), key=lambda t: str(t[2])):
            if isinstance(par, URIRef) and str(par) not in visited:
                queue.append((str(par), depth+1))

# ── Direction 3: Properties ───────────────────────────────────────────────────
def do_properties(g, sh, cls, show_inh=True, rows=None):
    ref = URIRef(cls) if isinstance(cls, str) else cls
    nm = sh(ref)
    own, inh = get_all_properties(str(ref), g, sh)
    all_p = own + (inh if show_inh else [])
    ORDER = {"object":0,"data":1,"shacl":2,"annotation":3}
    all_p.sort(key=lambda r: (ORDER.get(r["type"],9), r["path"]))

    if rows is not None:
        for p in all_p:
            rows.append({"class":nm,"property":p["path"],"type":p["type"],"source":p["source"],
                         "range":p["range"],"constraints":"; ".join(p["constraints"]),"description":p.get("description",""),
                         "inherited_from":p.get("inherited_from","(own)")})
        return

    if not all_p:
        lb = get_label(g, ref)
        print(f"\n  Properties for {nm}" + (f" — {lb}" if lb else ""))
        print("  " + "=" * 60)
        print(f"  (no own properties with explicit rdfs:domain on this class)")
        print(f"  Tip: use [2] parent chain to see SHACL shapes from ancestors.")
        return

    print(f"\n  Properties of {nm}  ({len(own)} own + {len(inh)} inherited = {len(all_p)} total)\n")
    HDR = ("Property", "Type", "Range", "Constraints", "Description", "From")
    tbl = [HDR] + [(p["path"], p["type"], p["range"],
                    "; ".join(p["constraints"]) if p["constraints"] else "",
                    (p.get("description","") or "")[:50],
                    p.get("inherited_from","(own)") or "(own)") for p in all_p]
    ws = [max(len(str(r[i])) for r in tbl) for i in range(len(HDR))]
    sep = "  ".join("─"*w for w in ws)
    print("  " + "  ".join(h.ljust(ws[i]) for i,h in enumerate(HDR)))
    print("  " + sep)
    for row in tbl[1:]:
        print("  " + "  ".join(str(row[i]).ljust(ws[i]) for i in range(len(HDR))))

# ── CSV ───────────────────────────────────────────────────────────────────────
def write_csv(rows, filepath, delim=";"):
    if not rows: print("  No data."); return
    flds = list(rows[0].keys())
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=flds, delimiter=delim, lineterminator="\n", quoting=csv.QUOTE_MINIMAL)
        w.writeheader(); w.writerows(rows)
    print(f"  ✅ {len(rows)} rows → {filepath}")

# ── Migration: drafts → tbox (option [4] / [5]) ──────────────────────────────

def _is_dhc(uri):
    return isinstance(uri, URIRef) and str(uri).startswith(DHC_NS_STR)

def _is_app_annotation_triple(p, o):
    """True if (p, o) belongs in dhc-app-metadata.ttl rather than dhc-core.ttl.
    Covers: app annotation predicates and localized rdfs:label/rdfs:comment."""
    if p in APP_ANNOTATION_PREDS:
        return True
    if p in (RDFS.label, RDFS.comment) and isinstance(o, Literal) and o.language in LOCALIZED_LANGS:
        return True
    return False

def _resolve_view(uri, *graphs, _seen=None):
    """Find the dhc:designView of uri, climbing rdfs:subClassOf and rdfs:domain
    until something matches. Returns a string in VIEWS, or 'governance'."""
    if _seen is None: _seen = set()
    if uri in _seen: return None
    _seen.add(uri)
    for g in graphs:
        for _, _, v in g.triples((uri, DHC["designView"], None)):
            sv = str(v)
            if sv in VIEWS: return sv
    for g in graphs:
        for _, _, parent in g.triples((uri, RDFS.subClassOf, None)):
            if isinstance(parent, URIRef):
                v = _resolve_view(parent, *graphs, _seen=_seen)
                if v: return v
        for _, _, dom in g.triples((uri, RDFS.domain, None)):
            if isinstance(dom, URIRef):
                v = _resolve_view(dom, *graphs, _seen=_seen)
                if v: return v
    return None

def _bnode_closure(src, dst, node):
    """Recursively copy all triples reachable from a blank node."""
    if not isinstance(node, BNode): return
    for p, o in src.predicate_objects(node):
        dst.add((node, p, o))
        if isinstance(o, BNode): _bnode_closure(src, dst, o)

def _render_subject(g, s):
    """Render a single subject's CBD as turtle (without @prefix lines)."""
    sub = Graph()
    for p, u in g.namespaces(): sub.bind(p, u)
    for p, o in g.predicate_objects(s):
        sub.add((s, p, o))
        _bnode_closure(g, sub, o)
    if len(sub) == 0: return ""
    txt = sub.serialize(format="turtle")
    body = [ln for ln in txt.splitlines()
            if not (ln.startswith("@prefix ") or ln.startswith("@base ")
                    or ln.startswith("PREFIX ") or ln.startswith("BASE "))]
    return "\n".join(body).strip() + "\n"

# Fixed file headers — preserved on every re-serialize
def _extract_header(path, marker):
    """Pull the prefix block + ontology stanza from a tbox file by splitting at
    the first occurrence of the section banner."""
    if not Path(path).exists(): return ""
    txt = Path(path).read_text(encoding="utf-8")
    return txt.split(marker)[0]

_HEADER_MARKER_CORE = "# ════════════════════════════════════════════════════════════\n# VIEW: governance"
_HEADER_MARKER_META = "# ────────────────────────────────────────────────────────────\n# § Application annotation property definitions"

_TBOX_CORE_HEADER = _extract_header(TBOX_CORE, _HEADER_MARKER_CORE)
_TBOX_METADATA_HEADER = _extract_header(TBOX_METADATA, _HEADER_MARKER_META)

_DRAFT_HEADER = """@prefix brick:   <https://brickschema.org/schema/Brick#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix dhc:     <https://digitalhome.cloud/ontology#> .
@prefix owl:     <http://www.w3.org/2002/07/owl#> .
@prefix rdf:     <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs:    <http://www.w3.org/2000/01/rdf-schema#> .
@prefix rec:     <https://w3id.org/rec#> .
@prefix s223:    <http://data.ashrae.org/standard223#> .
@prefix sh:      <http://www.w3.org/ns/shacl#> .
@prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .

# ============================================================
# DigitalHome.Cloud — DRAFT (work in progress)
# Promote subjects to tbox via py-tools/ontology_explorer.py [4].
# ============================================================

"""

def _bucket_subject(s, file_graph, lookup_graphs):
    """Decide which view section a subject belongs to in a structured tbox file.
    Subjects with no resolvable view fall into 'governance'."""
    if isinstance(s, BNode): return None       # rendered inline via parent
    v = _resolve_view(s, *lookup_graphs)
    return v if v in VIEWS else "governance"

def _is_class(g, s):     return (s, RDF.type, OWL.Class) in g
def _is_object_prop(g, s):   return (s, RDF.type, OWL.ObjectProperty) in g
def _is_data_prop(g, s):     return (s, RDF.type, OWL.DatatypeProperty) in g
def _is_annot_prop(g, s):    return (s, RDF.type, OWL.AnnotationProperty) in g
def _is_property(g, s):  return _is_object_prop(g, s) or _is_data_prop(g, s) or _is_annot_prop(g, s)

def write_structured_ttl(file_graph, path, kind, lookup_graphs):
    """Serialize file_graph to path with view-section banners.
    kind ∈ {'core', 'metadata', 'draft'}."""
    if kind == "draft":
        with open(path, "w", encoding="utf-8") as f:
            f.write(_DRAFT_HEADER)
            subjects = sorted(
                (s for s in set(file_graph.subjects()) if isinstance(s, URIRef)),
                key=str,
            )
            for s in subjects:
                txt = _render_subject(file_graph, s)
                if txt: f.write(txt + "\n")
        return

    header = _TBOX_CORE_HEADER if kind == "core" else _TBOX_METADATA_HEADER
    with open(path, "w", encoding="utf-8") as f:
        f.write(header.rstrip() + "\n\n")

        # Subjects to bucket: top-level URIRefs only. For 'metadata', the
        # annotation property definitions (subject in dhc:, type AnnotationProperty)
        # are kept inline at the top of the file via the static header — but the
        # static header is empty of them after first write, so we render them
        # explicitly here in their own block.
        all_subjects = sorted(
            (s for s in set(file_graph.subjects()) if isinstance(s, URIRef)),
            key=str,
        )

        # Skip ontology header subject (rendered as part of static header text)
        ontology_uris = {URIRef("https://digitalhome.cloud/ontology"),
                         URIRef("https://digitalhome.cloud/ontology/app-metadata")}
        all_subjects = [s for s in all_subjects if s not in ontology_uris]

        # For metadata: split out app-annotation-property defs (rendered first)
        if kind == "metadata":
            annot_props = [s for s in all_subjects
                           if _is_annot_prop(file_graph, s) and _is_dhc(s)]
            f.write("# ────────────────────────────────────────────────────────────\n")
            f.write("# § Application annotation property definitions\n")
            f.write("# ────────────────────────────────────────────────────────────\n\n")
            for s in annot_props:
                txt = _render_subject(file_graph, s)
                if txt: f.write(txt + "\n")
            all_subjects = [s for s in all_subjects if s not in annot_props]

        # Bucket remaining subjects by view
        buckets = {v: [] for v in VIEWS}
        for s in all_subjects:
            v = _bucket_subject(s, file_graph, lookup_graphs) or "governance"
            buckets.setdefault(v, []).append(s)

        for v in VIEWS:
            f.write("\n# ════════════════════════════════════════════════════════════\n")
            f.write(f"# VIEW: {v}\n")
            f.write("# ════════════════════════════════════════════════════════════\n\n")
            subs = buckets.get(v, [])
            classes  = [s for s in subs if _is_class(file_graph, s)]
            props    = [s for s in subs if _is_property(file_graph, s) and not _is_class(file_graph, s)]
            others   = [s for s in subs if s not in classes and s not in props]
            for s in classes + others + props:
                txt = _render_subject(file_graph, s)
                if txt: f.write(txt + "\n")

def _related_property_uris(cls, *graphs):
    """Properties whose rdfs:domain is cls (across given graphs)."""
    out = set()
    for g in graphs:
        for p in g.subjects(RDFS.domain, cls):
            if isinstance(p, URIRef): out.add(p)
    return out

def _enum_instance_uris(cls, *graphs):
    """Subjects whose rdf:type is cls (R-Box enum instances)."""
    out = set()
    for g in graphs:
        for i in g.subjects(RDF.type, cls):
            if isinstance(i, URIRef) and i != cls: out.add(i)
    return out

def _move_triples_about(uri, src, dst_core, dst_meta):
    """Partition all triples about uri in src into dst_core / dst_meta and
    remove them from src. Triples about uri elsewhere (i.e. as object) stay."""
    moved_core = moved_meta = 0
    for p, o in list(src.predicate_objects(uri)):
        target = dst_meta if _is_app_annotation_triple(p, o) else dst_core
        target.add((uri, p, o))
        if target is dst_core: moved_core += 1
        else: moved_meta += 1
        # carry blank node closure to the same destination
        _bnode_closure(src, target, o)
        src.remove((uri, p, o))
    return moved_core, moved_meta

def promote_dhc_class(cls, drafts_core, drafts_meta, tbox_core, tbox_meta, union):
    """Move a dhc: class declaration + its properties + enum instances from
    drafts → tbox, splitting domain triples vs. annotations between the two
    tbox files. Returns a summary dict for printing."""
    summary = {"core": 0, "meta": 0, "props": [], "enums": []}

    # 1. main class triples
    c, m = _move_triples_about(cls, drafts_core, tbox_core, tbox_meta)
    summary["core"] += c; summary["meta"] += m
    c, m = _move_triples_about(cls, drafts_meta, tbox_core, tbox_meta)
    summary["core"] += c; summary["meta"] += m

    # 2. associated properties (rdfs:domain = cls, only if still in drafts)
    for p_uri in _related_property_uris(cls, drafts_core, drafts_meta):
        # skip if the property is already declared in tbox
        if _is_property(tbox_core, p_uri) or _is_property(tbox_meta, p_uri):
            continue
        cc, mm = _move_triples_about(p_uri, drafts_core, tbox_core, tbox_meta)
        cc2, mm2 = _move_triples_about(p_uri, drafts_meta, tbox_core, tbox_meta)
        summary["core"] += cc + cc2; summary["meta"] += mm + mm2
        summary["props"].append(str(p_uri))

    # 3. enum instances (rdf:type = cls)
    for i_uri in _enum_instance_uris(cls, drafts_core, drafts_meta):
        cc, mm = _move_triples_about(i_uri, drafts_core, tbox_core, tbox_meta)
        cc2, mm2 = _move_triples_about(i_uri, drafts_meta, tbox_core, tbox_meta)
        summary["core"] += cc + cc2; summary["meta"] += mm + mm2
        summary["enums"].append(str(i_uri))

    # 4. rebuild union
    union.remove((None, None, None))
    for g in (tbox_core, tbox_meta, drafts_core, drafts_meta):
        for t in g: union.add(t)
    return summary

def enrich_external_class(cls, drafts_core, drafts_meta, tbox_meta, union, sh):
    """Interactively choose annotations for a non-DHC class (rec/brick/s223)
    and write them into dhc-app-metadata.ttl. Removes the chosen triples from
    drafts. The class itself is NOT copied to dhc-core.ttl — Brick/REC/s223
    own its definition."""
    # Build candidate predicate list: fixed catalog + extras already in drafts
    fixed = [
        (DHC["designView"],          None,  "Design View"),
        (DHC["blocklyDisposition"],  None,  "Blockly disposition"),
        (DHC["blocklyCategory"],     None,  "Blockly category"),
        (DHC["blocklyParentProperty"], None,"Blockly parent property"),
        (DHC["blocklyFieldType"],    None,  "Blockly field type"),
        (DHC["blocklyBlockTemplate"], None, "Blockly block template"),
        (DHC["defaultValue"],        None,  "Default value"),
        (RDFS.label,    "de", "Label @de"),
        (RDFS.label,    "fr", "Label @fr"),
        (RDFS.comment,  "de", "Comment @de"),
        (RDFS.comment,  "fr", "Comment @fr"),
    ]
    fixed_keys = {(p, lang) for p, lang, _ in fixed}

    # Discover extras in drafts about cls
    extras = []
    for g in (drafts_core, drafts_meta):
        for p, o in g.predicate_objects(cls):
            lang = o.language if isinstance(o, Literal) else None
            key = (p, lang)
            if key in fixed_keys: continue
            if (p, lang, None) in [(x[0], x[1], None) for x in extras]: continue
            extras.append((p, lang, f"{sh(p)}{('@' + lang) if lang else ''}"))

    print(f"\n  Enrich external class: {sh(cls)}")
    print(f"  Annotations land in dhc-app-metadata.ttl. Empty input = skip.")
    print(f"  Type 'k' to keep current value, 'd' to delete it.\n")

    chosen = []  # list of (predicate, language, value_str_or_None_for_skip)
    candidates = fixed + extras
    for pred, lang, label in candidates:
        # current values in drafts
        cur = []
        for g in (drafts_core, drafts_meta):
            for _, _, o in g.triples((cls, pred, None)):
                if isinstance(o, Literal) and lang and o.language != lang: continue
                if isinstance(o, Literal) and not lang and o.language: continue
                cur.append(o)

        cur_str = ", ".join(repr(str(x)) for x in cur) if cur else "—"
        prompt = f"    {label}  [current: {cur_str}]: "

        if pred == DHC["designView"]:
            prompt = f"    {label}  [current: {cur_str}]  ({'/'.join(VIEWS)}): "

        ans = _ask(prompt, "")
        if ans == "":
            # skip — no change, but also do not re-promote anything
            continue
        if ans.lower() == "k":
            # keep: move existing draft triples to tbox_meta
            for o in cur:
                tbox_meta.add((cls, pred, o))
                drafts_core.remove((cls, pred, o))
                drafts_meta.remove((cls, pred, o))
            continue
        if ans.lower() == "d":
            # delete from drafts, do not write to tbox
            drafts_core.remove((cls, pred, None))
            drafts_meta.remove((cls, pred, None))
            continue

        # set new value (replace any existing)
        drafts_core.remove((cls, pred, None))
        drafts_meta.remove((cls, pred, None))
        tbox_meta.remove((cls, pred, None))
        if pred in (RDFS.label, RDFS.comment) and lang:
            tbox_meta.add((cls, pred, Literal(ans, lang=lang)))
        elif pred in APP_ANNOTATION_PREDS:
            tbox_meta.add((cls, pred, Literal(ans)))
        else:
            # fallback: literal
            tbox_meta.add((cls, pred, Literal(ans)))

    # rebuild union
    union.remove((None, None, None))
    # Note: caller will re-add tbox_core etc. after serialization

def delete_dhc_class(cls, tbox_core, tbox_meta, union):
    """Remove a dhc: class (and its properties + enum instances) from both
    tbox files. External classes are refused — promote them instead."""
    if not _is_dhc(cls):
        print(f"  ✗ {cls} is not in the dhc: namespace. Refusing to delete.")
        print(f"    External classes are owned by Brick/REC/s223. Use option [4]")
        print(f"    to update their dhc-app-metadata.ttl annotations instead.")
        return None

    summary = {"core": 0, "meta": 0, "props": [], "enums": []}

    # collect related uris before removal
    props = _related_property_uris(cls, tbox_core, tbox_meta)
    enums = _enum_instance_uris(cls, tbox_core, tbox_meta)

    for g_name, g in [("core", tbox_core), ("meta", tbox_meta)]:
        for p, o in list(g.predicate_objects(cls)):
            g.remove((cls, p, o)); summary[g_name] += 1
        for s, p in list(g.subject_predicates(cls)):
            g.remove((s, p, cls)); summary[g_name] += 1
        for p_uri in props:
            for p, o in list(g.predicate_objects(p_uri)):
                g.remove((p_uri, p, o)); summary[g_name] += 1
        for i_uri in enums:
            for p, o in list(g.predicate_objects(i_uri)):
                g.remove((i_uri, p, o)); summary[g_name] += 1

    summary["props"] = [str(p) for p in props]
    summary["enums"] = [str(i) for i in enums]
    return summary

# ── Conf ──────────────────────────────────────────────────────────────────────
def _cp(): return Path(__file__).resolve().parent / "onto_explorer.conf"
def load_conf():
    p = _cp()
    if p.exists():
        try: return _json.loads(p.read_text("utf-8"))
        except: pass
    return {}
def save_conf(c):
    try: _cp().write_text(_json.dumps(c, indent=2), "utf-8")
    except: pass

# ── Main loop ─────────────────────────────────────────────────────────────────
SEP = "──────────────────────────────────────────────────────"

def _ask(prompt, default=""):
    try:
        v = input(prompt).strip()
        return v if v else default
    except (EOFError, KeyboardInterrupt):
        print(); return ""

def _reload(union, file_graphs):
    """Re-read all files into the existing graph objects (after a write)."""
    union.remove((None, None, None))
    for path, fg in file_graphs.items():
        fg.remove((None, None, None))
        if not Path(path).exists(): continue
        try:
            fg.parse(path, format="turtle")
            for t in fg: union.add(t)
            for p, u in fg.namespaces(): union.bind(p, u)
        except Exception as e:
            print(f"  [error] reload {path}: {e}", file=sys.stderr)

def _serialize_all(file_graphs, union):
    """Re-serialize the four writable files in tbox order: tbox first, then drafts.
    Brick+extensions.ttl is read-only and is skipped."""
    lookup = (file_graphs[TBOX_CORE], file_graphs[TBOX_METADATA],
              file_graphs[DRAFT_CORE], file_graphs[DRAFT_METADATA])
    write_structured_ttl(file_graphs[TBOX_CORE],     TBOX_CORE,     "core",     lookup)
    write_structured_ttl(file_graphs[TBOX_METADATA], TBOX_METADATA, "metadata", lookup)
    write_structured_ttl(file_graphs[DRAFT_CORE],    DRAFT_CORE,    "draft",    lookup)
    write_structured_ttl(file_graphs[DRAFT_METADATA],DRAFT_METADATA,"draft",    lookup)

def main():
    print("╔══════════════════════════════════════════════════════╗")
    print("║       DHC Ontology Explorer v3.0                    ║")
    print("║       Brick + REC + s223 + DHC (T-Box curator)      ║")
    print("╚══════════════════════════════════════════════════════╝\n")
    g, file_graphs = load_graph()
    sh = make_shortener(g)
    conf = load_conf()
    nc = len(set(s for s in g.subjects(RDF.type, OWL.Class) if isinstance(s, URIRef)))
    print(f"\n  {len(g):,} triples, {nc:,} classes\n")
    last = conf.get("last_class", "brick:Equipment")

    while True:
        print(SEP)
        ci = _ask(f"  Class (last: {last}, ?=search, q=quit): ")
        if not ci: ci = last
        if ci.lower() in ("q","quit","exit"): print("  Bye!"); break

        if ci.startswith("?"):
            qry = ci[1:].strip() or _ask("  Search: ")
            res = search_classes(g, qry)
            if res:
                print(f"\n  {len(res)} matches:")
                for r in res[:25]: print(f"    {sh(r)}" + (f" — {get_label(g,r)}" if get_label(g,r) else ""))
                if len(res)>25: print(f"    ... +{len(res)-25}")
            else: print(f"  No matches.")
            continue

        cls = resolve_name(ci, g)
        if cls is None:
            res = search_classes(g, ci)
            if len(res)==1: cls = res[0]; print(f"  → {sh(cls)}")
            elif res:
                print(f"  Ambiguous ({len(res)}):")
                for r in res[:10]: print(f"    {sh(r)}")
                continue
            else: print(f"  Not found. Try ?{ci}"); continue

        last = sh(cls); conf["last_class"] = last; save_conf(conf)

        lb = get_label(g, cls); ps = get_parents(g, cls); ch = get_children(g, cls)
        nd = count_desc(g, cls); op = get_own_properties(cls, g, sh)
        cm = g.value(cls, RDFS.comment)
        print(f"\n  {sh(cls)}" + (f" — {lb}" if lb else ""))
        if cm: print(f"  {cm}")
        if ps: print(f"  Parents: {', '.join(sh(p) for p in ps)}")
        print(f"  Subclasses: {len(ch)} direct, {nd} total | Own properties: {len(op)}")

        d = _ask("  Direction  [1] down  [2] up  [3] properties  [4] promote→tbox  [5] delete dhc:  (default=1): ", "1")
        direction = int(d) if d in ("1","2","3","4","5") else 1

        maxd, show_p, show_inh = 99, False, True
        if direction == 1:
            ds = _ask(f"  Max depth (default=unlimited): ")
            maxd = int(ds) if ds.isdigit() else 99
            sp = _ask("  Show inline properties [y/n] (default=n): ", "n")
            show_p = sp.lower() in ("y","yes")
        elif direction == 3:
            ih = _ask("  Include inherited [y/n] (default=y): ", "y")
            show_inh = ih.lower() not in ("n","no")

        if direction in (4, 5):
            print()
            tbox_core = file_graphs[TBOX_CORE]
            tbox_meta = file_graphs[TBOX_METADATA]
            drafts_core = file_graphs[DRAFT_CORE]
            drafts_meta = file_graphs[DRAFT_METADATA]

            if direction == 4:
                if _is_dhc(cls):
                    in_drafts = (any(drafts_core.triples((cls, None, None)))
                                 or any(drafts_meta.triples((cls, None, None))))
                    if not in_drafts:
                        print(f"  ✗ {sh(cls)} is not present in drafts/. Nothing to promote.")
                        print(); continue
                    print(f"  Promoting DHC class {sh(cls)} from drafts → tbox …")
                    summ = promote_dhc_class(cls, drafts_core, drafts_meta,
                                             tbox_core, tbox_meta, g)
                    _serialize_all(file_graphs, g)
                    _reload(g, file_graphs)
                    sh = make_shortener(g)
                    print(f"  ✅ moved {summ['core']} → dhc-core.ttl, "
                          f"{summ['meta']} → dhc-app-metadata.ttl")
                    if summ["props"]:
                        print(f"     properties: {', '.join(summ['props'][:5])}"
                              + (f" (+{len(summ['props'])-5} more)" if len(summ['props']) > 5 else ""))
                    if summ["enums"]:
                        print(f"     enum instances: {len(summ['enums'])} migrated")
                else:
                    enrich_external_class(cls, drafts_core, drafts_meta,
                                          tbox_meta, g, sh)
                    _serialize_all(file_graphs, g)
                    _reload(g, file_graphs)
                    sh = make_shortener(g)
                    print(f"  ✅ {sh(cls)} annotations updated in dhc-app-metadata.ttl")
            elif direction == 5:
                ok = _ask(f"  Delete {sh(cls)} from tbox? [y/N]: ", "n")
                if ok.lower() in ("y", "yes"):
                    summ = delete_dhc_class(cls, tbox_core, tbox_meta, g)
                    if summ is not None:
                        _serialize_all(file_graphs, g)
                        _reload(g, file_graphs)
                        sh = make_shortener(g)
                        print(f"  ✅ removed {summ['core']} triples from dhc-core.ttl, "
                              f"{summ['meta']} from dhc-app-metadata.ttl")
                        if summ["props"]:
                            print(f"     properties removed: {len(summ['props'])}")
                        if summ["enums"]:
                            print(f"     enum instances removed: {len(summ['enums'])}")
                else:
                    print("  cancelled")
            print()
            continue

        out = _ask("  Output file (default=stdout, .csv=CSV;): ")
        use_csv = out.endswith(".csv") if out else False
        print()

        if direction == 1:
            if use_csv:
                rows = []; do_tree(g, sh, cls, maxd=maxd, rows=rows); write_csv(rows, out)
            else: do_tree(g, sh, cls, maxd=maxd, show_p=show_p)
        elif direction == 2:
            if use_csv:
                rows = []; do_parents(g, sh, cls, rows=rows); write_csv(rows, out)
            else: do_parents(g, sh, cls)
        elif direction == 3:
            if use_csv:
                rows = []; do_properties(g, sh, cls, show_inh=show_inh, rows=rows); write_csv(rows, out)
            else: do_properties(g, sh, cls, show_inh=show_inh)
        print()

if __name__ == "__main__":
    main()
