import re

with open('public/datafeed.js', 'r') as f:
    code = f.read()

debug_inject = """
            if (bars.length > 0) {
                // DEBUG TRACE
                DFLog.warn('getBars', 'DEBUG: First two bars returning to TV: ' + JSON.stringify(bars.slice(0, 2)));
                
                await conn.close();
                DFLog.info('getBars', `Returning ${bars.length} bars to TV`);
                onHistoryCallback(bars, { noData: false });
                return;
            }
"""

code = code.replace("""
            // 4. If we got bars in range, return them
            if (bars.length > 0) {
                await conn.close();
                DFLog.info('getBars', `Returning ${bars.length} bars to TV`);
                onHistoryCallback(bars, { noData: false });
                return;
            }
""".strip('\n'), debug_inject.strip('\n'))

with open('public/datafeed.js', 'w') as f:
    f.write(code)
