import re

with open('public/options_chain.js', 'r') as f:
    js = f.read()

# Add styles for base strip
old_style = """    .oc-expiries-strip::-webkit-scrollbar { display: none; }"""
new_style = """    .oc-expiries-strip::-webkit-scrollbar { display: none; }
    .oc-base-strip { display: flex; overflow-x: auto; padding: 12px 24px 0 24px; gap: 8px; border-bottom: 1px solid #f0f3fa; }
    .oc-base-strip::-webkit-scrollbar { display: none; }
    .oc-base-btn { padding: 6px 12px; font-size: 14px; font-weight: 500; color: #787b86; cursor: pointer; border-radius: 4px; transition: 0.1s; border: none; background: transparent; }
    .oc-base-btn:hover { background: #f0f3fa; color: #131722; }
    .oc-base-btn.active { color: #2962FF; background: #e3f2fd; }"""
js = js.replace(old_style, new_style)

# Add base strip to modal
old_modal = """            <div class="oc-expiries-strip" id="oc_expiries_strip">"""
new_modal = """            <div class="oc-base-strip" id="oc_base_strip"></div>
            <div class="oc-expiries-strip" id="oc_expiries_strip">"""
js = js.replace(old_modal, new_modal)

# Modify state variables
old_vars = """let expiries = [];
let currentExpiry = null;
let modalOverlay = null;"""
new_vars = """let expiries = [];
let currentExpiry = null;
let modalOverlay = null;
window.ACTIVE_BASE_TICKER = null;
"""
js = js.replace(old_vars, new_vars)

# Fix openOptionsChainModal to guess base ticker from chart
old_open = """        if (window.HF_EXPIRIES && window.HF_EXPIRIES.length > 0) {
            let targetExpiry = null;
            const symbol = window.tvWidget.activeChart().symbol();
            const match = symbol.match(/NIFTY(\\d{2})([1-9OND])(\\d{2})\\d{5}[CP]E/);
            if (match) {"""
new_open = """        if (window.HF_EXPIRIES && window.HF_EXPIRIES.length > 0) {
            let targetExpiry = null;
            const symbol = window.tvWidget.activeChart().symbol();
            
            // Auto-detect base ticker
            const possible = [...new Set(window.HF_EXPIRIES.map(e => e.baseTicker))];
            let found = possible.find(p => p.includes(symbol.split('-')[0]) || p.includes(symbol.replace(/\\d.*/, '')));
            if (found) window.ACTIVE_BASE_TICKER = found;
            if (!window.ACTIVE_BASE_TICKER) window.ACTIVE_BASE_TICKER = possible[0] || 'NSE_NIFTY50_INDEX';
            
            // Filter expiries to active base ticker
            const filteredExpiries = window.HF_EXPIRIES.filter(e => e.baseTicker === window.ACTIVE_BASE_TICKER);
            
            const match = symbol.match(/[A-Z]+(\\d{2})([1-9OND])(\\d{2})\\d{5}[CP]E/);
            if (match) {"""
js = js.replace(old_open, new_open)

old_open_fallback = """            if (expiries.length === 0) {
        fetchExpiries();
    } else if (targetExpiry) {
        selectExpiry(targetExpiry);
    }"""
new_open_fallback = """            if (expiries.length === 0) {
        fetchExpiries();
    } else {
        updateExpiryStrip(); // Render base tabs
        if (targetExpiry) {
            selectExpiry(targetExpiry);
        } else if (filteredExpiries.length > 0) {
            selectExpiry(filteredExpiries[0]);
        }
    }"""
js = js.replace(old_open_fallback, new_open_fallback)

# Fix fetchExpiries
old_fetch = """        const fresh = await window.SyncManager.getAllExpiries();
        expiries = fresh.sort((a,b) => a.dateObjValue - b.dateObjValue);
        window.HF_EXPIRIES = expiries;
        updateExpiryStrip();
        
        if (currentExpiry) {
            const updated = expiries.find(e => e.dateStr === currentExpiry.dateStr);"""
new_fetch = """        const fresh = await window.SyncManager.getAllExpiries();
        expiries = fresh.sort((a,b) => a.dateObjValue - b.dateObjValue);
        window.HF_EXPIRIES = expiries;
        
        const possible = [...new Set(window.HF_EXPIRIES.map(e => e.baseTicker))];
        if (!window.ACTIVE_BASE_TICKER && possible.length > 0) {
            const chartSym = window.tvWidget ? window.tvWidget.activeChart().symbol() : '';
            let found = possible.find(p => p.includes(chartSym.split('-')[0]) || p.includes(chartSym.replace(/\\d.*/, '')));
            window.ACTIVE_BASE_TICKER = found || possible[0];
        }
        
        updateExpiryStrip();
        
        if (currentExpiry) {
            const updated = expiries.find(e => e.id === currentExpiry.id);"""
js = js.replace(old_fetch, new_fetch)

# Wait, `e.dateStr === symDateStr` in openOptionsChainModal must check `baseTicker` too!
old_find_date = """            const found = expiries.find(e => e.dateStr === symDateStr);
            if (found) targetExpiry = found;"""
new_find_date = """            const found = filteredExpiries.find(e => e.dateStr === symDateStr);
            if (found) targetExpiry = found;"""
js = js.replace(old_find_date, new_find_date)


# Fix updateExpiryStrip
old_update_strip = """function updateExpiryStrip() {
    const strip = document.getElementById('oc_expiries_strip');
    if (!strip) return;
    strip.innerHTML = '';
    
    let lastMonthLabel = null;"""
new_update_strip = """function updateExpiryStrip() {
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
            if (filtered.length > 0) selectExpiry(filtered[0]);
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

    let lastMonthLabel = null;"""
js = js.replace(old_update_strip, new_update_strip)

# Inside updateExpiryStrip, change `expiries.forEach` to `filteredExpiries.forEach`
js = js.replace("    expiries.forEach(exp => {", "    filteredExpiries.forEach(exp => {")

# In selectExpiry, `e.dateStr === exp.dateStr` -> `e.id === exp.id`
js = js.replace("currentExpiry && currentExpiry.dateStr === exp.dateStr", "currentExpiry && currentExpiry.id === exp.id")

# And inside selectExpiry when forcing sync
old_force = """        window.SyncManager.forceSyncExpiry(expiry.dateStr).then(updated => {
            if (updated && currentExpiry && currentExpiry.dateStr === expiry.dateStr) {
                // If it updated, fetch the freshest copy from DB and re-render
                window.SyncManager.getExpiry(expiry.dateStr).then(fresh => {"""
new_force = """        window.SyncManager.forceSyncExpiry(expiry.id).then(updated => {
            if (updated && currentExpiry && currentExpiry.id === expiry.id) {
                // If it updated, fetch the freshest copy from DB and re-render
                window.SyncManager.getExpiry(expiry.id).then(fresh => {"""
js = js.replace(old_force, new_force)

# And in selectExpiry `window.loadSymbol('NIFTY50-INDEX')` -> `window.loadSymbol(expiry.baseTicker.replace('NSE_', '').replace('BSE_', '').replace('_INDEX', '') + '-INDEX')`?
# Actually the base ticker prefix can be dynamic. The best way is to infer the underlying symbol name from the baseTicker.
# "NSE_NIFTY50_INDEX" -> "NIFTY50-INDEX"
# "BSE_SENSEX_INDEX" -> "SENSEX-INDEX"
old_load_idx = """        document.querySelector('.oc-btn-native').onclick = () => {
            window.loadSymbol('NIFTY50-INDEX');
            window.closeOptionsChainModal();
        };"""
new_load_idx = """        document.querySelector('.oc-btn-native').onclick = () => {
            const sym = expiry.baseTicker.replace('NSE_', '').replace('BSE_', '').replace('_INDEX', '') + '-INDEX';
            window.loadSymbol(sym);
            window.closeOptionsChainModal();
        };"""
js = js.replace(old_load_idx, new_load_idx)

# And for Futures button in selectExpiry
old_load_fut = """        if (futFile) {
            futBtn.style.display = 'block';
            const futSymbol = futFile.path.split('/').pop().split('_')[0];
            futBtn.onclick = () => {
                window.loadSymbol(futSymbol);
                window.closeOptionsChainModal();
            };
        }"""
# Wait, this logic didn't exist in my snippet above! Let's just use re.sub for safety!
with open('public/options_chain.js', 'w') as f:
    f.write(js)

