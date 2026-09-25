import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

# Fix searchSymbols
old_search = """                    if (filename.includes('FUT_')) {"""
new_search = """                    // Check for Index
                    if (filename.includes('-INDEX_')) {
                        const idxSymbol = filename.split('_')[0];
                        if (idxSymbol.includes(query) && !results.find(r => r.symbol === idxSymbol)) {
                            results.push({
                                symbol: idxSymbol,
                                full_name: idxSymbol,
                                description: `${idxSymbol.replace('-INDEX', '')} Index`,
                                exchange: (exp.baseTicker || "NSE_").split('_')[0],
                                type: "index"
                            });
                        }
                    }
                    
                    if (filename.includes('FUT_')) {"""
js = js.replace(old_search, new_search)

# Fix resolveParquetFiles Futures fallback
old_res = """                        } else if (filename.includes('FUT_')) {
                            isMatch = true; priority = 1;
                        }"""
new_res = """                        } else if (filename.includes('FUT_')) {
                            const prefix = symbolInfo.name.replace(/\\d{2}[A-Z]{3}FUT/, '');
                            if (filename.startsWith(prefix)) {
                                isMatch = true; priority = 1;
                            }
                        }"""
js = js.replace(old_res, new_res)

# Fix resolveParquetFiles Index fallback
old_idx = """                    } else if (symbolInfo.type === 'index') {
                        if (filename.startsWith('NIFTY50-INDEX')) {
                            isMatch = true; priority = 10;
                        }
                    } else { // Option"""
new_idx = """                    } else if (symbolInfo.type === 'index') {
                        if (filename.startsWith(symbolInfo.name)) {
                            isMatch = true; priority = 10;
                        }
                    } else { // Option"""
js = js.replace(old_idx, new_idx)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

