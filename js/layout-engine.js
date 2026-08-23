/**
 * Calculates the X and Y coordinates of org chart nodes using d3.stratify()
 * (flat parentId list -> hierarchy) and d3.tree() (hierarchy -> pixel coordinates).
 *
 * Nodes marked `collapsed: true` have their descendants pruned from the layout;
 * the pruned count is kept so the renderer can show a "+N" badge.
 *
 * Two node attributes (see ADR-004) affect layout beyond the plain tree:
 * - `coOccupants[]` widens a node's on-screen cluster, so tree spacing uses a
 *   per-pair `separation()` instead of a fixed nodeSize.
 * - `placement: "staff"` nodes are excluded from the d3.tree() pass entirely
 *   and positioned beside their parent in a separate post-process step.
 *
 * `hideLeaves` (see ADR-005) globally hides any node with no reports of its
 * own, crediting the hidden count to that node's direct manager — reusing
 * the exact same "+N" badge mechanism `collapsed` already produces.
 *
 * Staff placement geometry (see ADR-004 addendum): a staff card sits at
 * *exactly* its parent's row (same y), never dipping into the gap band below
 * the parent where that parent's own child-fanout connector runs — so a
 * staffed manager's reporting line never crosses its own staff card. The
 * horizontal space a staff card needs is reserved in `separation()` itself
 * (`_staffRightExtension`), so a staffed node never collides with whatever
 * sits to its right in the tree — a sibling, or an unrelated node one or
 * more levels down that just happens to land nearby.
 */
export class LayoutEngine {
    constructor() {
        this.config = {
            cardWidth: 200,
            cardHeight: 76,
            gapX: 32,
            gapY: 56,
            coOccupantGap: 10,
            staffGapX: 28,
            staffInternalGap: 14,
            margins: { top: 40, right: 40, bottom: 40, left: 40 }
        };
    }

    /**
     * Pixel width of a position's on-screen cluster (primary + co-occupants, side by side).
     * @param {Object} nodeData - A node's data (post-normalization).
     * @returns {number}
     */
    clusterWidth(nodeData) {
        const { cardWidth, coOccupantGap } = this.config;
        const count = 1 + (nodeData.coOccupants ? nodeData.coOccupants.length : 0);
        return count * cardWidth + (count - 1) * coOccupantGap;
    }

    /**
     * @param {Object} data - Normalized data from DataModel (meta + nodes[]).
     * @param {Object} [options] - Layout options.
     * @param {boolean} [options.hideLeaves] - If true, nodes with no reports of their
     *   own (leaves — see ADR-005) are hidden globally, and each direct manager of one
     *   or more hidden leaves gets a "+N" badge for them, reusing the same badge the
     *   per-node `collapsed` flag already produces. Staff-placement nodes are never
     *   affected — they're a distinct visual category positioned outside this pass.
     * @returns {Object} Layout containing the d3 hierarchy root, staff nodes, and config.
     */
    calculate(data, options = {}) {
        const { cardHeight, gapX, gapY, staffGapX, staffInternalGap, margins } = this.config;
        const hideLeaves = !!options.hideLeaves;

        const byId = new Map(data.nodes.map((n) => [n.id, n]));
        const childrenOf = new Map();
        data.nodes.forEach((n) => {
            if (n.parentId !== null) {
                if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, []);
                childrenOf.get(n.parentId).push(n.id);
            }
        });
        const isLeaf = (id) => !childrenOf.has(id) || childrenOf.get(id).length === 0;

        // Prune descendants of collapsed nodes, tracking how many were hidden. Leaf
        // children are additionally pruned (into the same per-parent count) when the
        // global "hide leaves" toggle is on.
        const hiddenDescendantCount = new Map();
        const visibleIds = new Set();
        const rootNode = data.nodes.find((n) => n.parentId === null);

        const addHidden = (parentId, n) => {
            hiddenDescendantCount.set(parentId, (hiddenDescendantCount.get(parentId) || 0) + n);
        };

        const walk = (id) => {
            visibleIds.add(id);
            const node = byId.get(id);
            if (node.collapsed) {
                let count = 0;
                const countAll = (cid) => {
                    (childrenOf.get(cid) || []).forEach((gcid) => {
                        count += 1;
                        countAll(gcid);
                    });
                };
                countAll(id);
                addHidden(id, count);
                return;
            }
            (childrenOf.get(id) || []).forEach((childId) => {
                const childNode = byId.get(childId);
                if (hideLeaves && childNode.placement !== 'staff' && isLeaf(childId)) {
                    addHidden(id, 1);
                    return;
                }
                walk(childId);
            });
        };
        walk(rootNode.id);

        const visibleNodes = data.nodes.filter((n) => visibleIds.has(n.id));
        const stratifyNodes = visibleNodes.filter((n) => n.placement !== 'staff');
        const staffNodesData = visibleNodes.filter((n) => n.placement === 'staff');

        // Group staff nodes by parent up front so both separation() (below) and the
        // post-process positioning step agree on how much width each parent's staff
        // row needs and in what order its staff cards are stacked.
        const staffChildrenByParentId = new Map();
        staffNodesData.forEach((n) => {
            if (!staffChildrenByParentId.has(n.parentId)) staffChildrenByParentId.set(n.parentId, []);
            staffChildrenByParentId.get(n.parentId).push(n);
        });

        const staffRightExtension = (nodeData) => {
            const staffKids = staffChildrenByParentId.get(nodeData.id);
            if (!staffKids || staffKids.length === 0) return 0;
            const totalWidth = staffKids.reduce((sum, k) => sum + this.clusterWidth(k), 0);
            return staffGapX + totalWidth + (staffKids.length - 1) * staffInternalGap;
        };

        const stratify = d3.stratify()
            .id((d) => d.id)
            .parentId((d) => d.parentId);

        const hierarchyRoot = stratify(stratifyNodes);

        const treeLayout = d3.tree()
            .nodeSize([1, cardHeight + gapY])
            .separation((a, b) => {
                const gap = a.parent === b.parent ? gapX : gapX * 2;
                // Both sides' staff extension is reserved unconditionally (not just
                // whichever argument is "the left one") — d3-hierarchy doesn't
                // guarantee call order across every contour comparison, and
                // reserving a little extra space is a far safer failure mode here
                // than a collision would be.
                return this.clusterWidth(a.data) / 2 + staffRightExtension(a.data)
                    + this.clusterWidth(b.data) / 2 + staffRightExtension(b.data)
                    + gap;
            });
        treeLayout(hierarchyRoot);

        // d3.tree() centers siblings around x=0; shift everything into positive space.
        // (Staff cards aren't counted here — they're positioned from their already-final
        // parent coordinates in the post-process step below, and folded into the bounds
        // via the staffNodes loop further down.)
        let minX = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        hierarchyRoot.each((d) => {
            const halfWidth = this.clusterWidth(d.data) / 2;
            if (d.x - halfWidth < minX) minX = d.x - halfWidth;
            if (d.x + halfWidth > maxX) maxX = d.x + halfWidth;
            if (d.y > maxY) maxY = d.y;
        });

        const offsetX = margins.left - minX;
        hierarchyRoot.each((d) => {
            d.x += offsetX;
            d.y += margins.top;
            d.hiddenCount = hiddenDescendantCount.get(d.id) || 0;
        });

        // Position staff nodes at exactly their parent's row (same y — see class doc),
        // stacked left-to-right to the right of the parent's cluster in parentId groups,
        // matching the width `staffRightExtension` reserved above.
        const byHierarchyId = new Map(hierarchyRoot.descendants().map((d) => [d.id, d]));
        const staffNodes = [];
        staffChildrenByParentId.forEach((staffKids, parentId) => {
            const parent = byHierarchyId.get(parentId);
            const parentHalfWidth = parent ? this.clusterWidth(parent.data) / 2 : 0;
            const parentX = parent ? parent.x : margins.left;
            const parentY = parent ? parent.y : margins.top;

            let cursorX = parentX + parentHalfWidth + staffGapX;
            staffKids.forEach((n) => {
                const width = this.clusterWidth(n);
                const x = cursorX + width / 2;
                staffNodes.push({
                    id: n.id, data: n, parentX, parentY, x, y: parentY, hiddenCount: 0
                });
                cursorX += width + staffInternalGap;
            });
        });

        staffNodes.forEach((s) => {
            const right = s.x + this.clusterWidth(s.data) / 2;
            if (right > maxX) maxX = right;
        });

        const width = (maxX - minX) + margins.left + margins.right;
        const height = maxY + cardHeight + margins.top + margins.bottom;

        return {
            config: { ...this.config, width, height },
            meta: data.meta,
            root: hierarchyRoot,
            staffNodes
        };
    }
}
