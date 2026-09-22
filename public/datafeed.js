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
            supported_resolutions: ['1', '5', '15', '30', '60', '1D'],
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
            has_weekly_and_monthly: false,
            supported_resolutions: ['1', '5', '15', '30', '60', '1D'],
            volume_precision: 0,
            data_status: 'streaming'
        };
        setTimeout(() => onSymbolResolvedCallback(symbolInfo));
    },
    getBars: async (symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) => {
        const { from, to, firstDataRequest } = periodParams;
        console.log(`[getBars] Requesting ${symbolInfo.name} at ${resolution} from ${from} to ${to}`);
        
        if (!window.db) {
            return onErrorCallback("DuckDB not initialized yet");
        }

        try {
            // Determine the timeframe suffix based on resolution
            let fileSuffix = "1"; // Default to 1-minute
            if (resolution === '1D') fileSuffix = "D";
            else if (resolution === '60') fileSuffix = "60";
            
            // Construct the Parquet URL
            const fileName = `${symbolInfo.name}_${fileSuffix}_2026-06-07_to_2026-09-15.parquet`;
            const fileUrl = HF_BASE_URL + fileName;

            console.log(`[getBars] Querying DuckDB: ${fileUrl}`);
            
            // Execute SQL query via DuckDB WASM
            const conn = await window.db.connect();
            
            // Note: The parquet file might have columns like: datetime, open, high, low, close, volume
            // We need to fetch rows where epoch time is between `from` and `to`
            // DuckDB automatically reads remote parquet files over HTTP using range requests!
            let results;
            try {
                // Try assuming 'time' is a TIMESTAMP or DATE
                const query = `
                    SELECT 
                        epoch(time) * 1000 as time,
                        open,
                        high,
                        low,
                        close,
                        volume
                    FROM read_parquet('${fileUrl}')
                    WHERE epoch(time) >= ${from} AND epoch(time) <= ${to}
                    ORDER BY time ASC
                `;
                results = await conn.query(query);
            } catch (err) {
                if (err.message && err.message.includes('epoch')) {
                    // Fallback: 'time' is likely already a UNIX epoch in seconds (INT/BIGINT)
                    const query2 = `
                        SELECT 
                            (time::BIGINT) * 1000 as time,
                            open,
                            high,
                            low,
                            close,
                            volume
                        FROM read_parquet('${fileUrl}')
                        WHERE time >= ${from} AND time <= ${to}
                        ORDER BY time ASC
                    `;
                    results = await conn.query(query2);
                } else {
                    throw err; // re-throw if it's a different error
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
