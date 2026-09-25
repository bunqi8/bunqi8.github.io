import re

with open('public/options_chain.js', 'r') as f:
    js = f.read()

new_fetch = """async function fetchExpiries() {
    try {
        const cached = await window.SyncManager.getAllExpiries();
        if (cached && cached.length > 0) {
            expiries = cached.sort((a,b) => a.dateObjValue - b.dateObjValue);
            window.HF_EXPIRIES = expiries;
            updateExpiryStrip();
            if (!currentExpiry) selectExpiry(expiries[0]);
        }
        
        await window.SyncManager.syncRoot();
        
        const fresh = await window.SyncManager.getAllExpiries();
        expiries = fresh.sort((a,b) => a.dateObjValue - b.dateObjValue);
        window.HF_EXPIRIES = expiries;
        updateExpiryStrip();
        
        if (currentExpiry) {
            const updated = expiries.find(e => e.dateStr === currentExpiry.dateStr);
            if (updated && updated.timeStr !== currentExpiry.timeStr) {
                selectExpiry(updated);
            }
        } else if (expiries.length > 0) {
            selectExpiry(expiries[0]);
        }
    } catch(e) {
        console.error("Failed to init options chain", e);
    }
}"""
js = re.sub(r'async function fetchExpiries\(\) \{.*?\}', lambda m: new_fetch, js, flags=re.DOTALL)

new_select = """async function selectExpiry(expiry) {
    currentExpiry = expiry;
    updateExpiryStrip();
    
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
        
        if (filename.includes('NIFTY50-INDEX_D_') || filename.includes('NIFTY50-INDEX_1_')) {
            if (!indexFile || filename.includes('_D_')) {
                indexFile = f;
            }
        }
        if (filename.includes('FUT_')) {
            futSymbol = filename.split('_')[0];
        }
        
        const match = filename.match(/NIFTY\\d+?(\\d{5})([CP]E)_/);
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
}"""
js = re.sub(r'async function selectExpiry\(expiry\) \{.*?function renderTable', lambda m: new_select + '\n\nfunction renderTable', js, flags=re.DOTALL)

with open('public/options_chain.js', 'w') as f:
    f.write(js)
