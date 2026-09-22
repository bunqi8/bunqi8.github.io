function setupCustomIndicatorsDialog(widget) {
    widget.headerReady().then(function() {
        const iframe = document.querySelector('#tv_chart_container iframe');
        const iframeDoc = iframe.contentWindow.document;
        
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

        // Inject responsive CSS
        const style = document.createElement('style');
        style.textContent = `
            .tv-custom-modal-overlay {
                display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0, 0, 0, 0.4); z-index: 99999; align-items: center; justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif;
            }
            .tv-custom-modal {
                background: #ffffff; width: 640px; height: 600px; max-width: 90%; max-height: 90%;
                border-radius: 8px; display: flex; flex-direction: column; box-shadow: 0 2px 12px rgba(0,0,0,0.15); overflow: hidden;
            }
            .tv-custom-modal-body {
                display: flex; flex: 1; overflow: hidden; border-top: 1px solid #e0e3eb;
            }
            .tv-custom-modal-tabs {
                width: 200px; display: flex; flex-direction: column; padding: 16px 12px; border-right: 1px solid #e0e3eb; background: #ffffff;
            }
            .tv-custom-modal-tab {
                padding: 10px 16px; margin-bottom: 4px; font-size: 15px; cursor: pointer; color: #131722; font-weight: 400;
                border-radius: 6px; transition: 0.2s; display: flex; align-items: center; gap: 12px;
            }
            .tv-custom-modal-tab.active {
                font-weight: 500; background: #f0f3fa; color: #131722;
            }
            @media (max-width: 600px) {
                .tv-custom-modal {
                    width: 100%; height: 100%; max-width: 100%; max-height: 100%; border-radius: 0;
                }
                .tv-custom-modal-body {
                    flex-direction: column;
                }
                .tv-custom-modal-tabs {
                    width: 100%; flex-direction: row; border-right: none; border-bottom: 1px solid #e0e3eb; padding: 8px 12px; box-sizing: border-box;
                }
                .tv-custom-modal-tab {
                    flex: 1; justify-content: center; margin-bottom: 0; border-radius: 6px; padding: 10px 4px; font-size: 14px;
                }
            }
        `;
        document.head.appendChild(style);

        // Modal container
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'tv-custom-modal-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'tv-custom-modal';
        
        // Header
        const header = document.createElement('div');
        header.style.cssText = 'padding:20px 24px 16px 24px; display:flex; justify-content:space-between; align-items:center;';
        header.innerHTML = '<div style="font-size:20px; font-weight:700; color:#131722; line-height:28px;">Indicators, metrics, and strategies</div><div id="tv-close-modal" style="cursor:pointer; color:#787b86; padding:4px; margin:-4px;"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 1.5l15 15m0-15l-15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>';
        
        // Search
        const searchContainer = document.createElement('div');
        searchContainer.style.cssText = 'padding:0 24px 12px 24px;';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search';
        searchInput.style.cssText = 'width:100%; padding:10px 10px 10px 40px; border:1px solid #e0e3eb; border-radius:24px; font-size:16px; color:#131722; outline:none; box-sizing:border-box; background:url("data:image/svg+xml;utf8,<svg width=\'18\' height=\'18\' viewBox=\'0 0 18 18\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'><path d=\'M12.5 12.5L15 15M14 8.5a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z\' stroke=\'%23787b86\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/></svg>") no-repeat 14px center; background-size: 18px; transition: border-color 0.2s ease;';
        searchInput.onfocus = () => searchInput.style.borderColor = '#2962FF';
        searchInput.onblur = () => searchInput.style.borderColor = '#e0e3eb';
        searchContainer.appendChild(searchInput);

        // Tabs Layout
        const bodyContainer = document.createElement('div');
        bodyContainer.className = 'tv-custom-modal-body';
        
        // Tabs
        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'tv-custom-modal-tabs';
        
        const tabCustom = document.createElement('div');
        const tabBuiltin = document.createElement('div');
        
        const userIcon = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-6 8a6 6 0 0112 0H4z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const builtinIcon = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 17V9m5 8V5m5 12v-5m5 5V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        tabCustom.innerHTML = userIcon + 'Custom scripts';
        tabBuiltin.innerHTML = builtinIcon + 'Technicals';
        
        tabCustom.className = 'tv-custom-modal-tab active';
        tabBuiltin.className = 'tv-custom-modal-tab';
        
        tabsContainer.appendChild(tabCustom);
        tabsContainer.appendChild(tabBuiltin);
        
        // Lists
        const listWrapper = document.createElement('div');
        listWrapper.style.cssText = 'flex:1; display:flex; flex-direction:column;';
        
        const listHeader = document.createElement('div');
        listHeader.style.cssText = 'padding:16px 24px 8px 24px; font-size:11px; font-weight:500; color:#787b86; text-transform:uppercase; letter-spacing:0.4px;';
        listHeader.textContent = 'Script name';

        const listContainer = document.createElement('div');
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
        let customStudies = ["SuperTrend Custom"]; // The true engine internal names
        let activeTab = 'custom';
        
        function renderList(searchQuery = "") {
            listContainer.innerHTML = '';
            let items = activeTab === 'custom' ? customStudies : allStudies.filter(s => !customStudies.includes(s));
            
            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                if (query.trim() !== '') {
                    // search based on mapped names!
                    items = allStudies.filter(s => {
                        const displayName = (s === "SuperTrend Custom") ? "SuperTrend" : s;
                        return displayName.toLowerCase().includes(query);
                    });
                }
            }
            
            items.forEach(study => {
                const displayName = (study === "SuperTrend Custom") ? "SuperTrend" : study;
                
                const item = document.createElement('div');
                item.style.cssText = 'padding:12px; cursor:pointer; font-size:15px; color:#131722; display:flex; align-items:center; border-radius:6px; transition:background-color 0.1s;';
                item.textContent = displayName;
                item.onmouseover = () => item.style.background = '#f0f3fa';
                item.onmouseout = () => item.style.background = 'transparent';
                item.onclick = () => {
                    widget.chart().createStudy(study, false, false);
                    closeModal();
                };
                listContainer.appendChild(item);
            });
            if(items.length === 0) {
                listContainer.innerHTML = '<div style="padding:40px; color:#787b86; text-align:center; font-size:15px;">No indicators found</div>';
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
            tabCustom.className = 'tv-custom-modal-tab active';
            tabBuiltin.className = 'tv-custom-modal-tab';
            renderList();
        });
        
        tabBuiltin.addEventListener('click', () => {
            if (searchInput.value.trim() !== '') { searchInput.value = ''; }
            activeTab = 'builtin';
            tabBuiltin.className = 'tv-custom-modal-tab active';
            tabCustom.className = 'tv-custom-modal-tab';
            renderList();
        });
        
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
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
