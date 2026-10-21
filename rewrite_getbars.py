import re

with open('public/datafeed.js', 'r') as f:
    content = f.read()

# Find the start of getBars
start_idx = content.find('getBars: async (symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) => {')

# Find the end of getBars by finding the next function subscribeBars
end_idx = content.find('subscribeBars: (symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) => {')

if start_idx == -1 or end_idx == -1:
    print("Could not find boundaries")
    exit(1)

new_getBars = """getBars: async (symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) => {
        let { from, to, countBack, firstDataRequest } = periodParams;
        const rawFrom = from;
        const rawTo = to;
        
        // 1. Live Options (No Parquet)
        if (symbolInfo.isLive && window.FyersAPI) {
            let fyersBars = await window.FyersAPI.getHistory(symbolInfo.name, resolution, rawFrom, rawTo);
            fyersBars = alignFyersDwmTime(fyersBars, resolution);
            return safeHistoryCallback(fyersBars, onHistoryCallback, resolution);
        }

        let conn = null;
        let finalBars = [];
        let duckdbHit = false;

        try {
            // 2. Identify Fyers Base Symbol for stitching
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

            // 3. Query DuckDB Parquet Data
            if (window.db && window.resolveSymbolFiles) {
                const fileUrls = await window.resolveSymbolFiles(symbolInfo, resolution, rawFrom, rawTo, countBack);
                if (fileUrls.length > 0) {
                    let vfsNames = [];
                    for (let url of fileUrls) {
                        vfsNames.push(await window.ensureParquetLoaded(url));
                    }
                    const unionStmts = vfsNames.map(vfs => `SELECT * FROM read_parquet('${vfs}')`).join(' UNION ');
                    
                    conn = await window.db.connect();
                    
                    // We query wider to ensure boundaries are caught cleanly
                    const rangeSQL = `
                        SELECT time * 1000 AS time, open, high, low, close, volume
                        FROM (${unionStmts})
                        WHERE time >= ${rawFrom - 86400} AND time <= ${rawTo + 86400}
                        ORDER BY time ASC
                    `;
                    const rangeResult = await conn.query(rangeSQL);
                    let parquetBars = arrowToTVBars(rangeResult, resolution);
                    
                    if (parquetBars.length > 0) {
                        duckdbHit = true;
                        
                        let coreBars = parquetBars.filter(b => b.time >= rawFrom * 1000 && b.time <= rawTo * 1000);
                        let earliestParquet = coreBars.length > 0 ? coreBars[0].time / 1000 : (parquetBars[0].time / 1000);
                        let latestParquet = coreBars.length > 0 ? coreBars[coreBars.length - 1].time / 1000 : (parquetBars[parquetBars.length - 1].time / 1000);
                        
                        finalBars = coreBars;
                        
                        // LEFT GAP: Fetch Deep History if TV wants older data than Parquet has
                        if (rawFrom < earliestParquet && window.FyersAPI) {
                            try {
                                DFLog.info('getBars', `Fetching LEFT GAP from Fyers: ${rawFrom} to ${earliestParquet}`);
                                let leftBars = await window.FyersAPI.getDeepHistory(fyersSymbol, resolution, rawFrom, earliestParquet);
                                leftBars = alignFyersDwmTime(Array.isArray(leftBars) ? leftBars : (leftBars.data || []), resolution);
                                finalBars = leftBars.concat(finalBars);
                            } catch(e) { DFLog.error('getBars', 'Left gap fetch failed', e); }
                        }
                        
                        // RIGHT GAP: Fetch Recent History if TV wants newer data than Parquet has (Fixes missing days before today!)
                        if (rawTo > latestParquet && window.FyersAPI) {
                            try {
                                DFLog.info('getBars', `Fetching RIGHT GAP from Fyers: ${latestParquet} to ${rawTo}`);
                                let rightBars = await window.FyersAPI.getHistory(fyersSymbol, resolution, latestParquet, rawTo);
                                rightBars = alignFyersDwmTime(rightBars, resolution);
                                finalBars = finalBars.concat(rightBars);
                            } catch(e) { DFLog.error('getBars', 'Right gap fetch failed', e); }
                        }
                    }
                }
            }
            
            // 4. If DuckDB returned absolutely nothing for this range
            let isEnd = false;
            if (!duckdbHit && window.FyersAPI) {
                DFLog.info('getBars', `No Parquet data found for range. Falling back to Fyers Deep History.`);
                let res = await window.FyersAPI.getDeepHistory(fyersSymbol, resolution, rawFrom, rawTo);
                let deepBars = Array.isArray(res) ? res : (res.data || []);
                isEnd = res.isEnd || false;
                
                finalBars = alignFyersDwmTime(deepBars, resolution);
            }

            // 5. Final Deduplication and Time Filtering (Bulletproof Pipeline)
            if (finalBars.length > 0) {
                // TradingView strictly requires bars to NOT exceed rawTo
                finalBars = finalBars.filter(b => b.time <= rawTo * 1000);
                
                // Pure deduplication by exact timestamp (Parquet + Fyers overlap perfectly deduplicated)
                const uniqueMap = new Map();
                for (let b of finalBars) {
                    uniqueMap.set(b.time, b);
                }
                
                let cleanBars = Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time);
                
                DFLog.info('getBars', `Returning ${cleanBars.length} beautifully stitched bars`);
                return safeHistoryCallback(cleanBars, onHistoryCallback, resolution);
            }
            
            return onHistoryCallback([], { noData: isEnd || true });

        } catch (error) {
            if (conn) { try { await conn.close(); } catch (_) {} }
            DFLog.error('getBars', `Error for ${symbolInfo.name}`, error);
            onHistoryCallback([], { noData: true });
        }
    },

    """

new_content = content[:start_idx] + new_getBars + content[end_idx:]

with open('public/datafeed.js', 'w') as f:
    f.write(new_content)

print("Successfully replaced getBars")
