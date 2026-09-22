// -----------------------------------------------------------------------
// LocalStorage Save/Load Adapter
// This ensures all user drawings and layouts are saved directly in their browser.
// -----------------------------------------------------------------------
// -----------------------------------------------------------------------
// Official IExternalSaveLoadAdapter Implementation
// Complies strictly with TradingView Advanced Charts Documentation
// -----------------------------------------------------------------------

const STORAGE_PREFIX = 'tv_';

function safeGet(key, defaultValue = '[]') {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_PREFIX + key) || defaultValue);
    } catch (e) {
        console.warn(`[SaveLoadAdapter] Corrupt cache for ${key}, resetting.`);
        return JSON.parse(defaultValue);
    }
}

function safeSet(key, value) {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
}

const localSaveLoadAdapter = {
    // ==========================================================
    // CHARTS
    // ==========================================================
    getAllCharts: function() {
        return new Promise((resolve) => {
            const charts = safeGet('charts');
            const urlParams = new URLSearchParams(window.location.search);
            const urlLayoutId = urlParams.get('layout');

            const metaInfo = charts.map(c => {
                let ts = c.timestamp;
                // Native Multi-Tab Hook: If the URL explicitly requests this layout,
                // temporarily spoof its timestamp to be the newest so `load_last_chart`
                // naturally picks it during the boot sequence without any manual hack!
                if (urlLayoutId && String(c.id) === String(urlLayoutId)) {
                    ts = Math.floor(Date.now() / 1000) + 1000000;
                }
                
                return {
                    id: c.id,
                    name: c.name,
                    symbol: c.symbol,
                    resolution: c.resolution,
                    timestamp: ts
                };
            });
            resolve(metaInfo);
        });
    },

    removeChart: function(id) {
        return new Promise((resolve) => {
            let charts = safeGet('charts');
            charts = charts.filter(c => String(c.id) !== String(id));
            safeSet('charts', charts);
            resolve();
        });
    },

    saveChart: function(chartData) {
        return new Promise((resolve) => {
            // Intelligent ID Generation
            if (!chartData.id) {
                // If it doesn't have a name, it's the universal "Unnamed" draft
                if (!chartData.name || chartData.name.trim() === '' || chartData.name === 'Unnamed') {
                    chartData.id = 'default_unnamed';
                    chartData.name = 'Unnamed';
                } else {
                    // User explicitly clicked "Save As" and typed a real name
                    chartData.id = Math.random().toString(36).substring(2, 15);
                }
            }
            
            chartData.timestamp = Math.floor(Date.now() / 1000);
            
            let charts = safeGet('charts');
            const existingIndex = charts.findIndex(c => String(c.id) === String(chartData.id));
            
            if (existingIndex > -1) {
                charts[existingIndex] = chartData;
            } else {
                charts.push(chartData);
            }
            
            safeSet('charts', charts);
            
            // Seamless Multi-Tab Sync: Update URL with layout ID
            const currentUrl = new URL(window.location.href);
            if (currentUrl.searchParams.get('layout') !== String(chartData.id)) {
                currentUrl.searchParams.set('layout', chartData.id);
                window.history.replaceState({}, '', currentUrl);
            }
            
            resolve(chartData.id);
        });
    },

    getChartContent: function(chartId) {
        return new Promise((resolve) => {
            const charts = safeGet('charts');
            const chart = charts.find(c => String(c.id) === String(chartId));
            resolve(chart ? chart.content : null);
        });
    },

    // ==========================================================
    // STUDY TEMPLATES
    // ==========================================================
    getAllStudyTemplates: function() {
        return new Promise((resolve) => {
            const templates = safeGet('study_templates');
            const metaInfo = templates.map(t => ({ name: t.name }));
            resolve(metaInfo);
        });
    },

    removeStudyTemplate: function(studyTemplateInfo) {
        return new Promise((resolve) => {
            let templates = safeGet('study_templates');
            templates = templates.filter(t => t.name !== studyTemplateInfo.name);
            safeSet('study_templates', templates);
            resolve();
        });
    },

    saveStudyTemplate: function(studyTemplateData) {
        return new Promise((resolve) => {
            let templates = safeGet('study_templates');
            const existingIndex = templates.findIndex(t => t.name === studyTemplateData.name);
            if (existingIndex > -1) {
                templates[existingIndex] = studyTemplateData;
            } else {
                templates.push(studyTemplateData);
            }
            safeSet('study_templates', templates);
            resolve();
        });
    },

    getStudyTemplateContent: function(studyTemplateInfo) {
        return new Promise((resolve) => {
            const templates = safeGet('study_templates');
            const template = templates.find(t => t.name === studyTemplateInfo.name);
            resolve(template ? template.content : null);
        });
    },

    // ==========================================================
    // DRAWING TEMPLATES
    // ==========================================================
    getDrawingTemplates: function(toolName) {
        return new Promise((resolve) => {
            const templates = [];
            const prefix = STORAGE_PREFIX + `drawing_${toolName}_`;
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith(prefix)) {
                    templates.push(key.replace(prefix, ''));
                }
            }
            resolve(templates);
        });
    },

    loadDrawingTemplate: function(toolName, templateName) {
        return new Promise((resolve) => {
            const key = STORAGE_PREFIX + `drawing_${toolName}_${templateName}`;
            const content = localStorage.getItem(key);
            resolve(content);
        });
    },

    saveDrawingTemplate: function(toolName, templateName, content) {
        return new Promise((resolve) => {
            const key = STORAGE_PREFIX + `drawing_${toolName}_${templateName}`;
            localStorage.setItem(key, content);
            resolve();
        });
    },

    removeDrawingTemplate: function(toolName, templateName) {
        return new Promise((resolve) => {
            const key = STORAGE_PREFIX + `drawing_${toolName}_${templateName}`;
            localStorage.removeItem(key);
            resolve();
        });
    }
};

// -----------------------------------------------------------------------
// Widget Initialization
// -----------------------------------------------------------------------
function bootWidget() {
    // 1. Read Multi-Tab URL Parameters
    const urlParams = new URLSearchParams(window.location.search);
    const urlSymbol = urlParams.get('symbol') || 'NIFTY50-INDEX';
    const urlInterval = urlParams.get('interval') || '1D';
    const urlLayoutId = urlParams.get('layout');

    // 2. Safely clean up any completely corrupted caches from previous crashes
    try {
        const charts = safeGet('charts');
        if (charts.length > 0 && typeof charts[0].content !== 'string') {
            localStorage.removeItem(STORAGE_PREFIX + 'charts');
        }
    } catch (e) {}

    const widgetOptions = {
        // Only set default symbol/interval if we are NOT loading an explicit layout
        // Otherwise, native load_last_chart will fail to restore the saved ticker!
        symbol: urlLayoutId ? undefined : urlSymbol,
        interval: urlLayoutId ? undefined : urlInterval,
        container: 'tv_chart_container',
        library_path: 'chart_engine/',
        datafeed: Datafeed,
        save_load_adapter: localSaveLoadAdapter,
        locale: 'en',
        theme: 'Light',
        autosize: true,
        debug: true,
        
        // Let the engine natively pull the chart from the adapter without manual JSON parsing!
        load_last_chart: true,
        auto_save_delay: 5,
        
        overrides: {
            "paneProperties.background": "#ffffff",
            "paneProperties.backgroundType": "solid",
            "paneProperties.vertGridProperties.color": "#f0f3fa",
            "paneProperties.horzGridProperties.color": "#f0f3fa",
            "scalesProperties.textColor": "#131722",
            "scalesProperties.lineColor": "#D1D4DC"
        },
        
        enabled_features: [
            "seconds_resolution",
            "study_templates",
            "use_localstorage_for_settings",
            "save_chart_properties_to_local_storage",
            "items_favoriting",
            "header_widget",
            "header_chart_type",
            "header_compare",
            "header_fullscreen_button",
            "header_indicators",
            "header_resolutions",
            "header_saveload",
            "header_screenshot",
            "header_settings",
            "header_symbol_search",
            "header_undo_redo",
            "left_toolbar",
            "timeframes_toolbar",
            "control_bar",
            "display_market_status",
            
            // God Mode: Right Toolbar & Sidebar
            "right_toolbar",
            "show_object_tree",
            "show_right_widgets_panel_by_default",
            "right_bar_stays_on_scroll",
            
            // God Mode: Advanced Visuals
            "show_chart_property_page",
            "show_symbol_logos",
            "show_exchange_logos",
            "show_symbol_logo_in_legend",
            "header_symbol_search"
        ],
        disabled_features: []
    };

    const widget = new TradingView.widget(widgetOptions);
    window.tvWidget = widget;

    widget.chartReady().then(() => {
        console.log("[App] Chart is fully ready and fluid.");
        
        window.tvWidget.headerReady().then(function() {
            // Wait for iframe DOM
            const iframe = document.querySelector('iframe[id^="tradingview_"]');
            if (!iframe) return;
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            
            let attempts = 0;
            const checkReady = setInterval(() => {
                attempts++;
                
                // Native TV desktop indicators button
                let targetEl = iframeDoc.getElementById('header-toolbar-indicators');
                
                // Mobile fallbacks
                if (!targetEl) targetEl = iframeDoc.getElementById('header-toolbar-symbol-search');
                if (!targetEl) targetEl = iframeDoc.querySelector('.group-wWM3zP_M');
                if (!targetEl) targetEl = iframeDoc.querySelector('.group-MBOVGQRI');
                
                if (targetEl || attempts > 10) {
                    clearInterval(checkReady);
                    
                    if (!targetEl) {
                        // Ultimate fallback using API
                        const fb = window.tvWidget.createButton();
                        fb.innerHTML = '<div style="color: #2962FF; font-weight: bold;">Option Chain</div>';
                        fb.addEventListener('click', () => { if (window.openOptionsChainModal) window.openOptionsChainModal(); });
                        return;
                    }
                    
                    const ocBtnHtml = `
                        <div class="group-MBOVGQRI" id="header-toolbar-option-chain" style="margin: 0 4px;">
                            <button aria-label="Options Chain" data-role="button" data-tooltip-hotkey='{"keys":["O"],"text":"{0}"}' data-tooltip="Options Chain" tabindex="-1" type="button" class="button-OhqNVIYA button-ptpAHg8E withText-ptpAHg8E button-GwQQdU8S apply-common-tooltip isInteractive-GwQQdU8S accessible-GwQQdU8S" id="btn-option-chain-real">
                                <span role="img" class="icon-GwQQdU8S" aria-hidden="true">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="none">
                                        <rect x="5.5" y="7.5" width="17" height="13" rx="1.5" stroke="currentColor" stroke-width="1.2"></rect>
                                        <path stroke="currentColor" stroke-width="1.2" d="M5.5 12.5h17M14 7.5v13"></path>
                                    </svg>
                                </span>
                                <div class="js-button-text text-GwQQdU8S">Option Chain</div>
                            </button>
                        </div>
                    `;
                    
                    targetEl.insertAdjacentHTML('afterend', ocBtnHtml);
                    
                    const realBtn = iframeDoc.getElementById('btn-option-chain-real');
                    if (realBtn) {
                        realBtn.addEventListener('click', () => {
                            if (window.openOptionsChainModal) window.openOptionsChainModal();
                        });
                        
                        // Override TV's internal tooltip listener since we injected raw HTML
                        realBtn.addEventListener('mouseenter', () => {
                            realBtn.setAttribute('title', 'Options Chain  O');
                        });
                        realBtn.addEventListener('mouseleave', () => {
                            realBtn.removeAttribute('title');
                        });
                    }
                }
            }, 500);
        });

        // GUARANTEED INITIAL SAVE: If the engine booted up without finding a valid saved layout,
        // it means this is a fresh chart. We instantly jumpstart the save engine to create the "Unnamed" ID.
        // We can detect this by checking if the adapter fed the widget a valid layout ID during boot.
        const charts = safeGet('charts');
        const isBrandNew = charts.length === 0 || (!urlLayoutId && charts.length > 0 && !widgetOptions.load_last_chart); // actually load_last_chart is true, so if charts.length > 0 it loaded ONE.
        
        // A better check: wait 500ms and see if the URL updated to a layout ID, 
        // but actually if charts.length === 0, we definitively know it's brand new.
        if (charts.length === 0) {
            widget.saveChartToServer({ chartName: 'Unnamed' });
        }

        // GUARANTEED AUTOSAVE: Explicitly hook the library's internal dirty state to force the save immediately!
        widget.subscribe('onAutoSaveNeeded', () => {
            console.log("[App] Engine detected changes. Forcing auto-save...");
            widget.saveChartToServer();
        });

        const activeChart = widget.activeChart();

        // 3. Force URL overrides if they differ from the loaded layout memory
        const currentSymbol = activeChart.symbol();
        const currentInterval = activeChart.resolution();
        
        if (urlParams.has('symbol') && currentSymbol !== urlSymbol) {
            activeChart.setSymbol(urlSymbol, () => {});
        } else if (currentSymbol === 'BTC/USD' || currentSymbol === 'XAUUSD') {
            // Force break out of old crypto memory if url has no symbol
            activeChart.setSymbol('NIFTY50-INDEX', () => {});
        }
        if (urlParams.has('interval') && currentInterval !== urlInterval) {
            activeChart.setResolution(urlInterval, () => {});
        }

        // 4. Bind URL synchronization
        const updateUrl = () => {
            const currentUrl = new URL(window.location.href);
            currentUrl.searchParams.set('symbol', activeChart.symbol());
            currentUrl.searchParams.set('interval', activeChart.resolution());
            window.history.replaceState({}, '', currentUrl);
        };

        activeChart.onSymbolChanged().subscribe(null, updateUrl);
        activeChart.onIntervalChanged().subscribe(null, updateUrl);
        
        // Push initial state
        updateUrl();
    });
}

window.onload = function() {
    if (window.db) {
        bootWidget();
    } else {
        console.log("Waiting for DuckDB-WASM...");
        window.addEventListener('DuckDBReady', bootWidget);
    }
};
