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

        // --- 1b. SYNC ACTIVE STRATEGY STATE ON RELOAD ---
        // Let TradingView's chart library restore active studies naturally from chart layout.
        // If no strategy study is on the chart, clean up stale localStorage so the panel never opens unnaturally.
        setTimeout(() => {
            try {
                const chart = widget.chart();
                const studies = (chart && chart.getAllStudies()) || [];
                const savedStrat = localStorage.getItem('tv_active_strategy');
                if (savedStrat) {
                    const targetLower = savedStrat.trim().toLowerCase();
                    const exists = studies.some(s => {
                        const sName = (s.name || '').trim().toLowerCase();
                        const sDesc = (s.description || '').trim().toLowerCase();
                        return sName === targetLower || sName.includes(targetLower) || targetLower.includes(sName) ||
                               sDesc === targetLower || sDesc.includes(targetLower);
                    });
                    if (!exists) {
                        localStorage.removeItem('tv_active_strategy');
                        if (window.StrategyEngine) {
                            window.StrategyEngine.clearAll();
                        }
                        if (window.StrategyTesterUI) {
                            window.StrategyTesterUI.destroyAll();
                        }
                    }
                }
            } catch (_) {}
        }, 1200);

        // --- STUDY ID UTILITIES ---
        window.injectStudyMetaId = function(code, newId) {
            if (!code || typeof code !== 'string') return code;
            // 1. Target id ending with @tv-basicstudies (handles id: "...@tv-basicstudies-1")
            if (/id\s*:\s*["'][^"']*@tv-basicstudies[^"']*["']/.test(code)) {
                return code.replace(/id\s*:\s*["'][^"']*@tv-basicstudies[^"']*["']/, `id: "${newId}"`);
            }

            // 2. Bracket-depth aware parser for metainfo (GUARANTEED to never touch plots or inputs)
            const metaIdx = code.indexOf('metainfo');
            if (metaIdx === -1) return code;
            const openBrace = code.indexOf('{', metaIdx);
            if (openBrace === -1) return code;

            let braceDepth = 1;
            let bracketDepth = 0;
            let inString = false;
            let stringChar = '';
            let topLevelIdStart = -1;
            let topLevelIdEnd = -1;

            for (let i = openBrace + 1; i < code.length; i++) {
                const c = code[i];
                const prev = code[i - 1];

                if (inString) {
                    if (c === stringChar && prev !== '\\') {
                        inString = false;
                    }
                    continue;
                }

                if (c === '"' || c === "'" || c === '`') {
                    inString = true;
                    stringChar = c;
                    continue;
                }

                if (c === '{') braceDepth++;
                else if (c === '}') {
                    braceDepth--;
                    if (braceDepth === 0) break;
                }
                else if (c === '[') bracketDepth++;
                else if (c === ']') bracketDepth--;

                // Detect id property at top level of metainfo (braceDepth === 1, bracketDepth === 0)
                if (braceDepth === 1 && bracketDepth === 0) {
                    if (code.slice(i, i + 3) === 'id:' || code.slice(i, i + 4) === 'id :') {
                        topLevelIdStart = i;
                        let valEnd = i;
                        let strQuote = null;
                        for (let j = i; j < code.length; j++) {
                            const cj = code[j];
                            if (!strQuote && (cj === '"' || cj === "'")) {
                                strQuote = cj;
                            } else if (strQuote && cj === strQuote && code[j-1] !== '\\') {
                                valEnd = j + 1;
                                break;
                            }
                        }
                        topLevelIdEnd = valEnd;
                        break;
                    }
                }
            }

            if (topLevelIdStart !== -1 && topLevelIdEnd !== -1) {
                return code.slice(0, topLevelIdStart) + `id: "${newId}"` + code.slice(topLevelIdEnd);
            } else {
                return code.slice(0, openBrace + 1) + `\n        id: "${newId}",` + code.slice(openBrace + 1);
            }
        };

        window.generateUniqueStudyId = function(baseName, existingId) {
            let clean = "";
            if (existingId && typeof existingId === 'string') {
                clean = existingId.split('@')[0].replace(/_Local_\d+.*$/, '');
            }
            if (!clean && baseName) {
                clean = String(baseName).replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '');
            }
            if (!clean) clean = "Custom_Study";
            return `${clean}_Local_${Date.now()}@tv-basicstudies-1`;
        };

        // --- 2. INJECT "{ }" BUTTON INTO LEGEND (Robust Polling & Dynamic Resolution) ---
        function resolveScriptForLegendButton(srcBtn, iframeDoc) {
            // 1. Locate the legend item row / element
            const legendItem = srcBtn.closest([
                '[data-qa-id="legend-source-item"]',
                '[data-name="legend-source-item"]',
                '[data-entity-id]',
                '[class*="item"][class*="study"]',
                '[class*="legend-item"]',
                'tr'
            ].join(', ')) || (function() {
                let p = srcBtn.parentElement;
                while (p && p !== iframeDoc.body) {
                    if (p.hasAttribute && (
                        p.hasAttribute('data-entity-id') ||
                        p.getAttribute('data-qa-id') === 'legend-source-item' ||
                        p.getAttribute('data-name') === 'legend-source-item' ||
                        (p.className && typeof p.className === 'string' && p.className.includes('legend-item'))
                    )) return p;
                    p = p.parentElement;
                }
                return null;
            })();

            // 2. Extract entityId from DOM
            let entityId = null;
            if (legendItem) {
                entityId = legendItem.getAttribute('data-entity-id') || (legendItem.dataset && legendItem.dataset.entityId);
            }
            if (!entityId) {
                const entityEl = srcBtn.closest('[data-entity-id]');
                if (entityEl) entityId = entityEl.getAttribute('data-entity-id');
            }

            // 3. Extract visible title and description from DOM
            let domTitle = "";
            let domDesc = "";
            if (legendItem) {
                const titleEl = legendItem.querySelector([
                    '[data-qa-id="legend-source-title"]',
                    '[data-name="legend-source-title"]',
                    '[class*="mainTitle"]',
                    '[class*="title"]'
                ].join(', '));
                if (titleEl) domTitle = (titleEl.textContent || "").trim();

                const descEl = legendItem.querySelector([
                    '[data-qa-id="legend-source-description"]',
                    '[data-name="legend-source-description"]',
                    '[class*="description"]'
                ].join(', '));
                if (descEl) domDesc = (descEl.textContent || "").trim();
            }

            // 4. Retrieve study details from TradingView Chart Widget API
            let chartStudyName = "";
            let chartMeta = null;
            try {
                let chart = null;
                if (widget && typeof widget.chart === 'function') {
                    chart = widget.chart();
                } else if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
                    chart = window.tvWidget.activeChart();
                }
                
                if (chart) {
                    if (typeof chart.getAllStudies === 'function') {
                        const allStudiesList = chart.getAllStudies() || [];
                        if (entityId) {
                            const found = allStudiesList.find(s => s && s.id === entityId);
                            if (found && found.name) chartStudyName = found.name.trim();
                        }
                        if (!chartStudyName && domTitle) {
                            const found = allStudiesList.find(s => s && s.name && (
                                s.name.toLowerCase() === domTitle.toLowerCase() ||
                                s.name.toLowerCase().includes(domTitle.toLowerCase())
                            ));
                            if (found && found.name) chartStudyName = found.name.trim();
                        }
                    }

                    try {
                        const model = chart._chartWidget && chart._chartWidget.model() && chart._chartWidget.model().model();
                        if (model) {
                            if (typeof model.getStudyById === 'function' && entityId) {
                                const stModel = model.getStudyById(entityId);
                                if (stModel && typeof stModel.metaInfo === 'function') {
                                    chartMeta = stModel.metaInfo();
                                }
                            }
                            if (!chartMeta && typeof model.allStudies === 'function') {
                                const allSt = model.allStudies(true) || [];
                                const found = allSt.find(s => s && s.id && s.id() === entityId);
                                if (found && typeof found.metaInfo === 'function') {
                                    chartMeta = found.metaInfo();
                                }
                            }
                        }
                    } catch (_) {}

                    if (!chartMeta && typeof chart.getStudyById === 'function' && entityId) {
                        try {
                            const stApi = chart.getStudyById(entityId);
                            if (stApi && stApi._study && typeof stApi._study.metaInfo === 'function') {
                                chartMeta = stApi._study.metaInfo();
                            }
                        } catch (_) {}
                    }
                }
            } catch (_) {}

            // 5. Gather search tokens (filtering out empty or 1-char strings)
            const rawTokens = [
                chartStudyName,
                chartMeta && chartMeta.description,
                chartMeta && chartMeta.name,
                chartMeta && chartMeta.shortDescription,
                chartMeta && chartMeta.id,
                (chartMeta && chartMeta.id) ? chartMeta.id.split('@')[0] : '',
                domTitle
            ];
            const searchTokens = Array.from(new Set(rawTokens))
                .filter(t => typeof t === 'string' && t.trim().length >= 2)
                .map(t => t.trim());

            if (searchTokens.length === 0) {
                return null;
            }

            // 6. Gather all candidate scripts (Local, Remote, Default)
            let storedLocal = (window.TVLocalStore ? window.TVLocalStore.getIndicators() : {});
            if (Object.keys(storedLocal).length === 0) {
                try { storedLocal = JSON.parse(localStorage.getItem('tv_local_indicators') || '{}'); } catch (_) {}
            }
            let remoteStored = (window.ScriptRepoManager && window.ScriptRepoManager.remoteIndicators) || {};

            const candidateScripts = [];

            // Local scripts
            for (const [key, code] of Object.entries(storedLocal)) {
                if (!code || typeof code !== 'string') continue;
                let name = key;
                let desc = "";
                let shortDesc = "";
                let metaId = "";
                try {
                    const factory = new Function('PineJS', 'return (' + code + ');');
                    const obj = factory({ Std: {} });
                    if (obj) {
                        name = obj.name || key;
                        if (obj.metainfo) {
                            desc = obj.metainfo.description || "";
                            shortDesc = obj.metainfo.shortDescription || "";
                            metaId = obj.metainfo.id || "";
                        }
                    }
                } catch (_) {
                    const mName = code.match(/name\s*:\s*["']([^"']+)["']/);
                    if (mName) name = mName[1];
                    const mDesc = code.match(/description\s*:\s*["']([^"']+)["']/);
                    if (mDesc) desc = mDesc[1];
                    const mShort = code.match(/shortDescription\s*:\s*["']([^"']+)["']/);
                    if (mShort) shortDesc = mShort[1];
                    const mId = code.match(/id\s*:\s*["']([^"']+)["']/);
                    if (mId) metaId = mId[1];
                }
                candidateScripts.push({
                    type: 'local',
                    key: key,
                    name: name,
                    desc: desc,
                    shortDesc: shortDesc,
                    metaId: metaId,
                    cleanMetaId: metaId ? metaId.split('@')[0] : '',
                    code: code,
                    isFork: false,
                    isStrat: key.includes("Strategy") || (window.isStrategyScript && window.isStrategyScript(code))
                });
            }

            // Remote scripts
            for (const [key, item] of Object.entries(remoteStored)) {
                if (!item || !item.code) continue;
                const name = item.name || key;
                let desc = "";
                let shortDesc = "";
                let metaId = item.id || "";
                const mDesc = item.code.match(/description\s*:\s*["']([^"']+)["']/);
                if (mDesc) desc = mDesc[1];
                const mShort = item.code.match(/shortDescription\s*:\s*["']([^"']+)["']/);
                if (mShort) shortDesc = mShort[1];
                const isStrat = item.isStrat || name.toLowerCase().includes('strategy') || (window.isStrategyScript && window.isStrategyScript(item.code));
                candidateScripts.push({
                    type: 'remote',
                    key: name,
                    name: name,
                    desc: desc,
                    shortDesc: shortDesc,
                    metaId: metaId,
                    cleanMetaId: metaId ? metaId.split('@')[0] : '',
                    code: item.code,
                    isStrat: isStrat,
                    isFork: true
                });
            }

            // Default scripts
            const defaults = [
                { name: "SuperTrend Custom", short: "SuperTrend Custom" },
                { name: "5 EMA Crossover", short: "5 EMAs" },
                { name: "SuperTrend Strategy (Trade Chains)", short: "SuperTrend Strat" }
            ];
            for (const d of defaults) {
                const dCode = getDefaultScriptCode(d.name);
                if (dCode) {
                    candidateScripts.push({
                        type: 'default',
                        key: d.name,
                        name: d.name,
                        desc: d.name,
                        shortDesc: d.short,
                        metaId: "",
                        cleanMetaId: "",
                        code: dCode,
                        isStrat: d.name.includes("Strategy"),
                        isFork: true
                    });
                }
            }

            const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, '');

            // 7. Multi-tier Matching Engine
            // Tier 0: EXACT PACKAGE ID MATCH (Highest Priority)
            // Ensures that if clones and remote indicators share the same name,
            // they are matched 100% deterministically by their unique metainfo.id!
            if (chartMeta && chartMeta.id) {
                const targetId = chartMeta.id.trim().toLowerCase();
                const cleanTargetId = targetId.split('@')[0];
                
                // 0A: Check exact metaId match (e.g., "my_study_local_12345@tv-basicstudies-1")
                for (const cand of candidateScripts) {
                    if (cand.metaId && cand.metaId.toLowerCase() === targetId) {
                        return cand;
                    }
                }
                // 0B: Check clean metaId match (without @tv-basicstudies-1)
                for (const cand of candidateScripts) {
                    if (cand.cleanMetaId && cand.cleanMetaId.toLowerCase() === cleanTargetId) {
                        return cand;
                    }
                }
            }

            // Tier 1: Exact matches (case-insensitive) on shortDesc, name, key, desc, metaId
            for (const token of searchTokens) {
                const tLower = token.toLowerCase();
                for (const cand of candidateScripts) {
                    if (cand.shortDesc && cand.shortDesc.toLowerCase() === tLower) return cand;
                    if (cand.name && cand.name.toLowerCase() === tLower) return cand;
                    if (cand.key && cand.key.toLowerCase() === tLower) return cand;
                    if (cand.desc && cand.desc.toLowerCase() === tLower) return cand;
                    if (cand.metaId && cand.metaId.toLowerCase() === tLower) return cand;
                    if (cand.cleanMetaId && cand.cleanMetaId.toLowerCase() === tLower) return cand;
                }
            }

            // Tier 2: Normalized alphanumeric match
            for (const token of searchTokens) {
                const tNorm = norm(token);
                if (tNorm.length < 3) continue;
                for (const cand of candidateScripts) {
                    if (cand.shortDesc && norm(cand.shortDesc) === tNorm) return cand;
                    if (cand.name && norm(cand.name) === tNorm) return cand;
                    if (cand.key && norm(cand.key) === tNorm) return cand;
                    if (cand.desc && norm(cand.desc) === tNorm) return cand;
                    if (cand.cleanMetaId && norm(cand.cleanMetaId) === tNorm) return cand;
                }
            }

            // Tier 3: Strict Substring Match (requires length >= 4 and non-empty)
            for (const token of searchTokens) {
                const tLower = token.toLowerCase();
                if (tLower.length < 4) continue;
                for (const cand of candidateScripts) {
                    const candName = (cand.name || "").toLowerCase();
                    const candDesc = (cand.desc || "").toLowerCase();
                    const candKey = (cand.key || "").toLowerCase();
                    if (candName.length >= 4 && (candName.includes(tLower) || tLower.includes(candName))) return cand;
                    if (candKey.length >= 4 && (candKey.includes(tLower) || tLower.includes(candKey))) return cand;
                    if (candDesc.length >= 4 && (candDesc.includes(tLower) || tLower.includes(candDesc))) return cand;
                }
            }

            return null;
        }

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
                    
                    const isDelete = btn.getAttribute('data-name') === 'legend-delete-action' || btn.getAttribute('data-qa-id') === 'legend-delete-action';
                    if (isDelete && !btn._st_cleanup_attached) {
                        btn._st_cleanup_attached = true;
                        btn.addEventListener('click', () => {
                            setTimeout(() => { if (window.StrategyTesterUI) window.StrategyTesterUI.checkStrategyPresence(); }, 150);
                            setTimeout(() => { if (window.StrategyTesterUI) window.StrategyTesterUI.checkStrategyPresence(); }, 500);
                        });
                    }

                    if (container.querySelector('.tv-custom-source-btn')) return;

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
                        e.preventDefault();
                        
                        const matched = resolveScriptForLegendButton(srcBtn, iframeDoc);
                        if (matched) {
                            openModal();
                            setTimeout(() => {
                                if (matched.type === 'local') {
                                    showEditor(matched.code, matched.name);
                                } else {
                                    showEditor(matched.code, matched.name, matched.isStrat, matched.isFork, matched.name);
                                }
                            }, 50);
                        } else {
                            let itemTitle = "";
                            try {
                                const legendItem = srcBtn.closest('[data-qa-id="legend-source-item"], [data-name="legend-source-item"], [data-entity-id], [class*="legend-item"], [class*="item"]');
                                const titleEl = legendItem ? legendItem.querySelector('[data-qa-id="legend-source-title"], [data-name="legend-source-title"], [class*="mainTitle"], [class*="title"]') : null;
                                if (titleEl) itemTitle = titleEl.textContent.trim();
                            } catch (_) {}
                            showToast(itemTitle ? `No editable local source code found for "${itemTitle}".` : 'No editable local source code found for this indicator.');
                        }
                    };
                    
                    if (isDelete) {
                        container.insertBefore(srcBtn, btn);
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
                touch-action: auto !important; box-sizing: border-box;
            }
            .tv-custom-modal-header {
                padding: 16px 24px 12px 24px; display: flex; justify-content: space-between; align-items: center; background: #ffffff; flex-shrink: 0;
            }
            .tv-search-container {
                padding: 0 24px 12px 24px; background: #ffffff; flex-shrink: 0;
            }
            .tv-custom-modal-body {
                display: flex; flex: 1; overflow: hidden; border-top: 1px solid #e0e3eb; min-height: 0;
            }
            .tv-custom-modal-tabs {
                width: 210px; display: flex; flex-direction: column; padding: 16px 12px; border-right: 1px solid #e0e3eb; background: #fafbfc; flex-shrink: 0;
            }
            .tv-custom-modal-tab {
                padding: 10px 14px; margin-bottom: 4px; font-size: 13.5px; cursor: pointer; color: #131722; font-weight: 500;
                border-radius: 8px; transition: background 0.1s ease; display: flex; align-items: center; gap: 10px; border: 1px solid transparent; user-select: none;
            }
            .tv-custom-modal-tab:hover {
                background: #f0f3fa;
            }
            .tv-custom-modal-tab.active {
                background: #ffffff; color: #2962FF; box-shadow: 0 1px 3px rgba(0,0,0,0.05); border: 1px solid #e0e3eb; font-weight: 600;
            }
            .tv-custom-modal-tab.hidden {
                display: none !important;
            }
            /* Full Space Dedicated Code Editor Mode */
            .tv-custom-modal.editor-mode {
                width: 96vw !important;
                height: 94vh !important;
                max-width: 1440px !important;
                max-height: 96vh !important;
                border-radius: 12px !important;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35) !important;
            }
            .tv-custom-modal.editor-mode .tv-custom-modal-header {
                display: none !important;
            }
            .tv-custom-modal.editor-mode .tv-search-container {
                display: none !important;
            }
            .tv-custom-modal.editor-mode .tv-custom-modal-tabs {
                display: none !important;
            }
            .tv-custom-modal.editor-mode .tv-custom-modal-body {
                border-top: none !important;
                flex: 1 !important;
                height: 100% !important;
                min-height: 0 !important;
            }
            .tv-custom-modal.editor-mode .tv-list-wrapper {
                flex: 1 !important;
                width: 100% !important;
                height: 100% !important;
                min-height: 0 !important;
            }

            .tv-list-wrapper {
                flex: 1; display: flex; flex-direction: column; background: #ffffff; min-height: 0; min-width: 0; overflow: hidden;
            }
            .tv-list-header {
                padding: 14px 24px 8px 24px; font-size: 11px; font-weight: 700; color: #b2b5be; text-transform: uppercase; letter-spacing: 0.4px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
            }
            .tv-editor-header {
                display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-bottom: 1px solid #e0e3eb; background: #fafbfc; flex-shrink: 0;
            }
            
            .tv-list-container { -webkit-overflow-scrolling: touch; touch-action: pan-y !important; }
            .tv-list-container::-webkit-scrollbar { width: 6px; }
            .tv-list-container::-webkit-scrollbar-thumb { background: #d1d4dc; border-radius: 3px; }
            .tv-list-container::-webkit-scrollbar-track { background: transparent; }

            .tv-star-icon { color: #b2b5be; transition: color 0.1s ease; margin-right: 10px; flex-shrink: 0; cursor: pointer; display: flex; align-items: center; }
            .tv-star-icon:hover { color: #FFB300; }
            .tv-star-icon.active { color: #FFB300; fill: #FFB300; }

            /* Filter Bar & Chips with Smooth Touch Scroll */
            .tv-filter-container {
                display: flex; flex-direction: column; gap: 6px; margin-top: 8px;
            }
            .tv-filter-row {
                display: flex; align-items: center; gap: 6px; overflow-x: auto; white-space: nowrap; -webkit-overflow-scrolling: touch;
                scrollbar-width: none; padding-bottom: 2px;
            }
            .tv-filter-row::-webkit-scrollbar { display: none; }
            .tv-filter-label {
                font-size: 10.5px; font-weight: 700; color: #787b86; text-transform: uppercase; letter-spacing: 0.5px; min-width: 46px; user-select: none; flex-shrink: 0;
            }
            .tv-filter-chip {
                padding: 4px 10px; border-radius: 12px; font-size: 11.5px; font-weight: 500; cursor: pointer;
                border: 1px solid #e0e3eb; background: #f8fafe; color: #475569; transition: all 0.12s ease;
                user-select: none; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;
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
                font-size: 9.5px; font-weight: 700; padding: 2px 6px; border-radius: 4px;
                text-transform: uppercase; letter-spacing: 0.3px; display: inline-flex; align-items: center;
                gap: 3.5px; white-space: nowrap; line-height: 1.2; flex-shrink: 0;
            }
            .tv-badge-pill svg {
                flex-shrink: 0;
                display: inline-block;
                vertical-align: middle;
            }
            .tv-badge-text {
                display: inline;
            }
            .tv-badge-type-strat { background: #f3e8ff; color: #7e22ce; border: 1px solid #e9d5ff; }
            .tv-badge-type-ind { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
            .tv-badge-source-default { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
            .tv-badge-source-local { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
            .tv-badge-source-github { background: #0f172a; color: #f8fafc; border: 1px solid #334155; }
            .tv-badge-source-github.tv-badge-perm-gold { border: 1px solid #f59e0b !important; }
            .tv-badge-source-hf { background: #fffbeb; color: #b45309; border: 1px solid #fef08a; }
            .tv-badge-source-hf.tv-badge-perm-gold { border: 1px solid #d97706 !important; }
            .tv-badge-lock-icon { display: inline-flex; align-items: center; color: #f59e0b; margin-left: 1px; }
            .tv-badge-source-hf .tv-badge-lock-icon { color: #b45309; }
            .tv-badge-permanent { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
            .tv-badge-user-added { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
            .tv-badge-active { background: rgba(8, 153, 129, 0.12); color: #089981; border: 1px solid rgba(8, 153, 129, 0.25); }

            /* Refined Script Row Layout - Left aligned title with compact badges below */
            .tv-script-row {
                padding: 9px 12px; cursor: pointer; color: #131722; display: flex;
                align-items: center; border-radius: 8px; margin-bottom: 3px; border: 1px solid transparent;
                transition: all 0.12s ease; gap: 10px; box-sizing: border-box; min-width: 0; text-align: left;
            }
            .tv-script-row:hover {
                background: #f8fafe; border-color: #e0e3eb;
            }
            .tv-script-main {
                flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 3px; text-align: left;
            }
            .tv-script-title-wrap {
                display: flex; align-items: center; min-width: 0; width: 100%; text-align: left; justify-content: flex-start;
            }
            .tv-script-title {
                font-size: 13.5px; font-weight: 600; color: #131722; line-height: 1.35; text-align: left;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
            }
            .tv-script-meta-wrap {
                display: flex; align-items: center; gap: 5px; flex-wrap: wrap; text-align: left; justify-content: flex-start; margin-top: 1px;
            }
            .tv-script-date {
                font-size: 10px; color: #94a3b8; font-weight: 500; margin-left: 2px;
            }
            .tv-script-actions {
                display: flex; align-items: center; gap: 5px; flex-shrink: 0; margin-left: auto;
            }

            /* Sleek Unified Action Bar in Custom Scripts Tab */
            .tv-custom-actions-bar {
                display: flex; align-items: center; justify-content: space-between; padding: 7px 16px;
                background: #fafbfc; border-bottom: 1px solid #e0e3eb; gap: 8px; flex-shrink: 0; box-sizing: border-box;
            }
            .tv-actions-group-left, .tv-actions-group-right {
                display: flex; align-items: center; gap: 6px;
            }
            .tv-btn-action {
                display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 6px;
                font-size: 11.5px; font-weight: 600; cursor: pointer; transition: all 0.12s ease; white-space: nowrap;
                border: 1px solid transparent; user-select: none; box-sizing: border-box; outline: none;
            }
            .tv-btn-primary {
                background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe;
            }
            .tv-btn-primary:hover {
                background: #2962FF; color: #ffffff; border-color: #2962FF;
            }
            .tv-btn-strat {
                background: #faf5ff; color: #7e22ce; border-color: #e9d5ff;
            }
            .tv-btn-strat:hover {
                background: #7e22ce; color: #ffffff; border-color: #7e22ce;
            }
            .tv-btn-subtle {
                background: #ffffff; color: #475569; border-color: #e2e8f0;
            }
            .tv-btn-subtle:hover {
                background: #f8fafc; color: #1e293b; border-color: #cbd5e1;
            }
            .tv-btn-subtle.active {
                background: #eff6ff !important; color: #1d4ed8 !important; border-color: #bfdbfe !important; font-weight: 700;
            }
            .tv-btn-danger {
                background: #fef2f2; color: #dc2626; border-color: #fecaca;
            }
            .tv-btn-danger:hover {
                background: #dc2626; color: #ffffff; border-color: #dc2626;
            }
            .tv-script-checkbox {
                width: 15px; height: 15px; cursor: pointer; accent-color: #2962FF; border-radius: 4px;
                margin: 0 4px 0 0; flex-shrink: 0; outline: none;
            }
            .tv-script-row.selected {
                background: #eff6ff !important; border-color: #bfdbfe !important;
            }
            .tv-script-row.non-selectable {
                opacity: 0.55;
            }
            .tv-action-sep {
                width: 1px; height: 16px; background: #e2e8f0; margin: 0 2px;
            }
            .tv-repo-badge {
                background: #0f172a; color: #ffffff; border-radius: 10px; font-size: 9.5px; padding: 1px 5px; font-weight: 700; margin-left: 2px;
            }

            /* List Header with Integrated Controls */
            .tv-list-header {
                padding: 8px 16px; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase;
                letter-spacing: 0.4px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
                background: #ffffff; border-bottom: 1px solid #f1f5f9; gap: 8px;
            }
            .tv-list-header-left {
                display: flex; align-items: center; gap: 6px; flex-shrink: 0;
            }
            .tv-list-col-title {
                font-size: 11px; font-weight: 700; color: #94a3b8; letter-spacing: 0.5px;
            }
            .tv-list-count-badge {
                font-size: 10px; font-weight: 600; color: #64748b; background: #f1f5f9; padding: 1px 6px; border-radius: 10px; border: 1px solid #e2e8f0;
            }
            .tv-list-header-controls {
                display: flex; align-items: center; gap: 6px; margin-left: auto;
            }
            .tv-header-control-group {
                display: inline-flex; align-items: center; gap: 4px; background: #f8fafc; border: 1px solid #e2e8f0;
                border-radius: 6px; padding: 2px 7px; color: #64748b; transition: all 0.12s ease;
            }
            .tv-header-control-group:hover {
                background: #ffffff; border-color: #cbd5e1; color: #1e293b;
            }
            .tv-control-select {
                border: none; background: transparent; font-size: 11px; font-weight: 600; color: #334155; outline: none; cursor: pointer; font-family: inherit; padding: 1px 0;
            }

            /* Group Divider Headers */
            .tv-group-header {
                display: flex; align-items: center; gap: 8px; padding: 10px 4px 4px 4px; margin-top: 6px; margin-bottom: 3px;
                font-size: 10.5px; font-weight: 700; color: #787b86; letter-spacing: 0.5px; text-transform: uppercase; user-select: none;
            }
            .tv-group-header-left {
                display: flex; align-items: center; gap: 6px; flex-shrink: 0;
            }
            .tv-group-title {
                color: #475569; font-weight: 700;
            }
            .tv-group-count {
                background: #f1f5f9; color: #64748b; font-size: 9.5px; font-weight: 600; padding: 1px 5px; border-radius: 10px; border: 1px solid #e2e8f0;
            }
            .tv-group-divider-line {
                flex: 1; height: 1px; background: #e2e8f0; min-width: 20px;
            }

            /* Action Buttons inside list item */
            .tv-item-action-btn {
                cursor: pointer; color: #64748b; display: inline-flex; align-items: center; padding: 4px 8px;
                border-radius: 5px; font-size: 11px; font-weight: 600; transition: all 0.12s ease; border: 1px solid #e2e8f0;
                background: #ffffff; flex-shrink: 0; gap: 4px; user-select: none;
            }
            .tv-item-action-btn:hover {
                background: #f0f3fa; color: #2962FF; border-color: #bfdbfe;
            }
            .tv-del-btn:hover {
                background: #fef2f2 !important; color: #ef4444 !important; border-color: #fecaca !important;
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
                display: flex; gap: 4px; padding: 0 24px; border-bottom: 1px solid #e0e3eb; background: #fafbfc; flex-shrink: 0;
            }
            .tv-repo-tab-item {
                padding: 12px 16px; font-size: 13px; font-weight: 600; color: #787b86; cursor: pointer;
                border-bottom: 2px solid transparent; display: flex; align-items: center; gap: 8px; transition: 0.15s; user-select: none;
            }
            .tv-repo-tab-item:hover { color: #131722; }
            .tv-repo-tab-item.active { color: #2962FF; border-bottom-color: #2962FF; }
            .tv-repo-card {
                border: 1px solid #e0e3eb; border-radius: 8px; padding: 14px 16px; margin-bottom: 10px;
                background: #ffffff; transition: all 0.15s ease; display: flex; align-items: center; justify-content: space-between; gap: 12px;
            }
            .tv-repo-card:hover {
                border-color: #b2b5be; box-shadow: 0 2px 8px rgba(0,0,0,0.04);
            }
            .tv-spin { animation: tvSpinAnim 1s linear infinite; }
            @keyframes tvSpinAnim { 100% { transform: rotate(360deg); } }

            /* Mobile & Small Device Optimization (Full bleed, no cut-offs) */
            @media (max-width: 768px) {
                .tv-custom-modal-overlay {
                    padding: 0 !important; align-items: stretch !important; justify-content: stretch !important;
                }
                .tv-custom-modal {
                    width: 100vw !important; height: 100% !important; max-width: 100vw !important; max-height: 100% !important;
                    border-radius: 0 !important; box-shadow: none !important;
                }
                .tv-custom-modal-header {
                    padding: 12px 16px 8px 16px !important;
                }
                .tv-custom-modal-header > div:first-child {
                    font-size: 16px !important;
                }
                .tv-search-container {
                    padding: 0 16px 8px 16px !important;
                }
                .tv-filter-container {
                    gap: 4px !important;
                    margin-top: 6px !important;
                }
                .tv-filter-row {
                    gap: 5px !important;
                    padding-right: 20px !important;
                    touch-action: pan-x !important;
                    -webkit-overflow-scrolling: touch !important;
                }
                .tv-filter-label {
                    font-size: 10px !important;
                    min-width: 42px !important;
                    color: #94a3b8 !important;
                }
                .tv-filter-chip {
                    padding: 3px 8px !important;
                    font-size: 11px !important;
                    border-radius: 10px !important;
                }
                .tv-badge-pill .tv-badge-text {
                    display: none !important;
                }
                .tv-badge-pill {
                    padding: 2.5px 5px !important;
                    gap: 2.5px !important;
                }
                .tv-custom-modal-body {
                    flex-direction: column !important;
                    flex: 1 !important;
                    min-height: 0 !important;
                    overflow: hidden !important;
                }
                .tv-custom-modal-tabs {
                    width: 100% !important;
                    height: 42px !important;
                    min-height: 42px !important;
                    max-height: 42px !important;
                    flex-direction: row !important;
                    border-right: none !important;
                    border-bottom: 1px solid #e0e3eb !important;
                    padding: 0 12px !important;
                    background: #f8fafc !important;
                    overflow-x: auto !important;
                    white-space: nowrap !important;
                    touch-action: pan-x !important;
                    flex-shrink: 0 !important;
                    display: flex !important;
                    align-items: center !important;
                    gap: 6px !important;
                    box-sizing: border-box !important;
                }
                .tv-custom-modal-tab {
                    flex: 0 0 auto !important;
                    height: 28px !important;
                    margin: 0 !important;
                    padding: 0 10px !important;
                    font-size: 12px !important;
                    white-space: nowrap !important;
                    display: inline-flex;
                    align-items: center !important;
                    gap: 5px !important;
                    border-radius: 6px !important;
                    border: 1px solid transparent !important;
                    background: transparent !important;
                    box-shadow: none !important;
                }
                .tv-custom-modal-tab.hidden {
                    display: none !important;
                }
                .tv-custom-modal-tab.active {
                    background: #ffffff !important;
                    color: #2962FF !important;
                    border: 1px solid #cbd5e1 !important;
                    font-weight: 600 !important;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05) !important;
                }
                .tv-list-wrapper {
                    flex: 1 !important;
                    min-height: 0 !important;
                    display: flex !important;
                    flex-direction: column !important;
                    width: 100% !important;
                    overflow: hidden !important;
                }
                .tv-list-header {
                    padding: 8px 12px !important;
                    flex-wrap: wrap !important;
                    gap: 6px !important;
                }
                .tv-list-header-controls {
                    width: 100% !important;
                    justify-content: space-between !important;
                    margin-left: 0 !important;
                }
                .tv-header-control-group {
                    flex: 1 !important;
                    justify-content: center !important;
                }
                .tv-control-select {
                    width: 100% !important;
                    text-align: center !important;
                }
                .tv-list-container {
                    padding: 4px 8px 14px 8px !important;
                    flex: 1 !important;
                    min-height: 0 !important;
                    overflow-y: auto !important;
                }
                .tv-script-row {
                    padding: 8px 10px !important;
                    gap: 8px !important;
                    border-bottom: 1px solid #f1f5f9 !important;
                }
                .tv-script-title {
                    font-size: 13px !important;
                }
                .tv-badge-pill {
                    font-size: 8.5px !important;
                    padding: 2.5px 5px !important;
                    gap: 2.5px !important;
                }
                .tv-custom-actions-bar {
                    padding: 6px 10px !important;
                    gap: 6px !important;
                    overflow-x: auto !important;
                    white-space: nowrap !important;
                    -webkit-overflow-scrolling: touch !important;
                    scrollbar-width: none !important;
                    justify-content: flex-start !important;
                }
                .tv-custom-actions-bar::-webkit-scrollbar { display: none !important; }
                .tv-actions-group-left, .tv-actions-group-right {
                    flex-shrink: 0 !important;
                }
                .tv-btn-action {
                    padding: 4px 8px !important;
                    font-size: 11px !important;
                }
                .tv-item-action-btn {
                    padding: 3px 6px !important;
                    font-size: 10.5px !important;
                }
                .tv-custom-modal.editor-mode {
                    width: 100vw !important;
                    height: 100vh !important;
                    max-width: 100vw !important;
                    max-height: 100vh !important;
                    border-radius: 0 !important;
                    margin: 0 !important;
                }
                .tv-editor-header {
                    padding: 8px 12px !important;
                }
                .tv-repo-modal {
                    width: 100vw !important; height: 100% !important; max-width: 100vw !important; max-height: 100% !important;
                    border-radius: 0 !important;
                }
                .tv-repo-card {
                    flex-direction: column !important; align-items: flex-start !important; gap: 10px !important;
                }
                .tv-repo-card-actions {
                    width: 100% !important; justify-content: flex-end !important;
                }
                .tv-form-row-2col {
                    flex-direction: column !important; gap: 8px !important;
                }
            }
        `;
        document.head.appendChild(style);

        // --- MODAL CONTAINER ---
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'tv-custom-modal-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'tv-custom-modal';
        
        const header = document.createElement('div');
        header.className = 'tv-custom-modal-header'; header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background: #ffffff;';
        header.innerHTML = '<div style="font-size:18px; font-weight:700; color:#131722; letter-spacing:-0.2px;">Indicators, metrics, and strategies</div><div id="tv-close-modal" style="cursor:pointer; color:#787b86; padding:16px; margin:-10px; border-radius:4px; transition:0.2s; display:flex; align-items:center; justify-content:center;"><svg width="18" height="18" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1l12 12m0-12L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>';
        header.querySelector('#tv-close-modal').onmouseover = function() { this.style.background = '#f0f3fa'; this.style.color = '#131722'; };
        header.querySelector('#tv-close-modal').onmouseout = function() { this.style.background = 'transparent'; this.style.color = '#787b86'; };

        // --- SEARCH CONTAINER & FILTER BAR ---
        const searchContainer = document.createElement('div');
        searchContainer.className = 'tv-search-container';
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
        listWrapper.className = 'tv-list-wrapper';
        listWrapper.style.cssText = 'flex:1; display:flex; flex-direction:column; background: #ffffff; min-height:0;';

        // 1. Sleek Action Bar for Custom Scripts Tab
        const actionsBar = document.createElement('div');
        actionsBar.className = 'tv-custom-actions-bar';
        actionsBar.id = 'tv-custom-actions-bar';
        actionsBar.style.display = 'none';
        actionsBar.innerHTML = `
            <div class="tv-actions-group-left">
                <button type="button" class="tv-btn-action tv-btn-primary" id="tv-action-add-ind">
                    <svg width="12" height="12" viewBox="0 0 18 18" fill="none"><path d="M9 4v10m-5-5h10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
                    <span>+ Indicator</span>
                </button>
                <button type="button" class="tv-btn-action tv-btn-strat" id="tv-action-add-strat">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                    <span>+ Strategy</span>
                </button>
            </div>
            <div class="tv-actions-group-right">
                <button type="button" class="tv-btn-action tv-btn-subtle" id="tv-action-select" title="Toggle selection mode for batch deletion">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 11 12 14 22 4"></polyline>
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                    </svg>
                    <span id="tv-action-select-text">Select</span>
                </button>
                <button type="button" class="tv-btn-action tv-btn-danger" id="tv-action-bulk-delete" style="display:none;" title="Delete selected local scripts">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                    <span id="tv-bulk-delete-count">Delete (0)</span>
                </button>
                <div class="tv-action-sep" id="tv-select-sep" style="display:none;"></div>
                <button type="button" class="tv-btn-action tv-btn-subtle" id="tv-action-repos" title="Manage Git/HF Repositories and Sync Scripts">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5z"/></svg>
                    <span>Repositories</span>
                    <span class="tv-repo-badge" id="tv-actions-repo-count" style="display:none;"></span>
                </button>
                <div class="tv-action-sep"></div>
                <button type="button" class="tv-btn-action tv-btn-subtle" id="tv-action-backup" title="Export Backup JSON">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    <span>Backup</span>
                </button>
                <button type="button" class="tv-btn-action tv-btn-subtle" id="tv-action-import" title="Import Scripts JSON Backup">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    <span>Import</span>
                </button>
            </div>
        `;

        const importFileInput = document.createElement('input');
        importFileInput.type = 'file';
        importFileInput.accept = '.json';
        importFileInput.style.display = 'none';
        importFileInput.onchange = (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (evt) => {
                if (window.TVLocalStore) {
                    const res = window.TVLocalStore.importBackupJson(evt.target.result);
                    if (res.success) {
                        showToast(`Successfully restored ${res.count} custom scripts! Reloading chart...`);
                        setTimeout(() => location.reload(), 600);
                    } else {
                        alert("Failed to import backup: " + res.error);
                    }
                }
            };
            reader.readAsText(file);
        };
        document.body.appendChild(importFileInput);

        actionsBar.querySelector('#tv-action-add-ind').onclick = () => showEditor();
        actionsBar.querySelector('#tv-action-add-strat').onclick = () => showEditor('', null, true);
        actionsBar.querySelector('#tv-action-repos').onclick = () => openRepoManagerModal();
        actionsBar.querySelector('#tv-action-backup').onclick = () => {
            if (window.TVLocalStore) window.TVLocalStore.exportBackupJson();
        };
        actionsBar.querySelector('#tv-action-import').onclick = () => importFileInput.click();

        // 2. Refined List Header with Sort & Group Controls
        const listHeader = document.createElement('div');
        listHeader.className = 'tv-list-header';
        listHeader.innerHTML = `
            <div class="tv-list-header-left">
                <input type="checkbox" id="tv-select-all" class="tv-script-checkbox" style="display:none;" title="Select / Deselect all visible local scripts">
                <span class="tv-list-col-title">SCRIPT NAME</span>
                <span id="tv-list-count" class="tv-list-count-badge">0</span>
                <span id="tv-global-sync-status" style="font-size:11px; font-weight:600; color:#089981; display:flex; align-items:center; gap:4px; margin-left:8px;" title="Cloud sync status">
                    <span style="width:6px; height:6px; border-radius:50%; background:#089981; display:inline-block;"></span>
                    <span>Synced</span>
                </span>
            </div>
            <div class="tv-list-header-controls">
                <div class="tv-header-control-group" title="Sort scripts">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 6h18M6 12h12m-9 6h6"></path>
                    </svg>
                    <select id="tv-sort-select" class="tv-control-select" aria-label="Sort scripts">
                        <option value="name-asc">Name (A → Z)</option>
                        <option value="name-desc">Name (Z → A)</option>
                        <option value="date-desc">Newest First</option>
                        <option value="date-asc">Oldest First</option>
                        <option value="type-ind">Indicators First</option>
                        <option value="type-strat">Strategies First</option>
                    </select>
                </div>
                <div class="tv-header-control-group" title="Group scripts by label">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="7" height="7"></rect>
                        <rect x="14" y="3" width="7" height="7"></rect>
                        <rect x="14" y="14" width="7" height="7"></rect>
                        <rect x="3" y="14" width="7" height="7"></rect>
                    </svg>
                    <select id="tv-group-select" class="tv-control-select" aria-label="Group scripts">
                        <option value="none">Group: None</option>
                        <option value="type">Group by Type</option>
                        <option value="source">Group by Source</option>
                        <option value="status">Group by Active</option>
                        <option value="fav">Group by Starred</option>
                    </select>
                </div>
            </div>
        `;

        let currentSort = 'name-asc';
        let currentGroup = 'none';
        try {
            currentSort = localStorage.getItem('tv_scripts_sort') || 'name-asc';
            currentGroup = localStorage.getItem('tv_scripts_group') || 'none';
        } catch (_) {}

        const sortSelectEl = listHeader.querySelector('#tv-sort-select');
        const groupSelectEl = listHeader.querySelector('#tv-group-select');
        if (sortSelectEl) {
            sortSelectEl.value = currentSort;
            sortSelectEl.onchange = (e) => {
                currentSort = e.target.value;
                try { localStorage.setItem('tv_scripts_sort', currentSort); } catch (_) {}
                renderList(searchInput.value);
            };
        }
        if (groupSelectEl) {
            groupSelectEl.value = currentGroup;
            groupSelectEl.onchange = (e) => {
                currentGroup = e.target.value;
                try { localStorage.setItem('tv_scripts_group', currentGroup); } catch (_) {}
                renderList(searchInput.value);
            };
        }

        // Selection & Deletion State
        let isSelectMode = false;
        const selectedScripts = new Set();
        let currentRenderedItems = [];
        let cleanupEditorFn = null;

        const selectBtn = actionsBar.querySelector('#tv-action-select');
        const selectText = actionsBar.querySelector('#tv-action-select-text');
        const bulkDeleteBtn = actionsBar.querySelector('#tv-action-bulk-delete');
        const bulkCountLabel = actionsBar.querySelector('#tv-bulk-delete-count');
        const selectSep = actionsBar.querySelector('#tv-select-sep');
        const selectAllCheckbox = listHeader.querySelector('#tv-select-all');

        function updateBulkDeleteUI() {
            const count = selectedScripts.size;
            if (bulkDeleteBtn && bulkCountLabel) {
                if (isSelectMode && count > 0) {
                    bulkDeleteBtn.style.display = 'inline-flex';
                    bulkCountLabel.textContent = `Delete (${count})`;
                    if (selectSep) selectSep.style.display = 'block';
                } else {
                    bulkDeleteBtn.style.display = 'none';
                    if (selectSep) selectSep.style.display = 'none';
                }
            }
            if (selectAllCheckbox) {
                selectAllCheckbox.style.display = isSelectMode ? 'inline-block' : 'none';
                if (isSelectMode) {
                    const visibleLocal = (currentRenderedItems || []).filter(it => it.isLocal);
                    if (visibleLocal.length > 0 && visibleLocal.every(it => selectedScripts.has(it.name))) {
                        selectAllCheckbox.checked = true;
                        selectAllCheckbox.indeterminate = false;
                    } else if (count > 0 && visibleLocal.some(it => selectedScripts.has(it.name))) {
                        selectAllCheckbox.checked = false;
                        selectAllCheckbox.indeterminate = true;
                    } else {
                        selectAllCheckbox.checked = false;
                        selectAllCheckbox.indeterminate = false;
                    }
                }
            }
        }

        if (selectBtn) {
            selectBtn.onclick = () => {
                isSelectMode = !isSelectMode;
                if (!isSelectMode) {
                    selectedScripts.clear();
                    selectBtn.classList.remove('active');
                    if (selectText) selectText.textContent = 'Select';
                } else {
                    selectBtn.classList.add('active');
                    if (selectText) selectText.textContent = 'Cancel';
                }
                updateBulkDeleteUI();
                renderList(searchInput.value);
            };
        }

        if (selectAllCheckbox) {
            selectAllCheckbox.onclick = (e) => {
                const checked = e.target.checked;
                const visibleLocal = (currentRenderedItems || []).filter(it => it.isLocal);
                if (checked) {
                    visibleLocal.forEach(it => selectedScripts.add(it.name));
                } else {
                    visibleLocal.forEach(it => selectedScripts.delete(it.name));
                }
                updateBulkDeleteUI();
                renderList(searchInput.value);
            };
        }

        if (bulkDeleteBtn) {
            bulkDeleteBtn.onclick = (e) => {
                e.stopPropagation();
                const count = selectedScripts.size;
                if (count === 0) return;
                const names = Array.from(selectedScripts);
                const preview = names.slice(0, 5).map(n => `• ${n}`).join('\n');
                const more = count > 5 ? `\n• ...and ${count - 5} more` : '';
                const msg = count === 1
                    ? `Delete local script "${names[0]}"?\n\nAny active instances on the chart will also be removed cleanly.`
                    : `Are you sure you want to delete ${count} selected scripts?\n\n${preview}${more}\n\nAny active instances on the chart will also be cleanly removed.`;

                if (confirm(msg)) {
                    let chartRemovedTotal = 0;
                    names.forEach(scriptName => {
                        const it = (currentRenderedItems || []).find(x => x.name === scriptName);
                        const disp = it ? it.displayName : scriptName;
                        const r = removeScriptFromChartIfAttached(scriptName, disp);
                        chartRemovedTotal += r;

                        if (window.TVLocalStore) {
                            window.TVLocalStore.deleteIndicator(scriptName);
                        } else {
                            delete storedLocal[scriptName];
                            localStorage.setItem('tv_local_indicators', JSON.stringify(storedLocal));
                        }

                        let fs = getFavorites();
                        if (fs.includes(scriptName)) {
                            localStorage.setItem('tv_favorite_indicators', JSON.stringify(fs.filter(f => f !== scriptName)));
                        }
                    });

                    selectedScripts.clear();
                    isSelectMode = false;
                    if (selectBtn) selectBtn.classList.remove('active');
                    if (selectText) selectText.textContent = 'Select';
                    updateBulkDeleteUI();

                    showToast(`Deleted ${count} script(s)${chartRemovedTotal > 0 ? ` and removed ${chartRemovedTotal} study instance(s) from chart.` : '.'}`);
                    renderList(searchInput.value);
                }
            };
        }

        const listContainer = document.createElement('div');
        listContainer.className = 'tv-list-container';
        listContainer.style.cssText = 'flex:1; overflow-y:auto; padding:6px 12px 14px 12px; min-height:0; touch-action: pan-y !important; -webkit-overflow-scrolling: touch;';
        
        listWrapper.appendChild(actionsBar);
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
            if (cleanupEditorFn) cleanupEditorFn();
            isEditing = true;
            modal.classList.add('editor-mode');
            listWrapper.innerHTML = '';
            
            function triggerEditorFocus() {
                if (!monacoEditorInstance) return;
                try {
                    monacoEditorInstance.focus();
                } catch (_) {}
            }

            function relayoutEditor() {
                if (!monacoEditorInstance) return;
                try {
                    monacoEditorInstance.layout();
                } catch (_) {}
            }

            // Keyboard shortcut protection: ensure Ctrl+A / Cmd+A always selects inside the editor
            // rather than selecting outside text / entire page modal
            const handleEditorKeydown = (e) => {
                if (!isEditing || !monacoEditorInstance) return;
                const isSelectAll = (e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A');
                if (isSelectAll) {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                        monacoEditorInstance.focus();
                        const model = monacoEditorInstance.getModel();
                        if (model) {
                            monacoEditorInstance.setSelection(model.getFullModelRange());
                        } else {
                            monacoEditorInstance.trigger('keyboard', 'selectAll', {});
                        }
                    } catch (_) {
                        try { monacoEditorInstance.trigger('keyboard', 'selectAll', {}); } catch (_) {}
                    }
                }
            };
            window.addEventListener('keydown', handleEditorKeydown, true);

            cleanupEditorFn = () => {
                window.removeEventListener('keydown', handleEditorKeydown, true);
                modal.classList.remove('editor-mode');
                cleanupEditorFn = null;
                isEditing = false;
            };

            const edHeader = document.createElement('div');
            edHeader.className = 'tv-editor-header';
            edHeader.addEventListener('click', triggerEditorFocus);
            
            const titleRow = document.createElement('div');
            titleRow.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:14px; font-weight:600; color:#131722; min-width:0; flex:1; overflow:hidden;';
            let headerText = 'New Local Indicator';
            if (isFork) {
                headerText = `Fork & Edit: ${forkTitle || existingName}`;
            } else if (existingName) {
                headerText = `Edit: ${existingName}`;
            } else if (isStrategyTemplate) {
                headerText = 'New Local Strategy (Trade Chains)';
            }
            titleRow.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#2962FF; flex-shrink:0;"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg> 
                                  <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${headerText}</span>`;
            
            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex; align-items:center; gap:8px; flex-shrink:0;';
            
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.style.cssText = 'padding:6px 14px; border:1px solid #e0e3eb; background:#fff; border-radius:6px; cursor:pointer; font-size:13px; font-weight:500; color:#131722; transition:0.2s;';
            cancelBtn.onmouseover = () => cancelBtn.style.background = '#f8fafe';
            cancelBtn.onmouseout = () => cancelBtn.style.background = '#fff';
            cancelBtn.onclick = () => { if (cleanupEditorFn) cleanupEditorFn(); restoreListWrapper(); renderList(searchInput.value); };
            
            const saveBtn = document.createElement('button');
            saveBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="margin-right:4px; vertical-align:middle;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Save Script';
            saveBtn.style.cssText = 'padding:6px 14px; border:none; background:#2962FF; color:#fff; border-radius:6px; cursor:pointer; font-size:13px; font-weight:600; transition:0.2s; display:flex; align-items:center;';
            saveBtn.onmouseover = () => saveBtn.style.background = '#1E53E5';
            saveBtn.onmouseout = () => saveBtn.style.background = '#2962FF';

            const closeEditorBtn = document.createElement('div');
            closeEditorBtn.style.cssText = 'cursor:pointer; color:#787b86; padding:6px; margin-left:4px; border-radius:4px; transition:0.2s; display:flex; align-items:center; justify-content:center;';
            closeEditorBtn.title = 'Cancel & Exit Editor';
            closeEditorBtn.innerHTML = '<svg width="17" height="17" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12m0-12L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
            closeEditorBtn.onmouseover = () => { closeEditorBtn.style.background = '#f0f3fa'; closeEditorBtn.style.color = '#131722'; };
            closeEditorBtn.onmouseout = () => { closeEditorBtn.style.background = 'transparent'; closeEditorBtn.style.color = '#787b86'; };
            closeEditorBtn.onclick = () => { if (cleanupEditorFn) cleanupEditorFn(); restoreListWrapper(); renderList(searchInput.value); };

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(saveBtn);
            btnRow.appendChild(closeEditorBtn);
            edHeader.appendChild(titleRow);
            edHeader.appendChild(btnRow);
            
            const errorDiv = document.createElement('div');
            errorDiv.style.cssText = 'color:#f23645; font-size:12px; padding:12px 24px; background:#ffebec; border-bottom:1px solid #f23645; display:none;';
            
            saveBtn.onclick = () => {
                if(!monacoEditorInstance) return;
                try {
                    errorDiv.style.display = 'none';
                    let code = monacoEditorInstance.getValue();
                    const factory = new Function('PineJS', 'return (' + code + ');');
                    const obj = factory({ Std: {} }); 
                    
                    if (!obj || (!obj.name && (!obj.metainfo || !obj.metainfo.description))) {
                        throw new Error("Exported script object must have a 'name' or 'metainfo.description' property.");
                    }
                    const scriptName = obj.name || (obj.metainfo && obj.metainfo.description);
                    obj.name = scriptName;
                    if (!obj.metainfo) obj.metainfo = {};
                    if (!obj.metainfo.description) obj.metainfo.description = scriptName;
                    
                    const hasBuy = /this\.strategy\.buy|strategy\.buy|action\s*:\s*['"]BUY['"]/i.test(code);
                    const hasSell = /this\.strategy\.sell|strategy\.sell|action\s*:\s*['"]SELL['"]/i.test(code);
                    if (hasBuy && !hasSell) {
                        throw new Error("Invalid Strategy: Found Buy logic but no Sell logic. A strategy must contain both Buy and Sell operations.");
                    }
                    if (hasSell && !hasBuy) {
                        throw new Error("Invalid Strategy: Found Sell logic but no Buy logic. A strategy must contain both Buy and Sell operations.");
                    }

                    // Guarantee separate unique ID in metainfo if it's a fork, clone, or matches a remote/default script ID
                    const remoteStored = (window.ScriptRepoManager && window.ScriptRepoManager.remoteIndicators) || {};
                    const isRemoteId = Object.values(remoteStored).some(r => r.id && (r.id === obj.metainfo?.id || r.id.split('@')[0] === obj.metainfo?.id?.split('@')[0]));
                    const isDefaultId = ["SuperTrend_Custom@tv-basicstudies-1", "5_EMA_Crossover@tv-basicstudies-1", "SuperTrend_Strategy@tv-basicstudies-1"].includes(obj.metainfo?.id);
                    // Only assign a new ID if forking, colliding with remote/default, or missing an ID altogether.
                    // If editing an existing local script, KEEP its existing ID so active chart studies continue working!
                    const needsNewId = isFork || isRemoteId || isDefaultId || !obj.metainfo?.id;

                    if (needsNewId) {
                        const uniqueLocalId = (window.generateUniqueStudyId)
                            ? window.generateUniqueStudyId(scriptName, obj.metainfo && obj.metainfo.id)
                            : `${scriptName.replace(/[^a-zA-Z0-9]/g, '_')}_Local_${Date.now()}@tv-basicstudies-1`;
                        code = (window.injectStudyMetaId)
                            ? window.injectStudyMetaId(code, uniqueLocalId)
                            : code.replace(/id\s*:\s*["'][^"']*@tv-basicstudies[^"']*["']/, `id: "${uniqueLocalId}"`);
                    }

                    if (window.TVLocalStore) {
                        window.TVLocalStore.saveIndicator(scriptName, code, isFork ? null : existingName);
                    } else {
                        let stored = JSON.parse(localStorage.getItem('tv_local_indicators') || '{}');
                        if (!isFork && existingName && existingName !== scriptName) {
                            delete stored[existingName];
                        }
                        stored[scriptName] = code;
                        localStorage.setItem('tv_local_indicators', JSON.stringify(stored));
                    }
                    
                    if (cleanupEditorFn) cleanupEditorFn();
                    sessionStorage.setItem('tv_indicators_active_tab', 'custom');
                    sessionStorage.setItem('tv_auto_reload_study', scriptName);
                    showToast(`Saved "${scriptName}" to Local scripts.`);
                    setTimeout(() => location.reload(), 400);
                } catch (err) {
                    errorDiv.textContent = 'Validation / Syntax Error: ' + err.message;
                    errorDiv.style.display = 'block';
                }
            };
            
            const editorContainer = document.createElement('div');
            editorContainer.style.cssText = 'flex:1; width:100%; height:100%; min-height:0; outline:none; cursor:text; position:relative;';
            editorContainer.tabIndex = 0;
            editorContainer.addEventListener('click', triggerEditorFocus);
            editorContainer.addEventListener('mousedown', triggerEditorFocus);
            
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
                    triggerEditorFocus();
                    relayoutEditor();
                    setTimeout(() => { triggerEditorFocus(); relayoutEditor(); }, 50);
                    setTimeout(() => { triggerEditorFocus(); relayoutEditor(); }, 150);
                    setTimeout(() => { triggerEditorFocus(); relayoutEditor(); }, 350);
                });
            } else if (window.monaco) {
                monacoEditorInstance = monaco.editor.create(editorContainer, {
                    value: initialCode, language: 'javascript', theme: 'vs-light',
                    minimap: { enabled: true, scale: 0.75 }, automaticLayout: true, fontSize: 13,
                    scrollBeyondLastLine: false, padding: { top: 16 }
                });
                triggerEditorFocus();
                relayoutEditor();
                setTimeout(() => { triggerEditorFocus(); relayoutEditor(); }, 50);
                setTimeout(() => { triggerEditorFocus(); relayoutEditor(); }, 150);
                setTimeout(() => { triggerEditorFocus(); relayoutEditor(); }, 350);
            }
        }
        
        function restoreListWrapper() {
            modal.classList.remove('editor-mode');
            listWrapper.innerHTML = '';
            listWrapper.appendChild(actionsBar);
            listWrapper.appendChild(listHeader);
            listWrapper.appendChild(listContainer);
        }

        // --- SCRIPT METADATA, TIMESTAMP & SORT/GROUP HELPERS ---
        function getScriptTimestamp(item) {
            if (item.timestamp) return item.timestamp;
            let localMeta = {};
            try {
                localMeta = JSON.parse(localStorage.getItem('tv_scripts_metadata') || '{}');
            } catch (_) {}
            if (localMeta[item.name] && localMeta[item.name].updatedAt) {
                item.timestamp = localMeta[item.name].updatedAt;
                return item.timestamp;
            }
            if (item.code) {
                const m = item.code.match(/_(?:Local_)?(\d{10,14})@/);
                if (m && m[1]) {
                    const ts = parseInt(m[1], 10);
                    if (ts > 1600000000000 && ts < 2500000000000) {
                        item.timestamp = ts;
                        return item.timestamp;
                    }
                }
            }
            if (item.isRemote && window.ScriptRepoManager && window.ScriptRepoManager.repos) {
                const r = window.ScriptRepoManager.repos.find(repo => repo.id === item.repoId);
                if (r && r.lastSyncTime) {
                    item.timestamp = r.lastSyncTime;
                    return item.timestamp;
                }
            }
            if (item.sourceType === 'default') {
                item.timestamp = 1696000000000;
                return item.timestamp;
            }
            item.timestamp = 1700000000000;
            return item.timestamp;
        }

        function formatScriptDate(ts) {
            if (!ts || ts < 1650000000000) return '';
            try {
                const d = new Date(ts);
                const now = new Date();
                const diffMs = now - d;
                const diffDays = Math.floor(diffMs / 86400000);
                if (diffDays === 0) return 'Today';
                if (diffDays === 1) return 'Yesterday';
                if (diffDays < 30) return `${diffDays}d ago`;
                return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            } catch (_) {
                return '';
            }
        }

        function sortItems(itemList, sortKey) {
            return itemList.slice().sort((a, b) => {
                if (sortKey === 'name-asc') {
                    return a.displayName.localeCompare(b.displayName);
                } else if (sortKey === 'name-desc') {
                    return b.displayName.localeCompare(a.displayName);
                } else if (sortKey === 'date-desc') {
                    return (b.timestamp || 0) - (a.timestamp || 0);
                } else if (sortKey === 'date-asc') {
                    return (a.timestamp || 0) - (b.timestamp || 0);
                } else if (sortKey === 'type-ind') {
                    if (a.isStrat !== b.isStrat) return a.isStrat ? 1 : -1;
                    return a.displayName.localeCompare(b.displayName);
                } else if (sortKey === 'type-strat') {
                    if (a.isStrat !== b.isStrat) return a.isStrat ? -1 : 1;
                    return a.displayName.localeCompare(b.displayName);
                }
                return 0;
            });
        }

        function getGroupedBuckets(itemList, groupType) {
            if (groupType === 'type') {
                const indicators = itemList.filter(it => !it.isStrat);
                const strategies = itemList.filter(it => it.isStrat);
                return [
                    { title: 'Indicators', items: indicators },
                    { title: 'Strategies', items: strategies }
                ];
            }
            if (groupType === 'source') {
                const locals = itemList.filter(it => it.sourceType === 'local');
                const defaults = itemList.filter(it => it.sourceType === 'default');
                const githubs = itemList.filter(it => it.sourceType === 'github');
                const hfs = itemList.filter(it => it.sourceType === 'huggingface');
                const builtins = itemList.filter(it => it.sourceType === 'builtin');
                return [
                    { title: 'Local Scripts', items: locals },
                    { title: 'Default Scripts', items: defaults },
                    { title: 'GitHub Repositories', items: githubs },
                    { title: 'Hugging Face', items: hfs },
                    { title: 'Technicals', items: builtins }
                ];
            }
            if (groupType === 'status') {
                const active = itemList.filter(it => it._isAlreadyOnChart);
                const available = itemList.filter(it => !it._isAlreadyOnChart);
                return [
                    { title: 'Active on Chart', items: active },
                    { title: 'Available Scripts', items: available }
                ];
            }
            if (groupType === 'fav') {
                const favsList = getFavorites();
                const starred = itemList.filter(it => favsList.includes(it.name) || (it.displayName && favsList.includes(it.displayName)));
                const others = itemList.filter(it => !favsList.includes(it.name) && (!it.displayName || !favsList.includes(it.displayName)));
                return [
                    { title: 'Starred Favorites', items: starred },
                    { title: 'Other Scripts', items: others }
                ];
            }
            return [{ title: 'All Scripts', items: itemList }];
        }

        // --- CLEANLY REMOVE ATTACHED INSTANCES FROM CHART ON DELETE ---
        function removeScriptFromChartIfAttached(scriptName, scriptDisplayName) {
            let removedCount = 0;
            try {
                const chart = (widget && widget.chart && widget.chart()) || (window.tvWidget && window.tvWidget.activeChart && window.tvWidget.activeChart());
                if (!chart || typeof chart.getAllStudies !== 'function') return 0;
                
                const studies = chart.getAllStudies() || [];
                const tName = (scriptName || '').trim().toLowerCase();
                const tDisp = (scriptDisplayName || scriptName || '').trim().toLowerCase();
                
                studies.forEach(s => {
                    if (!s || !s.id) return;
                    const sName = (s.name || '').trim().toLowerCase();
                    const sDesc = (s.description || '').trim().toLowerCase();
                    const cleanS = window.sanitizeIndicatorName ? window.sanitizeIndicatorName(s.name).toLowerCase() : sName;
                    
                    const matches = (sName && (sName === tName || sName === tDisp || cleanS === tDisp || cleanS === tName)) ||
                                    (sDesc && (sDesc === tName || sDesc === tDisp)) ||
                                    (tName.length >= 4 && sName && (sName.startsWith(tName) || tName.startsWith(sName)));
                    if (matches) {
                        try {
                            chart.removeEntity(s.id);
                            removedCount++;
                            console.log(`[CustomIndicators] Removed study entity "${s.name}" (${s.id}) from chart.`);
                        } catch (e) {
                            console.warn(`[CustomIndicators] Error removing study entity ${s.id}:`, e);
                        }
                    }
                });
                
                // If this was the active strategy, clean up strategy state
                const savedStrat = localStorage.getItem('tv_active_strategy');
                if (savedStrat) {
                    const savedLower = savedStrat.trim().toLowerCase();
                    if (savedLower === tName || savedLower === tDisp || savedLower.startsWith(tName) || tName.startsWith(savedLower)) {
                        localStorage.removeItem('tv_active_strategy');
                        if (window.StrategyEngine && typeof window.StrategyEngine.clearAll === 'function') {
                            window.StrategyEngine.clearAll();
                        }
                        if (window.StrategyTesterUI && typeof window.StrategyTesterUI.destroyAll === 'function') {
                            window.StrategyTesterUI.destroyAll();
                        }
                    }
                }

                // Force layout auto-save so the removed study does not restore on reload
                if (removedCount > 0) {
                    try {
                        if (widget && typeof widget.saveChartToServer === 'function') {
                            widget.saveChartToServer();
                        }
                    } catch (_) {}
                }
            } catch (err) {
                console.warn("[CustomIndicators] Error in removeScriptFromChartIfAttached:", err);
            }
            return removedCount;
        }

        // --- RENDER INDICATORS & STRATEGIES LIST ---
        function renderList(searchQuery = "") {
            if (isEditing) return;
            
            const favs = getFavorites();
            if (favs.length > 0) {
                tabFavorites.classList.remove('hidden');
                tabFavorites.style.display = '';
            } else {
                tabFavorites.classList.add('hidden');
                tabFavorites.style.display = 'none';
                if (activeTab === 'favorites') {
                    activeTab = 'custom';
                    tabCustom.className = 'tv-custom-modal-tab active';
                    tabFavorites.className = 'tv-custom-modal-tab hidden';
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

            // 2. Local Scripts (from localStorage / TVLocalStore)
            let storedLocal = (window.TVLocalStore ? window.TVLocalStore.getIndicators() : {});
            if (Object.keys(storedLocal).length === 0) {
                try { storedLocal = JSON.parse(localStorage.getItem('tv_local_indicators') || '{}'); } catch(e){}
            }
            const localScripts = Object.keys(storedLocal).map(name => {
                const code = storedLocal[name] || '';
                let metaDesc = name;
                let metaName = name;
                try {
                    const factory = new Function('PineJS', 'return (' + code + ');');
                    const obj = factory({ Std: {} });
                    if (obj) {
                        if (obj.name) metaName = obj.name;
                        if (obj.metainfo && obj.metainfo.description) metaDesc = obj.metainfo.description;
                        else metaDesc = metaName;
                    }
                } catch (_) {}
                const cleanDisplayName = window.sanitizeIndicatorName ? window.sanitizeIndicatorName(name) : name;
                const isStrat = cleanDisplayName.includes("Strategy") || name.includes("Strategy") || (window.isStrategyScript && window.isStrategyScript(code));
                return {
                    name: name,
                    displayName: cleanDisplayName,
                    studyName: metaDesc || metaName || cleanDisplayName,
                    isStrat: isStrat,
                    sourceType: "local",
                    isLocal: true,
                    code: code
                };
            });

            // 3. Remote Synced Scripts (from ScriptRepoManager)
            let remoteScripts = [];
            if (window.ScriptRepoManager && window.ScriptRepoManager.remoteIndicators) {
                remoteScripts = Object.values(window.ScriptRepoManager.remoteIndicators).filter(item => {
                    const repo = window.ScriptRepoManager.repos.find(r => r.id === item.repoId);
                    return !repo || repo.enabled !== false;
                }).map(item => {
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
            // Build a comprehensive Set of all custom indicator identifiers to strip from allStudies
            const knownCustomNames = new Set();
            function addCustomIdentifier(str) {
                if (!str || typeof str !== 'string') return;
                const trimmed = str.trim();
                if (!trimmed) return;
                knownCustomNames.add(trimmed);
                knownCustomNames.add(trimmed.toLowerCase());
                if (window.sanitizeIndicatorName) {
                    const sanitized = window.sanitizeIndicatorName(trimmed).trim();
                    if (sanitized) {
                        knownCustomNames.add(sanitized);
                        knownCustomNames.add(sanitized.toLowerCase());
                    }
                }
            }

            [...defaultScripts, ...localScripts, ...remoteScripts].forEach(s => {
                addCustomIdentifier(s.name);
                addCustomIdentifier(s.displayName);
                addCustomIdentifier(s.studyName);
                if (s.code && typeof s.code === 'string') {
                    const mName = s.code.match(/name\s*:\s*["']([^"']+)["']/);
                    if (mName && mName[1]) addCustomIdentifier(mName[1]);
                    const mDesc = s.code.match(/description\s*:\s*["']([^"']+)["']/);
                    if (mDesc && mDesc[1]) addCustomIdentifier(mDesc[1]);
                    const mShort = s.code.match(/shortDescription\s*:\s*["']([^"']+)["']/);
                    if (mShort && mShort[1]) addCustomIdentifier(mShort[1]);
                }
            });

            const builtinScripts = allStudies.filter(name => {
                if (!name || typeof name !== 'string') return false;
                const trimmed = name.trim();
                if (knownCustomNames.has(trimmed) || knownCustomNames.has(trimmed.toLowerCase())) return false;
                if (window.sanitizeIndicatorName) {
                    const sanitized = window.sanitizeIndicatorName(trimmed).trim();
                    if (knownCustomNames.has(sanitized) || knownCustomNames.has(sanitized.toLowerCase())) return false;
                }
                return true;
            }).map(name => {
                const isStrat = name.toLowerCase().includes('strategy');
                return {
                    name: name,
                    displayName: name,
                    isStrat: isStrat,
                    sourceType: "builtin",
                    isBuiltin: true
                };
            });

            // Tab filtering: define current pool based on the active tab
            let currentTabPool = [];
            if (activeTab === 'favorites') {
                const allPool = [...defaultScripts, ...localScripts, ...remoteScripts, ...builtinScripts];
                currentTabPool = allPool.filter(item => favs.includes(item.name) || (item.displayName && favs.includes(item.displayName)));
            } else if (activeTab === 'custom') {
                currentTabPool = [...defaultScripts, ...localScripts, ...remoteScripts];
            } else {
                currentTabPool = builtinScripts;
            }

            // Search query filter: search within the active tab's pool
            let items = [];
            if (searchQuery && searchQuery.trim() !== '') {
                const q = searchQuery.trim().toLowerCase();
                items = currentTabPool.filter(item => {
                    const dName = (item.displayName || item.name || '').toLowerCase();
                    const rName = (item.repoName || '').toLowerCase();
                    return dName.includes(q) || rName.includes(q);
                });
            } else {
                items = currentTabPool;
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

            // Toggle & configure sleek actions bar for Custom scripts tab
            const isCustomTab = activeTab === 'custom';
            const isSearching = !!(searchQuery && searchQuery.trim() !== '');
            if (actionsBar) {
                if (isCustomTab && !isSearching) {
                    actionsBar.style.display = 'flex';
                    const repoCount = (window.ScriptRepoManager && window.ScriptRepoManager.repos) ? window.ScriptRepoManager.repos.length : 0;
                    const repoBadge = actionsBar.querySelector('#tv-actions-repo-count');
                    if (repoBadge) {
                        if (repoCount > 0) {
                            repoBadge.textContent = repoCount;
                            repoBadge.style.display = 'inline-block';
                        } else {
                            repoBadge.style.display = 'none';
                        }
                    }
                } else {
                    actionsBar.style.display = 'none';
                }
            }

            // Fetch currently applied studies to show Active badge and prevent duplicate strategy instances
            let currentStudies = [];
            try {
                const chart = widget.chart();
                if (chart && chart.getAllStudies) {
                    currentStudies = chart.getAllStudies() || [];
                }
            } catch (_) {}

            // Enrich items with Active status and Timestamp
            items.forEach(item => {
                const targetName = (item.name || '').trim().toLowerCase();
                const cleanTarget = (item.displayName || item.name || '').trim().toLowerCase();
                const studyTarget = (item.studyName || '').trim().toLowerCase();
                item._isAlreadyOnChart = currentStudies.some(s => {
                    const sName = (s.name || '').trim().toLowerCase();
                    const sId = (s.id || '').trim().toLowerCase();
                    const cleanS = window.sanitizeIndicatorName ? window.sanitizeIndicatorName(s.name).toLowerCase() : sName;
                    return sName === targetName || cleanS === cleanTarget || sName === cleanTarget || cleanS === targetName ||
                           (studyTarget && (sName === studyTarget || cleanS === studyTarget)) ||
                           (item.name && sId.includes(item.name.toLowerCase().replace(/[^a-z0-9]/g, '')));
                });
                item.timestamp = getScriptTimestamp(item);
                item.formattedDate = formatScriptDate(item.timestamp);
            });

            // Update header count
            const countEl = document.getElementById('tv-list-count');
            if (countEl) {
                countEl.textContent = `${items.length}`;
            }

            // Sort items according to active sort option
            items = sortItems(items, currentSort);
            currentRenderedItems = items;
            updateBulkDeleteUI();

            // Clear list container for clean rendering
            listContainer.innerHTML = '';

            if (items.length === 0) {
                listContainer.innerHTML = '<div style="padding:40px; color:#94a3b8; text-align:center; font-size:14px; font-weight:500;">No scripts found matching your filters</div>';
                return;
            }

            function createScriptRow(item) {
                const isFav = favs.includes(item.name) || (item.displayName && favs.includes(item.displayName));
                const isAlreadyOnChart = !!item._isAlreadyOnChart;

                const row = document.createElement('div');
                row.className = 'tv-script-row';
                if (isSelectMode && selectedScripts.has(item.name)) {
                    row.classList.add('selected');
                }

                // Selection Checkbox or Star Icon
                if (isSelectMode) {
                    if (item.isLocal) {
                        const cb = document.createElement('input');
                        cb.type = 'checkbox';
                        cb.className = 'tv-script-checkbox';
                        cb.checked = selectedScripts.has(item.name);
                        cb.title = `Select ${item.displayName}`;
                        cb.onclick = (e) => {
                            e.stopPropagation();
                            if (cb.checked) {
                                selectedScripts.add(item.name);
                                row.classList.add('selected');
                            } else {
                                selectedScripts.delete(item.name);
                                row.classList.remove('selected');
                            }
                            updateBulkDeleteUI();
                        };
                        row.appendChild(cb);
                    } else {
                        const lock = document.createElement('div');
                        lock.style.cssText = 'width:15px; height:15px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#94a3b8;';
                        lock.title = `"${item.displayName}" is permanent and cannot be deleted.`;
                        lock.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`;
                        row.appendChild(lock);
                        row.classList.add('non-selectable');
                        row.title = `"${item.displayName}" is permanent and cannot be deleted.`;
                    }
                } else {
                    const star = document.createElement('div');
                    star.className = isFav ? 'tv-star-icon active' : 'tv-star-icon';
                    star.title = isFav ? 'Remove from favorites' : 'Add to favorites';
                    star.innerHTML = isFav 
                        ? '<svg width="17" height="17" viewBox="0 0 18 18" stroke="currentColor" stroke-width="1.5"><path d="M9 1.5l2.25 4.75L16 7l-3.5 3.5L13.5 15.5 9 13 4.5 15.5 5.5 10.5 2 7l4.75-.75L9 1.5z" stroke-linejoin="round" fill="currentColor" /></svg>'
                        : '<svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 1.5l2.25 4.75L16 7l-3.5 3.5L13.5 15.5 9 13 4.5 15.5 5.5 10.5 2 7l4.75-.75L9 1.5z" stroke-linejoin="round" /></svg>';
                    star.onclick = (e) => { e.stopPropagation(); toggleFavorite(item.name); };
                    row.appendChild(star);
                }

                // Main Content (Name on top left-aligned, labels below with small font)
                const mainContent = document.createElement('div');
                mainContent.className = 'tv-script-main';

                const titleWrap = document.createElement('div');
                titleWrap.className = 'tv-script-title-wrap';
                const nameLabel = document.createElement('span');
                nameLabel.className = 'tv-script-title';
                nameLabel.textContent = item.displayName;
                nameLabel.title = item.displayName;
                titleWrap.appendChild(nameLabel);
                mainContent.appendChild(titleWrap);

                const badgesWrap = document.createElement('div');
                badgesWrap.className = 'tv-script-meta-wrap';

                // Shared SVG Icons for badges
                const fxSvg = `<svg width="10" height="10" viewBox="5 3.5 17 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 17l-5 5M15 17l5 5M9 11.5h7M17.5 8a2.5 2.5 0 0 0-5 0v11a2.5 2.5 0 0 1-5 0"/></svg>`;
                const stratSvg = `<svg width="10" height="10" viewBox="0 0 18 18" fill="currentColor"><path d="M7 1H6v2H4l2.5 3L9 3H7V1ZM11 17v-2H9l2.5-3 2.5 3h-2v2h-1ZM12.3 10.15l2.7-2.4-.67-.75-2.69 2.4a1 1 0 0 1-1.3.04L8.29 7.78a2 2 0 0 0-2.58.07L3 10.25l.67.75 2.7-2.4a1 1 0 0 1 1.29-.04l2.06 1.66a2 2 0 0 0 2.59-.07Z"/></svg>`;
                const pkgSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`;
                const laptopSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/></svg>`;
                const ghSvg = `<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;
                const hfEmoji = `<span style="font-size:10px; line-height:1; display:inline-flex; align-items:center;">🤗</span>`;
                const lockSvg = `<span class="tv-badge-lock-icon" title="Permanent official repository"><svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg></span>`;

                // Type Badge (Indicator fx / Strategy icon)
                const typeBadge = document.createElement('span');
                typeBadge.className = 'tv-badge-pill ' + (item.isStrat ? 'tv-badge-type-strat' : 'tv-badge-type-ind');
                typeBadge.title = item.isStrat ? 'Strategy' : 'Indicator';
                typeBadge.innerHTML = item.isStrat 
                    ? `${stratSvg}<span class="tv-badge-text">Strategy</span>`
                    : `${fxSvg}<span class="tv-badge-text">Indicator</span>`;
                badgesWrap.appendChild(typeBadge);

                // Check if this remote repository is permanent / official
                const isPerm = item.isPermanent || item.isDefault || item.isBuiltin || 
                               (item.isRemote && (!item.repoId || item.repoId === 'repo_official_indicators' || (window.ScriptRepoManager && window.ScriptRepoManager.repos.find(r => r.id === item.repoId && (r.isPermanent || r.isDefault)))));

                // Source Badge (Default, Local, or GitHub/HF with unified Permanent badge if hardcoded/official)
                if (item.sourceType === 'default') {
                    const srcBadge = document.createElement('span');
                    srcBadge.className = 'tv-badge-pill tv-badge-source-default';
                    srcBadge.title = 'Built-in Default Indicator';
                    srcBadge.innerHTML = `${pkgSvg}<span class="tv-badge-text">Default</span>`;
                    badgesWrap.appendChild(srcBadge);
                } else if (item.sourceType === 'local') {
                    const srcBadge = document.createElement('span');
                    srcBadge.className = 'tv-badge-pill tv-badge-source-local';
                    srcBadge.title = 'Local Custom Script';
                    const localText = item.name.includes('(Local Copy)') ? 'Local Copy' : 'Local';
                    srcBadge.innerHTML = `${laptopSvg}<span class="tv-badge-text">${localText}</span>`;
                    badgesWrap.appendChild(srcBadge);
                } else if (item.sourceType === 'github') {
                    const srcBadge = document.createElement('span');
                    const repoName = item.repoName || item.repoId || 'bunqi8/tradingview-indicators';
                    if (isPerm) {
                        srcBadge.className = 'tv-badge-pill tv-badge-source-github tv-badge-perm-gold';
                        srcBadge.title = `${repoName} (Permanent Official Repository)`;
                        srcBadge.innerHTML = `${ghSvg}<span class="tv-badge-text">GitHub</span>${lockSvg}`;
                    } else {
                        srcBadge.className = 'tv-badge-pill tv-badge-source-github';
                        srcBadge.title = repoName;
                        srcBadge.innerHTML = `${ghSvg}<span class="tv-badge-text">GitHub</span>`;
                    }
                    badgesWrap.appendChild(srcBadge);
                } else if (item.sourceType === 'huggingface') {
                    const srcBadge = document.createElement('span');
                    const repoName = item.repoName || item.repoId || 'Hugging Face';
                    if (isPerm) {
                        srcBadge.className = 'tv-badge-pill tv-badge-source-hf tv-badge-perm-gold';
                        srcBadge.title = `${repoName} (Permanent Official Repository)`;
                        srcBadge.innerHTML = `${hfEmoji}<span class="tv-badge-text">HF</span>${lockSvg}`;
                    } else {
                        srcBadge.className = 'tv-badge-pill tv-badge-source-hf';
                        srcBadge.title = repoName;
                        srcBadge.innerHTML = `${hfEmoji}<span class="tv-badge-text">HF</span>`;
                    }
                    badgesWrap.appendChild(srcBadge);
                } else if (item.sourceType === 'builtin') {
                    const srcBadge = document.createElement('span');
                    srcBadge.className = 'tv-badge-pill tv-badge-type-ind';
                    srcBadge.title = 'Built-in Indicator';
                    srcBadge.innerHTML = `${pkgSvg}<span class="tv-badge-text">Builtin</span>`;
                    badgesWrap.appendChild(srcBadge);
                }

                // Active Badge
                if (isAlreadyOnChart) {
                    const activeBadge = document.createElement('span');
                    activeBadge.className = 'tv-badge-pill tv-badge-active';
                    activeBadge.title = 'Currently active on chart';
                    activeBadge.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span class="tv-badge-text">Active</span>`;
                    badgesWrap.appendChild(activeBadge);
                }

                // Date Subtitle
                if (item.formattedDate) {
                    const dateSpan = document.createElement('span');
                    dateSpan.className = 'tv-script-date';
                    dateSpan.textContent = item.formattedDate;
                    badgesWrap.appendChild(dateSpan);
                }

                mainContent.appendChild(badgesWrap);
                row.appendChild(mainContent);

                // Action Buttons
                const actions = document.createElement('div');
                actions.className = 'tv-script-actions';
                if (isSelectMode) {
                    actions.style.display = 'none';
                }

                if (item.isLocal) {
                    const editBtn = document.createElement('div');
                    editBtn.className = 'tv-item-action-btn';
                    editBtn.title = 'Edit Local Script';
                    editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> <span>Edit</span>';
                    editBtn.onclick = (e) => { e.stopPropagation(); showEditor(item.code, item.name, item.isStrat); };

                    const delBtn = document.createElement('div');
                    delBtn.className = 'tv-item-action-btn tv-del-btn';
                    delBtn.title = 'Delete Local Script';
                    delBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
                    delBtn.onclick = (e) => { 
                        e.stopPropagation(); 
                        if (confirm(`Delete local script "${item.displayName || item.name}"?\n\nAny active instances on the chart will also be removed cleanly.`)) {
                            const r = removeScriptFromChartIfAttached(item.name, item.displayName);
                            if (window.TVLocalStore) {
                                window.TVLocalStore.deleteIndicator(item.name);
                            } else {
                                delete storedLocal[item.name];
                                localStorage.setItem('tv_local_indicators', JSON.stringify(storedLocal));
                            }
                            let fs = getFavorites();
                            if (fs.includes(item.name)) {
                                localStorage.setItem('tv_favorite_indicators', JSON.stringify(fs.filter(f => f !== item.name)));
                            }
                            selectedScripts.delete(item.name);
                            showToast(`Deleted "${item.displayName}"${r > 0 ? ' and removed from chart.' : '.'}`);
                            renderList(searchInput.value);
                        }
                    };

                    actions.appendChild(editBtn);
                    actions.appendChild(delBtn);
                } else if (item.isRemote || item.isDefault) {
                    const forkBtn = document.createElement('div');
                    forkBtn.className = 'tv-item-action-btn';
                    forkBtn.title = item.isRemote ? 'Fork & Edit Local Working Copy' : 'View / Fork as Local Working Copy';
                    forkBtn.innerHTML = `
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
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

                row.onclick = async () => {
                    if (isSelectMode) {
                        if (!item.isLocal) {
                            showToast(`"${item.displayName}" is a ${item.sourceType} script and cannot be deleted.`);
                            return;
                        }
                        const cb = row.querySelector('.tv-script-checkbox');
                        if (selectedScripts.has(item.name)) {
                            selectedScripts.delete(item.name);
                            row.classList.remove('selected');
                            if (cb) cb.checked = false;
                        } else {
                            selectedScripts.add(item.name);
                            row.classList.add('selected');
                            if (cb) cb.checked = true;
                        }
                        updateBulkDeleteUI();
                        return;
                    }

                    // Check if already on chart
                    if (item.isStrat) {
                        if (item._isAlreadyOnChart) {
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
                    } else if (item._isAlreadyOnChart) {
                        const confirmDup = confirm(`"${item.displayName}" is already added to the chart.\n\nDo you really want to add another copy of this indicator?`);
                        if (!confirmDup) {
                            closeModal();
                            return;
                        }
                    }

                    showToast(`Adding "${item.displayName}" to chart...`);

                    // Collect candidate study names that TradingView might recognize
                    const candidates = [];
                    if (item.studyName) candidates.push(item.studyName);
                    if (item.displayName) candidates.push(item.displayName);
                    if (item.name) candidates.push(item.name);

                    // Fetch registered study descriptions from TradingView
                    let rawStudies = [];
                    try {
                        if (typeof widget.getStudiesList === 'function') {
                            rawStudies = widget.getStudiesList() || [];
                        }
                    } catch (_) {}
                    const availDescriptions = rawStudies.map(s => typeof s === 'string' ? s : (s.name || s.description || '')).filter(Boolean);

                    const targetLow = (item.displayName || item.name || '').toLowerCase();
                    for (const desc of availDescriptions) {
                        const dLow = desc.toLowerCase();
                        if (dLow === targetLow) {
                            candidates.unshift(desc); // Exact match in TradingView's list!
                        } else if (dLow.includes(targetLow) || targetLow.includes(dLow)) {
                            candidates.push(desc);
                        } else if (window.sanitizeIndicatorName && window.sanitizeIndicatorName(desc).toLowerCase() === targetLow) {
                            candidates.push(desc);
                        }
                    }

                    if (item.code && typeof item.code === 'string') {
                        const mDesc = item.code.match(/description\s*:\s*["']([^"']+)["']/);
                        if (mDesc && mDesc[1]) candidates.push(mDesc[1]);
                        const mName = item.code.match(/name\s*:\s*["']([^"']+)["']/);
                        if (mName && mName[1]) candidates.push(mName[1]);
                    }

                    const uniqueTargets = [...new Set(candidates.filter(Boolean))];
                    let addedEntityId = null;
                    let lastErr = null;

                    for (const target of uniqueTargets) {
                        try {
                            const resPromise = widget.chart().createStudy(target, false, false);
                            const res = (resPromise && typeof resPromise.then === 'function') ? await resPromise : resPromise;
                            if (res !== null && res !== undefined) {
                                addedEntityId = res;
                                console.log(`[CustomIndicators] Successfully added study with target '${target}' -> id:`, res);
                                break;
                            }
                        } catch (err) {
                            lastErr = err;
                            console.warn(`[CustomIndicators] createStudy candidate '${target}' failed:`, err);
                        }
                    }

                    if (addedEntityId !== null) {
                        showToast(`Added "${item.displayName}" to chart.`);
                        if (item.isStrat) {
                            localStorage.setItem('tv_active_strategy', item.name);
                            if (window.StrategyEngine) {
                                window.StrategyEngine.setActiveStrategy(item.name);
                            }
                            if (window.StrategyTesterUI) {
                                window.StrategyTesterUI.show();
                            }
                            try {
                                if (typeof widget.save === 'function') {
                                    widget.save(function() {});
                                }
                            } catch (_) {}
                        }
                        closeModal();
                    } else {
                        console.error("[CustomIndicators] All createStudy targets failed for:", item.displayName, uniqueTargets, lastErr);
                        showToast(`Could not load "${item.displayName}". The study engine may still be initializing.`);
                    }
                };

                return row;
            }

            // Render either flat or grouped list
            if (currentGroup === 'none') {
                const fragment = document.createDocumentFragment();
                items.forEach(item => {
                    fragment.appendChild(createScriptRow(item));
                });
                listContainer.appendChild(fragment);
            } else {
                const groups = getGroupedBuckets(items, currentGroup);
                const fragment = document.createDocumentFragment();
                groups.forEach(group => {
                    if (!group.items || group.items.length === 0) return;
                    const gHeader = document.createElement('div');
                    gHeader.className = 'tv-group-header';
                    gHeader.innerHTML = `
                        <div class="tv-group-header-left">
                            <span class="tv-group-title">${group.title}</span>
                            <span class="tv-group-count">${group.items.length}</span>
                        </div>
                        <div class="tv-group-divider-line"></div>
                    `;
                    fragment.appendChild(gHeader);
                    group.items.forEach(item => {
                        fragment.appendChild(createScriptRow(item));
                    });
                });
                listContainer.appendChild(fragment);
            }
        }
        
        function openModal() {
            try { 
                const rawStudies = (typeof widget.getStudiesList === 'function' ? widget.getStudiesList() : []) || [];
                if (rawStudies.length > 0) {
                    allStudies = rawStudies.map(s => (typeof s === 'string' ? s : (s.name || s.description || ""))).filter(Boolean);
                }
            } catch(e) {}
            modalOverlay.classList.add('visible');
            searchInput.value = '';
            isEditing = false;
            isSelectMode = false;
            selectedScripts.clear();
            if (selectBtn) selectBtn.classList.remove('active');
            if (selectText) selectText.textContent = 'Select';
            if (cleanupEditorFn) cleanupEditorFn();
            restoreListWrapper();
            const favCount = getFavorites().length;
            const savedTab = sessionStorage.getItem('tv_indicators_active_tab');
            if (savedTab && (savedTab !== 'favorites' || favCount > 0)) {
                activeTab = savedTab;
            } else {
                activeTab = 'custom'; // Default to custom so local scripts are front-and-center!
            }
            if (favCount === 0) {
                tabFavorites.classList.add('hidden');
                tabFavorites.style.display = 'none';
            } else {
                tabFavorites.classList.remove('hidden');
                tabFavorites.style.display = '';
            }
            tabFavorites.className = (activeTab === 'favorites' ? 'tv-custom-modal-tab active' : 'tv-custom-modal-tab') + (favCount === 0 ? ' hidden' : '');
            tabCustom.className = activeTab === 'custom' ? 'tv-custom-modal-tab active' : 'tv-custom-modal-tab';
            tabBuiltin.className = activeTab === 'builtin' ? 'tv-custom-modal-tab active' : 'tv-custom-modal-tab';
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
            if (cleanupEditorFn) cleanupEditorFn();
            isSelectMode = false;
            selectedScripts.clear();
            if (selectBtn) selectBtn.classList.remove('active');
            if (selectText) selectText.textContent = 'Select';
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
            sessionStorage.setItem('tv_indicators_active_tab', 'favorites');
            if (!isEditing) restoreListWrapper();
            if (cleanupEditorFn) cleanupEditorFn();
            isEditing = false;
            isSelectMode = false;
            selectedScripts.clear();
            if (selectBtn) selectBtn.classList.remove('active');
            if (selectText) selectText.textContent = 'Select';
            tabFavorites.className = 'tv-custom-modal-tab active';
            tabCustom.className = 'tv-custom-modal-tab';
            tabBuiltin.className = 'tv-custom-modal-tab';
            renderList();
        });

        tabCustom.addEventListener('click', () => {
            if (searchInput.value.trim() !== '') searchInput.value = '';
            activeTab = 'custom';
            sessionStorage.setItem('tv_indicators_active_tab', 'custom');
            if (!isEditing) restoreListWrapper();
            if (cleanupEditorFn) cleanupEditorFn();
            isEditing = false;
            isSelectMode = false;
            selectedScripts.clear();
            if (selectBtn) selectBtn.classList.remove('active');
            if (selectText) selectText.textContent = 'Select';
            tabCustom.className = 'tv-custom-modal-tab active';
            tabFavorites.className = 'tv-custom-modal-tab';
            tabBuiltin.className = 'tv-custom-modal-tab';
            renderList();
        });
        
        tabBuiltin.addEventListener('click', () => {
            if (searchInput.value.trim() !== '') searchInput.value = '';
            activeTab = 'builtin';
            sessionStorage.setItem('tv_indicators_active_tab', 'builtin');
            if (!isEditing) restoreListWrapper();
            if (cleanupEditorFn) cleanupEditorFn();
            isEditing = false;
            isSelectMode = false;
            selectedScripts.clear();
            if (selectBtn) selectBtn.classList.remove('active');
            if (selectText) selectText.textContent = 'Select';
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
                const favCount = getFavorites().length;
                tabFavorites.style.opacity = '1'; tabCustom.style.opacity = '1'; tabBuiltin.style.opacity = '1';
                tabFavorites.className = (activeTab === 'favorites' ? 'tv-custom-modal-tab active' : 'tv-custom-modal-tab') + (favCount === 0 ? ' hidden' : '');
                tabCustom.className = activeTab === 'custom' ? 'tv-custom-modal-tab active' : 'tv-custom-modal-tab';
                tabBuiltin.className = activeTab === 'builtin' ? 'tv-custom-modal-tab active' : 'tv-custom-modal-tab';
                if (favCount === 0) {
                    tabFavorites.style.display = 'none';
                } else {
                    tabFavorites.style.display = '';
                }
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
            repoContentArea.innerHTML = '';
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
                const isEnabled = repo.enabled !== false;
                const isPerm = !!(repo.isPermanent || repo.isDefault);

                let statusColor = '#089981';
                let statusText = `${repo.scriptCount || 0} scripts synced`;
                if (!isEnabled) {
                    statusColor = '#94a3b8';
                    statusText = 'Disabled';
                } else if (repo.syncStatus === 'syncing') {
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
                                ${isPerm 
                                    ? '<span style="font-size:10.5px; background:#eff6ff; color:#1e40af; border:1px solid #bfdbfe; padding:1px 6px; border-radius:4px; font-weight:700; display:inline-flex; align-items:center; gap:3px;" title="Permanent repository: cannot be deleted, can be disabled"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>Permanent</span>' 
                                    : '<span style="font-size:10.5px; background:#fef3c7; color:#92400e; border:1px solid #fde68a; padding:1px 6px; border-radius:4px; font-weight:700; display:inline-flex; align-items:center; gap:3px;" title="User added repository: can be edited and deleted"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>User Added</span>'}
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
                    <div class="tv-repo-card-actions" style="display:flex; gap:6px; align-items:center;">
                        <button class="tv-repo-toggle-btn" title="${isEnabled ? 'Click to disable repository' : 'Click to enable repository'}" style="background:${isEnabled ? '#ecfdf5' : '#f8fafc'}; border:1px solid ${isEnabled ? '#a7f3d0' : '#cbd5e1'}; color:${isEnabled ? '#065f46' : '#64748b'}; border-radius:6px; padding:6px 10px; cursor:pointer; font-size:12px; font-weight:600; display:flex; align-items:center; gap:5px; transition:0.15s;">
                            <span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:${isEnabled ? '#10b981' : '#94a3b8'};"></span>
                            <span>${isEnabled ? 'Enabled' : 'Disabled'}</span>
                        </button>
                        <button class="tv-repo-sync-btn" title="Sync this repository" style="background:#f8fafe; border:1px solid #cbd5e1; border-radius:6px; padding:6px 10px; cursor:pointer; font-size:12px; font-weight:600; color:#1e293b; display:flex; align-items:center; gap:4px; ${!isEnabled ? 'opacity:0.5; pointer-events:none;' : ''}">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
                            <span>Sync</span>
                        </button>
                        <button class="tv-repo-edit-btn" title="Edit repository settings" style="background:#f8fafe; border:1px solid #cbd5e1; border-radius:6px; padding:6px 8px; cursor:pointer; color:#64748b; ${isPerm ? 'display:none !important;' : ''}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="tv-repo-del-btn" title="Delete repository" style="background:#f8fafe; border:1px solid #cbd5e1; border-radius:6px; padding:6px 8px; cursor:pointer; color:#ef4444; ${isPerm ? 'display:none !important;' : ''}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                `;

                card.querySelector('.tv-repo-toggle-btn').onclick = async () => {
                    const toggled = window.ScriptRepoManager.toggleRepo(repo.id);
                    const isNowActive = toggled.enabled !== false;
                    showToast(`Repository "${repo.repo || repo.repoId}" ${isNowActive ? 'enabled' : 'disabled'}.`);
                    if (isNowActive && !repo.lastCommitSha) {
                        await window.ScriptRepoManager.syncRepo(repo);
                    }
                    renderReposView();
                    renderList(searchInput.value);
                };

                card.querySelector('.tv-repo-sync-btn').onclick = async () => {
                    if (repo.enabled === false) {
                        showToast(`Repository "${repo.repo || repo.repoId}" is disabled. Enable it to sync.`);
                        return;
                    }
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

                if (isPerm) {
                    const delBtn = card.querySelector('.tv-repo-del-btn');
                    if (delBtn) delBtn.style.display = 'none';
                } else {
                    card.querySelector('.tv-repo-del-btn').onclick = () => {
                        if (confirm(`Delete repository "${repo.repo || repo.repoId}"? All synced scripts from this repo will also be removed.`)) {
                            window.ScriptRepoManager.deleteRepo(repo.id);
                            showToast("Repository removed.");
                            renderReposView();
                            renderList(searchInput.value);
                        }
                    };
                }

                listEl.appendChild(card);
            });

            repoContentArea.appendChild(listEl);
        }

        // --- ADD / EDIT REPO FORM ---
        function showRepoForm(existingRepo = null) {
            const container = document.getElementById('tv-repo-form-container');
            if (!container) return;
            if (existingRepo && (existingRepo.isPermanent || existingRepo.isDefault)) {
                showToast("Permanent official repository cannot be edited.");
                return;
            }

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
                        <div class="tv-form-row-2col" style="display:flex; gap:12px;">
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
            repoContentArea.innerHTML = '';
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
                    <div class="tv-repo-card-actions" style="display:flex; gap:6px; align-items:center;">
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
                        <div class="tv-form-row-2col" style="display:flex; gap:12px;">
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

        // Listen for storage & sync events to keep UI in sync
        window.addEventListener('tv_remote_scripts_updated', () => {
            if (modalOverlay.classList.contains('visible') && !isEditing) {
                renderList(searchInput.value);
            }
        });
        window.addEventListener('tv_script_repos_updated', () => {
            updateRepoModalBadges();
        });
        window.addEventListener('tv_sync_started', () => {
            const el = document.getElementById('tv-global-sync-status');
            if (el) {
                el.style.color = '#2563eb';
                el.innerHTML = `<svg class="tv-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg><span>Syncing with GitHub...</span>`;
            }
        });
        window.addEventListener('tv_sync_completed', () => {
            const el = document.getElementById('tv-global-sync-status');
            if (el) {
                el.style.color = '#089981';
                el.innerHTML = `<span style="width:6px; height:6px; border-radius:50%; background:#089981; display:inline-block;"></span><span>Synced</span>`;
            }
        });
    });
}
