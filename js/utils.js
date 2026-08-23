/**
 * Escapes HTML characters in a string to prevent XSS attacks when injecting into the DOM.
 *
 * @param {string} str - The raw string to escape.
 * @returns {string} The escaped string.
 */
export function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Sanitizes an HTML string using DOMPurify if available in the global scope.
 * Serves as a graceful fallback when DOMPurify is not loaded.
 *
 * @param {string} html - The HTML string to sanitize.
 * @returns {string} The sanitized HTML string.
 */
export function sanitizeHtml(html) {
    if (typeof window !== 'undefined' && window.DOMPurify) {
        return window.DOMPurify.sanitize(html);
    }
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
        .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
        .replace(/\son\w+="[^"]*"/gi, '')
        .replace(/\son\w+='[^']*'/gi, '')
        .replace(/javascript:/gi, '');
}

/**
 * Sanitizes an SVG string to remove potentially malicious elements before exporting.
 *
 * @param {string} svgString - The raw SVG string.
 * @returns {string} The sanitized SVG string.
 */
export function sanitizeSvg(svgString) {
    if (typeof window !== 'undefined' && window.DOMPurify) {
        return window.DOMPurify.sanitize(svgString, {
            USE_PROFILES: { svg: true },
            ADD_ATTR: ['xmlns', 'xmlns:xlink']
        });
    }
    return svgString
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<foreignObject\b[^<]*(?:(?!<\/foreignObject>)<[^<]*)*<\/foreignObject>/gi, '')
        .replace(/\son\w+="[^"]*"/gi, '')
        .replace(/\son\w+='[^']*'/gi, '')
        .replace(/javascript:/gi, '');
}

/**
 * Sanitizes a filename to prevent path traversal and remove potentially dangerous characters.
 *
 * @param {string} name - The requested filename.
 * @param {string} fallback - The fallback name if the sanitized name is empty.
 * @returns {string} The sanitized filename.
 */
export function sanitizeFilename(name, fallback = 'orgvisualizr-chart') {
    if (!name) return fallback;
    const safeName = name.replace(/[^a-zA-Z0-9_\-\säöüßÄÖÜ]/g, '_').trim();
    return safeName || fallback;
}

/**
 * Truncates a string to `max` characters, appending an ellipsis if it was cut.
 *
 * @param {string} str - The string to truncate.
 * @param {number} max - Maximum length before truncation (ellipsis included).
 * @returns {string} The (possibly truncated) string.
 */
export function truncateText(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/**
 * Derives up to two initials from a person's display name, for use in the avatar circle.
 *
 * @param {string} name - The full display name.
 * @returns {string} One or two uppercase initial characters.
 */
export function getInitials(name) {
    if (!name) return '?';
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Triggers a file download in the browser by generating an ephemeral anchor link.
 *
 * @param {string|Blob|ArrayBuffer} content - The content to be downloaded.
 * @param {string} mime - The MIME type of the file.
 * @param {string} filename - The target filename.
 */
export function downloadBlob(content, mime, filename) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');

    downloadLink.href = url;
    downloadLink.download = filename;
    document.body.appendChild(downloadLink);
    downloadLink.click();

    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(url);
}
