import re

with open("public/datafeed.js", "r") as f:
    code = f.read()

helper = """
function safeHistoryCallback(bars, cb, resolution) {
    let safeBars = bars;
    if (resolution && (resolution.toString().includes('D') || resolution.toString().includes('W') || resolution.toString().includes('M') || resolutionToSuffix(resolution) === 'D')) {
        const unique = new Map();
        safeBars.forEach(b => {
            let tNum = Number(b.time);
            const d = new Date(tNum);
            d.setUTCHours(0, 0, 0, 0);
            b.time = d.getTime();
            unique.set(b.time, b);
        });
        safeBars = Array.from(unique.values()).sort((a,b) => a.time - b.time);
    }
    
    const dedupedBars = [];
    let lastTime = -1;
    for (let b of safeBars) {
        if (b.time > lastTime) {
            dedupedBars.push(b);
            lastTime = b.time;
        }
    }
    
    cb(dedupedBars, { noData: dedupedBars.length === 0 });
}
"""

if "safeHistoryCallback" not in code:
    code = code.replace("function arrowToTVBars", helper + "\nfunction arrowToTVBars")

# Remove nuclear zeroing blocks
code = re.sub(r'// NUCLEAR ZEROING FOR TV CRASH.*?bars = Array\.from\(unique\.values\(\)\)\.sort\(\(a,b\) => a\.time - b\.time\);\s+}', '', code, flags=re.DOTALL)
code = re.sub(r'if \(resolution && \(resolution\.toString\(\)\.includes\(\'D\'\).*?latestBars = Array\.from\(unique\.values\(\)\)\.sort\(\(a,b\) => a\.time - b\.time\);\s+}', '', code, flags=re.DOTALL)
code = re.sub(r'if \(resolution && \(resolution\.toString\(\)\.includes\(\'D\'\).*?olderBars = Array\.from\(unique\.values\(\)\)\.sort\(\(a,b\) => a\.time - b\.time\);\s+}', '', code, flags=re.DOTALL)

# Replace the callbacks
code = code.replace("onHistoryCallback(bars, { noData: false });", "safeHistoryCallback(bars, onHistoryCallback, resolution);")
code = code.replace("onHistoryCallback(latestBars, { noData: false });", "safeHistoryCallback(latestBars, onHistoryCallback, resolution);")
code = code.replace("onHistoryCallback(olderBars, { noData: false });", "safeHistoryCallback(olderBars, onHistoryCallback, resolution);")
code = code.replace("onHistoryCallback(deepBars, { noData: false });", "safeHistoryCallback(deepBars, onHistoryCallback, resolution);")

with open("public/datafeed.js", "w") as f:
    f.write(code)

