import re

with open('public/options_chain.js', 'r') as f:
    code = f.read()

fab_block_old = """
        if (lastStrikes.length >= 2) {
            const gap = lastStrikes[1] - lastStrikes[0];
            const minStrike = lastStrikes[0] - (gap * 15);
            const maxStrike = lastStrikes[lastStrikes.length - 1] + (gap * 15);
            
            // Generate Fyers symbols based on expiry.expiryCode
            const base = expiry.baseTicker.replace('NSE_', '').replace('BSE_', '').replace('_INDEX', '');
            const exchange = expiry.baseTicker.startsWith('BSE') ? 'BSE' : 'NSE';
            // Fyers Option format: NSE:NIFTY26SEP25000CE
            const yy = expiry.dateStr.slice(2,4); // from yyyymmdd e.g. 20260924 -> 26
            
            for (let s = minStrike; s <= maxStrike; s += gap) {
                strikes.add(s);
                const strikeStr = s.toString();
                symbols[`${s}_CE`] = `${exchange}:${base}${yy}${expiry.expiryCode}${strikeStr}CE|LIVE`;
                symbols[`${s}_PE`] = `${exchange}:${base}${yy}${expiry.expiryCode}${strikeStr}PE|LIVE`;
            }
        } else {
            tbody.innerHTML = '<div style="padding: 40px; text-align: center; color: red;">Failed to determine strike gap from previous expiry.</div>';
            return;
        }
"""

fab_block_new = """
        if (lastStrikes.length >= 2) {
            const gap = lastStrikes[1] - lastStrikes[0];
            const base = expiry.baseTicker.replace('NSE_', '').replace('BSE_', '').replace('_INDEX', '');
            const exchange = expiry.baseTicker.startsWith('BSE') ? 'BSE' : 'NSE';
            const yy = expiry.dateStr.slice(2,4); 
            
            tbody.innerHTML = '<div style="padding: 40px; text-align: center;">Calculating limits from 6-month history...</div>';
            
            (async () => {
                let minL = lastStrikes[0] - (gap * 15);
                let maxH = lastStrikes[lastStrikes.length - 1] + (gap * 15);
                
                try {
                    while(!window.db) { await new Promise(r => setTimeout(r, 100)); }
                    
                    let indexD = lastValid.files.find(f => f.path.includes('-INDEX_D_') || f.path.includes('-INDEX_1_'));
                    if (indexD) {
                        const indexUrl = `https://huggingface.co/datasets/deep776/fyers-market-data/resolve/main/${indexD.path}`;
                        const vfsName = await window.ensureParquetLoaded(indexUrl);
                        const conn = await window.db.connect();
                        
                        // Use max date in parquet as proxy for "now" for 6 month lookback to support simulated history
                        const metaRes = await conn.query(`SELECT MAX(time) as t FROM read_parquet('${vfsName}')`);
                        const maxT = metaRes.toArray()[0].t || Math.floor(Date.now() / 1000);
                        const sixMonthsAgo = maxT - (180 * 24 * 60 * 60);
                        
                        const result = await conn.query(`SELECT MIN(low) as minL, MAX(high) as maxH FROM read_parquet('${vfsName}') WHERE time >= ${sixMonthsAgo}`);
                        const rows = result.toArray();
                        if (rows.length > 0 && rows[0].minL && rows[0].maxH) {
                            minL = Math.floor(rows[0].minL / gap) * gap;
                            maxH = Math.ceil(rows[0].maxH / gap) * gap;
                            
                            // Add 5% buffer padding for extreme intraday spikes on new expiries
                            minL = Math.floor((minL * 0.95) / gap) * gap;
                            maxH = Math.ceil((maxH * 1.05) / gap) * gap;
                        }
                        await conn.close();
                    }
                } catch(e) {
                    console.error("Failed 6-month limit check, fallback to static gap math", e);
                }
                
                for (let s = minL; s <= maxH; s += gap) {
                    strikes.add(s);
                    const strikeStr = s.toString();
                    symbols[`${s}_CE`] = `${exchange}:${base}${yy}${expiry.expiryCode}${strikeStr}CE|LIVE`;
                    symbols[`${s}_PE`] = `${exchange}:${base}${yy}${expiry.expiryCode}${strikeStr}PE|LIVE`;
                }
                
                const sortedStrikes = Array.from(strikes).sort((a,b) => a - b);
                
                // Immediately render the skeleton
                renderTable(sortedStrikes, symbols, expiry.atmPrice || null);
                
                // Kick off live ATM fetch
                if (window.FyersAPI) {
                    try {
                        const symbol = `${exchange}:${base}-INDEX`;
                        const today = new Date();
                        today.setHours(0,0,0,0);
                        const bars = await window.FyersAPI.getHistory(symbol, '1', today.getTime()/1000, Date.now()/1000);
                        if (bars && bars.length > 0) {
                            const newAtmPrice = bars[bars.length - 1].close;
                            expiry.atmPrice = newAtmPrice;
                            if (currentExpiry && currentExpiry.dateStr === expiry.dateStr) {
                                renderTable(sortedStrikes, symbols, newAtmPrice);
                            }
                        }
                    } catch (e) { console.error("Live ATM fetch failed", e); }
                }
            })();
            
            return;
        } else {
            tbody.innerHTML = '<div style="padding: 40px; text-align: center; color: red;">Failed to determine strike gap from previous expiry.</div>';
            return;
        }
"""

code = code.replace(fab_block_old.strip('\n'), fab_block_new.strip('\n'))

with open('public/options_chain.js', 'w') as f:
    f.write(code)
