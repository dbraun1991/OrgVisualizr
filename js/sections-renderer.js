import { truncateText } from './utils.js';

/**
 * Draws the "Sections" view: one box per department, containing named group
 * sub-boxes (or, for ungrouped leads, rows directly in the section), each
 * listing only its leads — people with direct reports — indented by tier.
 *
 * Deliberately lighter-weight than chart-renderer.js's cards: a single text
 * row per lead (a color dot + name + title), no card, no avatar. This view
 * exists to abstract away from individuals toward organizational shape, so
 * drawing a full card per person here would defeat the point.
 *
 * @param {Element} container - The DOM element to render into (already cleared by the caller).
 * @param {Object} layout - Output of SectionsLayout.calculate().
 * @returns {{svg: d3.Selection, zoomGroup: d3.Selection}}
 */
export function renderSectionsSvg(container, layout) {
    const { config, sections } = layout;

    const svg = d3.select(container)
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('viewBox', `0 0 ${config.width} ${config.height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'org-svg sections-svg');

    const zoomGroup = svg.append('g').attr('class', 'zoom-group');

    const sectionGroups = zoomGroup.append('g')
        .attr('class', 'sections')
        .selectAll('g.section-box')
        .data(sections, (d) => d.id)
        .join('g')
        .attr('class', 'section-box')
        .attr('transform', (d) => `translate(${d.x}, ${d.y})`);

    // Fill/stroke colors here are per-section data (the section lead's own color
    // and whichever of black/white contrasts against it — see SectionsLayout),
    // not theme defaults, so they're set inline rather than via CSS classes —
    // same reasoning as chart-renderer.js's org-card-accent/avatar/badge colors.
    sectionGroups.append('rect')
        .attr('class', 'section-rect')
        .attr('width', (d) => d.width)
        .attr('height', (d) => d.height)
        .attr('rx', 10)
        .attr('ry', 10)
        .attr('fill', (d) => d.color);

    // Section name is drawn exactly once, here, at the top of the box — group
    // names (below) are the only other label in the section, never the section
    // name repeated per group.
    sectionGroups.append('text')
        .attr('class', 'section-title')
        .attr('x', config.sectionPadding)
        .attr('y', config.sectionTitleHeight / 2)
        .attr('dy', '0.35em')
        .attr('fill', (d) => d.textColor)
        .text((d) => truncateText(d.name, 28));

    sectionGroups.selectAll('rect.group-rect')
        .data((d) => d.groupBoxes)
        .join('rect')
        .attr('class', 'group-rect')
        .attr('x', (g) => g.x)
        .attr('y', (g) => g.y)
        .attr('width', (g) => g.width)
        .attr('height', (g) => g.height)
        .attr('rx', 6)
        .attr('ry', 6)
        .attr('stroke', (g) => g.textColor);

    sectionGroups.selectAll('text.group-title')
        .data((d) => d.groupBoxes)
        .join('text')
        .attr('class', 'group-title')
        .attr('x', (g) => g.x + config.groupPadding)
        .attr('y', (g) => g.y + config.groupTitleHeight / 2)
        .attr('dy', '0.35em')
        .attr('fill', (g) => g.textColor)
        .text((g) => truncateText(g.name, 24));

    const leadRows = sectionGroups.selectAll('g.lead-row')
        .data((d) => d.leadRows)
        .join('g')
        .attr('class', 'lead-row')
        .attr('transform', (r) => `translate(${r.x}, ${r.y})`)
        .style('cursor', (r) => (r.node.description ? 'help' : null));

    leadRows.append('circle')
        .attr('class', 'lead-dot')
        .attr('cx', 5)
        .attr('cy', config.rowHeight / 2)
        .attr('r', 4)
        .attr('fill', (r) => r.node.color || '#4B5563')
        // A lead's own dot color is often the same color as the section box behind
        // it (department color === section color, in practice) — an outline in the
        // section's contrast color keeps the dot visible even then.
        .attr('stroke', (r) => r.textColor)
        .attr('stroke-width', 1);

    // Name and title share one <text> as two <tspan>s (rather than two separate
    // <text> elements at fixed x offsets) so they flow one after the other at
    // their actual rendered width, with no risk of overlapping a long name.
    const leadText = leadRows.append('text')
        .attr('class', 'lead-text')
        .attr('x', 16)
        .attr('y', config.rowHeight / 2)
        .attr('dy', '0.35em');

    leadText.append('tspan')
        .attr('class', 'lead-name')
        .attr('fill', (r) => r.textColor)
        .text((r) => truncateText(r.node.name || '', 20));

    leadText.append('tspan')
        .attr('class', 'lead-title')
        .attr('fill', (r) => r.textColor)
        .attr('fill-opacity', 0.75)
        .text((r) => (r.node.title ? '  —  ' + truncateText(r.node.title, 20) : ''));

    return { svg, zoomGroup };
}
