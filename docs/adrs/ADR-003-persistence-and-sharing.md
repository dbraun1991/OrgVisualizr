# ADR-003: Persistence & Sharing

## Status
Accepted — 2026-08-23

## Context

OrgVisualizr has no backend (see ADR-001), so org chart data needs to persist and move between devices without a server. Metroviz solves this with three mechanisms that don't require one: browser `localStorage`, JSON file export/import, and a compressed-payload share link. The same problem applies here in the same way — org charts need to be saved, reopened, handed to a colleague, or embedded in a doc/wiki link.

## Decision

Reuse Metroviz's three-mechanism approach directly, ported to the org-chart data shape:

- **`localStorage`**: an index of saved chart names (`orgvisualizr_index`) plus one entry per chart (`orgvisualizr_file_<name>`). Per-browser, per-device only — not synced.
- **JSON / SVG / PNG / PDF export**: `file-manager.js` ports Metroviz's `exportJSON`/`exportSVG`/`exportPNG`/`exportPDF` implementations near-verbatim, including the same security guardrails (SVG sanitized via DOMPurify before download, PNG rendered at 4x scale via canvas, PDF via jsPDF + svg2pdf.js).
- **Share link**: the current JSON is LZ-string-compressed into a `?data=` URL query parameter, copied to the clipboard. Opening the link reproduces the exact chart client-side, no server round-trip.
- **Remote JSON import**: loading a chart from an arbitrary HTTPS/HTTP URL, with the same guardrails as Metroviz (protocol allowlist, 10s timeout, 5MB size cap, CORS-dependent).

One deliberate simplification versus Metroviz: there is no separate `zstate` bitmask URL parameter for collapse state, because each node's `collapsed` flag is already part of the JSON payload itself (see ADR-002) and therefore already round-trips through every one of these mechanisms without extra encoding.

Markdown export (present in Metroviz, one-way JSON → Markdown) was **not** ported — it's out of scope for v1 per the initial plan, since it isn't part of the core "visualize + dual-mode edit" ask. It could be added later as a nested-bullet-list export of the reporting hierarchy if there's demand.

## Consequences

- No account system, no server-side backup — an exported JSON file or a copied share link are the only durable backups. This mirrors Metroviz's own documented limitation and the same user guidance applies: export JSON for anything that needs to survive beyond one browser profile.
- Share links embed the full org chart (potentially real employee names/titles) directly in the URL. Since this is genuinely sensitive data for most real organizations — more so than a technology roadmap — the in-app copy explicitly calls this out (see `js.shareLinkCopied` in both locale files) and users should treat share links as sensitive by default, not just "for confidential content."
- If multi-device sync or team-shared charts become a real requirement, the natural next step is the same one Metroviz's own docs note for itself: introduce a minimal backend (e.g. filesystem or object storage, similar to bpmn-process-creator's ADR-002 approach) — nothing in this client-only design blocks that migration.

## Update — 2026-08-23: share links removed

The LZ-string compressed `?data=` share link was removed (the "Share" header button, `generateShareLink()`, the `?data=` parsing branch in `parseUrlParams()`, the `lz-string` CDN dependency, and the associated locale strings). No share link had ever actually been distributed, so there was nothing depending on the URL format continuing to work.

The underlying reasoning in this ADR is unaffected: `localStorage` is still per-browser only, and JSON export/import remains the one supported way to move a chart to another device or hand it to someone else — it was already documented above as the mechanism to reach for "for anything that needs to survive beyond one browser profile." Remote JSON import (HTTPS/HTTP URL) is untouched by this change.

If a genuine need for a shareable link resurfaces, re-adding it is a small, self-contained change (the code above is a reasonable starting point in git history) — it does not require revisiting anything else in this ADR.
