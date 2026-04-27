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
    from rdflib import Graph, Namespace, URIRef, RDF, RDFS, OWL, Literal
    from rdflib.namespace import SKOS, XSD
except ImportError:
    sys.exit("rdflib required: pip install rdflib")

# ── Ontology files (edit for your setup) ──────────────────────────────────────
def _resolve(rel):
    return str(Path(__file__).resolve().parent / rel)

ONTOLOGY_FILES = [
    _resolve("../schema/tbox/Brick+extensions.ttl"),
    _resolve("../schema/draft/dhc-core.ttl"),
    _resolve("../schema/draft/dhc-app-metadata.ttl"),
]

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
    g = Graph()
    for f in ONTOLOGY_FILES:
        if not Path(f).exists():
            print(f"  [skip] {f}", file=sys.stderr); continue
        try:
            g.parse(f, format="turtle")
            print(f"  Loaded {Path(f).name}", file=sys.stderr)
        except Exception as e:
            print(f"  [error] {f}: {e}", file=sys.stderr)
    return g

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

def main():
    print("╔══════════════════════════════════════════════════════╗")
    print("║       DHC Ontology Explorer v2.0                    ║")
    print("║       Brick + REC + s223 + DHC                      ║")
    print("╚══════════════════════════════════════════════════════╝\n")
    g = load_graph()
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

        d = _ask("  Direction  [1] down  [2] up  [3] properties  (default=1): ", "1")
        direction = int(d) if d in ("1","2","3") else 1

        maxd, show_p, show_inh = 99, False, True
        if direction == 1:
            ds = _ask(f"  Max depth (default=unlimited): ")
            maxd = int(ds) if ds.isdigit() else 99
            sp = _ask("  Show inline properties [y/n] (default=n): ", "n")
            show_p = sp.lower() in ("y","yes")
        elif direction == 3:
            ih = _ask("  Include inherited [y/n] (default=y): ", "y")
            show_inh = ih.lower() not in ("n","no")

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
