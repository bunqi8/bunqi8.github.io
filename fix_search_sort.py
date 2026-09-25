import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

# Remove the early break loop constraint
js = js.replace("if (results.length > 50) break;", "")

# Replace the empty search block to include the popularity map and sorting
old_empty = """            // Default listing when search box is empty
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
            }"""

new_empty = """            const popMap = { 'NIFTY50':1, 'NIFTY':1, 'BANKNIFTY':2, 'SENSEX':3, 'FINNIFTY':4, 'BANKEX':5, 'MIDCPNIFTY':6, 'NIFTYNXT50':7, 'SX50':8 };
            
            // Default listing when search box is empty
            if (!query) {
                const uniqueTickers = [...new Set(expiries.map(e => e.baseTicker))];
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
                
                results.sort((a, b) => {
                    const baseA = a.symbol.replace('-INDEX', '');
                    const baseB = b.symbol.replace('-INDEX', '');
                    return (popMap[baseA] || 99) - (popMap[baseB] || 99) || a.symbol.localeCompare(b.symbol);
                });
                
                return onResultReadyCallback(results);
            }"""

js = js.replace(old_empty, new_empty)

# Sort results before slicing at the very end of the function
old_end = """        } catch(e) {
            console.error("Search error", e);
        }
        
        onResultReadyCallback(results.slice(0, 50));
    },"""

new_end = """        } catch(e) {
            console.error("Search error", e);
        }
        
        results.sort((a, b) => {
            // 1. Type Priority (Index > Futures > Options)
            const typeScore = { 'index': 1, 'futures': 2, 'option': 3 };
            if (typeScore[a.type] !== typeScore[b.type]) {
                return typeScore[a.type] - typeScore[b.type];
            }
            
            // 2. Popularity Priority (NIFTY > BANKNIFTY > SENSEX ...)
            const baseA = a.symbol.replace(/\\d.*/, '').replace('-INDEX', '');
            const baseB = b.symbol.replace(/\\d.*/, '').replace('-INDEX', '');
            const scoreA = popMap[baseA] || 99;
            const scoreB = popMap[baseB] || 99;
            
            if (scoreA !== scoreB) {
                return scoreA - scoreB;
            }
            
            // 3. Alphabetical fallback (will naturally group same expiries/strikes together)
            return a.symbol.localeCompare(b.symbol);
        });
        
        // Remove exact duplicates just in case (dedup by symbol)
        const uniqueResults = [];
        const seen = new Set();
        for (let r of results) {
            if (!seen.has(r.symbol)) {
                seen.add(r.symbol);
                uniqueResults.push(r);
            }
        }
        
        onResultReadyCallback(uniqueResults.slice(0, 50));
    },"""

js = js.replace(old_end, new_end)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

