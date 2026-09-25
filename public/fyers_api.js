// Fyers Live Data & WebSocket Engine
// Fully decoupled and portable module for the frontend

class FyersEngine {
    constructor() {
        this.token = localStorage.getItem('fyers_token') || null;
        this.appId = null; // Can be parsed from token if JWT, or we require user to input it
        this.profileName = null;
        this.isConnected = false;
        
        // WebSocket state
        
        this.subscribers = new Map(); // symbol -> Set of callbacks
        this.reconnectAttempts = 0;
        this.maxReconnect = 5;
        this.wsUrl = 'wss://api-t1.fyers.in/data/quotes'; // standard endpoint, needs check
        
        // Ensure cache db is ready
        this.dbPromise = this.initCacheDB();
    }
    
    async initCacheDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('fyers_cache_db', 4);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('history')) {
                    db.createObjectStore('history', { keyPath: 'cacheKey' });
                }
                if (!db.objectStoreNames.contains('deep_history')) {
                    db.createObjectStore('deep_history', { keyPath: 'cacheKey' });
                }
                if (!db.objectStoreNames.contains('deep_history_ranges')) {
                    db.createObjectStore('deep_history_ranges', { keyPath: 'symbol_res' });
                }
                if (!db.objectStoreNames.contains('deep_history_bars')) {
                    const store = db.createObjectStore('deep_history_bars', { keyPath: 'id' });
                    store.createIndex('symbol_res', 'symbol_res', { unique: false });
                    store.createIndex('time', 'time', { unique: false });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    setToken(token) {
        this.token = token;
        localStorage.setItem('fyers_token', token);
    }
    
    async validateAndGetProfile() {
        if (!this.token) return { success: false };
        try {
            // Check Fyers Profile API
            const res = await fetch('https://api-t1.fyers.in/api/v3/profile', {
                headers: { 'Authorization': this.token }
            });
            const data = await res.json();
            if (data.s === 'ok') {
                this.profileName = data.data.name;
                this.isConnected = true;
                window.dispatchEvent(new CustomEvent('fyers_connection_status', { detail: { connected: true, name: this.profileName }}));
                return { success: true, name: this.profileName };
            } else {
                this.isConnected = false;
                window.dispatchEvent(new CustomEvent('fyers_connection_status', { detail: { connected: false }}));
                return { success: false, msg: data.message };
            }
        } catch (e) {
            this.isConnected = false;
            window.dispatchEvent(new CustomEvent('fyers_connection_status', { detail: { connected: false }}));
            return { success: false, msg: e.toString() };
        }
    }

    async getHistory(symbol, resolution, from, to) {
        // Fyers history API: resolution is '1', '5', '1D', etc.
        // Fyers format: Exchange:Symbol
        
        // Check local cache for today's requests
        const cacheKey = `${symbol}_${resolution}_${from}_${to}`;
        const db = await this.dbPromise;
        const cached = await new Promise(resolve => {
            const tx = db.transaction('history', 'readonly');
            const req = tx.objectStore('history').get(cacheKey);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
        
        if (cached && Date.now() - cached.timestamp < 60000) {
            // cache valid for 1 minute for historical requests touching today
            return cached.data;
        }

        const datef = new Date(from * 1000).toISOString().split('T')[0];
        const datet = new Date(to * 1000).toISOString().split('T')[0];
        
        const url = `https://api-t1.fyers.in/data/history?symbol=${symbol}&resolution=${resolution}&date_format=1&range_from=${datef}&range_to=${datet}`;
        
        try {
            const res = await fetch(url, {
                headers: { 'Authorization': this.token }
            });
            const data = await res.json();
            if (data.s === 'ok') {
                const bars = data.candles.map(c => ({
                    time: c[0] * 1000,
                    open: c[1],
                    high: c[2],
                    low: c[3],
                    close: c[4],
                    volume: c[5]
                }));
                
                // Save to cache
                const tx = db.transaction('history', 'readwrite');
                tx.objectStore('history').put({ cacheKey, data: bars, timestamp: Date.now() });
                
                return bars;
            } else if (data.code === -300 || data.message.toLowerCase().includes('token')) {
                // Token expired
                this.isConnected = false;
                window.dispatchEvent(new CustomEvent('fyers_connection_status', { detail: { connected: false, error: 'Token Expired' }}));
            }
            return [];
        } catch (e) {
            console.error("Fyers history error:", e);
            return [];
        }
    }
    


    async getDeepHistory(symbol, resolution, from, to) {
        if (!this.token) return { data: [], isEnd: false };
        
        let maxDays = 100;
        if (resolution === '1D' || resolution === 'D') maxDays = 366;
        else if (resolution.includes('S')) maxDays = 30;
        
        const maxRangeSec = maxDays * 24 * 60 * 60;
        const symbol_res = `${symbol}_${resolution}`;
        const db = await this.dbPromise;
        
        let currentTo = to;
        let globalIsEnd = false;
        
        while (currentTo > from) {
            let currentFrom = Math.max(from, currentTo - maxRangeSec);
            if (currentTo - currentFrom < maxRangeSec) {
                currentFrom = currentTo - maxRangeSec;
            }
            
            const ranges = await new Promise(r => {
                const tx = db.transaction('deep_history_ranges', 'readonly');
                const req = tx.objectStore('deep_history_ranges').get(symbol_res);
                req.onsuccess = () => r(req.result ? req.result.ranges : []);
                req.onerror = () => r([]);
            });
            
            let isCovered = false;
            let chunkIsEnd = false;
            for (let r of ranges) {
                if (r.start <= currentFrom && r.end >= currentTo) {
                    isCovered = true;
                    if (r.isEnd) chunkIsEnd = true;
                    break;
                }
            }
            
            if (!isCovered) {
                const datef = new Date(currentFrom * 1000).toISOString().split('T')[0];
                const datet = new Date(currentTo * 1000).toISOString().split('T')[0];
                const url = `https://api-t1.fyers.in/data/history?symbol=${symbol}&resolution=${resolution}&date_format=1&range_from=${datef}&range_to=${datet}`;
                
                try {
                    const res = await fetch(url, { headers: { 'Authorization': this.token } });
                    const data = await res.json();
                    
                    let fetchedBars = [];
                    
                    if (data.s === 'ok' && data.candles) {
                        fetchedBars = data.candles.map(c => ({
                            id: `${symbol_res}_${c[0] * 1000}`,
                            symbol_res: symbol_res,
                            time: c[0] * 1000,
                            open: c[1],
                            high: c[2],
                            low: c[3],
                            close: c[4],
                            volume: c[5]
                        }));
                    } else if (data.s === 'error' || data.s === 'no_data') {
                        if (data.code === -300 || (data.message && data.message.toLowerCase().includes('token'))) {
                            this.isConnected = false;
                            this.token = null;
                            localStorage.removeItem('fyers_token');
                            alert("Fyers Deep History: Token expired. Please re-authenticate via Broker button.");
                        }
                        
                        if (data.s === 'no_data' || (data.message && data.message.toLowerCase().includes('no data'))) {
                            chunkIsEnd = true;
                        } else {
                            // Rate limit or server error! Do not cache this as end of data.
                            console.error("Fyers API Error:", data);
                            break;
                        }
                    }
                    
                    if (fetchedBars.length === 0 && data.s === 'ok' && (currentTo - currentFrom) >= (maxRangeSec - 86400)) {
                        chunkIsEnd = true;
                    }
                    
                    const tx = db.transaction(['deep_history_ranges', 'deep_history_bars'], 'readwrite');
                    if (fetchedBars.length > 0) {
                        const barStore = tx.objectStore('deep_history_bars');
                        fetchedBars.forEach(b => barStore.put(b));
                    }
                    
                    let newRanges = [...ranges, { start: currentFrom, end: currentTo, isEnd: chunkIsEnd }];
                    newRanges.sort((a,b) => a.start - b.start);
                    let merged = [];
                    if (newRanges.length > 0) {
                        let current = newRanges[0];
                        for (let i = 1; i < newRanges.length; i++) {
                            if (newRanges[i].start <= current.end) {
                                current.end = Math.max(current.end, newRanges[i].end);
                                current.isEnd = current.isEnd || newRanges[i].isEnd;
                            } else {
                                merged.push(current);
                                current = newRanges[i];
                            }
                        }
                        merged.push(current);
                    }
                    
                    tx.objectStore('deep_history_ranges').put({ symbol_res, ranges: merged });
                    await new Promise(r => { tx.oncomplete = r; tx.onerror = r; });
                    
                } catch (e) {
                    console.error("Fyers deep history error:", e);
                    break;
                }
            }
            
            if (chunkIsEnd) {
                globalIsEnd = true;
                break;
            }
            
            currentTo = currentFrom;
        }
        
        const resultBars = await new Promise(resolve => {
            const tx = db.transaction('deep_history_bars', 'readonly');
            const index = tx.objectStore('deep_history_bars').index('symbol_res');
            const req = index.getAll(IDBKeyRange.only(symbol_res));
            req.onsuccess = () => {
                const all = req.result || [];
                const filtered = all.filter(b => b.time >= from * 1000 && b.time <= to * 1000);
                filtered.sort((a, b) => a.time - b.time);
                resolve(filtered);
            };
            req.onerror = () => resolve([]);
        });
        
        return { data: resultBars, isEnd: globalIsEnd };
    }

    
    getSegmentKey(symbol) {
        let exch = 10, seg = 10;
        if (symbol.startsWith('NSE:')) { exch = 10; }
        else if (symbol.startsWith('MCX:')) { exch = 11; }
        else if (symbol.startsWith('BSE:')) { exch = 12; }
        
        if (exch === 11) { seg = 20; }
        else {
            if (symbol.endsWith('FUT') || symbol.endsWith('CE') || symbol.endsWith('PE')) {
                seg = 11;
            }
        }
        return `${exch}:${seg}`;
    }

    async checkMarketStatus() {
        try {
            const res = await fetch('https://api-t1.fyers.in/data/marketStatus', {
                headers: { 'Authorization': this.token }
            });
            const data = await res.json();
            if (data.s === 'ok' && data.marketStatus) return data.marketStatus;
            return null;
        } catch(e) {
            console.error('Market Status Error:', e);
            return null;
        }
    }


    connectWebSocket() {
        if (!this.token) return;
        this.isConnected = true; 
        
        if (this.isPolling) return;
        this.isPolling = true;
        
        if (!this.segmentState) this.segmentState = new Map();
        if (!this.symbolLastTickTime) this.symbolLastTickTime = new Map();
        this.lastStatusCheck = 0;
        
        const poll = async () => {
            const symbols = Array.from(this.subscribers.keys());
            if (symbols.length === 0) { 
                this.isPolling = false;
                this.pollInterval = null;
                return; 
            }
            
            const now = Date.now();
            let symbolsToPoll = [];
            let needsStatusCheck = false;
            
            for (let symbol of symbols) {
                const segKey = this.getSegmentKey(symbol);
                const state = this.segmentState.get(segKey) || "ACTIVE";
                
                if (state === "ACTIVE") {
                    symbolsToPoll.push(symbol);
                    const lastTick = this.symbolLastTickTime.get(symbol) || now;
                    if (now - lastTick > 5 * 60 * 1000) {
                        needsStatusCheck = true; 
                    }
                }
            }
            
            const numChunks = Math.ceil(symbolsToPoll.length / 50);
            const dynamicDelayMs = Math.max(1000, numChunks * 400);
            
            try {
                if (symbolsToPoll.length > 0) {
                    for (let i = 0; i < symbolsToPoll.length; i += 50) {
                        const chunk = symbolsToPoll.slice(i, i + 50);
                        const qUrl = `https://api-t1.fyers.in/data/quotes?symbols=${chunk.join(',')}`;
                        const res = await fetch(qUrl, {
                            headers: { 'Authorization': this.token }
                        });
                        const data = await res.json();
                        
                        if (data.s === 'error' && (data.code === -15 || data.message.toLowerCase().includes('token'))) {
                            console.error("Fyers Auth Error:", data.message);
                            this.isPolling = false;
                            this.pollInterval = null;
                            this.token = null;
                            localStorage.removeItem('fyers_token');
                            alert("Fyers Live Data Disconnected: Your access token has expired or is invalid.\n\nPlease click the Broker button to provide a new token.");
                            return; 
                        }
                        
                        if (data.s === 'ok' && data.d) {
                            data.d.forEach(item => {
                                if (item.s === 'ok' && item.v) {
                                    const symbol = item.n;
                                    const subs = this.subscribers.get(symbol);
                                    if (subs) {
                                        let tickTime = Date.now();
                                        if (item.v.tt) {
                                            tickTime = item.v.tt.toString().length === 10 ? item.v.tt * 1000 : item.v.tt;
                                        } else if (item.v.exch_tm) {
                                            tickTime = item.v.exch_tm.toString().length === 10 ? item.v.exch_tm * 1000 : item.v.exch_tm;
                                        }
                                        
                                        this.symbolLastTickTime.set(symbol, tickTime);
                                        
                                        const tick = {
                                            time: tickTime,
                                            open: item.v.open_price || item.v.o || item.v.lp,
                                            high: item.v.high_price || item.v.h || item.v.lp,
                                            low: item.v.low_price || item.v.l || item.v.lp,
                                            close: item.v.lp,
                                            volume: item.v.volume || item.v.vol || item.v.v || 0
                                        };
                                        subs.forEach(cb => cb(tick));
                                    }
                                }
                            });
                        }
                    }
                }
                
                // Active segments staleness check
                if (needsStatusCheck) {
                    const statusList = await this.checkMarketStatus();
                    if (statusList) {
                        statusList.forEach(st => {
                            if (st.market_type === 'NORMAL' && st.status !== 'OPEN') {
                                const segKey = `${st.exchange}:${st.segment}`;
                                this.segmentState.set(segKey, 'PAUSED');
                                console.log(`[Lifecycle] Segment ${segKey} paused (Market is ${st.status})`);
                            }
                        });
                    }
                    symbolsToPoll.forEach(sym => this.symbolLastTickTime.set(sym, Date.now()));
                }
                
                // Wake up check for paused segments
                let hasPausedSegments = symbols.length > symbolsToPoll.length;
                if (hasPausedSegments && (now - this.lastStatusCheck > 5 * 60 * 1000)) {
                    this.lastStatusCheck = now;
                    const statusList = await this.checkMarketStatus();
                    if (statusList) {
                        statusList.forEach(st => {
                            if (st.market_type === 'NORMAL' && st.status === 'OPEN') {
                                const segKey = `${st.exchange}:${st.segment}`;
                                if (this.segmentState.get(segKey) === 'PAUSED') {
                                    this.segmentState.set(segKey, 'ACTIVE');
                                    console.log(`[Lifecycle] Segment ${segKey} awoken (Market is OPEN)`);
                                    symbols.forEach(sym => {
                                        if (this.getSegmentKey(sym) === segKey) {
                                            this.symbolLastTickTime.set(sym, Date.now());
                                        }
                                    });
                                }
                            }
                        });
                    }
                }
                
            } catch (err) {
                console.error("Fyers Polling Error", err);
            }
            
            setTimeout(poll, dynamicDelayMs);
        };
        
        this.pollInterval = true;
        poll();
    }

    _handleWsMessage(msg) { }
    _sendWsCommand(command, symbols) { }

    subscribe(symbol, callback) {
        if (!this.subscribers.has(symbol)) {
            this.subscribers.set(symbol, new Set());
            
        }
        this.subscribers.get(symbol).add(callback);
        
        if (!this.pollInterval) {
            this.connectWebSocket();
        }
    }
    
    unsubscribe(symbol, callback) {
        if (this.subscribers.has(symbol)) {
            this.subscribers.get(symbol).delete(callback);
            if (this.subscribers.get(symbol).size === 0) {
                
                this.subscribers.delete(symbol);
            }
        }
    }
    
    async clearCache() {
        const db = await this.dbPromise;
        return new Promise((resolve) => {
            const tx = db.transaction('history', 'readwrite');
            const req = tx.objectStore('history').clear();
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
        });
    }
}

window.FyersAPI = new FyersEngine();
