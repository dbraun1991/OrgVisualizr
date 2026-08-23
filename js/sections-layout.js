import { getContrastTextColor } from './color-utils.js';

/**
 * Computes box positions for the "Sections" view — an abstraction over the org
 * tree that groups *everyone* (subject to the same `hideLeaves` option the tree
 * view's own "Hide leaves" switch controls — see ADR-005) by department
 * ("section") and then, within a department, by group. A person's *effective*
 * group is their own `group` field, or — failing that — the nearest ancestor's
 * within the same department, so a leaf nests in the same group box as their
 * manager instead of appearing disconnected from their team. A person with no
 * effective group at all (including every ancestor up to the department
 * boundary) renders directly under their section instead of inside a group box.
 *
 * Unlike layout-engine.js this needs no d3.stratify()/d3.tree() pass — it's a
 * simple box-packing layout (stack rows -> group box -> section box -> row of
 * section boxes wrapped by width), not a positioned hierarchy. Tier is conveyed
 * by sort order plus a per-row indent proportional to org depth.
 *
 * Two more things every section carries:
 * - The section containing the tree's root node is always centered on a row of
 *   its own, above every other section, with a connector line down to each of
 *   them — it's structurally "the top" of the org, so it reads that way here
 *   too, not just alphabetically first.
 * - Each section's box color is its own section lead's color — the shallowest
 *   (lowest-depth) person found in that section — with the rest of the box's
 *   text/strokes switching to whichever of black/white contrasts against it
 *   (`getContrastTextColor`, the same helper the avatar initials/badges use),
 *   since a section's color is arbitrary per-chart data, not a themed default.
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
     * Builds one section's internal content (group boxes, rows, color) at
     * section-local coordinates — independent of where the section ends up
     * positioned, which is decided afterward in calculate().
     * @param {string} deptName - The department this section represents.
     * @param {Object} bucket - { ungrouped: Array, groups: Map<string, Array> }.
     * @param {Map<string, number>} depths - Node id -> tree depth.
     * @returns {Object} A section object, missing only x/y.
     */
    _buildSection(deptName, bucket, depths) {
        const { rowHeight, indentStep, groupPadding, groupTitleHeight, groupGapY,
            sectionPadding, sectionTitleHeight, sectionWidth } = this.config;

        const sortByDepth = (list) => list.slice().sort((a, b) => depths.get(a.id) - depths.get(b.id));

        const rows = [];
        const groupBoxes = [];
        let y = sectionTitleHeight;

        // Appends one row per node (sorted/indented by tier, relative to the
        // shallowest node in *this* list) at section-local coordinates, so the
        // renderer never has to reconcile a second, group-local coordinate space.
        const placeRows = (list, xBase) => {
            const sorted = sortByDepth(list);
            const minDepth = sorted.length ? depths.get(sorted[0].id) : 0;
            sorted.forEach((n) => {
                rows.push({ node: n, depth: depths.get(n.id), x: xBase + (depths.get(n.id) - minDepth) * indentStep, y });
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

        // The section's own color is its shallowest person's color — whoever is
        // closest to the root within this section — with everything else in the
        // box switching to whichever text color contrasts against it.
        const sectionLead = rows.reduce((min, r) => (min === null || r.depth < min.depth ? r : min), null);
        const sectionColor = (sectionLead && sectionLead.node.color) || '#4B5563';
        const sectionTextColor = getContrastTextColor(sectionColor);
        rows.forEach((r) => { r.textColor = sectionTextColor; });
        groupBoxes.forEach((g) => { g.textColor = sectionTextColor; });

        return {
            id: deptName, name: deptName, width: sectionWidth, height: sectionHeight,
            color: sectionColor, textColor: sectionTextColor,
            groupBoxes, leadRows: rows
        };
    }

    /**
     * @param {Object} data - Normalized data from DataModel (meta + nodes[]).
     * @param {Object} [options] - Layout options.
     * @param {boolean} [options.hideLeaves] - Same meaning as layout-engine.js's
     *   own option: hide anyone with no direct reports of their own. Staff
     *   positions are never hidden by it, mirroring the tree view exactly.
     * @returns {Object} { config: {...this.config, width, height}, sections: [...], connectors: [...] }
     */
    calculate(data, options = {}) {
        const hideLeaves = !!options.hideLeaves;
        const { sectionWidth, sectionGapX, sectionGapY, wrapWidth, margins } = this.config;

        const nodes = data.nodes;
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const childrenOf = new Map();
        nodes.forEach((n) => {
            if (n.parentId !== null) {
                if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, []);
                childrenOf.get(n.parentId).push(n.id);
            }
        });
        const isLeaf = (id) => !childrenOf.has(id) || childrenOf.get(id).length === 0;
        const depths = this._depths(nodes);

        // Staff positions always render, exactly like the tree view's own "Hide
        // leaves" never hides them either (ADR-005) — they're a distinct visual
        // category, not a normal report, even though they're structurally leaves.
        const people = nodes.filter((n) => n.placement === 'staff' || !hideLeaves || !isLeaf(n.id));

        const effectiveGroup = (n) => {
            let current = n;
            while (current) {
                if (current.group) return current.group;
                if (!current.parentId) return null;
                const parent = byId.get(current.parentId);
                if (!parent || parent.department !== n.department) return null;
                current = parent;
            }
            return null;
        };

        const bySection = new Map();
        people.forEach((n) => {
            const dept = n.department || 'Other';
            if (!bySection.has(dept)) bySection.set(dept, { ungrouped: [], groups: new Map() });
            const bucket = bySection.get(dept);
            const group = effectiveGroup(n);
            if (group) {
                if (!bucket.groups.has(group)) bucket.groups.set(group, []);
                bucket.groups.get(group).push(n);
            } else {
                bucket.ungrouped.push(n);
            }
        });

        const rootNode = nodes.find((n) => n.parentId === null);
        const topSectionName = rootNode ? (rootNode.department || 'Other') : null;

        const allNames = Array.from(bySection.keys()).sort();
        const restNames = allNames.filter((n) => n !== topSectionName);
        const topSection = (topSectionName && bySection.has(topSectionName))
            ? this._buildSection(topSectionName, bySection.get(topSectionName), depths)
            : null;
        const restSections = restNames.map((name) => this._buildSection(name, bySection.get(name), depths));

        // Lay out every section except the root's own in the normal left-to-right,
        // wrap-by-width flow, starting a row below where the root section will sit.
        const topRowHeight = topSection ? topSection.height + sectionGapY : 0;
        let cursorX = margins.left;
        let cursorY = margins.top + topRowHeight;
        let rowMaxHeight = 0;
        let maxRight = margins.left;

        restSections.forEach((section) => {
            if (cursorX + sectionWidth > margins.left + wrapWidth && cursorX > margins.left) {
                cursorX = margins.left;
                cursorY += rowMaxHeight + sectionGapY;
                rowMaxHeight = 0;
            }
            section.x = cursorX;
            section.y = cursorY;
            cursorX += sectionWidth + sectionGapX;
            rowMaxHeight = Math.max(rowMaxHeight, section.height);
            maxRight = Math.max(maxRight, cursorX - sectionGapX);
        });

        const restWidth = maxRight - margins.left;
        const connectors = [];

        if (topSection) {
            // Centered above the row(s) of every other section (every section
            // shares the same fixed width, so this is a plain midpoint), with a
            // connector line down to each of them.
            topSection.x = margins.left + Math.max(0, (restWidth - sectionWidth) / 2);
            topSection.y = margins.top;

            restSections.forEach((section) => {
                connectors.push({
                    x1: topSection.x + sectionWidth / 2, y1: topSection.y + topSection.height,
                    x2: section.x + sectionWidth / 2, y2: section.y
                });
            });
        }

        const sections = topSection ? [topSection, ...restSections] : restSections;

        const contentRight = Math.max(maxRight, topSection ? topSection.x + sectionWidth : margins.left);
        const contentBottom = restSections.length
            ? cursorY + rowMaxHeight
            : (topSection ? topSection.y + topSection.height : margins.top);

        const width = (sections.length ? contentRight : margins.left) + margins.right;
        const height = (sections.length ? contentBottom : margins.top) + margins.bottom;

        return { config: { ...this.config, width, height }, sections, connectors };
    }
}
