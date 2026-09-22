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

const Datafeed = {
    onReady: (callback) => {
        console.log('[onReady]: Method call');
        setTimeout(() => callback(configurationData));
    },

    searchSymbols: (userInput, exchange, symbolType, onResultReadyCallback) => {
        console.log('[searchSymbols]: Method call');
        // For now, return a dummy search result
        onResultReadyCallback([
            {
                symbol: 'XAUUSD',
                full_name: 'XAUUSD',
                description: 'Gold Spot / U.S. Dollar',
                exchange: 'OANDA',
                type: 'crypto'
            }
        ]);
    },

    resolveSymbol: (symbolName, onSymbolResolvedCallback, onResolveErrorCallback) => {
        console.log('[resolveSymbol]: Method call', symbolName);
        const symbolInfo = {
            ticker: symbolName,
            name: symbolName,
            description: 'Gold Spot / U.S. Dollar',
            type: 'crypto',
            session: '24x7',
            timezone: 'Etc/UTC',
            exchange: 'OANDA',
            minmov: 1,
            pricescale: 1000,
            has_intraday: true,
            has_seconds: true,
            has_ticks: true,
            tick_multipliers: ['1', '10', '100', '1000'],
            seconds_multipliers: ['1', '5', '10', '15', '30', '45'],
            intraday_multipliers: ['1', '2', '3', '5', '10', '15', '30', '45', '60', '120', '180', '240'],
            has_daily: true,
            has_weekly_and_monthly: true,
            supported_resolutions: configurationData.supported_resolutions,
            volume_precision: 2,
            data_status: 'streaming',
        };
        setTimeout(() => onSymbolResolvedCallback(symbolInfo));
    },

    getBars: async (symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) => {
        const { from, to, firstDataRequest } = periodParams;
        console.log('[getBars]: Method call', symbolInfo, resolution, from, to);
        
        try {
            // =================================================================
            // FALLBACK LOGIC HERE
            // 1. Try to fetch from Hugging Face (Parquet parser needed)
            // 2. If fail, fetch from GitHub (CSV)
            // =================================================================
            
            // Generate 100 days of realistic-looking dummy data ending today
            const bars = [];
            const endDate = new Date();
            let currentPrice = 60000;
            
            for (let i = 100; i >= 0; i--) {
                const date = new Date(endDate);
                date.setDate(date.getDate() - i);
                
                // Random walk
                const open = currentPrice;
                const close = open + (Math.random() - 0.48) * 1000; 
                const high = Math.max(open, close) + Math.random() * 500;
                const low = Math.min(open, close) - Math.random() * 500;
                
                bars.push({
                    time: date.getTime(),
                    open: open,
                    high: high,
                    low: low,
                    close: close,
                    volume: Math.random() * 1000
                });
                
                currentPrice = close;
            }
            
            // Filter by requested time period
            const filteredBars = bars.filter(b => b.time >= from * 1000 && b.time <= to * 1000);

            if (filteredBars.length === 0) {
                onHistoryCallback([], { noData: true });
                return;
            }

            onHistoryCallback(filteredBars, { noData: false });
        } catch (error) {
            console.error('[getBars]: Get error', error);
            onErrorCallback(error);
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
