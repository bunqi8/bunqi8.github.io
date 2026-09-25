import re

with open('public/options_chain.js', 'r') as f:
    js = f.read()

# Fix the ATM marker hardcoded NIFTY text
old_atm = """                <div class="atm-marker">NIFTY ${atmPrice.toFixed(2)}</div>"""
new_atm = """                <div class="atm-marker">${(window.ACTIVE_BASE_TICKER || '').replace('NSE_', '').replace('BSE_', '').replace('_INDEX', '').replace('MCX_', '')} ${atmPrice.toFixed(2)}</div>"""
js = js.replace(old_atm, new_atm)

# Fix the filtered[0] logic when switching tabs
old_filtered = """if (filtered.length > 0) selectExpiry(filtered[0]);"""
new_filtered = """if (filtered.length > 0) selectExpiry(filtered[filtered.length - 1]);"""
js = js.replace(old_filtered, new_filtered)

# Fix the expiries[0] logic in fetchExpiries when booting up
js = js.replace("if (!currentExpiry) selectExpiry(expiries[0]);", "if (!currentExpiry) { const f = expiries.filter(e => e.baseTicker === window.ACTIVE_BASE_TICKER); if (f.length > 0) selectExpiry(f[f.length - 1]); }")
js = js.replace("} else if (expiries.length > 0) {\n            selectExpiry(expiries[0]);", "} else if (expiries.length > 0) {\n            const f = expiries.filter(e => e.baseTicker === window.ACTIVE_BASE_TICKER); if (f.length > 0) selectExpiry(f[f.length - 1]);")

with open('public/options_chain.js', 'w') as f:
    f.write(js)

