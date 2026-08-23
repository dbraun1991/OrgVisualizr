# OrgVisualizr

OrgVisualizr is a small, client-side web app for visualizing organizational charts in a modern, card-based style. It's built to be **crafted text-based and imported for render**: the org chart is a single JSON document that you can edit as a form (Visual editor) or as raw text (JSON editor) — both stay in sync, either one can drive the other.

There is **no backend, no build step, no database**. It runs entirely in the browser.

## Quick Start

Since the app uses ES6 modules (`type="module"`), you can't open `index.html` directly from `file://` — serve it via a local web server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Features

- **Visual + JSON dual editor** — edit via forms, or edit the raw JSON directly; changes in either one instantly re-render the chart and stay synchronized with the other.
- **Modern card-based rendering** — D3.js-rendered SVG cards (name, role, department, department-color accent, initials avatar) connected with clean orthogonal connectors, pan/zoom enabled.
- **Collapsible subtrees** — click any node with reports to collapse/expand its branch; shows a "+N" badge for hidden descendants.
- **Co-leadership** — a position can be jointly held by multiple people (co-leads, job-sharing), rendered as a card cluster.
- **Staff placement** — assistant/support roles can render beside their manager with a dashed connector instead of stacked below, matching the classic line-vs-staff org-chart convention.
- **Hide leaves** — a switch pinned at the bottom of the editor sidebar globally hides everyone with no reports of their own, replacing them with a "+N" badge on their manager, so you can see the shape of the management structure without the individual-contributor noise.
- **Set Color for All Below** — recolor a whole subtree (reports, their reports, and so on) to match a node's color in one click.
- **Guardrailed delete** — a node can only be deleted once nothing reports to it anymore, direct or indirect; deleting always asks for confirmation.
- **Manage mode** — a switch next to "Hide leaves" reveals the add/delete controls on each entry in the sidebar; off by default so browsing and editing existing fields isn't cluttered with structural-edit buttons.
- **Local save/load, with a proper manager** — named charts saved to browser `localStorage`; the header's "Files" button opens a modal listing every saved chart with load and delete actions.
- **Import** — from a local JSON file (picker or drag-and-drop) or a remote HTTPS/HTTP URL.
- **Export** — as JSON, SVG, PNG, or PDF.
- **Share links** — compress the entire chart into a URL (`?data=...`) via LZ-string; open the link anywhere to reproduce the same chart, no server involved.
- **Light and dark themes** — toggle in the header; persisted per-browser, applied before first paint (no flash).
- **Localization** — English and German, with more languages easy to add (see below).

## Data Model / DSL

The JSON *is* the DSL — there's no separate custom syntax to learn. A chart is a `meta` object plus a flat `nodes[]` list, where each node points at its manager via `parentId`. Exactly one node must have `parentId: null` (the root):

```json
{
  "meta": { "title": "Acme Corp", "organization": "Acme Corp" },
  "nodes": [
    { "id": "ceo", "parentId": null, "name": "Jane Doe", "title": "CEO", "department": "Executive", "color": "#0064B0" },
    { "id": "cto", "parentId": "ceo", "name": "John Roe", "title": "CTO", "department": "Technology", "color": "#00A0E2", "description": "Leads engineering, product, and infrastructure." },
    { "id": "eng-mgr", "parentId": "cto", "name": "Alex Kim", "title": "Engineering Manager", "department": "Technology", "collapsed": false }
  ]
}
```

Per-node fields:

| Field | Required | Description |
|---|---|---|
| `id` | yes | Unique identifier. |
| `parentId` | yes | The manager's `id`, or `null` for the single root. |
| `name` | recommended | Display name. |
| `title` | no | Role / job title. |
| `department` | no | Shown under the title; also used for the accent color if `color` is unset. |
| `color` | no | Hex color for the card's accent bar and avatar. |
| `description` | no | Markdown text, shown in the hover tooltip. |
| `collapsed` | no | If `true`, this node's subtree is hidden in the chart (shown as a "+N" badge). |
| `coOccupants` | no | Array of `{ name, title, color, description }` for anyone else jointly holding this exact position (co-leads, job-sharing). The node's own `name`/`title` stay the primary occupant. |
| `placement` | no | `"line"` (default) or `"staff"`. A `"staff"` node renders beside its parent with a dashed connector instead of below it in the normal row, and cannot itself have children. |

This flat `parentId` shape maps directly onto D3's own `d3.stratify()` utility, so the layout engine needs no custom tree-building code — see `docs/adrs/ADR-002-data-model-and-dsl.md` for the full rationale.

This is a **strict tree**: each position has exactly one incoming `parentId` edge. Co-leadership and staff placement (see `docs/adrs/ADR-004-co-occupancy-and-staff-placement.md`) are both modeled as attributes on top of that single edge, not as extra edges — so the tree itself stays simple even though a position can now be held by more than one person or drawn off to the side.

Example with both:
```json
{ "id": "eng-mgr", "parentId": "cto", "name": "Alex Kim", "title": "Engineering Manager",
  "coOccupants": [ { "name": "Noah Bergmann", "title": "Co-Engineering Manager" } ] },
{ "id": "ea", "parentId": "ceo", "name": "Lena Roth", "title": "Executive Assistant", "placement": "staff" }
```

## Export Options

- **JSON** — the raw data model, re-importable.
- **SVG** — the exact current chart view, sanitized for safe standalone use.
- **PNG** — high-resolution raster render of the current view.
- **PDF** — vector PDF sized to the chart's dimensions.
- **Text** — a nested Markdown bullet list of the whole hierarchy (name, role, department, staff notes, descriptions), for pasting into docs or reading without the app.

## Contributing: How to Add a New Language

1. Duplicate `locales/en/` to `locales/<code>/` (e.g. `locales/fr/`) and translate the values in `translation.json` — leave the keys unchanged.
2. Add an `<option>` for the new language code in the language `<select>` in `index.html`.
3. Run the app locally and switch to the new language to verify it loads.

## Architecture Decisions

| ADR | Decision |
|-----|----------|
| [ADR-001](docs/adrs/ADR-001-tech-stack.md) | Vanilla JS + D3.js + Alpine.js, no backend, no build step |
| [ADR-002](docs/adrs/ADR-002-data-model-and-dsl.md) | Flat `nodes[]` with `parentId` (strict tree); JSON is the DSL |
| [ADR-003](docs/adrs/ADR-003-persistence-and-sharing.md) | `localStorage` + JSON export + LZ-string share links, no backend |
| [ADR-004](docs/adrs/ADR-004-co-occupancy-and-staff-placement.md) | Co-leadership (`coOccupants`) and staff placement (`placement`) as attributes on the strict tree, not new edge types |
| [ADR-005](docs/adrs/ADR-005-editor-guardrails-and-view-controls.md) | Delete only when childless; "Hide leaves" as view-only state, not data; saved charts deletable via the Files modal; add/delete entry controls gated behind a "Manage" switch |

## License

MIT — see [LICENSE](LICENSE).
