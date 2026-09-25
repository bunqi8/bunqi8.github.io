// Fyers Live Data & WebSocket Engine
// Fully decoupled and portable module for the frontend

class FyersEngine {
    constructor() {
        this.token = localStorage.getItem('fyers_token') || null;
        this.appId = null; // Can be parsed from token if JWT, or we require user to input it
        this.profileName = null;
        this.isConnected = false;
        
        // WebSocket state
        this.ws = null;
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
        if (!this.token || this.ws) return;
        
        // Ensure token has appId:accessToken format
        // Some users pass only access token, we will just pass whatever is given in the auth header or payload.
        this.ws = new WebSocket(this.wsUrl);
        
        this.ws.onopen = () => {
            console.log("Fyers WS Connected");
            this.reconnectAttempts = 0;
            
            // Re-subscribe to all active symbols
            const symbolsToSub = Array.from(this.subscribers.keys());
            if (symbolsToSub.length > 0) {
                this._sendWsCommand('SUB_DATA', symbolsToSub);
            }
        };
        
        this.ws.onmessage = (e) => {
            // Fyers typically sends binary arraybuffer or json string. Assume JSON for simplicity.
            try {
                let data = e.data;
                if (data instanceof Blob) {
                    const reader = new FileReader();
                    reader.onload = () => {
                        this._handleWsMessage(JSON.parse(reader.result));
                    };
                    reader.readAsText(data);
                } else {
                    this._handleWsMessage(JSON.parse(data));
                }
            } catch (err) {}
        };
        
        this.ws.onclose = () => {
            console.log("Fyers WS Disconnected");
            this.ws = null;
            if (this.reconnectAttempts < this.maxReconnect) {
                this.reconnectAttempts++;
                setTimeout(() => this.connectWebSocket(), 2000 * this.reconnectAttempts);
            }
        };
        
        this.ws.onerror = (e) => console.error("Fyers WS Error", e);
    }
    
    _handleWsMessage(msg) {
        // Fyers sends messages like: { type: "symbolUpdate", symbol: "NSE:NIFTY24...", ltp: 100, open: 90, ... }
        if (!msg || !msg.symbol) return;
        
        const subs = this.subscribers.get(msg.symbol);
        if (subs) {
            // Construct a standard TradingView tick object
            // Fallback to LTP if full OHLCV is not sent in this specific tick
            const tick = {
                time: (msg.timestamp * 1000) || Date.now(),
                open: msg.open || msg.ltp,
                high: msg.high || msg.ltp,
                low: msg.low || msg.ltp,
                close: msg.ltp,
                volume: msg.volume || 0
            };
            subs.forEach(cb => cb(tick));
        }
    }
    
    _sendWsCommand(command, symbols) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                T: command,
                symbols: symbols,
                type: 'symbolUpdate',
                access_token: this.token
            }));
        }
    }

    subscribe(symbol, callback) {
        if (!this.subscribers.has(symbol)) {
            this.subscribers.set(symbol, new Set());
            this._sendWsCommand('SUB_DATA', [symbol]);
        }
        this.subscribers.get(symbol).add(callback);
        
        if (!this.ws) {
            this.connectWebSocket();
        }
    }
    
    unsubscribe(symbol, callback) {
        if (this.subscribers.has(symbol)) {
            this.subscribers.get(symbol).delete(callback);
            if (this.subscribers.get(symbol).size === 0) {
                this._sendWsCommand('UNSUB_DATA', [symbol]);
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
