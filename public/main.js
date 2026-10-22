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
            const currentUrl = new URL(window.location.origin + window.location.pathname);
            const existing = new URLSearchParams(window.location.search);
            const sym = existing.get('symbol') || (window.tvWidget ? window.tvWidget.activeChart().symbol() : null);
            const intv = existing.get('interval') || (window.tvWidget ? window.tvWidget.activeChart().resolution() : null);
            if (sym) currentUrl.searchParams.set('symbol', sym);
            if (intv) currentUrl.searchParams.set('interval', intv);
            currentUrl.searchParams.set('layout', chartData.id);
            window.history.replaceState({}, '', currentUrl.toString());
            
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
    // 1. Read Multi-Tab URL Parameters (Clean & Robust Parsing)
    const search = window.location.search;
    const urlParams = new URLSearchParams(search);
    let urlSymbol = urlParams.get('symbol');
    let urlInterval = urlParams.get('interval');
    const urlLayoutId = urlParams.get('layout');

    // Handle any malformed legacy URL artifacts (e.g. "?v=5,symbol=...")
    if (!urlSymbol && search.includes('symbol=')) {
        const match = search.match(/symbol=([^&#,]+)/);
        if (match) urlSymbol = decodeURIComponent(match[1]);
    }
    if (!urlInterval && search.includes('interval=')) {
        const match = search.match(/interval=([^&#,]+)/);
        if (match) urlInterval = decodeURIComponent(match[1]);
    }
    urlSymbol = urlSymbol || 'NIFTY50-INDEX';
    urlInterval = urlInterval || '1D';

    // 2. Safely clean up any completely corrupted caches from previous crashes
    try {
        const charts = safeGet('charts');
        if (charts.length > 0 && typeof charts[0].content !== 'string') {
            localStorage.removeItem(STORAGE_PREFIX + 'charts');
        }
    } catch (e) {}

    const widgetOptions = {
        // Prioritize explicit URL symbol/interval over stale layout memory if provided
        symbol: (urlLayoutId && !urlParams.has('symbol') && !search.includes('symbol=')) ? undefined : urlSymbol,
        interval: (urlLayoutId && !urlParams.has('interval') && !search.includes('interval=')) ? undefined : urlInterval,
        container: 'tv_chart_container',
        library_path: 'chart_engine/',
        datafeed: Datafeed,
        save_load_adapter: localSaveLoadAdapter,
        locale: 'en',
        theme: 'Light',
        autosize: true,
        debug: true,
        
        custom_indicators_getter: function (PineJS) {
            return window.getCustomIndicators(PineJS);
        },
        
        // Let the engine natively pull the chart from the adapter without manual JSON parsing!
        load_last_chart: true,
        auto_save_delay: 5,
        symbol_search_request_delay: 100,
        
        overrides: {
            "paneProperties.background": "#ffffff",
            "paneProperties.backgroundType": "solid",
            "paneProperties.vertGridProperties.color": "#f0f3fa",
            "paneProperties.horzGridProperties.color": "#f0f3fa",
            "scalesProperties.textColor": "#131722",
            "scalesProperties.lineColor": "#D1D4DC",
            "tradingProperties.showPositions": true,
            "tradingProperties.showOrders": true,
            "tradingProperties.positionPL.visibility": true,
            "tradingProperties.bracketsPL.visibility": true,
            "tradingProperties.positionAndBracketsPL": true,
            "tradingProperties.showReverse": false,
            "tradingProperties.extendLeft": true
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
            // "header_indicators", // Disabled to use our custom dual-tab UI
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
    
    // Set up our custom two-tab Indicators dialog
    if (typeof setupCustomIndicatorsDialog === 'function') {
        setupCustomIndicatorsDialog(widget);
    }

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
                
                // Target the symbol search box first (for both mobile and desktop)
                let targetEl = iframeDoc.getElementById('header-toolbar-symbol-search');
                
                // Fallbacks
                if (!targetEl) targetEl = iframeDoc.getElementById('header-toolbar-indicators');
                if (!targetEl) targetEl = iframeDoc.querySelector('.group-wWM3zP_M');
                if (!targetEl) targetEl = iframeDoc.querySelector('.group-MBOVGQRI');
                
                if (targetEl || attempts > 10) {
                    clearInterval(checkReady);
                    
                    if (!targetEl) {
                        // Ultimate fallback using API
                        const fb = window.tvWidget.createButton();
                        fb.innerHTML = '<div style="color: #2962FF; display: flex; align-items: center;" title="Option Chain"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="none"><rect x="5.5" y="7.5" width="17" height="13" rx="1.5" stroke="currentColor" stroke-width="1.2"></rect><path stroke="currentColor" stroke-width="1.2" d="M5.5 12.5h17M14 7.5v13"></path></svg></div>';
                        fb.addEventListener('click', () => { if (window.openOptionsChainModal) window.openOptionsChainModal(); });
                        return;
                    }
                    
                    const ocBtnHtml = `
                        <div class="group-MBOVGQRI" id="header-toolbar-option-chain" style="margin: 0 4px;">
                            <button aria-label="Options Chain" data-role="button" data-tooltip-hotkey='{"keys":["O"],"text":"{0}"}' data-tooltip="Options Chain" tabindex="-1" type="button" class="button-OhqNVIYA button-ptpAHg8E button-GwQQdU8S apply-common-tooltip isInteractive-GwQQdU8S accessible-GwQQdU8S" id="btn-option-chain-real">
                                <span role="img" class="icon-GwQQdU8S" aria-hidden="true">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="none">
                                        <rect x="5.5" y="7.5" width="17" height="13" rx="1.5" stroke="currentColor" stroke-width="1.2"></rect>
                                        <path stroke="currentColor" stroke-width="1.2" d="M5.5 12.5h17M14 7.5v13"></path>
                                    </svg>
                                </span>
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
                        
                        // Explicitly check golden period immediately after button is in DOM
                        if (window.checkGlobalGoldenPeriod) window.checkGlobalGoldenPeriod();
                        
                        if (window.FyersUI) window.FyersUI.injectButton(targetEl, iframeDoc);
                        if (window.MT5UI) window.MT5UI.injectButton(targetEl, iframeDoc);
                        if (window.TradeUI && typeof window.TradeUI.injectToolbarButton === 'function') window.TradeUI.injectToolbarButton(targetEl, iframeDoc);
                        if (window.DatasetTimingUI) window.DatasetTimingUI.injectButton(targetEl, iframeDoc);
                        if (window.WatchlistUI) window.WatchlistUI.injectButton(targetEl, iframeDoc);
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
        
        if (urlSymbol && currentSymbol !== urlSymbol) {
            activeChart.setSymbol(urlSymbol, () => {});
        }
        if (urlInterval && currentInterval !== urlInterval) {
            activeChart.setResolution(urlInterval, () => {});
        }

        // 4. Bind URL synchronization (Always clean URL parameters)
        const updateUrl = () => {
            const currentUrl = new URL(window.location.origin + window.location.pathname);
            const sym = activeChart.symbol();
            const res = activeChart.resolution();
            const existingParams = new URLSearchParams(window.location.search);
            const layout = existingParams.get('layout');

            if (sym) currentUrl.searchParams.set('symbol', sym);
            if (res) currentUrl.searchParams.set('interval', res);
            if (layout) currentUrl.searchParams.set('layout', layout);

            window.history.replaceState({}, '', currentUrl.toString());
        };

        activeChart.onSymbolChanged().subscribe(null, updateUrl);
        activeChart.onSymbolChanged().subscribe(null, () => {
            if (window.WatchlistUI && typeof window.WatchlistUI.highlightActiveRow === 'function') {
                try {
                    window.WatchlistUI.activeChartSymbol = activeChart.symbol().toUpperCase();
                    window.WatchlistUI.highlightActiveRow();
                } catch (_) {}
            }
        });
        activeChart.onIntervalChanged().subscribe(null, updateUrl);
        
        // Push initial state
        updateUrl();
    });
}

window.onload = function() {
    const bootWhenReady = async () => {
        console.log("Waiting for DuckDB-WASM and SyncManager...");
        
        // Wait for DuckDB
        if (!window.db) {
            await new Promise(r => window.addEventListener('DuckDBReady', r, { once: true }));
        }
        
        // Wait for SyncManager root sync
        if (window.SyncManager && window.SyncManager._syncPromise) {
            try {
                await window.SyncManager._syncPromise;
            } catch(e) {}
        }
        
        bootWidget();
    };
    
    bootWhenReady();
};
