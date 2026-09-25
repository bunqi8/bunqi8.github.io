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
            const request = indexedDB.open('fyers_cache_db', 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('history')) {
                    db.createObjectStore('history', { keyPath: 'cacheKey' });
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
    

    connectWebSocket() {
        if (!this.token) return;
        this.isConnected = true; // Assume true since token exists, profile is checked separately
        
        if (this.pollInterval) clearInterval(this.pollInterval);
        
        this.pollInterval = setInterval(async () => {
            const symbols = Array.from(this.subscribers.keys());
            if (symbols.length === 0) { clearInterval(this.pollInterval); this.pollInterval = null; return; }
            
            try {
                // Chunk into arrays of 50
                for (let i = 0; i < symbols.length; i += 50) {
                    const chunk = symbols.slice(i, i + 50);
                    const qUrl = `https://api-t1.fyers.in/data/quotes?symbols=${chunk.join(',')}`;
                    const res = await fetch(qUrl, {
                        headers: { 'Authorization': this.token }
                    });
                    const data = await res.json();
                    
                    if (data.s === 'ok' && data.d) {
                        data.d.forEach(item => {
                            if (item.s === 'ok' && item.v) {
                                const subs = this.subscribers.get(item.n);
                                if (subs) {
                                    const tick = {
                                        time: Date.now(),
                                        open: item.v.o || item.v.lp,
                                        high: item.v.h || item.v.lp,
                                        low: item.v.l || item.v.lp,
                                        close: item.v.lp,
                                        volume: item.v.vol || 0
                                    };
                                    subs.forEach(cb => cb(tick));
                                }
                            }
                        });
                    }
                }
            } catch (err) {
                console.error("Fyers Polling Error", err);
            }
        }, 1000);
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
