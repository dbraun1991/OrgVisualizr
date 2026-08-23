import { escapeHtml, sanitizeHtml, getInitials } from './utils.js';

/**
 * Builds an orthogonal (right-angle) elbow connector path between a parent
 * card's bottom-center and a child card's top-center — the classic
 * org-chart connector style, as opposed to smooth/curved links.
 *
 * @param {number} px - Parent bottom-center X.
 * @param {number} py - Parent bottom-center Y.
 * @param {number} cx - Child top-center X.
 * @param {number} cy - Child top-center Y.
 * @returns {string} SVG path string.
 */
function buildElbowPath(px, py, cx, cy) {
    const midY = py + (cy - py) / 2;
    return `M${px},${py}V${midY}H${cx}V${cy}`;
}

/**
 * Renders the org chart visualization using D3.js.
 * Manages the SVG structure, zoom/pan, node cards, and connector links.
 */
export class ChartRenderer {
    constructor(containerSelector) {
        this.container = document.querySelector(containerSelector);
        this.tooltip = d3.select('#tooltip');
    }

    /**
     * @param {Object} layout - Output of LayoutEngine.calculate().
     */
    render(layout) {
        if (!this.container) return;
        this.container.innerHTML = '';
        if (!layout || !layout.root) return;

        const { config, root } = layout;
        const renderer = this;

        // width/height="100%" + viewBox lets the canvas fill and track the container's
        // size (including on window resize) with zero JS resize handling needed — the
        // same pattern MetroRenderer uses. `xMidYMid meet` centers the chart and scales
        // it down if it doesn't fit; d3.zoom (below) is how the user goes beyond that.
        const svg = d3.select(this.container)
            .append('svg')
            .attr('width', '100%')
            .attr('height', '100%')
            .attr('viewBox', `0 0 ${config.width} ${config.height}`)
            .attr('preserveAspectRatio', 'xMidYMid meet')
            .attr('class', 'org-svg');

        const zoomGroup = svg.append('g').attr('class', 'zoom-group');

        const links = root.links();
        zoomGroup.append('g')
            .attr('class', 'org-links')
            .selectAll('path')
            .data(links)
            .join('path')
            .attr('class', 'org-link')
            .attr('d', (d) => buildElbowPath(
                d.source.x, d.source.y + config.cardHeight / 2,
                d.target.x, d.target.y - config.cardHeight / 2
            ));

        const nodeGroups = zoomGroup.append('g')
            .attr('class', 'org-nodes')
            .selectAll('g')
            .data(root.descendants())
            .join('g')
            .attr('class', 'org-node')
            .attr('transform', (d) => `translate(${d.x - config.cardWidth / 2}, ${d.y - config.cardHeight / 2})`)
            .style('cursor', (d) => (d.children || d.hiddenCount) ? 'pointer' : (d.data.description ? 'help' : 'default'));

        nodeGroups.append('rect')
            .attr('class', 'org-card')
            .attr('width', config.cardWidth)
            .attr('height', config.cardHeight)
            .attr('rx', 10)
            .attr('ry', 10);

        nodeGroups.append('rect')
            .attr('class', 'org-card-accent')
            .attr('width', 6)
            .attr('height', config.cardHeight)
            .attr('rx', 3)
            .attr('ry', 3)
            .attr('fill', (d) => d.data.color || '#4B5563');

        nodeGroups.append('circle')
            .attr('class', 'org-card-avatar')
            .attr('cx', 34)
            .attr('cy', config.cardHeight / 2)
            .attr('r', 18)
            .attr('fill', (d) => d.data.color || '#4B5563');

        nodeGroups.append('text')
            .attr('class', 'org-card-initials')
            .attr('x', 34)
            .attr('y', config.cardHeight / 2)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .text((d) => getInitials(d.data.name));

        nodeGroups.append('text')
            .attr('class', 'org-card-name')
            .attr('x', 60)
            .attr('y', config.cardHeight / 2 - 14)
            .text((d) => this._truncate(d.data.name || '', 20));

        nodeGroups.append('text')
            .attr('class', 'org-card-title')
            .attr('x', 60)
            .attr('y', config.cardHeight / 2 + 4)
            .text((d) => this._truncate(d.data.title || '', 22));

        nodeGroups.append('text')
            .attr('class', 'org-card-department')
            .attr('x', 60)
            .attr('y', config.cardHeight / 2 + 21)
            .text((d) => this._truncate(d.data.department || '', 24));

        const badges = nodeGroups.filter((d) => d.hiddenCount > 0);
        badges.append('circle')
            .attr('class', 'org-card-badge')
            .attr('cx', config.cardWidth - 14)
            .attr('cy', 14)
            .attr('r', 12);
        badges.append('text')
            .attr('class', 'org-card-badge-text')
            .attr('x', config.cardWidth - 14)
            .attr('y', 14)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .text((d) => `+${d.hiddenCount}`);

        nodeGroups
            .on('click', (event, d) => {
                if (d.children || d.hiddenCount) {
                    renderer.container.dispatchEvent(new CustomEvent('toggle-node', {
                        bubbles: true,
                        detail: { id: d.id }
                    }));
                }
            })
            .on('mouseenter', function (event, d) {
                const parts = [];
                parts.push(`<strong>${escapeHtml(d.data.name || '')}</strong>`);
                if (d.data.title) parts.push(escapeHtml(d.data.title));
                if (d.data.department) parts.push(`<span class="tooltip-dept">${escapeHtml(d.data.department)}</span>`);
                if (d.data.description) parts.push(`<div class="tooltip-desc">${sanitizeHtml(renderer._markdown(d.data.description))}</div>`);
                renderer.tooltip
                    .classed('hidden', false)
                    .html(parts.join('<br/>'));
            })
            .on('mousemove', (event) => {
                renderer.tooltip
                    .style('left', (event.pageX + 15) + 'px')
                    .style('top', (event.pageY - 15) + 'px');
            })
            .on('mouseleave', () => {
                renderer.tooltip.classed('hidden', true);
            });

        this.setupZoom(svg, zoomGroup);
        this.svgElement = svg.node();
    }

    _truncate(str, max) {
        if (!str) return '';
        return str.length > max ? str.slice(0, max - 1) + '…' : str;
    }

    _markdown(text) {
        if (typeof marked !== 'undefined') return marked.parse(text);
        return escapeHtml(text);
    }

    /**
     * Enables pan/zoom on the chart canvas.
     *
     * @param {d3.Selection} svg - The root SVG selection.
     * @param {d3.Selection} zoomGroup - The group that pan/zoom transforms are applied to.
     */
    setupZoom(svg, zoomGroup) {
        const zoom = d3.zoom()
            .scaleExtent([0.2, 3])
            .on('zoom', (event) => {
                zoomGroup.attr('transform', event.transform);
            });
        svg.call(zoom);
    }
}
