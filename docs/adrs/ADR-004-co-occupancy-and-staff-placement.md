# ADR-004: Co-Occupancy and Staff Placement

## Status
Accepted — 2026-08-23

## Context

ADR-002 committed to a strict tree: exactly one `parentId` per node, no secondary relations, explicitly deferring "cross-functional/dotted-line relations" until there was a concrete need. Real usage surfaced two concrete needs that don't fit a plain strict tree:

1. **Co-leadership**: a single position (e.g. "Team Lead") sometimes has more than one person holding it jointly (a lead + co-lead, job-sharing, etc.). The team below reports to *the position*, not to one specific individual.
2. **Staff placement**: a role like an executive assistant is a genuine subordinate (one manager, no ambiguity), but the standard org-chart convention draws it *beside* its manager with a dashed connector, not stacked below in the normal reporting row — visually distinguishing "staff/support" authority from "line" authority.

Both could be modeled as generalized graph relations (multiple parents, arbitrary edge types), but that would undo ADR-002's core simplicity — every consumer of the data (layout, rendering, JSON hand-editing, validation) would need to reason about a DAG instead of a tree. Neither actual need requires that: co-leadership never needs the team to have two *different* reporting lines (it's one shared position, one edge into it, one edge out of it toward each report); staff placement never needs a second parent at all, only a different *visual placement* of an otherwise perfectly normal single-parent edge.

## Decision

**The tree stays a strict single-parent tree.** Both features are modeled as attributes on top of the existing single-node/single-`parentId` shape, not as new edge types.

### 1. Co-occupancy — additive, non-breaking

A node keeps its existing `name`/`title`/`description`/`color` fields exactly as today — these represent the **primary occupant**, and the primary occupant *is* "the direct line": the single structural position that `parentId` edges connect above and below. An optional `coOccupants` array adds anyone else jointly holding that same position:

```json
{
  "id": "cto", "parentId": "ceo",
  "name": "John Roe", "title": "CTO", "department": "Technology", "color": "#00A0E2",
  "coOccupants": [
    { "name": "Jane Kim", "title": "Co-CTO", "color": "#00A0E2", "description": "Joined 2026 to co-lead platform strategy." }
  ]
}
```

Each `coOccupants` entry has its own `name` (required), `title`, `color`, and `description` — the same descriptive fields a primary occupant has — but **no `id` and no `parentId` of its own**. A co-occupant is not an independent node in the hierarchy; it cannot have its own subordinates, cannot be reparented, and does not exist outside the position it's attached to. This was the deciding factor for choosing this shape over the alternative considered (reframing every node as `occupants: [...]`, primary flagged explicitly): that alternative is more "structurally pure" but requires migrating every existing chart's data, for a benefit (uniform primary/co-occupant representation) that only matters in the minority multi-occupant case. Keeping today's flat fields as the primary occupant means every existing chart, including `data/example.json`, needed zero migration.

Omitting `coOccupants` (or leaving it `[]`) is fully equivalent to today's behavior — this is additive, not a breaking change to ADR-002's schema.

### 2. Staff placement — an additive `placement` field, with a stated v1 limitation

A new optional field, `placement`, defaults to `"line"` (today's behavior — rendered in the normal child row below its parent). Setting it to `"staff"` renders the node beside its parent instead, connected with a distinct dashed connector, and excludes it from the normal sibling-width calculation so it doesn't push the rest of the chart wider:

```json
{ "id": "assistant", "parentId": "ceo", "name": "...", "title": "Executive Assistant", "placement": "staff" }
```

**v1 limitation, deliberately scoped**: a `"staff"` node may not itself have children (no node may reference it as `parentId`). Staff positions are computed entirely outside the main `d3.stratify()`/`d3.tree()` pass and positioned manually beside their parent afterward — this sidesteps a meaningfully harder problem (laying out a staff node's *own* subtree beside, rather than below, the main tree) that the actual motivating cases (assistants, single-person support roles) don't need. `data-model.js` rejects a chart where a staff node has children, with a clear error message, rather than silently mispositioning it. Lifting this limitation — giving a staff node its own descendant subtree — is future work if a real need for it shows up.

A `"staff"` node may still have `coOccupants` (the two features are orthogonal — e.g. two co-assistants).

## Consequences

- `data-model.js` gains validation for `coOccupants` shape (each entry needs `name`; no `id`/`parentId` allowed on entries) and for `placement` (`"line"` \| `"staff"` \| absent; a `"staff"` node must have no children).
- `layout-engine.js` needs variable per-node width in the `d3.tree()` pass (a position's on-screen width now depends on its occupant count), implemented via `d3.tree().separation()` rather than a fixed `nodeSize` — a documented, standard D3 pattern for variable-width tree nodes, not a fork of the layout algorithm. Staff nodes are filtered out of the `d3.stratify()` input entirely and positioned in a small post-process step, the same way collapsed-subtree badge counts already are.
- `chart-renderer.js` draws a position as a cluster of 1..N cards instead of always exactly one, and draws staff connectors with a distinct (dashed) style.
- The visual editor gains a "+ co-lead" action per node (parallel to today's "+ direct report") and a Line/Staff placement toggle.
- Existing charts (including `data/example.json` prior to this change) continue to work completely unchanged — no migration step, no version field needed in the JSON.
- If a genuine need for staff-with-subordinates emerges, this ADR should be revisited rather than the limitation silently lifted.

## Update — 2026-08-23: staff placement geometry

The first implementation placed a staff card slightly *below* its parent's vertical center (a diagonal offset, meant to visually read as "attached to, subordinate to"). This was wrong: the offset dipped far enough down that the staff card — and the dashed connector running into it — sat in the same horizontal band as the gap between the parent row and the child row below, where that parent's own child-fanout connector runs. For a staffed manager who also has direct reports, the staff card visually crossed its own reporting line.

A second, structural gap: the staff card's horizontal position was computed independently of the main `d3.tree()` pass, so no space was reserved for it in the tree's own sibling spacing. A wide enough staff card (or two staff cards on the same manager) could overlap a neighboring node — a sibling, or an unrelated node one or more levels down that simply happened to land nearby, at any depth, not just next to the staffed node itself.

**Fix:**

- **Vertical**: a staff card now sits at *exactly* its parent's row (same `y`, not offset), so it never enters the gap band where the parent's own child-fanout connector lives. The connector between them is a straight horizontal line, not a diagonal.
- **Horizontal**: the amount of space a node's staff card(s) need (`staffGapX` + each staff cluster's width + gaps between them, if there's more than one) is now reserved directly inside `d3.tree()`'s `separation()` accessor in `layout-engine.js`, the same mechanism already used to keep co-occupant clusters (see above) from overlapping. This makes the reservation part of the actual tree layout instead of a disconnected post-process guess, so it's automatically correct at any depth and against any neighbor — not just immediate siblings.
- **Multiple staff on one manager**: now explicitly supported — they stack left-to-right beside the parent, each with its own connector back to the parent, using the same reserved-width mechanism.

This required grouping staff nodes by `parentId` before the `d3.tree()` call (so `separation()` can look up how much width a node's staff row needs) rather than after, which is why the staff-positioning step in `layout-engine.js` moved from a flat `.map()` over all staff nodes to a per-parent stacking loop.

## Update — 2026-08-24: staff overhang could inflate the computed canvas width

A related bug, in the same area of `layout-engine.js` but a step later than the geometry above: `calculate()`'s final `width` folds a staff card's right edge into the tree's own `maxX` to make sure an overhanging staff card is still inside the returned canvas bounds — but it compared the staff card's already-shifted (final-space) position directly against `maxX`, which was still in d3.tree()'s original pre-shift space. When a staff card's shifted right edge exceeded that pre-shift `maxX`, the resulting `width` came out inflated by the shift amount — real dead space on the right of the rendered/exported canvas, not merely a rounding difference. See [ADR-005](ADR-005-editor-guardrails-and-view-controls.md)'s 2026-08-24 update for the fix and how it was found (verifying the pan/zoom re-centering feature's assumption that `layout.config.width`/`height` tightly bound the tree's real edges).
