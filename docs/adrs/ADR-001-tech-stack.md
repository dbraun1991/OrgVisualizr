# ADR-001: Tech Stack

## Status
Accepted — 2026-08-23

## Context

OrgVisualizr needed to be a small, modern webapp for visualizing organizational charts. Two internal reference projects were reviewed before starting:

- **bpmn-process-creator**: a Node/Express + filesystem-backed BPMN editor, visual-only (no text/DSL authoring). Notable for its ADR discipline, not its architecture.
- **Metroviz**: a fully serverless SPA (vanilla JS ES6 modules, D3.js, Alpine.js, zero build step) that renders a Metro-map-style roadmap from a single JSON document, editable through synced Visual/JSON tabs, with localStorage/export/share-link persistence and no backend at all.

An org chart is fundamentally simpler than either reference: it's a static tree with no login, no multi-user editing, and no need for server-side computation. Metroviz's architecture is a closer match to that shape than bpmn-process-creator's.

## Decision

**Vanilla JavaScript (ES6 modules) + D3.js + Alpine.js, no backend, no build step.** Runtime dependencies (D3, Alpine, i18next + backend/detector plugins, lz-string, DOMPurify, marked.js, jsPDF, svg2pdf.js) are loaded from CDN, mirroring Metroviz's dependency list almost exactly.

This was chosen directly because Metroviz already proves the pattern works well for this class of app: no build tooling to maintain, trivial to host (any static file server, e.g. GitHub Pages), and the whole app is readable without a compilation step. A framework (React/Vue) was not considered — the app's complexity (a tree editor, an SVG renderer, some modals) does not need componentization or a virtual DOM to stay manageable.

## Consequences

- No build step required; `python3 -m http.server` (or any static host) is sufficient for local development and deployment.
- Internet access (or a local CDN mirror) is required at page load for all CDN-hosted dependencies.
- If the app's complexity grows substantially (e.g. real-time multi-user collaboration, a backend directory sync), this decision would need to be revisited — nothing here precludes adding a backend later, since the frontend has no server dependency baked in.
- Consistent module boundaries with Metroviz (`data-model.js` / `layout-engine.js` / `*-renderer.js` / `editor-actions.js` / `file-manager.js` / `url-state.js` / `dialog.js` / `utils.js`) were kept deliberately, so a contributor familiar with Metroviz can navigate this codebase with minimal ramp-up.
