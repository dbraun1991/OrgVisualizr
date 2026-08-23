import { escapeHtml, sanitizeHtml, getInitials, truncateText, buildElbowPath } from './utils.js';
import { getContrastTextColor } from './color-utils.js';
import { renderSectionsSvg } from './sections-renderer.js';

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
     * Nudges each already-rendered text element in `selection` so its actual glyph
     * bounding box (not its nominal em-box) is vertically centered on `targetCy`.
     * `dy="0.35em"` (set by the caller before this runs) gets a font's *approximate*
     * center — how close depends on that font's specific metrics, which is why avatar
     * initials/badge digits could still look slightly off-center on some fonts even
     * with it applied. Measuring the real rendered bbox and correcting for it removes
     * that font-dependence entirely.
     * @param {d3.Selection} selection - Already-appended, already-texted text elements.
     * @param {number|function} targetCy - The Y each element's glyph box should center on.
     */
    _verticallyCenterText(selection, targetCy) {
        selection.each(function (d) {
            const cy = typeof targetCy === 'function' ? targetCy(d) : targetCy;
            const bbox = this.getBBox();
            const delta = cy - (bbox.y + bbox.height / 2);
            if (delta) this.setAttribute('y', parseFloat(this.getAttribute('y')) + delta);
        });
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
            // dy="0.35em" + text-anchor:middle centers text on its (x,y) point using only
            // the alphabetic baseline math every renderer supports. dominant-baseline:
            // central would do the same in a browser, but svg2pdf.js (PDF export) doesn't
            // support it and silently falls back to the alphabetic baseline, offsetting
            // the text — this approach renders identically everywhere instead. 0.35em is
            // only an approximation of a font's true vertical center though, so it's
            // followed by a measured pixel-exact correction below.
            .attr('dy', '0.35em')
            .attr('text-anchor', 'middle')
            .attr('fill', (o) => getContrastTextColor(o.occupant.color || '#4B5563'))
            .text((o) => getInitials(o.occupant.name))
            .call(this._verticallyCenterText, config.cardHeight / 2);

        occupantGroups.append('text')
            .attr('class', 'org-card-name')
            .attr('x', 60)
            .attr('y', config.cardHeight / 2 - 14)
            .text((o) => truncateText(o.occupant.name || '', 20));

        occupantGroups.append('text')
            .attr('class', 'org-card-title')
            .attr('x', 60)
            .attr('y', config.cardHeight / 2 + 4)
            .text((o) => truncateText(o.occupant.title || '', 22));

        occupantGroups.append('text')
            .attr('class', 'org-card-department')
            .attr('x', 60)
            .attr('y', config.cardHeight / 2 + 21)
            .text((o) => truncateText(o.position.data.department || '', 24));

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
            // See the org-card-initials text above for why dy="0.35em" is used instead
            // of dominant-baseline: central here, and why it's followed by a measured
            // correction.
            .attr('dy', '0.35em')
            .attr('text-anchor', 'middle')
            .attr('fill', (d) => getContrastTextColor(d.data.color || '#4B5563'))
            .text((d) => `+${d.hiddenCount}`)
            .call(this._verticallyCenterText, 14);

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
     * Renders the abstracted "Sections" view — departments containing named
     * sub-groups, listing only leads (people with direct reports), indented by
     * tier. The actual SVG construction lives in sections-renderer.js; this method
     * just owns the container/svgElement/zoom wiring, the same responsibility
     * render() has above, so export (file-manager.js, which always reads
     * `this.svgElement`) keeps working unmodified regardless of which view is
     * currently on screen.
     * @param {Object} layout - Output of SectionsLayout.calculate().
     */
    renderSections(layout) {
        if (!this.container) return;
        this.container.innerHTML = '';
        if (!layout || !layout.sections) return;

        const { svg, zoomGroup } = renderSectionsSvg(this.container, layout);
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
