import re

with open("public/datafeed.js", "r") as f:
    code = f.read()

# Define the stitch logic
stitch_logic = """
                    // --- STITCH FYERS DATA IF DUCKDB RETURNED A BOUNDARY GAP ---
                    const earliestDuckTimeMs = latestBars[0].time;
                    const requestedFromMs = from * 1000;
                    if (earliestDuckTimeMs > requestedFromMs && window.FyersAPI && (symbolInfo.type === 'index' || symbolInfo.type === 'futures')) {
                        const gapTo = Math.floor(earliestDuckTimeMs / 1000) - 1;
                        let fyersSymbol = `${symbolInfo.exchange}:${symbolInfo.name}`;
                        if (symbolInfo.type === 'futures' && window.HF_EXPIRIES) {
                            const baseTickerMatch = symbolInfo.name.match(/^([A-Z]+)\\\\d/);
                            if (baseTickerMatch) {
                                const baseTicker = baseTickerMatch[1] + '_INDEX';
                                const baseExpiries = window.HF_EXPIRIES.filter(e => e.baseTicker.includes(baseTicker) && e.expiryType === 'M' && !e.isDummy);
                                if (baseExpiries.length > 0) {
                                    baseExpiries.sort((a,b) => a.dateObjValue - b.dateObjValue);
                                    const now = Date.now();
                                    let activeExp = baseExpiries.find(e => now < (e.dateObjValue + 86400000));
                                    if (!activeExp) activeExp = baseExpiries[baseExpiries.length - 1];
                                    const yy = activeExp.dateStr.slice(2,4);
                                    const base = activeExp.baseTicker.replace('NSE_', '').replace('BSE_', '').replace('_INDEX', '');
                                    fyersSymbol = `${symbolInfo.exchange}:${base}${yy}${activeExp.expiryCode}FUT`;
                                }
                            }
                        }
                        
                        try {
                            DFLog.info('getBars', `Parquet gap detected from ${new Date(requestedFromMs).toISOString()} to ${new Date(earliestDuckTimeMs).toISOString()}. Stitching Fyers...`);
                            let res = await window.FyersAPI.getDeepHistory(fyersSymbol, resolution, from, gapTo);
                            let deepBars = Array.isArray(res) ? res : (res.data || []);
                            deepBars = alignFyersDwmTime(deepBars, resolution);
                            
                            const resString = resolution ? resolution.toString() : '';
                            const sfx = resolution ? resolutionToSuffix(resolution) : '';
                            const isDWM = resString.includes('D') || resString.includes('W') || resString.includes('M') || sfx === 'D';
                            
                            if (isDWM) deepBars = deepBars.filter(b => b.time < earliestDuckTimeMs);
                            
                            if (deepBars.length > 0) {
                                DFLog.info('getBars', `Stitched ${deepBars.length} Fyers bars to DuckDB result.`);
                                latestBars = deepBars.concat(latestBars);
                            }
                        } catch (e) {
                            DFLog.error('getBars', 'Fyers stitching failed', e);
                        }
                    }
                    // -------------------------------------------------------------
"""

# Inject into latestBars block
code = code.replace("DFLog.info('getBars', `Returning ${latestBars.length} latest bars", stitch_logic.strip() + "\\n                    DFLog.info('getBars', `Returning ${latestBars.length} latest bars")

# Do the same for olderBars (Strategy B)
stitch_older_logic = stitch_logic.replace('latestBars', 'olderBars')

code = code.replace("DFLog.info('getBars', `Returning ${olderBars.length} older bars", stitch_older_logic.strip() + "\\n                    DFLog.info('getBars', `Returning ${olderBars.length} older bars")

# Fix the regex output double backslash
code = code.replace("\\\\\\\\d", "\\\\d")

with open("public/datafeed.js", "w") as f:
    f.write(code)

