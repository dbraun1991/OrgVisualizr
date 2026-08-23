/**
 * Computes box positions for the "Sections" view — an abstraction over the org
 * tree that groups *leads* (nodes with at least one direct report — the same
 * leaf/lead definition ADR-005's "Hide leaves" already uses) by department
 * ("section") and then, within a department, by the optional `group` field.
 * Leaves are omitted entirely; a lead with no `group` set renders directly
 * under its section instead of inside a group box.
 *
 * Unlike layout-engine.js this needs no d3.stratify()/d3.tree() pass — it's a
 * simple box-packing layout (stack lead rows -> group box -> section box ->
 * row of section boxes wrapped by width), not a positioned hierarchy. Tier is
 * conveyed by sort order plus a per-row indent proportional to org depth.
 */
export class SectionsLayout {
    constructor() {
        this.config = {
            rowHeight: 26,
            indentStep: 16,
            groupPadding: 10,
            groupTitleHeight: 20,
            groupGapY: 10,
            sectionPadding: 16,
            sectionTitleHeight: 30,
            sectionWidth: 260,
            sectionGapX: 32,
            sectionGapY: 32,
            wrapWidth: 1200,
            margins: { top: 40, right: 40, bottom: 40, left: 40 }
        };
    }

    /**
     * Node id -> depth from the tree root (root = 0), via parentId-chain walk.
     * @param {Array} nodes - Normalized flat node list.
     * @returns {Map<string, number>}
     */
    _depths(nodes) {
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const cache = new Map();
        const depthOf = (id) => {
            if (cache.has(id)) return cache.get(id);
            const node = byId.get(id);
            const depth = !node || node.parentId === null ? 0 : depthOf(node.parentId) + 1;
            cache.set(id, depth);
            return depth;
        };
        nodes.forEach((n) => depthOf(n.id));
        return cache;
    }

    /**
     * @param {Object} data - Normalized data from DataModel (meta + nodes[]).
     * @returns {Object} { config: {...this.config, width, height}, sections: [...] }
     */
    calculate(data) {
        const { rowHeight, indentStep, groupPadding, groupTitleHeight, groupGapY,
            sectionPadding, sectionTitleHeight, sectionWidth, sectionGapX, sectionGapY,
            wrapWidth, margins } = this.config;

        const nodes = data.nodes;
        const childrenOf = new Map();
        nodes.forEach((n) => {
            if (n.parentId !== null) {
                if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, []);
                childrenOf.get(n.parentId).push(n.id);
            }
        });
        const isLeaf = (id) => !childrenOf.has(id) || childrenOf.get(id).length === 0;
        const depths = this._depths(nodes);

        // Staff positions can't have their own reports (ADR-004) so they're always
        // leaves anyway, but excluded explicitly here for clarity of intent.
        const leads = nodes.filter((n) => n.placement !== 'staff' && !isLeaf(n.id));

        const bySection = new Map();
        leads.forEach((n) => {
            const dept = n.department || 'Other';
            if (!bySection.has(dept)) bySection.set(dept, { ungrouped: [], groups: new Map() });
            const bucket = bySection.get(dept);
            if (n.group) {
                if (!bucket.groups.has(n.group)) bucket.groups.set(n.group, []);
                bucket.groups.get(n.group).push(n);
            } else {
                bucket.ungrouped.push(n);
            }
        });

        const sortByDepth = (list) => list.slice().sort((a, b) => depths.get(a.id) - depths.get(b.id));

        const sections = [];
        let cursorX = margins.left;
        let cursorY = margins.top;
        let rowMaxHeight = 0;
        let maxRight = margins.left;

        Array.from(bySection.keys()).sort().forEach((deptName) => {
            const bucket = bySection.get(deptName);
            const leadRows = [];
            const groupBoxes = [];
            let y = sectionTitleHeight;

            // Appends one row per node (sorted/indented by tier, relative to the
            // shallowest node in *this* list) at section-local coordinates, so the
            // renderer never has to reconcile a second, group-local coordinate space.
            const placeRows = (list, xBase) => {
                const sorted = sortByDepth(list);
                const minDepth = sorted.length ? depths.get(sorted[0].id) : 0;
                sorted.forEach((n) => {
                    leadRows.push({ node: n, depth: depths.get(n.id), x: xBase + (depths.get(n.id) - minDepth) * indentStep, y });
                    y += rowHeight;
                });
            };

            placeRows(bucket.ungrouped, sectionPadding);
            if (bucket.ungrouped.length && bucket.groups.size) y += groupGapY;

            Array.from(bucket.groups.keys()).sort().forEach((groupName) => {
                const groupTop = y;
                y += groupTitleHeight + groupPadding;
                placeRows(bucket.groups.get(groupName), sectionPadding + groupPadding);
                y += groupPadding;
                groupBoxes.push({
                    name: groupName, x: sectionPadding, y: groupTop,
                    width: sectionWidth - sectionPadding * 2, height: y - groupTop
                });
                y += groupGapY;
            });
            if (bucket.groups.size) y -= groupGapY; // no trailing gap after the last group

            const sectionHeight = y + sectionPadding;

            if (cursorX + sectionWidth > margins.left + wrapWidth && cursorX > margins.left) {
                cursorX = margins.left;
                cursorY += rowMaxHeight + sectionGapY;
                rowMaxHeight = 0;
            }

            sections.push({
                id: deptName, name: deptName,
                x: cursorX, y: cursorY, width: sectionWidth, height: sectionHeight,
                groupBoxes, leadRows
            });

            cursorX += sectionWidth + sectionGapX;
            rowMaxHeight = Math.max(rowMaxHeight, sectionHeight);
            maxRight = Math.max(maxRight, cursorX - sectionGapX);
        });

        const width = maxRight + margins.right;
        const height = sections.length ? cursorY + rowMaxHeight + margins.bottom : margins.top + margins.bottom;

        return { config: { ...this.config, width, height }, sections };
    }
}
