import re

with open('public/datafeed.js', 'r') as f:
    code = f.read()

# 1. Fix missing resolution in arrowToTVBars calls
code = code.replace("olderBars = arrowToTVBars(olderResult);", "olderBars = arrowToTVBars(olderResult, resolution);")

# 2. Add a helper function to zero out DWM bars for Fyers
zero_helper = """
function alignFyersDwmTime(bars, resolution) {
    if (resolution && (resolution.includes('D') || resolution.includes('W') || resolution.includes('M'))) {
        bars.forEach(b => {
            const d = new Date(b.time);
            d.setUTCHours(0, 0, 0, 0);
            b.time = d.getTime();
        });
        // Deduplicate Fyers bars internally just in case aligning created dupes
        const unique = new Map();
        bars.forEach(b => unique.set(b.time, b));
        return Array.from(unique.values()).sort((a,b) => a.time - b.time);
    }
    return bars;
}
"""

code = code.replace("function arrowToTVBars", zero_helper + "\nfunction arrowToTVBars")

# 3. Apply alignFyersDwmTime to fyersBars and deepBars
code = code.replace("let fyersBars = await window.FyersAPI.getHistory(fyersSymbol, resolution, Math.max(rawFrom, startOfTodayUTC), rawTo);", "let fyersBars = await window.FyersAPI.getHistory(fyersSymbol, resolution, Math.max(rawFrom, startOfTodayUTC), rawTo);\n                    fyersBars = alignFyersDwmTime(fyersBars, resolution);")

code = code.replace("const deepBars = await window.FyersAPI.getDeepHistory(fyersSymbol, resolution, rawFrom, rawTo);", "let deepBars = await window.FyersAPI.getDeepHistory(fyersSymbol, resolution, rawFrom, rawTo);\n                    deepBars = alignFyersDwmTime(deepBars, resolution);")

with open('public/datafeed.js', 'w') as f:
    f.write(code)
