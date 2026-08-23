/**
 * Calculates the X and Y coordinates of org chart nodes using d3.stratify()
 * (flat parentId list -> hierarchy) and d3.tree() (hierarchy -> pixel coordinates).
 *
 * Nodes marked `collapsed: true` have their descendants pruned from the layout;
 * the pruned count is kept so the renderer can show a "+N" badge.
 */
export class LayoutEngine {
    constructor() {
        this.config = {
            cardWidth: 200,
            cardHeight: 76,
            gapX: 32,
            gapY: 56,
            margins: { top: 40, right: 40, bottom: 40, left: 40 }
        };
    }

    /**
     * @param {Object} data - Normalized data from DataModel (meta + nodes[]).
     * @returns {Object} Layout containing the pruned d3 hierarchy root and config.
     */
    calculate(data) {
        const { cardWidth, cardHeight, gapX, gapY, margins } = this.config;

        const byId = new Map(data.nodes.map((n) => [n.id, n]));
        const childrenOf = new Map();
        data.nodes.forEach((n) => {
            if (n.parentId !== null) {
                if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, []);
                childrenOf.get(n.parentId).push(n.id);
            }
        });

        // Prune descendants of collapsed nodes, tracking how many were hidden.
        const hiddenDescendantCount = new Map();
        const visibleIds = new Set();
        const rootNode = data.nodes.find((n) => n.parentId === null);

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
                hiddenDescendantCount.set(id, count);
                return;
            }
            (childrenOf.get(id) || []).forEach(walk);
        };
        walk(rootNode.id);

        const prunedNodes = data.nodes.filter((n) => visibleIds.has(n.id));

        const stratify = d3.stratify()
            .id((d) => d.id)
            .parentId((d) => d.parentId);

        const hierarchyRoot = stratify(prunedNodes);

        const treeLayout = d3.tree().nodeSize([cardWidth + gapX, cardHeight + gapY]);
        treeLayout(hierarchyRoot);

        // d3.tree() centers siblings around x=0; shift everything into positive space.
        let minX = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        hierarchyRoot.each((d) => {
            if (d.x < minX) minX = d.x;
            if (d.x > maxX) maxX = d.x;
            if (d.y > maxY) maxY = d.y;
        });

        const offsetX = margins.left + cardWidth / 2 - minX;
        hierarchyRoot.each((d) => {
            d.x += offsetX;
            d.y += margins.top;
            d.hiddenCount = hiddenDescendantCount.get(d.id) || 0;
        });

        const width = (maxX - minX) + cardWidth + margins.left + margins.right;
        const height = maxY + cardHeight + margins.top + margins.bottom;

        return {
            config: { ...this.config, width, height },
            meta: data.meta,
            root: hierarchyRoot
        };
    }
}
