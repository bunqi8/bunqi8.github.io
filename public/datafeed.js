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
        console.log(`[getBars] Requesting ${symbolInfo.name} at ${resolution} from ${from} to ${to}`);
        
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

            console.log(`[getBars] Querying DuckDB: ${fileUrl}`);
            
            const conn = await window.db.connect();
            let results;
            
            const executeQuery = async (url) => {
                return await conn.query(`
                    SELECT 
                        time * 1000 as time,
                        open,
                        high,
                        low,
                        close,
                        volume
                    FROM read_parquet('${url}')
                    WHERE time >= ${from} AND time <= ${to}
                    ORDER BY time ASC
                `);
            };

            try {
                results = await executeQuery(fileUrl);
            } catch (err) {
                // If it fails, check if we can fallback between 'D' and '1D' naming conventions
                if (fileSuffix === 'D') {
                    console.log(`[getBars] _D_ failed, attempting fallback to _1D_...`);
                    const fallbackName = `${symbolInfo.name}_1D_2026-06-07_to_2026-09-15.parquet`;
                    fileUrl = HF_BASE_URL + fallbackName;
                    results = await executeQuery(fileUrl);
                } else if (fileSuffix === '1D') {
                    console.log(`[getBars] _1D_ failed, attempting fallback to _D_...`);
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
                        console.log(`[getBars] No data found. Extracting MAX(time) via Parquet metadata to avoid WASM OOM...`);
                        const maxResult = await conn.query(`SELECT MAX(time) as max_time FROM read_parquet('${fileUrl}')`);
                        if (!maxResult || maxResult.length === 0 || !maxResult[0].max_time) {
                            throw new Error("Could not determine max_time from Parquet");
                        }
                        const maxTime = Number(maxResult[0].max_time);
                        
                        console.log(`[getBars] Max time is ${maxTime}. Forcefully fetching the latest ${countBack || 300} bars!`);
                        
                        // We strictly constrain the WHERE clause to the last 30 days of the maxTime.
                        // This prevents DuckDB-WASM from trying to load and sort the entire 150MB file in memory (which causes Out-Of-Bounds Memory panics)!
                        const limitBars = countBack || 300;
                        const forceQuery = `
                            SELECT 
                                time * 1000 as time,
                                open,
                                high,
                                low,
                                close,
                                volume
                            FROM read_parquet('${fileUrl}')
                            WHERE time <= ${maxTime} AND time >= ${maxTime - 2592000}
                            ORDER BY time DESC
                            LIMIT ${limitBars}
                        `;
                        const forceResults = await conn.query(forceQuery);
                        
                        if (forceResults.length > 0) {
                            const forceBars = [];
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
                            // DuckDB returned them DESC, TradingView expects ASC
                            forceBars.reverse();
                            console.log(`[getBars] Successfully fetched ${forceBars.length} older bars. Injecting directly into chart!`);
                            onHistoryCallback(forceBars, { noData: false });
                            return;
                        }
                    } catch (e) {
                        console.warn("[getBars] Failed to forcefully fetch older bars", e);
                    }
                }
                onHistoryCallback([], { noData: true });
                return;
            }

            onHistoryCallback(bars, { noData: false });
        } catch (error) {
            console.warn(`[getBars] DuckDB Parquet Error for ${symbolInfo.name}: File likely doesn't exist for this timeframe.`, error);
            // Instead of crashing the chart engine with onErrorCallback, we tell it there's simply no data.
            onHistoryCallback([], { noData: true });
        }
    },

    subscribeBars: (symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) => {
        console.log('[subscribeBars]: Method call with subscriberUID:', subscriberUID);
        
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
        console.log('[unsubscribeBars]: Method call with subscriberUID:', subscriberUID);
        // Clear the polling interval here when the user switches pairs
    }
};
