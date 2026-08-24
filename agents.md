# agents.md — OrgVisualizr

## What This Is

A small, client-side web app for visualizing organizational charts. A chart is a single JSON document — the DSL, see `docs/dsl.md` — editable as a form (Visual editor) or as raw text (JSON editor), both synced live, then rendered as a card-based SVG tree.

## Core Idea

Everything runs in the browser. No backend, no build step, no database (ADR-001). `DataModel` validates/normalizes the chart JSON, and the result feeds one of two views, toggled in the header: the **Tree view** (`LayoutEngine` + `ChartRenderer`, the org chart itself, via `d3.stratify()`/`d3.tree()`) or the **Sections view** (`SectionsLayout` + `sections-renderer.js`, a more abstract department/group-of-leads view — ADR-006). Alpine.js drives all UI state — the dual editor, modals, theme, view toggles. Persistence is `localStorage` plus JSON/SVG/PNG/PDF/Text export (ADR-003) — no server involved at any point.

## Architecture

```
Browser
  ├── D3.js (CDN)      — SVG rendering; d3.stratify()/d3.tree() layout
  ├── Alpine.js (CDN)  — reactive UI state
  ├── i18next (CDN)    — EN/DE localization
  └── Vanilla JS modules (js/)
        └── js/app.js  — Alpine root state, i18n init, module wiring, renderChart() orchestration
              ├── js/data-model.js     — validate/normalize chart JSON
              ├── js/layout-engine.js  — normalized data -> {x,y} coordinates (Tree view)
              ├── js/chart-renderer.js — {x,y} -> SVG (cards, connectors, badges, tooltips, pan/zoom);
              │                          also owns renderSections(), delegating to sections-renderer.js
              ├── js/sections-layout.js   — normalized data -> section/group/lead-row boxes (Sections view, ADR-006)
              ├── js/sections-renderer.js — section/group boxes -> SVG (ADR-006)
              ├── js/editor-actions.js — Visual-editor tree mutations
              ├── js/file-manager.js   — localStorage save/load/delete, export, remote import
              ├── js/text-export.js    — Markdown/text nested-list export
              ├── js/url-state.js      — URL params (view state only)
              ├── js/dialog.js         — promise-based alert/confirm/prompt modals
              └── js/color-utils.js    — department palette, contrast-text, palette dropdown positioning
        ├── localStorage  — orgvisualizr_index, orgvisualizr_file_<name>, orgvisualizr_theme
        └── URL params    — ?lang=, ?editor=, ?file=, ?source=

No server. No build step. No database.
```

## Key Files

| File | Role |
|------|------|
| `index.html` | App shell — header, dual editor (Visual/JSON tabs), modals, SVG canvas mount point |
| `css/orgvisualizr.css` | All styling. Every color is a CSS custom property on `:root`; `:root[data-theme="light"]` overrides them for light mode |
| `js/app.js` | Alpine root state, i18n init, module wiring, `renderChart()`/`updateFromJson()` orchestration, theme toggle |
| `js/data-model.js` | Validates/normalizes chart JSON — root/id/parentId/cycle checks, `coOccupants`/`placement` rules (ADR-004) |
| `js/layout-engine.js` | `data -> {x,y}` via `d3.stratify()`/`d3.tree()`; co-occupant cluster widths, staff positioning, `hideLeaves` pruning (ADR-004, ADR-005) |
| `js/chart-renderer.js` | Tree view: `{x,y} -> SVG` — occupant cards, elbow/staff connectors, "+N" badges, tooltips, pan/zoom. Also `renderSections()`, the Sections view's container/svgElement/zoom owner (ADR-006) |
| `js/sections-layout.js` | Sections view: normalized data -> section/group/row box positions, tier-indented, root section centered with connectors (ADR-006) |
| `js/sections-renderer.js` | Sections view: box layout -> SVG (section/group rects+titles, one text row per lead) (ADR-006) |
| `js/editor-actions.js` | Visual editor mutations — add/remove nodes and co-occupants, reparent, collapse, delete guardrail (ADR-005), recolor subtree |
| `js/file-manager.js` | `localStorage` save/load/delete, JSON/SVG/PNG/PDF export (both views), remote JSON import |
| `js/text-export.js` | Markdown/text nested-list export |
| `js/url-state.js` | URL parameter sync (editor visibility, saved file, remote source) |
| `js/dialog.js` | Promise-based alert/confirm/prompt modal system (used instead of native `confirm()`/`alert()`) |
| `js/color-utils.js` | Department color palette, `getContrastTextColor()`, palette dropdown positioning |
| `js/utils.js` | Shared helpers — HTML/SVG escaping & sanitizing, text truncation, filename sanitizing, blob downloads |
| `data/example.json` | Default chart loaded on first run — also the reference example exercising every DSL feature at once |
| `locales/en/`, `locales/de/` | `translation.json` — i18next strings |
| `docs/dsl.md` | Full DSL / data-model reference, with examples |
| `docs/adrs/` | Architecture Decision Records |

## Data Model / DSL

See `docs/dsl.md` for the complete reference with examples. In short: JSON *is* the DSL, no custom syntax to parse. A flat `nodes[]` array with `parentId` forms a strict single-parent tree (ADR-002); `coOccupants[]` and `placement: "staff"` (ADR-004) extend individual positions without turning that tree into a graph.

## Persistence & Sharing (ADR-003)

`localStorage` under two key patterns: `orgvisualizr_index` (array of saved chart names) and `orgvisualizr_file_<name>` (that chart's JSON). Export as JSON, SVG, PNG, PDF, or a Markdown/text nested list — that exported file is the only way to move a chart to another device or hand it to someone else; there is no compressed-URL share link (removed, see ADR-003's update). `orgvisualizr_theme` (light/dark) is a separate, unrelated `localStorage` key.

## Theming

Every color used anywhere in the app is a CSS custom property; `:root[data-theme="light"]` supplies the light-mode overrides. A small inline script in `index.html`'s `<head>` reads `orgvisualizr_theme` and sets `data-theme` on `<html>` *before* Alpine/app.js load, so there's no flash of the wrong theme on first paint. A few colors (text on the avatar circle, the badge circle, the tooltip) are deliberately **not** variables — see the comments at their CSS rules for why.

## Localization

i18next, loaded from CDN, with strings in `locales/<lang>/translation.json`. Language is auto-detected, overridable via `?lang=`, and persisted through the URL like the other view state.

To add a language:

1. Duplicate `locales/en/` to `locales/<code>/` (e.g. `locales/fr/`) and translate the values in `translation.json` — leave the keys unchanged.
2. Add an `<option>` for the new language code in the language `<select>` in `index.html`.
3. Run the app locally and switch to the new language to verify it loads.

## Editor Guardrails & View Controls (ADR-005)

- A node can only be deleted once it has no reports at all, direct or indirect; every delete asks for confirmation.
- "Hide leaves" and "Manage" (`hideLeaves`/`manageMode` in `app.js`) are pure client-side view state — never written into `data.nodes`, never present in exported/shared JSON. Two viewers of the same chart JSON can have either switch on or off independently.
- Saved charts are deleted via the header's "Files" modal (`manageFilesModalOpen`), not the quick-switch `<select>`, which has no delete affordance.

## Sections View (ADR-006)

A second, more abstract view (header toggle, `viewMode` in `app.js`) that steps back from individuals toward organizational shape: one box per `department` ("section"), containing named sub-group boxes for each effective `group` (a person's own `group`, or the nearest ancestor's within the same department — see `docs/dsl.md`). Same `hideLeaves` option as the tree view, including the same staff-are-never-hidden carve-out (ADR-005) — Sections view shows everyone by default. Rows are sorted and indented by tier (tree depth). The root's own section is centered on a row above the rest, connected to each of them by a line. Rendered as a single text row per person (color dot + name/title) — deliberately no card/avatar, unlike the Tree view. `group` has zero effect on the Tree view or on validation; it's purely additive.

## Architecture Decisions

| ADR | Decision |
|-----|----------|
| [ADR-001](docs/adrs/ADR-001-tech-stack.md) | Vanilla JS + D3.js + Alpine.js, no backend, no build step |
| [ADR-002](docs/adrs/ADR-002-data-model-and-dsl.md) | Flat `nodes[]` with `parentId` (strict tree); JSON is the DSL |
| [ADR-003](docs/adrs/ADR-003-persistence-and-sharing.md) | `localStorage` + JSON/SVG/PNG/PDF export, no backend (share links removed, see ADR update) |
| [ADR-004](docs/adrs/ADR-004-co-occupancy-and-staff-placement.md) | Co-leadership (`coOccupants`) and staff placement (`placement`) as attributes on the strict tree, not new edge types |
| [ADR-005](docs/adrs/ADR-005-editor-guardrails-and-view-controls.md) | Delete only when childless; "Hide leaves"/"Manage" as view-only state, not data; saved charts deletable via the Files modal |
| [ADR-006](docs/adrs/ADR-006-sections-view.md) | Sections view: department/group abstraction, driven by a new optional `group` field, tier-indented, shares "Hide leaves" with the tree view |

## What It Does NOT Do

- No backend, no database — everything is client-side, in the browser that has the tab open.
- No multi-user collaboration or real-time sync between viewers.
- No authentication or access control — anyone with the exported file can view and edit.
- No cross-functional/dotted-line relations beyond `coOccupants` (joint position) and `placement: "staff"` (ADR-004) — this is not a general graph model.
- Staff-placement nodes cannot have their own children in v1 (ADR-004) — lifting this is a known, deliberately deferred limitation.

## Known Limitations & Possible Future Work

Noted here rather than in an ADR since neither of these is a decision that's been made — just known behaviors and candidate features, kept visible for whoever picks this codebase up next. Not scheduled; no code changes exist yet for either of them.

**Zoom/pan resets on every re-render (Tree and Sections views alike).** `ChartRenderer.render()` and `.renderSections()` (`js/chart-renderer.js`) both do `this.container.innerHTML = ''` and rebuild the `<svg>` from scratch on every call, including a brand-new `d3.zoom()` behavior via `setupZoom()` — so any pan/zoom the viewer had applied is lost back to the identity transform on the *next* render, regardless of what triggered it (toggling "Hide leaves", editing a field, switching Tree/Sections, changing language, anything that calls `renderChart()`). Toggling "Hide leaves" twice back to its original state is one way to notice it, but it isn't specific to that switch — it's a side effect of the wipe-and-rebuild rendering strategy, not a deliberate decision; nothing in the ADRs discusses preserving zoom state, it was simply never addressed.
  - *Feasibility*: straightforward mechanically — have the renderer capture the current transform (`d3.zoomTransform(this.svgElement)`) before wiping, then after rebuilding, reapply it to both the new `zoomGroup` and the new `d3.zoom()` behavior (`svg.call(zoom.transform, savedTransform)`, so d3's internal zoom state and the visible transform agree). The real question is policy, not mechanics: which re-renders should *preserve* the previous transform (a hideLeaves toggle, a field edit — arguably yes) versus *reset* it (loading a different saved chart, switching Tree ↔ Sections, since the content is a different shape) — that split needs a decision before implementing, not just the capture/reapply plumbing.

**Drag-and-drop reparenting on the Tree canvas.** Today reparenting is dropdown-only, via the visual editor sidebar's "Reports to" field (`reparentNode()` in `js/editor-actions.js`), which already guards against cycles (`isSelfOrDescendant()`) and already knows how to compute the valid-target list excluding staff nodes and the dragged node's own descendants (`getEligibleParents()`) — the *data*-layer work for this feature already exists and is reusable as-is.
  - *Feasibility*: moderate-to-substantial, not a small addition. The missing piece is entirely the drag *gesture* on the SVG canvas: `d3.drag()` on each node's `<g>` (co-occupant clusters would need to drag as one unit, matching how they're already grouped for rendering), hit-testing to find/highlight a drop target as the cursor moves, and committing via the existing `reparentNode()` only on drop — drag-in-progress feedback has to bypass Alpine's normal data-binding re-render (per the zoom-reset finding above, mutating `data` on every `mousemove` would wipe/rebuild the whole SVG each frame) and instead directly transform the dragged element via D3, outside the reactive cycle, until drop. Specific complications worth flagging: staff nodes render via a separate non-tree code path in `layout-engine.js` and can't accept drops (already enforced by `getEligibleParents()`); dropping onto a node whose subtree is currently collapsed or hidden-by-"Hide leaves" needs a UX answer (auto-expand on hover-during-drag is the common pattern, not free); distinguishing a click (toggle-collapse) from a drag-and-release (reparent) needs `d3.drag()`'s click-distance threshold tuned; and `d3.drag()` needs to coexist with the canvas's existing `d3.zoom()` without the two gestures fighting (a solved problem in D3, but requires care). No new dependency needed — `d3.drag()` ships with the D3 build already in use (ADR-001).
