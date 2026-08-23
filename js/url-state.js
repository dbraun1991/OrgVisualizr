/**
 * URL parameter handling and LZ-string compressed share links.
 *
 * Unlike MetroViz's zone-collapse bitmask, node collapse state here already
 * lives on each node object (`collapsed: true`) and therefore travels with
 * the JSON payload itself — no separate URL-encoded state is needed for it.
 */
export const urlStateActions = {
    /**
     * Parses URL query parameters and updates the application state accordingly.
     */
    parseUrlParams() {
        const params = new URLSearchParams(window.location.search);

        this._urlHadData = false;
        this._urlSource = null;

        if (params.has('editor')) {
            this.editorVisible = params.get('editor') === '1' || params.get('editor') === 'true';
        }

        if (params.has('file')) {
            const f = params.get('file');
            if (this.savedFiles.includes(f)) {
                this.currentFileName = f;
            }
        }

        if (params.has('data') && typeof window.LZString !== 'undefined') {
            const decompressed = window.LZString.decompressFromEncodedURIComponent(params.get('data'));
            if (decompressed) {
                this.rawJson = decompressed;
                this.currentFileName = '';
                this._urlHadData = true;
            }
        }

        const sourceParam = params.get('source');
        if (sourceParam && sourceParam.trim()) {
            this._urlSource = sourceParam.trim();
        }
    },

    /**
     * Updates the browser's URL query parameters to reflect the current application state.
     */
    updateUrlParams() {
        const url = new URL(window.location);
        url.searchParams.delete('data');
        url.searchParams.delete('source');
        url.searchParams.set('editor', this.editorVisible ? '1' : '0');

        if (window.Alpine && window.Alpine.store('i18n')) {
            url.searchParams.set('lang', window.Alpine.store('i18n').locale);
        }

        if (this.currentFileName) {
            url.searchParams.set('file', this.currentFileName);
        } else {
            url.searchParams.delete('file');
        }

        window.history.replaceState({}, '', url);
    },

    /**
     * Generates a compressed shareable URL containing the current JSON data,
     * then copies it to the user's clipboard.
     */
    async generateShareLink() {
        if (typeof window.LZString === 'undefined') {
            await this.dialogAlert(i18next.t('js.shareUnavailable'), i18next.t('header.share'));
            return;
        }
        if (!this.rawJson || !this.rawJson.trim()) {
            await this.dialogAlert(i18next.t('js.shareNoData'), i18next.t('header.share'));
            return;
        }
        let langStr = '';
        if (window.Alpine && window.Alpine.store('i18n')) {
            langStr = '&lang=' + window.Alpine.store('i18n').locale;
        }
        const compressed = window.LZString.compressToEncodedURIComponent(this.rawJson);
        const shareUrl = window.location.origin + window.location.pathname + '?' + langStr.replace(/^&/, '') + '&data=' + compressed;
        try {
            await navigator.clipboard.writeText(shareUrl);
            await this.dialogAlert(i18next.t('js.shareLinkCopied'), i18next.t('header.share'));
        } catch {
            await this.dialogAlert(i18next.t('js.shareCopyFailed'), i18next.t('header.share'));
        }
    }
};
