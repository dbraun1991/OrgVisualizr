# agents.md — OrgVisualizr

## What This Is

A small, client-side web app for visualizing organizational charts. A chart is a single JSON document — the DSL, see `docs/dsl.md` — editable as a form (Visual editor) or as raw text (JSON editor), both synced live, then rendered as a card-based SVG tree.

## Core Idea

Everything runs in the browser. No backend, no build step, no database (ADR-001). `DataModel` validates/normalizes the chart JSON, `LayoutEngine` turns it into pixel coordinates via `d3.stratify()`/`d3.tree()`, and `ChartRenderer` draws the result as SVG. Alpine.js drives all UI state — the dual editor, modals, theme, view toggles. Persistence is `localStorage` plus JSON/SVG/PNG/PDF/Text export and an LZ-string-compressed share link (ADR-003) — no server involved at any point.

## Architecture

```
Browser
  ├── D3.js (CDN)      — SVG rendering; d3.stratify()/d3.tree() layout
  ├── Alpine.js (CDN)  — reactive UI state
  ├── i18next (CDN)    — EN/DE localization
  └── Vanilla JS modules (js/)
        └── js/app.js  — Alpine root state, i18n init, module wiring, renderChart() orchestration
              ├── js/data-model.js     — validate/normalize chart JSON
              ├── js/layout-engine.js  — normalized data -> {x,y} coordinates
              ├── js/chart-renderer.js — {x,y} -> SVG (cards, connectors, badges, tooltips, pan/zoom)
              ├── js/editor-actions.js — Visual-editor tree mutations
              ├── js/file-manager.js   — localStorage save/load/delete, export, remote import
              ├── js/text-export.js    — Markdown/text nested-list export
              ├── js/url-state.js      — URL params + LZ-string share links
              ├── js/dialog.js         — promise-based alert/confirm/prompt modals
              └── js/color-utils.js    — department palette, contrast-text, palette dropdown positioning
        ├── localStorage  — orgvisualizr_index, orgvisualizr_file_<name>, orgvisualizr_theme
        └── URL params    — ?data= (share link), ?lang=, ?editor=, ?file=

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
| `js/chart-renderer.js` | `{x,y} -> SVG` — occupant cards, elbow/staff connectors, "+N" badges, tooltips, pan/zoom |
| `js/editor-actions.js` | Visual editor mutations — add/remove nodes and co-occupants, reparent, collapse, delete guardrail (ADR-005), recolor subtree |
| `js/file-manager.js` | `localStorage` save/load/delete, JSON/SVG/PNG/PDF export, remote JSON import |
| `js/text-export.js` | Markdown/text nested-list export |
| `js/url-state.js` | URL parameter sync + LZ-string share link generation |
| `js/dialog.js` | Promise-based alert/confirm/prompt modal system (used instead of native `confirm()`/`alert()`) |
| `js/color-utils.js` | Department color palette, `getContrastTextColor()`, palette dropdown positioning |
| `js/utils.js` | Shared helpers — HTML/SVG escaping & sanitizing, filename sanitizing, blob downloads |
| `data/example.json` | Default chart loaded on first run — also the reference example exercising every DSL feature at once |
| `locales/en/`, `locales/de/` | `translation.json` — i18next strings |
| `docs/dsl.md` | Full DSL / data-model reference, with examples |
| `docs/adrs/` | Architecture Decision Records |

## Data Model / DSL

See `docs/dsl.md` for the complete reference with examples. In short: JSON *is* the DSL, no custom syntax to parse. A flat `nodes[]` array with `parentId` forms a strict single-parent tree (ADR-002); `coOccupants[]` and `placement: "staff"` (ADR-004) extend individual positions without turning that tree into a graph.

## Persistence & Sharing (ADR-003)

`localStorage` under two key patterns: `orgvisualizr_index` (array of saved chart names) and `orgvisualizr_file_<name>` (that chart's JSON). Export as JSON, SVG, PNG, PDF, or a Markdown/text nested list. Share links compress the entire chart JSON into a `?data=` URL parameter via LZ-string — opening the link reproduces the chart client-side, no server round-trip. `orgvisualizr_theme` (light/dark) is a separate, unrelated `localStorage` key.

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

## Architecture Decisions

| ADR | Decision |
|-----|----------|
| [ADR-001](docs/adrs/ADR-001-tech-stack.md) | Vanilla JS + D3.js + Alpine.js, no backend, no build step |
| [ADR-002](docs/adrs/ADR-002-data-model-and-dsl.md) | Flat `nodes[]` with `parentId` (strict tree); JSON is the DSL |
| [ADR-003](docs/adrs/ADR-003-persistence-and-sharing.md) | `localStorage` + JSON export + LZ-string share links, no backend |
| [ADR-004](docs/adrs/ADR-004-co-occupancy-and-staff-placement.md) | Co-leadership (`coOccupants`) and staff placement (`placement`) as attributes on the strict tree, not new edge types |
| [ADR-005](docs/adrs/ADR-005-editor-guardrails-and-view-controls.md) | Delete only when childless; "Hide leaves"/"Manage" as view-only state, not data; saved charts deletable via the Files modal |

## What It Does NOT Do

- No backend, no database — everything is client-side, in the browser that has the tab open.
- No multi-user collaboration or real-time sync between viewers.
- No authentication or access control — anyone with the file or a share link can view and edit.
- No cross-functional/dotted-line relations beyond `coOccupants` (joint position) and `placement: "staff"` (ADR-004) — this is not a general graph model.
- Staff-placement nodes cannot have their own children in v1 (ADR-004) — lifting this is a known, deliberately deferred limitation.
