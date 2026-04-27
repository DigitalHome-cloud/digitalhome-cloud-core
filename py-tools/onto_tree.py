#!/usr/bin/env python3
"""
onto_tree.py — Ontology class-tree explorer
============================================
Prints the full subclass hierarchy under a given root class,
together with all data/object properties attached to each class,
collected from three sources:

  1. sh:property shapes  (SHACL — used by Brick, REC, DHC C-Box)
  2. rdfs:domain on owl:DatatypeProperty / owl:ObjectProperty
  3. qudt:hasQuantityKind annotations on the class itself

Usage
-----
  python onto_tree.py <ttl_file> <root_class> [options]

Examples
--------
  # Brick Setpoint hierarchy, text output
  python onto_tree.py Brick.ttl brick:Setpoint

  # Brick Equipment hierarchy, include inherited props, JSON output
  python onto_tree.py Brick.ttl brick:Equipment --inherited --format json

  # DHC Electrical view (multiple files), depth limit
  python onto_tree.py dhc-core_schemav4.ttl brick:Electrical_Equipment \\
      --extra Brick.ttl --depth 3

  # Discover all top-level classes in a file
  python onto_tree.py dhc-core_schemav4.ttl --list-roots

Options
-------
  --prefix PREFIX:URI     Register an extra prefix, e.g. --prefix dhc:https://digitalhome.cloud/ontology#
                          (common prefixes are auto-detected from the file)
  --extra FILE            Load additional TTL files into the same graph
                          (use when the root class is defined in one file but
                           subclasses or properties are in another)
  --depth N               Limit tree depth (default: unlimited)
  --inherited             Show properties inherited from ancestor classes
                          (default: own properties only)
  --include-object-props  Include owl:ObjectProperty in addition to
                          owl:DatatypeProperty (default: data props only)
  --format {text,json,csv,markdown}
                          Output format (default: text)
  --out FILE              Write output to FILE instead of stdout
  --no-definitions        Suppress skos:definition in text output
  --list-roots            List classes with no superclass in the loaded graph
                          (ignores <root_class> argument)

Requirements
------------
  pip install rdflib
"""

import argparse
import json
import sys
import csv
import io
from collections import defaultdict
from typing import Optional

import json as _json
from pathlib import Path as _Path

try:
    from rdflib import Graph, Namespace, URIRef, RDF, RDFS, OWL
    from rdflib.namespace import SKOS, XSD
except ImportError:
    sys.exit("rdflib is required:  pip install rdflib")

# ── hardcoded ontology files ──────────────────────────────────────────────────
# Edit these paths to match your local copies.
# All files are merged into a single graph at startup.

def _resolve(rel: str) -> str:
    """Resolve relative to the script's directory."""
    return str(_Path(__file__).resolve().parent / rel)

ONTOLOGY_FILES = [
    _resolve("Brick.ttl"),
    _resolve("Brick+extensions.ttl"),
    _resolve("dhc-core.ttl"),

]
# Conf is keyed on the combined stem of all loaded files
CONF_KEY = "onto_tree"

# ── well-known namespaces ──────────────────────────────────────────────────────
KNOWN_NS = {
    "brick":  "https://brickschema.org/schema/Brick#",
    "rec":    "https://w3id.org/rec#",
    "dhc":    "https://digitalhome.cloud/ontology#",
    "sh":     "http://www.w3.org/ns/shacl#",

    "owl":    "http://www.w3.org/2002/07/owl#",
    "rdf":    "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "rdfs":   "http://www.w3.org/2000/01/rdf-schema#",
    "xsd":    "http://www.w3.org/2001/XMLSchema#",
    "skos":   "http://www.w3.org/2004/02/skos/core#",
    "dcterms":"http://purl.org/dc/terms/",
    "qudt":   "http://qudt.org/schema/qudt/",
    "unit":   "http://qudt.org/vocab/unit/",
    "schema": "http://schema.org/",
}

SH   = Namespace("http://www.w3.org/ns/shacl#")
QUDT = Namespace("http://qudt.org/schema/qudt/")


# ── URI ↔ compact form ────────────────────────────────────────────────────────

def make_shortener(g: Graph, extra_prefixes: dict) -> callable:
    """Return a function that shortens a URI using the graph's namespace bindings."""
    ns_map = dict(KNOWN_NS)
    ns_map.update(extra_prefixes)
    # Add bindings declared in the file itself
    for prefix, uri in g.namespaces():
        if prefix:
            ns_map[str(prefix)] = str(uri)

    # Sort longest-URI-first so more specific prefixes win
    sorted_ns = sorted(ns_map.items(), key=lambda kv: -len(kv[1]))

    def shorten(uri: Optional[URIRef]) -> Optional[str]:
        if uri is None:
            return None
        s = str(uri)
        for prefix, base in sorted_ns:
            if s.startswith(base):
                return f"{prefix}:{s[len(base):]}"
        # Fallback: use the fragment or last path segment
        if "#" in s:
            return s.split("#")[-1]
        return s.rstrip("/").split("/")[-1]

    return shorten


def resolve_curie(curie: str, g: Graph, extra_prefixes: dict) -> URIRef:
    """Turn a CURIE like brick:Setpoint into its full URIRef."""
    ns_map = dict(KNOWN_NS)
    ns_map.update(extra_prefixes)
    for prefix, uri in g.namespaces():
        if prefix:
            ns_map[str(prefix)] = str(uri)

    if ":" in curie:
        prefix, local = curie.split(":", 1)
        if prefix in ns_map:
            return URIRef(ns_map[prefix] + local)
    # Try treating it as a full URI
    if curie.startswith("http"):
        return URIRef(curie)
    raise ValueError(
        f"Cannot resolve '{curie}'. "
        "Register the prefix with --prefix PREFIX:URI"
    )


# ── graph loading ──────────────────────────────────────────────────────────────

def load_graph(files: list[str]) -> Graph:
    g = Graph()
    for f in files:
        fmt = "turtle"
        if f.endswith(".jsonld") or f.endswith(".json"):
            fmt = "json-ld"
        elif f.endswith(".xml") or f.endswith(".rdf") or f.endswith(".owl"):
            fmt = "xml"
        elif f.endswith(".n3"):
            fmt = "n3"
        elif f.endswith(".nt"):
            fmt = "nt"
        try:
            g.parse(f, format=fmt)
            print(f"[info] Loaded {f}  ({len(g)} triples total)", file=sys.stderr)
        except Exception as e:
            sys.exit(f"[error] Could not load {f}: {e}")
    return g


# ── hierarchy building ─────────────────────────────────────────────────────────

def build_children_map(g: Graph) -> dict:
    """Map each class URI → set of direct subclass URIs."""
    children = defaultdict(set)
    for s, _, o in g.triples((None, RDFS.subClassOf, None)):
        if isinstance(s, URIRef) and isinstance(o, URIRef):
            children[str(o)].add(str(s))
    return children


def collect_subtree(root_uri: str, children: dict, max_depth: int) -> list:
    """
    DFS collection of all (uri, depth, parent) tuples in the subtree,
    sorted alphabetically within each sibling group.
    Uses a stack (LIFO); siblings are pushed in reverse-sorted order so
    the first alphabetical child is processed first.
    """
    result = []
    stack = [(root_uri, 0, None)]
    visited = set()
    while stack:
        uri, depth, parent = stack.pop()
        if uri in visited:
            continue
        visited.add(uri)
        result.append((uri, depth, parent))
        if max_depth is None or depth < max_depth:
            # Push in reverse order so sorted-first child is popped next
            for child in sorted(children.get(uri, []), reverse=True):
                if child not in visited:
                    stack.append((child, depth + 1, uri))
    return result


# ── ancestor chain (for --inherited) ──────────────────────────────────────────

def ancestors(uri: str, g: Graph) -> list[str]:
    """Return all ancestor class URIs (rdfs:subClassOf chain), root last."""
    seen = set()
    chain = []
    queue = [URIRef(uri)]
    while queue:
        cur = queue.pop(0)
        for _, _, parent in g.triples((cur, RDFS.subClassOf, None)):
            if isinstance(parent, URIRef) and str(parent) not in seen:
                seen.add(str(parent))
                chain.append(str(parent))
                queue.append(parent)
    return chain


# ── property extraction ────────────────────────────────────────────────────────

def get_own_properties(
    cls_uri: URIRef,
    g: Graph,
    shorten: callable,
    include_object: bool,
) -> list[dict]:
    """
    Collect properties attached directly to cls_uri via:
      1. sh:property shapes
      2. rdfs:domain on owl:DatatypeProperty (and optionally owl:ObjectProperty)
      3. qudt:hasQuantityKind annotations on the class
    """
    props = []
    seen_paths = set()

    # 1. SHACL sh:property
    for _, _, pnode in g.triples((cls_uri, SH.property, None)):
        path     = g.value(pnode, SH.path)
        datatype = g.value(pnode, SH.datatype)
        minc     = g.value(pnode, SH["minCount"])
        maxc     = g.value(pnode, SH["maxCount"])
        node     = g.value(pnode, SH.node)
        cls_node = g.value(pnode, SH["class"])

        if path is None:
            continue
        path_s = str(path)
        if path_s in seen_paths:
            continue
        seen_paths.add(path_s)

        prop = {
            "source":    "sh:property",
            "path":      shorten(path),
            "path_uri":  str(path),
            "datatype":  shorten(datatype),
            "sh_class":  shorten(cls_node),
            "sh_node":   shorten(node),
            "minCount":  str(minc) if minc else None,
            "maxCount":  str(maxc) if maxc else None,
        }
        props.append(prop)

    # 2. rdfs:domain on typed properties
    prop_types = [OWL.DatatypeProperty]
    if include_object:
        prop_types.append(OWL.ObjectProperty)

    for dp in g.subjects(RDFS.domain, cls_uri):
        if not any((dp, RDF.type, pt) in g for pt in prop_types):
            continue
        path_s = str(dp)
        if path_s in seen_paths:
            continue
        seen_paths.add(path_s)
        rng  = g.value(dp, RDFS.range)
        kind = "owl:DatatypeProperty" if (dp, RDF.type, OWL.DatatypeProperty) in g else "owl:ObjectProperty"
        props.append({
            "source":    kind,
            "path":      shorten(dp),
            "path_uri":  path_s,
            "datatype":  shorten(rng),
            "sh_class":  None,
            "sh_node":   None,
            "minCount":  None,
            "maxCount":  None,
        })

    # 3. qudt:hasQuantityKind
    for _, _, qk in g.triples((cls_uri, QUDT.hasQuantityKind, None)):
        props.append({
            "source":    "qudt:hasQuantityKind",
            "path":      shorten(qk),
            "path_uri":  str(qk),
            "datatype":  None,
            "sh_class":  None,
            "sh_node":   None,
            "minCount":  None,
            "maxCount":  None,
        })

    return props


def get_all_properties(
    uri: str,
    g: Graph,
    shorten: callable,
    include_object: bool,
) -> tuple[list[dict], list[dict]]:
    """Return (own_props, inherited_props) for a class URI."""
    own = get_own_properties(URIRef(uri), g, shorten, include_object)
    inherited = []
    seen = {p["path_uri"] for p in own}
    for ancestor_uri in ancestors(uri, g):
        for prop in get_own_properties(URIRef(ancestor_uri), g, shorten, include_object):
            if prop["path_uri"] not in seen:
                seen.add(prop["path_uri"])
                prop = dict(prop)
                prop["inherited_from"] = shorten(URIRef(ancestor_uri))
                inherited.append(prop)
    return own, inherited


# ── metadata helpers ───────────────────────────────────────────────────────────

def get_label(uri: URIRef, g: Graph, lang: str = "en") -> Optional[str]:
    for _, _, label in g.triples((uri, RDFS.label, None)):
        if getattr(label, "language", None) == lang:
            return str(label)
    for _, _, label in g.triples((uri, RDFS.label, None)):
        if getattr(label, "language", None) is None:
            return str(label)
    return None


def get_definition(uri: URIRef, g: Graph) -> Optional[str]:
    val = g.value(uri, SKOS.definition)
    if val is None:
        val = g.value(uri, RDFS.comment)
    return str(val) if val else None


def is_deprecated(uri: URIRef, g: Graph) -> bool:
    return (uri, RDF.type, OWL.DeprecatedClass) in g or \
           (uri, OWL.deprecated, None) in g


# ── output formatters ──────────────────────────────────────────────────────────

def format_prop_text(prop: dict) -> str:
    parts = [f"  ▸ {prop['path']}"]
    if prop.get("datatype"):
        parts.append(f"  xsd:{prop['datatype'].split(':')[-1]}" if prop["datatype"].startswith("xsd:") else f"  → {prop['datatype']}")
    if prop.get("sh_class"):
        parts.append(f"  class:{prop['sh_class']}")
    if prop.get("sh_node"):
        parts.append(f"  node:{prop['sh_node']}")
    constraints = []
    if prop.get("minCount"):
        constraints.append(f"min={prop['minCount']}")
    if prop.get("maxCount"):
        constraints.append(f"max={prop['maxCount']}")
    if constraints:
        parts.append(f"  [{', '.join(constraints)}]")
    if prop.get("inherited_from"):
        parts.append(f"  (from {prop['inherited_from']})")
    return "".join(parts)


def render_text(
    root_uri: str,
    tree: list,
    g: Graph,
    shorten: callable,
    show_definitions: bool,
    include_inherited: bool,
    include_object: bool,
    show_props: bool = True,
) -> str:
    lines = []
    root_short = shorten(URIRef(root_uri))
    defn = get_definition(URIRef(root_uri), g)
    header = f"{root_short}"
    if defn and show_definitions:
        header += f"  — {defn[:100]}"
    lines.append(header)

    for uri, depth, _ in tree:
        if uri == root_uri:
            continue
        cls_uri = URIRef(uri)
        indent  = "  " * depth
        label   = shorten(cls_uri)
        defn    = get_definition(cls_uri, g) if show_definitions else None
        dep     = " [deprecated]" if is_deprecated(cls_uri, g) else ""

        line = f"{indent}{label}{dep}"
        if defn:
            line += f"  — {defn[:90]}"
        lines.append(line)

        if show_props:
            own, inherited = get_all_properties(uri, g, shorten, include_object)
            prop_indent = "  " * (depth + 1)
            for prop in own:
                lines.append(prop_indent + format_prop_text(prop).lstrip())
            if include_inherited:
                for prop in inherited:
                    lines.append(prop_indent + format_prop_text(prop).lstrip())

    return "\n".join(lines)


def render_markdown(
    root_uri: str,
    tree: list,
    g: Graph,
    shorten: callable,
    show_definitions: bool,
    include_inherited: bool,
    include_object: bool,
    show_props: bool = True,
) -> str:
    lines = []
    root_short = shorten(URIRef(root_uri))
    lines.append(f"# `{root_short}` — class hierarchy\n")
    lines.append("| Class | Depth | Properties | Definition |")
    lines.append("|-------|------:|------------|------------|")

    for uri, depth, _ in tree:
        cls_uri = URIRef(uri)
        label   = shorten(cls_uri)
        dep     = " *(deprecated)*" if is_deprecated(cls_uri, g) else ""
        defn    = get_definition(cls_uri, g) if show_definitions else ""
        defn    = (defn or "")[:80].replace("|", "\\|")

        if show_props:
            own, inherited = get_all_properties(uri, g, shorten, include_object)
            all_props = own + (inherited if include_inherited else [])
            prop_str = "<br>".join(f"`{p['path']}`" for p in all_props) if all_props else "—"
        else:
            prop_str = "—"

        indent = "&nbsp;" * (depth * 4)
        lines.append(f"| {indent}`{label}`{dep} | {depth} | {prop_str} | {defn} |")

    return "\n".join(lines)


def render_json(
    root_uri: str,
    tree: list,
    g: Graph,
    shorten: callable,
    include_inherited: bool,
    include_object: bool,
) -> str:

    def node_dict(uri, depth):
        cls_uri = URIRef(uri)
        own, inherited = get_all_properties(uri, g, shorten, include_object)
        result = {
            "uri":        uri,
            "short":      shorten(cls_uri),
            "depth":      depth,
            "deprecated": is_deprecated(cls_uri, g),
            "label":      get_label(cls_uri, g),
            "definition": get_definition(cls_uri, g),
            "properties": own,
        }
        if include_inherited:
            result["inherited_properties"] = inherited
        return result

    nodes = [node_dict(uri, depth) for uri, depth, _ in tree]
    return json.dumps({"root": shorten(URIRef(root_uri)), "nodes": nodes}, indent=2)


def render_csv(
    root_uri: str,
    tree: list,
    g: Graph,
    shorten: callable,
    include_inherited: bool,
    include_object: bool,
    delimiter: str = ",",
) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=delimiter)
    writer.writerow([
        "class_short", "class_uri", "depth", "deprecated",
        "prop_path", "prop_path_uri", "prop_source",
        "datatype", "sh_class", "sh_node",
        "minCount", "maxCount", "inherited_from",
    ])
    for uri, depth, _ in tree:
        cls_uri = URIRef(uri)
        short   = shorten(cls_uri)
        dep     = is_deprecated(cls_uri, g)
        own, inherited = get_all_properties(uri, g, shorten, include_object)
        all_props = own + (inherited if include_inherited else [])
        if not all_props:
            writer.writerow([short, uri, depth, dep] + [""] * 8)
        else:
            for prop in all_props:
                writer.writerow([
                    short, uri, depth, dep,
                    prop.get("path", ""),
                    prop.get("path_uri", ""),
                    prop.get("source", ""),
                    prop.get("datatype", "") or "",
                    prop.get("sh_class", "") or "",
                    prop.get("sh_node", "") or "",
                    prop.get("minCount", "") or "",
                    prop.get("maxCount", "") or "",
                    prop.get("inherited_from", "") or "",
                ])
    return buf.getvalue()


# ── list roots ────────────────────────────────────────────────────────────────

def list_roots(g: Graph, shorten: callable) -> str:
    """Print all classes that have no rdfs:subClassOf inside the graph."""
    all_classes = set()
    has_parent  = set()
    for s, _, o in g.triples((None, RDFS.subClassOf, None)):
        if isinstance(s, URIRef) and isinstance(o, URIRef):
            all_classes.add(str(s))
            all_classes.add(str(o))
            has_parent.add(str(s))
    roots = sorted(all_classes - has_parent)
    lines = [f"Root classes ({len(roots)} found):"]
    for r in roots:
        lines.append(f"  {shorten(URIRef(r))}")
    return "\n".join(lines)



# ── parent chain renderer ──────────────────────────────────────────────────────

def render_parents(
    cls_uri: str,
    g: Graph,
    shorten: callable,
    show_definitions: bool,
    include_object: bool,
) -> str:
    """
    Walk the rdfs:subClassOf chain upward from cls_uri and print each ancestor
    level, from the given class up to the root(s).  Multiple inheritance is
    handled — if a class has more than one parent both branches are shown.
    Properties at each level are included.
    """
    lines = []

    # BFS upward, tracking depth-from-start so indentation goes outward
    # Level 0 = the class itself, level 1 = its parents, level 2 = grandparents …
    visited = set()
    queue   = [(cls_uri, 0)]

    while queue:
        uri, depth = queue.pop(0)
        if uri in visited:
            continue
        visited.add(uri)

        ref    = URIRef(uri)
        label  = shorten(ref)
        defn   = get_definition(ref, g) if show_definitions else None
        dep    = " [deprecated]" if is_deprecated(ref, g) else ""
        indent = "  " * depth

        # Arrow prefix — the class itself gets none, parents get an upward arrow
        prefix = "" if depth == 0 else "↑ "
        line   = f"{indent}{prefix}{label}{dep}"
        if defn:
            line += f"  — {defn[:90]}"
        lines.append(line)

        # Own properties
        own, _ = get_all_properties(uri, g, shorten, include_object)
        prop_indent = "  " * (depth + 1)
        for prop in own:
            lines.append(prop_indent + format_prop_text(prop).lstrip())

        # Queue parents
        for _, _, parent in sorted(
            g.triples((ref, RDFS.subClassOf, None)),
            key=lambda t: str(t[2]),
        ):
            if isinstance(parent, URIRef) and str(parent) not in visited:
                queue.append((str(parent), depth + 1))

    return "\n".join(lines)


# ── properties flat-list renderer ─────────────────────────────────────────────

def render_properties(
    cls_uri: str,
    g: Graph,
    shorten: callable,
    show_definitions: bool,
) -> str:
    """
    Collect ALL properties (data + object) for cls_uri — own first, then
    inherited — and return a flat formatted table:

      Property  |  Type  |  Description  |  Inherited from
    """
    ref = URIRef(cls_uri)

    # ── gather own properties ──
    own_rows = []
    seen_paths = set()

    def _prop_type(path_uri: str, source: str) -> str:
        """Determine display type from OWL typing or SHACL source."""
        pu = URIRef(path_uri)
        if (pu, RDF.type, OWL.DatatypeProperty) in g:
            return "data"
        if (pu, RDF.type, OWL.ObjectProperty) in g:
            return "object"
        if source == "qudt:hasQuantityKind":
            return "annotation"
        # sh:property — infer from datatype vs sh:class
        return "data"   # default for SHACL paths without explicit typing

    def _prop_desc(path_uri: str) -> str:
        pu = URIRef(path_uri)
        val = g.value(pu, SKOS.definition)
        if val is None:
            val = g.value(pu, RDFS.comment)
        if val is None:
            val = g.value(pu, RDFS.label)
        return str(val) if val else ""

    def _collect(uri: URIRef, inherited_from: str = "") -> None:
        # SHACL sh:property
        for _, _, pnode in g.triples((uri, SH.property, None)):
            path = g.value(pnode, SH.path)
            if path is None or str(path) in seen_paths:
                continue
            seen_paths.add(str(path))
            datatype = g.value(pnode, SH.datatype)
            sh_class = g.value(pnode, SH["class"])
            sh_node  = g.value(pnode, SH.node)
            minc     = g.value(pnode, SH["minCount"])
            maxc     = g.value(pnode, SH["maxCount"])

            # Derive a range hint
            range_hint = ""
            if datatype:
                range_hint = shorten(datatype)
            elif sh_class:
                range_hint = shorten(sh_class)
            elif sh_node:
                range_hint = shorten(sh_node)

            constraints = []
            if minc: constraints.append(f"min={minc}")
            if maxc: constraints.append(f"max={maxc}")
            if constraints:
                range_hint += "  [" + ", ".join(constraints) + "]"

            own_rows.append({
                "property":      shorten(path),
                "property_uri":  str(path),
                "type":          _prop_type(str(path), "sh:property"),
                "range":         range_hint,
                "description":   _prop_desc(str(path)) if show_definitions else "",
                "inherited_from": inherited_from,
            })

        # rdfs:domain OWL properties (data + object)
        for dp in g.subjects(RDFS.domain, uri):
            path_s = str(dp)
            if path_s in seen_paths:
                continue
            if not ((dp, RDF.type, OWL.DatatypeProperty) in g or
                    (dp, RDF.type, OWL.ObjectProperty) in g):
                continue
            seen_paths.add(path_s)
            rng = g.value(dp, RDFS.range)
            own_rows.append({
                "property":      shorten(dp),
                "property_uri":  path_s,
                "type":          _prop_type(path_s, "rdfs:domain"),
                "range":         shorten(rng) if rng else "",
                "description":   _prop_desc(path_s) if show_definitions else "",
                "inherited_from": inherited_from,
            })

        # qudt:hasQuantityKind
        for _, _, qk in g.triples((uri, QUDT.hasQuantityKind, None)):
            path_s = str(qk)
            if path_s in seen_paths:
                continue
            seen_paths.add(path_s)
            own_rows.append({
                "property":      shorten(qk),
                "property_uri":  path_s,
                "type":          "annotation",
                "range":         "",
                "description":   _prop_desc(path_s) if show_definitions else "",
                "inherited_from": inherited_from,
            })

    # Own properties first
    _collect(ref, "")
    # Then ancestors
    for anc_uri in ancestors(cls_uri, g):
        _collect(URIRef(anc_uri), shorten(URIRef(anc_uri)))

    if not own_rows:
        return f"No properties found for {shorten(ref)}."

    # Sort: object → data → annotation, alphabetically within each group
    TYPE_ORDER = {"object": 0, "data": 1, "annotation": 2}
    own_rows.sort(key=lambda r: (TYPE_ORDER.get(r["type"], 9), r["property"]))

    # ── format as aligned text table ──
    HDR = ("Property", "Type", "Range", "Description", "Inherited from")
    rows = [HDR] + [
        (
            r["property"],
            r["type"],
            r["range"],
            r["description"][:60] if r["description"] else "—",
            r["inherited_from"] if r["inherited_from"] else "(own)",
        )
        for r in own_rows
    ]

    # Column widths
    widths = [max(len(row[i]) for row in rows) for i in range(len(HDR))]

    sep   = "  ".join("─" * w for w in widths)
    lines = []
    lines.append(f"Properties of {shorten(ref)}  ({len(own_rows)} total)\n")

    # Header
    lines.append("  ".join(h.ljust(widths[i]) for i, h in enumerate(HDR)))
    lines.append(sep)
    for row in rows[1:]:
        lines.append("  ".join(str(row[i]).ljust(widths[i]) for i in range(len(HDR))))

    return "\n".join(lines)


def render_properties_csv(
    cls_uri: str,
    g: Graph,
    shorten: callable,
    show_definitions: bool,
    delimiter: str = ",",
) -> str:
    """CSV version of render_properties — reuses the same collection logic."""
    ref = URIRef(cls_uri)
    seen_paths = set()
    all_rows = []

    def _prop_type(path_uri: str) -> str:
        pu = URIRef(path_uri)
        if (pu, RDF.type, OWL.DatatypeProperty) in g:
            return "data"
        if (pu, RDF.type, OWL.ObjectProperty) in g:
            return "object"
        return "data"

    def _prop_desc(path_uri: str) -> str:
        pu = URIRef(path_uri)
        val = g.value(pu, SKOS.definition)
        if val is None:
            val = g.value(pu, RDFS.comment)
        if val is None:
            val = g.value(pu, RDFS.label)
        return str(val) if val else ""

    def _collect(uri: URIRef, inherited_from: str = "") -> None:
        # SHACL sh:property
        for _, _, pnode in g.triples((uri, SH.property, None)):
            path = g.value(pnode, SH.path)
            if path is None or str(path) in seen_paths:
                continue
            seen_paths.add(str(path))
            datatype = g.value(pnode, SH.datatype)
            sh_class = g.value(pnode, SH["class"])
            sh_node  = g.value(pnode, SH.node)
            minc     = g.value(pnode, SH["minCount"])
            maxc     = g.value(pnode, SH["maxCount"])
            range_hint = shorten(datatype) if datatype else (shorten(sh_class) if sh_class else (shorten(sh_node) if sh_node else ""))
            all_rows.append({
                "property": shorten(path), "type": _prop_type(str(path)),
                "range": range_hint, "minCount": str(minc) if minc else "",
                "maxCount": str(maxc) if maxc else "",
                "description": _prop_desc(str(path)) if show_definitions else "",
                "inherited_from": inherited_from,
            })
        # rdfs:domain
        for dp in g.subjects(RDFS.domain, uri):
            path_s = str(dp)
            if path_s in seen_paths:
                continue
            if not ((dp, RDF.type, OWL.DatatypeProperty) in g or
                    (dp, RDF.type, OWL.ObjectProperty) in g):
                continue
            seen_paths.add(path_s)
            rng = g.value(dp, RDFS.range)
            all_rows.append({
                "property": shorten(dp), "type": _prop_type(path_s),
                "range": shorten(rng) if rng else "",
                "minCount": "", "maxCount": "",
                "description": _prop_desc(path_s) if show_definitions else "",
                "inherited_from": inherited_from,
            })
        # qudt:hasQuantityKind
        for _, _, qk in g.triples((uri, QUDT.hasQuantityKind, None)):
            path_s = str(qk)
            if path_s in seen_paths:
                continue
            seen_paths.add(path_s)
            all_rows.append({
                "property": shorten(qk), "type": "annotation",
                "range": "", "minCount": "", "maxCount": "",
                "description": _prop_desc(path_s) if show_definitions else "",
                "inherited_from": inherited_from,
            })

    _collect(ref, "")
    for anc_uri in ancestors(cls_uri, g):
        _collect(URIRef(anc_uri), shorten(URIRef(anc_uri)))

    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=delimiter)
    writer.writerow(["class", "property", "type", "range", "minCount", "maxCount", "description", "inherited_from"])
    for r in all_rows:
        writer.writerow([
            shorten(ref), r["property"], r["type"], r["range"],
            r["minCount"], r["maxCount"], r["description"], r["inherited_from"],
        ])
    return buf.getvalue()


def render_parents_csv(
    cls_uri: str,
    g: Graph,
    shorten: callable,
    include_object: bool,
    delimiter: str = ",",
) -> str:
    """CSV version of render_parents."""
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=delimiter)
    writer.writerow(["class", "depth", "deprecated", "definition", "prop_path", "prop_type", "prop_range"])

    visited = set()
    queue = [(cls_uri, 0)]

    while queue:
        uri, depth = queue.pop(0)
        if uri in visited:
            continue
        visited.add(uri)
        ref = URIRef(uri)
        defn = get_definition(ref, g) or ""
        dep = is_deprecated(ref, g)
        own, _ = get_all_properties(uri, g, shorten, include_object)
        if not own:
            writer.writerow([shorten(ref), depth, dep, defn[:80], "", "", ""])
        else:
            for prop in own:
                rng = prop.get("datatype") or prop.get("sh_class") or prop.get("sh_node") or ""
                writer.writerow([shorten(ref), depth, dep, defn[:80], prop["path"], prop.get("source", ""), rng])
        for _, _, parent in sorted(g.triples((ref, RDFS.subClassOf, None)), key=lambda t: str(t[2])):
            if isinstance(parent, URIRef) and str(parent) not in visited:
                queue.append((str(parent), depth + 1))

    return buf.getvalue()


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(
        description="Ontology class-tree explorer — Brick + DHC edition.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("root_class", nargs="?",
                   help="Root class CURIE or full URI, e.g. brick:Setpoint")
    p.add_argument("--prefix", metavar="PREFIX:URI", action="append", default=[],
                   help="Extra prefix mapping, e.g. myns:http://example.org/ns#")
    p.add_argument("--depth", metavar="N", type=int, default=None,
                   help="Maximum tree depth (default: unlimited)")
    p.add_argument("--inherited", action="store_true",
                   help="Show properties inherited from parent classes")
    p.add_argument("--include-object-props", action="store_true",
                   help="Include owl:ObjectProperty alongside owl:DatatypeProperty")
    p.add_argument("--format", choices=["text", "json", "csv", "csv-semi", "markdown"],
                   default="text", help="Output format (default: text). csv-semi uses ; as delimiter.")
    p.add_argument("--out", metavar="FILE",
                   help="Write output to FILE (default: stdout)")
    p.add_argument("--no-definitions", action="store_true",
                   help="Suppress skos:definition in text/markdown output")
    p.add_argument("--list-roots", action="store_true",
                   help="List top-level classes (no rdfs:subClassOf) and exit")
    p.add_argument("--parents", action="store_true",
                   help="Show the ancestor chain of root_class instead of its subclass tree")
    p.add_argument("--properties", action="store_true",
                   help="Show a flat list of all properties (data+object) for root_class")
    p.add_argument("--show-props", action="store_true", default=False,
                   help="Show inline properties in tree mode (default: off)")
    p.add_argument("--include-deprecated", action="store_true", default=False,
                   help="Include deprecated classes in the tree (default: excluded)")
    return p.parse_args()


# ── interactive prompt ─────────────────────────────────────────────────────────

FORMATS = ["text", "json", "csv", "csv-semi", "markdown"]

# ── conf file ─────────────────────────────────────────────────────────────────

def _conf_path(ttl_file: str = "") -> _Path:
    """Return onto_tree.conf next to the script."""
    script_dir = _Path(__file__).resolve().parent
    return script_dir / "onto_tree.conf"


def load_conf(ttl_file: str = "") -> dict:
    """Load conf, returning {} on first run."""
    cp = _conf_path()
    if cp.exists():
        try:
            return _json.loads(cp.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def save_conf(ttl_file: str = "", conf: dict = None) -> None:
    """Persist conf next to the script."""
    if conf is None:
        conf = {}
    cp = _conf_path()
    try:
        cp.write_text(_json.dumps(conf, indent=2), encoding="utf-8")
        print(f"[info] Conf saved → {cp}", file=sys.stderr)
    except Exception as e:
        print(f"[warning] Could not save conf: {e}", file=sys.stderr)


def _ask(prompt: str, default: str) -> str:
    """Print prompt, return stripped input or default on empty/EOF."""
    try:
        val = input(prompt).strip()
        return val if val else default
    except (EOFError, KeyboardInterrupt):
        print()
        sys.exit(0)


def _ask_format(args) -> None:
    """Prompt for output format unless already set via CLI."""
    if "--format" in sys.argv:
        return
    choices = "  ".join(f"[{i+1}] {f}" for i, f in enumerate(FORMATS))
    raw = _ask(f"  Format  {choices}  (default=1): ", "1")
    try:
        idx = int(raw) - 1
        if 0 <= idx < len(FORMATS):
            args.format = FORMATS[idx]
        else:
            print("  Choice out of range, using 'text'.")
            args.format = "text"
    except ValueError:
        if raw.lower() in FORMATS:
            args.format = raw.lower()
        else:
            print(f"  Unknown format '{raw}', using 'text'.")
            args.format = "text"


def interactive_prompt(args, g: Graph, shorten: callable, children: dict, conf: dict) -> None:
    """
    Lead with class (if not on CLI), then direction, then direction-specific options.
    Shows last-used class from conf as the default.
    Skips any question already supplied on the CLI.
    """
    SEP = "─" * 50
    print(SEP)

    # ── class — skip if already supplied on CLI ──
    if not args.root_class:
        last = conf.get("last_class", "")
        hint = f" (last: {last})" if last else ""
        raw  = _ask(f"  Class{hint}: ", last)
        if not raw:
            print("  No class given, aborting.")
            sys.exit(1)
        args.root_class = raw.strip()

    # ── direction — skip if --parents or --properties already passed on CLI ──
    if "--parents" not in sys.argv and "--properties" not in sys.argv:
        raw = _ask(
            "  Direction  [1] down — subclass tree  "
            "[2] up — parent chain  "
            "[3] properties list  (default=1): ", "1"
        )
        choice = raw.strip()
        args.parents     = choice == "2"
        args.properties  = choice == "3"

    if args.parents:
        # ── up: format + output file only ──
        _ask_format(args)
        if args.out is None:
            raw = _ask("  Output file (default=stdout): ", "")
            args.out = raw if raw else None
        print(SEP)
        return

    if args.properties:
        # ── properties: format → output file ──
        _ask_format(args)
        if args.out is None:
            raw = _ask("  Output file (default=stdout): ", "")
            args.out = raw if raw else None
        print(SEP)
        return

    # ── down: depth → format → output file ──

    # Discover real max depth for the chosen root
    real_max = "?"
    if args.root_class:
        try:
            root_uri = resolve_curie(args.root_class, g, {})
            full_tree = collect_subtree(str(root_uri), children, None)
            real_max  = max((d for _, d, _ in full_tree), default=0)
        except Exception:
            pass

    if args.depth is None:
        hint = f"0–{real_max}" if real_max != "?" else "0–N"
        raw = _ask(f"  Depth [{hint}, default=unlimited]: ", "")
        if raw == "":
            args.depth = None
        else:
            try:
                args.depth = int(raw)
                if args.depth < 0:
                    raise ValueError
            except ValueError:
                print(f"  Invalid depth '{raw}', using unlimited.")
                args.depth = None

    _ask_format(args)

    if "--show-props" not in sys.argv:
        raw = _ask("  Show inline properties  [y/n]  (default=n): ", "n")
        args.show_props = raw.strip().lower() in ("y", "yes", "1")

    if "--include-deprecated" not in sys.argv:
        raw = _ask("  Show deprecated classes  [y/n]  (default=n): ", "n")
        args.include_deprecated = raw.strip().lower() in ("y", "yes", "1")

    if args.out is None:
        raw = _ask("  Output file (default=stdout): ", "")
        args.out = raw if raw else None

    print(SEP)


def main():
    args = parse_args()

    # Validate hardcoded files exist
    missing = [f for f in ONTOLOGY_FILES if not _Path(f).exists()]
    if missing:
        sys.exit(
            "[error] Ontology file(s) not found:\n"
            + "\n".join(f"  {f}" for f in missing)
            + "\nEdit ONTOLOGY_FILES at the top of the script."
        )

    # Parse extra prefix mappings
    extra_prefixes = {}
    for pair in args.prefix:
        if ":" not in pair:
            sys.exit(f"[error] --prefix must be PREFIX:URI, got: {pair}")
        prefix, uri = pair.split(":", 1)
        extra_prefixes[prefix] = uri

    # Load hardcoded graph
    g = load_graph(ONTOLOGY_FILES)

    shorten  = make_shortener(g, extra_prefixes)
    children = build_children_map(g)
    conf     = load_conf()

    # --list-roots mode
    if args.list_roots:
        output = list_roots(g, shorten)
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(output)
        else:
            print(output)
        return

    # Interactive prompt — runs whenever class, direction, or format is missing
    # "fully specified" means class on CLI + direction + format all present
    cli_has_class      = bool(args.root_class)
    cli_has_direction  = "--parents"    in sys.argv
    cli_has_properties = "--properties" in sys.argv
    cli_has_format     = "--format"     in sys.argv
    cli_has_depth      = "--depth"      in sys.argv

    fully_specified = (
        cli_has_class and cli_has_format
        and (
            cli_has_direction                        # up path
            or cli_has_properties                    # properties path
            or cli_has_depth                         # down path
        )
    )

    if not fully_specified:
        interactive_prompt(args, g, shorten, children, conf)

    # Resolve root class (may have been set interactively)
    if not args.root_class:
        sys.exit("[error] No class specified.")
    try:
        root_uri = resolve_curie(args.root_class, g, extra_prefixes)
    except ValueError as e:
        sys.exit(f"[error] {e}")

    # Check the class exists in the graph
    if not any(True for _ in g.triples((root_uri, None, None))):
        print(
            f"[warning] '{args.root_class}' ({root_uri}) has no triples in the loaded graph. "
            "The tree will be empty. Check the prefix/URI or load additional files with --extra.",
            file=sys.stderr,
        )

    # Save last-used class to conf
    conf["last_class"] = args.root_class
    save_conf("", conf)

    # Dispatch based on direction
    if args.parents:
        show_defs = not args.no_definitions
        if args.format in ("csv", "csv-semi"):
            output = render_parents_csv(
                str(root_uri), g, shorten, args.include_object_props,
                delimiter=";" if args.format == "csv-semi" else ",",
            )
        else:
            output = render_parents(
                str(root_uri), g, shorten, show_defs, args.include_object_props,
            )
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(output)
            print(f"[info] Written to {args.out}", file=sys.stderr)
        else:
            print(output)
        return

    if args.properties:
        show_defs = not args.no_definitions
        if args.format in ("csv", "csv-semi"):
            output = render_properties_csv(
                str(root_uri), g, shorten, show_defs,
                delimiter=";" if args.format == "csv-semi" else ",",
            )
        else:
            output = render_properties(str(root_uri), g, shorten, show_defs)
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(output)
            print(f"[info] Written to {args.out}", file=sys.stderr)
        else:
            print(output)
        return

    # Build hierarchy with final depth
    tree = collect_subtree(str(root_uri), children, args.depth)

    # Filter deprecated unless explicitly included
    if not args.include_deprecated:
        tree = [
            (uri, depth, parent) for uri, depth, parent in tree
            if not is_deprecated(URIRef(uri), g)
        ]

    print(
        f"[info] Root: {shorten(root_uri)}  |  "
        f"Subclasses: {len(tree)-1}  |  "
        f"Max depth: {max(d for _,d,_ in tree) if tree else 0}"
        + ("" if args.include_deprecated else "  [deprecated excluded]"),
        file=sys.stderr,
    )

    # Render
    show_defs = not args.no_definitions

    if args.format == "text":
        output = render_text(
            str(root_uri), tree, g, shorten,
            show_defs, args.inherited, args.include_object_props,
            args.show_props,
        )
    elif args.format == "markdown":
        output = render_markdown(
            str(root_uri), tree, g, shorten,
            show_defs, args.inherited, args.include_object_props,
            args.show_props,
        )
    elif args.format == "json":
        output = render_json(
            str(root_uri), tree, g, shorten,
            args.inherited, args.include_object_props,
        )
    elif args.format == "csv":
        output = render_csv(
            str(root_uri), tree, g, shorten,
            args.inherited, args.include_object_props,
            delimiter=",",
        )
    elif args.format == "csv-semi":
        output = render_csv(
            str(root_uri), tree, g, shorten,
            args.inherited, args.include_object_props,
            delimiter=";",
        )

    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="") as f:
            f.write(output)
        print(f"[info] Written to {args.out}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
