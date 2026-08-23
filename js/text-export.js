import { downloadBlob, sanitizeFilename } from './utils.js';

/**
 * Provides actions to generate and export the org chart as a nested Markdown/text list.
 * One-way (data -> text) export only, mirroring MetroViz's markdown-export.js.
 */
export const textExportActions = {
    /**
     * Triggers the download of the current org chart as a .txt file.
     */
    exportText() {
        const text = this.generateText();
        if (!text) return;
        const filename = sanitizeFilename(this.currentFileName) + '.txt';
        downloadBlob(text, 'text/plain;charset=utf-8;', filename);
    },

    /**
     * Walks the tree depth-first and compiles it into an indented Markdown bullet list.
     * Staff positions are listed under their manager without recursing further into
     * them (they can't have children of their own — see ADR-004).
     *
     * @returns {string} The generated text content.
     */
    generateText() {
        if (!this.data || !Array.isArray(this.data.nodes)) return '';

        const root = this.data.nodes.find((n) => !n.parentId);
        if (!root) return '';

        const childrenOf = new Map();
        this.data.nodes.forEach((n) => {
            if (n.parentId) {
                if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, []);
                childrenOf.get(n.parentId).push(n);
            }
        });

        let out = `# ${this.data.meta?.title || i18next.t('js.textExportDefaultTitle')}\n`;
        if (this.data.meta?.organization) {
            out += `**${i18next.t('editor.organization')}:** ${this.data.meta.organization}  \n`;
        }
        out += '\n';

        const occupantNames = (node) => [node.name, ...(node.coOccupants || []).map((c) => c.name)]
            .filter(Boolean).join(' & ');

        const lines = [];
        const walk = (node, depth) => {
            const indent = '  '.repeat(depth);
            let line = `${indent}- **${occupantNames(node)}**`;
            if (node.title) line += ` — ${node.title}`;
            if (node.department) line += ` (${node.department})`;
            lines.push(line);

            if (node.description && node.description.trim()) {
                const quoted = node.description.split('\n').map((l) => `${indent}  > ${l}`).join('\n');
                lines.push(quoted);
            }

            const kids = childrenOf.get(node.id) || [];
            kids.filter((k) => k.placement === 'staff').forEach((sk) => {
                let staffLine = `${indent}  - *${i18next.t('editor.placementStaff')}:* **${occupantNames(sk)}**`;
                if (sk.title) staffLine += ` — ${sk.title}`;
                lines.push(staffLine);
            });
            kids.filter((k) => k.placement !== 'staff').forEach((child) => walk(child, depth + 1));
        };
        walk(root, 0);

        return out + lines.join('\n') + '\n';
    }
};
