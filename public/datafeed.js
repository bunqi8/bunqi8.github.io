// -----------------------------------------------------------------------
// Custom Datafeed Architecture
// DuckDB-WASM Parquet Datafeed with in-memory ArrayBuffer caching
// -----------------------------------------------------------------------

const configurationData = {
    supported_resolutions: [
        // Seconds (Smallest data is 5S, so 1S is mathematically impossible)
        '5S', '10S', '15S', '30S', '45S',
        // Minutes
        '1', '2', '3', '5', '10', '15', '30', '45',
        // Hours
        '60', '120', '180', '240',
        // Days, Weeks, Months
        '1D', '1W', '1M', '3M', '6M', '12M'
    ],
    exchanges: [{ value: 'CUSTOM', name: 'Custom', desc: 'Custom Datafeed' }],
    symbols_types: [{ name: 'Crypto', value: 'crypto'}],
};

// -----------------------------------------------------------------------
// Structured Logger with color-coded output
// -----------------------------------------------------------------------
const DFLog = {
    _ts: () => new Date().toISOString().split('T')[1].slice(0, 12),
    info:  (tag, msg) => console.log(`%c[${DFLog._ts()}] [DF::${tag}]`, 'color:#2962FF;font-weight:bold', msg),
    warn:  (tag, msg) => console.warn(`%c[${DFLog._ts()}] [DF::${tag}]`, 'color:#FF9800;font-weight:bold', msg),
    error: (tag, msg, e) => console.error(`%c[${DFLog._ts()}] [DF::${tag}]`, 'color:#F44336;font-weight:bold', msg, e),
    debug: (tag, msg) => console.debug(`%c[${DFLog._ts()}] [DF::${tag}]`, 'color:#9E9E9E', msg),
};

// -----------------------------------------------------------------------
// In-memory Parquet file cache & DuckDB VFS registration
// Each URL is downloaded exactly ONCE, then all queries run locally.
// -----------------------------------------------------------------------
const parquetCache = {};

async function ensureParquetLoaded(url) {
    if (parquetCache[url]) {
        DFLog.debug('cache', `HIT (Memory): ${url.split('/').pop()}`);
        return parquetCache[url].vfsName;
    }

    const t0 = performance.now();
    let buffer = null;
    let isDiskHit = false;

    // Check IndexedDB first
    if (window.SyncManager) {
        buffer = await window.SyncManager.getParquetFile(url);
    }

    if (buffer) {
        isDiskHit = true;
        DFLog.info('cache', `HIT (IndexedDB): ${url.split('/').pop()} in ${(performance.now() - t0).toFixed(0)}ms`);
    } else {
        DFLog.info('cache', `MISS — downloading: ${url.split('/').pop()}`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        buffer = await response.arrayBuffer();
        
        // Save to IndexedDB asynchronously
        if (window.SyncManager) {
            // We MUST create a copy using slice(0) because DuckDB's registerFileBuffer 
            // will detach the original ArrayBuffer by transferring it to WASM memory.
            window.SyncManager.saveParquetFile(url, buffer.slice(0)).catch(e => console.error("Failed to save parquet cache", e));
        }
    }

    const bytes = new Uint8Array(buffer);
    if (!isDiskHit) {
        const dt = (performance.now() - t0).toFixed(0);
        DFLog.info('cache', `Downloaded ${(bytes.length / 1024).toFixed(1)} KB in ${dt}ms`);
    }

    // Deterministic VFS filename from URL hash
    const vfsName = 'pq_' + simpleHash(url) + '.parquet';
    await window.db.registerFileBuffer(vfsName, bytes);
    parquetCache[url] = { vfsName, bytes };
    DFLog.info('cache', `Registered in DuckDB VFS as: ${vfsName}`);
    return vfsName;
}

window.ensureParquetLoaded = ensureParquetLoaded;

function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
}

// -----------------------------------------------------------------------
// Resolution → Parquet file suffix mapping
// -----------------------------------------------------------------------
function resolutionToSuffix(resolution) {
    // 1. If exact parquet is available, use it (5S, 1, 5, 60, D)
    if (['1', '5', '60', 'D', '5S'].includes(resolution)) return resolution;
    
    // 2. For seconds, use smallest second available (5S)
    if (resolution.includes('S')) return '5S';
    
    // 3. For daily and higher, use daily (D)
    if (resolution.includes('D') || resolution.includes('W') || resolution.includes('M')) return 'D';
    
    // 4. For minutes, use smallest minute available (1)
    return '1';
}

// -----------------------------------------------------------------------
// Convert DuckDB Arrow result rows to TradingView bar objects
// DuckDB-WASM returns Apache Arrow Tables. int64 columns come as BigInt.
// -----------------------------------------------------------------------

function alignFyersDwmTime(bars, resolution) {
    if (resolution && (resolution.includes('D') || resolution.includes('W') || resolution.includes('M'))) {
        const unique = new Map();
        bars.forEach(b => {
            const d = new Date(b.time);
            d.setUTCHours(0, 0, 0, 0);
            b.time = d.getTime();
            
            if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
                unique.set(b.time, b);
            }
        });
        return Array.from(unique.values()).sort((a,b) => a.time - b.time);
    }
    return bars;
}





function safeHistoryCallback(bars, cb, resolution) {
    let safeBars = bars;
    const resString = resolution ? resolution.toString() : 'undefined';
    const sfx = resolution ? resolutionToSuffix(resolution) : 'undefined';
    const isDWM = resolution && (resString.includes('D') || resString.includes('W') || resString.includes('M') || sfx === 'D');
    
    if (isDWM) {
        const unique = new Map();
        safeBars.forEach(b => {
            let tNum = Number(b.time);
            const d = new Date(tNum);
            d.setUTCHours(0, 0, 0, 0);
            b.time = d.getTime();
            
            // PREVENT TRADINGVIEW SNAP BUG
            if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
                unique.set(b.time, b);
            }
        });
        safeBars = Array.from(unique.values()).sort((a,b) => a.time - b.time);
    }
    
    const dedupedBars = [];
    let lastTime = -1;
    for (let b of safeBars) {
        if (b.time > lastTime) {
            dedupedBars.push(b);
            lastTime = b.time;
        }
    }
    
    cb(dedupedBars, { noData: dedupedBars.length === 0 });
}




function arrowToTVBars(arrowResult, resolution = '') {
    const bars = [];
    const seenTimes = new Set();
    
    const resString = resolution ? resolution.toString() : '';
    const sfx = resolution ? resolutionToSuffix(resolution) : '';
    const isDWM = resString.includes('D') || resString.includes('W') || resString.includes('M') || sfx === 'D';
    
    for (const row of arrowResult) {
        let t = Number(row.time);
        
        if (isDWM) {
            // Daily/Weekly/Monthly Parquet files ALREADY have true 00:00:00 UTC timestamps.
            // DO NOT subtract 5.5 hours, otherwise it pushes Monday to Sunday!
            const d = new Date(t);
            d.setUTCHours(0, 0, 0, 0);
            t = d.getTime();
        } else {
            // Intraday Parquet files store "09:15 IST" as "09:15 UTC" (pseudo-UTC)
            // Subtract 5.5 hours to convert back to true UTC
            t -= 19800000;
        }
        
        if (seenTimes.has(t)) continue;
        seenTimes.add(t);
        
        bars.push({
            time:   t,
            open:   Number(row.open),
            high:   Number(row.high),
            low:    Number(row.low),
            close:  Number(row.close),
            volume: Number(row.volume),
        });
    }
    return bars;
}

// -----------------------------------------------------------------------
// THE DATAFEED
// -----------------------------------------------------------------------
const Datafeed = {
    onReady: (callback) => {
        setTimeout(() => callback({
            supported_resolutions: configurationData.supported_resolutions,
            supports_marks: false,
            supports_timescale_marks: false,
            supports_time: true,
        }));
    },

    searchSymbols: async (userInput, exchange, symbolType, onResultReadyCallback) => {
        const popMap = { 'NIFTY50':1, 'NIFTY':1, 'BANKNIFTY':2, 'SENSEX':3, 'FINNIFTY':4, 'BANKEX':5, 'MIDCPNIFTY':6, 'NIFTYNXT50':7, 'SX50':8 };
        let query = userInput.toUpperCase();
        const results = [];
        
        try {
            // If the search box is pre-filled with the exact current chart symbol (which happens when clicking the top-left symbol button),
            // treat it as an empty search so we can display all available Base Indices for easy switching!
            try {
                const chartSym = window.tvWidget ? window.tvWidget.activeChart().symbol() : '';
                if (query === chartSym) {
                    query = '';
                }
            } catch(e) {}

            const expiries = await window.SyncManager.getAllExpiries();
            
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
            }

        

        
            for (let exp of expiries) {
                
                for (let f of exp.files) {
                    const filename = f.path.split('/').pop();
                    
                    // Check for Index
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
                    
                    if (filename.includes('FUT_')) {
                        const futSymbol = filename.split('_')[0];
                        if (futSymbol.includes(query) && !results.find(r => r.symbol === futSymbol)) {
                            const baseName = futSymbol.replace(/\d{2}[A-Z]{3}FUT/, '');
                            let desc = `${baseName} Futures`;
                            const futMatch = futSymbol.match(/[A-Z]+(\d{2})([A-Z]{3})FUT/);
                            if (futMatch) {
                                desc = `${baseName} Futures (${futMatch[2]} 20${futMatch[1]})`;
                            }
                            
                            results.push({
                                symbol: futSymbol,
                                full_name: futSymbol,
                                description: desc,
                                exchange: (exp.baseTicker || "NSE_").split('_')[0],
                                type: "futures"
                            });
                        }
                    }
                    
                    const match = filename.match(/[A-Z]+.+?(\d{5})([CP]E)_/);
                    if (match) {
                        const symbol = filename.split('_')[0];
                        if (symbol.includes(query) && !results.find(r => r.symbol === symbol)) {
                            const strike = parseInt(match[1], 10);
                            const type = match[2];
                            const typeDesc = type === 'CE' ? 'CALL' : 'PUT';
                            const baseName = symbol.replace(/\d.*/, '');
                            const desc = `${baseName} ${strike} ${typeDesc} (${exp.day} ${exp.monthLabel} ${exp.year})`;
                            
                            results.push({
                                symbol: symbol,
                                full_name: symbol,
                                description: desc,
                                exchange: (exp.baseTicker || "NSE_").split('_')[0],
                                type: "option"
                            });
                        }
                    }
                }
            }
        } catch(e) {
            console.error("Search error", e);
        }
        
        results.sort((a, b) => {
            // 1. Type Priority (Index > Futures > Options)
            const typeScore = { 'index': 1, 'futures': 2, 'option': 3 };
            if (typeScore[a.type] !== typeScore[b.type]) {
                return typeScore[a.type] - typeScore[b.type];
            }
            
            // 2. Popularity Priority (NIFTY > BANKNIFTY > SENSEX ...)
            const baseA = a.symbol.replace(/\d.*/, '').replace('-INDEX', '');
            const baseB = b.symbol.replace(/\d.*/, '').replace('-INDEX', '');
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
    },

    resolveSymbol: (symbolName, onSymbolResolvedCallback, onResolveErrorCallback) => {
        let exchange = 'NSE';
        let session = '0915-1530'; // Standard NSE/BSE trading hours
        
        let isLive = false;
        let actualName = symbolName;
        if (symbolName.includes('|LIVE')) {
            isLive = true;
            actualName = symbolName.split('|')[0];
        }
        
        if (actualName.includes('SENSEX') || actualName.includes('BANKEX')) {
            exchange = 'BSE';
        } else if (actualName.includes('CRUDE') || actualName.includes('GOLD') || actualName.includes('SILVER') || actualName.includes('NATURALGAS')) {
            exchange = 'MCX';
            session = '0900-2330'; // Standard MCX trading hours
        }

        const symbolInfo = {
            name: actualName,
            full_name: actualName,
            isLive: isLive,
            description: actualName,
            type: actualName.includes('INDEX') ? 'index' : (actualName.includes('FUT') ? 'futures' : 'option'),
            exchange: exchange,
            session: session,
            timezone: 'Asia/Kolkata',
            minmov: 1,
            pricescale: 100,
            has_intraday: true,
            has_empty_bars: false,
            has_daily: true,
            has_weekly_and_monthly: false,
            supported_resolutions: configurationData.supported_resolutions,
            intraday_multipliers: ['1', '5', '60'],
            has_seconds: true,
            seconds_multipliers: ['5'],
            volume_precision: 0,
            data_status: 'streaming',
        };
        setTimeout(() => onSymbolResolvedCallback(symbolInfo));
    },

    // ==================================================================
    // getBars — the core data-loading method
    //
    // Design decisions based on TradingView docs + DuckDB-WASM constraints:
    //
    // 1. TradingView says: "countBack has higher priority than from".
    //    So if the [from,to) range has no data, we MUST return the latest
    //    countBack bars from wherever they exist in the file.
    //
    // 2. DuckDB-WASM crashes with "memory access out of bounds" when
    //    running queries against HTTP-served Parquet files. To fix this,
    //    we download each Parquet file ONCE into an ArrayBuffer cache,
    //    mount it into DuckDB's Virtual File System, and query it locally.
    //
    // 3. We use a SINGLE code path for both "data in range" and "data
    //    not in range" scenarios. No separate "forceful fetch" path.
    // ==================================================================
    resolveParquetFiles: async (symbolInfo, resolution, qFrom, qTo) => {
        const fileSuffix = resolutionToSuffix(resolution);
        let allFiles = [];
        try {
            const expiries = await window.SyncManager.getAllExpiries();
            for (let exp of expiries) {
                for (let f of exp.files) {
                    const filename = f.path.split('/').pop();
                    
                    const dateMatch = filename.match(/_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})\.parquet/);
                    if (!dateMatch) continue;
                    
                    if (!filename.includes(`_${fileSuffix}_`)) {
                        if (fileSuffix === 'D' && filename.includes(`_1D_`)) {} 
                        else if (fileSuffix === '1D' && filename.includes(`_D_`)) {}
                        else continue;
                    }
                    
                    const fStart = new Date(dateMatch[1]).getTime() / 1000;
                    const fEnd = (new Date(dateMatch[2]).getTime() / 1000) + 86400;
                    
                    let isMatch = false;
                    let priority = 0;
                    
                    if (symbolInfo.type === 'futures') {
                        if (filename.startsWith(symbolInfo.name)) {
                            isMatch = true; priority = 10;
                        } else if (filename.includes('FUT_')) {
                            const prefix = symbolInfo.name.replace(/\d{2}[A-Z]{3}FUT/, '');
                            if (filename.startsWith(prefix)) {
                                isMatch = true; priority = 1;
                            }
                        }
                    } else if (symbolInfo.type === 'index') {
                        if (filename.startsWith(symbolInfo.name)) {
                            isMatch = true; priority = 10;
                        }
                    } else { // Option
                        if (filename.startsWith(symbolInfo.name)) {
                            isMatch = true; priority = 10;
                        }
                    }
                    
                    if (isMatch) {
                        if (!allFiles.find(x => x.path === f.path)) {
                            allFiles.push({ path: f.path, fStart, fEnd, priority, filename });
                        }
                    }
                }
            }
            
            // Files that intersect the requested range
            let intersecting = allFiles.filter(f => f.fEnd >= qFrom && f.fStart <= qTo);
            
            // If no intersection (e.g. asking for today, but latest data is 1 month ago),
            // find the newest files that are BEFORE qTo
            if (intersecting.length === 0) {
                let pastFiles = allFiles.filter(f => f.fStart <= qTo);
                if (pastFiles.length > 0) {
                    pastFiles.sort((a,b) => b.fEnd - a.fEnd); // Sort newest first
                    // Take the most recent block of files
                    const newestEnd = pastFiles[0].fEnd;
                    intersecting = pastFiles.filter(f => f.fEnd === newestEnd);
                }
            }
            
            intersecting.sort((a, b) => b.priority - a.priority || b.fEnd - a.fEnd);
            
            // Limit to top 4 files to prevent DuckDB OOM during UNION
            let selected = intersecting.slice(0, 4);
            
            // If we are looking for Futures, and the exact match didn't fill the quota,
            // we ALSO want to grab the next older future month so the user can scroll smoothly!
            // To do this, if we have less than 4 files, we can grab files that ended just before our selected files started.
            if (symbolInfo.type === 'futures' || symbolInfo.type === 'index') {
                if (selected.length > 0) {
                    let oldestStart = Math.min(...selected.map(f => f.fStart));
                    let olderFiles = allFiles.filter(f => f.fEnd <= oldestStart);
                    olderFiles.sort((a, b) => b.priority - a.priority || b.fEnd - a.fEnd);
                    for (let of of olderFiles) {
                        if (selected.length >= 4) break;
                        if (!selected.find(s => s.path === of.path)) {
                            selected.push(of);
                        }
                    }
                }
            }
            
            return selected.map(f => `https://huggingface.co/datasets/deep776/fyers-market-data/resolve/main/${f.path}`);
            
        } catch(e) {
            console.error("Resolve error", e);
            return [];
        }
    },

    getBars: async (symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) => {
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
                                let rightBars = await window.FyersAPI.getDeepHistory(fyersSymbol, resolution, latestParquet, rawTo);
                                rightBars = alignFyersDwmTime(Array.isArray(rightBars) ? rightBars : (rightBars.data || []), resolution);
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
                
                if (!window._lastBarTime) window._lastBarTime = {};
                const currentMax = window._lastBarTime[`${fyersSymbol}_${resolution}`] || 0;
                const batchMax = cleanBars[cleanBars.length - 1].time;
                if (batchMax > currentMax) {
                    window._lastBarTime[`${fyersSymbol}_${resolution}`] = batchMax;
                }
                
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

    subscribeBars: (symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) => {
        DFLog.info('subscribeBars', `UID: ${subscriberUID}`);
        if (!window.FyersAPI) return;
        
        let fyersSymbol = symbolInfo.name;
        if (!symbolInfo.isLive) {
            fyersSymbol = `${symbolInfo.exchange}:${symbolInfo.name}`;
        }
        
        if (!window._tvSubscribers) window._tvSubscribers = new Map();
        
        const resString = resolution ? resolution.toString() : '';
        const sfx = resolution ? resolutionToSuffix(resolution) : '';
        const isDWM = resString.includes('D') || resString.includes('W') || resString.includes('M') || sfx === 'D';
        
        const cb = (tick) => {
            let alignedTick = { ...tick };
            
            if (isDWM) {
                const d = new Date(alignedTick.time);
                d.setUTCHours(0, 0, 0, 0);
                alignedTick.time = d.getTime();
            }
            
            // Prevent TradingView backward time violations on stale weekend/closed quotes
            // Fyers often returns 00:00:00 UTC for exch_tm when the market is closed.
            const cacheKey = `${fyersSymbol}_${resolution}`;
            if (window._lastBarTime && window._lastBarTime[cacheKey]) {
                const lastTime = window._lastBarTime[cacheKey];
                if (alignedTick.time < lastTime) {
                    alignedTick.time = lastTime; // Snap stale ticks to the last known candle floor
                }
            }
            
            onRealtimeCallback(alignedTick);
        };
        window._tvSubscribers.set(subscriberUID, { symbol: fyersSymbol, cb });
        window.FyersAPI.subscribe(fyersSymbol, cb);
    },

    unsubscribeBars: (subscriberUID) => {
        DFLog.info('unsubscribeBars', `UID: ${subscriberUID}`);
        if (window._tvSubscribers && window._tvSubscribers.has(subscriberUID)) {
            const sub = window._tvSubscribers.get(subscriberUID);
            if (window.FyersAPI) window.FyersAPI.unsubscribe(sub.symbol, sub.cb);
            window._tvSubscribers.delete(subscriberUID);
        }
    }
};
