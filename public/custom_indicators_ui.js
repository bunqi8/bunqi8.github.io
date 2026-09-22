function setupCustomIndicatorsDialog(widget) {
    widget.headerReady().then(function() {
        const iframe = document.querySelector('#tv_chart_container iframe');
        const iframeDoc = iframe.contentWindow.document;
        
        // --- 1. AUTO REMOVE & RE-ADD (Hot Reload Workflow) ---
        const autoLoad = sessionStorage.getItem('tv_auto_reload_study');
        if (autoLoad) {
            sessionStorage.removeItem('tv_auto_reload_study');
            // Wait for chart layout to fully restore, then hot-swap the indicator
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
        // We use setInterval because TradingView's SPA aggressively destroys and recreates DOM elements, 
        // which often unhooks MutationObservers attached too early.
        setInterval(() => {
            try {
                const iframe = document.querySelector('#tv_chart_container iframe');
                if (!iframe) return;
                const iframeDoc = iframe.contentWindow.document;
                
                // Hook into 'delete' or 'settings' buttons (TV uses data-name or data-qa-id depending on version)
                const actionButtons = iframeDoc.querySelectorAll([
                    '[data-name="legend-delete-action"]', 
                    '[data-qa-id="legend-delete-action"]',
                    '[data-name="legend-settings-action"]',
                    '[data-qa-id="legend-settings-action"]'
                ].join(', '));
                
                actionButtons.forEach(btn => {
                    const container = btn.parentNode;
                    if (!container) return;
                    
                    // Critical React Fix: React might reuse the container but wipe our injected child.
                    // We must check if our button physically exists, not just rely on a dataset flag.
                    if (container.querySelector('.tv-custom-source-btn')) return;
                    
                    // Get the study title to map it to our local indicators
                    let studyTitle = "";
                    const legendItem = container.closest('[data-name="legend-item"], [data-qa-id="legend-item"], tr, [class*="legend-item"]');
                    if (legendItem) {
                        const titleEl = legendItem.querySelector('[data-name="legend-source-title"], [data-qa-id="legend-source-title"], [class*="title"]');
                        if (titleEl) studyTitle = titleEl.textContent.trim();
                    }

                    // Create the {} button
                    const srcBtn = iframeDoc.createElement('div');
                    srcBtn.className = 'tv-custom-source-btn';
                    srcBtn.innerHTML = '{ }';
                    srcBtn.title = 'Open Local Code Editor';
                    srcBtn.style.cssText = 'display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; margin:0 2px; cursor:pointer; font-family:"JetBrains Mono", Consolas, monospace; font-weight:700; font-size:13px; color:#131722; border-radius:4px; transition:0.2s;';
                    srcBtn.onmouseover = () => { srcBtn.style.background = '#f0f3fa'; srcBtn.style.color = '#2962FF'; };
                    srcBtn.onmouseout = () => { srcBtn.style.background = 'transparent'; srcBtn.style.color = '#131722'; };
                    
                    srcBtn.onclick = (e) => {
                        e.stopPropagation();
                        openModal();
                        
                        // Try to automatically open the editor for this specific script
                        let stored = {};
                        try { stored = JSON.parse(localStorage.getItem('tv_local_indicators') || '{}'); } catch(e){}
                        
                        // Search stored scripts for a matching name or shortDescription
                        let matchedKey = null;
                        for (const [key, code] of Object.entries(stored)) {
                            if (key === studyTitle || code.includes(`shortDescription: "${studyTitle}"`) || code.includes(`shortDescription: '${studyTitle}'`)) {
                                matchedKey = key;
                                break;
                            }
                        }
                        
                        // Small timeout to allow modal UI to build
                        setTimeout(() => {
                            if (matchedKey) {
                                showEditor(stored[matchedKey], matchedKey);
                            }
                        }, 50);
                    };
                    
                    // Insert right BEFORE the delete button or AT THE END of the container
                    if (btn.getAttribute('data-name') === 'legend-delete-action' || btn.getAttribute('data-qa-id') === 'legend-delete-action') {
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
        let nativeBtnFound = false;
        const checkInterval = setInterval(() => {
            const nativeBtn = iframeDoc.getElementById('header-toolbar-indicators');
            if (nativeBtn && !nativeBtnFound) {
                nativeBtnFound = true;
                clearInterval(checkInterval);
                
                ['click', 'mousedown', 'mouseup'].forEach(evt => {
                    nativeBtn.addEventListener(evt, (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (evt === 'click') {
                            openModal();
                        }
                    }, true);
                });
            }
        }, 100);

        const style = document.createElement('style');
        style.textContent = `
            .tv-custom-modal-overlay {
                display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(2px); z-index: 99999; align-items: center; justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif;
            }
            .tv-custom-modal {
                background: #ffffff; width: 850px; height: 650px; max-width: 95%; max-height: 95%;
                border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.15); overflow: hidden;
            }
            .tv-custom-modal-body {
                display: flex; flex: 1; overflow: hidden; border-top: 1px solid #e0e3eb;
            }
            .tv-custom-modal-tabs {
                width: 220px; display: flex; flex-direction: column; padding: 16px 12px; border-right: 1px solid #e0e3eb; background: #fafbfc;
            }
            .tv-custom-modal-tab {
                padding: 12px 16px; margin-bottom: 4px; font-size: 14px; cursor: pointer; color: #131722; font-weight: 500;
                border-radius: 8px; transition: all 0.2s ease; display: flex; align-items: center; gap: 12px; border: 1px solid transparent;
            }
            .tv-custom-modal-tab:hover {
                background: #f0f3fa;
            }
            .tv-custom-modal-tab.active {
                background: #ffffff; color: #2962FF; box-shadow: 0 1px 3px rgba(0,0,0,0.05); border: 1px solid #e0e3eb;
            }
            .tv-editor-header {
                display: flex; justify-content: space-between; align-items: center; padding: 12px 24px; border-bottom: 1px solid #e0e3eb; background: #ffffff;
            }
            
            .tv-list-container::-webkit-scrollbar { width: 6px; }
            .tv-list-container::-webkit-scrollbar-thumb { background: #d1d4dc; border-radius: 3px; }
            .tv-list-container::-webkit-scrollbar-track { background: transparent; }

            @media (max-width: 768px) {
                .tv-custom-modal { width: 100%; height: 100%; max-width: 100%; max-height: 100%; border-radius: 0; }
                .tv-custom-modal-body { flex-direction: column; }
                .tv-custom-modal-tabs { width: 100%; flex-direction: row; border-right: none; border-bottom: 1px solid #e0e3eb; padding: 8px; background: #ffffff; }
                .tv-custom-modal-tab { flex: 1; justify-content: center; margin-bottom: 0; margin-right: 4px; padding: 10px 8px; font-size: 13px; }
                .tv-editor-header { padding: 12px; }
            }
        `;
        document.head.appendChild(style);

        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'tv-custom-modal-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'tv-custom-modal';
        
        const header = document.createElement('div');
        header.style.cssText = 'padding:16px 24px 12px 24px; display:flex; justify-content:space-between; align-items:center; background: #ffffff;';
        header.innerHTML = '<div style="font-size:18px; font-weight:700; color:#131722; letter-spacing:-0.2px;">Indicators, metrics, and strategies</div><div id="tv-close-modal" style="cursor:pointer; color:#787b86; padding:6px; border-radius:4px; transition:0.2s;"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1l12 12m0-12L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>';
        header.querySelector('#tv-close-modal').onmouseover = function() { this.style.background = '#f0f3fa'; this.style.color = '#131722'; };
        header.querySelector('#tv-close-modal').onmouseout = function() { this.style.background = 'transparent'; this.style.color = '#787b86'; };

        const searchContainer = document.createElement('div');
        searchContainer.style.cssText = 'padding:0 24px 16px 24px; background: #ffffff;';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search';
        searchInput.style.cssText = 'width:100%; padding:10px 14px 10px 38px; border:1px solid #e0e3eb; border-radius:8px; font-size:15px; color:#131722; outline:none; box-sizing:border-box; background:url("data:image/svg+xml;utf8,<svg width=\'18\' height=\'18\' viewBox=\'0 0 18 18\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'><path d=\'M12.5 12.5L15 15M14 8.5a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z\' stroke=\'%23787b86\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/></svg>") no-repeat 12px center; background-color: #f8fafe; transition: all 0.2s ease;';
        searchInput.onfocus = () => { searchInput.style.borderColor = '#2962FF'; searchInput.style.backgroundColor = '#ffffff'; searchInput.style.boxShadow = '0 0 0 3px rgba(41,98,255,0.1)'; };
        searchInput.onblur = () => { searchInput.style.borderColor = '#e0e3eb'; searchInput.style.backgroundColor = '#f8fafe'; searchInput.style.boxShadow = 'none'; };
        searchContainer.appendChild(searchInput);

        const bodyContainer = document.createElement('div');
        bodyContainer.className = 'tv-custom-modal-body';
        
        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'tv-custom-modal-tabs';
        
        const tabCustom = document.createElement('div');
        const tabBuiltin = document.createElement('div');
        
        const userIcon = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-6 8a6 6 0 0112 0H4z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const builtinIcon = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 17V9m5 8V5m5 12v-5m5 5V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        tabCustom.innerHTML = userIcon + 'Custom scripts';
        tabBuiltin.innerHTML = builtinIcon + 'Technicals';
        
        tabCustom.className = 'tv-custom-modal-tab active';
        tabBuiltin.className = 'tv-custom-modal-tab';
        
        tabsContainer.appendChild(tabCustom);
        tabsContainer.appendChild(tabBuiltin);
        
        const listWrapper = document.createElement('div');
        listWrapper.style.cssText = 'flex:1; display:flex; flex-direction:column; background: #ffffff;';
        
        const listHeader = document.createElement('div');
        listHeader.style.cssText = 'padding:16px 24px 8px 24px; font-size:11px; font-weight:600; color:#b2b5be; text-transform:uppercase; letter-spacing:0.4px;';
        listHeader.textContent = 'Script name';

        const listContainer = document.createElement('div');
        listContainer.className = 'tv-list-container';
        listContainer.style.cssText = 'flex:1; overflow-y:auto; padding:0 12px 12px 12px;';
        
        listWrapper.appendChild(listHeader);
        listWrapper.appendChild(listContainer);

        bodyContainer.appendChild(tabsContainer);
        bodyContainer.appendChild(listWrapper);

        modal.appendChild(header);
        modal.appendChild(searchContainer);
        modal.appendChild(bodyContainer);
        modalOverlay.appendChild(modal);
        document.body.appendChild(modalOverlay);
        
        let allStudies = [];
        let activeTab = 'custom';
        let isEditing = false;
        
        // Editor Instance
        let monacoEditorInstance = null;
        
        function showEditor(existingCode = '', existingName = null) {
            isEditing = true;
            listWrapper.innerHTML = '';
            
            const edHeader = document.createElement('div');
            edHeader.className = 'tv-editor-header';
            
            const titleRow = document.createElement('div');
            titleRow.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:15px; font-weight:600; color:#131722;';
            titleRow.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#2962FF"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg> 
                                  <span>${existingName ? 'Edit: ' + existingName : 'New Local Indicator'}</span>`;
            
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
                    const code = monacoEditorInstance.getValue();
                    const factory = new Function('PineJS', 'return (' + code + ');');
                    const obj = factory({ Std: {} }); // Mock validation
                    
                    if (!obj || !obj.name) throw new Error("Exported script object must have a 'name' property.");
                    
                    let stored = JSON.parse(localStorage.getItem('tv_local_indicators') || '{}');
                    if (existingName && existingName !== obj.name) {
                        delete stored[existingName];
                    }
                    stored[obj.name] = code;
                    localStorage.setItem('tv_local_indicators', JSON.stringify(stored));
                    
                    // Set flag for auto-reloading
                    sessionStorage.setItem('tv_auto_reload_study', obj.name);
                    location.reload();
                } catch (err) {
                    errorDiv.textContent = 'Syntax Error: ' + err.message;
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
            
            const defaultCode = `{\n    name: "My Script",\n    metainfo: {\n        _metainfoVersion: 52,\n        isTVScript: false,\n        is_hidden_study: false,\n        defaults: {\n            styles: { plot_0: { plottype: 0, linewidth: 2, color: "#2962FF" } },\n            inputs: {}\n        },\n        plots: [{ id: "plot_0", type: "line" }],\n        styles: { plot_0: { title: "Plot" } },\n        description: "My Script",\n        shortDescription: "My Script",\n        is_price_study: true,\n        inputs: [],\n        id: "My_Script@tv-basicstudies-1",\n        scriptIdPart: "",\n        name: "My Script"\n    },\n    constructor: function() {\n        this.init = function(ctx, input) { this._context = ctx; };\n        this.main = function(ctx, input) {\n            this._context = ctx || this._context;\n            return [{ value: PineJS.Std.close(this._context) }];\n        };\n    }\n}`;
            
            // Initialize Monaco
            if (window.require && !window.monaco) {
                require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.39.0/min/vs' }});
                require(['vs/editor/editor.main'], function() {
                    // Disable syntax errors for naked JS objects
                    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
                        noSemanticValidation: true,
                        noSyntaxValidation: true
                    });
                    
                    monacoEditorInstance = monaco.editor.create(editorContainer, {
                        value: existingCode || defaultCode,
                        language: 'javascript',
                        theme: 'vs-light',
                        minimap: { enabled: true, scale: 0.75 },
                        automaticLayout: true,
                        fontSize: 13,
                        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                        scrollBeyondLastLine: false,
                        roundedSelection: false,
                        padding: { top: 16 }
                    });
                });
            } else if (window.monaco) {
                // Disable syntax errors for naked JS objects
                monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
                    noSemanticValidation: true,
                    noSyntaxValidation: true
                });
                
                monacoEditorInstance = monaco.editor.create(editorContainer, {
                    value: existingCode || defaultCode,
                    language: 'javascript',
                    theme: 'vs-light',
                    minimap: { enabled: true, scale: 0.75 },
                    automaticLayout: true,
                    fontSize: 13,
                    scrollBeyondLastLine: false,
                    padding: { top: 16 }
                });
            }
        }
        
        function restoreListWrapper() {
            listWrapper.innerHTML = '';
            listWrapper.appendChild(listHeader);
            listWrapper.appendChild(listContainer);
        }

        function renderList(searchQuery = "") {
            if (isEditing) return;
            listContainer.innerHTML = '';
            
            let stored = {};
            try { stored = JSON.parse(localStorage.getItem('tv_local_indicators') || '{}'); } catch(e){}
            let localNames = Object.keys(stored);
            
            let allCustomNames = ["SuperTrend Custom", ...localNames];
            let items = activeTab === 'custom' ? allCustomNames : allStudies.filter(s => !allCustomNames.includes(s));
            
            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                if (query.trim() !== '') {
                    items = allStudies.filter(s => {
                        const displayName = (s === "SuperTrend Custom") ? "SuperTrend" : s;
                        return displayName.toLowerCase().includes(query);
                    });
                }
            }
            
            if (activeTab === 'custom' && !searchQuery) {
                const addBtn = document.createElement('div');
                addBtn.style.cssText = 'padding:14px; margin:8px 0 16px 0; cursor:pointer; font-size:14px; color:#2962FF; display:flex; align-items:center; border:1px dashed #2962FF; border-radius:8px; font-weight:600; justify-content:center; background:#f8fafe; transition:all 0.2s ease;';
                addBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" style="margin-right:8px;" fill="none"><path d="M9 4v10m-5-5h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Create Local Indicator';
                addBtn.onmouseover = () => { addBtn.style.background = '#2962FF'; addBtn.style.color = '#fff'; };
                addBtn.onmouseout = () => { addBtn.style.background = '#f8fafe'; addBtn.style.color = '#2962FF'; };
                addBtn.onclick = () => showEditor();
                listContainer.appendChild(addBtn);
            }
            
            items.forEach(study => {
                const isLocal = localNames.includes(study);
                const displayName = (study === "SuperTrend Custom") ? "SuperTrend" : study;
                
                const item = document.createElement('div');
                item.style.cssText = 'padding:12px 16px; cursor:pointer; font-size:14px; color:#131722; font-weight:500; display:flex; align-items:center; justify-content:space-between; border-radius:8px; transition:background-color 0.2s; margin-bottom:4px; border:1px solid transparent;';
                
                const titleSpan = document.createElement('span');
                titleSpan.textContent = displayName;
                item.appendChild(titleSpan);
                
                if (isLocal) {
                    const actions = document.createElement('div');
                    actions.style.cssText = 'display:flex; gap:8px; align-items:center;';
                    
                    const editBtn = document.createElement('div');
                    editBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
                    editBtn.style.cssText = 'cursor:pointer; color:#b2b5be; transition:0.2s; display:flex; align-items:center; padding:6px; border-radius:4px;';
                    editBtn.onmouseover = () => { editBtn.style.color = '#2962FF'; editBtn.style.background = '#f0f3fa'; };
                    editBtn.onmouseout = () => { editBtn.style.color = '#b2b5be'; editBtn.style.background = 'transparent'; };
                    editBtn.onclick = (e) => { e.stopPropagation(); showEditor(stored[study], study); };
                    
                    const delBtn = document.createElement('div');
                    delBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
                    delBtn.style.cssText = 'cursor:pointer; color:#b2b5be; transition:0.2s; display:flex; align-items:center; padding:6px; border-radius:4px;';
                    delBtn.onmouseover = () => { delBtn.style.color = '#f23645'; delBtn.style.background = '#ffebec'; };
                    delBtn.onmouseout = () => { delBtn.style.color = '#b2b5be'; delBtn.style.background = 'transparent'; };
                    delBtn.onclick = (e) => { 
                        e.stopPropagation(); 
                        if(confirm("Delete local indicator '" + study + "'?")) {
                            delete stored[study];
                            localStorage.setItem('tv_local_indicators', JSON.stringify(stored));
                            location.reload();
                        }
                    };
                    
                    actions.appendChild(editBtn);
                    actions.appendChild(delBtn);
                    item.appendChild(actions);
                }
                
                item.onmouseover = () => { item.style.background = '#f8fafe'; item.style.borderColor = '#e0e3eb'; };
                item.onmouseout = () => { item.style.background = 'transparent'; item.style.borderColor = 'transparent'; };
                item.onclick = () => {
                    widget.chart().createStudy(study, false, false);
                    closeModal();
                };
                listContainer.appendChild(item);
            });
            if(items.length === 0) {
                listContainer.innerHTML = '<div style="padding:40px; color:#b2b5be; text-align:center; font-size:14px; font-weight:500;">No indicators found</div>';
            }
        }
        
        function openModal() {
            if (allStudies.length === 0) {
                try {
                    allStudies = widget.getStudiesList();
                } catch(e) {}
            }
            modalOverlay.style.display = 'flex';
            searchInput.value = '';
            isEditing = false;
            restoreListWrapper();
            activeTab = 'custom';
            tabCustom.className = 'tv-custom-modal-tab active';
            tabBuiltin.className = 'tv-custom-modal-tab';
            renderList();
            setTimeout(() => searchInput.focus(), 100);
        }
        
        function closeModal() {
            modalOverlay.style.display = 'none';
        }
        
        header.querySelector('#tv-close-modal').addEventListener('click', closeModal);
        modalOverlay.addEventListener('click', e => { if(e.target === modalOverlay) closeModal(); });
        
        tabCustom.addEventListener('click', () => {
            if (searchInput.value.trim() !== '') { searchInput.value = ''; }
            activeTab = 'custom';
            if (!isEditing) restoreListWrapper();
            isEditing = false;
            tabCustom.className = 'tv-custom-modal-tab active';
            tabBuiltin.className = 'tv-custom-modal-tab';
            renderList();
        });
        
        tabBuiltin.addEventListener('click', () => {
            if (searchInput.value.trim() !== '') { searchInput.value = ''; }
            activeTab = 'builtin';
            if (!isEditing) restoreListWrapper();
            isEditing = false;
            tabBuiltin.className = 'tv-custom-modal-tab active';
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
                tabCustom.className = 'tv-custom-modal-tab';
                tabCustom.style.opacity = '0.5';
                tabBuiltin.className = 'tv-custom-modal-tab';
                tabBuiltin.style.opacity = '0.5';
            } else {
                tabCustom.style.opacity = '1';
                tabBuiltin.style.opacity = '1';
                tabCustom.className = activeTab === 'custom' ? 'tv-custom-modal-tab active' : 'tv-custom-modal-tab';
                tabBuiltin.className = activeTab === 'builtin' ? 'tv-custom-modal-tab active' : 'tv-custom-modal-tab';
            }
            renderList(query);
        });
    });
}
