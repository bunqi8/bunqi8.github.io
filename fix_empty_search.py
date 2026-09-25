import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

old_search = """        const query = userInput.toUpperCase();
        if (!query) return onResultReadyCallback([]);
        
        const results = [];"""

new_search = """        const query = userInput.toUpperCase();
        const results = [];
        
        try {
            const expiries = await window.SyncManager.getAllExpiries();
            
            // Default listing when search box is empty
            if (!query) {
                const uniqueTickers = [...new Set(expiries.map(e => e.baseTicker))].sort();
                uniqueTickers.forEach(bt => {
                    const idxSymbol = bt.replace('NSE_', '').replace('BSE_', '').replace('MCX_', '').replace('_INDEX', '') + '-INDEX';
                    results.push({
                        symbol: idxSymbol,
                        full_name: idxSymbol,
                        description: `${idxSymbol.replace('-INDEX', '')} Index`,
                        exchange: (bt || "NSE_").split('_')[0],
                        type: "index"
                    });
                });
                return onResultReadyCallback(results);
            }
"""
js = js.replace(old_search, new_search)

# Now we need to remove the duplicate `try { const expiries = await window.SyncManager.getAllExpiries();` since I moved it up.
old_try = """        try {
            const expiries = await window.SyncManager.getAllExpiries();
            for (let exp of expiries) {"""
new_try = """            for (let exp of expiries) {"""
js = js.replace(old_try, new_try)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

