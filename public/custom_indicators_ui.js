function setupCustomIndicatorsDialog(widget) {
    widget.headerReady().then(function() {
        const button = widget.createButton({ align: "left" });
        button.setAttribute('title', 'Indicators');
        button.innerHTML = '<div style="display:flex;align-items:center;font-weight:600;gap:4px;"><svg width="24" height="24" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M11 11h6v2h-6v-2zm-5 4h16v2H6v-2zm5-8h6v2h-6V7z" fill="currentColor"/></svg> Indicators</div>';

        // Modal container
        const modalOverlay = document.createElement('div');
        modalOverlay.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.4); z-index:99999; align-items:center; justify-content:center; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;';
        
        const modal = document.createElement('div');
        modal.style.cssText = 'background:#fff; width:480px; height:600px; max-width:90%; max-height:90%; border-radius:8px; display:flex; flex-direction:column; box-shadow:0 2px 6px rgba(0,0,0,0.2); overflow:hidden;';
        
        // Header
        const header = document.createElement('div');
        header.style.cssText = 'padding:16px 20px; border-bottom:1px solid #e0e3eb; display:flex; justify-content:space-between; align-items:center;';
        header.innerHTML = '<div style="font-size:18px; font-weight:700; color:#131722;">Indicators</div><div id="tv-close-modal" style="cursor:pointer; color:#787b86;"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 1.5l15 15m0-15l-15 15" stroke="currentColor" stroke-width="2"/></svg></div>';
        
        // Search
        const searchContainer = document.createElement('div');
        searchContainer.style.cssText = 'padding:12px 20px; border-bottom:1px solid #e0e3eb;';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search';
        searchInput.style.cssText = 'width:100%; padding:8px 30px; border:1px solid #e0e3eb; border-radius:4px; font-size:14px; outline:none; box-sizing:border-box; background:url("data:image/svg+xml;utf8,<svg width=\'16\' height=\'16\' viewBox=\'0 0 16 16\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'><path d=\'M11.5 11.5L14 14M13 7.5a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z\' stroke=\'%23787b86\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/></svg>") no-repeat 8px center; background-size: 16px;';
        searchContainer.appendChild(searchInput);

        // Tabs
        const tabsContainer = document.createElement('div');
        tabsContainer.style.cssText = 'display:flex; border-bottom:1px solid #e0e3eb; background:#f8f9fd;';
        
        const tabCustom = document.createElement('div');
        tabCustom.textContent = 'Custom';
        const tabBuiltin = document.createElement('div');
        tabBuiltin.textContent = 'Built-in';
        
        const tabStyle = 'flex:1; text-align:center; padding:12px 0; font-size:14px; cursor:pointer; color:#787b86; font-weight:500; transition:0.2s;';
        const activeTabStyle = 'flex:1; text-align:center; padding:12px 0; font-size:14px; cursor:pointer; color:#2962FF; font-weight:600; border-bottom:2px solid #2962FF; transition:0.2s;';
        
        tabCustom.style.cssText = activeTabStyle;
        tabBuiltin.style.cssText = tabStyle;
        
        tabsContainer.appendChild(tabCustom);
        tabsContainer.appendChild(tabBuiltin);
        
        // Lists
        const listContainer = document.createElement('div');
        listContainer.style.cssText = 'flex:1; overflow-y:auto; padding:8px 0;';
        
        modal.appendChild(header);
        modal.appendChild(searchContainer);
        modal.appendChild(tabsContainer);
        modal.appendChild(listContainer);
        modalOverlay.appendChild(modal);
        document.body.appendChild(modalOverlay);
        
        let allStudies = [];
        let customStudies = ["SuperTrend"]; // Update manually or dynamically later
        let activeTab = 'custom';
        
        function renderList(searchQuery = "") {
            listContainer.innerHTML = '';
            let items = activeTab === 'custom' ? customStudies : allStudies.filter(s => !customStudies.includes(s));
            
            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                // If searching, show matching from BOTH tabs just visually grouped, or just strictly current tab?
                // Request said: "inbuilt search bard will searrch them all".
                // So if search is active, ignore tabs and show all!
                if (query.trim() !== '') {
                    items = allStudies.filter(s => s.toLowerCase().includes(query));
                }
            }
            
            items.forEach(study => {
                const item = document.createElement('div');
                item.style.cssText = 'padding:10px 20px; cursor:pointer; font-size:14px; color:#131722; display:flex; align-items:center;';
                item.textContent = study;
                item.onmouseover = () => item.style.background = '#f0f3fa';
                item.onmouseout = () => item.style.background = 'transparent';
                item.onclick = () => {
                    widget.chart().createStudy(study, false, false);
                    closeModal();
                };
                listContainer.appendChild(item);
            });
            if(items.length === 0) {
                listContainer.innerHTML = '<div style="padding:20px; color:#787b86; text-align:center; font-size:14px;">No indicators found</div>';
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
            tabCustom.style.cssText = activeTabStyle;
            tabBuiltin.style.cssText = tabStyle;
            renderList();
            setTimeout(() => searchInput.focus(), 100);
        }
        
        function closeModal() {
            modalOverlay.style.display = 'none';
        }
        
        button.addEventListener('click', openModal);
        header.querySelector('#tv-close-modal').addEventListener('click', closeModal);
        modalOverlay.addEventListener('click', e => { if(e.target === modalOverlay) closeModal(); });
        
        tabCustom.addEventListener('click', () => {
            if (searchInput.value.trim() !== '') { searchInput.value = ''; } // clear search to respect tab
            activeTab = 'custom';
            tabCustom.style.cssText = activeTabStyle;
            tabBuiltin.style.cssText = tabStyle;
            renderList();
        });
        
        tabBuiltin.addEventListener('click', () => {
            if (searchInput.value.trim() !== '') { searchInput.value = ''; }
            activeTab = 'builtin';
            tabBuiltin.style.cssText = activeTabStyle;
            tabCustom.style.cssText = tabStyle;
            renderList();
        });
        
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (query !== '') {
                // Dim tabs when global search is active
                tabCustom.style.cssText = tabStyle + ' opacity: 0.5;';
                tabBuiltin.style.cssText = tabStyle + ' opacity: 0.5;';
            } else {
                tabCustom.style.cssText = activeTab === 'custom' ? activeTabStyle : tabStyle;
                tabBuiltin.style.cssText = activeTab === 'builtin' ? activeTabStyle : tabStyle;
            }
            renderList(query);
        });
    });
}
