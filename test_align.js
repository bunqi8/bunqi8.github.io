function alignFyersDwmTime(bars, resolution) {
    if (resolution && (resolution.includes('D') || resolution.includes('W') || resolution.includes('M'))) {
        bars.forEach(b => {
            const d = new Date(b.time);
            d.setUTCHours(0, 0, 0, 0);
            b.time = d.getTime();
        });
        const unique = new Map();
        bars.forEach(b => unique.set(b.time, b));
        return Array.from(unique.values()).sort((a,b) => a.time - b.time);
    }
    return bars;
}
console.log(alignFyersDwmTime([{time: 1780285500000}, {time: 1780285500000}], '1D'));
