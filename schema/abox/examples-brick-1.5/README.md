# Brick 1.5 example models — third-party, bundled as reference

These `.ttl` files are **not part of DigitalHome.Cloud** and are **not covered by
this repository's Apache-2.0 license**. They are the example models shipped with
the [Brick schema](https://brickschema.org/), copied here verbatim so the offline
A-Box viewer (`js-tools/`) can render standard Brick models next to the DHC
electrical ones.

| | |
|---|---|
| **Source** | `brickschema/Brick`, `examples/` — https://github.com/BrickSchema/Brick |
| **Copyright** | © 2016–2026 Brick Consortium, Inc. All rights reserved. |
| **License** | BSD 3-Clause — full text in [`LICENSE`](./LICENSE) in this folder |
| **Modifications** | **None.** Every file is byte-identical to upstream. |

The files were flattened out of their upstream subfolders (`simple_apartment/`,
`lighting/`, …) into this one directory, keeping their original basenames; their
*contents* are unchanged. This flattening is a packaging convenience for the
viewer, not a modification of the works.

## Why they are here and how they are treated

The viewer treats any `.ttl` in a **subfolder** of `schema/abox/` as an external
**reference** model: rendered so it can be browsed, but never validated against
the DHC C-Box (a stock Brick model carries no norm layer, so every node is
`unchecked`) and not covered by this repo's tests. See `js-tools/README.md`
§ "Adding a model to the viewer". A handful of samples whose relationships are
all blank-node or literal (bacnet, ifc) have no topology to draw and are skipped
by the build with a warning.

## Retaining the notice (BSD 3-Clause condition 1)

`LICENSE` in this folder retains Brick's copyright notice, the list of
conditions, and the disclaimer, which is what BSD 3-Clause requires of a source
redistribution. Do not remove it while these files remain. If you delete the
example set, delete this folder whole — `LICENSE`, `README.md` and all.

**Nominative use only:** "Brick" and "Brick 1.5" appear here to identify the
standard these files implement. Per condition 3 of the license, that is not, and
must not be presented as, an endorsement of DigitalHome.Cloud by the Brick
Consortium.
