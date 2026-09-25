import fs from 'fs';

// Mock arrowResult
const arrowResult = [
    { time: BigInt(1780285500), open: 1, high: 2, low: 0, close: 1.5, volume: 100 },
    { time: BigInt(1780285500), open: 1, high: 2, low: 0, close: 1.5, volume: 200 }
];

function arrowToTVBars(arrowResult, resolution = '') {
    const bars = [];
    const seenTimes = new Set();
    
    for (const row of arrowResult) {
        let t = Number(row.time);
        
        // Convert pseudo-UTC back to true UTC by subtracting 5 hours 30 mins
        t -= 19800000;
        
        if (resolution && (resolution.includes('D') || resolution.includes('W') || resolution.includes('M'))) {
            const d = new Date(t);
            d.setUTCHours(0, 0, 0, 0);
            t = d.getTime();
        }
        
        if (seenTimes.has(t)) continue;
        seenTimes.add(t);
        
        bars.push({
            time:   t,
            open:   row.open,
            high:   row.high,
            low:    row.low,
            close:  row.close,
            volume: row.volume || 0
        });
    }
    return bars;
}

const bars = arrowToTVBars(arrowResult, '1D');
console.log(bars);
