import re

with open('public/datafeed.js', 'r') as f:
    code = f.read()

# Replace Strategy B fallback
older_fallback_old = """
                // No more older data exists in the file
                DFLog.info('getBars', `No older data exists. Returning noData:true to stop backward requests.`);
                onHistoryCallback([], { noData: true });
                return;
"""

older_fallback_new = """
                if (window.FyersAPI && (symbolInfo.type === 'index' || symbolInfo.type === 'futures')) {
                    DFLog.info('getBars', `No older Parquet data exists. Falling back to Fyers Deep History...`);
                    
                    let fyersSymbol = `${symbolInfo.exchange}:${symbolInfo.name}`;
                    if (symbolInfo.type === 'futures' && window.HF_EXPIRIES) {
                        const baseTickerMatch = symbolInfo.name.match(/^([A-Z]+)\d/);
                        if (baseTickerMatch) {
                            const baseTicker = baseTickerMatch[1] + '_INDEX';
                            const baseExpiries = window.HF_EXPIRIES.filter(e => e.baseTicker.includes(baseTicker) && e.expiryType === 'M' && !e.isDummy);
                            if (baseExpiries.length > 0) {
                                baseExpiries.sort((a,b) => a.dateObjValue - b.dateObjValue);
                                const now = Date.now();
                                let activeExp = baseExpiries.find(e => now < (e.dateObjValue + 86400000));
                                if (!activeExp) activeExp = baseExpiries[baseExpiries.length - 1];
                                
                                const yy = activeExp.dateStr.slice(2,4);
                                const base = activeExp.baseTicker.replace('NSE_', '').replace('BSE_', '').replace('_INDEX', '');
                                fyersSymbol = `${symbolInfo.exchange}:${base}${yy}${activeExp.expiryCode}FUT`;
                            }
                        }
                    }
                    
                    const deepBars = await window.FyersAPI.getDeepHistory(fyersSymbol, resolution, rawFrom, rawTo);
                    if (deepBars && deepBars.length > 0) {
                        DFLog.info('getBars', `Returning ${deepBars.length} deep history bars from Fyers API`);
                        onHistoryCallback(deepBars, { noData: false });
                        return;
                    }
                }
                
                // No more older data exists anywhere
                DFLog.info('getBars', `No older data exists in Parquet or Fyers. Returning noData:true`);
                onHistoryCallback([], { noData: true });
                return;
"""

code = code.replace(older_fallback_old.strip('\n'), older_fallback_new.strip('\n'))

with open('public/datafeed.js', 'w') as f:
    f.write(code)
