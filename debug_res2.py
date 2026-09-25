import re

with open('public/datafeed.js', 'r') as f:
    code = f.read()

old_block = """
            if (bars.length > 0) {
                // DEBUG TRACE
                DFLog.warn('getBars', 'DEBUG: First two bars returning to TV: ' + JSON.stringify(bars.slice(0, 2)));
                
                await conn.close();
                DFLog.info('getBars', `Returning ${bars.length} bars to TV`);
                onHistoryCallback(bars, { noData: false });
                return;
            }
"""

new_block = """
            if (bars.length > 0) {
                // NUCLEAR ZEROING FOR TV CRASH
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

code = code.replace(old_block.strip('\n'), new_block.strip('\n'))

with open('public/datafeed.js', 'w') as f:
    f.write(code)
