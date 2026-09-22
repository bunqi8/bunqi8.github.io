// -----------------------------------------------------------------------
// Custom Datafeed Architecture
// DuckDB-WASM Parquet Datafeed with in-memory ArrayBuffer caching
// -----------------------------------------------------------------------

const configurationData = {
    supported_resolutions: [
        '5S', '15S', '30S',
        '1', '5', '15', '30',
        '60', '120', '240',
        '1D', '1W', '1M'
    ],
    exchanges: [{ value: 'CUSTOM', name: 'Custom', desc: 'Custom Datafeed' }],
    symbols_types: [{ name: 'Crypto', value: 'crypto'}],
};

const HF_BASE_URL = "https://huggingface.co/datasets/deep776/fyers-market-data/resolve/main/NSE_NIFTY50_INDEX/option_data/parquet/NSE_NIFTY50_INDEX_20260915_121432/";

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
    if (resolution === '1')  return '1';
    if (resolution === '5')  return '5';
    if (resolution === '60') return '60';
    if (resolution.includes('S')) return '5S';
    if (resolution.includes('D') || resolution.includes('W') || resolution.includes('M')) return 'D';
    // For 15, 30 etc. — TV will aggregate from intraday_multipliers (5m or 1m)
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

    searchSymbols: (userInput, exchange, symbolType, onResultReadyCallback) => {
        onResultReadyCallback([]);
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
            has_weekly_and_monthly: true,
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
            // 1. Determine which Parquet file to query
            const fileSuffix = resolutionToSuffix(resolution);
            const fileName = `${symbolInfo.name}_${fileSuffix}_2026-06-07_to_2026-09-15.parquet`;
            let fileUrl = HF_BASE_URL + fileName;

            // 2. Ensure the Parquet file is downloaded & registered in DuckDB VFS
            let vfsName;
            try {
                vfsName = await ensureParquetLoaded(fileUrl);
            } catch (err) {
                // Try D ↔ 1D fallback for daily files
                if (fileSuffix === 'D') {
                    DFLog.warn('getBars', `_D_ not found, trying _1D_...`);
                    fileUrl = HF_BASE_URL + `${symbolInfo.name}_1D_2026-06-07_to_2026-09-15.parquet`;
                    vfsName = await ensureParquetLoaded(fileUrl);
                } else if (fileSuffix === '1D') {
                    DFLog.warn('getBars', `_1D_ not found, trying _D_...`);
                    fileUrl = HF_BASE_URL + `${symbolInfo.name}_D_2026-06-07_to_2026-09-15.parquet`;
                    vfsName = await ensureParquetLoaded(fileUrl);
                } else {
                    throw err;
                }
            }

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

            // 4. If we got enough bars, we're done
            if (bars.length >= countBack || bars.length > 0) {
                await conn.close();
                DFLog.info('getBars', `Returning ${bars.length} bars to TV`);
                onHistoryCallback(bars, { noData: false });
                return;
            }

            // 5. Range returned 0 bars. We need to find where data actually exists.
            //    Per TV docs: "countBack has higher priority than from" — so we
            //    return the latest `countBack` bars from the entire file.
            DFLog.warn('getBars', `0 bars in requested range. Querying latest ${countBack} bars from entire file...`);

            const latestSQL = `
                SELECT time * 1000 AS time, open, high, low, close, volume
                FROM read_parquet('${vfsName}')
                ORDER BY time DESC
                LIMIT ${countBack}
            `;
            DFLog.debug('getBars', `SQL: ORDER BY time DESC LIMIT ${countBack}`);

            let latestBars;
            try {
                const latestResult = await conn.query(latestSQL);
                latestBars = arrowToTVBars(latestResult);
            } catch (wasmErr) {
                // DuckDB-WASM sometimes crashes on ORDER BY DESC + LIMIT with large files.
                // Fallback: fetch ALL rows and sort/slice in JavaScript.
                DFLog.warn('getBars', `ORDER BY DESC LIMIT crashed in WASM, falling back to JS sort...`, wasmErr);
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
                // Reverse to ascending order (TV requires ASC)
                latestBars.reverse();
                DFLog.info('getBars', `Returning ${latestBars.length} bars (latest available data). Time range: ${new Date(latestBars[0].time).toISOString()} → ${new Date(latestBars[latestBars.length - 1].time).toISOString()}`);
                onHistoryCallback(latestBars, { noData: false });
                return;
            }

            // 6. Truly no data in the file at all
            DFLog.warn('getBars', `File has no data at all. Returning noData:true`);
            onHistoryCallback([], { noData: true });

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
