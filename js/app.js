import { DataModel } from './data-model.js';
import { LayoutEngine } from './layout-engine.js';
import { ChartRenderer } from './chart-renderer.js';

import { sortPaletteRainbow, DEPARTMENT_PALETTE_BASE } from './color-utils.js';
import { dialogActions } from './dialog.js';
import { urlStateActions } from './url-state.js';
import { fileManagerActions } from './file-manager.js';
import { editorActions } from './editor-actions.js';
import { textExportActions } from './text-export.js';

const urlParams = new URLSearchParams(window.location.search);
const langParam = urlParams.get('lang');

const i18nPromise = i18next
    .use(i18nextHttpBackend)
    .use(i18nextBrowserLanguageDetector)
    .init({
        lng: langParam || undefined,
        fallbackLng: 'en',
        backend: {
            loadPath: 'locales/{{lng}}/translation.json'
        }
    }).then(() => {
        document.documentElement.lang = i18next.resolvedLanguage;
        if (window.Alpine && window.Alpine.store('i18n')) {
            window.Alpine.store('i18n').locale = i18next.resolvedLanguage;
            window.Alpine.store('i18n').loaded = true;
        }
    });

document.addEventListener('alpine:init', () => {
    Alpine.store('i18n', {
        locale: i18next.resolvedLanguage || 'en',
        loaded: false,
        t(key, opts) {
            const trigger = this.locale;
            const trigger2 = this.loaded;
            return i18next.t(key, opts);
        },
        async changeLanguage(lang) {
            await i18next.changeLanguage(lang);
            this.locale = i18next.resolvedLanguage;
            document.documentElement.lang = this.locale;
            window.dispatchEvent(new Event('language-changed'));
        }
    });
});

/**
 * Main Application Controller handling state, UI interactions, and visualization updates.
 */
class App {
    constructor() {
        this.dataModel = new DataModel();
        this.layoutEngine = new LayoutEngine();
        this.renderer = new ChartRenderer('#orgvisualizr-container');

        this.initAlpine();
        this.setupEventListeners();
    }

    /**
     * Initializes Alpine.js, defining global data and watching for state changes.
     */
    initAlpine() {
        document.addEventListener('alpine:init', () => {
            const objKeys = new WeakMap();
            let nextObjKey = 1;

            Alpine.data('orgVisualizrApp', () => ({
                editorVisible: false,
                activeTab: 'visual',
                theme: 'dark',
                hideLeaves: false,
                manageMode: false,
                rawJson: '',
                jsonError: '',
                savedFiles: [],
                currentFileName: '',
                importModalOpen: false,
                importUrl: '',
                importDropActive: false,
                manageFilesModalOpen: false,
                dialogOpen: false,
                dialogMode: 'alert',
                dialogTitle: '',
                dialogMessage: '',
                dialogInput: '',
                _dialogResolve: null,
                /** Department color palette, sorted by rainbow (HSV hue). */
                deptPalette: sortPaletteRainbow(DEPARTMENT_PALETTE_BASE),

                data: {
                    meta: { title: '', organization: '' },
                    nodes: []
                },

                // Spread modules
                ...dialogActions,
                ...urlStateActions,
                ...fileManagerActions,
                ...editorActions,
                ...textExportActions,

                /**
                 * Returns a stable render key for mutable editor objects.
                 * Keeps Alpine from recreating DOM nodes when editable IDs change.
                 */
                getObjKey(obj) {
                    if (!obj || typeof obj !== 'object') return String(obj);
                    if (!objKeys.has(obj)) objKeys.set(obj, `obj-${nextObjKey++}`);
                    return objKeys.get(obj);
                },

                async init() {
                    await i18nPromise;

                    // The inline script in <head> already set this attribute pre-paint
                    // (avoids a flash of the wrong theme); just mirror it into state.
                    this.theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

                    this.loadIndex();
                    this.parseUrlParams();

                    let loaded = false;
                    if (this._urlHadData) {
                        this.updateFromJson();
                        loaded = true;
                    }
                    if (!loaded && this._urlSource) {
                        loaded = await this.loadFromRemoteSource(this._urlSource);
                    }
                    if (!loaded) {
                        if (this.currentFileName && this.savedFiles.includes(this.currentFileName)) {
                            this.loadFile(this.currentFileName);
                        } else if (this.savedFiles.length > 0) {
                            this.currentFileName = this.savedFiles[0];
                            this.loadFile(this.currentFileName);
                        } else {
                            await this.loadInitialData();
                        }
                    }

                    this.updateUrlParams();

                    this.$watch('editorVisible', () => this.updateUrlParams());
                    this.$watch('currentFileName', () => this.updateUrlParams());
                    this.$watch('hideLeaves', () => this.renderChart(this.data));

                    // Keep the raw JSON string and chart in sync whenever the visual editor
                    // mutates the underlying data object.
                    this.$watch('data', (value) => {
                        if (this.activeTab === 'visual') {
                            this.rawJson = JSON.stringify(value, null, 2);
                            this.renderChart(value);
                        }
                        this.updateUrlParams();
                    }, { deep: true });

                    // Keep the JSON tab strictly synchronized with memory data when switching tabs.
                    this.$watch('activeTab', (tab) => {
                        if (tab === 'json') {
                            this.rawJson = JSON.stringify(this.data, null, 2);
                        }
                    });

                    this.$watch('dialogOpen', (open) => {
                        if (!open) return;
                        this.$nextTick(() => {
                            if (this.dialogMode === 'prompt') {
                                const input = document.getElementById('dialog-prompt-input');
                                if (input) input.focus();
                            } else {
                                const btn = document.getElementById('dialog-ok-btn');
                                if (btn) btn.focus();
                            }
                        });
                    });

                    window.addEventListener('language-changed', () => {
                        this.updateUrlParams();
                        if (this.data && this.data.nodes) {
                            this.renderChart(this.data);
                        }
                    });
                },

                /**
                 * Toggles a node's collapsed state (called from the chart's click handler).
                 * @param {string} id - The node ID.
                 */
                onToggleNode(id) {
                    this.toggleCollapseById(id);
                },

                /**
                 * Flips light/dark theme, persists the choice, and applies it immediately.
                 */
                toggleTheme() {
                    this.theme = this.theme === 'dark' ? 'light' : 'dark';
                    document.documentElement.setAttribute('data-theme', this.theme);
                    try {
                        localStorage.setItem('orgvisualizr_theme', this.theme);
                    } catch (e) { /* private browsing / storage disabled — theme just won't persist */ }
                },

                /**
                 * Parses the raw JSON string into the Alpine data state and triggers a re-render.
                 */
                updateFromJson() {
                    try {
                        if (!this.rawJson.trim()) return;
                        const parsed = JSON.parse(this.rawJson);

                        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                            throw new Error(i18next.t('js.jsonRootMustBeObject'));
                        }

                        this.data = parsed; // Triggers the $watch above
                        this.renderChart(this.data);
                    } catch (error) {
                        this.jsonError = 'JSON Error: ' + error.message;
                    }
                },

                /**
                 * Re-validates, re-computes layout, and re-renders the D3 SVG.
                 * Surfaces validation failures via `jsonError` so an invalid edit in the
                 * JSON tab (e.g. a dangling parentId) is visible instead of silently
                 * leaving the previous chart on screen.
                 * @param {Object} jsonData - The internal state tree representing the org chart.
                 */
                renderChart(jsonData) {
                    try {
                        const clone = JSON.parse(JSON.stringify(jsonData));
                        const normalizedData = window.app.dataModel.validateAndNormalize(clone);
                        const layout = window.app.layoutEngine.calculate(normalizedData, { hideLeaves: this.hideLeaves });
                        window.app.renderer.render(layout);
                        this.jsonError = '';
                    } catch (e) {
                        console.error('Render error:', e);
                        this.jsonError = e.message;
                    }
                }
            }));
        });
    }

    /**
     * Sets up global event listeners, like drag-and-drop for JSON file uploads.
     */
    setupEventListeners() {
        const container = document.getElementById('orgvisualizr-container');
        if (!container) return;

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            container.style.opacity = '0.5';
        });

        container.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            container.style.opacity = '1';
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            container.style.opacity = '1';

            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                const file = e.dataTransfer.files[0];

                if (file.size > 5 * 1024 * 1024) {
                    alert(i18next.t('js.importFileTooLarge'));
                    return;
                }

                const reader = new FileReader();
                reader.onerror = (err) => console.error('FileReader error:', err);
                reader.onload = (event) => {
                    const editor = document.getElementById('json-editor');
                    if (editor) {
                        editor.value = event.target.result;
                        editor.dispatchEvent(new Event('input'));
                    }
                };
                reader.readAsText(file);
            }
        });
    }
}

window.app = new App();
