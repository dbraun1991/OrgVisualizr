/**
 * Converts a hexadecimal color string to HSV (Hue, Saturation, Value) representation.
 *
 * @param {string} hex - The hex color string (e.g., "#FF0000").
 * @returns {{h: number, s: number, v: number}} Object containing hue (0-360), saturation (0-1), and value (0-1).
 */
export function hexToHsv(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const v = max;

    const s = max === 0 ? 0 : d / max;
    let h = 0;

    if (d > 1e-6) {
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return { h: h * 360, s, v };
}

/**
 * Picks the more readable overlay text color (black or white) for text sitting on
 * top of a solid hex fill — used for avatar initials and badge counts, which sit on
 * a node's own color (any palette entry, or a custom hex from the picker) rather
 * than a fixed app color, so a single hardcoded text color isn't reliably readable.
 *
 * Uses the standard YIQ perceived-brightness formula (weights green highest, blue
 * lowest, matching human luminance perception) rather than raw HSV "value", since a
 * saturated pure blue and a pale yellow can share the same HSV value while needing
 * opposite text colors.
 *
 * @param {string} hex - The background hex color (e.g., "#FFD300").
 * @returns {string} "#000000" or "#ffffff", whichever contrasts better.
 */
export function getContrastTextColor(hex) {
    if (!hex || hex.length < 7) return '#ffffff';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 150 ? '#000000' : '#ffffff';
}

/**
 * Sorts an array of hex colors primarily by hue (rainbow order).
 * Desaturated colors (grays) are pushed to the end and sorted by brightness.
 *
 * @param {string[]} hexes - Array of hex color strings.
 * @returns {string[]} A new array of sorted hex color strings.
 */
export function sortPaletteRainbow(hexes) {
    return [...hexes].sort((a, b) => {
        const A = hexToHsv(a);
        const B = hexToHsv(b);

        const grayA = A.s < 0.15;
        const grayB = B.s < 0.15;

        if (grayA !== grayB) return grayA ? 1 : -1;
        if (grayA && grayB) return B.v - A.v;
        return A.h - B.h;
    });
}

/** Modern, accessible-contrast department color palette. */
export const DEPARTMENT_PALETTE_BASE = [
    '#E32017', '#0064B0', '#007229', '#FFD300', '#9B0056',
    '#00A0E2', '#76D0BD', '#00AFAD', '#EE7623', '#9364CC',
    '#66C028', '#8BC75F', '#6F1D55', '#62259D', '#FF6319',
    '#2850AD', '#6CBE45', '#FCCC0A', '#B933AD', '#0078D4',
    '#17B890', '#7B208B', '#CC6600', '#4B5563', '#111827'
];

/**
 * Positions a color palette dropdown with a fixed layout in the viewport.
 * Prevents clipping inside container elements that have hidden overflow.
 *
 * @param {HTMLElement} triggerEl - The element that triggers the dropdown.
 * @param {HTMLElement} menuEl - The dropdown menu element to be positioned.
 */
export function positionPaletteDropdown(triggerEl, menuEl) {
    if (!triggerEl || !menuEl) return;
    const margin = 8;
    const rect = triggerEl.getBoundingClientRect();

    const estW = 6 * 32 + 5 * 3 + 12 + 2 * 6;
    const estH = 5 * 32 + 4 * 3 + 12 + 2 * 6;

    let w = menuEl.offsetWidth;
    let h = menuEl.offsetHeight;
    if (w < 40) w = estW;
    if (h < 40) h = estH;

    let left = rect.right - w;
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));

    let top = rect.bottom + 4;
    if (top + h > window.innerHeight - margin) {
        top = rect.top - h - 4;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - h - margin));

    menuEl.style.position = 'fixed';
    menuEl.style.left = `${Math.round(left)}px`;
    menuEl.style.top = `${Math.round(top)}px`;
    menuEl.style.right = 'auto';
}

if (typeof window !== 'undefined') {
    window.orgvisualizrPositionPalette = positionPaletteDropdown;
}
