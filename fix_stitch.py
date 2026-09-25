import re

with open('public/datafeed.js', 'r') as f:
    code = f.read()

# Replace the merge logic
stitch_logic = """
                    if (fyersBars.length > 0) {
                        // Merge, sort, and strictly deduplicate by time (Fyers takes precedence for live day)
                        const fyersTimes = new Set(fyersBars.map(b => b.time));
                        bars = bars.filter(b => !fyersTimes.has(b.time)).concat(fyersBars).sort((a,b) => a.time - b.time);
                    }
"""

code = re.sub(r'                    if \(fyersBars\.length > 0\) \{\n                        // Merge and sort\n                        bars = bars\.concat\(fyersBars\)\.sort\(\(a,b\) => a\.time - b\.time\);\n                    \}', stitch_logic.strip('\n'), code)

with open('public/datafeed.js', 'w') as f:
    f.write(code)
