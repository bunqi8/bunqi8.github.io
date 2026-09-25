import re

with open('public/datafeed.js', 'r') as f:
    code = f.read()

# Add a strict force-zeroing inside getBars before returning
force_zeroing = """
            if (bars.length > 0) {
                // FORCE ZEROING JUST IN CASE (Nuclear option)
                if (resolution && (resolution.toString().includes('D') || resolution.toString().includes('W') || resolution.toString().includes('M'))) {
                    const unique = new Map();
                    bars.forEach(b => {
                        const d = new Date(b.time);
                        d.setUTCHours(0, 0, 0, 0);
                        b.time = d.getTime();
                        unique.set(b.time, b);
                    });
                    bars = Array.from(unique.values()).sort((a,b) => a.time - b.time);
                }
                
                await conn.close();
                DFLog.info('getBars', `Returning ${bars.length} bars to TV`);
                onHistoryCallback(bars, { noData: false });
                return;
            }
"""

code = re.sub(r'            if \(bars\.length > 0\) \{\n                await conn\.close\(\);\n                DFLog\.info\(\'getBars\', `Returning \$\{bars\.length\} bars to TV`\);\n                onHistoryCallback\(bars, \{ noData: false \}\);\n                return;\n            \}', force_zeroing.strip('\n'), code)


with open('public/datafeed.js', 'w') as f:
    f.write(code)
