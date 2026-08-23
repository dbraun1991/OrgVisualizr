/**
 * Handles fetching, validation, and normalization of org chart data.
 *
 * The data model is intentionally minimal: a flat `nodes[]` array where each
 * node points at its parent via `parentId`. Exactly one node must have a
 * null/absent `parentId` (the root). This shape maps directly onto
 * d3.stratify(), so the layout engine needs no custom tree-building code.
 */
export class DataModel {
    constructor() {}

    async loadFromUrl(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return this.validateAndNormalize(data);
    }

    /**
     * Validates raw JSON data and normalizes it into a shape safe for layout.
     *
     * @param {Object} data - The raw JSON configuration for the org chart.
     * @returns {Object} A normalized data object with a single verified root and clean node list.
     */
    validateAndNormalize(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('Invalid data format: root must be an object');
        }
        if (!Array.isArray(data.nodes)) {
            throw new Error('Invalid data format: nodes must be an array');
        }
        if (data.nodes.length === 0) {
            throw new Error('Invalid data format: nodes must contain at least one entry');
        }

        const nodes = data.nodes.map((n) => ({
            ...n,
            id: String(n.id),
            parentId: n.parentId === undefined || n.parentId === null || n.parentId === '' ? null : String(n.parentId)
        }));

        const idSet = new Set();
        nodes.forEach((n) => {
            if (idSet.has(n.id)) {
                throw new Error(`Invalid data format: duplicate node id "${n.id}"`);
            }
            idSet.add(n.id);
        });

        const roots = nodes.filter((n) => n.parentId === null);
        if (roots.length === 0) {
            throw new Error('Invalid data format: no root node found (exactly one node must have parentId = null)');
        }
        if (roots.length > 1) {
            throw new Error(`Invalid data format: multiple root nodes found (${roots.map((r) => r.id).join(', ')}) — only one node may have parentId = null`);
        }

        nodes.forEach((n) => {
            if (n.parentId !== null && !idSet.has(n.parentId)) {
                throw new Error(`Invalid data format: node "${n.id}" references unknown parentId "${n.parentId}"`);
            }
        });

        this._assertNoCycles(nodes);

        return {
            meta: data.meta || {},
            nodes
        };
    }

    /**
     * Walks parentId chains to detect cycles that would otherwise make
     * d3.stratify() throw an opaque error deep inside the layout engine.
     *
     * @param {Array} nodes - Normalized flat node list.
     */
    _assertNoCycles(nodes) {
        const byId = new Map(nodes.map((n) => [n.id, n]));
        nodes.forEach((n) => {
            const seen = new Set();
            let current = n;
            while (current.parentId !== null) {
                if (seen.has(current.id)) {
                    throw new Error(`Invalid data format: cycle detected involving node "${n.id}"`);
                }
                seen.add(current.id);
                current = byId.get(current.parentId);
                if (!current) break;
            }
        });
    }
}
