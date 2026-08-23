# ADR-002: Data Model & DSL

## Status
Accepted — 2026-08-23

## Context

The core UX goal (explicitly requested) was that an org chart can be **crafted text-based and then imported for render** — i.e. the same dual-mode editing Metroviz offers: a form-based Visual editor and a raw-text editor, both bound to the same underlying state, either one able to drive the other.

Metroviz's own "DSL" turned out, on inspection, not to be a custom grammar at all — it's the JSON data model itself, edited live in a `<textarea>` with `updateFromJson()` reparsing on every keystroke and `jsonError` surfacing parse failures inline. A separate custom text syntax (YAML-like or otherwise) was considered and rejected: it would require writing and maintaining a parser/serializer, and would only add value if it were meaningfully more concise or readable than JSON for this data shape. It isn't — a flat node list is already about as simple as text formats get.

A design choice specific to org charts (not present in Metroviz) was how to represent the hierarchy itself: a flat list with parent pointers, vs. a nested/recursive JSON structure (each node embedding a `children[]` array).

## Decision

**JSON is the DSL**, edited via synced Visual/JSON tabs exactly like Metroviz. No custom parser is written.

**The hierarchy is a flat `nodes[]` array with a `parentId` field per node** (not nested `children[]`), with exactly one node having `parentId: null` (the root):

```json
{
  "meta": { "title": "Acme Corp", "organization": "Acme Corp" },
  "nodes": [
    { "id": "ceo", "parentId": null, "name": "Jane Doe", "title": "CEO", "department": "Executive", "color": "#0064B0" },
    { "id": "cto", "parentId": "ceo", "name": "John Roe", "title": "CTO", "department": "Technology", "color": "#00A0E2" }
  ]
}
```

This shape was chosen specifically because it maps directly onto **`d3.stratify()`**, D3's own flat-list-to-hierarchy utility — the layout engine (`layout-engine.js`) needs no hand-written tree-building code, only `d3.stratify().id(...).parentId(...)` followed by `d3.tree()`. A nested structure would have required a custom recursive builder and made reparenting (moving a node to a different manager) a deeper structural edit; with a flat list it's a one-line `node.parentId = newParentId` reassignment.

`data-model.js` enforces the model's invariants on every parse: exactly one root, unique ids, all `parentId`s resolve to an existing node, and no cycles (checked explicitly, since an undetected cycle would otherwise surface as an opaque error deep inside `d3.stratify()`).

This is a **strict tree**: v1 deliberately does not support secondary/dotted-line relations (cross-functional reporting), unlike Metroviz's `dependsOn`/`synchronizedWith` station relations. If that's needed later, it would be added as an optional `secondaryParentIds: []` field per node, rendered as a distinct dashed connector — but this is out of scope until there's a concrete need for it.

## Consequences

- Hand-editing the JSON tab is straightforward: adding a person is one object with a `parentId` pointing at their manager's `id`.
- Reparenting (changing who someone reports to) is a single field change, in both the JSON tab and the Visual editor's "Reports to" dropdown.
- Deleting a node that has direct reports requires an explicit decision (see `editor-actions.js` `removeNode`): reports are reassigned to the deleted node's own parent, after user confirmation. The root node cannot be deleted at all — a tree always needs exactly one root.
- Because collapse state (`collapsed: true` per node) lives directly on the node object, it round-trips through save/export/share automatically — no separate URL-encoded state bitmask (like Metroviz's zone `zstate`) was needed.
- If cross-functional/dotted-line relations become a real requirement, this ADR should be revisited rather than silently extended.
