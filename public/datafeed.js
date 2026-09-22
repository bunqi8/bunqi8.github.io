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
        DFLog.debug('cache', `HIT: ${url.split('/').pop()}`);
        return parquetCache[url].vfsName;
    }

    DFLog.info('cache', `MISS — downloading: ${url.split('/').pop()}`);
    const t0 = performance.now();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const dt = (performance.now() - t0).toFixed(0);
    DFLog.info('cache', `Downloaded ${(bytes.length / 1024).toFixed(1)} KB in ${dt}ms`);

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
function arrowToTVBars(arrowResult) {
    const bars = [];
    for (const row of arrowResult) {
        bars.push({
            time:   Number(row.time),
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
                            const desc = `NIFTY Futures (${exp.day} ${exp.monthLabel} ${exp.year})`;
                            results.push({
                                symbol: futSymbol,
                                full_name: futSymbol,
                                description: desc,
                                exchange: "NSE",
                                type: "futures"
                            });
                        }
                    }
                    
                    const match = filename.match(/NIFTY.+?(\d{5})([CP]E)_/);
                    if (match) {
                        const symbol = filename.split('_')[0];
                        if (symbol.includes(query) && !results.find(r => r.symbol === symbol)) {
                            const strike = parseInt(match[1], 10);
                            const type = match[2];
                            const typeDesc = type === 'CE' ? 'CALL' : 'PUT';
                            const desc = `NIFTY ${strike} ${typeDesc} (${exp.day} ${exp.monthLabel} ${exp.year})`;
                            
                            results.push({
                                symbol: symbol,
                                full_name: symbol,
                                description: desc,
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
    },

    resolveSymbol: (symbolName, onSymbolResolvedCallback, onResolveErrorCallback) => {
        const symbolInfo = {
            name: symbolName,
            full_name: symbolName,
            description: symbolName,
            type: symbolName.includes('INDEX') ? 'index' : 'option',
            exchange: 'NSE',
            session: '24x7',
            timezone: 'Asia/Kolkata',
            minmov: 1,
            pricescale: 100,
            has_intraday: true,
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
    getBars: async (symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) => {
        const { from, to, countBack, firstDataRequest } = periodParams;
        DFLog.info('getBars', `${symbolInfo.name} | res=${resolution} | from=${from} to=${to} | countBack=${countBack} | first=${firstDataRequest}`);

        if (!window.db) {
            return onErrorCallback("DuckDB not initialized yet");
        }

        let conn;
        try {
            // Wait for Options Chain to populate files
            while (!window.ACTIVE_EXPIRY_FILES) {
                await new Promise(r => setTimeout(r, 100));
            }
            
            // 1. Determine which Parquet file to query
            const fileSuffix = resolutionToSuffix(resolution);
            
            // Search the global active expiry folder files
            let targetFileName = `${symbolInfo.name}_${fileSuffix}_`;
            let fileObj = null;
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
            if (!fileObj && window.SyncManager) {
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
            
            if (!fileObj) {
                DFLog.warn('getBars', `No Parquet file found for ${targetFileName}`);
                return onHistoryCallback([], { noData: true });
            }
            
            const fileUrl = `https://huggingface.co/datasets/deep776/fyers-market-data/resolve/main/${fileObj.path}`;

            // 2. Ensure the Parquet file is downloaded & registered in DuckDB VFS
            let vfsName = await ensureParquetLoaded(fileUrl);

            // 3. Open a connection and run the range query
            conn = await window.db.connect();

            const rangeSQL = `
                SELECT time * 1000 AS time, open, high, low, close, volume
                FROM read_parquet('${vfsName}')
                WHERE time >= ${from} AND time < ${to}
                ORDER BY time ASC
            `;
            DFLog.debug('getBars', `SQL: WHERE time >= ${from} AND time < ${to}`);
            const rangeResult = await conn.query(rangeSQL);
            let bars = arrowToTVBars(rangeResult);
            DFLog.info('getBars', `Range query returned ${bars.length} bars`);

            // 4. If we got bars in range, return them
            if (bars.length > 0) {
                await conn.close();
                DFLog.info('getBars', `Returning ${bars.length} bars to TV`);
                onHistoryCallback(bars, { noData: false });
                return;
            }

            // 5. Range returned 0 bars — two different strategies:
            //
            //    A) firstDataRequest=true (initial chart load):
            //       TV needs SOMETHING to display. Return the latest countBack
            //       bars from wherever they exist in the file.
            //
            //    B) firstDataRequest=false (user scrolling left):
            //       TV is looking for data BEFORE `from`. Return older bars
            //       that come before the requested range. If none exist,
            //       return noData:true to stop further backward requests.

            if (firstDataRequest) {
                // Strategy A: Initial load — get the newest countBack bars
                DFLog.warn('getBars', `First request, 0 bars in range. Getting latest ${countBack} bars from file...`);

                let latestBars;
                try {
                    const latestSQL = `
                        SELECT time * 1000 AS time, open, high, low, close, volume
                        FROM read_parquet('${vfsName}')
                        ORDER BY time DESC
                        LIMIT ${countBack}
                    `;
                    const latestResult = await conn.query(latestSQL);
                    latestBars = arrowToTVBars(latestResult);
                } catch (wasmErr) {
                    // DuckDB-WASM may crash on ORDER BY DESC + LIMIT.
                    // Fallback: fetch ALL rows and sort/slice in JavaScript.
                    DFLog.warn('getBars', `WASM ORDER BY crashed, falling back to JS sort...`);
                    const allSQL = `
                        SELECT time * 1000 AS time, open, high, low, close, volume
                        FROM read_parquet('${vfsName}')
                    `;
                    const allResult = await conn.query(allSQL);
                    const allBars = arrowToTVBars(allResult);
                    DFLog.info('getBars', `Fetched all ${allBars.length} bars, sorting in JS...`);
                    allBars.sort((a, b) => b.time - a.time);
                    latestBars = allBars.slice(0, countBack);
                }

                await conn.close();
                conn = null;

                if (latestBars.length > 0) {
                    latestBars.reverse(); // TV requires ascending order
                    DFLog.info('getBars', `Returning ${latestBars.length} latest bars. Range: ${new Date(latestBars[0].time).toISOString()} → ${new Date(latestBars[latestBars.length - 1].time).toISOString()}`);
                    onHistoryCallback(latestBars, { noData: false });
                    return;
                }

                DFLog.warn('getBars', `File has no data at all.`);
                onHistoryCallback([], { noData: true });
                return;

            } else {
                // Strategy B: Scroll-back — get bars BEFORE `from`
                DFLog.info('getBars', `Scroll-back, 0 bars in range. Querying ${countBack} bars before timestamp ${from}...`);

                let olderBars;
                try {
                    const olderSQL = `
                        SELECT time * 1000 AS time, open, high, low, close, volume
                        FROM read_parquet('${vfsName}')
                        WHERE time < ${from}
                        ORDER BY time DESC
                        LIMIT ${countBack}
                    `;
                    const olderResult = await conn.query(olderSQL);
                    olderBars = arrowToTVBars(olderResult);
                } catch (wasmErr) {
                    DFLog.warn('getBars', `WASM ORDER BY crashed on scroll-back, falling back to JS...`);
                    const allSQL = `
                        SELECT time * 1000 AS time, open, high, low, close, volume
                        FROM read_parquet('${vfsName}')
                        WHERE time < ${from}
                    `;
                    const allResult = await conn.query(allSQL);
                    const allBars = arrowToTVBars(allResult);
                    allBars.sort((a, b) => b.time - a.time);
                    olderBars = allBars.slice(0, countBack);
                }

                await conn.close();
                conn = null;

                if (olderBars.length > 0) {
                    olderBars.reverse(); // TV requires ascending order
                    DFLog.info('getBars', `Returning ${olderBars.length} older bars. Range: ${new Date(olderBars[0].time).toISOString()} → ${new Date(olderBars[olderBars.length - 1].time).toISOString()}`);
                    onHistoryCallback(olderBars, { noData: false });
                    return;
                }

                // No more older data exists in the file
                DFLog.info('getBars', `No older data exists. Returning noData:true to stop backward requests.`);
                onHistoryCallback([], { noData: true });
                return;
            }

        } catch (error) {
            if (conn) { try { await conn.close(); } catch (_) {} }
            DFLog.error('getBars', `Error for ${symbolInfo.name}`, error);
            onHistoryCallback([], { noData: true });
        }
    },

    subscribeBars: (symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) => {
        DFLog.info('subscribeBars', `UID: ${subscriberUID}`);
    },

    unsubscribeBars: (subscriberUID) => {
        DFLog.info('unsubscribeBars', `UID: ${subscriberUID}`);
    }
};
