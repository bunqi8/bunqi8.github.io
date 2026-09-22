// -----------------------------------------------------------------------
// Custom Datafeed Architecture
// HF Parquet / GitHub CSV Fallback with Polling
// -----------------------------------------------------------------------

const configurationData = {
    supported_resolutions: [
        '1S', '5S', '10S', '15S', '30S', '45S', 
        '1', '2', '3', '5', '10', '15', '30', '45', 
        '60', '120', '180', '240', 
        '1D', '1W', '1M', '3M', '6M', '12M'
    ],
    exchanges: [{ value: 'CUSTOM', name: 'Custom', desc: 'Custom Datafeed' }],
    symbols_types: [{ name: 'Crypto', value: 'crypto'}],
};

const HF_BASE_URL = "https://huggingface.co/datasets/deep776/fyers-market-data/resolve/main/NSE_NIFTY50_INDEX/option_data/parquet/NSE_NIFTY50_INDEX_20260915_121432/";


// Structured Datafeed Logger
const DFLogger = {
    log: (method, msg) => {
        const time = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`%c[${time}] [Datafeed::${method}]`, 'color: #2962FF; font-weight: bold;', msg);
    },
    warn: (method, msg, data = '') => {
        const time = new Date().toISOString().split('T')[1].split('.')[0];
        console.warn(`%c[${time}] [Datafeed::${method}]`, 'color: #FF9800; font-weight: bold;', msg, data);
    },
    error: (method, msg, err) => {
        const time = new Date().toISOString().split('T')[1].split('.')[0];
        console.error(`%c[${time}] [Datafeed::${method}]`, 'color: #F44336; font-weight: bold;', msg, err);
    }
};

const Datafeed = {
    onReady: (callback) => {
        setTimeout(() => callback({
            supported_resolutions: ['5S', '15S', '30S', '1', '5', '15', '30', '60', '120', '240', '1D', '1W', '1M'],
            supports_marks: false,
            supports_timescale_marks: false,
            supports_time: true
        }));
    },
    searchSymbols: (userInput, exchange, symbolType, onResultReadyCallback) => {
        // We will implement dynamic options chain scanning here later.
        // For now, return a default mock.
        onResultReadyCallback([]);
    },
    resolveSymbol: (symbolName, onSymbolResolvedCallback, onResolveErrorCallback) => {
        // Define the symbol metadata based on the name
        // Example symbol: "NIFTY50-INDEX" or "NIFTY2691524100CE"
        const symbolInfo = {
            name: symbolName,
            full_name: symbolName,
            description: symbolName,
            type: symbolName.includes('INDEX') ? 'index' : 'option',
            exchange: 'NSE',
            session: '24x7', // Crypto/24x7 for testing
            timezone: 'Asia/Kolkata',
            minmov: 1,
            pricescale: 100,
            has_intraday: true,
            has_daily: true,
            has_weekly_and_monthly: true,
            supported_resolutions: ['5S', '15S', '30S', '1', '5', '15', '30', '60', '120', '240', '1D', '1W', '1M'],
            
            // Provide exact multipliers for the Parquet files we actually have on the server!
            // TV will request these exactly. For anything else (like 15m), TV will request 5m and aggregate it.
            intraday_multipliers: ['1', '5', '60'], 
            has_seconds: true,
            seconds_multipliers: ['5'],
            
            volume_precision: 0,
            data_status: 'streaming'
        };
        setTimeout(() => onSymbolResolvedCallback(symbolInfo));
    },
    getBars: async (symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) => {
        const { from, to, countBack, firstDataRequest } = periodParams;
        DFLogger.log('getBars', `Requesting ${symbolInfo.name} | Res: ${resolution} | Range: ${from} -> ${to}`);
        
        if (!window.db) {
            return onErrorCallback("DuckDB not initialized yet");
        }

        try {
            // Route the exact resolution to its corresponding Parquet file on Hugging Face
            let fileSuffix = "1"; 
            
            if (resolution === '5') {
                fileSuffix = "5";
            } else if (resolution === '60') {
                fileSuffix = "60";
            } else if (resolution === '1') {
                fileSuffix = "1";
            } else if (resolution.includes('S')) {
                fileSuffix = "5S";
            } else if (resolution.includes('D') || resolution.includes('W') || resolution.includes('M')) {
                fileSuffix = "D";
            }
            
            // Construct the Parquet URL
            const fileName = `${symbolInfo.name}_${fileSuffix}_2026-06-07_to_2026-09-15.parquet`;
            let fileUrl = HF_BASE_URL + fileName;

            DFLogger.log('getBars', `Querying Parquet file: ${fileUrl}`);
            
            const conn = await window.db.connect();
            let results;
            
            window.fileBufferCache = window.fileBufferCache || {};
            
            const executeQuery = async (url) => {
                const virtualFileName = 'mem_' + btoa(url).replace(/[^a-zA-Z0-9]/g, '').substring(0, 15) + '.parquet';
                
                if (!window.fileBufferCache[url]) {
                    DFLogger.log('getBars', `Downloading primary Parquet chunk to ArrayBuffer cache...`);
                    const response = await fetch(url);
                    if (!response.ok) throw new Error("HTTP " + response.status);
                    const buffer = await response.arrayBuffer();
                    window.fileBufferCache[url] = new Uint8Array(buffer);
                    
                    // Register the file natively into the DuckDB virtual filesystem permanently
                    await window.db.registerFileBuffer(virtualFileName, window.fileBufferCache[url]);
                }
                
                const res = await conn.query(`
                    SELECT 
                        time * 1000 as time,
                        open,
                        high,
                        low,
                        close,
                        volume
                    FROM read_parquet('${virtualFileName}')
                    WHERE time >= ${from} AND time <= ${to}
                    ORDER BY time ASC
                `);
                
                return res;
            };

            try {
                results = await executeQuery(fileUrl);
            } catch (err) {
                // If it fails, check if we can fallback between 'D' and '1D' naming conventions
                if (fileSuffix === 'D') {
                    DFLogger.warn('getBars', `_D_ suffix failed, attempting fallback to _1D_...`);
                    const fallbackName = `${symbolInfo.name}_1D_2026-06-07_to_2026-09-15.parquet`;
                    fileUrl = HF_BASE_URL + fallbackName;
                    results = await executeQuery(fileUrl);
                } else if (fileSuffix === '1D') {
                    DFLogger.warn('getBars', `_1D_ suffix failed, attempting fallback to _D_...`);
                    const fallbackName = `${symbolInfo.name}_D_2026-06-07_to_2026-09-15.parquet`;
                    fileUrl = HF_BASE_URL + fallbackName;
                    results = await executeQuery(fileUrl);
                } else {
                    throw err; // Not a daily timeframe, or no fallback available
                }
            }
            
            await conn.close();

            const bars = [];
            for (const row of results) {
                bars.push({
                    time: Number(row.time),
                    open: Number(row.open),
                    high: Number(row.high),
                    low: Number(row.low),
                    close: Number(row.close),
                    volume: Number(row.volume)
                });
            }

            if (bars.length === 0) {
                if (firstDataRequest) {
                    try {
                        DFLogger.warn('getBars', `Primary query returned 0 rows! Initiating forceful backwards fetch logic.`);
                        
                        // Extract "2026-09-15" from "NIFTY50-INDEX_5_2026-06-07_to_2026-09-15.parquet"
                        const dateMatch = fileUrl.match(/to_(\d{4}-\d{2}-\d{2})\.parquet/);
                        let maxTime = Math.floor(Date.now() / 1000); // fallback to today
                        
                        if (dateMatch && dateMatch[1]) {
                            // Parse 2026-09-15 as UTC midnight and convert to seconds
                            maxTime = Math.floor(new Date(dateMatch[1] + "T23:59:59Z").getTime() / 1000);
                        }
                        
                        DFLogger.log('getBars', `Parsed Max time: ${maxTime} (${dateMatch[1]}). Forcefully fetching the latest ${countBack || 300} bars!`);
                        
                        // We strictly constrain the WHERE clause to the last 30 days of the maxTime.
                        // This prevents DuckDB-WASM from trying to load and sort the entire 150MB file in memory!
                        // Parse resolution to seconds (default 5m = 300s)
                        let resSeconds = 300;
                        if (resolution === '1') resSeconds = 60;
                        else if (resolution === '5') resSeconds = 300;
                        else if (resolution === '15') resSeconds = 900;
                        else if (resolution === '30') resSeconds = 1800;
                        else if (resolution === '60') resSeconds = 3600;
                        else if (resolution.includes('D')) resSeconds = 86400;
                        else if (resolution.includes('S')) resSeconds = parseInt(resolution.replace('S','')) || 5;

                        // Multiply by countBack and add a 3x buffer for weekends/holidays
                        const lookbackSeconds = (countBack || 300) * resSeconds * 3;
                        const safeMinTime = maxTime - lookbackSeconds;

                        const virtualFileName = 'mem_' + btoa(fileUrl).replace(/[^a-zA-Z0-9]/g, '').substring(0, 15) + '.parquet';
                        
                        if (!window.fileBufferCache[fileUrl]) {
                            DFLogger.log('getBars', `Downloading fallback Parquet chunk to ArrayBuffer cache...`);
                            const response = await fetch(fileUrl);
                            if (!response.ok) throw new Error("HTTP " + response.status);
                            const buffer = await response.arrayBuffer();
                            window.fileBufferCache[fileUrl] = new Uint8Array(buffer);
                            await window.db.registerFileBuffer(virtualFileName, window.fileBufferCache[fileUrl]);
                        }

                        const forceQuery = `
                            SELECT 
                                time * 1000 as time,
                                open,
                                high,
                                low,
                                close,
                                volume
                            FROM read_parquet('${virtualFileName}')
                            WHERE time <= ${maxTime} AND time >= ${safeMinTime}
                        `;
                        const forceResults = await conn.query(forceQuery);
                        
                        if (forceResults.length > 0) {
                            let forceBars = [];
                            for (const row of forceResults) {
                                forceBars.push({
                                    time: Number(row.time),
                                    open: Number(row.open),
                                    high: Number(row.high),
                                    low: Number(row.low),
                                    close: Number(row.close),
                                    volume: Number(row.volume)
                                });
                            }
                            
                            // Sort in JS to guarantee correctness
                            forceBars.sort((a, b) => a.time - b.time);
                            
                            // Keep only the latest 'countBack' bars
                            const limitBars = countBack || 300;
                            if (forceBars.length > limitBars) {
                                forceBars = forceBars.slice(forceBars.length - limitBars);
                            }
                            DFLogger.log('getBars', `Force fetch success! Injecting ${forceBars.length} older bars into chart.`);
                            onHistoryCallback(forceBars, { noData: false });
                            return;
                        }
                    } catch (e) {
                        DFLogger.error('getBars', `Failed to forcefully fetch older bars`, e);
                    }
                }
                onHistoryCallback([], { noData: true });
                return;
            }

            onHistoryCallback(bars, { noData: false });
        } catch (error) {
            DFLogger.error('getBars', `DuckDB Parquet Error for ${symbolInfo.name}: File likely doesn't exist for this timeframe.`, error);
            // Instead of crashing the chart engine with onErrorCallback, we tell it there's simply no data.
            onHistoryCallback([], { noData: true });
        }
    },

    subscribeBars: (symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) => {
        DFLogger.log('subscribeBars', `Method call with subscriberUID: ${subscriberUID}`);
        
        // =================================================================
        // LIVE POLLING LOGIC HERE
        // Set an interval to fetch the HF/GitHub file every 5 seconds.
        // If the newest timestamp in the file is > the last drawn bar,
        // we call onRealtimeCallback(newBar) to instantly update the chart!
        // =================================================================
        
        /*
        setInterval(async () => {
            const newBar = await fetchLatestDataFromHF();
            onRealtimeCallback(newBar);
        }, 5000);
        */
    },

    unsubscribeBars: (subscriberUID) => {
        DFLogger.log('unsubscribeBars', `Method call with subscriberUID: ${subscriberUID}`);
        // Clear the polling interval here when the user switches pairs
    }
};
