/**
 * MetaTrader 5 (MT5) Multi-Account Client API for TradingView
 * Connects to the 24/7 MT5 Cloud Bridge via secure REST and WebSockets.
 * Handles prop firm multi-account fleets, real-time tick feeds, and parallel trade execution.
 */

(function(window) {
    'use strict';

    class MT5Client {
        constructor() {
            this.configKey = 'tv_mt5_bridge_config';
            this.loadConfig();

            this.accounts = [];
            this.activeAccountId = null;
            this.positions = [];
            this.ws = null;
            this.activeSymbol = 'EURUSD';
            this.tickListeners = new Set();
            this.accountListeners = new Set();
            this.positionListeners = new Set();
            this.isConnected = false;
            this.pingMs = 0;

            // Auto-sync accounts periodically
            this.syncTimer = null;
            this.initAutoSync();
        }

        loadConfig() {
            try {
                const raw = localStorage.getItem(this.configKey);
                const cfg = raw ? JSON.parse(raw) : {};
                let ep = (cfg.endpoint || '').trim().replace(/\/+$/, '');
                if (!ep) {
                    ep = (typeof window !== 'undefined' && window.location.protocol === 'https:') 
                        ? 'https://172.16.120.135:8000' 
                        : 'http://localhost:8000';
                } else if (typeof window !== 'undefined' && window.location.protocol === 'https:' && ep.startsWith('http://')) {
                    // Prevent Mixed Content blocking by upgrading http to https for the bridge
                    ep = ep.replace('http://', 'https://');
                }
                this.endpoint = ep;
                this.apiKey = cfg.apiKey || 'mt5_secret_key_2026';
                this.multiAccountSelection = new Set(cfg.multiAccountSelection || []);
            } catch (_) {
                this.endpoint = (typeof window !== 'undefined' && window.location.protocol === 'https:') 
                    ? 'https://172.16.120.135:8000' 
                    : 'http://localhost:8000';
                this.apiKey = 'mt5_secret_key_2026';
                this.multiAccountSelection = new Set();
            }
        }

        saveConfig() {
            try {
                const payload = {
                    endpoint: this.endpoint,
                    apiKey: this.apiKey,
                    multiAccountSelection: Array.from(this.multiAccountSelection)
                };
                localStorage.setItem(this.configKey, JSON.stringify(payload));
            } catch (e) {
                console.error('[MT5API] Failed to save config:', e);
            }
        }

        setConnection(endpoint, apiKey) {
            this.endpoint = (endpoint || '').trim().replace(/\/+$/, '');
            this.apiKey = (apiKey || '').trim();
            this.saveConfig();
            this.syncAccounts(true);
            this.reconnectWebSocket();
        }

        getHeaders() {
            const h = { 'Content-Type': 'application/json' };
            if (this.apiKey && this.apiKey !== 'none') {
                h['Authorization'] = `Bearer ${this.apiKey}`;
                h['X-Bridge-Key'] = this.apiKey;
            }
            return h;
        }

        initAutoSync() {
            this.syncAccounts();
            if (this.syncTimer) clearInterval(this.syncTimer);
            this.syncTimer = setInterval(() => this.syncAccounts(), 5000);
        }

        async testConnection() {
            const start = performance.now();
            try {
                const res = await fetch(`${this.endpoint}/health`, {
                    headers: this.getHeaders(),
                    signal: AbortSignal.timeout(6000)
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                this.pingMs = Math.round(performance.now() - start);
                this.isConnected = true;
                return { success: true, ping: this.pingMs, data };
            } catch (err) {
                this.isConnected = false;
                return { success: false, error: err.message };
            }
        }

        async syncAccounts(force = false) {
            try {
                const res = await fetch(`${this.endpoint}/api/accounts`, {
                    headers: this.getHeaders(),
                    signal: AbortSignal.timeout(5000)
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                this.accounts = data.accounts || [];
                this.activeAccountId = data.active_account_id;
                this.isConnected = true;

                // Sync positions for active account
                if (this.activeAccountId) {
                    this.fetchPositions();
                }

                this.notifyAccountListeners();
            } catch (e) {
                if (force) console.warn('[MT5API] Accounts sync notice:', e.message);
                this.isConnected = false;
                this.notifyAccountListeners();
            }
        }

        getActiveAccount() {
            if (!this.activeAccountId && this.accounts.length > 0) {
                return this.accounts[0];
            }
            return this.accounts.find(a => a.id === this.activeAccountId) || null;
        }

        async setActiveAccount(id) {
            try {
                const res = await fetch(`${this.endpoint}/api/accounts/active`, {
                    method: 'POST',
                    headers: this.getHeaders(),
                    body: JSON.stringify({ account_id: id })
                });
                if (res.ok) {
                    this.activeAccountId = id;
                    this.fetchPositions();
                    this.notifyAccountListeners();
                    return true;
                }
            } catch (e) {
                console.error('[MT5API] Failed to set active account:', e);
            }
            return false;
        }

        async addAccount(accountData) {
            try {
                const res = await fetch(`${this.endpoint}/api/accounts/add`, {
                    method: 'POST',
                    headers: this.getHeaders(),
                    body: JSON.stringify(accountData)
                });
                const data = await res.json();
                if (data.success) {
                    await this.syncAccounts(true);
                    return { success: true, account: data.account };
                }
                return { success: false, error: data.error || 'Failed to add account' };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

        async deleteAccount(id) {
            try {
                const res = await fetch(`${this.endpoint}/api/accounts/${id}`, {
                    method: 'DELETE',
                    headers: this.getHeaders()
                });
                if (res.ok) {
                    await this.syncAccounts(true);
                    return true;
                }
            } catch (e) {
                console.error('[MT5API] Failed to delete account:', e);
            }
            return false;
        }

        // --- MT5 Symbol Catalog & Search ---
        async fetchSymbols(search = '', category = '') {
            try {
                const acc = this.getActiveAccount();
                const accParam = acc ? `&account_id=${encodeURIComponent(acc.id)}` : '';
                const searchParam = search ? `&search=${encodeURIComponent(search)}` : '';
                const catParam = category ? `&category=${encodeURIComponent(category)}` : '';

                // If no filter and already cached, return from memory
                if (!search && !category && this._allSymbols && this._allSymbols.length > 0) {
                    return this._allSymbols;
                }

                const url = `${this.endpoint}/api/symbols?_t=${Date.now()}${searchParam}${catParam}${accParam}`;
                const res = await fetch(url, { headers: this.getHeaders() });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const list = data.symbols || [];

                if (!this._symbolMap) this._symbolMap = new Map();
                list.forEach(s => {
                    this._symbolMap.set(s.symbol.toUpperCase(), s);
                });

                if (!search && !category) {
                    this._allSymbols = list;
                }
                return list;
            } catch (e) {
                console.warn('[MT5API] fetchSymbols notice:', e.message);
                return this.getMockSymbols(search);
            }
        }

        async fetchSymbolInfo(symbol) {
            const clean = (symbol || 'EURUSD').split(':').pop().toUpperCase().trim();
            if (this._symbolMap && this._symbolMap.has(clean)) {
                return this._symbolMap.get(clean);
            }
            try {
                const acc = this.getActiveAccount();
                const accParam = acc ? `&account_id=${encodeURIComponent(acc.id)}` : '';
                const url = `${this.endpoint}/api/symbol_info?symbol=${encodeURIComponent(clean)}${accParam}`;
                const res = await fetch(url, { headers: this.getHeaders() });
                if (res.ok) {
                    const data = await res.json();
                    if (data.symbol_info) {
                        if (!this._symbolMap) this._symbolMap = new Map();
                        this._symbolMap.set(clean, data.symbol_info);
                        return data.symbol_info;
                    }
                }
            } catch (_) {}
            return null;
        }

        getSymbolInfo(symbol) {
            const clean = (symbol || 'EURUSD').split(':').pop().toUpperCase().trim();
            if (this._symbolMap && this._symbolMap.has(clean)) {
                return this._symbolMap.get(clean);
            }
            return null;
        }

        isMt5Symbol(symbol) {
            if (!symbol) return false;
            const s = String(symbol).toUpperCase().trim();
            if (s.startsWith('MT5:')) return true;
            const clean = s.split(':').pop();
            if (this._symbolMap && this._symbolMap.has(clean)) return true;
            const POPULAR = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'XAUUSD', 'XAGUSD', 'US30', 'USTEC', 'US500', 'DE40', 'UK100', 'BTCUSD', 'ETHUSD'];
            return POPULAR.some(p => clean.startsWith(p));
        }

        getMockSymbols(query = '') {
            const POPULAR = [
                { symbol: 'XAUUSD', name: 'XAUUSD', full_name: 'MT5:XAUUSD', description: 'Gold vs US Dollar', category: 'Metals', digits: 2, pricescale: 100, type: 'commodity', tradeable: true },
                { symbol: 'XAGUSD', name: 'XAGUSD', full_name: 'MT5:XAGUSD', description: 'Silver vs US Dollar', category: 'Metals', digits: 2, pricescale: 100, type: 'commodity', tradeable: true },
                { symbol: 'EURUSD', name: 'EURUSD', full_name: 'MT5:EURUSD', description: 'Euro vs US Dollar', category: 'Forex', digits: 5, pricescale: 100000, type: 'forex', tradeable: true },
                { symbol: 'GBPUSD', name: 'GBPUSD', full_name: 'MT5:GBPUSD', description: 'British Pound vs US Dollar', category: 'Forex', digits: 5, pricescale: 100000, type: 'forex', tradeable: true },
                { symbol: 'USDJPY', name: 'USDJPY', full_name: 'MT5:USDJPY', description: 'US Dollar vs Japanese Yen', category: 'Forex', digits: 3, pricescale: 1000, type: 'forex', tradeable: true },
                { symbol: 'US30', name: 'US30', full_name: 'MT5:US30', description: 'Wall Street 30 Index', category: 'Indexes', digits: 1, pricescale: 10, type: 'index', tradeable: true },
                { symbol: 'USTEC', name: 'USTEC', full_name: 'MT5:USTEC', description: 'US Tech 100 Index', category: 'Indexes', digits: 2, pricescale: 100, type: 'index', tradeable: true },
                { symbol: 'US500', name: 'US500', full_name: 'MT5:US500', description: 'US SPX 500 Index', category: 'Indexes', digits: 2, pricescale: 100, type: 'index', tradeable: true },
            ];
            if (!query) return POPULAR;
            const q = query.toUpperCase();
            return POPULAR.filter(s => s.symbol.includes(q) || s.description.toUpperCase().includes(q));
        }

        // --- Datafeed Historical Bars ---
        async fetchBars(symbol, resolution, from = null, to = null, count = 500) {
            try {
                const cleanSym = (symbol || 'EURUSD').split(':').pop();
                const acc = this.getActiveAccount();
                const accParam = acc ? `&account_id=${encodeURIComponent(acc.id)}` : '';
                let rangeParams = '';
                if (from && to) {
                    rangeParams = `&from=${Math.floor(from)}&to=${Math.ceil(to)}`;
                }
                const url = `${this.endpoint}/api/bars?symbol=${encodeURIComponent(cleanSym)}&resolution=${encodeURIComponent(resolution)}&count=${count}${rangeParams}${accParam}`;
                const res = await fetch(url, { headers: this.getHeaders() });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                return data.bars || [];
            } catch (e) {
                console.warn('[MT5API] fetchBars failed, using fallback:', e);
                return [];
            }
        }

        // --- Real-Time WebSocket Quote Stream ---
        subscribeQuotes(symbol, resolution, callback) {
            if (typeof resolution === 'function') {
                callback = resolution;
                resolution = '1';
            }
            this.activeSymbol = (symbol || 'EURUSD').split(':').pop();
            this.activeResolution = resolution || '1';
            this.tickListeners.add(callback);
            this.ensureWebSocket();
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const acc = this.getActiveAccount();
                this.ws.send(JSON.stringify({
                    action: 'subscribe',
                    symbol: this.activeSymbol,
                    resolution: this.activeResolution,
                    account_id: acc ? acc.id : null
                }));
            }
        }

        unsubscribeQuotes(callback) {
            this.tickListeners.delete(callback);
        }

        ensureWebSocket() {
            if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
                return;
            }

            try {
                const wsProto = this.endpoint.startsWith('https') ? 'wss:' : 'ws:';
                const host = this.endpoint.replace(/^https?:\/\//, '');
                const wsUrl = `${wsProto}//${host}/ws/quotes`;

                this.ws = new WebSocket(wsUrl);

                this.ws.onopen = () => {
                    const acc = this.getActiveAccount();
                    const handshake = {
                        action: 'subscribe',
                        symbol: this.activeSymbol,
                        resolution: this.activeResolution || '1',
                        token: this.apiKey,
                        account_id: acc ? acc.id : null
                    };
                    this.ws.send(JSON.stringify(handshake));

                    // If reconnected after network drop, trigger chart cache reload to reconcile historical bars
                    if (this.wasDisconnected && typeof window._tvResetCache === 'function') {
                        console.log('[MT5API] WebSocket reconnected after drop! Re-syncing chart cache...');
                        try { window._tvResetCache(); } catch (_) {}
                    }
                    this.wasDisconnected = false;
                };

                this.ws.onmessage = (evt) => {
                    try {
                        const msg = JSON.parse(evt.data);
                        if (msg.type === 'tick') {
                            this.tickListeners.forEach(cb => {
                                try { cb(msg); } catch (_) {}
                            });
                        }
                    } catch (_) {}
                };

                this.ws.onclose = () => {
                    this.ws = null;
                    this.wasDisconnected = true;
                    setTimeout(() => {
                        if (this.tickListeners.size > 0) this.ensureWebSocket();
                    }, 1500);
                };

                this.ws.onerror = () => {
                    if (this.ws) this.ws.close();
                };
            } catch (err) {
                console.warn('[MT5API] WebSocket init error:', err);
            }
        }

        reconnectWebSocket() {
            if (this.ws) {
                this.ws.close();
                this.ws = null;
            }
            if (this.tickListeners.size > 0) {
                this.ensureWebSocket();
            }
        }

        // --- Orders & Positions Execution ---
        async fetchPositions() {
            try {
                const acc = this.getActiveAccount();
                const accParam = acc ? `?account_id=${encodeURIComponent(acc.id)}` : '';
                const res = await fetch(`${this.endpoint}/api/positions${accParam}`, {
                    headers: this.getHeaders()
                });
                if (res.ok) {
                    const data = await res.json();
                    this.positions = data.positions || [];
                    this.notifyPositionListeners();
                    return this.positions;
                }
            } catch (e) {
                console.warn('[MT5API] fetchPositions error:', e);
            }
            return [];
        }

        async placeOrder({ symbol, type, orderType = 'market', price = 0.0, lots, sl = 0.0, tp = 0.0, comment = "TV Order", accountId = null }) {
            try {
                const targetAcc = accountId || this.activeAccountId;
                const cleanSym = (symbol || 'EURUSD').split(':').pop();
                let effectiveType = type.toUpperCase();
                if (orderType === 'limit') {
                    effectiveType = effectiveType === 'BUY' ? 'BUY_LIMIT' : 'SELL_LIMIT';
                } else if (orderType === 'stop') {
                    effectiveType = effectiveType === 'BUY' ? 'BUY_STOP' : 'SELL_STOP';
                }
                const res = await fetch(`${this.endpoint}/api/orders/place`, {
                    method: 'POST',
                    headers: this.getHeaders(),
                    body: JSON.stringify({
                        account_id: targetAcc,
                        symbol: cleanSym,
                        type: effectiveType,
                        price: Number(price) || 0.0,
                        lots: Number(lots),
                        sl: Number(sl) || 0.0,
                        tp: Number(tp) || 0.0,
                        comment
                    })
                });
                const data = await res.json();
                await this.fetchPositions();
                return data;
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

        async modifyPosition({ ticket, sl, tp, accountId = null }) {
            try {
                const targetAcc = accountId || this.activeAccountId;
                const res = await fetch(`${this.endpoint}/api/orders/modify`, {
                    method: 'POST',
                    headers: this.getHeaders(),
                    body: JSON.stringify({
                        account_id: targetAcc,
                        ticket: Number(ticket),
                        sl: Number(sl),
                        tp: Number(tp)
                    })
                });
                const data = await res.json();
                await this.fetchPositions();
                return data;
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

        async closePosition({ ticket, lots = null, accountId = null }) {
            try {
                const targetAcc = accountId || this.activeAccountId;
                const res = await fetch(`${this.endpoint}/api/orders/close`, {
                    method: 'POST',
                    headers: this.getHeaders(),
                    body: JSON.stringify({
                        account_id: targetAcc,
                        ticket: Number(ticket),
                        lots: lots ? Number(lots) : null
                    })
                });
                const data = await res.json();
                await this.fetchPositions();
                return data;
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

        async broadcastOrder({ accountIds, symbol, type, baseLots, sl = 0.0, tp = 0.0 }) {
            try {
                const cleanSym = (symbol || 'EURUSD').split(':').pop();
                const res = await fetch(`${this.endpoint}/api/orders/broadcast`, {
                    method: 'POST',
                    headers: this.getHeaders(),
                    body: JSON.stringify({
                        account_ids: accountIds,
                        symbol: cleanSym,
                        type: type.toUpperCase(),
                        base_lots: Number(baseLots),
                        sl: Number(sl) || 0.0,
                        tp: Number(tp) || 0.0
                    })
                });
                const data = await res.json();
                await this.fetchPositions();
                return data;
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

        // --- Listeners & Event Notification ---
        onAccountUpdate(cb) {
            this.accountListeners.add(cb);
            cb({ accounts: this.accounts, activeAccount: this.getActiveAccount(), isConnected: this.isConnected, ping: this.pingMs });
        }

        notifyAccountListeners() {
            const payload = {
                accounts: this.accounts,
                activeAccount: this.getActiveAccount(),
                isConnected: this.isConnected,
                ping: this.pingMs
            };
            this.accountListeners.forEach(cb => {
                try { cb(payload); } catch (_) {}
            });
        }

        onPositionUpdate(cb) {
            this.positionListeners.add(cb);
            cb(this.positions);
        }

        notifyPositionListeners() {
            this.positionListeners.forEach(cb => {
                try { cb(this.positions); } catch (_) {}
            });
        }
    }

    // Export singleton
    window.MT5API = new MT5Client();

    // Auto-reconnect & re-sync chart history when internet or browser tab is restored
    if (typeof window !== 'undefined') {
        window.addEventListener('online', () => {
            console.log('[MT5API] Network restored online. Reconnecting WebSocket...');
            if (window.MT5API) {
                window.MT5API.reconnectWebSocket();
                if (typeof window._tvResetCache === 'function') {
                    try { window._tvResetCache(); } catch (_) {}
                }
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && window.MT5API) {
                if (!window.MT5API.ws || window.MT5API.ws.readyState !== WebSocket.OPEN) {
                    window.MT5API.reconnectWebSocket();
                }
                if (typeof window._tvResetCache === 'function') {
                    try { window._tvResetCache(); } catch (_) {}
                }
            }
        });
    }

})(window);
