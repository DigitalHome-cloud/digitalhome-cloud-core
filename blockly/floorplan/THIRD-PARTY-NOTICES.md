# Third-party notices — Floor-plan sketch view

The DigitalHome.Cloud **Floor plan** tab (`blockly/floorplan/`) is adapted from a
prototype derived from the following open-source project. This file provides the
attribution and statement-of-changes that the Apache License 2.0 requires.

---

## Arcada — floor planner

- **Project:** Arcada (`arkada-react`)
- **Source:** https://github.com/mehanix/arcada
- **Copyright:** © the Arcada authors (mehanix)
- **License:** Apache License, Version 2.0 — full text in
  [`LICENSE-Arcada-Apache-2.0.txt`](./LICENSE-Arcada-Apache-2.0.txt)

### What we use

- **`furniture-glyphs.jsx`** — the furniture **catalog**: the full item list, its
  **names**, **real-world dimensions** (metres) and **category** grouping are taken
  from Arcada's backend seed data (`arcada-backend/seed_data/furniture.json` +
  `categories.json`), together with the local `(0,0,w,h)` drawing convention.
- The **serialized floor-plan shape** that informed our `floorplan` geometry layer
  (rooms/walls/openings/furniture) follows Arcada's `FloorPlanSerializable` model.

### Changes made (Apache-2.0 §4b)

- **None of Arcada's image assets are used.** Arcada ships each item as a low-res
  raster PNG embedded in an SVG (`arcada-backend/assets/2d/*.svg`); we instead
  **re-draw** a compact set of self-contained **vector** glyphs and map every
  catalog item to one (variants share a glyph — the name and size differentiate
  them). Nothing from Arcada's rendering code (PIXI) or artwork is copied.
- The catalog is trimmed of the `Wall` items (door/window) — the DHC view places
  those with its own Door/Window tools — and the room-label / point glyphs from the
  prototype were dropped (the DHC view draws its own).
- The editing interactions (place, drag, rotate, delete; polygon rooms, standard
  walls, doors/windows), the Blockly-driven structure, and the harness integration
  are **original DHC work**, not from Arcada.
- The module is namespaced onto `window.DHC_FURNITURE` and lazy-loaded by the
  harness (`blockly/preview.html`).

The rest of the floor-plan view — `geometry.mjs`, `spatial-parse.mjs`,
`floorplan-app.jsx` (excluding the furniture catalog noted above) — is original
DigitalHome.Cloud code.

---

_Runtime libraries (React, ReactDOM, Babel-standalone) are loaded from a CDN and
are each MIT-licensed; they are not vendored here._
