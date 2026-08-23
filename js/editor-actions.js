export const editorActions = {
    // Intent: Array mutations (like .push() and .splice()) are used extensively in this object.
    // We do this to trigger the reactivity system of the underlying UI framework (e.g., Alpine.js),
    // which observes direct array modifications to update the view, rather than relying on immutability.

    /**
     * Generates a random alphanumeric ID string.
     * @param {string} prefix - The prefix for the generated ID.
     * @returns {string} The prefixed random ID.
     */
    generateId(prefix) {
        return prefix + '-' + Math.random().toString(36).substr(2, 6);
    },

    /**
     * Compares two HEX color strings safely.
     * @param {string} a - First color.
     * @param {string} b - Second color.
     * @returns {boolean} True if the colors match.
     */
    paletteColorsEqual(a, b) {
        if (a == null || b == null) return false;
        return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
    },

    /**
     * Checks if a custom HEX color exists in the predefined department palette.
     * @param {string} hex - The color to check.
     * @returns {boolean} True if the color is part of the palette.
     */
    colorInPalette(hex) {
        return this.deptPalette.some((c) => this.paletteColorsEqual(c, hex));
    },

    /**
     * Returns the root node of the current tree, or null if none exists.
     * @returns {Object|null} The root node.
     */
    getRootNode() {
        return this.data.nodes.find((n) => !n.parentId) || null;
    },

    /**
     * Finds a node by its unique ID.
     * @param {string} id - The node ID to find.
     * @returns {Object|null} The matching node, or null.
     */
    getNodeById(id) {
        return this.data.nodes.find((n) => n.id === id) || null;
    },

    /**
     * Returns the direct children of a given node ID.
     * @param {string} id - The parent node ID.
     * @returns {Array} Child node objects.
     */
    getChildren(id) {
        return this.data.nodes.filter((n) => n.parentId === id);
    },

    /**
     * Returns true if `candidateId` is `nodeId` itself or one of its descendants.
     * Used to prevent creating a cycle when reparenting via the visual editor.
     * @param {string} nodeId - The node being moved.
     * @param {string} candidateId - The proposed new parent.
     * @returns {boolean}
     */
    isSelfOrDescendant(nodeId, candidateId) {
        if (nodeId === candidateId) return true;
        const children = this.getChildren(nodeId);
        return children.some((c) => this.isSelfOrDescendant(c.id, candidateId));
    },

    /**
     * Builds a depth-first-ordered flat list of all nodes with a computed `depth`,
     * used to render the visual editor's indented tree list without recursive templates.
     * @returns {Array<{node: Object, depth: number}>}
     */
    flatNodeList() {
        const root = this.getRootNode();
        if (!root) return [];
        const result = [];
        const walk = (node, depth) => {
            result.push({ node, depth });
            this.getChildren(node.id).forEach((child) => walk(child, depth + 1));
        };
        walk(root, 0);
        return result;
    },

    /**
     * Returns all nodes eligible as a new parent for `node` (excludes itself, its
     * descendants, and staff-placement nodes, which cannot have children — ADR-004).
     * @param {Object} node - The node being reparented.
     * @returns {Array} Eligible parent node objects.
     */
    getEligibleParents(node) {
        return this.data.nodes.filter((n) => n.placement !== 'staff' && !this.isSelfOrDescendant(node.id, n.id));
    },

    /**
     * Ensures an editor item is visible by switching to the visual tab and scrolling it into view.
     * @param {string} domId - The DOM ID of the item to scroll to.
     */
    scrollVisualEditorItemToView(domId) {
        this.activeTab = 'visual';
        this.$nextTick(() => {
            requestAnimationFrame(() => {
                const el = document.getElementById(domId);
                if (!el) return;
                setTimeout(() => {
                    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 50);
            });
        });
    },

    /**
     * Adds a new child node under the given parent.
     * @param {Object} parentNode - The node to attach the new child to.
     */
    addChildNode(parentNode) {
        const id = this.generateId('node');
        const newNode = {
            id,
            parentId: parentNode.id,
            name: i18next.t('js.defaultNewNodeName'),
            title: '',
            department: parentNode.department || '',
            color: parentNode.color || this.deptPalette[0]
        };
        this.data.nodes.push(newNode);
        if (parentNode.collapsed) parentNode.collapsed = false;
        this.scrollVisualEditorItemToView('editor-node-' + id);
    },

    /**
     * Creates a brand-new chart with a single root node.
     */
    addRootNode() {
        const id = this.generateId('node');
        this.data.nodes.push({
            id,
            parentId: null,
            name: i18next.t('js.defaultNewNodeName'),
            title: '',
            department: '',
            color: this.deptPalette[0]
        });
        this.scrollVisualEditorItemToView('editor-node-' + id);
    },

    /**
     * Adds a co-occupant (joint holder of the same position) to a node — see ADR-004.
     * @param {Object} node - The position to add a co-occupant to.
     */
    addCoOccupant(node) {
        if (!node.coOccupants) node.coOccupants = [];
        node.coOccupants.push({
            name: i18next.t('js.defaultNewNodeName'),
            title: '',
            color: node.color || this.deptPalette[0]
        });
    },

    /**
     * Removes a co-occupant from a position.
     * @param {Object} node - The position to remove a co-occupant from.
     * @param {number} index - Index within node.coOccupants.
     */
    removeCoOccupant(node, index) {
        if (!node.coOccupants) return;
        node.coOccupants.splice(index, 1);
    },

    /**
     * Recolors every descendant of `node` — direct reports, their reports, and so on
     * down the whole subtree, including each descendant's co-occupants — to `node`'s
     * own current color. `node` itself (and its own co-occupants, who are peers of
     * `node` rather than reports) are left untouched.
     * @param {Object} node - The position whose color propagates down to its reports.
     */
    applyColorToSubtree(node) {
        const color = node.color;
        const paint = (id) => {
            this.getChildren(id).forEach((child) => {
                child.color = color;
                (child.coOccupants || []).forEach((co) => { co.color = color; });
                paint(child.id);
            });
        };
        paint(node.id);
    },

    /**
     * A "staff" placement node cannot itself have children in v1 (ADR-004) — used to
     * disable that option in the editor for a node that currently has direct reports.
     * @param {Object} node - The node to check.
     * @returns {boolean}
     */
    canSetStaffPlacement(node) {
        return this.getChildren(node.id).length === 0;
    },

    /**
     * Sets a node's placement ("line" or "staff"), guarding the staff-has-no-children
     * rule from ADR-004 with a clear message instead of a silent validation failure
     * surfacing later in the JSON tab.
     * @param {Object} node - The node to update.
     * @param {string} value - "line" or "staff".
     */
    async setPlacement(node, value) {
        if (value === 'staff' && !this.canSetStaffPlacement(node)) {
            await this.dialogAlert(i18next.t('js.staffNeedsNoChildren'), i18next.t('js.errorTitle'));
            return;
        }
        node.placement = value;
    },

    /**
     * Removes a node from the tree.
     *
     * The root node cannot be deleted (a tree always needs exactly one root).
     * If the node has children, they are reparented to the deleted node's
     * own parent (its grandparent from the children's perspective) after
     * user confirmation, so the rest of the tree stays connected.
     *
     * @param {Object} node - The node to remove.
     */
    async removeNode(node) {
        if (!node.parentId) {
            await this.dialogAlert(i18next.t('js.cannotDeleteRoot'), i18next.t('js.errorTitle'));
            return;
        }

        const children = this.getChildren(node.id);
        if (children.length > 0) {
            const ok = await this.dialogConfirm(
                i18next.t('js.confirmReparentOnDelete', { count: children.length }),
                i18next.t('js.confirmTitle')
            );
            if (!ok) return;
            children.forEach((c) => { c.parentId = node.parentId; });
        }

        const index = this.data.nodes.findIndex((n) => n.id === node.id);
        if (index !== -1) this.data.nodes.splice(index, 1);
    },

    /**
     * Reassigns a node's parent, guarding against creating a cycle.
     * @param {Object} node - The node being moved.
     * @param {string} newParentId - The proposed new parent's ID.
     */
    reparentNode(node, newParentId) {
        if (!newParentId || newParentId === node.id) return;
        if (this.isSelfOrDescendant(node.id, newParentId)) return;
        node.parentId = newParentId;
    },

    /**
     * Toggles whether a node's subtree is collapsed (hidden) in the chart.
     * @param {Object} node - The node to toggle.
     */
    toggleCollapse(node) {
        node.collapsed = !node.collapsed;
    },

    /**
     * Toggles collapse state by node ID (used by chart click events).
     * @param {string} id - The node ID to toggle.
     */
    toggleCollapseById(id) {
        const node = this.getNodeById(id);
        if (node) this.toggleCollapse(node);
    },

    /**
     * Removes references to node IDs that no longer exist, and guarantees a single root.
     * Intent: user hand-edits in the JSON tab can leave dangling parentId references;
     * this is a safety net invoked explicitly via the "Cleanup" action.
     */
    resortAndClean() {
        const idSet = new Set(this.data.nodes.map((n) => n.id));

        this.data.nodes.forEach((n) => {
            if (n.parentId && !idSet.has(n.parentId)) {
                n.parentId = null;
            }
        });

        // If cleanup produced more than one root, keep the first and reparent the rest to it.
        const rootsAfter = this.data.nodes.filter((n) => !n.parentId);
        if (rootsAfter.length > 1) {
            const [first, ...rest] = rootsAfter;
            rest.forEach((n) => { n.parentId = first.id; });
        }
    }
};
