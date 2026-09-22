const HF_BASE = "https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/NSE_NIFTY50_INDEX/option_data/parquet";

let expiries = []; // { dateStr, folderPath, dateObj, month, day, year }
let currentExpiry = null;
let modalOverlay = null;

const style = document.createElement('style');
style.innerHTML = `
    .oc-backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.4); z-index: 1000; display: none; align-items: center; justify-content: center; }
    .oc-modal { background: #ffffff; width: 800px; max-height: 85vh; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    
    .oc-header { padding: 16px 24px; border-bottom: 1px solid #e0e3eb; display: flex; justify-content: space-between; align-items: center; }
    .oc-title { font-size: 20px; font-weight: 600; color: #131722; display: flex; align-items: center; gap: 12px; cursor: pointer; transition: color 0.2s; }
    .oc-title:hover { color: #2962FF; }
    .oc-close { cursor: pointer; color: #787b86; transition: color 0.2s; display: flex; align-items: center; justify-content: center; }
    .oc-close:hover { color: #131722; }
    
    .oc-expiries-strip { display: flex; overflow-x: auto; padding: 16px 24px; border-bottom: 1px solid #e0e3eb; align-items: flex-end; gap: 16px; }
    .oc-expiries-strip::-webkit-scrollbar { display: none; }
    
    .oc-month-group { display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .oc-month-label { font-size: 12px; color: #131722; font-weight: 500; }
    .oc-days-row { display: flex; gap: 4px; }
    
    .oc-expiry { padding: 4px 10px; border-radius: 6px; border: none; background: #f0f3fa; cursor: pointer; font-size: 13px; color: #131722; font-weight: 500; transition: background 0.2s; }
    .oc-expiry:hover { background: #e0e3eb; }
    .oc-expiry.active { background: #2a2e39; color: white; }
    
    .oc-table-top-header { display: flex; padding: 12px 24px 4px 24px; font-size: 13px; font-weight: 600; color: #131722; }
    .oc-table-header { display: flex; padding: 4px 24px 12px 24px; border-bottom: 1px solid #e0e3eb; font-size: 12px; color: #787b86; }
    .oc-col { flex: 1; text-align: center; }
    
    .oc-table-body { flex-grow: 1; overflow-y: auto; font-size: 13px; color: #131722; position: relative; padding-bottom: 40px;}
    .oc-row { display: flex; padding: 0 24px; border-bottom: 1px solid #f0f3fa; }
    
    .oc-cell { flex: 1; padding: 14px 0; text-align: center; cursor: pointer; transition: background 0.1s; position: relative; }
    
    .call-cell:hover, .put-cell:hover { background: #f0f3fa; }
    .call-cell:hover::after { content: ''; position: absolute; right: 0; top: 50%; transform: translateY(-50%); border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 5px solid #d1d4dc; }
    .put-cell:hover::before { content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%); border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-right: 5px solid #d1d4dc; }
    
    .strike-cell { font-weight: 500; cursor: default; background: #fafafc; }
    .strike-cell:hover { color: #131722; }
    
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
                <div class="oc-title" onclick="window.loadSymbol('NIFTY50-INDEX')">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                    NIFTY Options
                </div>
                <div style="display:flex; align-items:center; gap: 16px; margin-left: auto; margin-right: 24px;">
                    <span id="btn_futures" style="display:none; cursor: pointer; color: #2962FF; font-size: 14px; font-weight: 500;">Futures</span>
                </div>
                <div class="oc-close" onclick="window.closeOptionsChainModal()">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </div>
            </div>
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
    if (!modalOverlay) buildModal();
    modalOverlay.style.display = 'flex';
    if (expiries.length === 0) {
        fetchExpiries();
    } else if (currentExpiry) {
        selectExpiry(currentExpiry);
    }
};

window.closeOptionsChainModal = function() {
    if (modalOverlay) modalOverlay.style.display = 'none';
};

async function fetchExpiries() {
    try {
        const res = await fetch(HF_BASE);
        const data = await res.json();
        
        const expiryMap = {};
        for (let item of data) {
            if (item.type === 'directory') {
                const folderName = item.path.split('/').pop();
                const match = folderName.match(/_(\d{8})_(\d{6})$/);
                if (match) {
                    const dateStr = match[1];
                    const timeStr = match[2];
                    
                    const year = dateStr.slice(0,4);
                    const monthNum = dateStr.slice(4,6);
                    const day = parseInt(dateStr.slice(6,8));
                    const dateObj = new Date(`${year}-${monthNum}-${day}`);
                    
                    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                    const month = monthNames[dateObj.getMonth()];
                    
                    if (!expiryMap[dateStr] || timeStr > expiryMap[dateStr].timeStr) {
                        expiryMap[dateStr] = {
                            dateStr, timeStr, folderPath: item.path, dateObj, month, day, year
                        };
                    }
                }
            }
        }
        expiries = Object.values(expiryMap).sort((a,b) => a.dateObj - b.dateObj);
        window.HF_EXPIRIES = expiries;
        
        updateExpiryStrip();
        if (expiries.length > 0) {
            selectExpiry(expiries[0]);
        }
    } catch(e) {
        console.error("Failed to init options chain", e);
    }
}

function updateExpiryStrip() {
    const strip = document.getElementById('oc_expiries_strip');
    if (!strip) return;
    strip.innerHTML = '';
    
    const groups = {}; // month -> array of expiries
    expiries.forEach(exp => {
        if (!groups[exp.month]) groups[exp.month] = [];
        groups[exp.month].push(exp);
    });
    
    for (const [month, exps] of Object.entries(groups)) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'oc-month-group';
        
        const label = document.createElement('div');
        label.className = 'oc-month-label';
        label.innerText = month;
        groupDiv.appendChild(label);
        
        const daysRow = document.createElement('div');
        daysRow.className = 'oc-days-row';
        
        exps.forEach(exp => {
            const btn = document.createElement('button');
            btn.className = `oc-expiry ${currentExpiry && currentExpiry.dateStr === exp.dateStr ? 'active' : ''}`;
            btn.innerText = exp.day;
            btn.onclick = () => selectExpiry(exp);
            daysRow.appendChild(btn);
        });
        
        groupDiv.appendChild(daysRow);
        strip.appendChild(groupDiv);
    }
}

async function selectExpiry(expiry) {
    currentExpiry = expiry;
    updateExpiryStrip();
    
    window.ACTIVE_EXPIRY_FOLDER = expiry.folderPath;
    
    const tbody = document.getElementById('oc_table_body');
    tbody.innerHTML = '<div style="padding: 40px; text-align: center; color: #787b86;">Loading strikes...</div>';
    
    try {
        const res = await fetch(`https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/${expiry.folderPath}`);
        const files = await res.json();
        
        window.ACTIVE_EXPIRY_FILES = files;
        
        const strikes = new Set();
        const symbols = {}; 
        
        let indexFile = null;
        let futSymbol = null;

        for (let f of files) {
            const filename = f.path.split('/').pop();
            
            if (filename.includes('NIFTY50-INDEX_D_') || filename.includes('NIFTY50-INDEX_1_')) {
                if (!indexFile || filename.includes('_D_')) {
                    indexFile = f;
                }
            }
            if (filename.includes('FUT_')) {
                futSymbol = filename.split('_')[0];
            }
            
            const match = filename.match(/NIFTY\d+?(\d{5})([CP]E)_/);
            if (match) {
                const strike = parseInt(match[1]);
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
            btnFutures.onclick = () => window.loadSymbol(futSymbol);
        } else {
            btnFutures.style.display = 'none';
        }
        
        let atmPrice = null;
        if (indexFile) {
            try {
                while(!window.db) { await new Promise(r => setTimeout(r, 100)); }
                const indexUrl = `https://huggingface.co/datasets/deep776/fyers-market-data/resolve/main/${indexFile.path}`;
                const vfsName = await window.ensureParquetLoaded(indexUrl);
                const conn = await window.db.connect();
                const result = await conn.query(`SELECT close FROM read_parquet('${vfsName}') ORDER BY time DESC LIMIT 1`);
                const rows = result.toArray();
                if (rows.length > 0) atmPrice = rows[0].close;
                await conn.close();
            } catch(e) {
                console.error("Failed to fetch ATM price", e);
            }
        }
        
        renderTable(sortedStrikes, symbols, atmPrice);
        
    } catch(e) {
        console.error("Failed to load expiry data", e);
        tbody.innerHTML = '<div style="padding: 40px; text-align: center; color: red;">Error loading data</div>';
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
                <div class="atm-marker">NIFTY ${atmPrice.toFixed(2)}</div>
            `;
            tbody.appendChild(atmRow);
        }
        
        const ceSymbol = symbols[`${strike}_CE`];
        const peSymbol = symbols[`${strike}_PE`];
        
        const isCeActive = ceSymbol === currentSymbol;
        const isPeActive = peSymbol === currentSymbol;
        
        const row = document.createElement('div');
        row.className = `oc-row`;
        
        row.innerHTML = `
            <div class="oc-cell call-cell ${isCeActive ? 'active' : ''}" onclick="window.loadSymbol('${ceSymbol || ''}')">
                ${ceSymbol ? 'Call '+strike.toLocaleString() : '-'}
            </div>
            <div class="oc-cell strike-cell">${strike.toLocaleString()}</div>
            <div class="oc-cell put-cell ${isPeActive ? 'active' : ''}" onclick="window.loadSymbol('${peSymbol || ''}')">
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
