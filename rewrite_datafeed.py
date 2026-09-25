import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

search_symbols = """    searchSymbols: async (userInput, exchange, symbolType, onResultReadyCallback) => {
        const query = userInput.toUpperCase();
        if (!query) return onResultReadyCallback([]);
        
        const results = [];
        
        if ("NIFTY50-INDEX".includes(query)) {
            results.push({ symbol: "NIFTY50-INDEX", full_name: "NIFTY50-INDEX", description: "Nifty 50 Index", exchange: "NSE", type: "index" });
        }
        
        try {
            const expiries = await window.SyncManager.getAllExpiries();
            for (let exp of expiries) {
                if (results.length > 50) break;
                for (let f of exp.files) {
                    const filename = f.path.split('/').pop();
                    
                    if (filename.includes('FUT_')) {
                        const futSymbol = filename.split('_')[0];
                        if (futSymbol.includes(query) && !results.find(r => r.symbol === futSymbol)) {
                            results.push({
                                symbol: futSymbol,
                                full_name: futSymbol,
                                description: `NIFTY Futures`,
                                exchange: "NSE",
                                type: "futures"
                            });
                        }
                    }
                    
                    const match = filename.match(/NIFTY\\d+?(\\d{5})([CP]E)_/);
                    if (match) {
                        const symbol = filename.split('_')[0];
                        if (symbol.includes(query) && !results.find(r => r.symbol === symbol)) {
                            results.push({
                                symbol: symbol,
                                full_name: symbol,
                                description: `NIFTY Option ${symbol}`,
                                exchange: "NSE",
                                type: "option"
                            });
                        }
                    }
                }
            }
        } catch(e) {
            console.error("Search error", e);
        }
        
        onResultReadyCallback(results.slice(0, 50));
    },"""

js = re.sub(r'searchSymbols: \(userInput, exchange, symbolType, onResultReadyCallback\) => \{.*?\},', lambda m: search_symbols, js, flags=re.DOTALL)

getbars_find_file = """            let fileObj = null;
            if (window.ACTIVE_EXPIRY_FILES) {
                fileObj = window.ACTIVE_EXPIRY_FILES.find(f => f.path.split('/').pop().startsWith(targetFileName));
                if (!fileObj && fileSuffix === 'D') {
                    let tf = `${symbolInfo.name}_1D_`;
                    fileObj = window.ACTIVE_EXPIRY_FILES.find(f => f.path.split('/').pop().startsWith(tf));
                } else if (!fileObj && fileSuffix === '1D') {
                    let tf = `${symbolInfo.name}_D_`;
                    fileObj = window.ACTIVE_EXPIRY_FILES.find(f => f.path.split('/').pop().startsWith(tf));
                }
            }
            
            // Fallback: search IndexedDB cache if modal isn't open or active files don't have it
            if (!fileObj) {
                const expiries = await window.SyncManager.getAllExpiries();
                for (let exp of expiries) {
                    fileObj = exp.files.find(f => f.path.split('/').pop().startsWith(targetFileName));
                    if (fileObj) break;
                    
                    if (fileSuffix === 'D') {
                        let tf = `${symbolInfo.name}_1D_`;
                        fileObj = exp.files.find(f => f.path.split('/').pop().startsWith(tf));
                        if (fileObj) break;
                    } else if (fileSuffix === '1D') {
                        let tf = `${symbolInfo.name}_D_`;
                        fileObj = exp.files.find(f => f.path.split('/').pop().startsWith(tf));
                        if (fileObj) break;
                    }
                }
            }
            if (!fileObj) {"""

js = re.sub(r'let fileObj = window\.ACTIVE_EXPIRY_FILES\.find\(f => f\.path\.split\(\'/\'\)\.pop\(\)\.startsWith\(targetFileName\)\);.*?if \(!fileObj\) \{', lambda m: getbars_find_file, js, flags=re.DOTALL)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

