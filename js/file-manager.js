import { downloadBlob, sanitizeSvg, sanitizeFilename } from './utils.js';

export const fileManagerActions = {
    /**
     * Loads the index of saved files from localStorage.
     */
    loadIndex() {
        try {
            const index = localStorage.getItem('orgvisualizr_index');
            if (index) {
                this.savedFiles = JSON.parse(index);
            }
        } catch (e) { console.warn('loadIndex failed:', e); }
    },

    /**
     * Saves the current index of files to localStorage.
     */
    saveIndex() {
        try {
            localStorage.setItem('orgvisualizr_index', JSON.stringify(this.savedFiles));
        } catch (e) {
            console.error('Failed to save index:', e);
        }
    },

    /**
     * Deletes a saved chart from localStorage after confirmation (ADR-005).
     * If the deleted file was the currently-loaded one, only the "loaded from"
     * association is cleared — the chart currently on screen is left alone, since
     * deleting the saved copy shouldn't also wipe out unsaved work in progress.
     * @param {string} name - The saved chart name to delete.
     */
    async deleteFile(name) {
        const ok = await this.dialogConfirm(i18next.t('js.confirmDeleteFile', { name }), i18next.t('js.confirmTitle'));
        if (!ok) return;

        try {
            localStorage.removeItem('orgvisualizr_file_' + name);
        } catch (e) {
            console.error('Failed to delete file:', e);
        }
        this.savedFiles = this.savedFiles.filter((n) => n !== name);
        this.saveIndex();
        if (this.currentFileName === name) {
            this.currentFileName = '';
        }
    },

    /**
     * Loads a specific file by name from localStorage.
     * @param {string} name - The name of the file to load.
     */
    async loadFile(name) {
        if (!name) return;
        try {
            const dataStr = localStorage.getItem('orgvisualizr_file_' + name);
            if (dataStr) {
                this.rawJson = dataStr;
                this.updateFromJson();
                this.currentFileName = name;
            }
        } catch (e) {
            await this.dialogAlert(i18next.t('js.loadFileError') + e.message, i18next.t('js.errorTitle'));
        }
    },

    /**
     * Saves the current data to localStorage under the current file name.
     * Prompts for a new name if no file is currently selected.
     */
    async saveFile() {
        if (!this.currentFileName) {
            return await this.saveAsNew();
        }
        this.rawJson = JSON.stringify(this.data, null, 2);
        try {
            localStorage.setItem('orgvisualizr_file_' + this.currentFileName, this.rawJson);
            await this.dialogAlert(i18next.t('js.savedSuccess', { name: this.currentFileName }), i18next.t('js.savedTitle'));
        } catch (e) {
            console.error('Failed to save file:', e);
            await this.dialogAlert(i18next.t('js.saveError') + e.message, i18next.t('js.errorTitle'));
        }
    },

    /**
     * Prompts the user for a new name and saves the current data as a new file.
     */
    async saveAsNew() {
        const name = await this.dialogPrompt(
            i18next.t('js.promptNewName'),
            i18next.t('js.defaultNewName'),
            i18next.t('js.defaultNewTitle')
        );
        if (name === null) return;
        const trimmed = (name || '').trim();
        if (!trimmed) return;
        if (this.savedFiles.includes(trimmed)) {
            const ok = await this.dialogConfirm(
                i18next.t('js.confirmOverwrite'),
                i18next.t('js.overwriteTitle')
            );
            if (!ok) return;
        } else {
            this.savedFiles.push(trimmed);
            this.saveIndex();
        }
        this.currentFileName = trimmed;
        await this.saveFile();
    },

    /**
     * Creates a new, empty org chart with a single root node.
     */
    createNew() {
        this.currentFileName = '';
        this.editorVisible = true;
        const rootId = this.generateId('node');
        this.data = {
            meta: { title: i18next.t('js.defaultNewTitle'), organization: '' },
            nodes: [
                { id: rootId, parentId: null, name: i18next.t('js.defaultNewNodeName'), title: '', department: '', color: this.deptPalette[0] }
            ]
        };
        this.rawJson = JSON.stringify(this.data, null, 2);
        this.renderChart(this.data);
    },

    /**
     * Handles importing JSON data from a selected or dropped file.
     * Includes a 5MB size limit security check.
     * @param {File} file - The file object to read.
     */
    importJsonFromFile(file) {
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            if (this.dialogAlert) {
                this.dialogAlert(i18next.t('js.importFileTooLarge'), i18next.t('js.errorTitle'));
            } else {
                alert(i18next.t('js.importFileTooLarge'));
            }
            return;
        }

        const reader = new FileReader();
        reader.onerror = (err) => console.error('FileReader error:', err);
        reader.onload = (e) => {
            this.rawJson = e.target.result;
            this.updateFromJson();
            this.currentFileName = '';
            this.importModalOpen = false;
        };
        reader.readAsText(file);
    },

    /**
     * Handles the file input change event for importing.
     * @param {Event} event - The DOM change event.
     */
    handleImportFileInput(event) {
        const file = event.target.files[0];
        if (file) this.importJsonFromFile(file);
        event.target.value = '';
    },

    /**
     * Handles the drag-and-drop event for importing JSON files.
     * @param {DragEvent} event - The DOM drop event.
     */
    importDropHandler(event) {
        event.preventDefault();
        this.importDropActive = false;
        const file = event.dataTransfer.files[0];
        if (file) this.importJsonFromFile(file);
    },

    /**
     * Triggers an import from the provided URL.
     */
    async importFromUrl() {
        const url = this.importUrl.trim();
        if (!url) return;
        const ok = await this.loadFromRemoteSource(url);
        if (ok) {
            this.importModalOpen = false;
            this.importUrl = '';
        }
    },

    /**
     * Loads the default example dataset (data/example.json).
     */
    async loadInitialData() {
        try {
            // no-store: this file ships with the app and can change between deployments;
            // python's http.server sends no Cache-Control, so a plain reload can silently
            // reuse a stale HTTP-cached copy from before such a change without this.
            const response = await fetch('data/example.json', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            this.rawJson = await response.text();
            this.updateFromJson();
        } catch (error) {
            console.error('Failed to initialize OrgVisualizr:', error);
        }
    },

    /**
     * Attempts to load JSON data from a remote URL.
     * Prevents XSS, checks protocol, timeouts, and enforces size limits.
     * @param {string} url - The external JSON URL to fetch.
     * @returns {boolean} True if loading succeeded, false otherwise.
     */
    async loadFromRemoteSource(url) {
        this.jsonError = '';
        if (!url || typeof url !== 'string' || (!url.startsWith('https://') && !url.startsWith('http://'))) {
            this.jsonError = i18next.t('js.remoteLoadFailedPrefix');
            return false;
        }
        if (url.length > 2000) {
            this.jsonError = i18next.t('js.remoteLoadFailedTooLong');
            return false;
        }
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) {
                this.jsonError = i18next.t('js.remoteLoadFailedHttp', { status: response.status });
                return false;
            }

            const contentLength = response.headers.get('content-length');
            if (contentLength && parseInt(contentLength, 10) > 5 * 1024 * 1024) {
                this.jsonError = i18next.t('js.remoteLoadFailedTooLarge');
                return false;
            }

            this.rawJson = await response.text();

            if (this.rawJson.length > 5 * 1024 * 1024) {
                this.jsonError = i18next.t('js.remoteLoadFailedContentTooLarge');
                this.rawJson = '';
                return false;
            }

            this.currentFileName = '';
            this.updateFromJson();
            return true;
        } catch (e) {
            this.jsonError = i18next.t('js.remoteLoadFailedOther') + (e.name === 'AbortError' ? i18next.t('js.remoteLoadFailedTimeout') : e.message);
            return false;
        }
    },

    /**
     * Clones the live chart SVG and bakes the currently active theme's resolved
     * colors into every element that normally gets its color from an external CSS
     * custom property (card fill/stroke, name/title/department text, connectors).
     *
     * Exported SVG/PNG/PDF files have no access to css/orgvisualizr.css or its
     * `:root`/`:root[data-theme="light"]` variables — a standalone SVG file, a
     * canvas <img> load, and svg2pdf.js all render without that stylesheet. Without
     * this, those elements fall back to the SVG default fill (black), which is
     * invisible against the (also unstyled, black) card behind it — text only became
     * visible when text-selected because the browser's selection highlight showed
     * through. Reading the variables via getComputedStyle at export time (rather than
     * hardcoding a palette) is also what makes the export follow whichever theme,
     * light or dark, is active on screen right now.
     * @returns {SVGElement} A detached, export-ready clone of the live chart SVG.
     */
    _prepareExportSvg() {
        const svgElement = window.app.renderer.svgElement;
        if (!svgElement) return null;

        const clone = svgElement.cloneNode(true);
        const themeVars = getComputedStyle(document.documentElement);
        const v = (name) => themeVars.getPropertyValue(name).trim();

        const viewBox = clone.getAttribute('viewBox').split(/\s+/).map(Number);
        // Explicit pixel size instead of the inherited width="100%" height="100%" —
        // those percentages only make sense inside a sized container, which an
        // exported file or an off-screen-attached clone (for PDF export) doesn't have.
        clone.setAttribute('width', viewBox[2]);
        clone.setAttribute('height', viewBox[3]);

        // A standalone SVG file or a PNG's <img> load has no access to the app's
        // `body { font-family: ... }` CSS rule either, so without this every text
        // element falls back to whatever default font the viewer/OS happens to use.
        clone.querySelectorAll('text').forEach((el) => el.setAttribute('font-family', v('--font-family')));

        const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('x', viewBox[0]);
        bgRect.setAttribute('y', viewBox[1]);
        bgRect.setAttribute('width', viewBox[2]);
        bgRect.setAttribute('height', viewBox[3]);
        bgRect.setAttribute('fill', v('--bg-color'));
        clone.insertBefore(bgRect, clone.firstChild);

        clone.querySelectorAll('.org-card').forEach((el) => {
            el.setAttribute('fill', v('--card-bg'));
            el.setAttribute('stroke', v('--card-stroke'));
        });
        clone.querySelectorAll('.org-card-name').forEach((el) => el.setAttribute('fill', v('--text-strong')));
        clone.querySelectorAll('.org-card-title').forEach((el) => el.setAttribute('fill', v('--text-muted')));
        clone.querySelectorAll('.org-card-department').forEach((el) => el.setAttribute('fill', v('--dept-text')));
        clone.querySelectorAll('.org-link').forEach((el) => {
            el.setAttribute('fill', 'none');
            el.setAttribute('stroke', v('--link-stroke'));
            el.setAttribute('stroke-width', '2');
        });
        // After the base .org-link pass above, so the staff-specific stroke/dash wins
        // for links that carry both classes — same override order as the CSS itself.
        clone.querySelectorAll('.org-link--staff').forEach((el) => {
            el.setAttribute('stroke', v('--link-stroke-staff'));
            el.setAttribute('stroke-width', '1.5');
            el.setAttribute('stroke-dasharray', '5 4');
        });

        // Sections view (see sections-renderer.js): the root-to-section connector
        // uses the same themed stroke as .org-link, so it needs the same baking.
        clone.querySelectorAll('.section-link').forEach((el) => {
            el.setAttribute('fill', 'none');
            el.setAttribute('stroke', v('--link-stroke'));
            el.setAttribute('stroke-width', '2');
        });
        // section-rect/title, group-rect/title, and lead-name/title are NOT baked
        // here, unlike the tree-view classes above — their fill/stroke is each
        // section's own lead's color (and a matching contrast color), already set
        // inline by sections-renderer.js itself, not a theme default this function
        // would know how to reconstruct.

        return clone;
    },

    /**
     * Serializes the current SVG element into a data URL.
     * @returns {string|null} The data URL of the SVG, or null if it fails.
     */
    _getSvgDataUrl() {
        const exportSvg = this._prepareExportSvg();
        if (!exportSvg) return null;

        try {
            const serializer = new XMLSerializer();
            let source = serializer.serializeToString(exportSvg);

            if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
                source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
            }
            if (!source.match(/^<svg[^>]+"http\:\/\/www\.w3\.org\/1999\/xlink"/)) {
                source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
            }

            source = sanitizeSvg(source);
            source = '<?xml version="1.0" standalone="no"?>\r\n' + source;

            return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
        } catch (e) {
            console.error('SVG serialization error:', e);
            return null;
        }
    },

    /**
     * Exports the current chart view as an SVG file.
     */
    exportSVG() {
        const svgUrl = this._getSvgDataUrl();
        if (!svgUrl) return;

        try {
            const source = decodeURIComponent(svgUrl.split(',')[1]);
            const filename = sanitizeFilename(this.currentFileName) + '.svg';
            downloadBlob(source, 'image/svg+xml;charset=utf-8;', filename);
        } catch (e) {
            console.error('SVG export error:', e);
        }
    },

    /**
     * Exports the current chart view as a high-resolution PNG file.
     */
    exportPNG() {
        const svgUrl = this._getSvgDataUrl();
        if (!svgUrl) return;
        const svgElement = window.app.renderer.svgElement;
        const width = svgElement.viewBox.baseVal.width;
        const height = svgElement.viewBox.baseVal.height;

        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const scale = 4;
            canvas.width = width * scale;
            canvas.height = height * scale;
            const ctx = canvas.getContext('2d');
            ctx.scale(scale, scale);
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob((blob) => {
                const filename = sanitizeFilename(this.currentFileName) + '.png';
                downloadBlob(blob, 'image/png', filename);
            }, 'image/png');
        };
        img.onerror = () => {
            console.error('PNG render error.');
            this.dialogAlert(i18next.t('js.pngExportError'), i18next.t('js.errorTitle'));
        };
        img.src = svgUrl;
    },

    /**
     * Exports the current chart view as a PDF file.
     * Requires jsPDF and svg2pdf libraries to be loaded globally.
     */
    async exportPDF() {
        const svgElement = window.app.renderer.svgElement;
        if (!svgElement) return;

        const width = svgElement.viewBox.baseVal.width;
        const height = svgElement.viewBox.baseVal.height;

        if (typeof window !== 'undefined' && window.jspdf && window.jspdf.jsPDF && window.svg2pdf) {
            const exportSvg = this._prepareExportSvg();
            // svg2pdf measures text (getBBox/getComputedTextLength), which needs the
            // element to actually be part of the rendered document — attach it
            // off-screen for the duration of the export, then remove it again.
            exportSvg.style.position = 'absolute';
            exportSvg.style.left = '-99999px';
            exportSvg.style.top = '0';
            document.body.appendChild(exportSvg);

            const pdf = new window.jspdf.jsPDF({
                orientation: width > height ? 'landscape' : 'portrait',
                unit: 'pt',
                format: [width, height]
            });

            try {
                await pdf.svg(exportSvg, { x: 0, y: 0, width, height });
                const filename = sanitizeFilename(this.currentFileName) + '.pdf';
                pdf.save(filename);
            } catch (err) {
                console.error('SVG-to-PDF export error:', err);
                this.dialogAlert(i18next.t('js.pdfExportError') + err.message, i18next.t('js.errorTitle'));
            } finally {
                exportSvg.remove();
            }
        } else {
            console.error('jsPDF or svg2pdf library not found.');
            this.dialogAlert(i18next.t('js.pdfExportErrorLibs'), i18next.t('js.errorTitle'));
        }
    },

    /**
     * Exports the raw JSON representation of the current org chart.
     */
    exportJSON() {
        if (!this.rawJson) return;
        const filename = sanitizeFilename(this.currentFileName) + '.json';
        downloadBlob(this.rawJson, 'application/json;charset=utf-8;', filename);
    }
};
