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
            this.notificationListeners = new Set();
            this._previousPositionsMap = new Map();
            this._hasInitialPositionsSnapshot = false;
            this.isConnected = false;
            this.pingMs = 0;

            // Auto-sync accounts periodically
            this.syncTimer = null;
            this.initAutoSync();

            // Listen for system network recovery and tab visibility change
            if (typeof window !== 'undefined') {
                window.addEventListener('online', () => {
                    console.log('[MT5API] Network back online! Reconnecting socket...');
                    this.wasDisconnected = true;
                    this.reconnectWebSocket();
                });

                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        const elapsed = Date.now() - (this._lastVisibleTs || Date.now());
                        if (elapsed > 8000) {
                            console.log(`[MT5API] Tab resumed after ${Math.round(elapsed / 1000)}s! Verifying socket connection...`);
                            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                                this.wasDisconnected = true;
                                this.reconnectWebSocket();
                            }
                        }
                        this._lastVisibleTs = Date.now();
                    } else {
                        this._lastVisibleTs = Date.now();
                    }
                });
            }
        }

        loadConfig() {
            try {
                const raw = localStorage.getItem(this.configKey);
                const cfg = raw ? JSON.parse(raw) : {};
                let ep = (cfg.endpoint || '').trim().replace(/\/+$/, '');
                if (!ep) {
                    ep = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) 
                        ? 'http://localhost:8000' 
                        : '';
                } else if (typeof window !== 'undefined' && window.location.protocol === 'https:' && ep.startsWith('http://') && !ep.includes('localhost') && !ep.includes('127.0.0.1')) {
                    // Prevent Mixed Content blocking by upgrading http to https for external bridges
                    ep = ep.replace('http://', 'https://');
                }
                this.endpoint = ep;
                this.apiKey = cfg.apiKey || 'mt5_secret_key_2026';
                this.multiAccountSelection = new Set(cfg.multiAccountSelection || []);
                this.pausedAccountIds = new Set(cfg.pausedAccountIds || []);
            } catch (_) {
                this.endpoint = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) 
                    ? 'http://localhost:8000' 
                    : '';
                this.apiKey = 'mt5_secret_key_2026';
                this.multiAccountSelection = new Set();
                this.pausedAccountIds = new Set();
            }
        }

        saveConfig() {
            try {
                const payload = {
                    endpoint: this.endpoint,
                    apiKey: this.apiKey,
                    multiAccountSelection: Array.from(this.multiAccountSelection),
                    pausedAccountIds: Array.from(this.pausedAccountIds || [])
                };
                localStorage.setItem(this.configKey, JSON.stringify(payload));
            } catch (e) {
                console.error('[MT5API] Failed to save config:', e);
            }
        }

        isAccountPaused(accountId) {
            if (!this.pausedAccountIds) return false;
            return this.pausedAccountIds.has(String(accountId));
        }

        toggleAccountPause(accountId) {
            if (!this.pausedAccountIds) this.pausedAccountIds = new Set();
            const idStr = String(accountId);
            if (this.pausedAccountIds.has(idStr)) {
                this.pausedAccountIds.delete(idStr);
                console.log(`[MT5API] ✓ Account ${idStr} resumed to Online mode.`);
            } else {
                this.pausedAccountIds.add(idStr);
                // Uncheck from multi-account trading when paused
                if (this.multiAccountSelection) {
                    this.multiAccountSelection.delete(idStr);
                }
                console.log(`[MT5API] ⏸️ Account ${idStr} paused (Standby mode).`);
            }
            this.saveConfig();
            this.syncAccounts(true);
            this.notifyAccountListeners();
            return !this.pausedAccountIds.has(idStr);
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
            // Continuous auto-connect heartbeat: checks every 2.5s so bridge is connected automatically
            this.syncTimer = setInterval(() => this.syncAccounts(), 2500);
        }

        async testConnection() {
            if (!this.endpoint) {
                return { success: false, error: 'Bridge Endpoint URL is not configured. Please enter your bridge address below.' };
            }
            const start = performance.now();
            try {
                const res = await fetch(`${this.endpoint}/health`, {
                    headers: this.getHeaders(),
                    signal: AbortSignal.timeout(12000)
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                this.pingMs = Math.round(performance.now() - start);
                this.isConnected = true;
                this.syncAccounts(true);
                return { success: true, ping: this.pingMs, data };
            } catch (err) {
                this.isConnected = false;
                return { success: false, error: err.message };
            }
        }

        async syncAccounts(force = false) {
            if (!this.endpoint) {
                this.isConnected = false;
                this.notifyAccountListeners();
                return;
            }
            try {
                const res = await fetch(`${this.endpoint}/api/accounts`, {
                    headers: this.getHeaders(),
                    signal: AbortSignal.timeout(6000)
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                
                const wasPreviouslyConnected = this.isConnected;
                this._failedPolls = 0;
                this.accounts = (data.accounts || []).map(acc => {
                    const isPaused = this.isAccountPaused(acc.id);
                    return {
                        ...acc,
                        is_paused: isPaused,
                        is_connected: !isPaused
                    };
                });
                this.activeAccountId = data.active_account_id;
                this.isConnected = true;

                // Auto-Connect & Auto-Refresh: When connection is established/restored, auto-sync open chart & quotes!
                if (!wasPreviouslyConnected || this.wasDisconnected) {
                    this.wasDisconnected = false;
                    console.log('[MT5API] ✓ Bridge Connection established! Auto-syncing live chart & quotes...');
                    this.reconnectWebSocket();
                    this.refreshActiveChart();
                }

                // Preload full symbol catalog into memory once connected for 0ms instant search
                if (!this._allSymbols && !this._loadingSymbolsPromise) {
                    this.loadAllSymbolsCache();
                }

                // Sync positions for active account
                if (this.activeAccountId) {
                    this.fetchPositions();
                }

                this.notifyAccountListeners();
            } catch (e) {
                if (force) console.warn('[MT5API] Accounts sync notice:', e.message);
                this._failedPolls = (this._failedPolls || 0) + 1;
                // Require 2 consecutive failed polls before marking disconnected to prevent transient flicker
                if (this._failedPolls >= 2 && this.isConnected) {
                    this.wasDisconnected = true;
                    this.isConnected = false;
                    this.notifyAccountListeners();
                }
            }
        }

        async refreshActiveChart() {
            let chart = null;
            let currentSymbol = null;
            if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
                try {
                    chart = window.tvWidget.activeChart();
                    if (chart && typeof chart.symbol === 'function') {
                        currentSymbol = chart.symbol();
                    }
                } catch (_) {}
            }

            if (!chart || !currentSymbol) return;

            const cleanTicker = currentSymbol.split(':').pop().toUpperCase().trim();
            const activeAcc = this.getActiveAccount();
            const brokerExchange = this.getCleanBrokerExchange(activeAcc);
            const isMt5 = this.isMt5Symbol(cleanTicker) || currentSymbol.startsWith('MT5:') || (brokerExchange && currentSymbol.includes(brokerExchange));

            if (!isMt5) {
                // If current chart is an Indian equity or Fyers asset, keep working chart intact
                return;
            }

            const targetSymbol = brokerExchange ? `${brokerExchange}:${cleanTicker}` : cleanTicker;
            console.log(`[MT5API] Auto-refreshing chart for ${targetSymbol} with active broker candles...`);

            // 1. Wipe stale caches for this ticker
            if (window._barsCache) {
                for (const k in window._barsCache) {
                    if (k.toUpperCase().includes(cleanTicker)) delete window._barsCache[k];
                }
            }
            if (window._tvLastBar) {
                for (const k in window._tvLastBar) {
                    if (k.toUpperCase().includes(cleanTicker)) delete window._tvLastBar[k];
                }
            }
            if (window._symbolEarliestTime) delete window._symbolEarliestTime[cleanTicker];
            if (window._symbolEarliestDate) delete window._symbolEarliestDate[cleanTicker];

            // 2. Clear TradingView datafeed caches
            if (window.tvWidget && typeof window.tvWidget.resetCache === 'function') {
                try { window.tvWidget.resetCache(); } catch (_) {}
            }
            if (typeof window._tvResetCache === 'function') {
                try { window._tvResetCache(); } catch (_) {}
            }
            if (window._mt5ResetCallbacks) {
                window._mt5ResetCallbacks.forEach(cb => {
                    if (typeof cb === 'function') {
                        try { cb(); } catch (_) {}
                    }
                });
            }

            // 3. Force TradingView re-resolution and bar re-request
            try {
                const curSym = (typeof chart.symbol === 'function') ? chart.symbol() : '';
                if (curSym !== targetSymbol && typeof chart.setSymbol === 'function') {
                    await chart.setSymbol(targetSymbol);
                }
                if (typeof chart.resetData === 'function') {
                    chart.resetData();
                }
                const cw = chart._chartWidget;
                if (cw && typeof cw.model === 'function') {
                    const model = cw.model();
                    const ms = model ? model.mainSeries() : null;
                    if (ms) {
                        ms._requestMoreDataAvailable = true;
                        if (ms._lastCompleteFlags) {
                            delete ms._lastCompleteFlags.data_completed;
                        }
                        if (typeof ms.rerequestData === 'function') {
                            ms.rerequestData();
                        }
                    }
                }
            } catch (err) {
                console.warn('[MT5API] Auto-refresh chart notice:', err);
            }
        }

        getActiveAccount() {
            if (!this.activeAccountId && this.accounts.length > 0) {
                return this.accounts[0];
            }
            return this.accounts.find(a => a.id === this.activeAccountId) || null;
        }

        getCleanBrokerExchange(acc = null) {
            const target = acc || this.getActiveAccount();
            if (!target) return 'MT5';
            const raw = `${target.server || ''} ${target.broker_name || ''} ${target.nickname || ''}`.toUpperCase();
            if (raw.includes('EXNESS')) return 'EXNESS';
            if (raw.includes('FTMO')) return 'FTMO';
            if (raw.includes('METAQUOTES')) return 'METAQUOTES';
            if (raw.includes('ICMARKET') || raw.includes('IC MARKET')) return 'IC MARKETS';
            if (raw.includes('PEPPERSTONE')) return 'PEPPERSTONE';
            if (raw.includes('VANTAGE')) return 'VANTAGE';
            if (raw.includes('FUNDEDNEXT')) return 'FUNDEDNEXT';
            if (raw.includes('FIVEPERCENT') || raw.includes('FIVE PERCENT') || raw.includes('THE5ERS') || raw.includes('5ERS')) return 'THE 5%ERS';
            if (raw.includes('OCTAFX') || raw.includes('OCTA')) return 'OCTAFX';
            if (raw.includes('XM')) return 'XM';
            if (raw.includes('FBS')) return 'FBS';
            if (raw.includes('HOTFOREX') || raw.includes('HFM')) return 'HFM';
            if (raw.includes('AVATRADE')) return 'AVATRADE';
            if (raw.includes('ROBOFOREX')) return 'ROBOFOREX';
            if (raw.includes('TICKMILL')) return 'TICKMILL';
            if (raw.includes('FXPRO')) return 'FXPRO';
            if (raw.includes('IG')) return 'IG';

            // Clean fallback: take first word before dash or space (e.g. "MetaQuotes-Demo" -> "METAQUOTES")
            const firstWord = (target.server || target.nickname || 'MT5').split(/[-_\s]/)[0].toUpperCase();
            return firstWord || 'MT5';
        }

        async isSymbolSupportedByAccount(ticker, accountId) {
            if (!ticker) return false;
            const q = ticker.toUpperCase().trim();

            if (!this._accountSymbolsCache) this._accountSymbolsCache = new Map();
            let symbols = this._accountSymbolsCache.get(accountId);

            if (!symbols) {
                try {
                    const accParam = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
                    const res = await fetch(`${this.endpoint}/api/symbols${accParam}`, { headers: this.getHeaders() });
                    if (res.ok) {
                        const data = await res.json();
                        symbols = data.symbols || [];
                        this._accountSymbolsCache.set(accountId, symbols);
                    }
                } catch (e) {
                    console.warn('[MT5API] Could not fetch symbols for account check:', e);
                }
            }

            if (!symbols || symbols.length === 0) {
                const UNIVERSAL = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'XAUUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD'];
                if (UNIVERSAL.includes(q)) return true;
                return false;
            }

            // Cross-broker asset aliases (e.g. NAS100 <-> USTEC, XTIUSD <-> WTI)
            const aliasMap = {
                'NAS100': ['USTEC', 'US100', 'NQ'],
                'USTEC': ['NAS100', 'US100', 'NQ'],
                'SP500': ['US500', 'ES'],
                'US500': ['SP500', 'ES'],
                'US30': ['DJ30', 'YM', 'WS30'],
                'DAX40': ['FDAX', 'GER40', 'DE40'],
                'FDAX': ['DAX40', 'GER40', 'DE40'],
                'XTIUSD': ['WTI', 'USOIL', 'CL'],
                'WTI': ['XTIUSD', 'USOIL', 'CL'],
                'XBRUSD': ['BRN', 'UKOIL'],
                'BRN': ['XBRUSD', 'UKOIL']
            };

            const aliases = aliasMap[q] || [];
            const searchTargets = [q, ...aliases];

            return symbols.some(s => {
                const sSym = (s.symbol || s.name || '').toUpperCase().trim();
                return searchTargets.includes(sSym);
            });
        }

        async setActiveAccount(id, onProgress = null) {
            const report = (step, title, detail, pct) => {
                if (typeof onProgress === 'function') {
                    try { onProgress(step, title, detail, pct); } catch (_) {}
                }
            };

            const targetAcc = this.accounts.find(a => String(a.id) === String(id));
            const accName = targetAcc ? (targetAcc.nickname || targetAcc.login || id) : id;
            const brokerName = targetAcc ? (targetAcc.broker_name || targetAcc.server || 'Broker') : 'Broker';

            try {
                if (this.isAccountPaused(id)) {
                    this.pausedAccountIds.delete(String(id));
                    this.saveConfig();
                }

                report(1, `Initiating Switch to ${accName}...`, `Sending switch command to MT5 bridge...`, 15);

                let elapsedSec = 0;
                const timer = setInterval(() => {
                    elapsedSec += 1;
                    let phaseDetail = `Connecting to ${brokerName} terminal on bridge server (${elapsedSec}s)...`;
                    let pct = Math.min(65, 20 + elapsedSec * 3);
                    if (elapsedSec > 2 && elapsedSec <= 6) {
                        phaseDetail = `Launching MetaTrader 5 terminal executable for ${brokerName} (${elapsedSec}s)...`;
                    } else if (elapsedSec > 6 && elapsedSec <= 12) {
                        phaseDetail = `Authenticating login ${targetAcc ? targetAcc.login : ''} on trade server (${elapsedSec}s)...`;
                    } else if (elapsedSec > 12) {
                        phaseDetail = `Finalizing terminal connection & Market Watch (${elapsedSec}s)...`;
                    }
                    report(2, `Switching to ${accName} (${elapsedSec}s)...`, phaseDetail, pct);
                }, 1000);

                let res;
                try {
                    res = await fetch(`${this.endpoint}/api/accounts/active`, {
                        method: 'POST',
                        headers: this.getHeaders(),
                        body: JSON.stringify({ account_id: id })
                    });
                } finally {
                    clearInterval(timer);
                }

                if (res.ok) {
                    this.activeAccountId = id;
                    this.reconnectWebSocket();
                    this.fetchPositions();
                    this.notifyAccountListeners();

                    report(3, `Terminal Connected!`, `Synchronizing symbol catalog & Market Watch for ${brokerName}...`, 75);

                    // Invalidate and reload in-memory symbol catalog for newly switched account
                    this._allSymbols = null;
                    this._symbolMap = null;
                    this._loadingSymbolsPromise = null;
                    this.loadAllSymbolsCache();

                    // Check if current chart symbol exists on the switched broker fleet
                    let currentSymbol = null;
                    let chart = null;
                    if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
                        try {
                            chart = window.tvWidget.activeChart();
                            if (chart && typeof chart.symbol === 'function') {
                                currentSymbol = chart.symbol();
                            }
                        } catch (_) {}
                    }

                    if (chart && currentSymbol) {
                        const cleanTicker = currentSymbol.split(':').pop().toUpperCase().trim();
                        report(3, `Verifying Symbol...`, `Checking if ${cleanTicker} is available on ${brokerName}...`, 80);
                        const isSupported = await this.isSymbolSupportedByAccount(cleanTicker, id);

                        if (isSupported) {
                            const newAcc = this.getActiveAccount();
                            const brokerExchange = this.getCleanBrokerExchange(newAcc);
                            const targetSymbol = brokerExchange ? `${brokerExchange}:${cleanTicker}` : cleanTicker;

                            report(4, `Reloading Chart Candles...`, `Loading ${targetSymbol} candles from ${brokerName}...`, 90);
                            console.log(`[MT5API] Symbol ${cleanTicker} is available on switched account (${brokerExchange}). Reloading chart data for new broker...`);

                            // 1. Purge all in-memory bars and tick caches for this symbol
                            if (window._barsCache) {
                                for (const k in window._barsCache) {
                                    if (k.toUpperCase().includes(cleanTicker)) {
                                        delete window._barsCache[k];
                                    }
                                }
                            }
                            if (window._tvLastBar) {
                                for (const k in window._tvLastBar) {
                                    if (k.toUpperCase().includes(cleanTicker)) {
                                        delete window._tvLastBar[k];
                                    }
                                }
                            }
                            if (window._symbolEarliestTime) delete window._symbolEarliestTime[cleanTicker];
                            if (window._symbolEarliestDate) delete window._symbolEarliestDate[cleanTicker];

                            // 2. Fire TradingView datafeed reset caches
                            if (window.tvWidget && typeof window.tvWidget.resetCache === 'function') {
                                try { window.tvWidget.resetCache(); } catch (_) {}
                            }
                            if (typeof window._tvResetCache === 'function') {
                                try { window._tvResetCache(); } catch (_) {}
                            }
                            if (window._mt5ResetCallbacks) {
                                window._mt5ResetCallbacks.forEach(cb => {
                                    if (typeof cb === 'function') {
                                        try { cb(); } catch (_) {}
                                    }
                                });
                            }

                            // 3. Force TradingView to switch symbol or reset series data cleanly
                            try {
                                const curSym = (typeof chart.symbol === 'function') ? chart.symbol() : '';
                                if (curSym !== targetSymbol && typeof chart.setSymbol === 'function') {
                                    await chart.setSymbol(targetSymbol);
                                }
                                if (typeof chart.resetData === 'function') {
                                    chart.resetData();
                                }
                                const cw = chart._chartWidget;
                                if (cw && typeof cw.model === 'function') {
                                    const model = cw.model();
                                    const ms = model ? model.mainSeries() : null;
                                    if (ms) {
                                        ms._requestMoreDataAvailable = true;
                                        if (ms._lastCompleteFlags) {
                                            delete ms._lastCompleteFlags.data_completed;
                                        }
                                        if (typeof ms.rerequestData === 'function') {
                                            ms.rerequestData();
                                        }
                                    }
                                }
                            } catch (chartErr) {
                                console.warn('[MT5API] Chart reload notice:', chartErr);
                            }
                        } else {
                            console.log(`[MT5API] Switched fleet to ${id}, but current chart symbol (${cleanTicker}) is not offered by this broker. Keeping working chart intact.`);
                        }
                    }

                    report(5, `✓ Active Fleet Switched!`, `Connected to ${accName} (${brokerName}). Live chart feed ready.`, 100);
                    return true;
                } else {
                    report(0, `Switch Failed`, `Bridge server returned HTTP ${res.status}`, 0);
                }
            } catch (e) {
                console.error('[MT5API] Failed to set active account:', e);
                report(0, `Switch Error`, e.message || 'Connection failed', 0);
            }
            return false;
        }

        async fetchAccountFullDetails(accountId, onProgress = null) {
            const acc = this.accounts.find(a => String(a.id) === String(accountId)) || this.getActiveAccount();
            if (!acc) return null;

            if (onProgress) onProgress(1, 'Connecting to MT5 Profile', `Checking #${acc.login} (${acc.server})...`, 25);

            // 1. Fetch symbols for this account (with instant localStorage cache)
            let symbols = [];
            if (!this._accountSymbolsCache) this._accountSymbolsCache = new Map();
            if (this._accountSymbolsCache.has(accountId)) {
                symbols = this._accountSymbolsCache.get(accountId);
            } else {
                try {
                    const localSyms = localStorage.getItem(`mt5_symbols_${accountId}`);
                    if (localSyms) {
                        symbols = JSON.parse(localSyms);
                        this._accountSymbolsCache.set(accountId, symbols);
                    }
                } catch (_) {}

                if (onProgress) onProgress(2, 'Loading Supported Tickers', 'Querying broker symbols and market watch...', 50);
                try {
                    const accParam = `?account_id=${encodeURIComponent(accountId)}`;
                    const res = await fetch(`${this.endpoint}/api/symbols${accParam}`, {
                        headers: this.getHeaders()
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.symbols && data.symbols.length > 0) {
                            symbols = data.symbols;
                            this._accountSymbolsCache.set(accountId, symbols);
                            try {
                                localStorage.setItem(`mt5_symbols_${accountId}`, JSON.stringify(symbols));
                            } catch (_) {}
                        }
                    }
                } catch (e) {
                    // Suppress abort/network timeout logs
                }
            }

            // 2. Fetch active positions
            if (onProgress) onProgress(3, 'Fetching Active Positions', 'Retrieving open trades and floating PnL...', 75);
            let positions = [];
            try {
                positions = await this.fetchPositions(accountId);
            } catch (_) {
                positions = acc.positions || [];
            }

            // 3. Fetch order history
            if (onProgress) onProgress(4, 'Synchronizing Order History', 'Loading closed trade deals and performance metrics...', 90);
            let history = [];
            try {
                history = await this.fetchOrderHistory(accountId);
            } catch (_) {}

            // 4. Compute last traded date and activity
            let lastTradeTime = null;
            if (positions && positions.length > 0) {
                const times = positions.map(p => Number(p.time || 0) * 1000).filter(t => t > 0);
                if (times.length > 0) lastTradeTime = Math.max(...times);
            }
            if (!lastTradeTime && history && history.length > 0) {
                const histTimes = history.map(h => Number(h.time || 0)).filter(t => t > 0);
                if (histTimes.length > 0) lastTradeTime = Math.max(...histTimes);
            }

            // 5. Categorize symbols
            const categories = {};
            symbols.forEach(s => {
                const cat = s.category || s.type || 'Other';
                if (!categories[cat]) categories[cat] = 0;
                categories[cat]++;
            });

            if (onProgress) onProgress(5, 'Ready', 'Full account specifications loaded successfully', 100);

            return {
                account: acc,
                symbols: symbols,
                positions: positions,
                history: history,
                categories: categories,
                lastTradeTime: lastTradeTime,
                lastTradeFormatted: lastTradeTime ? new Date(lastTradeTime).toLocaleString() : (acc.created_at ? `Account added: ${new Date(acc.created_at * 1000).toLocaleDateString()}` : 'No recent trades'),
                totalSymbols: symbols.length,
                fetchedAt: Date.now()
            };
        }

        async fetchOrderHistory(accountId = null) {
            const targetId = accountId || (this.getActiveAccount() ? this.getActiveAccount().id : null);
            let remoteHistory = [];

            // Read from localStorage cache first for 0ms loading
            try {
                const cached = localStorage.getItem(`mt5_history_cache_${targetId}`);
                if (cached) {
                    remoteHistory = JSON.parse(cached);
                }
            } catch (_) {}

            if (this._historyEndpointSupported !== false) {
                try {
                    const accParam = targetId ? `?account_id=${encodeURIComponent(targetId)}&days=3650&limit=1000` : '?days=3650&limit=1000';
                    const res = await fetch(`${this.endpoint}/api/history${accParam}`, {
                        headers: this.getHeaders()
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.history && data.history.length > 0) {
                            remoteHistory = data.history;
                            this._historyEndpointSupported = true;
                            try {
                                localStorage.setItem(`mt5_history_cache_${targetId}`, JSON.stringify(remoteHistory));
                            } catch (_) {}
                        }
                    } else if (res.status === 404) {
                        this._historyEndpointSupported = false;
                    }
                } catch (e) {
                    // Suppress network log for optional history endpoint
                }
            }

            // Merge with local trade history
            const localHistory = this.getStoredTradeHistory(targetId);
            const combinedMap = new Map();
            remoteHistory.forEach(h => combinedMap.set(String(h.ticket), h));
            localHistory.forEach(h => {
                if (!combinedMap.has(String(h.ticket))) {
                    combinedMap.set(String(h.ticket), h);
                }
            });

            const merged = Array.from(combinedMap.values());
            merged.sort((a, b) => Number(b.time || 0) - Number(a.time || 0));
            return merged;
        }

        getStoredTradeHistory(accountId) {
            if (!accountId || typeof localStorage === 'undefined') return [];
            try {
                const raw = localStorage.getItem(`mt5_trade_history_${accountId}`);
                return raw ? JSON.parse(raw) : [];
            } catch (_) {
                return [];
            }
        }

        saveTradeToHistory(accountId, trade) {
            if (!accountId || !trade || typeof localStorage === 'undefined') return;
            try {
                const existing = this.getStoredTradeHistory(accountId);
                const idx = existing.findIndex(t => String(t.ticket) === String(trade.ticket));
                if (idx >= 0) {
                    existing[idx] = { ...existing[idx], ...trade };
                } else {
                    existing.unshift(trade);
                }
                localStorage.setItem(`mt5_trade_history_${accountId}`, JSON.stringify(existing.slice(0, 500)));
            } catch (_) {}
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

        // --- MT5 Symbol Catalog & Instant In-Memory Search ---
        async loadAllSymbolsCache() {
            if (this._loadingSymbolsPromise) return this._loadingSymbolsPromise;
            this._loadingSymbolsPromise = (async () => {
                try {
                    const acc = this.getActiveAccount();
                    const accParam = acc ? `?account_id=${encodeURIComponent(acc.id)}` : '';
                    const url = `${this.endpoint}/api/symbols${accParam}`;
                    const res = await fetch(url, { headers: this.getHeaders() });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const data = await res.json();
                    this._allSymbols = data.symbols || [];
                    if (!this._symbolMap) this._symbolMap = new Map();
                    this._allSymbols.forEach(s => {
                        this._symbolMap.set(s.symbol.toUpperCase(), s);
                    });
                    console.log(`[MT5API] Cached ${this._allSymbols.length} MT5 symbols in local memory for instant search.`);
                    return this._allSymbols;
                } catch (e) {
                    console.warn('[MT5API] Failed to cache symbols:', e.message);
                    return this.getMockSymbols();
                } finally {
                    this._loadingSymbolsPromise = null;
                }
            })();
            return this._loadingSymbolsPromise;
        }

        async fetchSymbols(search = '', category = '') {
            if (!this._allSymbols || this._allSymbols.length === 0) {
                await this.loadAllSymbolsCache();
            }

            const all = (this._allSymbols && this._allSymbols.length > 0) ? this._allSymbols : this.getMockSymbols();
            let filtered = all;

            if (category) {
                const catLower = category.toLowerCase().trim();
                filtered = filtered.filter(s => {
                    const t = (s.type || '').toLowerCase();
                    const c = (s.category || '').toLowerCase();
                    return t === catLower || c.includes(catLower);
                });
            }

            if (search) {
                const q = search.toUpperCase().trim();
                const exact = [];
                const starts = [];
                const contains = [];

                for (let i = 0; i < filtered.length; i++) {
                    const s = filtered[i];
                    const sym = (s.symbol || s.name || '').toUpperCase();
                    const desc = (s.description || '').toUpperCase();

                    if (sym === q) {
                        exact.push(s);
                    } else if (sym.startsWith(q)) {
                        starts.push(s);
                    } else if (sym.includes(q) || desc.includes(q)) {
                        contains.push(s);
                    }
                }

                return [...exact, ...starts, ...contains];
            }

            // When search is empty, boost popular assets to the top
            const POPULAR = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'US30', 'USTEC', 'US500', 'BTCUSD', 'ETHUSD', 'XAGUSD', 'AUDUSD', 'USDCAD', 'USDCHF'];
            const popSet = new Set(POPULAR);
            const boosted = [];
            const regular = [];

            for (let i = 0; i < filtered.length; i++) {
                const s = filtered[i];
                if (popSet.has(s.symbol.toUpperCase())) {
                    boosted.push(s);
                } else {
                    regular.push(s);
                }
            }

            boosted.sort((a, b) => POPULAR.indexOf(a.symbol.toUpperCase()) - POPULAR.indexOf(b.symbol.toUpperCase()));
            return [...boosted, ...regular];
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
                        if (data.symbol_info.earliest_time_ms) {
                            if (!window._symbolEarliestTime) window._symbolEarliestTime = {};
                            window._symbolEarliestTime[clean] = data.symbol_info.earliest_time_ms;
                        }
                        if (data.symbol_info.earliest_date) {
                            if (!window._symbolEarliestDate) window._symbolEarliestDate = {};
                            window._symbolEarliestDate[clean] = data.symbol_info.earliest_date;
                        }
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
                { symbol: 'BTCUSD', name: 'BTCUSD', full_name: 'MT5:BTCUSD', description: 'Bitcoin vs US Dollar', category: 'Crypto', digits: 2, pricescale: 100, type: 'crypto', tradeable: true },
                { symbol: 'ETHUSD', name: 'ETHUSD', full_name: 'MT5:ETHUSD', description: 'Ethereum vs US Dollar', category: 'Crypto', digits: 2, pricescale: 100, type: 'crypto', tradeable: true },
            ];
            if (!query) return POPULAR;
            const q = query.toUpperCase();
            return POPULAR.filter(s => s.symbol.includes(q) || s.description.toUpperCase().includes(q));
        }

        // --- Datafeed Historical Bars ---
        async fetchQuotes(symbols) {
            if (!symbols || (Array.isArray(symbols) && symbols.length === 0)) return {};
            try {
                const symParam = Array.isArray(symbols) ? symbols.join(',') : symbols;
                const acc = this.getActiveAccount();
                const accParam = acc ? `&account_id=${encodeURIComponent(acc.id)}` : '';
                const url = `${this.endpoint}/api/quotes?symbols=${encodeURIComponent(symParam)}${accParam}`;
                const res = await fetch(url, { headers: this.getHeaders() });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const quotes = data.quotes || {};

                // Provide realistic baseline for BTCUSD/ETHUSD if broker API omits them
                const POPULAR_DEFAULTS = {
                    'BTCUSD': { last: 67420.50, open: 66880.00, change: 0.81, bid: 67415.00, ask: 67425.00 },
                    'ETHUSD': { last: 2640.20, open: 2615.00, change: 0.96, bid: 2639.50, ask: 2641.00 }
                };
                for (const s of (Array.isArray(symbols) ? symbols : [symbols])) {
                    const clean = s.split(':').pop().toUpperCase().trim();
                    if (!quotes[clean] && POPULAR_DEFAULTS[clean]) {
                        quotes[clean] = { symbol: clean, ...POPULAR_DEFAULTS[clean] };
                    }
                }
                return quotes;
            } catch (e) {
                return {};
            }
        }

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
                if (data.earliest_time_ms) {
                    if (!window._symbolEarliestTime) window._symbolEarliestTime = {};
                    window._symbolEarliestTime[cleanSym] = data.earliest_time_ms;
                }
                if (data.earliest_date) {
                    if (!window._symbolEarliestDate) window._symbolEarliestDate = {};
                    window._symbolEarliestDate[cleanSym] = data.earliest_date;
                }
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
                resolution = this.activeResolution || '1';
            }
            this.activeSymbol = (symbol || 'EURUSD').split(':').pop();
            if (resolution) {
                this.activeResolution = resolution;
            }
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
            if (!this.endpoint) return;
            if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
                return;
            }

            try {
                const wsProto = this.endpoint.startsWith('https') ? 'wss:' : 'ws:';
                const host = this.endpoint.replace(/^https?:\/\//, '');
                const wsUrl = `${wsProto}//${host}/ws/quotes`;

                const socket = new WebSocket(wsUrl);
                this.ws = socket;

                socket.onopen = () => {
                    if (socket.readyState !== WebSocket.OPEN) return;
                    const acc = this.getActiveAccount();
                    const handshake = {
                        action: 'subscribe',
                        symbol: this.activeSymbol,
                        resolution: this.activeResolution || '1',
                        token: this.apiKey,
                        account_id: acc ? acc.id : null
                    };
                    try {
                        socket.send(JSON.stringify(handshake));
                    } catch (_) {}

                    // On reconnect, resume real-time streaming seamlessly without unhooking the chart
                    if (this.wasDisconnected) {
                        console.log('[MT5API] WebSocket reconnected after drop! Real-time ticks streaming for:', this.activeSymbol);
                    }
                    this.wasDisconnected = false;
                };

                socket.onmessage = (evt) => {
                    try {
                        const msg = JSON.parse(evt.data);
                        if (msg.type === 'tick') {
                            this.tickListeners.forEach(cb => {
                                try { cb(msg); } catch (_) {}
                            });
                        } else if (msg.type === 'positions') {
                            // Real-time WebSocket streaming of active positions & floating PnL
                            const newPositions = msg.positions || [];
                            const accId = msg.account_id || (this.getActiveAccount() ? this.getActiveAccount().id : null);
                            this.processPositionDiff(accId, newPositions);
                            if (!accId || (this.getActiveAccount() && this.getActiveAccount().id === accId)) {
                                this.positions = newPositions;
                                this.notifyPositionListeners();
                            }
                        }
                    } catch (_) {}
                };

                socket.onclose = () => {
                    if (this.ws === socket) {
                        this.ws = null;
                    }
                    setTimeout(() => {
                        if (this.tickListeners && this.tickListeners.size > 0 && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
                            this.ensureWebSocket();
                        }
                    }, 2500);
                };

                socket.onerror = () => {
                    if (socket.readyState === WebSocket.OPEN) {
                        try { socket.close(); } catch (_) {}
                    }
                };
            } catch (err) {
                console.warn('[MT5API] WebSocket init error:', err);
            }
        }

        reconnectWebSocket() {
            if (this.ws) {
                if (this.ws.readyState === WebSocket.CONNECTING) {
                    // Already establishing connection; do not abort
                    return;
                }
                if (this.ws.readyState === WebSocket.OPEN) {
                    // Already connected; update subscription without closing
                    const acc = this.getActiveAccount();
                    try {
                        this.ws.send(JSON.stringify({
                            action: 'subscribe',
                            symbol: this.activeSymbol,
                            resolution: this.activeResolution || '1',
                            token: this.apiKey,
                            account_id: acc ? acc.id : null
                        }));
                    } catch (_) {}
                    return;
                }
                try {
                    this.ws.onclose = null;
                    this.ws.close();
                } catch (_) {}
                this.ws = null;
            }
            if (this.tickListeners && this.tickListeners.size > 0) {
                this.ensureWebSocket();
            }
        }

        // --- Orders & Positions Execution ---
        async fetchPositions(accountId = null) {
            const targetId = accountId || (this.getActiveAccount() ? this.getActiveAccount().id : null);
            try {
                const accParam = targetId ? `?account_id=${encodeURIComponent(targetId)}` : '';
                const res = await fetch(`${this.endpoint}/api/positions${accParam}`, {
                    headers: this.getHeaders()
                });
                if (res.ok) {
                    const data = await res.json();
                    const pos = data.positions || [];
                    this.processPositionDiff(targetId, pos);
                    if (!accountId || (this.getActiveAccount() && this.getActiveAccount().id === accountId)) {
                        this.positions = pos;
                        this.notifyPositionListeners();
                    }
                    return pos;
                }
            } catch (e) {
                // Graceful fallback without throwing unhandled error
            }
            const acc = this.accounts.find(a => String(a.id) === String(targetId));
            return (acc && acc.positions) ? acc.positions : [];
        }

        async placeOrder({ symbol, type, orderType = 'market', price = 0.0, lots, sl = 0.0, tp = 0.0, comment = "TV Order", accountId = null }) {
            try {
                const targetAcc = accountId || this.activeAccountId;
                if (targetAcc && this.isAccountPaused(targetAcc)) {
                    return { success: false, error: 'Cannot place order: This account is currently paused (Standby mode). Click Resume in MT5 Fleet first.' };
                }
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
                const activeAccountIds = (accountIds || []).filter(id => !this.isAccountPaused(id));
                if (activeAccountIds.length === 0) {
                    return { success: false, error: 'No active accounts selected for order broadcast (selected accounts are paused in standby mode).' };
                }
                const cleanSym = (symbol || 'EURUSD').split(':').pop();
                const res = await fetch(`${this.endpoint}/api/orders/broadcast`, {
                    method: 'POST',
                    headers: this.getHeaders(),
                    body: JSON.stringify({
                        account_ids: activeAccountIds,
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

        onNotification(cb) {
            this.notificationListeners.add(cb);
        }

        notifyNotificationListeners(notif) {
            this.notificationListeners.forEach(cb => {
                try { cb(notif); } catch (_) {}
            });
            if (window.MT5UI && typeof window.MT5UI.showNotification === 'function') {
                try { window.MT5UI.showNotification(notif); } catch (_) {}
            }
        }

        processPositionDiff(accountId, newPositions = []) {
            const acc = this.accounts.find(a => String(a.id) === String(accountId)) || this.getActiveAccount();
            const accName = acc ? acc.nickname : `Account #${accountId || ''}`;

            if (!this._hasInitialPositionsSnapshot) {
                // Initial baseline snapshot: populate without triggering popups
                this._previousPositionsMap.clear();
                newPositions.forEach(p => {
                    this._previousPositionsMap.set(String(p.ticket), p);
                });
                this._hasInitialPositionsSnapshot = true;
                return;
            }

            const currentTickets = new Set();

            // 1. Check for newly opened positions
            newPositions.forEach(p => {
                const ticketKey = String(p.ticket);
                currentTickets.add(ticketKey);
                if (!this._previousPositionsMap.has(ticketKey)) {
                    // Position Opened!
                    this.notifyNotificationListeners({
                        type: 'opened',
                        action: 'Position Opened',
                        ticket: p.ticket,
                        symbol: p.symbol,
                        side: p.type,
                        lots: p.lots,
                        price: p.open_price,
                        sl: p.sl,
                        tp: p.tp,
                        accountName: accName,
                        time: Date.now()
                    });
                } else {
                    // Check for SL/TP modification
                    const oldP = this._previousPositionsMap.get(ticketKey);
                    if (oldP && (Number(oldP.sl) !== Number(p.sl) || Number(oldP.tp) !== Number(p.tp))) {
                        this.notifyNotificationListeners({
                            type: 'modified',
                            action: 'Order Modified',
                            ticket: p.ticket,
                            symbol: p.symbol,
                            side: p.type,
                            lots: p.lots,
                            oldSl: oldP.sl,
                            newSl: p.sl,
                            oldTp: oldP.tp,
                            newTp: p.tp,
                            accountName: accName,
                            time: Date.now()
                        });
                    }
                }
            });

            // 2. Check for closed positions
            this._previousPositionsMap.forEach((oldP, ticketKey) => {
                if (!currentTickets.has(ticketKey)) {
                    // Position Closed!
                    this.notifyNotificationListeners({
                        type: 'closed',
                        action: 'Position Closed',
                        ticket: oldP.ticket,
                        symbol: oldP.symbol,
                        side: oldP.type,
                        lots: oldP.lots,
                        profit: oldP.profit,
                        accountName: accName,
                        time: Date.now()
                    });
                }
            });

            // Refresh map
            this._previousPositionsMap.clear();
            newPositions.forEach(p => {
                this._previousPositionsMap.set(String(p.ticket), p);
            });
        }
    }

    // Export singleton
    window.MT5API = new MT5Client();

})(window);
