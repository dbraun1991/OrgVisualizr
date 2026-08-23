# ADR-006: Sections View

## Status
Accepted — 2026-08-23

## Context

The tree view (the only view until now) renders every individual as a card, connected by reporting lines — appropriate for looking at *who reports to whom*, but not for a different, coarser question: *what teams/sections exist, and who leads them?* Answering that from the tree means visually filtering out every individual contributor and every connector line yourself.

The request was specific about the shape of a second, more abstract view:

- Organize by **section** (department) and, within a section, by **group** (a named sub-team, e.g. "Development" within "Technology").
- Groups render **only leads** — people with direct reports — ignoring leaves entirely.
- **Tier** (how senior a lead is) matters within a group's list of leads.
- The **section name is given only once**, at the top of its box — never repeated per group.
- The sample data needed enriching first: only Technology had enough depth (multiple managers, multiple tiers) to meaningfully demonstrate groups — Finance, Marketing, and Executive were each one manager deep.

Clarified up front (AskUserQuestion) before implementing:
- `group` is a flat string field per node, mirroring how `department` already works — not a separate structured groups list.
- "Lead" reuses the exact "has at least one direct report" rule `hideLeaves` (ADR-005) already uses — no new flag.
- Tier is conveyed by sort order **and** indentation, not just order alone or an explicit "Tier N" label.
- The view is reached via a header toggle button, like the existing Edit/Theme toggles, swapping the whole canvas — not a second pair of tabs alongside the editor's Visual/JSON tabs.

## Decision

**New optional `group` field on nodes**, alongside the existing `department` (`js/data-model.js` needs no new validation — unknown fields already pass through `{...n}` in `validateAndNormalize`, exactly like `department`/`color` today). It's scoped *within* department (two departments can each have a group called the same thing without colliding), and it's purely a Sections-view concern — it has no effect on the tree view at all. A lead with no `group` renders directly under its section instead of inside a group box, which keeps the field fully backward-compatible: a chart with zero `group` fields still renders sensibly in Sections view (every lead, flat, per department).

**`js/sections-layout.js` (new)** computes box positions. Unlike `layout-engine.js` this needs no `d3.stratify()`/`d3.tree()` pass — it's plain box-packing (stack lead rows → group box → section box → row of section boxes, wrapped by width), since a section/group is a flat list, not a positioned hierarchy. It reuses the same leaf-detection logic as `layout-engine.js`'s `hideLeaves` option (a node is a leaf if nothing reports to it) to decide who's a lead, then buckets leads by `(department, group)`, sorts each bucket by tree depth, and indents each row proportionally to depth-within-that-bucket — this is how "tier" is conveyed, per the clarified requirement.

**`js/sections-renderer.js` (new)** draws the computed layout: a section `<rect>` + one title (drawn once, per the "section name only at top level" requirement), a dashed `<rect>` + label per group, and — deliberately — **a single text row per lead**, not a card: a small colored dot (the node's own `color`) plus name/title as two `<tspan>`s in one `<text>`. No avatar, no initials circle, no card background. This is the "abstract even more from persons" part of the request: the tree view's cards stay maximally detailed per person; this view intentionally reduces a lead to the least amount of visual weight that still identifies them.

**`ChartRenderer.renderSections(layout)`** (in `chart-renderer.js`) owns the container/`svgElement`/zoom wiring and delegates the actual SVG construction to `sections-renderer.js`'s exported `renderSectionsSvg()`. Keeping a single `ChartRenderer` instance as the one owner of `this.svgElement` — rather than a second renderer class/instance — means `file-manager.js`'s export functions (`_getSvgDataUrl`, `exportPDF`) keep working completely unmodified regardless of which view is currently on screen; they only ever read `window.app.renderer.svgElement`.

**`js/app.js`**: a new `viewMode` Alpine field (`'tree'` default, or `'sections'`), a `toggleView()` action, and a `$watch('viewMode', ...)` that re-renders — mirroring the existing `hideLeaves` watcher exactly. `renderChart()` branches on `viewMode` to call either the existing `layoutEngine`/`renderer.render()` path or the new `sectionsLayout`/`renderer.renderSections()` path.

**`index.html`**: a new header toggle button next to the existing Edit toggle, showing the *current* view's name ("Tree" / "Sections") — same convention the theme toggle already uses (its label shows "Dark"/"Light" for the current theme, not the target). The "Hide leaves" switch is hidden (`x-show="viewMode !== 'sections'"`) while Sections view is active, since it would be a silent no-op there — Sections always excludes leaves by definition, regardless of that switch.

**`file-manager.js`**'s `_prepareExportSvg()` gained a matching color-baking block for the new classes (`.section-rect`, `.section-title`, `.group-rect`, `.group-title`, `.lead-name`, `.lead-title`), for the same reason the tree view's classes needed one: a standalone exported SVG/PNG/PDF has no access to `css/orgvisualizr.css`'s CSS custom properties, so without this the boxes/text would render invisible or black-on-black exactly like the bug fixed for the tree view earlier.

**`data/example.json` enrichment**: Technology got the requested Development/Support/Administration groups — Development specifically got a new second-tier lead ("Sara Klein — Team Lead", added under the existing "Alex Kim — Engineering Manager", with two of Alex's engineers reparented to report to her instead) so that group actually demonstrates two-tier indentation rather than a single flat entry. Finance and Marketing each got a second group (Payroll / Campaigns) alongside their existing one (Accounting / Content), each via one new lead node with one new leaf report (leads need at least one report to qualify). Executive intentionally has **zero** groups — Jane Doe (CEO) renders directly under the "Executive" section — demonstrating the fully-ungrouped case. Priya Nair (Product Manager, Technology) was deliberately left without a `group`, demonstrating a section that mixes grouped and ungrouped leads side by side. `docs/dsl.md` documents the new field and these rules in a new "Sections View" section.

## Consequences

- **`coOccupants` are not shown in Sections view** — only a lead's primary occupant appears. Co-leadership is inherently a tree-view/individual-focused concept (two specific people jointly holding one position); there's no obvious way to represent it in an already-abstracted single-row lead list without adding visual weight back in, which would work against the point of this view. If demand for it appears, it would need its own design pass, not a small addition to the current row rendering.
- **No click-to-collapse/expand in Sections view** — unlike the tree, every lead in the chart always renders (Sections view has no equivalent of `collapsed`). For a very large org this view could get tall; pagination or per-section collapse is a plausible future extension, not built now.
- `group` matching is an exact string comparison, same as `department` already is — `"Support"` and `"support"` would render as two different groups. Not treated as a bug (consistent with existing behavior), but worth revisiting together with `department` if hand-edited JSON makes this a real annoyance.
- A node's color still only ever comes from its own `color`/`department` fields (see `docs/dsl.md`) — `group` does not feed a default color the way `department` can. Two leads in the same group can have different accent colors, same as two nodes in the same department already can.

## Update — 2026-08-23: root-section placement, section-lead color, header button width

Three follow-ups from the first round of feedback on this view:

**The root's section is now elevated above the rest, not just alphabetically first.** `SectionsLayout.calculate()` finds the department of the tree's actual root node and always places that section on a row of its own, above every other section, regardless of the normal width-based wrap logic. Previously section order was purely alphabetical, which happened to put "Executive" first in the sample data by coincidence, but on the same row as the rest, and would have put a differently-named top-level department wherever its name happened to fall alphabetically.

**Section boxes are now filled with their own section lead's color** — the shallowest (lowest-depth) lead within that section, e.g. the CFO for Finance — rather than the neutral themed card background every section previously shared. Since that color is arbitrary per-chart data, not a theme default, `getContrastTextColor()` (the same helper `chart-renderer.js` already uses for avatar-initials/badge text) picks whichever of black/white contrasts against it, and that contrast color propagates to everything else drawn in the box: group titles/borders and lead name/title text. A lead's own color dot got a thin outline in that same contrast color too, since a lead's dot color is frequently identical to the section's own color (department color and section-lead color are typically the same field in practice) and would otherwise disappear against a same-colored box. This is why `.section-rect`/`.section-title`/`.group-rect`/`.group-title`/`.lead-name`/`.lead-title` lost their CSS `fill`/`stroke` declarations — like the tree view's own per-node accent colors, these are now set inline by `sections-layout.js`/`sections-renderer.js`, and `file-manager.js`'s export color-baking no longer touches them (baking in a theme color would overwrite the correct per-section one).

**The Tree/Sections header toggle button got a fixed width** (`.btn-view-toggle` in `css/orgvisualizr.css`) — its label switches between the four-letter "Tree" and the longer "Sections", which was reflowing every button after it in the header on each toggle.

Sample data also gained a fourth top-level department, **People and Culture** (Human Resources) — one lead (Chief People Officer) with two direct-report leaves, no `group`s at all, reporting directly to the CEO like the other C-level heads. It exercises the same "department with zero groups" case Executive already covered, but with actual reports underneath the lead rather than none, and gives the root-elevation and section-lead-color behavior above a fifth data point to render correctly against.
