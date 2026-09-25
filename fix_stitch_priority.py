import re

with open('public/datafeed.js', 'r') as f:
    code = f.read()

# Replace the merge logic to prioritize DuckDB (bars) over Fyers (fyersBars)
stitch_logic = """
                    if (fyersBars.length > 0) {
                        // Merge, sort, and strictly deduplicate by time (DuckDB/Parquet takes precedence)
                        const duckdbTimes = new Set(bars.map(b => b.time));
                        const filteredFyers = fyersBars.filter(b => !duckdbTimes.has(b.time));
                        bars = bars.concat(filteredFyers).sort((a,b) => a.time - b.time);
                    }
"""

code = re.sub(r'                    if \(fyersBars\.length > 0\) \{\n                        // Merge, sort, and strictly deduplicate by time \(Fyers takes precedence for live day\)\n                        const fyersTimes = new Set\(fyersBars\.map\(b => b\.time\)\);\n                        bars = bars\.filter\(b => !fyersTimes\.has\(b\.time\)\)\.concat\(fyersBars\)\.sort\(\(a,b\) => a\.time - b\.time\);\n                    \}', stitch_logic.strip('\n'), code)

with open('public/datafeed.js', 'w') as f:
    f.write(code)
