import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

old_func = """function arrowToTVBars(arrowResult, resolution = '') {
    const bars = [];
    for (const row of arrowResult) {
        let t = Number(row.time);
        
        // TradingView requires Daily (1D, 1W) bars to be aligned exactly to 00:00:00 UTC
        // The HuggingFace daily parquets have timestamps at 09:15 IST (03:45 UTC).
        if (resolution && (resolution.includes('D') || resolution.includes('W') || resolution.includes('M'))) {
            const d = new Date(t);
            d.setUTCHours(0, 0, 0, 0);
            t = d.getTime();
        }
        
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
}"""

new_func = """function arrowToTVBars(arrowResult, resolution = '') {
    const bars = [];
    const seenTimes = new Set();
    
    for (const row of arrowResult) {
        let t = Number(row.time);
        
        // TradingView requires Daily (1D, 1W) bars to be aligned exactly to 00:00:00 UTC
        // The HuggingFace daily parquets have timestamps at 09:15 IST (03:45 UTC).
        if (resolution && (resolution.includes('D') || resolution.includes('W') || resolution.includes('M'))) {
            const d = new Date(t);
            d.setUTCHours(0, 0, 0, 0);
            t = d.getTime();
        }
        
        // TradingView FATAL crashes if it receives duplicate timestamps.
        // Overlapping parquet files might yield identical timestamps with slightly different volume ticks.
        // We MUST enforce strict strict chronological deduplication.
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
}"""

js = js.replace(old_func, new_func)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

