import re

with open('public/cache.js', 'r') as f:
    js = f.read()

old_log = """            if (outdated.length > 0) {
                console.log(`[SyncManager] Found ${outdated.length} outdated folders. Starting slow background sync...`);
                this._processQueue(outdated);
            }"""

new_log = """            if (outdated.length > 0) {
                console.log(`[SyncManager] Found ${outdated.length} outdated folders. Starting prioritized background sync...`);
                
                let activeBase = window.ACTIVE_BASE_TICKER;
                if (!activeBase) {
                    try {
                        const chartSym = window.tvWidget ? window.tvWidget.activeChart().symbol() : '';
                        const possible = [...new Set(outdated.map(o => o.remote.baseTicker))];
                        activeBase = possible.find(p => p.includes(chartSym.split('-')[0]) || p.includes(chartSym.replace(/\\d.*/, '')));
                    } catch(e) {}
                }
                
                outdated.sort((a, b) => {
                    const aIsActive = a.remote.baseTicker === activeBase;
                    const bIsActive = b.remote.baseTicker === activeBase;
                    
                    if (aIsActive && !bIsActive) return -1;
                    if (!aIsActive && bIsActive) return 1;
                    
                    return b.remote.dateStr.localeCompare(a.remote.dateStr);
                });
                
                this._processQueue(outdated);
            }"""

js = js.replace(old_log, new_log)

with open('public/cache.js', 'w') as f:
    f.write(js)

