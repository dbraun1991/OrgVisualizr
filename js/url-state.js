/**
 * URL parameter handling for view state (editor visibility, saved file, language, remote source).
 *
 * Node collapse state lives on each node object (`collapsed: true`) and therefore
 * travels with the JSON payload itself — no separate URL-encoded state is needed for it.
 */
export const urlStateActions = {
    /**
     * Parses URL query parameters and updates the application state accordingly.
     */
    parseUrlParams() {
        const params = new URLSearchParams(window.location.search);

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
    }
};
