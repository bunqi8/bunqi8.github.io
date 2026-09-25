import re

with open('public/fyers_api.js', 'r') as f:
    code = f.read()

# 1. Update initCacheDB to create deep_history
db_logic = """
            const request = indexedDB.open('fyers_cache_db', 2);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('history')) {
                    db.createObjectStore('history', { keyPath: 'cacheKey' });
                }
                if (!db.objectStoreNames.contains('deep_history')) {
                    db.createObjectStore('deep_history', { keyPath: 'cacheKey' });
                }
            };
"""
code = re.sub(r'const request = indexedDB\.open\(\'fyers_cache_db\', 1\);\n\s+request\.onupgradeneeded = \(e\) => \{\n\s+const db = e\.target\.result;\n\s+if \(\!db\.objectStoreNames\.contains\(\'history\'\)\) \{\n\s+db\.createObjectStore\(\'history\', \{ keyPath: \'cacheKey\' \}\);\n\s+\}\n\s+\};', db_logic.strip('\n'), code)


# 2. Add getDeepHistory method
deep_hist_logic = """
    async getDeepHistory(symbol, resolution, from, to) {
        if (!this.token) return [];
        
        // Fyers Limits
        let maxDays = 100;
        if (resolution === '1D' || resolution === 'D') maxDays = 366;
        else if (resolution.includes('S')) maxDays = 30;
        
        let actualFrom = from;
        const maxRangeSec = maxDays * 24 * 60 * 60;
        if (to - from > maxRangeSec) {
            actualFrom = to - maxRangeSec;
        }
        
        const cacheKey = `${symbol}_${resolution}_${actualFrom}_${to}`;
        const db = await this.dbPromise;
        const cached = await new Promise(r => {
            const tx = db.transaction('deep_history', 'readonly');
            const req = tx.objectStore('deep_history').get(cacheKey);
            req.onsuccess = () => r(req.result);
            req.onerror = () => r(null);
        });
        
        // 30-day cache (2592000000 ms)
        if (cached && Date.now() - cached.timestamp < 2592000000) {
            return cached.data;
        }

        const datef = new Date(actualFrom * 1000).toISOString().split('T')[0];
        const datet = new Date(to * 1000).toISOString().split('T')[0];
        
        const url = `https://api-t1.fyers.in/data/history?symbol=${symbol}&resolution=${resolution}&date_format=1&range_from=${datef}&range_to=${datet}`;
        
        try {
            const res = await fetch(url, { headers: { 'Authorization': this.token } });
            const data = await res.json();
            if (data.s === 'ok' && data.candles) {
                const bars = data.candles.map(c => ({
                    time: c[0] * 1000,
                    open: c[1],
                    high: c[2],
                    low: c[3],
                    close: c[4],
                    volume: c[5]
                }));
                
                const tx = db.transaction('deep_history', 'readwrite');
                tx.objectStore('deep_history').put({ cacheKey, data: bars, timestamp: Date.now() });
                
                return bars;
            } else if (data.code === -300 || (data.message && data.message.toLowerCase().includes('token'))) {
                this.isConnected = false;
                this.token = null;
                localStorage.removeItem('fyers_token');
                alert("Fyers Deep History: Token expired. Please re-authenticate via Broker button.");
            }
            return [];
        } catch (e) {
            console.error("Fyers deep history error:", e);
            return [];
        }
    }
"""

code = code.replace("connectWebSocket() {", deep_hist_logic + "\n    connectWebSocket() {")

with open('public/fyers_api.js', 'w') as f:
    f.write(code)
