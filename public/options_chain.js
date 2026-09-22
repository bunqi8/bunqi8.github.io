const HF_BASE = "https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/NSE_NIFTY50_INDEX/option_data/parquet";

let expiries = []; // { dateStr, folderPath, dateObj, monthLabel, day, year }
let currentExpiry = null;
let modalOverlay = null;

const style = document.createElement('style');
style.innerHTML = `
    .oc-backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.4); z-index: 1000; display: none; align-items: center; justify-content: center; }
    .oc-modal { background: #ffffff; width: 800px; max-height: 85vh; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    
    .oc-header { flex-shrink: 0; padding: 16px 24px; border-bottom: 1px solid #e0e3eb; display: flex; justify-content: space-between; align-items: center; }
    .oc-title { font-size: 20px; font-weight: 600; color: #131722; display: flex; align-items: center; gap: 12px; }
    .oc-close { cursor: pointer; color: #787b86; transition: color 0.2s; display: flex; align-items: center; justify-content: center; }
    .oc-close:hover { color: #131722; }
    
    .oc-expiries-strip { flex-shrink: 0; display: flex; overflow-x: auto; padding: 16px 24px; border-bottom: 1px solid #e0e3eb; align-items: center; gap: 16px; min-height: 60px; }
    .oc-expiries-strip::-webkit-scrollbar { display: none; }
    .oc-base-strip { flex-shrink: 0; display: flex; overflow-x: auto; padding: 12px 24px 0 24px; gap: 8px; border-bottom: 1px solid #f0f3fa; }
    .oc-base-strip::-webkit-scrollbar { display: none; }
    .oc-base-btn { padding: 6px 12px; font-size: 14px; font-weight: 500; color: #787b86; cursor: pointer; border-radius: 4px; transition: 0.1s; border: none; background: transparent; }
    .oc-base-btn:hover { background: #f0f3fa; color: #131722; }
    .oc-base-btn.active { color: #2962FF; background: #e3f2fd; }
    
    .oc-month-group { display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .oc-month-label { font-size: 12px; color: #131722; font-weight: 500; min-height: 14px; margin-bottom: 2px; }
    .oc-days-row { display: flex; gap: 4px; }
    
    .oc-expiry, .oc-btn-native { padding: 4px 10px; border-radius: 6px; border: none; background: #f0f3fa; cursor: pointer; font-size: 13px; color: #131722; font-weight: 500; transition: background 0.2s; }
    .oc-expiry:hover, .oc-btn-native:hover { background: #e0e3eb; }
    .oc-expiry.active { background: #2a2e39; color: white; }
    
    .oc-table-top-header { flex-shrink: 0; display: flex; padding: 12px 0 4px 0; font-size: 13px; font-weight: 600; color: #131722; }
    .oc-table-header { flex-shrink: 0; display: flex; padding: 4px 0 12px 0; border-bottom: 1px solid #e0e3eb; font-size: 12px; color: #787b86; }
    .oc-col { flex: 1; text-align: center; }
    
    .oc-table-body { flex-grow: 1; overflow-y: auto; font-size: 13px; color: #131722; position: relative; padding-bottom: 40px;}
    .oc-row { display: flex; padding: 0; border-bottom: 1px solid #f0f3fa; }
    
    .oc-cell { flex: 1; padding: 14px 0; text-align: center; cursor: pointer; transition: background 0.1s; position: relative; }
    
    .call-cell:hover, .put-cell:hover { background: #f0f3fa; }
    .call-cell:hover::after { content: ''; position: absolute; right: 0; top: 50%; transform: translateY(-50%); border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 5px solid #d1d4dc; }
    .put-cell:hover::before { content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%); border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-right: 5px solid #d1d4dc; }
    
    .strike-cell { font-weight: 500; cursor: default; background: #fafafc; }
    .strike-cell:hover { color: #131722; }
    
    .oc-cell.itm { background-color: #fff4e6; }
    .oc-cell.itm:hover { background-color: #f0e6d2; }
    
    .oc-cell.active { background-color: #e3f2fd; color: #131722; }
    
    .atm-row { position: relative; width: 100%; height: 0; display: flex; justify-content: center; align-items: center; z-index: 2; }
    .atm-line { position: absolute; width: 100%; height: 1px; background-color: #131722; top: 0; left: 0; }
    .atm-marker { background: #131722; color: white; font-size: 11px; padding: 3px 6px; border-radius: 4px; font-weight: 600; z-index: 3; position: relative; box-shadow: 0 1px 2px rgba(0,0,0,0.2); }
`;
document.head.appendChild(style);

function buildModal() {
    modalOverlay = document.createElement('div');
    modalOverlay.className = 'oc-backdrop';
    modalOverlay.innerHTML = `
        <div class="oc-modal">
            <div class="oc-header">
                <div class="oc-title">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: -4px;"><path d="M15 18l-6-6 6-6"/></svg>
                    NIFTY Options
                </div>
                <div style="display:flex; align-items:center; gap: 8px; margin-left: auto; margin-right: 24px;">
                    <button class="oc-btn-native" onclick="window.loadSymbol('NIFTY50-INDEX')">Index</button>
                    <button class="oc-btn-native" id="btn_futures" style="display:none;" onclick="">Futures</button>
                </div>
                <div class="oc-close" onclick="window.closeOptionsChainModal()">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </div>
            </div>
            <div class="oc-base-strip" id="oc_base_strip"></div>
            <div class="oc-expiries-strip" id="oc_expiries_strip">
                <span style="font-size:13px; color:#787b86;">Loading expiries...</span>
            </div>
            <div class="oc-table-top-header">
                <div class="oc-col">Calls</div>
                <div class="oc-col"></div>
                <div class="oc-col">Puts</div>
            </div>
            <div class="oc-table-header">
                <div class="oc-col">Symbol</div>
                <div class="oc-col">↑ Strike</div>
                <div class="oc-col">Symbol</div>
            </div>
            <div class="oc-table-body" id="oc_table_body">
                <!-- Rows injected here -->
            </div>
        </div>
`;
    document.body.appendChild(modalOverlay);
    
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) window.closeOptionsChainModal();
    });
}

window.openOptionsChainModal = function() {
    const iframe = document.querySelector('iframe[id^="tradingview_"]');
    if (iframe) {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const btn = doc.getElementById('btn-option-chain-real');
        if (btn) btn.classList.add('isActive-GwQQdU8S', 'isActive');
    }
    if (!modalOverlay) buildModal();
    modalOverlay.style.display = 'flex';
    
    let targetExpiry = currentExpiry;
    
    // Auto-detect expiry from current chart symbol
    try {
        const symbol = window.tvWidget.activeChart().symbol();
        const match = symbol.match(/NIFTY(\d{2})([1-9OND])(\d{2})\d{5}[CP]E/);
        if (match) {
            let y = match[1];
            let mStr = match[2];
            let d = match[3];
            
            let m = mStr;
            if (mStr === 'O') m = '10';
            else if (mStr === 'N') m = '11';
            else if (mStr === 'D') m = '12';
            else m = mStr.padStart(2, '0');
            
            // Format to match dateStr (e.g. "20260915")
            let symDateStr = `20${y}${m}${d}`;
            const found = filteredExpiries.find(e => e.dateStr === symDateStr);
            if (found) targetExpiry = found;
        }
    } catch(e) {}
    
    if (expiries.length === 0) {
        fetchExpiries();
    } else if (targetExpiry) {
        selectExpiry(targetExpiry);
    }
};

window.closeOptionsChainModal = function() {
    const iframe = document.querySelector('iframe[id^="tradingview_"]');
    if (iframe) {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const btn = doc.getElementById('btn-option-chain-real');
        if (btn) btn.classList.remove('isActive-GwQQdU8S', 'isActive');
    }
    if (modalOverlay) modalOverlay.style.display = 'none';
};

async function fetchExpiries() {
    try {
        const cached = await window.SyncManager.getAllExpiries();
        if (cached && cached.length > 0) {
            expiries = cached.sort((a,b) => a.dateObjValue - b.dateObjValue);
            window.HF_EXPIRIES = expiries;
            updateExpiryStrip();
            if (!currentExpiry) { const f = expiries.filter(e => e.baseTicker === window.ACTIVE_BASE_TICKER); if (f.length > 0) selectExpiry(f[f.length - 1]); }
        }
        
        // Wait for the sync that was already started by cache.js on page load
        if (window.SyncManager._syncPromise) {
            await window.SyncManager._syncPromise;
        }
        
        const fresh = await window.SyncManager.getAllExpiries();
        expiries = fresh.sort((a,b) => a.dateObjValue - b.dateObjValue);
        window.HF_EXPIRIES = expiries;
        
        const possible = [...new Set(window.HF_EXPIRIES.map(e => e.baseTicker))];
        if (!window.ACTIVE_BASE_TICKER && possible.length > 0) {
            let chartSym = 'NIFTY50-INDEX';
            try { if (window.tvWidget) chartSym = window.tvWidget.activeChart().symbol(); } catch(e) {}
            let found = possible.find(p => p.includes(chartSym.split('-')[0]) || p.includes(chartSym.replace(/\d.*/, '')));
            window.ACTIVE_BASE_TICKER = found || possible[0];
        }
        
        updateExpiryStrip();
        
        if (currentExpiry) {
            const updated = expiries.find(e => e.id === currentExpiry.id);
            if (updated && updated.timeStr !== currentExpiry.timeStr) {
                selectExpiry(updated);
            }
        } else if (expiries.length > 0) {
            const f = expiries.filter(e => e.baseTicker === window.ACTIVE_BASE_TICKER); if (f.length > 0) selectExpiry(f[f.length - 1]);
        }
    } catch(e) {
        console.error("Failed to init options chain", e);
    }
}

function updateExpiryStrip() {
    const baseStrip = document.getElementById('oc_base_strip');
    const strip = document.getElementById('oc_expiries_strip');
    if (!strip || !baseStrip) return;
    strip.innerHTML = '';
    baseStrip.innerHTML = '';
    
    const possibleBaseTickers = [...new Set(window.HF_EXPIRIES.map(e => e.baseTicker))];
    possibleBaseTickers.forEach(bt => {
        const btn = document.createElement('button');
        btn.className = `oc-base-btn ${window.ACTIVE_BASE_TICKER === bt ? 'active' : ''}`;
        btn.innerText = bt.replace('NSE_', '').replace('BSE_', '').replace('_INDEX', '').replace('MCX_', '');
        btn.onclick = () => {
            window.ACTIVE_BASE_TICKER = bt;
            const filtered = window.HF_EXPIRIES.filter(e => e.baseTicker === bt);
            updateExpiryStrip();
            if (filtered.length > 0) selectExpiry(filtered[filtered.length - 1]);
        };
        baseStrip.appendChild(btn);
    });

    const filteredExpiries = window.HF_EXPIRIES.filter(e => e.baseTicker === window.ACTIVE_BASE_TICKER);
    
    // Update Title
    const titleEl = document.querySelector('.oc-title');
    if (titleEl) {
        const prettyName = window.ACTIVE_BASE_TICKER ? window.ACTIVE_BASE_TICKER.replace('NSE_', '').replace('BSE_', '').replace('_INDEX', '') : 'Options';
        titleEl.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: -4px;"><path d="M15 18l-6-6 6-6"/></svg> ${prettyName} Options`;
    }

    let lastMonthLabel = null;
    let currentGroupDiv = null;
    let currentDaysRow = null;
    
    // Maintain chronological order but group by monthLabel
    filteredExpiries.forEach(exp => {
        if (exp.monthLabel !== lastMonthLabel) {
            currentGroupDiv = document.createElement('div');
            currentGroupDiv.className = 'oc-month-group';
            
            const label = document.createElement('div');
            label.className = 'oc-month-label';
            label.innerText = exp.monthLabel;
            currentGroupDiv.appendChild(label);
            
            currentDaysRow = document.createElement('div');
            currentDaysRow.className = 'oc-days-row';
            currentGroupDiv.appendChild(currentDaysRow);
            
            strip.appendChild(currentGroupDiv);
            lastMonthLabel = exp.monthLabel;
        }
        
        const btn = document.createElement('button');
        btn.className = `oc-expiry ${currentExpiry && currentExpiry.id === exp.id ? 'active' : ''}`;
        btn.innerText = exp.day;
        btn.onclick = () => selectExpiry(exp);
        currentDaysRow.appendChild(btn);
    });
}

async function selectExpiry(expiry) {
    currentExpiry = expiry;
    updateExpiryStrip();
    
    // In background, instantly check if this specific tab has newer data on HF. If so, it will sync and re-render.
    if (window.SyncManager) {
        window.SyncManager.forceSyncExpiry(expiry.id).then(updated => {
            if (updated && currentExpiry && currentExpiry.id === expiry.id) {
                // If it updated, fetch the freshest copy from DB and re-render
                window.SyncManager.getExpiry(expiry.id).then(fresh => {
                    if (fresh) selectExpiry(fresh);
                });
            }
        });
    }
    
    window.ACTIVE_EXPIRY_FOLDER = expiry.folderPath;
    window.ACTIVE_EXPIRY_FILES = expiry.files; // Use cached files
    
    const tbody = document.getElementById('oc_table_body');
    if (!expiry.files || expiry.files.length === 0) {
        tbody.innerHTML = '<div style="padding: 40px; text-align: center; color: red;">No files found</div>';
        return;
    }
    
    const strikes = new Set();
    const symbols = {}; 
    
    let indexFile = null;
    let futSymbol = null;

    for (let f of expiry.files) {
        const filename = f.path.split('/').pop();
        
        if (filename.includes('-INDEX_D_') || filename.includes('-INDEX_1_')) {
            if (!indexFile || filename.includes('_D_')) {
                indexFile = f;
            }
        }
        if (filename.includes('FUT_')) {
            futSymbol = filename.split('_')[0];
        }
        
        const match = filename.match(/[A-Z]+.+?(\d{5})([CP]E)_/);
        if (match) {
            const strike = parseInt(match[1], 10);
            const type = match[2];
            strikes.add(strike);
            const symbol = filename.split('_')[0]; 
            symbols[`${strike}_${type}`] = symbol;
        }
    }
    
    const sortedStrikes = Array.from(strikes).sort((a,b) => a - b);
    
    const btnFutures = document.getElementById('btn_futures');
    if (futSymbol) {
        btnFutures.style.display = 'block';
        btnFutures.onclick = () => {
            window.loadSymbol(futSymbol);
            window.closeOptionsChainModal();
        };
    } else {
        btnFutures.style.display = 'none';
    }
    
    // 1. Instant render from cache (with cached ATM price if available)
    renderTable(sortedStrikes, symbols, expiry.atmPrice || null);
    
    // 2. Background ATM price fetch
    // We fetch if we don't have a cached price, or if it's the absolute nearest expiry (which could still be actively trading)
    const isNearest = expiries.length > 0 && expiries[0].dateStr === expiry.dateStr;
    
    if (indexFile && (!expiry.atmPrice || isNearest)) {
        (async () => {
            try {
                while(!window.db) { await new Promise(r => setTimeout(r, 100)); }
                const indexUrl = `https://huggingface.co/datasets/deep776/fyers-market-data/resolve/main/${indexFile.path}`;
                const vfsName = await window.ensureParquetLoaded(indexUrl);
                const conn = await window.db.connect();
                const result = await conn.query(`SELECT close FROM read_parquet('${vfsName}') ORDER BY time DESC LIMIT 1`);
                const rows = result.toArray();
                if (rows.length > 0) {
                    const newAtmPrice = rows[0].close;
                    
                    // Cache it permanently to IndexedDB
                    if (expiry.atmPrice !== newAtmPrice) {
                        expiry.atmPrice = newAtmPrice;
                        if (window.SyncManager) {
                            await window.SyncManager.saveExpiry(expiry);
                        }
                        
                        // Re-render with updated ATM highlighting if they are still viewing this tab
                        if (currentExpiry && currentExpiry.dateStr === expiry.dateStr) {
                            renderTable(sortedStrikes, symbols, newAtmPrice);
                        }
                    }
                }
                await conn.close();
            } catch(e) {
                console.error("Failed to fetch ATM price in background", e);
            }
        })();
    }
}

function renderTable(strikes, symbols, atmPrice) {
    const tbody = document.getElementById('oc_table_body');
    tbody.innerHTML = '';
    
    let currentSymbol = null;
    try { currentSymbol = window.tvWidget.activeChart().symbol(); } catch(e) {}
    
    let atmIndex = -1;
    let minDiff = Infinity;
    
    if (atmPrice) {
        strikes.forEach((strike, i) => {
            const diff = Math.abs(strike - atmPrice);
            if (diff < minDiff) {
                minDiff = diff;
                if (atmPrice > strike) {
                    atmIndex = i + 1;
                } else {
                    atmIndex = i;
                }
            }
        });
    }
    
    strikes.forEach((strike, i) => {
        if (i === atmIndex && atmPrice) {
            const atmRow = document.createElement('div');
            atmRow.className = 'atm-row';
            atmRow.id = 'atm-marker-row';
            atmRow.innerHTML = `
                <div class="atm-line"></div>
                <div class="atm-marker">${(window.ACTIVE_BASE_TICKER || '').replace('NSE_', '').replace('BSE_', '').replace('_INDEX', '').replace('MCX_', '')} ${atmPrice.toFixed(2)}</div>
            `;
            tbody.appendChild(atmRow);
        }
        
        const ceSymbol = symbols[`${strike}_CE`];
        const peSymbol = symbols[`${strike}_PE`];
        
        const isCeActive = ceSymbol === currentSymbol;
        const isPeActive = peSymbol === currentSymbol;
        
        let callItm = false;
        let putItm = false;
        if (atmPrice) {
            if (strike < atmPrice) callItm = true;
            if (strike > atmPrice) putItm = true;
        }
        
        const row = document.createElement('div');
        row.className = `oc-row`;
        
        row.innerHTML = `
            <div class="oc-cell call-cell ${isCeActive ? 'active' : ''} ${callItm ? 'itm' : ''}" onclick="window.loadSymbol('${ceSymbol || ''}')">
                ${ceSymbol ? 'Call '+strike.toLocaleString() : '-'}
            </div>
            <div class="oc-cell strike-cell">${strike.toLocaleString()}</div>
            <div class="oc-cell put-cell ${isPeActive ? 'active' : ''} ${putItm ? 'itm' : ''}" onclick="window.loadSymbol('${peSymbol || ''}')">
                ${peSymbol ? 'Put '+strike.toLocaleString() : '-'}
            </div>
        `;
        tbody.appendChild(row);
    });
    
    if (atmPrice && atmIndex >= 0) {
        setTimeout(() => {
            const el = document.getElementById(`atm-marker-row`);
            if (el) {
                el.scrollIntoView({ behavior: 'auto', block: 'center' });
            }
        }, 50);
    }
}

window.loadSymbol = function(symbol) {
    if (!symbol || symbol === 'undefined') return;
    if (window.tvWidget) {
        window.tvWidget.setSymbol(symbol, window.tvWidget.symbolInterval().interval, () => {});
        window.closeOptionsChainModal();
    }
};

window.addEventListener('DOMContentLoaded', () => {
    buildModal();
    fetchExpiries();
});
