/**
 * Handles fetching, validation, and normalization of org chart data.
 *
 * The data model is intentionally minimal: a flat `nodes[]` array where each
 * node points at its parent via `parentId`. Exactly one node must have a
 * null/absent `parentId` (the root). This shape maps directly onto
 * d3.stratify(), so the layout engine needs no custom tree-building code.
 *
 * Each node represents one *position*, held by a primary occupant (the node's
 * own name/title/etc) plus an optional `coOccupants[]` array for joint
 * leadership, and carries a `placement` of "line" (default) or "staff" for
 * beside-the-parent rendering. See ADR-004.
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
            parentId: n.parentId === undefined || n.parentId === null || n.parentId === '' ? null : String(n.parentId),
            placement: n.placement === 'staff' ? 'staff' : 'line',
            coOccupants: Array.isArray(n.coOccupants) ? n.coOccupants : []
        }));

        const idSet = new Set();
        nodes.forEach((n) => {
            if (idSet.has(n.id)) {
                throw new Error(`Invalid data format: duplicate node id "${n.id}"`);
            }
            idSet.add(n.id);

            n.coOccupants.forEach((co, i) => {
                if (!co || typeof co !== 'object' || !co.name) {
                    throw new Error(`Invalid data format: node "${n.id}" has a coOccupants entry at index ${i} without a name`);
                }
                if ('id' in co || 'parentId' in co) {
                    throw new Error(`Invalid data format: node "${n.id}" coOccupants entry "${co.name}" may not have its own id/parentId — co-occupants are not independent tree nodes (see ADR-004)`);
                }
            });
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
        this._assertStaffHasNoChildren(nodes);

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

    /**
     * A "staff" placement node is laid out beside its parent, entirely outside the
     * main tree pass (see ADR-004) — it cannot itself have children in v1.
     *
     * @param {Array} nodes - Normalized flat node list.
     */
    _assertStaffHasNoChildren(nodes) {
        const staffIds = new Set(nodes.filter((n) => n.placement === 'staff').map((n) => n.id));
        if (staffIds.size === 0) return;
        nodes.forEach((n) => {
            if (n.parentId !== null && staffIds.has(n.parentId)) {
                throw new Error(`Invalid data format: node "${n.id}" reports to "${n.parentId}", which is a staff-placement node — staff positions cannot have their own reports in v1 (see ADR-004)`);
            }
        });
    }
}
