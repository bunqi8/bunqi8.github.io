const HF_BASE = "https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/NSE_NIFTY50_INDEX/option_data/parquet";

let expiries = []; // { dateStr, folderPath, dateObj, label }
let currentExpiry = null;

// Inject CSS
const style = document.createElement('style');
style.innerHTML = `
    .oc-header { padding: 16px 16px 8px 16px; border-bottom: 1px solid #e0e3eb; }
    .oc-title { font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #131722; display: flex; justify-content: space-between; align-items: center; }
    .oc-expiries-strip { display: flex; overflow-x: auto; gap: 8px; padding-bottom: 4px; }
    .oc-expiries-strip::-webkit-scrollbar { height: 4px; }
    .oc-expiries-strip::-webkit-scrollbar-thumb { background: #d1d4dc; border-radius: 4px; }
    .oc-expiry { padding: 6px 14px; border-radius: 6px; border: none; background: #f0f3fa; cursor: pointer; white-space: nowrap; font-size: 13px; color: #131722; font-weight: 500; transition: all 0.2s; }
    .oc-expiry:hover { background: #e0e3eb; }
    .oc-expiry.active { background: #131722; color: white; }
    
    .oc-table-header { display: flex; padding: 12px 0; border-bottom: 1px solid #e0e3eb; font-size: 12px; font-weight: 600; color: #787b86; align-items: flex-end; }
    .oc-col { flex: 1; text-align: center; position: relative; }
    
    .oc-table-body { flex-grow: 1; overflow-y: auto; font-size: 13px; color: #131722; }
    .oc-row { display: flex; border-bottom: 1px solid #f0f3fa; }
    .oc-row:hover { background: #f8f9fd; }
    .oc-row.atm-row { background: #eef2fa; }
    
    .oc-cell { flex: 1; padding: 12px 0; text-align: center; cursor: pointer; }
    .oc-cell:hover { color: #2962FF; font-weight: 500; }
    .strike-cell { font-weight: 600; cursor: default; background: #fafafc; }
    .strike-cell:hover { color: #131722; font-weight: 600; }
    
    .atm-marker { background: #131722; color: white; font-size: 11px; padding: 3px 6px; border-radius: 4px; display: inline-block; margin-bottom: 4px; white-space: nowrap; }
`;
document.head.appendChild(style);

async function init() {
    const container = document.getElementById('options_chain_container');
    container.innerHTML = `
        <div class="oc-header">
            <div class="oc-title">
                <span style="cursor:pointer; display:flex; align-items:center; gap:8px;" onclick="window.loadSymbol('NIFTY50-INDEX')">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4L6 9l6 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    NIFTY Options
                </span>
            </div>
            <div class="oc-expiries-strip" id="oc_expiries_strip">
                <span style="font-size:13px; color:#787b86;">Loading expiries...</span>
            </div>
        </div>
        <div class="oc-table-header">
            <div class="oc-col">Calls</div>
            <div class="oc-col" id="atm_header">Strike</div>
            <div class="oc-col">Puts</div>
        </div>
        <div class="oc-table-body" id="oc_table_body">
            <!-- Rows injected here -->
        </div>
    `;

    // Wait for DuckDB
    while(!window.db) { await new Promise(r => setTimeout(r, 100)); }
    
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
                    const month = dateStr.slice(4,6);
                    const day = dateStr.slice(6,8);
                    const dateObj = new Date(`${year}-${month}-${day}`);
                    
                    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                    const label = `${monthNames[dateObj.getMonth()]} ${parseInt(day)}`;

                    if (!expiryMap[dateStr] || timeStr > expiryMap[dateStr].timeStr) {
                        expiryMap[dateStr] = {
                            dateStr, timeStr, folderPath: item.path, dateObj, label
                        };
                    }
                }
            }
        }
        expiries = Object.values(expiryMap).sort((a,b) => a.dateObj - b.dateObj);
        
        // Pass the directory list to global state for datafeed.js
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
    strip.innerHTML = '';
    
    expiries.forEach(exp => {
        const btn = document.createElement('button');
        btn.className = `oc-expiry ${currentExpiry && currentExpiry.dateStr === exp.dateStr ? 'active' : ''}`;
        btn.innerText = exp.label;
        btn.onclick = () => selectExpiry(exp);
        strip.appendChild(btn);
    });
}

async function selectExpiry(expiry) {
    currentExpiry = expiry;
    updateExpiryStrip();
    
    // Update global active expiry for datafeed routing
    window.ACTIVE_EXPIRY_FOLDER = expiry.folderPath;
    
    const tbody = document.getElementById('oc_table_body');
    tbody.innerHTML = '<div style="padding: 20px; text-align: center; color: #787b86;">Loading strikes...</div>';
    document.getElementById('atm_header').innerHTML = 'Strike';
    
    try {
        const res = await fetch(`https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/${expiry.folderPath}`);
        const files = await res.json();
        
        // Expose to global state for datafeed.js dynamic routing
        window.ACTIVE_EXPIRY_FILES = files;
        
        const strikes = new Set();
        const symbols = {}; 
        
        let indexFile = null;

        for (let f of files) {
            const filename = f.path.split('/').pop();
            
            if (filename.includes('NIFTY50-INDEX_D_') || filename.includes('NIFTY50-INDEX_1_')) {
                if (!indexFile || filename.includes('_D_')) {
                    indexFile = f; // Prefer daily for smaller download if available, else 1m
                }
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
        
        // Fetch ATM Price
        let atmPrice = null;
        if (indexFile) {
            try {
                const indexUrl = `https://huggingface.co/datasets/deep776/fyers-market-data/resolve/main/${indexFile.path}`;
                const vfsName = await window.ensureParquetLoaded(indexUrl);
                const conn = await window.db.connect();
                // Get the very last close price
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
        tbody.innerHTML = '<div style="padding: 20px; text-align: center; color: red;">Error loading data</div>';
    }
}

function renderTable(strikes, symbols, atmPrice) {
    const tbody = document.getElementById('oc_table_body');
    tbody.innerHTML = '';
    
    let closestStrike = null;
    let minDiff = Infinity;
    
    if (atmPrice) {
        strikes.forEach(strike => {
            const diff = Math.abs(strike - atmPrice);
            if (diff < minDiff) {
                minDiff = diff;
                closestStrike = strike;
            }
        });
        
        document.getElementById('atm_header').innerHTML = `
            <div class="atm-marker">NIFTY ${atmPrice.toFixed(2)}</div><br>
            Strike
        `;
    }
    
    strikes.forEach(strike => {
        const ceSymbol = symbols[`${strike}_CE`];
        const peSymbol = symbols[`${strike}_PE`];
        
        const row = document.createElement('div');
        row.className = `oc-row ${strike === closestStrike ? 'atm-row' : ''}`;
        row.id = `strike-${strike}`;
        
        row.innerHTML = `
            <div class="oc-cell call-cell" onclick="window.loadSymbol('${ceSymbol}')">${ceSymbol ? 'Call '+strike.toLocaleString() : '-'}</div>
            <div class="oc-cell strike-cell">${strike.toLocaleString()}</div>
            <div class="oc-cell put-cell" onclick="window.loadSymbol('${peSymbol}')">${peSymbol ? 'Put '+strike.toLocaleString() : '-'}</div>
        `;
        tbody.appendChild(row);
    });
    
    // Auto scroll to ATM
    if (closestStrike) {
        setTimeout(() => {
            const el = document.getElementById(`strike-${closestStrike}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 150);
    }
}

// Attach to window so onclick works
window.loadSymbol = function(symbol) {
    if (!symbol || symbol === 'undefined') return;
    if (window.tvWidget) {
        window.tvWidget.setSymbol(symbol, window.tvWidget.symbolInterval().interval, () => {});
    }
};

// Boot
window.addEventListener('DOMContentLoaded', init);
