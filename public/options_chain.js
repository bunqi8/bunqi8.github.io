const HF_BASE = "https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/NSE_NIFTY50_INDEX/option_data/parquet";

let expiries = []; // { dateStr, folderPath, dateObj, label }
let currentExpiry = null;
let modalOverlay = null;

// Inject CSS
const style = document.createElement('style');
style.innerHTML = `
    .oc-backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.4); z-index: 1000; display: none; align-items: center; justify-content: center; }
    .oc-modal { background: #ffffff; width: 800px; max-height: 85vh; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    
    .oc-header { padding: 16px 24px; border-bottom: 1px solid #e0e3eb; display: flex; justify-content: space-between; align-items: center; }
    .oc-title { font-size: 18px; font-weight: 600; color: #131722; display: flex; align-items: center; gap: 8px; }
    .oc-close { cursor: pointer; color: #787b86; transition: color 0.2s; display: flex; align-items: center; justify-content: center; }
    .oc-close:hover { color: #131722; }
    
    .oc-expiries-strip { display: flex; overflow-x: auto; gap: 8px; padding: 12px 24px; border-bottom: 1px solid #e0e3eb; }
    .oc-expiries-strip::-webkit-scrollbar { height: 0px; }
    .oc-expiry { padding: 6px 14px; border-radius: 6px; border: none; background: #f0f3fa; cursor: pointer; white-space: nowrap; font-size: 13px; color: #131722; font-weight: 500; transition: all 0.2s; }
    .oc-expiry:hover { background: #e0e3eb; }
    .oc-expiry.active { background: #131722; color: white; }
    
    .oc-table-header { display: flex; padding: 12px 24px; border-bottom: 1px solid #e0e3eb; font-size: 12px; font-weight: 600; color: #787b86; align-items: flex-end; }
    .oc-col { flex: 1; text-align: center; position: relative; }
    
    .oc-table-body { flex-grow: 1; overflow-y: auto; font-size: 13px; color: #131722; position: relative; }
    .oc-row { display: flex; padding: 0 24px; border-bottom: 1px solid #f0f3fa; }
    .oc-row:hover { background: #f8f9fd; }
    
    .oc-cell { flex: 1; padding: 12px 0; text-align: center; cursor: pointer; transition: background 0.1s; }
    .oc-cell:hover { color: #2962FF; }
    .strike-cell { font-weight: 500; cursor: default; background: #fafafc; }
    .strike-cell:hover { color: #131722; }
    
    .atm-marker { background: #131722; color: white; font-size: 11px; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-bottom: 4px; font-weight: 600;}
`;
document.head.appendChild(style);

function buildModal() {
    modalOverlay = document.createElement('div');
    modalOverlay.className = 'oc-backdrop';
    modalOverlay.innerHTML = `
        <div class="oc-modal">
            <div class="oc-header">
                <div class="oc-title">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4L6 9l6 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    NIFTY Options
                </div>
                <div class="oc-close" onclick="window.closeOptionsChainModal()">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </div>
            </div>
            <div class="oc-expiries-strip" id="oc_expiries_strip">
                <span style="font-size:13px; color:#787b86;">Loading expiries...</span>
            </div>
            <div class="oc-table-header">
                <div class="oc-col">Calls</div>
                <div class="oc-col" id="atm_header">Strike</div>
                <div class="oc-col">Puts</div>
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
    if (expiries.length === 0) fetchExpiries();
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
    
    window.ACTIVE_EXPIRY_FOLDER = expiry.folderPath;
    
    const tbody = document.getElementById('oc_table_body');
    tbody.innerHTML = '<div style="padding: 40px; text-align: center; color: #787b86;">Loading strikes...</div>';
    document.getElementById('atm_header').innerHTML = 'Strike';
    
    try {
        const res = await fetch(`https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/${expiry.folderPath}`);
        const files = await res.json();
        
        window.ACTIVE_EXPIRY_FILES = files;
        
        const strikes = new Set();
        const symbols = {}; 
        
        let indexFile = null;

        for (let f of files) {
            const filename = f.path.split('/').pop();
            
            if (filename.includes('NIFTY50-INDEX_D_') || filename.includes('NIFTY50-INDEX_1_')) {
                if (!indexFile || filename.includes('_D_')) {
                    indexFile = f;
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
        
        let atmPrice = null;
        if (indexFile) {
            try {
                // Wait for duckdb if opening right on load
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
        row.className = `oc-row`;
        if (strike === closestStrike) row.style.borderTop = row.style.borderBottom = '1px solid #e0e3eb'; // ATM split line
        row.id = `strike-${strike}`;
        
        row.innerHTML = `
            <div class="oc-cell call-cell" onclick="window.loadSymbol('${ceSymbol}')">${ceSymbol ? 'Call '+strike.toLocaleString() : '-'}</div>
            <div class="oc-cell strike-cell">${strike.toLocaleString()}</div>
            <div class="oc-cell put-cell" onclick="window.loadSymbol('${peSymbol}')">${peSymbol ? 'Put '+strike.toLocaleString() : '-'}</div>
        `;
        tbody.appendChild(row);
    });
    
    if (closestStrike) {
        setTimeout(() => {
            const el = document.getElementById(`strike-${closestStrike}`);
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

// Start background fetch immediately, but don't show modal until button clicked
window.addEventListener('DOMContentLoaded', () => {
    buildModal();
    fetchExpiries();
});
