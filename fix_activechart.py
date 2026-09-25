import re

with open('public/options_chain.js', 'r') as f:
    js = f.read()

old_chart = "const chartSym = window.tvWidget ? window.tvWidget.activeChart().symbol() : '';"
new_chart = """let chartSym = 'NIFTY50-INDEX';
            try { if (window.tvWidget) chartSym = window.tvWidget.activeChart().symbol(); } catch(e) {}"""
js = js.replace(old_chart, new_chart)

with open('public/options_chain.js', 'w') as f:
    f.write(js)

with open('public/cache.js', 'r') as f:
    js = f.read()

old_chart_cache = "const chartSym = window.tvWidget ? window.tvWidget.activeChart().symbol() : '';"
new_chart_cache = """let chartSym = 'NIFTY50-INDEX';
                        try { if (window.tvWidget) chartSym = window.tvWidget.activeChart().symbol(); } catch(e) {}"""
js = js.replace(old_chart_cache, new_chart_cache)

with open('public/cache.js', 'w') as f:
    f.write(js)

