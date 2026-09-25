import re

with open('public/datafeed.js', 'r') as f:
    code = f.read()

# Add nuclear zeroing to olderBars return
older_old = """
                if (olderBars.length > 0) {
                    olderBars.reverse(); // TV requires ascending order
                    DFLog.info('getBars', `Returning ${olderBars.length} older bars. Range: ${new Date(olderBars[0].time).toISOString()} → ${new Date(olderBars[olderBars.length - 1].time).toISOString()}`);
                    onHistoryCallback(olderBars, { noData: false });
                    return;
                }
"""
older_new = """
                if (olderBars.length > 0) {
                    olderBars.reverse(); // TV requires ascending order
                    
                    if (resolution && (resolution.toString().includes('D') || resolution.toString().includes('W') || resolution.toString().includes('M'))) {
                        const unique = new Map();
                        olderBars.forEach(b => {
                            const d = new Date(b.time);
                            d.setUTCHours(0, 0, 0, 0);
                            b.time = d.getTime();
                            unique.set(b.time, b);
                        });
                        olderBars = Array.from(unique.values()).sort((a,b) => a.time - b.time);
                    }
                    
                    DFLog.info('getBars', `Returning ${olderBars.length} older bars. Range: ${new Date(olderBars[0].time).toISOString()} → ${new Date(olderBars[olderBars.length - 1].time).toISOString()}`);
                    onHistoryCallback(olderBars, { noData: false });
                    return;
                }
"""
code = code.replace(older_old.strip('\n'), older_new.strip('\n'))

# Add nuclear zeroing to latestBars return
latest_old = """
                if (latestBars.length > 0) {
                    latestBars.reverse(); // TV requires ascending order
                    DFLog.info('getBars', `Returning ${latestBars.length} latest bars. Range: ${new Date(latestBars[0].time).toISOString()} → ${new Date(latestBars[latestBars.length - 1].time).toISOString()}`);
                    onHistoryCallback(latestBars, { noData: false });
                    return;
                }
"""
latest_new = """
                if (latestBars.length > 0) {
                    latestBars.reverse(); // TV requires ascending order
                    
                    if (resolution && (resolution.toString().includes('D') || resolution.toString().includes('W') || resolution.toString().includes('M'))) {
                        const unique = new Map();
                        latestBars.forEach(b => {
                            const d = new Date(b.time);
                            d.setUTCHours(0, 0, 0, 0);
                            b.time = d.getTime();
                            unique.set(b.time, b);
                        });
                        latestBars = Array.from(unique.values()).sort((a,b) => a.time - b.time);
                    }
                    
                    DFLog.info('getBars', `Returning ${latestBars.length} latest bars. Range: ${new Date(latestBars[0].time).toISOString()} → ${new Date(latestBars[latestBars.length - 1].time).toISOString()}`);
                    onHistoryCallback(latestBars, { noData: false });
                    return;
                }
"""
code = code.replace(latest_old.strip('\n'), latest_new.strip('\n'))

with open('public/datafeed.js', 'w') as f:
    f.write(code)
