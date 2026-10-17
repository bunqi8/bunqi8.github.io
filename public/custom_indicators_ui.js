function setupCustomIndicatorsDialog(widget) {
    widget.headerReady().then(function() {
        const iframe = document.querySelector('#tv_chart_container iframe');
        const iframeDoc = iframe.contentWindow.document;
        
        // --- PRELOAD MONACO EDITOR (Delayed to prevent lag) ---
        let monacoEditorInstance = null;
        setTimeout(() => {
            if (window.require && !window.monaco) {
                require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.39.0/min/vs' }});
                require(['vs/editor/editor.main'], function() {
                    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
                        noSemanticValidation: true,
                        noSyntaxValidation: true
                    });
                });
            }
        }, 3000);

        // --- 1. AUTO REMOVE & RE-ADD (Hot Reload Workflow) ---
        const autoLoad = sessionStorage.getItem('tv_auto_reload_study');
        if (autoLoad) {
            sessionStorage.removeItem('tv_auto_reload_study');
            setTimeout(() => {
                try {
                    const chart = widget.chart();
                    const studies = chart.getAllStudies();
                    const exists = studies.find(s => s.name === autoLoad);
                    if (exists) {
                        chart.removeEntity(exists.id);
                    }
                    setTimeout(() => {
                        chart.createStudy(autoLoad, false, false);
                    }, 200);
                } catch (e) {
                    console.error("Hot-swap failed", e);
                }
            }, 1500);
        }

        // --- 2. INJECT "{ }" BUTTON INTO LEGEND (Robust Polling) ---
        setInterval(() => {
            try {
                const iframe = document.querySelector('#tv_chart_container iframe');
                if (!iframe) return;
                const iframeDoc = iframe.contentWindow.document;
                
                const actionButtons = iframeDoc.querySelectorAll([
                    '[data-name="legend-delete-action"]', 
                    '[data-qa-id="legend-delete-action"]',
                    '[data-name="legend-settings-action"]',
                    '[data-qa-id="legend-settings-action"]'
                ].join(', '));
                
                actionButtons.forEach(btn => {
                    const container = btn.parentNode;
                    if (!container) return;
                    
                    if (container.querySelector('.tv-custom-source-btn')) return;
                    
                    let studyTitle = "";
                    const legendItem = container.closest('[data-name="legend-item"], [data-qa-id="legend-item"], tr, [class*="legend-item"]');
                    if (legendItem) {
                        const titleEl = legendItem.querySelector('[data-name="legend-source-title"], [data-qa-id="legend-source-title"], [class*="title"]');
                        if (titleEl) studyTitle = titleEl.textContent.trim().toLowerCase();
                    }

                    const srcBtn = iframeDoc.createElement('div');
                    srcBtn.className = btn.className; 
                    srcBtn.classList.add('tv-custom-source-btn');
                    srcBtn.innerHTML = '{ }';
                    srcBtn.title = 'Open Script Code Editor';
                    srcBtn.style.cssText = 'display:inline-flex; align-items:center; justify-content:center; white-space:nowrap; width:22px; height:22px; margin:0 2px; cursor:pointer; font-family:"JetBrains Mono", Consolas, monospace; font-weight:700; font-size:13px; line-height:1; color:#131722; border-radius:4px; transition:0.2s;';
                    srcBtn.onmouseover = () => { srcBtn.style.background = '#f0f3fa'; srcBtn.style.color = '#2962FF'; };
                    srcBtn.onmouseout = () => { srcBtn.style.background = 'transparent'; srcBtn.style.color = '#131722'; };
                    
                    srcBtn.onclick = (e) => {
                        e.stopPropagation();
                        openModal();
                        
                        let stored = {};
                        try { stored = JSON.parse(localStorage.getItem('tv_local_indicators') || '{}'); } catch(e){}
                        let remoteStored = (window.ScriptRepoManager && window.ScriptRepoManager.remoteIndicators) || {};
                        
                        let matchedKey = null;
                        let matchedCode = null;

                        // Check local indicators first
                        for (const [key, code] of Object.entries(stored)) {
                            try {
                                const factory = new Function('PineJS', 'return (' + code + ');');
                                const obj = factory({ Std: {} });
                                const k = key.toLowerCase();
                                const n = (obj.name || "").toLowerCase();
                                const sd = (obj.metainfo && obj.metainfo.shortDescription) ? obj.metainfo.shortDescription.toLowerCase() : "";
                                const d = (obj.metainfo && obj.metainfo.description) ? obj.metainfo.description.toLowerCase() : "";
                                
                                if (
                                    (k && studyTitle.includes(k)) || (k && k.includes(studyTitle)) ||
                                    (n && studyTitle.includes(n)) || (n && n.includes(studyTitle)) ||
                                    (sd && studyTitle.includes(sd)) || (sd && sd.includes(studyTitle)) ||
                                    (d && studyTitle.includes(d)) || (d && d.includes(studyTitle))
                                ) {
                                    matchedKey = key;
                                    matchedCode = code;
                                    break;
                                }
                            } catch(err) {
                                if (studyTitle.includes(key.toLowerCase()) || code.toLowerCase().includes(studyTitle)) {
                                    matchedKey = key;
                                    matchedCode = code;
                                    break;
                                }
                            }
                        }

                        // Check remote indicators
                        if (!matchedKey) {
                            for (const [key, item] of Object.entries(remoteStored)) {
                                const n = (item.name || "").toLowerCase();
                                if (n && (studyTitle.includes(n) || n.includes(studyTitle))) {
                                    matchedKey = item.name;
                                    matchedCode = item.code;
                                    break;
                                }
                            }
                        }
                        
                        // Check default indicators
                        if (!matchedKey) {
                            if (studyTitle.includes("supertrend strategy") || studyTitle.includes("supertrend strat")) {
                                matchedKey = "SuperTrend Strategy (Trade Chains)";
                                matchedCode = getDefaultScriptCode("SuperTrend Strategy (Trade Chains)");
                            } else if (studyTitle.includes("supertrend")) {
                                matchedKey = "SuperTrend Custom";
                                matchedCode = getDefaultScriptCode("SuperTrend Custom");
                            } else if (studyTitle.includes("5 ema") || studyTitle.includes("ema crossover")) {
                                matchedKey = "5 EMA Crossover";
                                matchedCode = getDefaultScriptCode("5 EMA Crossover");
                            }
                        }
                        
                        setTimeout(() => {
                            if (matchedKey && matchedCode) {
                                showEditor(matchedCode, matchedKey);
                            }
                        }, 50);
                    };
                    
                    if (btn.getAttribute('data-name') === 'legend-delete-action' || btn.getAttribute('data-qa-id') === 'legend-delete-action') {
                        container.insertBefore(srcBtn, btn);
                        if (!btn._st_cleanup_attached) {
                            btn._st_cleanup_attached = true;
                            btn.addEventListener('click', () => {
                                setTimeout(() => { if (window.StrategyTesterUI) window.StrategyTesterUI.checkStrategyPresence(); }, 150);
                                setTimeout(() => { if (window.StrategyTesterUI) window.StrategyTesterUI.checkStrategyPresence(); }, 500);
                            });
                        }
                    } else if (btn.nextSibling) {
                        container.insertBefore(srcBtn, btn.nextSibling);
                    } else {
                        container.appendChild(srcBtn);
                    }
                });
            } catch (e) {}
        }, 800);

        // --- NATIVE MODAL HIJACK ---
        ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerdown', 'pointerup'].forEach(evt => {
            iframeDoc.documentElement.addEventListener(evt, (e) => {
                const btn = e.target.closest('#header-toolbar-indicators, [data-name="header-toolbar-indicators"]');
                if (btn) {
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    if (e.cancelable) e.preventDefault();
                    
                    if (evt === 'click' || evt === 'touchend') {
                        if (window._tvModalOpening) return;
                        window._tvModalOpening = true;
                        setTimeout(() => window._tvModalOpening = false, 400);
                        openModal();
                    }
                }
            }, true);
        });
        
        const nativeDialogObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    const isIndicatorsDialog = detectNativeIndicatorsDialog(node);
                    if (isIndicatorsDialog) {
                        node.style.display = 'none';
                        setTimeout(() => { try { node.remove(); } catch(e) {} }, 50);
                        if (!window._tvModalOpening) {
                            window._tvModalOpening = true;
                            setTimeout(() => window._tvModalOpening = false, 400);
                            openModal();
                        }
                        return;
                    }
                }
            }
        });
        
        function detectNativeIndicatorsDialog(node) {
            if (!node.querySelector) return false;
            if (node.getAttribute && (
                node.getAttribute('data-name') === 'indicators-dialog' ||
                node.getAttribute('data-dialog-name') === 'indicators' ||
                node.getAttribute('data-name') === 'insert-study-dialog'
            )) return true;
            if (node.getAttribute && node.getAttribute('role') === 'dialog') {
                const text = node.textContent || '';
                if (text.includes('Indicators') || text.includes('Accumulation') || text.includes('Bollinger')) return true;
            }
            const hasSearch = node.querySelector && node.querySelector('input[type="text"], input[placeholder*="Search"], input[data-role="search"]');
            if (hasSearch) {
                const text = node.textContent || '';
                if ((text.includes('Accumulation') && text.includes('Bollinger')) || (text.includes('Indicators') && text.includes('strategies'))) return true;
            }
            const innerDialogs = node.querySelectorAll ? node.querySelectorAll('[role="dialog"], [data-name*="dialog"]') : [];
            for (const inner of innerDialogs) {
                const innerText = inner.textContent || '';
                if ((innerText.includes('Accumulation') && innerText.includes('Bollinger')) || (innerText.includes('Indicators') && innerText.includes('strategies'))) return true;
            }
            return false;
        }
        
        function findAndHideNativeDialog() {
            const candidates = iframeDoc.body.querySelectorAll('[role="dialog"], [data-name*="dialog"], [class*="dialog"]');
            for (const candidate of candidates) {
                if (candidate.closest('.tv-custom-modal-overlay') || candidate.closest('.tv-repo-modal-overlay')) continue;
                const text = candidate.textContent || '';
                if ((text.includes('Accumulation') && text.includes('Bollinger')) ||
                    (text.includes('Indicators') && text.includes('strategies')) ||
                    (text.includes('Aroon') && text.includes('Average Price'))) {
                    candidate.style.display = 'none';
                    setTimeout(() => { try { candidate.remove(); } catch(e) {} }, 50);
                    if (!window._tvModalOpening) {
                        window._tvModalOpening = true;
                        setTimeout(() => window._tvModalOpening = false, 400);
                        openModal();
                    }
                    return true;
                }
            }
            return false;
        }
        
        nativeDialogObserver.observe(iframeDoc.body, { childList: true, subtree: true });
        setInterval(() => {
            if (modalOverlay && modalOverlay.classList.contains('visible')) return;
            findAndHideNativeDialog();
        }, 300);

        // --- STYLES INJECTION ---
        const style = document.createElement('style');
        style.textContent = `
            .tv-custom-modal-overlay {
                display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0, 0, 0, 0.45); z-index: 99999; align-items: center; justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif;
                touch-action: auto !important;
            }
            .tv-custom-modal-overlay.visible {
                display: flex;
                animation: tvModalFadeIn 0.15s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
            }
            @keyframes tvModalFadeIn {
                from { opacity: 0; transform: scale(0.97) translateY(10px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }
            .tv-custom-modal {
                background: #ffffff; width: 880px; height: 680px; max-width: 95%; max-height: 95%;
                border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 16px 48px rgba(0,0,0,0.22); overflow: hidden;
                touch-action: auto !important;
            }
            .tv-custom-modal-body {
                display: flex; flex: 1; overflow: hidden; border-top: 1px solid #e0e3eb; min-height: 0;
            }
            .tv-custom-modal-tabs {
                width: 210px; display: flex; flex-direction: column; padding: 16px 12px; border-right: 1px solid #e0e3eb; background: #fafbfc; flex-shrink: 0;
            }
            .tv-custom-modal-tab {
                padding: 10px 14px; margin-bottom: 4px; font-size: 13.5px; cursor: pointer; color: #131722; font-weight: 500;
                border-radius: 8px; transition: background 0.1s ease; display: flex; align-items: center; gap: 10px; border: 1px solid transparent;
            }
            .tv-custom-modal-tab:hover {
                background: #f0f3fa;
            }
            .tv-custom-modal-tab.active {
                background: #ffffff; color: #2962FF; box-shadow: 0 1px 3px rgba(0,0,0,0.05); border: 1px solid #e0e3eb; font-weight: 600;
            }
            .tv-editor-header {
                display: flex; justify-content: space-between; align-items: center; padding: 12px 24px; border-bottom: 1px solid #e0e3eb; background: #ffffff;
            }
            
            .tv-list-container { -webkit-overflow-scrolling: touch; touch-action: pan-y !important; }
            .tv-list-container::-webkit-scrollbar { width: 6px; }
            .tv-list-container::-webkit-scrollbar-thumb { background: #d1d4dc; border-radius: 3px; }
            .tv-list-container::-webkit-scrollbar-track { background: transparent; }

            .tv-star-icon { color: #b2b5be; transition: color 0.1s ease; margin-right: 12px; flex-shrink: 0; }
            .tv-star-icon:hover { color: #FFB300; }
            .tv-star-icon.active { color: #FFB300; fill: #FFB300; }

            /* Filter Bar & Chips */
            .tv-filter-container {
                display: flex; flex-direction: column; gap: 8px; margin-top: 10px;
            }
            .tv-filter-row {
                display: flex; align-items: center; gap: 6px; overflow-x: auto; flex-wrap: wrap;
            }
            .tv-filter-label {
                font-size: 11px; font-weight: 700; color: #787b86; text-transform: uppercase; letter-spacing: 0.4px; min-width: 52px; user-select: none;
            }
            .tv-filter-chip {
                padding: 3px 10px; border-radius: 12px; font-size: 11.5px; font-weight: 500; cursor: pointer;
                border: 1px solid #e0e3eb; background: #f8fafe; color: #475569; transition: all 0.12s ease;
                user-select: none; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;
            }
            .tv-filter-chip:hover {
                background: #f0f3fa; border-color: #b2b5be; color: #131722;
            }
            .tv-filter-chip.active {
                background: #2962FF; color: #ffffff; border-color: #2962FF; font-weight: 600;
                box-shadow: 0 1px 3px rgba(41,98,255,0.25);
            }

            /* Badges */
            .tv-badge-pill {
                font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px;
                text-transform: uppercase; letter-spacing: 0.3px; display: inline-flex; align-items: center;
                gap: 4px; white-space: nowrap; line-height: 1.2;
            }
            .tv-badge-type-strat {
                background: #f3e8ff; color: #7e22ce; border: 1px solid #e9d5ff;
            }
            .tv-badge-type-ind {
                background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0;
            }
            .tv-badge-source-default {
                background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;
            }
            .tv-badge-source-local {
                background: #fef3c7; color: #b45309; border: 1px solid #fde68a;
            }
            .tv-badge-source-github {
                background: #0f172a; color: #f8fafc; border: 1px solid #334155;
            }
            .tv-badge-source-hf {
                background: #fffbeb; color: #b45309; border: 1px solid #fef08a;
            }
            .tv-badge-active {
                background: rgba(8, 153, 129, 0.12); color: #089981; border: 1px solid rgba(8, 153, 129, 0.25);
            }

            /* Action Buttons inside list item */
            .tv-item-action-btn {
                cursor: pointer; color: #787b86; display: flex; align-items: center; padding: 4px 8px;
                border-radius: 4px; font-size: 11.5px; font-weight: 600; transition: 0.15s; border: 1px solid transparent;
            }
            .tv-item-action-btn:hover {
                background: #f0f3fa; color: #2962FF; border-color: #e0e3eb;
            }
            .tv-del-btn:hover {
                background: #ffebec !important; color: #f23645 !important; border-color: #ffd4d7 !important;
            }

            /* Repository Manager Modal */
            .tv-repo-modal-overlay {
                display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0, 0, 0, 0.5); z-index: 100001; align-items: center; justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif;
                touch-action: auto !important;
            }
            .tv-repo-modal-overlay.visible {
                display: flex;
                animation: tvModalFadeIn 0.15s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
            }
            .tv-repo-modal {
                background: #ffffff; width: 780px; height: 600px; max-width: 95%; max-height: 95%;
                border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 16px 48px rgba(0,0,0,0.25); overflow: hidden;
            }
            .tv-repo-tab-bar {
                display: flex; gap: 4px; padding: 0 24px; border-bottom: 1px solid #e0e3eb; background: #fafbfc;
            }
            .tv-repo-tab-item {
                padding: 12px 16px; font-size: 13.5px; font-weight: 600; color: #787b86; cursor: pointer;
                border-bottom: 2px solid transparent; display: flex; align-items: center; gap: 8px; transition: 0.15s;
            }
            .tv-repo-tab-item:hover {
                color: #131722;
            }
            .tv-repo-tab-item.active {
                color: #2962FF; border-bottom-color: #2962FF;
            }
            .tv-repo-card {
                border: 1px solid #e0e3eb; border-radius: 8px; padding: 14px 16px; margin-bottom: 10px;
                background: #ffffff; transition: all 0.15s ease; display: flex; align-items: center; justify-content: space-between;
            }
            .tv-repo-card:hover {
                border-color: #b2b5be; box-shadow: 0 2px 8px rgba(0,0,0,0.04);
            }
            .tv-spin {
                animation: tvSpinAnim 1s linear infinite;
            }
            @keyframes tvSpinAnim {
                100% { transform: rotate(360deg); }
            }

            @media (max-width: 768px) {
                .tv-custom-modal { width: 100%; height: 100%; max-width: 100%; max-height: 100%; border-radius: 0; }
                .tv-custom-modal-body { flex-direction: column; }
                .tv-custom-modal-tabs { width: 100%; flex-direction: row; border-right: none; border-bottom: 1px solid #e0e3eb; padding: 8px; background: #ffffff; overflow-x: auto; touch-action: pan-x !important; }
                .tv-custom-modal-tab { flex: 1; justify-content: center; margin-bottom: 0; margin-right: 4px; padding: 10px 8px; font-size: 13px; white-space: nowrap; }
                .tv-editor-header { padding: 12px; }
                .tv-repo-modal { width: 100%; height: 100%; max-width: 100%; max-height: 100%; border-radius: 0; }
            }
        `;
        document.head.appendChild(style);

        // --- MODAL CONTAINER ---
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'tv-custom-modal-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'tv-custom-modal';
        
        const header = document.createElement('div');
        header.style.cssText = 'padding:16px 24px 12px 24px; display:flex; justify-content:space-between; align-items:center; background: #ffffff;';
        header.innerHTML = '<div style="font-size:18px; font-weight:700; color:#131722; letter-spacing:-0.2px;">Indicators, metrics, and strategies</div><div id="tv-close-modal" style="cursor:pointer; color:#787b86; padding:16px; margin:-10px; border-radius:4px; transition:0.2s; display:flex; align-items:center; justify-content:center;"><svg width="18" height="18" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1l12 12m0-12L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>';
        header.querySelector('#tv-close-modal').onmouseover = function() { this.style.background = '#f0f3fa'; this.style.color = '#131722'; };
        header.querySelector('#tv-close-modal').onmouseout = function() { this.style.background = 'transparent'; this.style.color = '#787b86'; };

        // --- SEARCH CONTAINER & FILTER BAR ---
        const searchContainer = document.createElement('div');
        searchContainer.style.cssText = 'padding:0 24px 14px 24px; background: #ffffff;';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search';
        searchInput.style.cssText = 'width:100%; padding:10px 14px 10px 38px; border:1px solid #e0e3eb; border-radius:8px; font-size:15px; color:#131722; outline:none; box-sizing:border-box; background:url("data:image/svg+xml;utf8,<svg width=\'18\' height=\'18\' viewBox=\'0 0 18 18\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'><path d=\'M12.5 12.5L15 15M14 8.5a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z\' stroke=\'%23787b86\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/></svg>") no-repeat 12px center; background-color: #f8fafe; transition: border-color 0.1s ease;';
        searchInput.onfocus = () => { searchInput.style.borderColor = '#2962FF'; searchInput.style.backgroundColor = '#ffffff'; searchInput.style.boxShadow = '0 0 0 3px rgba(41,98,255,0.1)'; };
        searchInput.onblur = () => { searchInput.style.borderColor = '#e0e3eb'; searchInput.style.backgroundColor = '#f8fafe'; searchInput.style.boxShadow = 'none'; };
        searchContainer.appendChild(searchInput);

        // Filter state
        let currentTypeFilter = 'all'; // 'all', 'indicator', 'strategy'
        let currentSourceFilter = 'all'; // 'all', 'default', 'local', 'github', 'huggingface'

        const filterContainer = document.createElement('div');
        filterContainer.className = 'tv-filter-container';

        // Row 1: Type Chips
        const typeRow = document.createElement('div');
        typeRow.className = 'tv-filter-row';
        const typeLabel = document.createElement('span');
        typeLabel.className = 'tv-filter-label';
        typeLabel.textContent = 'Type:';
        typeRow.appendChild(typeLabel);

        const typeChips = [
            { id: 'all', label: 'All Types' },
            { id: 'indicator', label: 'Indicators' },
            { id: 'strategy', label: 'Strategies' }
        ];

        typeChips.forEach(chip => {
            const chipEl = document.createElement('div');
            chipEl.className = 'tv-filter-chip' + (chip.id === 'all' ? ' active' : '');
            chipEl.textContent = chip.label;
            chipEl.onclick = () => {
                currentTypeFilter = chip.id;
                typeRow.querySelectorAll('.tv-filter-chip').forEach(c => c.classList.remove('active'));
                chipEl.classList.add('active');
                renderList(searchInput.value);
            };
            typeRow.appendChild(chipEl);
        });

        // Row 2: Source Chips
        const sourceRow = document.createElement('div');
        sourceRow.className = 'tv-filter-row';
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'tv-filter-label';
        sourceLabel.textContent = 'Source:';
        sourceRow.appendChild(sourceLabel);

        const sourceChips = [
            { id: 'all', label: 'All Sources' },
            { id: 'default', label: 'Default' },
            { id: 'local', label: 'Local' },
            { id: 'github', label: 'GitHub' },
            { id: 'huggingface', label: 'Hugging Face' }
        ];

        sourceChips.forEach(chip => {
            const chipEl = document.createElement('div');
            chipEl.className = 'tv-filter-chip' + (chip.id === 'all' ? ' active' : '');
            chipEl.textContent = chip.label;
            chipEl.onclick = () => {
                currentSourceFilter = chip.id;
                sourceRow.querySelectorAll('.tv-filter-chip').forEach(c => c.classList.remove('active'));
                chipEl.classList.add('active');
                renderList(searchInput.value);
            };
            sourceRow.appendChild(chipEl);
        });

        filterContainer.appendChild(typeRow);
        filterContainer.appendChild(sourceRow);
        searchContainer.appendChild(filterContainer);

        // --- BODY CONTAINER & TABS ---
        const bodyContainer = document.createElement('div');
        bodyContainer.className = 'tv-custom-modal-body';
        
        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'tv-custom-modal-tabs';
        
        const tabFavorites = document.createElement('div');
        const tabCustom = document.createElement('div');
        const tabBuiltin = document.createElement('div');
        
        const favIcon = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 1.5l2.25 4.75L16 7l-3.5 3.5L13.5 15.5 9 13 4.5 15.5 5.5 10.5 2 7l4.75-.75L9 1.5z" stroke-linejoin="round"/></svg>';
        const userIcon = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-6 8a6 6 0 0112 0H4z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const builtinIcon = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 17V9m5 8V5m5 12v-5m5 5V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        tabFavorites.innerHTML = favIcon + 'Favorites';
        tabCustom.innerHTML = userIcon + 'Custom scripts';
        tabBuiltin.innerHTML = builtinIcon + 'Technicals';
        
        tabFavorites.className = 'tv-custom-modal-tab';
        tabCustom.className = 'tv-custom-modal-tab active';
        tabBuiltin.className = 'tv-custom-modal-tab';
        
        tabsContainer.appendChild(tabFavorites);
        tabsContainer.appendChild(tabCustom);
        tabsContainer.appendChild(tabBuiltin);
        
        const listWrapper = document.createElement('div');
        listWrapper.style.cssText = 'flex:1; display:flex; flex-direction:column; background: #ffffff; min-height:0;';
        
        const listHeader = document.createElement('div');
        listHeader.style.cssText = 'padding:14px 24px 8px 24px; font-size:11px; font-weight:700; color:#b2b5be; text-transform:uppercase; letter-spacing:0.4px; display:flex; justify-content:space-between; align-items:center;';
        listHeader.innerHTML = '<span>Script name</span><span id="tv-list-count" style="font-size:11px; color:#787b86; text-transform:none; font-weight:500;"></span>';

        const listContainer = document.createElement('div');
        listContainer.className = 'tv-list-container';
        listContainer.style.cssText = 'flex:1; overflow-y:auto; padding:0 12px 12px 12px; min-height:0; touch-action: pan-y !important; -webkit-overflow-scrolling: touch;';
        
        listWrapper.appendChild(listHeader);
        listWrapper.appendChild(listContainer);

        bodyContainer.appendChild(tabsContainer);
        bodyContainer.appendChild(listWrapper);

        modal.appendChild(header);
        modal.appendChild(searchContainer);
        modal.appendChild(bodyContainer);
        modalOverlay.appendChild(modal);
        document.body.appendChild(modalOverlay);
        
        // --- TOAST NOTIFICATIONS ---
        function showToast(message) {
            let toast = document.getElementById('tv-custom-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'tv-custom-toast';
                toast.style.cssText = 'position:fixed; top:24px; left:50%; transform:translateX(-50%) translateY(-20px); background:#0f172a; color:#ffffff; padding:10px 20px; border-radius:8px; font-size:13px; font-weight:600; box-shadow:0 10px 25px rgba(0,0,0,0.25); z-index:100005; display:flex; align-items:center; gap:10px; opacity:0; transition:all 0.25s cubic-bezier(0.16, 1, 0.3, 1); pointer-events:none; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; border:1px solid rgba(255,255,255,0.12);';
                document.body.appendChild(toast);
            }
            toast.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                <span>${message}</span>
            `;
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
            
            if (window._tvToastTimeout) clearTimeout(window._tvToastTimeout);
            window._tvToastTimeout = setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(-50%) translateY(-20px)';
            }, 3000);
        }

        let allStudies = [];
        let activeTab = 'custom';
        let isEditing = false;

        function getDefaultScriptCode(name) {
            if (name === "SuperTrend Custom") {
                return `{\n    name: "SuperTrend Custom",\n    metainfo: {\n        _metainfoVersion: 52,\n        isTVScript: false,\n        is_hidden_study: false,\n        defaults: {\n            styles: {\n                plot_up: { plottype: 7, linewidth: 1, color: "#089981" },\n                plot_down: { plottype: 7, linewidth: 1, color: "#f23645" },\n                plot_mid: { plottype: 0, linewidth: 1, color: "#000000" },\n                plot_buy_circle: { plottype: "shape_circle", location: "Absolute", color: "#089981", size: "auto" },\n                plot_buy_label: { plottype: "shape_label_up", location: "Absolute", color: "#089981", textColor: "#ffffff", size: "auto" },\n                plot_sell_circle: { plottype: "shape_circle", location: "Absolute", color: "#f23645", size: "auto" },\n                plot_sell_label: { plottype: "shape_label_down", location: "Absolute", color: "#f23645", textColor: "#ffffff", size: "auto" }\n            },\n            inputs: {\n                in_period: 10,\n                in_source: "hl2",\n                in_multiplier: 3.0,\n                in_changeATR: true,\n                in_showSignals: true,\n                in_highlighting: true\n            },\n            filledAreasStyle: {\n                fill_up: { color: "#089981", transparency: 95, visible: true },\n                fill_down: { color: "#f23645", transparency: 95, visible: true }\n            }\n        },\n        plots: [\n            { id: "plot_up", type: "line" },\n            { id: "plot_down", type: "line" },\n            { id: "plot_mid", type: "line" },\n            { id: "plot_buy_circle", type: "shapes" },\n            { id: "plot_buy_label", type: "shapes" },\n            { id: "plot_sell_circle", type: "shapes" },\n            { id: "plot_sell_label", type: "shapes" }\n        ],\n        styles: {\n            plot_up: { title: "Up Trend", histogramBase: 0, joinPoints: false },\n            plot_down: { title: "Down Trend", histogramBase: 0, joinPoints: false },\n            plot_mid: { title: "Body Middle", isHidden: true, display: 0 },\n            plot_buy_circle: { title: "UpTrend Begins", isHidden: false },\n            plot_buy_label: { title: "Buy Label", isHidden: false, text: "Buy" },\n            plot_sell_circle: { title: "DownTrend Begins", isHidden: false },\n            plot_sell_label: { title: "Sell Label", isHidden: false, text: "Sell" }\n        },\n        description: "SuperTrend Custom",\n        shortDescription: "SuperTrend Custom",\n        is_price_study: true,\n        inputs: [\n            { id: "in_period", name: "ATR Period", defval: 10, type: "integer", min: 1 },\n            { id: "in_source", name: "Source", defval: "hl2", type: "source", options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"] },\n            { id: "in_multiplier", name: "ATR Multiplier", defval: 3.0, type: "float", min: 0.1, step: 0.1 },\n            { id: "in_changeATR", name: "Change ATR Calculation Method ?", defval: true, type: "bool" },\n            { id: "in_showSignals", name: "Show Buy/Sell Signals ?", defval: true, type: "bool" },\n            { id: "in_highlighting", name: "Highlighter On/Off ?", defval: true, type: "bool" }\n        ],\n        id: "SuperTrend_Custom@tv-basicstudies-1",\n        scriptIdPart: "",\n        name: "SuperTrend Custom",\n        format: { precision: 2, type: "price" }\n    },\n    constructor: function () {\n        this.init = function(ctx, get_input) {\n            this._context = ctx;\n            this._input = get_input;\n        };\n        this.main = function (ctx, get_input) {\n            this._context = ctx || this._context;\n            this._input = get_input || this._input;\n            var periods = this._input(0);\n            var sourceStr = this._input(1);\n            var multiplier = this._input(2);\n            var changeATR = this._input(3);\n            var showSignals = this._input(4);\n            var highlighting = this._input(5);\n            var high = PineJS.Std.high(this._context);\n            var low = PineJS.Std.low(this._context);\n            var close = PineJS.Std.close(this._context);\n            var hl2 = (high + low) / 2.0;\n            var srcVal = hl2;\n            var prev_close = this._context.new_var(close).get(1);\n            if (isNaN(prev_close)) prev_close = close;\n            var tr = Math.max(high - low, Math.abs(high - prev_close), Math.abs(low - prev_close));\n            var trSeries = this._context.new_var(tr);\n            var atrVal = changeATR ? PineJS.Std.rma(trSeries, periods, this._context) : PineJS.Std.sma(trSeries, periods, this._context);\n            var upVal = srcVal - (multiplier * atrVal);\n            var dnVal = srcVal + (multiplier * atrVal);\n            var final_upper = this._context.new_var();\n            var final_lower = this._context.new_var();\n            var trend = this._context.new_var();\n            var prev_final_upper = final_upper.get(1);\n            var prev_final_lower = final_lower.get(1);\n            var prev_trend = trend.get(1);\n            if (isNaN(prev_final_upper)) prev_final_upper = upVal;\n            if (isNaN(prev_final_lower)) prev_final_lower = dnVal;\n            if (isNaN(prev_trend)) prev_trend = 1;\n            var curr_up = (prev_close > prev_final_upper) ? Math.max(upVal, prev_final_upper) : upVal;\n            var curr_dn = (prev_close < prev_final_lower) ? Math.min(dnVal, prev_final_lower) : dnVal;\n            final_upper.set(curr_up); final_lower.set(curr_dn);\n            var curr_trend = prev_trend;\n            if (curr_trend === -1 && close > prev_final_lower) curr_trend = 1;\n            else if (curr_trend === 1 && close < prev_final_upper) curr_trend = -1;\n            trend.set(curr_trend);\n            var buySignal = (curr_trend === 1 && prev_trend === -1);\n            var sellSignal = (curr_trend === -1 && prev_trend === 1);\n            return [{ value: curr_trend === 1 ? curr_up : NaN }, { value: curr_trend === 1 ? NaN : curr_dn }, { value: NaN }, { value: buySignal ? curr_up : NaN }, { value: (buySignal && showSignals) ? curr_up : NaN }, { value: sellSignal ? curr_dn : NaN }, { value: (sellSignal && showSignals) ? curr_dn : NaN }];\n        };\n    }\n}`;
            }
            if (name === "5 EMA Crossover") {
                return `{\n    name: "5 EMA Crossover",\n    metainfo: {\n        _metainfoVersion: 52,\n        isTVScript: false,\n        is_hidden_study: false,\n        defaults: {\n            styles: {\n                plot_ema1: { plottype: 0, linewidth: 1, color: "#000000" },\n                plot_ema2: { plottype: 0, linewidth: 1, color: "#4CAF50" },\n                plot_ema3: { plottype: 0, linewidth: 1, color: "#F44336" },\n                plot_ema4: { plottype: 0, linewidth: 1, color: "#FF9800" },\n                plot_ema5: { plottype: 0, linewidth: 1, color: "#2196F3" },\n                plot_cross_up: { plottype: 3, linewidth: 6, color: "#2962FF" },\n                plot_cross_dn: { plottype: 3, linewidth: 6, color: "#FF00FF" }\n            },\n            inputs: { len1: 3, len2: 30, len3: 50, len4: 100, len5: 200 }\n        },\n        plots: [\n            { id: "plot_ema1", type: "line" }, { id: "plot_ema2", type: "line" },\n            { id: "plot_ema3", type: "line" }, { id: "plot_ema4", type: "line" },\n            { id: "plot_ema5", type: "line" }, { id: "plot_cross_up", type: "line" }, { id: "plot_cross_dn", type: "line" }\n        ],\n        styles: {\n            plot_ema1: { title: "EMA 3" }, plot_ema2: { title: "EMA 30" },\n            plot_ema3: { title: "EMA 50" }, plot_ema4: { title: "EMA 100" },\n            plot_ema5: { title: "EMA 200" }, plot_cross_up: { title: "Cross Up" }, plot_cross_dn: { title: "Cross Down" }\n        },\n        description: "5 EMA Crossover",\n        shortDescription: "5 EMAs",\n        is_price_study: true,\n        inputs: [\n            { id: "len1", name: "EMA 1 Length", defval: 3, type: "integer", min: 1 },\n            { id: "len2", name: "EMA 2 Length", defval: 30, type: "integer", min: 1 },\n            { id: "len3", name: "EMA 3 Length", defval: 50, type: "integer", min: 1 },\n            { id: "len4", name: "EMA 4 Length", defval: 100, type: "integer", min: 1 },\n            { id: "len5", name: "EMA 5 Length", defval: 200, type: "integer", min: 1 }\n        ],\n        id: "5_EMA_Crossover@tv-basicstudies-1",\n        scriptIdPart: "",\n        name: "5 EMA Crossover",\n        format: { type: "price", precision: 2 }\n    },\n    constructor: function() {\n        this.init = function(ctx, get_input) { this._context = ctx; this._input = get_input; };\n        this.main = function(ctx, get_input) {\n            this._context = ctx || this._context; this._input = get_input || this._input;\n            var len1 = this._input(0), len2 = this._input(1), len3 = this._input(2), len4 = this._input(3), len5 = this._input(4);\n            var close = PineJS.Std.close(this._context);\n            var closeSeries = this._context.new_var(close);\n            var ema1 = PineJS.Std.ema(closeSeries, len1, this._context);\n            var ema2 = PineJS.Std.ema(closeSeries, len2, this._context);\n            var ema3 = PineJS.Std.ema(closeSeries, len3, this._context);\n            var ema4 = PineJS.Std.ema(closeSeries, len4, this._context);\n            var ema5 = PineJS.Std.ema(closeSeries, len5, this._context);\n            var ema1Series = this._context.new_var(ema1);\n            var ema2Series = this._context.new_var(ema2);\n            var crossUp = (ema1Series.get(1) <= ema2Series.get(1) && ema1 > ema2);\n            var crossDn = (ema1Series.get(1) >= ema2Series.get(1) && ema1 < ema2);\n            return [{ value: ema1 }, { value: ema2 }, { value: ema3 }, { value: ema4 }, { value: ema5 }, { value: crossUp ? ema1 : NaN }, { value: crossDn ? ema1 : NaN }];\n        };\n    }\n}`;
            }
            if (name === "SuperTrend Strategy (Trade Chains)") {
                return `{\n    name: "SuperTrend Strategy (Trade Chains)",\n    metainfo: {\n        _metainfoVersion: 52,\n        isTVScript: false,\n        is_hidden_study: false,\n        defaults: {\n            styles: {\n                plot_up: { plottype: 7, linewidth: 2, color: "#089981" },\n                plot_down: { plottype: 7, linewidth: 2, color: "#f23645" },\n                plot_buy_label: { plottype: "shape_label_up", location: "BelowBar", color: "#089981", textColor: "#ffffff", size: "auto" },\n                plot_sell_label: { plottype: "shape_label_down", location: "AboveBar", color: "#f23645", textColor: "#ffffff", size: "auto" }\n            },\n            inputs: {\n                in_period: 10,\n                in_multiplier: 3.0\n            }\n        },\n        plots: [\n            { id: "plot_up", type: "line" },\n            { id: "plot_down", type: "line" },\n            { id: "plot_buy_label", type: "shapes" },\n            { id: "plot_sell_label", type: "shapes" }\n        ],\n        styles: {\n            plot_up: { title: "Up Trend", histogramBase: 0, joinPoints: false },\n            plot_down: { title: "Down Trend", histogramBase: 0, joinPoints: false },\n            plot_buy_label: { title: "Buy Signal (Chain Entry)", isHidden: false, text: "Buy" },\n            plot_sell_label: { title: "Sell Signal (Chain Exit)", isHidden: false, text: "Sell" }\n        },\n        description: "SuperTrend Strategy (Trade Chains)",\n        shortDescription: "SuperTrend Strat",\n        is_price_study: true,\n        inputs: [\n            { id: "in_period", name: "ATR Period", defval: 10, type: "integer", min: 1 },\n            { id: "in_multiplier", name: "ATR Multiplier", defval: 3.0, type: "float", min: 0.1, step: 0.1 }\n        ],\n        id: "SuperTrend_Strategy@tv-basicstudies-1",\n        scriptIdPart: "",\n        name: "SuperTrend Strategy (Trade Chains)",\n        format: { precision: 2, type: "price" }\n    },\n    constructor: function () {\n        this.init = function(ctx, get_input) {\n            this._context = ctx;\n            this._input = get_input;\n            this._chainCounter = 1;\n        };\n        this.main = function (ctx, get_input) {\n            this._context = ctx || this._context;\n            this._input = get_input || this._input;\n            var periods = this._input(0);\n            var multiplier = this._input(1);\n            var high = PineJS.Std.high(this._context);\n            var low = PineJS.Std.low(this._context);\n            var close = PineJS.Std.close(this._context);\n            var hl2 = (high + low) / 2.0;\n            var prev_close = this._context.new_var(close).get(1);\n            if (isNaN(prev_close)) prev_close = close;\n            var tr = Math.max(high - low, Math.abs(high - prev_close), Math.abs(low - prev_close));\n            var trSeries = this._context.new_var(tr);\n            var atrVal = PineJS.Std.rma(trSeries, periods, this._context);\n            var upVal = hl2 - (multiplier * atrVal);\n            var dnVal = hl2 + (multiplier * atrVal);\n            var final_upper = this._context.new_var();\n            var final_lower = this._context.new_var();\n            var trend = this._context.new_var();\n            var prev_final_upper = final_upper.get(1);\n            var prev_final_lower = final_lower.get(1);\n            var prev_trend = trend.get(1);\n            if (isNaN(prev_final_upper)) prev_final_upper = upVal;\n            if (isNaN(prev_final_lower)) prev_final_lower = dnVal;\n            if (isNaN(prev_trend)) prev_trend = 1;\n            var curr_up = (prev_close > prev_final_upper) ? Math.max(upVal, prev_final_upper) : upVal;\n            var curr_dn = (prev_close < prev_final_lower) ? Math.min(dnVal, prev_final_lower) : dnVal;\n            final_upper.set(curr_up); final_lower.set(curr_dn);\n            var curr_trend = prev_trend;\n            if (curr_trend === -1 && close > prev_final_lower) curr_trend = 1;\n            else if (curr_trend === 1 && close < prev_final_upper) curr_trend = -1;\n            trend.set(curr_trend);\n            var buySignal = (curr_trend === 1 && prev_trend === -1);\n            var sellSignal = (curr_trend === -1 && prev_trend === 1);\n            if (!this._chainCounter) this._chainCounter = 1;\n            if (this.strategy) {\n                if (buySignal) {\n                    this.strategy.buy({ id: this._chainCounter, price: curr_up, qty: 1, tag: "SuperTrend Entry" });\n                } else if (sellSignal) {\n                    this.strategy.sell({ id: this._chainCounter, price: curr_dn, qty: 1, isEnd: true, tag: "SuperTrend Exit" });\n                    this._chainCounter++;\n                }\n            }\n            return [{ value: curr_trend === 1 ? curr_up : NaN }, { value: curr_trend === 1 ? NaN : curr_dn }, { value: buySignal ? curr_up : NaN }, { value: sellSignal ? curr_dn : NaN }];\n        };\n    }\n}`;
            }
            return "";
        }
        
        function getFavorites() {
            try { return JSON.parse(localStorage.getItem('tv_favorite_indicators') || '[]'); } 
            catch(e) { return []; }
        }
        function toggleFavorite(studyName) {
            let favs = getFavorites();
            if (favs.includes(studyName)) favs = favs.filter(f => f !== studyName);
            else favs.push(studyName);
            localStorage.setItem('tv_favorite_indicators', JSON.stringify(favs));
            renderList(searchInput.value);
        }
        
        // --- MONACO SCRIPT EDITOR ---
        function showEditor(existingCode = '', existingName = null, isStrategyTemplate = false, isFork = false, forkTitle = null) {
            isEditing = true;
            listWrapper.innerHTML = '';
            
            const edHeader = document.createElement('div');
            edHeader.className = 'tv-editor-header';
            
            const titleRow = document.createElement('div');
            titleRow.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:15px; font-weight:600; color:#131722;';
            let headerText = 'New Local Indicator';
            if (isFork) {
                headerText = `Fork & Edit: ${forkTitle || existingName}`;
            } else if (existingName) {
                headerText = `Edit: ${existingName}`;
            } else if (isStrategyTemplate) {
                headerText = 'New Local Strategy (Trade Chains)';
            }
            titleRow.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#2962FF"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg> 
                                  <span>${headerText}</span>`;
            
            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex; gap:8px;';
            
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.style.cssText = 'padding:6px 14px; border:1px solid #e0e3eb; background:#fff; border-radius:6px; cursor:pointer; font-size:13px; font-weight:500; color:#131722; transition:0.2s;';
            cancelBtn.onmouseover = () => cancelBtn.style.background = '#f8fafe';
            cancelBtn.onmouseout = () => cancelBtn.style.background = '#fff';
            cancelBtn.onclick = () => { isEditing = false; restoreListWrapper(); renderList(searchInput.value); };
            
            const saveBtn = document.createElement('button');
            saveBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="margin-right:4px; vertical-align:middle;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Save Script';
            saveBtn.style.cssText = 'padding:6px 14px; border:none; background:#2962FF; color:#fff; border-radius:6px; cursor:pointer; font-size:13px; font-weight:600; transition:0.2s; display:flex; align-items:center;';
            saveBtn.onmouseover = () => saveBtn.style.background = '#1E53E5';
            saveBtn.onmouseout = () => saveBtn.style.background = '#2962FF';
            
            const errorDiv = document.createElement('div');
            errorDiv.style.cssText = 'color:#f23645; font-size:12px; padding:12px 24px; background:#ffebec; border-bottom:1px solid #f23645; display:none;';
            
            saveBtn.onclick = () => {
                if(!monacoEditorInstance) return;
                try {
                    errorDiv.style.display = 'none';
                    let code = monacoEditorInstance.getValue();
                    const factory = new Function('PineJS', 'return (' + code + ');');
                    const obj = factory({ Std: {} }); 
                    
                    if (!obj || !obj.name) throw new Error("Exported script object must have a 'name' property.");
                    
                    const hasBuy = /this\.strategy\.buy|strategy\.buy|action\s*:\s*['"]BUY['"]/i.test(code);
                    const hasSell = /this\.strategy\.sell|strategy\.sell|action\s*:\s*['"]SELL['"]/i.test(code);
                    if (hasBuy && !hasSell) {
                        throw new Error("Invalid Strategy: Found Buy logic but no Sell logic. A strategy must contain both Buy and Sell operations.");
                    }
                    if (hasSell && !hasBuy) {
                        throw new Error("Invalid Strategy: Found Sell logic but no Buy logic. A strategy must contain both Buy and Sell operations.");
                    }

                    // Guarantee separate unique ID in metainfo if it's a fork
                    if (isFork) {
                        const uniqueLocalId = `${obj.name.replace(/[^a-zA-Z0-9]/g, '_')}_Local_${Date.now()}@tv-basicstudies-1`;
                        code = code.replace(/id:\s*["'][^"']+["']/, `id: "${uniqueLocalId}"`);
                    }

                    let stored = JSON.parse(localStorage.getItem('tv_local_indicators') || '{}');
                    if (!isFork && existingName && existingName !== obj.name) {
                        delete stored[existingName];
                    }
                    stored[obj.name] = code;
                    localStorage.setItem('tv_local_indicators', JSON.stringify(stored));
                    
                    sessionStorage.setItem('tv_auto_reload_study', obj.name);
                    showToast(`Saved "${obj.name}" to Local scripts.`);
                    setTimeout(() => location.reload(), 400);
                } catch (err) {
                    errorDiv.textContent = 'Validation / Syntax Error: ' + err.message;
                    errorDiv.style.display = 'block';
                }
            };
            
            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(saveBtn);
            edHeader.appendChild(titleRow);
            edHeader.appendChild(btnRow);
            
            const editorContainer = document.createElement('div');
            editorContainer.style.cssText = 'flex:1; width:100%;';
            
            listWrapper.appendChild(edHeader);
            listWrapper.appendChild(errorDiv);
            listWrapper.appendChild(editorContainer);
            
            const defaultIndicatorCode = `{\n    name: "My Script",\n    metainfo: {\n        _metainfoVersion: 52,\n        isTVScript: false,\n        is_hidden_study: false,\n        defaults: {\n            styles: { plot_0: { plottype: 0, linewidth: 2, color: "#2962FF" } },\n            inputs: {}\n        },\n        plots: [{ id: "plot_0", type: "line" }],\n        styles: { plot_0: { title: "Plot" } },\n        description: "My Script",\n        shortDescription: "My Script",\n        is_price_study: true,\n        inputs: [],\n        id: "My_Script@tv-basicstudies-1",\n        scriptIdPart: "",\n        name: "My Script"\n    },\n    constructor: function() {\n        this.init = function(ctx, input) { this._context = ctx; };\n        this.main = function(ctx, input) {\n            this._context = ctx || this._context;\n            return [{ value: PineJS.Std.close(this._context) }];\n        };\n    }\n}`;
            const defaultStrategyCode = `{\n    name: "My Strategy (Trade Chains)",\n    metainfo: {\n        _metainfoVersion: 52,\n        isTVScript: false,\n        is_hidden_study: false,\n        defaults: {\n            styles: {\n                plot_ma: { plottype: 0, linewidth: 2, color: "#2962FF" },\n                plot_buy: { plottype: "shape_label_up", location: "BelowBar", color: "#089981", textColor: "#ffffff", size: "auto" },\n                plot_sell: { plottype: "shape_label_down", location: "AboveBar", color: "#f23645", textColor: "#ffffff", size: "auto" }\n            },\n            inputs: {\n                fastPeriod: 9,\n                slowPeriod: 21\n            }\n        },\n        plots: [\n            { id: "plot_ma", type: "line" },\n            { id: "plot_buy", type: "shapes" },\n            { id: "plot_sell", type: "shapes" }\n        ],\n        styles: {\n            plot_ma: { title: "Fast MA", isHidden: false },\n            plot_buy: { title: "Buy Signal (Chain Entry)", isHidden: false, text: "Buy" },\n            plot_sell: { title: "Sell Signal (Chain Exit)", isHidden: false, text: "Sell" }\n        },\n        description: "My Strategy (Trade Chains)",\n        shortDescription: "My Strategy",\n        is_price_study: true,\n        inputs: [\n            { id: "fastPeriod", name: "Fast MA Period", defval: 9, type: "integer", min: 1 },\n            { id: "slowPeriod", name: "Slow MA Period", defval: 21, type: "integer", min: 1 }\n        ],\n        id: "My_Strategy@tv-basicstudies-1",\n        scriptIdPart: "",\n        name: "My Strategy (Trade Chains)",\n        format: { type: "price", precision: 2 }\n    },\n    constructor: function() {\n        this.init = function(ctx, get_input) {\n            this._context = ctx;\n            this._input = get_input;\n            this._chainCounter = 1;\n        };\n        this.main = function(ctx, get_input) {\n            this._context = ctx || this._context;\n            this._input = get_input || this._input;\n            \n            var fastLen = this._input(0);\n            var slowLen = this._input(1);\n            \n            var close = PineJS.Std.close(this._context);\n            var closeSeries = this._context.new_var(close);\n            var high = PineJS.Std.high(this._context);\n            var low = PineJS.Std.low(this._context);\n            \n            var fastMA = PineJS.Std.sma(closeSeries, fastLen, this._context);\n            var slowMA = PineJS.Std.sma(closeSeries, slowLen, this._context);\n            \n            var fastSeries = this._context.new_var(fastMA);\n            var slowSeries = this._context.new_var(slowMA);\n            \n            var fastPrev = fastSeries.get(1);\n            var slowPrev = slowSeries.get(1);\n            \n            var buySignal = (fastPrev <= slowPrev && fastMA > slowMA);\n            var sellSignal = (fastPrev >= slowPrev && fastMA < slowMA);\n            \n            if (!this._chainCounter) this._chainCounter = 1;\n            \n            if (this.strategy) {\n                if (buySignal) {\n                    this.strategy.buy({\n                        id: this._chainCounter,\n                        price: close,\n                        qty: 1,\n                        tag: "MA Bullish Entry"\n                    });\n                } else if (sellSignal) {\n                    this.strategy.sell({\n                        id: this._chainCounter,\n                        price: close,\n                        qty: 1,\n                        isEnd: true,\n                        tag: "MA Bearish Exit"\n                    });\n                    this._chainCounter++;\n                }\n            }\n            \n            return [\n                { value: fastMA },\n                { value: buySignal ? 1 : NaN },\n                { value: sellSignal ? 1 : NaN }\n            ];\n        };\n    }\n}`;
            
            let initialCode = existingCode;
            if (!initialCode) {
                initialCode = isStrategyTemplate ? defaultStrategyCode : defaultIndicatorCode;
            } else if (isFork) {
                // If forking, adjust name property in code to indicate local copy if not already modified
                if (existingName && !initialCode.includes(existingName + ' (Local Copy)')) {
                    initialCode = initialCode.replace(new RegExp(`name:\\s*["']${existingName}["']`, 'g'), `name: "${existingName} (Local Copy)"`);
                }
            }

            if (window.require && !window.monaco) {
                require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.39.0/min/vs' }});
                require(['vs/editor/editor.main'], function() {
                    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
                    monacoEditorInstance = monaco.editor.create(editorContainer, {
                        value: initialCode, language: 'javascript', theme: 'vs-light',
                        minimap: { enabled: true, scale: 0.75 }, automaticLayout: true, fontSize: 13,
                        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace", scrollBeyondLastLine: false,
                        roundedSelection: false, padding: { top: 16 }
                    });
                });
            } else if (window.monaco) {
                monacoEditorInstance = monaco.editor.create(editorContainer, {
                    value: initialCode, language: 'javascript', theme: 'vs-light',
                    minimap: { enabled: true, scale: 0.75 }, automaticLayout: true, fontSize: 13,
                    scrollBeyondLastLine: false, padding: { top: 16 }
                });
            }
        }
        
        function restoreListWrapper() {
            listWrapper.innerHTML = '';
            listWrapper.appendChild(listHeader);
            listWrapper.appendChild(listContainer);
        }

        // --- RENDER INDICATORS & STRATEGIES LIST ---
        function renderList(searchQuery = "") {
            if (isEditing) return;
            
            const favs = getFavorites();
            if (favs.length > 0 || activeTab === 'favorites') {
                tabFavorites.style.display = 'flex';
            } else {
                tabFavorites.style.display = 'none';
                if (activeTab === 'favorites') {
                    activeTab = 'custom';
                    tabCustom.className = 'tv-custom-modal-tab active';
                    tabFavorites.className = 'tv-custom-modal-tab';
                }
            }

            listContainer.innerHTML = '';

            // 1. Pre-bundled Default Scripts
            const defaultScripts = [
                {
                    name: "SuperTrend Custom",
                    displayName: "SuperTrend Custom",
                    isStrat: false,
                    sourceType: "default",
                    isDefault: true,
                    code: getDefaultScriptCode("SuperTrend Custom")
                },
                {
                    name: "5 EMA Crossover",
                    displayName: "5 EMA Crossover",
                    isStrat: false,
                    sourceType: "default",
                    isDefault: true,
                    code: getDefaultScriptCode("5 EMA Crossover")
                },
                {
                    name: "SuperTrend Strategy (Trade Chains)",
                    displayName: "SuperTrend Strategy (Trade Chains)",
                    isStrat: true,
                    sourceType: "default",
                    isDefault: true,
                    code: getDefaultScriptCode("SuperTrend Strategy (Trade Chains)")
                }
            ];

            // 2. Local Scripts (from localStorage)
            let storedLocal = {};
            try { storedLocal = JSON.parse(localStorage.getItem('tv_local_indicators') || '{}'); } catch(e){}
            const localScripts = Object.keys(storedLocal).map(name => {
                const code = storedLocal[name] || '';
                const isStrat = name.includes("Strategy") || (window.isStrategyScript && window.isStrategyScript(code));
                return {
                    name: name,
                    displayName: name,
                    isStrat: isStrat,
                    sourceType: "local",
                    isLocal: true,
                    code: code
                };
            });

            // 3. Remote Synced Scripts (from ScriptRepoManager)
            let remoteScripts = [];
            if (window.ScriptRepoManager && window.ScriptRepoManager.remoteIndicators) {
                remoteScripts = Object.values(window.ScriptRepoManager.remoteIndicators).map(item => {
                    return {
                        name: item.name,
                        displayName: item.name,
                        isStrat: !!item.isStrategy,
                        sourceType: item.provider || 'github',
                        isRemote: true,
                        repoName: item.repoName,
                        repoId: item.repoId,
                        remoteKey: item.key,
                        code: item.code
                    };
                });
            }

            // 4. Builtin Scripts (Technicals)
            const knownCustomNames = new Set([
                ...defaultScripts.map(s => s.name),
                ...localScripts.map(s => s.name),
                ...remoteScripts.map(s => s.name)
            ]);
            const builtinScripts = allStudies.filter(s => !knownCustomNames.has(s)).map(name => {
                const isStrat = name.toLowerCase().includes('strategy');
                return {
                    name: name,
                    displayName: name,
                    isStrat: isStrat,
                    sourceType: "builtin",
                    isBuiltin: true
                };
            });

            // Tab filtering
            let items = [];
            if (activeTab === 'favorites') {
                const allPool = [...defaultScripts, ...localScripts, ...remoteScripts, ...builtinScripts];
                items = allPool.filter(item => favs.includes(item.name));
            } else if (activeTab === 'custom') {
                items = [...defaultScripts, ...localScripts, ...remoteScripts];
            } else {
                items = builtinScripts;
            }

            // Search query filter
            if (searchQuery && searchQuery.trim() !== '') {
                const q = searchQuery.trim().toLowerCase();
                const allPool = [...defaultScripts, ...localScripts, ...remoteScripts, ...builtinScripts];
                items = allPool.filter(item => {
                    const dName = item.displayName.toLowerCase();
                    const rName = (item.repoName || '').toLowerCase();
                    return dName.includes(q) || rName.includes(q);
                });
            }

            // Type filter
            if (currentTypeFilter === 'indicator') {
                items = items.filter(item => !item.isStrat);
            } else if (currentTypeFilter === 'strategy') {
                items = items.filter(item => item.isStrat);
            }

            // Source filter
            if (currentSourceFilter === 'default') {
                items = items.filter(item => item.sourceType === 'default');
            } else if (currentSourceFilter === 'local') {
                items = items.filter(item => item.sourceType === 'local');
            } else if (currentSourceFilter === 'github') {
                items = items.filter(item => item.sourceType === 'github');
            } else if (currentSourceFilter === 'huggingface') {
                items = items.filter(item => item.sourceType === 'huggingface');
            }

            // Update header count
            const countEl = document.getElementById('tv-list-count');
            if (countEl) {
                countEl.textContent = `${items.length} script${items.length === 1 ? '' : 's'}`;
            }

            // Top action buttons in Custom scripts tab
            if (activeTab === 'custom' && !searchQuery) {
                const btnContainer = document.createElement('div');
                btnContainer.style.cssText = 'display:flex; gap:8px; margin:8px 0 16px 0; flex-wrap:wrap;';

                const addIndBtn = document.createElement('div');
                addIndBtn.style.cssText = 'flex:1; min-width:140px; padding:10px 12px; cursor:pointer; font-size:13px; color:#2962FF; display:flex; align-items:center; border:1px dashed #2962FF; border-radius:8px; font-weight:600; justify-content:center; background:#f8fafe; transition:all 0.1s ease;';
                addIndBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 18 18" style="margin-right:6px;" fill="none"><path d="M9 4v10m-5-5h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Create Indicator';
                addIndBtn.onmouseover = () => { addIndBtn.style.background = '#2962FF'; addIndBtn.style.color = '#fff'; };
                addIndBtn.onmouseout = () => { addIndBtn.style.background = '#f8fafe'; addIndBtn.style.color = '#2962FF'; };
                addIndBtn.onclick = () => showEditor();

                const addStratBtn = document.createElement('div');
                addStratBtn.style.cssText = 'flex:1; min-width:140px; padding:10px 12px; cursor:pointer; font-size:13px; color:#7B1FA2; display:flex; align-items:center; border:1px dashed #7B1FA2; border-radius:8px; font-weight:600; justify-content:center; background:#fdf7ff; transition:all 0.1s ease;';
                addStratBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" style="margin-right:6px;" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg> Create Strategy';
                addStratBtn.onmouseover = () => { addStratBtn.style.background = '#7B1FA2'; addStratBtn.style.color = '#fff'; };
                addStratBtn.onmouseout = () => { addStratBtn.style.background = '#fdf7ff'; addStratBtn.style.color = '#7B1FA2'; };
                addStratBtn.onclick = () => showEditor('', null, true);

                const repoCount = (window.ScriptRepoManager && window.ScriptRepoManager.repos) ? window.ScriptRepoManager.repos.length : 0;
                const repoBtn = document.createElement('div');
                repoBtn.style.cssText = 'flex:1; min-width:160px; padding:10px 12px; cursor:pointer; font-size:13px; color:#0f172a; display:flex; align-items:center; border:1px solid #cbd5e1; border-radius:8px; font-weight:600; justify-content:center; background:#f8fafc; transition:all 0.1s ease;';
                repoBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" style="margin-right:6px;"><path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5z"/></svg> Repositories & Sync ${repoCount > 0 ? `<span style="margin-left:6px; background:#0f172a; color:#fff; border-radius:10px; font-size:10px; padding:1px 6px;">${repoCount}</span>` : ''}`;
                repoBtn.onmouseover = () => { repoBtn.style.background = '#0f172a'; repoBtn.style.color = '#fff'; };
                repoBtn.onmouseout = () => { repoBtn.style.background = '#f8fafc'; repoBtn.style.color = '#0f172a'; };
                repoBtn.onclick = () => openRepoManagerModal();

                btnContainer.appendChild(addIndBtn);
                btnContainer.appendChild(addStratBtn);
                btnContainer.appendChild(repoBtn);
                listContainer.appendChild(btnContainer);
            }
            
            // Fetch currently applied studies to show Active badge and prevent duplicate strategy instances
            let currentStudies = [];
            try {
                const chart = widget.chart();
                if (chart && chart.getAllStudies) {
                    currentStudies = chart.getAllStudies() || [];
                }
            } catch (_) {}

            const fragment = document.createDocumentFragment();
            
            items.forEach(item => {
                const isFav = favs.includes(item.name);
                const targetName = (item.name || '').trim().toLowerCase();

                const isAlreadyOnChart = currentStudies.some(s => {
                    const sName = (s.name || '').trim().toLowerCase();
                    return sName === targetName;
                });
                
                const row = document.createElement('div');
                row.style.cssText = 'padding:11px 16px; cursor:pointer; font-size:14px; color:#131722; font-weight:500; display:flex; align-items:center; border-radius:8px; margin-bottom:4px; border:1px solid transparent; transition:background 0.1s;';
                
                // Star Icon
                const star = document.createElement('div');
                star.className = isFav ? 'tv-star-icon active' : 'tv-star-icon';
                star.innerHTML = isFav 
                    ? '<svg width="18" height="18" viewBox="0 0 18 18" stroke="currentColor" stroke-width="1.5"><path d="M9 1.5l2.25 4.75L16 7l-3.5 3.5L13.5 15.5 9 13 4.5 15.5 5.5 10.5 2 7l4.75-.75L9 1.5z" stroke-linejoin="round" fill="currentColor" /></svg>'
                    : '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 1.5l2.25 4.75L16 7l-3.5 3.5L13.5 15.5 9 13 4.5 15.5 5.5 10.5 2 7l4.75-.75L9 1.5z" stroke-linejoin="round" /></svg>';
                star.onclick = (e) => { e.stopPropagation(); toggleFavorite(item.name); };
                row.appendChild(star);
                
                // Title and Badges
                const titleSpan = document.createElement('span');
                titleSpan.style.cssText = 'flex:1; display:flex; align-items:center; gap:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
                
                const nameLabel = document.createElement('span');
                nameLabel.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
                nameLabel.textContent = item.displayName;
                titleSpan.appendChild(nameLabel);

                // Type Badge
                const typeBadge = document.createElement('span');
                typeBadge.className = 'tv-badge-pill ' + (item.isStrat ? 'tv-badge-type-strat' : 'tv-badge-type-ind');
                typeBadge.textContent = item.isStrat ? 'Strategy' : 'Indicator';
                titleSpan.appendChild(typeBadge);

                // Source Badge
                if (item.sourceType === 'default') {
                    const srcBadge = document.createElement('span');
                    srcBadge.className = 'tv-badge-pill tv-badge-source-default';
                    srcBadge.textContent = 'Default';
                    titleSpan.appendChild(srcBadge);
                } else if (item.sourceType === 'local') {
                    const srcBadge = document.createElement('span');
                    srcBadge.className = 'tv-badge-pill tv-badge-source-local';
                    srcBadge.textContent = item.name.includes('(Local Copy)') ? 'Local Copy' : 'Local';
                    titleSpan.appendChild(srcBadge);
                } else if (item.sourceType === 'github') {
                    const srcBadge = document.createElement('span');
                    srcBadge.className = 'tv-badge-pill tv-badge-source-github';
                    srcBadge.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style="margin-right:2px;"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>GitHub: ${item.repoName || ''}`;
                    titleSpan.appendChild(srcBadge);
                } else if (item.sourceType === 'huggingface') {
                    const srcBadge = document.createElement('span');
                    srcBadge.className = 'tv-badge-pill tv-badge-source-hf';
                    srcBadge.textContent = `🤗 HF: ${item.repoName || ''}`;
                    titleSpan.appendChild(srcBadge);
                }

                // Active Badge
                if (isAlreadyOnChart) {
                    const activeBadge = document.createElement('span');
                    activeBadge.className = 'tv-badge-pill tv-badge-active';
                    activeBadge.textContent = 'Active';
                    titleSpan.appendChild(activeBadge);
                }

                row.appendChild(titleSpan);
                
                // Action Buttons
                const actions = document.createElement('div');
                actions.style.cssText = 'display:flex; gap:6px; align-items:center;';

                if (item.isLocal) {
                    const editBtn = document.createElement('div');
                    editBtn.className = 'tv-item-action-btn';
                    editBtn.title = 'Edit Local Script';
                    editBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
                    editBtn.onclick = (e) => { e.stopPropagation(); showEditor(item.code, item.name); };
                    
                    const delBtn = document.createElement('div');
                    delBtn.className = 'tv-item-action-btn tv-del-btn';
                    delBtn.title = 'Delete Local Script';
                    delBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
                    delBtn.onclick = (e) => { 
                        e.stopPropagation(); 
                        if(confirm("Delete local script '" + item.name + "'?")) {
                            delete storedLocal[item.name];
                            localStorage.setItem('tv_local_indicators', JSON.stringify(storedLocal));
                            let fs = getFavorites();
                            if(fs.includes(item.name)) {
                                localStorage.setItem('tv_favorite_indicators', JSON.stringify(fs.filter(f => f !== item.name)));
                            }
                            location.reload();
                        }
                    };
                    
                    actions.appendChild(editBtn);
                    actions.appendChild(delBtn);
                } else if (item.isRemote) {
                    const forkBtn = document.createElement('div');
                    forkBtn.className = 'tv-item-action-btn';
                    forkBtn.title = 'Fork & Edit Local Working Copy';
                    forkBtn.innerHTML = `
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;">
                            <line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path>
                        </svg>
                        <span>Fork</span>
                    `;
                    forkBtn.onclick = (e) => {
                        e.stopPropagation();
                        showEditor(item.code, item.name, item.isStrat, true, item.name);
                    };
                    actions.appendChild(forkBtn);
                } else if (item.isDefault) {
                    const forkBtn = document.createElement('div');
                    forkBtn.className = 'tv-item-action-btn';
                    forkBtn.title = 'View / Fork as Local Working Copy';
                    forkBtn.innerHTML = `
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;">
                            <line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path>
                        </svg>
                        <span>Fork</span>
                    `;
                    forkBtn.onclick = (e) => {
                        e.stopPropagation();
                        showEditor(item.code, item.name, item.isStrat, true, item.name);
                    };
                    actions.appendChild(forkBtn);
                }

                if (actions.children.length > 0) {
                    row.appendChild(actions);
                }
                
                row.onmouseover = () => { row.style.background = '#f8fafe'; row.style.borderColor = '#e0e3eb'; };
                row.onmouseout = () => { row.style.background = 'transparent'; row.style.borderColor = 'transparent'; };
                
                row.onclick = () => {
                    // Block adding the exact same strategy multiple times
                    if (item.isStrat) {
                        let alreadyAdded = false;
                        try {
                            const chart = widget.chart();
                            const existing = (chart && chart.getAllStudies) ? (chart.getAllStudies() || []) : [];
                            const targetName = (item.name || '').trim().toLowerCase();
                            alreadyAdded = existing.some(s => {
                                const sName = (s.name || '').trim().toLowerCase();
                                return sName === targetName;
                            });
                        } catch (_) {}

                        if (alreadyAdded) {
                            showToast(`Strategy "${item.displayName}" is already active on the chart.`);
                            if (window.StrategyEngine) {
                                window.StrategyEngine.setActiveStrategy(item.name);
                            }
                            if (window.StrategyTesterUI) {
                                window.StrategyTesterUI.show();
                            }
                            closeModal();
                            return;
                        }
                    }

                    try {
                        widget.chart().createStudy(item.name, false, false);
                        if (item.isStrat && window.StrategyTesterUI) {
                            window.StrategyTesterUI.show();
                        }
                    } catch (err) {
                        console.error("Failed to add study:", err);
                        showToast("Could not load study. Reloading chart...");
                        sessionStorage.setItem('tv_auto_reload_study', item.name);
                        location.reload();
                    }
                    closeModal();
                };
                fragment.appendChild(row);
            });
            
            listContainer.appendChild(fragment);
            
            if(items.length === 0) {
                listContainer.innerHTML = '<div style="padding:40px; color:#b2b5be; text-align:center; font-size:14px; font-weight:500;">No scripts found matching your filters</div>';
            }
        }
        
        function openModal() {
            if (allStudies.length === 0) {
                try { 
                    const rawStudies = widget.getStudiesList() || [];
                    allStudies = rawStudies.map(s => (typeof s === 'string' ? s : (s.name || s.description || ""))).filter(Boolean);
                } catch(e) {}
            }
            modalOverlay.classList.add('visible');
            searchInput.value = '';
            isEditing = false;
            restoreListWrapper();
            activeTab = getFavorites().length > 0 ? 'favorites' : 'custom';
            tabFavorites.className = activeTab === 'favorites' ? 'tv-custom-modal-tab active' : 'tv-custom-modal-tab';
            tabCustom.className = activeTab === 'custom' ? 'tv-custom-modal-tab active' : 'tv-custom-modal-tab';
            tabBuiltin.className = 'tv-custom-modal-tab';
            renderList();
            if (!('ontouchstart' in window) && !navigator.maxTouchPoints) {
                setTimeout(() => searchInput.focus(), 100);
            }
        }
        
        function closeModal(e) {
            if (e) {
                e.stopPropagation();
                if (e.type === 'touchend' && e.cancelable) e.preventDefault();
            }
            modalOverlay.classList.remove('visible');
        }
        
        const closeBtn = header.querySelector('#tv-close-modal');
        closeBtn.addEventListener('click', closeModal);
        closeBtn.addEventListener('touchend', closeModal);
        
        modalOverlay.addEventListener('click', e => { if(e.target === modalOverlay) closeModal(e); });
        modalOverlay.addEventListener('touchend', e => { if(e.target === modalOverlay) closeModal(e); });
        modalOverlay.addEventListener('touchmove', e => e.stopPropagation(), { passive: true });
        modalOverlay.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
        
        tabFavorites.addEventListener('click', () => {
            if (searchInput.value.trim() !== '') searchInput.value = '';
            activeTab = 'favorites';
            if (!isEditing) restoreListWrapper();
            isEditing = false;
            tabFavorites.className = 'tv-custom-modal-tab active';
            tabCustom.className = 'tv-custom-modal-tab';
            tabBuiltin.className = 'tv-custom-modal-tab';
            renderList();
        });

        tabCustom.addEventListener('click', () => {
            if (searchInput.value.trim() !== '') searchInput.value = '';
            activeTab = 'custom';
            if (!isEditing) restoreListWrapper();
            isEditing = false;
            tabCustom.className = 'tv-custom-modal-tab active';
            tabFavorites.className = 'tv-custom-modal-tab';
            tabBuiltin.className = 'tv-custom-modal-tab';
            renderList();
        });
        
        tabBuiltin.addEventListener('click', () => {
            if (searchInput.value.trim() !== '') searchInput.value = '';
            activeTab = 'builtin';
            if (!isEditing) restoreListWrapper();
            isEditing = false;
            tabBuiltin.className = 'tv-custom-modal-tab active';
            tabFavorites.className = 'tv-custom-modal-tab';
            tabCustom.className = 'tv-custom-modal-tab';
            renderList();
        });
        
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (isEditing) {
                isEditing = false;
                restoreListWrapper();
            }
            if (query !== '') {
                tabFavorites.className = 'tv-custom-modal-tab'; tabFavorites.style.opacity = '0.5';
                tabCustom.className = 'tv-custom-modal-tab'; tabCustom.style.opacity = '0.5';
                tabBuiltin.className = 'tv-custom-modal-tab'; tabBuiltin.style.opacity = '0.5';
            } else {
                tabFavorites.style.opacity = '1'; tabCustom.style.opacity = '1'; tabBuiltin.style.opacity = '1';
                tabFavorites.className = activeTab === 'favorites' ? 'tv-custom-modal-tab active' : 'tv-custom-modal-tab';
                tabCustom.className = activeTab === 'custom' ? 'tv-custom-modal-tab active' : 'tv-custom-modal-tab';
                tabBuiltin.className = activeTab === 'builtin' ? 'tv-custom-modal-tab active' : 'tv-custom-modal-tab';
            }
            renderList(query);
        });

        // ==============================================================
        // --- REPOSITORIES & ACCESS TOKENS MANAGEMENT MODAL ---
        // ==============================================================
        let repoModalTab = 'repos'; // 'repos' or 'tokens'
        let editingRepoId = null;
        let editingTokenId = null;

        const repoModalOverlay = document.createElement('div');
        repoModalOverlay.className = 'tv-repo-modal-overlay';

        const repoModal = document.createElement('div');
        repoModal.className = 'tv-repo-modal';

        // Modal Header
        const repoHeader = document.createElement('div');
        repoHeader.style.cssText = 'padding:18px 24px 14px 24px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e0e3eb; background:#ffffff;';
        repoHeader.innerHTML = `
            <div>
                <div style="font-size:17px; font-weight:700; color:#131722; letter-spacing:-0.2px;">Script Repositories & Tokens</div>
                <div style="font-size:12px; color:#787b86; margin-top:2px;">Sync indicators and strategies directly from GitHub and Hugging Face</div>
            </div>
            <div id="tv-close-repo-modal" style="cursor:pointer; color:#787b86; padding:8px; border-radius:4px; display:flex; align-items:center; justify-content:center;">
                <svg width="18" height="18" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12m0-12L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </div>
        `;
        repoHeader.querySelector('#tv-close-repo-modal').onclick = () => closeRepoManagerModal();

        // Subtabs
        const repoTabBar = document.createElement('div');
        repoTabBar.className = 'tv-repo-tab-bar';
        repoTabBar.innerHTML = `
            <div class="tv-repo-tab-item active" data-tab="repos">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5z"/></svg>
                <span>Repositories</span>
                <span id="tv-repo-badge-count" style="background:#e0e3eb; color:#131722; font-size:11px; padding:1px 6px; border-radius:10px; font-weight:700;">0</span>
            </div>
            <div class="tv-repo-tab-item" data-tab="tokens">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                <span>Access Tokens</span>
                <span id="tv-token-badge-count" style="background:#e0e3eb; color:#131722; font-size:11px; padding:1px 6px; border-radius:10px; font-weight:700;">0</span>
            </div>
        `;

        repoTabBar.querySelectorAll('.tv-repo-tab-item').forEach(tabEl => {
            tabEl.onclick = () => {
                repoTabBar.querySelectorAll('.tv-repo-tab-item').forEach(t => t.classList.remove('active'));
                tabEl.classList.add('active');
                repoModalTab = tabEl.getAttribute('data-tab');
                renderRepoManagerContent();
            };
        });

        // Content Area
        const repoContentArea = document.createElement('div');
        repoContentArea.style.cssText = 'flex:1; overflow-y:auto; padding:20px 24px; background:#fafbfc; min-height:0;';

        repoModal.appendChild(repoHeader);
        repoModal.appendChild(repoTabBar);
        repoModal.appendChild(repoContentArea);
        repoModalOverlay.appendChild(repoModal);
        document.body.appendChild(repoModalOverlay);

        repoModalOverlay.onclick = (e) => { if (e.target === repoModalOverlay) closeRepoManagerModal(); };

        function openRepoManagerModal() {
            repoModalOverlay.classList.add('visible');
            editingRepoId = null;
            editingTokenId = null;
            updateRepoModalBadges();
            renderRepoManagerContent();
        }

        function closeRepoManagerModal() {
            repoModalOverlay.classList.remove('visible');
            renderList(searchInput.value);
        }

        function updateRepoModalBadges() {
            if (!window.ScriptRepoManager) return;
            const repoCount = window.ScriptRepoManager.repos.length;
            const tokenCount = window.ScriptRepoManager.tokens.length;
            const rBadge = document.getElementById('tv-repo-badge-count');
            const tBadge = document.getElementById('tv-token-badge-count');
            if (rBadge) rBadge.textContent = repoCount;
            if (tBadge) tBadge.textContent = tokenCount;
        }

        function renderRepoManagerContent() {
            updateRepoModalBadges();
            repoContentArea.innerHTML = '';
            if (repoModalTab === 'repos') {
                renderReposView();
            } else {
                renderTokensView();
            }
        }

        // --- REPOSITORIES TAB VIEW ---
        function renderReposView() {
            if (!window.ScriptRepoManager) return;
            const repos = window.ScriptRepoManager.getRepos();

            // Top Toolbar
            const topBar = document.createElement('div');
            topBar.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;';
            topBar.innerHTML = `
                <div style="font-size:14px; font-weight:700; color:#131722;">Configured Repositories</div>
                <div style="display:flex; gap:8px;">
                    <button id="tv-sync-all-btn" style="display:flex; align-items:center; gap:6px; padding:7px 12px; border:1px solid #cbd5e1; background:#ffffff; color:#131722; font-size:12.5px; font-weight:600; border-radius:6px; cursor:pointer; transition:0.15s;">
                        <svg class="${window.ScriptRepoManager.isSyncing ? 'tv-spin' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
                        <span>${window.ScriptRepoManager.isSyncing ? 'Syncing...' : 'Sync All'}</span>
                    </button>
                    <button id="tv-add-repo-btn" style="display:flex; align-items:center; gap:6px; padding:7px 14px; border:none; background:#2962FF; color:#ffffff; font-size:12.5px; font-weight:600; border-radius:6px; cursor:pointer; transition:0.15s;">
                        <svg width="14" height="14" viewBox="0 0 18 18" fill="none"><path d="M9 4v10m-5-5h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
                        <span>Add Repository</span>
                    </button>
                </div>
            `;

            topBar.querySelector('#tv-sync-all-btn').onclick = async () => {
                const btn = topBar.querySelector('#tv-sync-all-btn');
                btn.disabled = true;
                btn.querySelector('svg').classList.add('tv-spin');
                btn.querySelector('span').textContent = 'Syncing...';
                await window.ScriptRepoManager.syncAll(true);
                showToast("All repositories checked and synchronized.");
                renderReposView();
                renderList(searchInput.value);
            };

            topBar.querySelector('#tv-add-repo-btn').onclick = () => {
                showRepoForm();
            };

            repoContentArea.appendChild(topBar);

            // Repo Form Container (if editing or adding)
            const formContainer = document.createElement('div');
            formContainer.id = 'tv-repo-form-container';
            repoContentArea.appendChild(formContainer);

            // Empty state
            if (repos.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = 'background:#ffffff; border:1px dashed #cbd5e1; border-radius:10px; padding:40px 24px; text-align:center; color:#64748b; margin-top:10px;';
                empty.innerHTML = `
                    <div style="font-size:28px; margin-bottom:10px;">📦</div>
                    <div style="font-size:15px; font-weight:700; color:#1e293b; margin-bottom:6px;">No Repositories Added Yet</div>
                    <div style="font-size:13px; max-width:440px; margin:0 auto 16px auto; line-height:1.4;">
                        Add a public or private GitHub repository or Hugging Face dataset to automatically discover and sync your indicators and strategies.
                    </div>
                    <button id="tv-empty-add-repo" style="padding:8px 16px; background:#2962FF; color:#fff; border:none; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer;">
                        Add Your First Repository
                    </button>
                `;
                empty.querySelector('#tv-empty-add-repo').onclick = () => showRepoForm();
                repoContentArea.appendChild(empty);
                return;
            }

            // Repos List
            const listEl = document.createElement('div');
            repos.forEach(repo => {
                const card = document.createElement('div');
                card.className = 'tv-repo-card';

                const isGH = repo.type === 'github';
                const tokenObj = repo.tokenId ? window.ScriptRepoManager.getTokenById(repo.tokenId) : null;
                const tokenLabel = tokenObj ? `🔑 ${tokenObj.name}` : `🔓 Public (No Token)`;

                let statusColor = '#089981';
                let statusText = `${repo.scriptCount || 0} scripts synced`;
                if (repo.syncStatus === 'syncing') {
                    statusColor = '#2962FF';
                    statusText = 'Syncing...';
                } else if (repo.syncStatus === 'error') {
                    statusColor = '#f23645';
                    statusText = repo.error || 'Sync Error';
                } else if (repo.syncStatus === 'idle') {
                    statusColor = '#787b86';
                    statusText = 'Not synced yet';
                }

                card.innerHTML = `
                    <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">
                        <div style="width:36px; height:36px; border-radius:8px; background:${isGH ? '#0f172a' : '#fef3c7'}; display:flex; align-items:center; justify-content:center; color:${isGH ? '#fff' : '#b45309'}; flex-shrink:0;">
                            ${isGH 
                                ? '<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>'
                                : '<span style="font-size:18px;">🤗</span>'}
                        </div>
                        <div style="min-width:0; flex:1;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <a href="${repo.url}" target="_blank" style="font-size:14px; font-weight:700; color:#131722; text-decoration:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                                    ${repo.repoId || (repo.owner + '/' + repo.repo)}
                                </a>
                                <span style="font-size:11px; background:#f1f5f9; color:#475569; padding:1px 6px; border-radius:4px; font-weight:600;">
                                    ${repo.branch}
                                </span>
                            </div>
                            <div style="display:flex; align-items:center; gap:12px; margin-top:4px; font-size:12px; color:#64748b;">
                                <span>${tokenLabel}</span>
                                <span>•</span>
                                <span style="color:${statusColor}; font-weight:600; display:flex; align-items:center; gap:4px;">
                                    <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:${statusColor};"></span>
                                    ${statusText}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <button class="tv-repo-sync-btn" title="Sync this repository" style="background:#f8fafe; border:1px solid #cbd5e1; border-radius:6px; padding:6px 10px; cursor:pointer; font-size:12px; font-weight:600; color:#1e293b; display:flex; align-items:center; gap:4px;">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
                            <span>Sync</span>
                        </button>
                        <button class="tv-repo-edit-btn" title="Edit repository settings" style="background:#f8fafe; border:1px solid #cbd5e1; border-radius:6px; padding:6px 8px; cursor:pointer; color:#64748b;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="tv-repo-del-btn" title="Delete repository" style="background:#f8fafe; border:1px solid #cbd5e1; border-radius:6px; padding:6px 8px; cursor:pointer; color:#ef4444;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                `;

                card.querySelector('.tv-repo-sync-btn').onclick = async () => {
                    const btn = card.querySelector('.tv-repo-sync-btn');
                    btn.disabled = true;
                    btn.querySelector('svg').classList.add('tv-spin');
                    btn.querySelector('span').textContent = '...';
                    const res = await window.ScriptRepoManager.syncRepo(repo);
                    if (res.updated) {
                        showToast(`Synced ${res.scriptCount} scripts from ${repo.repo || repo.repoId}`);
                    } else if (res.error) {
                        showToast(`Sync error: ${res.error}`);
                    } else {
                        showToast(`Up to date: ${repo.repo || repo.repoId}`);
                    }
                    renderReposView();
                    renderList(searchInput.value);
                };

                card.querySelector('.tv-repo-edit-btn').onclick = () => {
                    showRepoForm(repo);
                };

                card.querySelector('.tv-repo-del-btn').onclick = () => {
                    if (confirm(`Delete repository "${repo.repo || repo.repoId}"? All synced scripts from this repo will also be removed.`)) {
                        window.ScriptRepoManager.deleteRepo(repo.id);
                        showToast("Repository removed.");
                        renderReposView();
                        renderList(searchInput.value);
                    }
                };

                listEl.appendChild(card);
            });

            repoContentArea.appendChild(listEl);
        }

        // --- ADD / EDIT REPO FORM ---
        function showRepoForm(existingRepo = null) {
            const container = document.getElementById('tv-repo-form-container');
            if (!container) return;

            const isEdit = !!existingRepo;
            const tokens = window.ScriptRepoManager.getTokens();

            container.innerHTML = `
                <div style="background:#ffffff; border:1px solid #2962FF; border-radius:8px; padding:18px; margin-bottom:16px; box-shadow:0 4px 12px rgba(41,98,255,0.08);">
                    <div style="font-size:14px; font-weight:700; color:#131722; margin-bottom:12px;">
                        ${isEdit ? 'Edit Repository' : 'Add Repository'}
                    </div>
                    <div style="display:flex; flex-direction:column; gap:12px;">
                        <div>
                            <label style="font-size:12px; font-weight:600; color:#475569; display:block; margin-bottom:4px;">
                                Repository URL or Identifier *
                            </label>
                            <input id="tv-form-repo-url" type="text" value="${existingRepo ? existingRepo.url : ''}" placeholder="e.g. https://github.com/owner/repo or huggingface.co/datasets/owner/repo" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; box-sizing:border-box; outline:none;" />
                            <div id="tv-form-repo-detected" style="font-size:11.5px; color:#2962FF; margin-top:3px; font-weight:600; min-height:16px;"></div>
                        </div>
                        <div style="display:flex; gap:12px;">
                            <div style="flex:1;">
                                <label style="font-size:12px; font-weight:600; color:#475569; display:block; margin-bottom:4px;">
                                    Branch
                                </label>
                                <input id="tv-form-repo-branch" type="text" value="${existingRepo ? existingRepo.branch : 'main'}" placeholder="main" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; box-sizing:border-box; outline:none;" />
                            </div>
                            <div style="flex:1;">
                                <label style="font-size:12px; font-weight:600; color:#475569; display:block; margin-bottom:4px;">
                                    Linked Access Token
                                </label>
                                <select id="tv-form-repo-token" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; box-sizing:border-box; outline:none; background:#fff;">
                                    <option value="">None (Public Repository)</option>
                                    ${tokens.map(t => `<option value="${t.id}" ${existingRepo && existingRepo.tokenId === t.id ? 'selected' : ''}>${t.name} (${t.provider}) - ${window.ScriptRepoManager.maskToken(t.token)}</option>`).join('')}
                                    <option value="__ADD_NEW__">+ Add New Token...</option>
                                </select>
                            </div>
                        </div>
                        <div id="tv-form-repo-error" style="color:#ef4444; font-size:12px; display:none;"></div>
                        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:4px;">
                            <button id="tv-form-repo-cancel" style="padding:7px 14px; border:1px solid #cbd5e1; background:#fff; border-radius:6px; font-size:12.5px; font-weight:600; cursor:pointer;">
                                Cancel
                            </button>
                            <button id="tv-form-repo-save" style="padding:7px 18px; border:none; background:#2962FF; color:#fff; border-radius:6px; font-size:12.5px; font-weight:600; cursor:pointer;">
                                ${isEdit ? 'Update Repository' : 'Save & Sync'}
                            </button>
                        </div>
                    </div>
                </div>
            `;

            const urlInput = container.querySelector('#tv-form-repo-url');
            const detectedEl = container.querySelector('#tv-form-repo-detected');
            const tokenSelect = container.querySelector('#tv-form-repo-token');
            const errEl = container.querySelector('#tv-form-repo-error');

            function updateDetection() {
                const val = urlInput.value.trim();
                if (!val) { detectedEl.textContent = ''; return; }
                try {
                    const parsed = window.ScriptRepoManager.parseRepoInput(val);
                    if (parsed.type === 'github') {
                        detectedEl.textContent = `✓ Detected GitHub: ${parsed.owner}/${parsed.repo}`;
                        detectedEl.style.color = '#089981';
                    } else {
                        detectedEl.textContent = `✓ Detected Hugging Face (${parsed.repoType}): ${parsed.repoId}`;
                        detectedEl.style.color = '#b45309';
                    }
                } catch (_) {
                    detectedEl.textContent = 'Paste a GitHub URL (e.g. github.com/owner/repo) or Hugging Face dataset URL';
                    detectedEl.style.color = '#64748b';
                }
            }
            urlInput.oninput = updateDetection;
            updateDetection();

            tokenSelect.onchange = () => {
                if (tokenSelect.value === '__ADD_NEW__') {
                    repoModalTab = 'tokens';
                    repoTabBar.querySelectorAll('.tv-repo-tab-item').forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === 'tokens'));
                    renderRepoManagerContent();
                    showTokenForm();
                }
            };

            container.querySelector('#tv-form-repo-cancel').onclick = () => {
                container.innerHTML = '';
            };

            container.querySelector('#tv-form-repo-save').onclick = async () => {
                try {
                    errEl.style.display = 'none';
                    const urlVal = urlInput.value.trim();
                    const branchVal = container.querySelector('#tv-form-repo-branch').value.trim() || 'main';
                    const tokenVal = tokenSelect.value && tokenSelect.value !== '__ADD_NEW__' ? tokenSelect.value : null;

                    let repoObj;
                    if (isEdit) {
                        repoObj = window.ScriptRepoManager.updateRepo(existingRepo.id, urlVal, branchVal, tokenVal);
                        showToast("Repository updated.");
                    } else {
                        repoObj = window.ScriptRepoManager.addRepo(urlVal, branchVal, tokenVal);
                        showToast("Repository added! Performing initial sync...");
                    }
                    container.innerHTML = '';
                    renderReposView();

                    // Initial sync in background
                    window.ScriptRepoManager.syncRepo(repoObj).then(res => {
                        if (res.updated) {
                            showToast(`Synced ${res.scriptCount} scripts from ${repoObj.repo || repoObj.repoId}`);
                            renderReposView();
                            renderList(searchInput.value);
                        } else if (res.error) {
                            showToast(`Initial sync failed: ${res.error}`);
                            renderReposView();
                        }
                    });
                } catch (err) {
                    errEl.textContent = err.message;
                    errEl.style.display = 'block';
                }
            };
        }

        // --- ACCESS TOKENS TAB VIEW ---
        function renderTokensView() {
            if (!window.ScriptRepoManager) return;
            const tokens = window.ScriptRepoManager.getTokens();

            const infoBox = document.createElement('div');
            infoBox.style.cssText = 'background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:12px 16px; margin-bottom:16px; font-size:12.5px; color:#1e40af; line-height:1.4;';
            infoBox.innerHTML = `
                <div style="font-weight:700; margin-bottom:2px;">🔒 Safe & Private Token Storage</div>
                Tokens are stored locally in your browser's localStorage and masked. They are only sent to official GitHub and Hugging Face APIs to authenticate private repositories and prevent rate limits.
            `;
            repoContentArea.appendChild(infoBox);

            // Top Toolbar
            const topBar = document.createElement('div');
            topBar.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;';
            topBar.innerHTML = `
                <div style="font-size:14px; font-weight:700; color:#131722;">Access Tokens</div>
                <button id="tv-add-token-btn" style="display:flex; align-items:center; gap:6px; padding:7px 14px; border:none; background:#2962FF; color:#ffffff; font-size:12.5px; font-weight:600; border-radius:6px; cursor:pointer; transition:0.15s;">
                    <svg width="14" height="14" viewBox="0 0 18 18" fill="none"><path d="M9 4v10m-5-5h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
                    <span>Add Token</span>
                </button>
            `;
            topBar.querySelector('#tv-add-token-btn').onclick = () => showTokenForm();
            repoContentArea.appendChild(topBar);

            // Token Form Container
            const formContainer = document.createElement('div');
            formContainer.id = 'tv-token-form-container';
            repoContentArea.appendChild(formContainer);

            // Empty state
            if (tokens.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = 'background:#ffffff; border:1px dashed #cbd5e1; border-radius:10px; padding:36px 24px; text-align:center; color:#64748b; margin-top:10px;';
                empty.innerHTML = `
                    <div style="font-size:26px; margin-bottom:8px;">🔑</div>
                    <div style="font-size:14.5px; font-weight:700; color:#1e293b; margin-bottom:4px;">No Access Tokens Added</div>
                    <div style="font-size:12.5px; max-width:420px; margin:0 auto 16px auto; line-height:1.4;">
                        Public repositories do not require access tokens. Add a token if you need to read private repositories or exceed GitHub rate limits (60 requests/hr).
                    </div>
                    <button id="tv-empty-add-token" style="padding:7px 16px; background:#2962FF; color:#fff; border:none; border-radius:6px; font-size:12.5px; font-weight:600; cursor:pointer;">
                        Add Access Token
                    </button>
                `;
                empty.querySelector('#tv-empty-add-token').onclick = () => showTokenForm();
                repoContentArea.appendChild(empty);
                return;
            }

            // Tokens List
            const listEl = document.createElement('div');
            tokens.forEach(tok => {
                const card = document.createElement('div');
                card.className = 'tv-repo-card';

                const isGH = tok.provider === 'github';
                const linkedRepos = window.ScriptRepoManager.repos.filter(r => r.tokenId === tok.id);

                card.innerHTML = `
                    <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">
                        <div style="width:36px; height:36px; border-radius:8px; background:${isGH ? '#0f172a' : '#fef3c7'}; display:flex; align-items:center; justify-content:center; color:${isGH ? '#fff' : '#b45309'}; flex-shrink:0;">
                            ${isGH ? '<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>' : '<span style="font-size:18px;">🤗</span>'}
                        </div>
                        <div style="min-width:0; flex:1;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="font-size:14px; font-weight:700; color:#131722;">${tok.name}</span>
                                <span style="font-size:10.5px; font-weight:700; text-transform:uppercase; background:${isGH ? '#f1f5f9' : '#fffbeb'}; color:${isGH ? '#334155' : '#b45309'}; padding:2px 6px; border-radius:4px;">
                                    ${isGH ? 'GitHub PAT' : 'Hugging Face'}
                                </span>
                            </div>
                            <div style="display:flex; align-items:center; gap:12px; margin-top:4px; font-size:12px; color:#64748b;">
                                <span style="font-family:monospace; font-size:11.5px; background:#f8fafe; padding:1px 6px; border-radius:4px; border:1px solid #e0e3eb;">
                                    ${window.ScriptRepoManager.maskToken(tok.token)}
                                </span>
                                <span>•</span>
                                <span>${linkedRepos.length} repository${linkedRepos.length === 1 ? '' : 'ies'} linked</span>
                            </div>
                        </div>
                    </div>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <button class="tv-token-edit-btn" title="Edit token" style="background:#f8fafe; border:1px solid #cbd5e1; border-radius:6px; padding:6px 8px; cursor:pointer; color:#64748b;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="tv-token-del-btn" title="Delete token" style="background:#f8fafe; border:1px solid #cbd5e1; border-radius:6px; padding:6px 8px; cursor:pointer; color:#ef4444;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                `;

                card.querySelector('.tv-token-edit-btn').onclick = () => showTokenForm(tok);
                card.querySelector('.tv-token-del-btn').onclick = () => {
                    const warnMsg = linkedRepos.length > 0 
                        ? `Token "${tok.name}" is linked to ${linkedRepos.length} repository(ies). Deleting it will unlink it from those repositories. Continue?`
                        : `Delete token "${tok.name}"?`;
                    if (confirm(warnMsg)) {
                        window.ScriptRepoManager.deleteToken(tok.id);
                        showToast("Token deleted.");
                        renderTokensView();
                    }
                };

                listEl.appendChild(card);
            });

            repoContentArea.appendChild(listEl);
        }

        // --- ADD / EDIT TOKEN FORM ---
        function showTokenForm(existingToken = null) {
            const container = document.getElementById('tv-token-form-container');
            if (!container) return;

            const isEdit = !!existingToken;

            container.innerHTML = `
                <div style="background:#ffffff; border:1px solid #2962FF; border-radius:8px; padding:18px; margin-bottom:16px; box-shadow:0 4px 12px rgba(41,98,255,0.08);">
                    <div style="font-size:14px; font-weight:700; color:#131722; margin-bottom:12px;">
                        ${isEdit ? 'Edit Access Token' : 'Add Access Token'}
                    </div>
                    <div style="display:flex; flex-direction:column; gap:12px;">
                        <div style="display:flex; gap:12px;">
                            <div style="flex:2;">
                                <label style="font-size:12px; font-weight:600; color:#475569; display:block; margin-bottom:4px;">
                                    Token Label / Name *
                                </label>
                                <input id="tv-form-token-name" type="text" value="${existingToken ? existingToken.name : ''}" placeholder="e.g. My Personal GitHub PAT" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; box-sizing:border-box; outline:none;" />
                            </div>
                            <div style="flex:1;">
                                <label style="font-size:12px; font-weight:600; color:#475569; display:block; margin-bottom:4px;">
                                    Provider
                                </label>
                                <select id="tv-form-token-provider" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; box-sizing:border-box; outline:none; background:#fff;">
                                    <option value="github" ${existingToken && existingToken.provider === 'github' ? 'selected' : ''}>GitHub</option>
                                    <option value="huggingface" ${existingToken && existingToken.provider === 'huggingface' ? 'selected' : ''}>Hugging Face</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label style="font-size:12px; font-weight:600; color:#475569; display:block; margin-bottom:4px;">
                                Token Value ${isEdit ? '(Leave blank to keep existing token)' : '*'}
                            </label>
                            <div style="position:relative; display:flex; align-items:center;">
                                <input id="tv-form-token-val" type="password" placeholder="${isEdit ? window.ScriptRepoManager.maskToken(existingToken.token) : 'ghp_... or hf_...'}" style="width:100%; padding:8px 36px 8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; box-sizing:border-box; outline:none; font-family:monospace;" />
                                <div id="tv-form-token-toggle" style="position:absolute; right:10px; cursor:pointer; color:#787b86;">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                </div>
                            </div>
                        </div>
                        <div id="tv-form-token-error" style="color:#ef4444; font-size:12px; display:none;"></div>
                        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:4px;">
                            <button id="tv-form-token-cancel" style="padding:7px 14px; border:1px solid #cbd5e1; background:#fff; border-radius:6px; font-size:12.5px; font-weight:600; cursor:pointer;">
                                Cancel
                            </button>
                            <button id="tv-form-token-save" style="padding:7px 18px; border:none; background:#2962FF; color:#fff; border-radius:6px; font-size:12.5px; font-weight:600; cursor:pointer;">
                                ${isEdit ? 'Update Token' : 'Save Token'}
                            </button>
                        </div>
                    </div>
                </div>
            `;

            const valInput = container.querySelector('#tv-form-token-val');
            const toggleBtn = container.querySelector('#tv-form-token-toggle');
            const errEl = container.querySelector('#tv-form-token-error');

            toggleBtn.onclick = () => {
                if (valInput.type === 'password') {
                    valInput.type = 'text';
                    toggleBtn.style.color = '#2962FF';
                } else {
                    valInput.type = 'password';
                    toggleBtn.style.color = '#787b86';
                }
            };

            container.querySelector('#tv-form-token-cancel').onclick = () => {
                container.innerHTML = '';
            };

            container.querySelector('#tv-form-token-save').onclick = () => {
                try {
                    errEl.style.display = 'none';
                    const nameVal = container.querySelector('#tv-form-token-name').value.trim();
                    const provVal = container.querySelector('#tv-form-token-provider').value;
                    const tokenVal = valInput.value.trim();

                    if (!isEdit && !tokenVal) throw new Error("Token value is required.");

                    if (isEdit) {
                        window.ScriptRepoManager.updateToken(existingToken.id, nameVal, tokenVal);
                        showToast("Token updated.");
                    } else {
                        window.ScriptRepoManager.addToken(nameVal, provVal, tokenVal);
                        showToast("Access token saved.");
                    }
                    container.innerHTML = '';
                    renderTokensView();
                } catch (err) {
                    errEl.textContent = err.message;
                    errEl.style.display = 'block';
                }
            };
        }

        // Listen for storage update events to keep UI in sync
        window.addEventListener('tv_remote_scripts_updated', () => {
            if (modalOverlay.classList.contains('visible') && !isEditing) {
                renderList(searchInput.value);
            }
        });
        window.addEventListener('tv_script_repos_updated', () => {
            updateRepoModalBadges();
        });
    });
}
