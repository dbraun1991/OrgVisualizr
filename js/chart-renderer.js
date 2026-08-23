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
 * Builds a connector from a manager's right edge to a staff position's left
 * edge — drawn dashed by CSS (`.org-link--staff`) to read as support/staff
 * authority rather than a normal reporting line (see ADR-004). Staff cards
 * always sit at their parent's own row (py === cy in practice), so this is a
 * straight horizontal line; the elbow fallback only matters if that geometry
 * ever changes.
 *
 * @param {number} px - Parent right-mid edge X.
 * @param {number} py - Parent right-mid edge Y.
 * @param {number} cx - Staff cluster left-mid edge X.
 * @param {number} cy - Staff cluster left-mid edge Y.
 * @returns {string} SVG path string.
 */
function buildStaffPath(px, py, cx, cy) {
    if (Math.abs(cy - py) < 0.5) return `M${px},${py}H${cx}`;
    const midX = px + (cx - px) / 2;
    return `M${px},${py}H${midX}V${cy}H${cx}`;
}

/**
 * Renders the org chart visualization using D3.js.
 * Manages the SVG structure, zoom/pan, occupant-cluster cards, and connector links.
 */
export class ChartRenderer {
    constructor(containerSelector) {
        this.container = document.querySelector(containerSelector);
        this.tooltip = d3.select('#tooltip');
    }

    /**
     * Pixel width of a position's on-screen cluster (primary + co-occupants, side by side).
     * Mirrors LayoutEngine.clusterWidth() — kept as a plain function here so the renderer
     * doesn't need a LayoutEngine instance, just the shared `config`.
     * @param {Object} data - A node's data.
     * @param {Object} config - The layout config (cardWidth, coOccupantGap).
     * @returns {number}
     */
    _clusterWidth(data, config) {
        const count = 1 + (data.coOccupants ? data.coOccupants.length : 0);
        return count * config.cardWidth + (count - 1) * config.coOccupantGap;
    }

    /**
     * @param {Object} layout - Output of LayoutEngine.calculate().
     */
    render(layout) {
        if (!this.container) return;
        this.container.innerHTML = '';
        if (!layout || !layout.root) return;

        const { config, root, staffNodes } = layout;
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
        const byId = new Map(root.descendants().map((d) => [d.id, d]));

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

        zoomGroup.append('g')
            .attr('class', 'org-links org-links--staff')
            .selectAll('path')
            .data(staffNodes)
            .join('path')
            .attr('class', 'org-link org-link--staff')
            .attr('d', (d) => {
                const parent = byId.get(d.data.parentId);
                const parentHalfWidth = parent ? this._clusterWidth(parent.data, config) / 2 : 0;
                return buildStaffPath(
                    d.parentX + parentHalfWidth, d.parentY,
                    d.x - this._clusterWidth(d.data, config) / 2, d.y
                );
            });

        // Normalize tree positions and staff positions into one shape for card drawing.
        const positions = root.descendants().map((d) => ({
            id: d.id, x: d.x, y: d.y, data: d.data, hiddenCount: d.hiddenCount,
            canToggle: !!(d.children || d.hiddenCount), isStaff: false
        })).concat(staffNodes.map((d) => ({
            id: d.id, x: d.x, y: d.y, data: d.data, hiddenCount: 0,
            canToggle: false, isStaff: true
        })));

        const nodeGroups = zoomGroup.append('g')
            .attr('class', 'org-nodes')
            .selectAll('g')
            .data(positions, (d) => d.id)
            .join('g')
            .attr('class', (d) => 'org-node' + (d.isStaff ? ' org-node--staff' : ''))
            .attr('transform', (d) => `translate(${d.x - this._clusterWidth(d.data, config) / 2}, ${d.y - config.cardHeight / 2})`)
            .style('cursor', (d) => (d.canToggle ? 'pointer' : 'default'));

        nodeGroups.on('click', (event, d) => {
            if (d.canToggle) {
                renderer.container.dispatchEvent(new CustomEvent('toggle-node', {
                    bubbles: true,
                    detail: { id: d.id }
                }));
            }
        });

        // One occupant sub-group per person (primary + co-occupants), laid out left-to-right
        // within the position's cluster — see ADR-004.
        const occupantGroups = nodeGroups.selectAll('g.org-occupant')
            .data((d) => this._occupantsOf(d).map((occupant, i) => ({ occupant, index: i, position: d })))
            .join('g')
            .attr('class', 'org-occupant')
            .attr('transform', (o) => `translate(${o.index * (config.cardWidth + config.coOccupantGap)}, 0)`)
            .style('cursor', (o) => (o.occupant.description ? 'help' : null));

        occupantGroups.append('rect')
            .attr('class', 'org-card')
            .attr('width', config.cardWidth)
            .attr('height', config.cardHeight)
            .attr('rx', 10)
            .attr('ry', 10);

        occupantGroups.append('rect')
            .attr('class', 'org-card-accent')
            .attr('width', 6)
            .attr('height', config.cardHeight)
            .attr('rx', 3)
            .attr('ry', 3)
            .attr('fill', (o) => o.occupant.color || '#4B5563');

        occupantGroups.append('circle')
            .attr('class', 'org-card-avatar')
            .attr('cx', 34)
            .attr('cy', config.cardHeight / 2)
            .attr('r', 18)
            .attr('fill', (o) => o.occupant.color || '#4B5563');

        occupantGroups.append('text')
            .attr('class', 'org-card-initials')
            .attr('x', 34)
            .attr('y', config.cardHeight / 2)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .text((o) => getInitials(o.occupant.name));

        occupantGroups.append('text')
            .attr('class', 'org-card-name')
            .attr('x', 60)
            .attr('y', config.cardHeight / 2 - 14)
            .text((o) => this._truncate(o.occupant.name || '', 20));

        occupantGroups.append('text')
            .attr('class', 'org-card-title')
            .attr('x', 60)
            .attr('y', config.cardHeight / 2 + 4)
            .text((o) => this._truncate(o.occupant.title || '', 22));

        occupantGroups.append('text')
            .attr('class', 'org-card-department')
            .attr('x', 60)
            .attr('y', config.cardHeight / 2 + 21)
            .text((o) => this._truncate(o.position.data.department || '', 24));

        // Appended after (not before) the occupant cards above, so the badge paints
        // on top of them instead of being covered by the last card's opaque rect —
        // it was previously invisible because SVG paints later siblings over earlier
        // ones and this used to run before occupantGroups existed.
        const badges = nodeGroups.filter((d) => d.hiddenCount > 0);
        badges.append('circle')
            .attr('class', 'org-card-badge')
            .attr('cx', (d) => this._clusterWidth(d.data, config) - 14)
            .attr('cy', 14)
            .attr('r', 12)
            .attr('fill', (d) => d.data.color || '#4B5563');
        badges.append('text')
            .attr('class', 'org-card-badge-text')
            .attr('x', (d) => this._clusterWidth(d.data, config) - 14)
            .attr('y', 14)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .text((d) => `+${d.hiddenCount}`);

        occupantGroups
            .on('mouseenter', function (event, o) {
                const parts = [];
                parts.push(`<strong>${escapeHtml(o.occupant.name || '')}</strong>`);
                if (o.occupant.title) parts.push(escapeHtml(o.occupant.title));
                if (o.position.data.department) parts.push(`<span class="tooltip-dept">${escapeHtml(o.position.data.department)}</span>`);
                if (o.position.isStaff) parts.push(`<span class="tooltip-dept">${escapeHtml('Staff position')}</span>`);
                if (o.occupant.description) parts.push(`<div class="tooltip-desc">${sanitizeHtml(renderer._markdown(o.occupant.description))}</div>`);
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

    /**
     * The primary occupant (the node's own name/title/color/description) plus any
     * co-occupants, as a flat list for cluster rendering.
     * @param {Object} position - A normalized position ({data, ...}).
     * @returns {Array}
     */
    _occupantsOf(position) {
        const primary = {
            name: position.data.name,
            title: position.data.title,
            color: position.data.color,
            description: position.data.description
        };
        return [primary, ...(position.data.coOccupants || [])];
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
