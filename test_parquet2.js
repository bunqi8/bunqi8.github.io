const arrowResult = [
    { time: 1780285500000, open: 1 },
    { time: 1780285500000, open: 2 }
];
function arrowToTVBars(arrowResult, resolution = '') {
    const bars = [];
    const seenTimes = new Set();
    for (const row of arrowResult) {
        let t = Number(row.time);
        t -= 19800000;
        if (resolution && (resolution.includes('D') || resolution.includes('W') || resolution.includes('M'))) {
            const d = new Date(t);
            d.setUTCHours(0, 0, 0, 0);
            t = d.getTime();
        }
        if (seenTimes.has(t)) continue;
        seenTimes.add(t);
        bars.push({time: t});
    }
    return bars;
}
console.log(arrowToTVBars(arrowResult, '1D'));
