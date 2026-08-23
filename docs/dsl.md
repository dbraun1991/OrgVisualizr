# OrgVisualizr DSL

## High Level

OrgVisualizr's "DSL" is not a custom text syntax — **it's JSON**. There is no parser to learn, no grammar, no special file extension. A chart is one JSON document: a `meta` object plus a flat `nodes[]` array, where each node points at its manager via `parentId`.

This is a deliberate choice, not a shortcut (see [ADR-002](adrs/ADR-002-data-model-and-dsl.md)). The app's Visual editor and JSON editor are two views onto the exact same underlying object — editing a name field in a form and typing directly into the JSON textarea both mutate the same in-memory state, and each re-serializes into the other live. So "the DSL" really means: **you can always drop into raw JSON and hand-edit the chart**, and the app will parse, validate, and render whatever you type the moment you stop typing (surfacing a clear error message if it's invalid, rather than silently ignoring the edit).

The flat `nodes[]` + `parentId` shape was chosen specifically because it maps directly onto D3's own [`d3.stratify()`](https://d3js.org/d3-hierarchy/stratify) utility — the layout engine needs no hand-written tree-building code at all.

## Document Shape

```json
{
  "meta": { "title": "...", "organization": "..." },
  "nodes": [ /* flat array, one entry per position */ ]
}
```

### `meta`

| Field | Required | Description |
|---|---|---|
| `title` | no | Shown as the chart's title (also used as the default filename base for exports). |
| `organization` | no | Free-text organization name. |

### `nodes[]` — one entry per position

Each node represents one *position* in the org chart, held by a primary occupant (its own `name`/`title`/etc.) and optionally one or more co-occupants (see below).

| Field | Required | Description |
|---|---|---|
| `id` | yes | Unique identifier. Any string — a UUID, an employee ID, or a readable slug like `"cto"` all work equally well; it's only ever used to link `parentId` edges, never displayed. |
| `parentId` | yes | The manager's `id`, or `null` for the single root. |
| `name` | recommended | Display name of the primary occupant. |
| `title` | no | Role / job title. |
| `department` | no | Shown under the title; also feeds the accent color if `color` is unset. Doubles as the "section" a node belongs to in the Sections view — see [Sections View](#sections-view-group) below. |
| `color` | no | Hex color (e.g. `"#0064B0"`) for the card's accent bar and avatar circle. |
| `description` | no | Markdown text, rendered in the hover tooltip. |
| `collapsed` | no | If `true`, this node's subtree is hidden in the chart and replaced with a "+N" badge on this node. **This is persisted data**, not a view toggle — see [Collapse vs. Hide Leaves](#collapse-vs-hide-leaves) below. |
| `coOccupants` | no | Array of `{ name, title, color, description }` — see [Co-Occupancy](#co-occupancy-coOccupants). |
| `placement` | no | `"line"` (default) or `"staff"` — see [Staff Placement](#staff-placement-placement). |
| `group` | no | Free-text sub-team name, scoped within `department` (e.g. `"Development"` within `"Technology"`). Only used by the Sections view — see [Sections View](#sections-view-group) below; has no effect on the org chart itself. |

## The Tree: `id` + `parentId`

The tree is **strict**: every node has exactly one `parentId` edge (or `null` for the root). `DataModel.validateAndNormalize()` (`js/data-model.js`) enforces this on every parse:

- `nodes` must be a non-empty array.
- Exactly one node must have `parentId: null` — that's the root. Zero roots or multiple roots is a validation error.
- Every `id` must be unique.
- Every non-null `parentId` must reference an `id` that actually exists in `nodes[]`.
- No cycles — walking `parentId` chains upward from any node must eventually reach the root, never loop back on itself.

Any violation throws a clear, specific error message (which node, which id) that surfaces directly in the JSON tab rather than silently failing or crashing the renderer.

## Co-Occupancy: `coOccupants[]`

A position can be jointly held by more than one person — co-leads, job-sharing, and similar arrangements. The node's own `name`/`title`/`color`/`description` fields stay the **primary occupant** ("the direct line" — the single edge the tree structure actually connects). `coOccupants[]` lists anyone else holding that same position:

```json
{
  "id": "eng-mgr", "parentId": "cto",
  "name": "Alex Kim", "title": "Engineering Manager", "color": "#00A0E2",
  "coOccupants": [
    { "name": "Noah Bergmann", "title": "Co-Engineering Manager", "color": "#00A0E2",
      "description": "Job-shares engineering leadership with Alex Kim." }
  ]
}
```

Renders as a side-by-side card cluster with one shared connector up (to `cto`) and one shared connector down (to `eng-mgr`'s reports).

Each `coOccupants` entry supports the same descriptive fields as a primary occupant (`name` required, `title`/`color`/`description` optional) but **may not have its own `id` or `parentId`** — a co-occupant is not an independent tree node; it cannot have subordinates or be reparented on its own. See [ADR-004](adrs/ADR-004-co-occupancy-and-staff-placement.md) for the full rationale, including why this additive shape was chosen over restructuring every node into an `occupants[]` array.

## Staff Placement: `placement`

A node with `"placement": "staff"` renders **beside** its parent with a dashed connector, instead of stacked below it in the normal reporting row — the classic org-chart convention for support/staff roles (an executive assistant, for example) as distinct from line authority:

```json
{ "id": "ea", "parentId": "ceo", "name": "Lena Roth", "title": "Executive Assistant", "placement": "staff" }
```

`placement` defaults to `"line"` if omitted (today's normal below-the-parent behavior).

**v1 constraint**: a `"staff"` node cannot itself have children — no other node may reference it as `parentId`. `DataModel` rejects this with a specific error if violated. This is a deliberate scope decision, not an oversight: staff nodes are computed entirely outside the main tree-layout pass and positioned beside their parent afterward, which only works cleanly because they're leaves. See [ADR-004](adrs/ADR-004-co-occupancy-and-staff-placement.md) for what it would take to lift this.

A staff node can still have `coOccupants` — the two features are orthogonal (e.g. two people co-holding one assistant role).

## Sections View: `group`

The header's Tree/Sections toggle switches the whole canvas to a second, more abstract view: instead of the org chart, it shows one box per `department` ("section"), and within it, one sub-box per distinct effective `group` found among that department's people (see below). "Hide leaves" applies here exactly as it does in the tree view — on by default it shows everyone; toggling it hides anyone with no direct reports of their own, staff positions excepted, same as ADR-005 already defines for the tree.

```json
{ "id": "eng-mgr", "parentId": "cto", "name": "Alex Kim", "title": "Engineering Manager", "department": "Technology", "group": "Development" }
```

Rules:

- `group` is scoped *within* `department` — two different departments can each have a group named the same thing (e.g. two "Operations" groups) without colliding; they render as separate boxes in their respective sections.
- A person's **effective group** is their own `group`, or — failing that — the nearest ancestor's within the same department. This is what puts a leaf in the same group box as their manager (e.g. an engineer under a `group: "Development"` manager) instead of scattering them ungrouped at the section level just because they don't carry the field themselves.
- Someone with no effective group at all — including every ancestor up to the department boundary — renders directly under their section instead of inside a group box. So a chart with no `group` fields at all still renders sensibly in Sections view (everyone flat, under their department); this keeps `group` fully backward-compatible with existing charts.
- People within a group (or ungrouped, directly under a section) are sorted by their tier — depth in the org tree — and indented accordingly, so relative seniority is visible at a glance even though the view otherwise omits the tree's connector lines.
- The section name is drawn exactly once, at the top of the section box — never repeated per group.
- The section containing the tree's root node is centered on a row of its own, above every other section, with a connector line down to each of them.
- `coOccupants` are not shown in Sections view; only the primary occupant of a position appears.

See [`data/example.json`](../data/example.json) for a worked example covering all three cases (a department with multiple groups, a department with a mix of grouped and ungrouped people, and a department with no groups at all).

## Collapse vs. Hide Leaves

Two different things can make a subtree disappear from the chart, and only one of them is part of the DSL:

- **`collapsed: true`** on a node is **persisted data** — part of the JSON, explicitly authored, saved/exported along with everything else. It hides that specific node's descendants and shows a "+N" badge.
- **"Hide leaves"** (the sidebar switch) is **pure view state** — a boolean that lives only in the running app's UI state (`js/app.js`), never written into `data.nodes`, never appears in exported JSON. It globally hides every node with no reports of its own, crediting the count to that node's manager, reusing the exact same "+N" badge mechanism. Two people looking at the same exported chart JSON will always see the same `collapsed` state, but may have "Hide leaves" on or off independently — it's a personal viewing preference, not a property of the org chart itself.

See [ADR-005](adrs/ADR-005-editor-guardrails-and-view-controls.md) for the full reasoning.

## Validation Rules — Quick Reference

Everything `DataModel.validateAndNormalize()` checks, in the order it checks it:

1. Root must be a JSON object (not an array, not a primitive).
2. `nodes` must be an array with at least one entry.
3. No duplicate `id` values.
4. Exactly one node with `parentId: null` (not zero, not more than one).
5. Every `parentId` must resolve to an existing node's `id`.
6. No cycles in the `parentId` chain.
7. No node whose `parentId` points at a `"staff"`-placement node.
8. Every `coOccupants` entry must have a `name`, and must not have its own `id` or `parentId`.

## Examples

### Minimal chart (single node)

```json
{
  "meta": { "title": "Solo Founder" },
  "nodes": [
    { "id": "founder", "parentId": null, "name": "Jane Doe", "title": "Founder" }
  ]
}
```

### Simple hierarchy

```json
{
  "meta": { "title": "Small Team" },
  "nodes": [
    { "id": "ceo", "parentId": null, "name": "Jane Doe", "title": "CEO", "color": "#0064B0" },
    { "id": "cto", "parentId": "ceo", "name": "John Roe", "title": "CTO", "color": "#00A0E2" },
    { "id": "dev1", "parentId": "cto", "name": "Chris Wu", "title": "Engineer", "color": "#00A0E2" }
  ]
}
```

### Co-leadership

```json
{
  "id": "eng-mgr", "parentId": "cto",
  "name": "Alex Kim", "title": "Engineering Manager",
  "coOccupants": [ { "name": "Noah Bergmann", "title": "Co-Engineering Manager" } ]
}
```

### Staff placement

```json
{ "id": "ea", "parentId": "ceo", "name": "Lena Roth", "title": "Executive Assistant", "placement": "staff" }
```

### Collapsed subtree

```json
{ "id": "it-mgr", "parentId": "cto", "name": "Tom Becker", "title": "IT Manager", "collapsed": true }
```

Renders as a normal card with a "+N" badge (N = however many descendants `it-mgr` actually has); their own JSON entries stay in `nodes[]` untouched — only the *rendering* hides them.

### Full realistic example

See [`data/example.json`](../data/example.json) — the chart the app loads by default, exercising every feature above at once: a strict hierarchy, one co-led position, one staff position, one explicitly collapsed node, (Technology) a department with multiple `group`s alongside an ungrouped lead, and (People and Culture) a department with reports but no `group`s at all.
