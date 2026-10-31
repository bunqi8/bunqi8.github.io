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
            this.endpoints = [];
            this.activeEndpointId = null;
            this.wsSockets = new Map();
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
            this.pingListeners = new Set();
            this._previousPositionsMap = new Map();
            this._hasInitialPositionsSnapshot = false;
            this.isConnected = false;
            this.pingMs = 0;

            // Auto-sync accounts periodically across all enabled bridges
            this.syncTimer = null;
            this.initAutoSync();

            // Listen for system network recovery and tab visibility change
            if (typeof window !== 'undefined') {
                window.addEventListener('online', () => {
                    console.log('[MT5API] Network back online! Reconnecting bridge sockets...');
                    this.wasDisconnected = true;
                    this.reconnectWebSocket();
                });

                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        const elapsed = Date.now() - (this._lastVisibleTs || Date.now());
                        if (elapsed > 8000) {
                            console.log(`[MT5API] Tab resumed after ${Math.round(elapsed / 1000)}s! Verifying bridge sockets...`);
                            this.ensureWebSocket();
                        }
                        this._lastVisibleTs = Date.now();
                    } else {
                        this._lastVisibleTs = Date.now();
                    }
                });
            }
        }

        // Backward compatibility getters/setters for legacy single-endpoint callers
        get endpoint() {
            const active = this.getActiveEndpoint();
            return active ? active.url : '';
        }

        set endpoint(val) {
            const active = this.getActiveEndpoint();
            if (active) {
                active.url = (val || '').trim().replace(/\/+$/, '');
            } else if (val) {
                this.addEndpoint({ name: 'Primary Bridge', url: val });
            }
        }

        get apiKey() {
            const active = this.getActiveEndpoint();
            return active ? active.apiKey : 'mt5_secret_key_2026';
        }

        set apiKey(val) {
            const active = this.getActiveEndpoint();
            if (active) active.apiKey = (val || '').trim();
        }

        loadConfig() {
            try {
                const raw = localStorage.getItem(this.configKey);
                const cfg = raw ? JSON.parse(raw) : {};

                let endpoints = Array.isArray(cfg.endpoints) ? cfg.endpoints : [];

                // Migrate legacy single endpoint format if present
                if (endpoints.length === 0 && cfg.endpoint) {
                    let ep = cfg.endpoint.trim().replace(/\/+$/, '');
                    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && ep.startsWith('http://') && !ep.includes('localhost') && !ep.includes('127.0.0.1')) {
                        ep = ep.replace('http://', 'https://');
                    }
                    if (ep) {
                        endpoints.push({
                            id: 'ep_migrated',
                            name: 'Primary Bridge',
                            url: ep,
                            apiKey: cfg.apiKey || 'mt5_secret_key_2026',
                            enabled: true,
                            status: 'unknown',
                            ping: 0
                        });
                    }
                }

                // If running on localhost and no endpoints configured, offer localhost default
                if (endpoints.length === 0 && typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
                    endpoints = [
                        {
                            id: 'ep_localhost',
                            name: 'Localhost Bridge',
                            url: 'http://localhost:8000',
                            apiKey: 'mt5_secret_key_2026',
                            enabled: true,
                            status: 'unknown',
                            ping: 0
                        }
                    ];
                }

                this.endpoints = endpoints;
                this.activeEndpointId = cfg.activeEndpointId || (this.endpoints[0] ? this.endpoints[0].id : null);
                this.multiAccountSelection = new Set(cfg.multiAccountSelection || []);
                this.pausedAccountIds = new Set(cfg.pausedAccountIds || []);
            } catch (_) {
                this.endpoints = [];
                this.activeEndpointId = null;
                this.multiAccountSelection = new Set();
                this.pausedAccountIds = new Set();
            }

            // Instantly restore cached accounts on page load for 0ms exchange rendering
            try {
                const rawAccs = localStorage.getItem('mt5_accounts_cache');
                if (rawAccs) {
                    const parsed = JSON.parse(rawAccs);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        this.accounts = parsed;
                        const active = parsed.find(a => a.is_active);
                        if (active && !this.activeAccountId) this.activeAccountId = active.id;
                    }
                }
            } catch (_) {}
        }

        saveConfig() {
            try {
                const payload = {
                    endpoints: (this.endpoints || []).map(e => ({
                        id: e.id,
                        name: e.name,
                        url: e.url,
                        apiKey: e.apiKey,
                        vaultKey: e.vaultKey || null,
                        enabled: e.enabled !== false,
                        status: e.status || 'unknown',
                        ping: e.ping || 0,
                        error: e.error || null
                    })),
                    activeEndpointId: this.activeEndpointId,
                    endpoint: this.endpoint,
                    apiKey: this.apiKey,
                    multiAccountSelection: Array.from(this.multiAccountSelection || []),
                    pausedAccountIds: Array.from(this.pausedAccountIds || [])
                };
                localStorage.setItem(this.configKey, JSON.stringify(payload));
            } catch (e) {
                console.error('[MT5API] Failed to save config:', e);
            }
        }

        // --- Multi-Bridge Endpoint Management ---
        getEndpoints() {
            return this.endpoints || [];
        }

        getGistSyncConfig() {
            try {
                const raw = localStorage.getItem('mt5_gist_sync');
                if (raw) return JSON.parse(raw);
            } catch (_) {}
            return {
                enabled: true,
                gistId: '9d41609fb0b53d6d5a398a915f55bb5c',
                token: '',
                lastSynced: 0,
                status: 'idle'
            };
        }

        saveGistSyncConfig(cfg) {
            try {
                localStorage.setItem('mt5_gist_sync', JSON.stringify(cfg));
            } catch (_) {}
        }

        async syncFromGist(force = false) {
            const cfg = this.getGistSyncConfig();
            if (!cfg || !cfg.enabled || !cfg.gistId || !cfg.token) {
                return { success: false, reason: 'Gist sync not configured' };
            }

            // Rate-limit automated checks to once per 60 seconds unless forced
            const now = Date.now();
            if (!force && this._lastGistFetchTime && (now - this._lastGistFetchTime < 60000)) {
                return { success: true, rateLimited: true, lastSynced: cfg.lastSynced };
            }
            this._lastGistFetchTime = now;

            try {
                const res = await fetch(`https://api.github.com/gists/${cfg.gistId.trim()}`, {
                    headers: {
                        'Authorization': `token ${cfg.token.trim()}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
                if (!res.ok) throw new Error(`GitHub Gist API HTTP ${res.status}`);
                const data = await res.json();
                const vaultFile = data.files && data.files['mt5_bridges.json'];
                if (!vaultFile || !vaultFile.content) throw new Error('mt5_bridges.json not found in Gist');

                const vault = JSON.parse(vaultFile.content);
                const bridges = vault.bridges || {};
                let updatedCount = 0;

                for (const ep of this.endpoints) {
                    let vaultKey = ep.vaultKey;
                    if (!vaultKey) {
                        const lowerName = (ep.name || '').toLowerCase();
                        const lowerUrl = (ep.url || '').toLowerCase();
                        if (lowerName.includes('oracle') || lowerUrl.includes('trycloudflare') || lowerName.includes('cloud')) {
                            vaultKey = 'oracle_cloud';
                        } else if (lowerName.includes('vmware') || lowerUrl.includes('172.16.') || lowerName.includes('local')) {
                            vaultKey = 'vmware_local';
                        }
                    }

                    if (vaultKey && bridges[vaultKey] && bridges[vaultKey].url) {
                        const encryptedUrl = bridges[vaultKey].url;
                        const decryptedUrl = await this.decryptE2EPayload(encryptedUrl, ep.apiKey);
                        if (decryptedUrl && decryptedUrl.startsWith('http')) {
                            const clean = decryptedUrl.trim().replace(/\/+$/, '');
                            if (clean !== ep.url) {
                                console.log(`[MT5API] 🔄 Auto-Discovery: Updated ${ep.name} URL from ${ep.url} -> ${clean}`);
                                ep.url = clean;
                                ep.status = 'unknown';
                                ep.ping = 0;
                                updatedCount++;
                            }
                        }
                    }
                }

                cfg.lastSynced = Date.now();
                cfg.status = 'ok';
                cfg.error = null;
                this.saveGistSyncConfig(cfg);

                if (updatedCount > 0) {
                    this.saveConfig();
                    this.testConnection();
                    this.ensureWebSocket();
                    this.notifyAccountListeners();
                }

                return { success: true, updatedCount, lastSynced: cfg.lastSynced };
            } catch (err) {
                console.warn('[MT5API] Gist sync failed:', err);
                cfg.status = 'error';
                cfg.error = err.message;
                this.saveGistSyncConfig(cfg);
                return { success: false, error: err.message };
            }
        }

        getActiveEndpoint() {
            if (!this.endpoints || this.endpoints.length === 0) return null;
            if (this.activeEndpointId) {
                const matched = this.endpoints.find(e => e.id === this.activeEndpointId);
                if (matched) return matched;
            }
            const firstEnabled = this.endpoints.find(e => e.enabled);
            return firstEnabled || this.endpoints[0] || null;
        }

        getEndpointForAccount(accountId) {
            if (accountId && this.accounts) {
                const acc = this.accounts.find(a => String(a.id) === String(accountId));
                if (acc) {
                    if (acc.endpointId) {
                        const ep = this.endpoints.find(e => e.id === acc.endpointId);
                        if (ep) return ep;
                    }
                    if (acc.endpointUrl) {
                        const ep = this.endpoints.find(e => e.url === acc.endpointUrl);
                        if (ep) return ep;
                    }
                }
            }
            return this.getActiveEndpoint();
        }

        isLocalVmBridge(ep) {
            if (!ep) return false;
            const name = (ep.name || '').toLowerCase();
            const url = (ep.url || '').toLowerCase();

            // 1. Explicit local / vmware / lan keywords in name or url
            const isVmKeyword = name.includes('local') || name.includes('vmware') || 
                                name.includes('desktop') || name.includes('lan') || 
                                name.includes('home') || name.includes('workstation');
            
            // 2. Contains 'vm' but is NOT cloud-hosted (e.g. Oracle VM is cloud, not local)
            const hasVmNotCloud = name.includes('vm') && !name.includes('cloud') && !name.includes('oracle') && !name.includes('aws') && !name.includes('vps') && !name.includes('azure');

            // 3. Private RFC1918 IPv4 ranges or localhost
            const isPrivateIp = url.includes('127.0.0.1') || url.includes('localhost') ||
                                url.includes('192.168.') || url.includes('10.') ||
                                /172\.(1[6-9]|2[0-9]|3[0-1])\./.test(url);

            return Boolean(isVmKeyword || hasVmNotCloud || isPrivateIp);
        }

        getReqHeaders(endpointObj) {
            const ep = endpointObj || this.getActiveEndpoint();
            const h = { 'Content-Type': 'application/json' };
            const key = ep ? ep.apiKey : (this.apiKey || 'mt5_secret_key_2026');
            if (key && key !== 'none') {
                h['Authorization'] = `Bearer ${key}`;
                h['X-Bridge-Key'] = key;
            }
            return h;
        }

        getHeaders() {
            return this.getReqHeaders(this.getActiveEndpoint());
        }

        addEndpoint({ name, url, apiKey, enabled = true }) {
            const cleanUrl = (url || '').trim().replace(/\/+$/, '');
            if (!cleanUrl) return { success: false, error: 'Endpoint URL is required' };
            const cleanKey = (apiKey || 'mt5_secret_key_2026').trim();
            const cleanName = (name || '').trim() || `Bridge Server ${this.endpoints.length + 1}`;
            const id = 'ep_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

            const newEp = {
                id,
                name: cleanName,
                url: cleanUrl,
                apiKey: cleanKey,
                enabled: enabled !== false,
                status: 'unknown',
                ping: 0
            };

            this.endpoints.push(newEp);
            if (this.endpoints.length === 1 || !this.activeEndpointId) {
                this.activeEndpointId = id;
            }
            this.saveConfig();
            this.syncAccounts(true);
            this.ensureWebSocket();
            return { success: true, endpoint: newEp };
        }

        updateEndpoint(id, updates = {}) {
            const ep = this.endpoints.find(e => e.id === id);
            if (!ep) return false;
            if (updates.name !== undefined) ep.name = String(updates.name).trim();
            if (updates.url !== undefined) ep.url = String(updates.url).trim().replace(/\/+$/, '');
            if (updates.apiKey !== undefined) ep.apiKey = String(updates.apiKey).trim();
            if (updates.vaultKey !== undefined) ep.vaultKey = updates.vaultKey ? String(updates.vaultKey).trim() : null;
            if (updates.enabled !== undefined) ep.enabled = Boolean(updates.enabled);
            this.saveConfig();
            this.syncAccounts(true);
            this.ensureWebSocket();
            return true;
        }

        deleteEndpoint(id) {
            const idx = this.endpoints.findIndex(e => e.id === id);
            if (idx < 0) return false;
            this.endpoints.splice(idx, 1);
            if (this.activeEndpointId === id) {
                const remaining = this.endpoints.find(e => e.enabled) || this.endpoints[0];
                this.activeEndpointId = remaining ? remaining.id : null;
            }
            if (this.wsSockets.has(id)) {
                try {
                    this.wsSockets.get(id).close();
                } catch (_) {}
                this.wsSockets.delete(id);
            }
            this.saveConfig();
            this.syncAccounts(true);
            return true;
        }

        toggleEndpoint(id) {
            const ep = this.endpoints.find(e => e.id === id);
            if (!ep) return false;
            ep.enabled = !ep.enabled;
            this.saveConfig();
            this.syncAccounts(true);
            this.ensureWebSocket();
            return ep.enabled;
        }

        setActiveEndpoint(id) {
            const ep = this.endpoints.find(e => e.id === id);
            if (!ep) return false;
            this.activeEndpointId = id;
            this.saveConfig();
            this.notifyAccountListeners();
            return true;
        }

        setConnection(endpoint, apiKey) {
            const active = this.getActiveEndpoint();
            if (active) {
                active.url = (endpoint || '').trim().replace(/\/+$/, '');
                active.apiKey = (apiKey || '').trim();
            } else {
                this.addEndpoint({
                    name: 'Primary Bridge',
                    url: endpoint,
                    apiKey: apiKey,
                    enabled: true
                });
            }
            this.saveConfig();
            this.syncAccounts(true);
            this.reconnectWebSocket();
        }

        async testSingleEndpoint(endpointId) {
            const ep = this.endpoints.find(e => e.id === endpointId);
            if (!ep) return { success: false, error: 'Endpoint not found' };
            const start = performance.now();
            try {
                const res = await fetch(`${ep.url}/health`, {
                    headers: this.getReqHeaders(ep),
                    signal: AbortSignal.timeout(8000)
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const ping = Math.round(performance.now() - start);
                ep.ping = ping;
                ep.status = 'online';
                ep.error = null;

                // Validate API key and sync accounts for this endpoint
                try {
                    const accRes = await fetch(`${ep.url}/api/accounts`, {
                        headers: this.getReqHeaders(ep),
                        signal: AbortSignal.timeout(6000)
                    });
                    if (accRes.status === 401 || accRes.status === 403) {
                        ep.error = 'Invalid API Key (HTTP 401 Unauthorized)';
                        this.saveConfig();
                        return {
                            success: false,
                            error: 'Authentication Failed (HTTP 401): The Bridge API Key is incorrect. Please click Edit and enter the strong API Key.'
                        };
                    }
                    if (accRes.ok) {
                        await this.syncAccounts(true);
                    }
                } catch (authErr) {
                    console.warn('[MT5API] Could not sync accounts during test:', authErr);
                }

                this.saveConfig();
                return { success: true, ping, data };
            } catch (err) {
                ep.status = 'offline';
                ep.error = err.message;
                this.saveConfig();
                return { success: false, error: err.message };
            }
        }

        async testConnection() {
            const enabled = (this.endpoints || []).filter(e => e.enabled);
            if (enabled.length === 0) {
                return { success: false, error: 'Bridge Endpoint URL is not configured. Please add or enable at least one bridge endpoint below.' };
            }
            const results = await Promise.all(enabled.map(e => this.testSingleEndpoint(e.id)));
            const successful = results.filter(r => r.success);
            const anySuccess = successful.length > 0;
            this.isConnected = anySuccess;
            if (anySuccess) {
                this.pingMs = successful[0].ping;
                this.syncAccounts(true);
            } else {
                // If all enabled endpoints are offline, attempt Gist Auto-Discovery to recover rotated URLs
                try {
                    const syncRes = await this.syncFromGist();
                    if (syncRes && syncRes.updatedCount > 0) {
                        return this.testConnection();
                    }
                } catch (_) {}
            }
            return {
                success: anySuccess,
                total: enabled.length,
                online: successful.length,
                ping: anySuccess ? successful[0].ping : 0,
                error: anySuccess ? null : (results[0]?.error || 'Failed to connect to configured bridge endpoints'),
                results
            };
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

        initAutoSync() {
            this.syncAccounts();
            if (this.syncTimer) clearInterval(this.syncTimer);
            // Continuous auto-connect heartbeat: checks every 2.5s across all enabled bridges
            this.syncTimer = setInterval(() => this.syncAccounts(), 2500);
        }

        // --- Parallel Multi-Bridge Account Sync ---
        async syncAccounts(force = false) {
            const enabledEndpoints = (this.endpoints || []).filter(e => e.enabled);
            if (enabledEndpoints.length === 0) {
                this.isConnected = false;
                this.accounts = [];
                this.notifyAccountListeners();
                return;
            }

            const fetchPromises = enabledEndpoints.map(async (ep) => {
                const start = performance.now();
                try {
                    const res = await fetch(`${ep.url}/api/accounts`, {
                        headers: this.getReqHeaders(ep),
                        signal: AbortSignal.timeout(6000)
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const data = await res.json();
                    ep.ping = Math.round(performance.now() - start);
                    ep.status = 'online';
                    ep.error = null;
                    return { ep, data };
                } catch (err) {
                    ep.status = 'offline';
                    ep.error = err.message;
                    if (force) console.warn(`[MT5API] Endpoint '${ep.name}' sync error:`, err.message);
                    return { ep, data: null, error: err.message };
                }
            });

            const results = await Promise.allSettled(fetchPromises);
            const allAccounts = [];
            let anyOnline = false;
            let primaryActiveId = null;

            for (const r of results) {
                if (r.status === 'fulfilled' && r.value && r.value.data) {
                    const { ep, data } = r.value;
                    anyOnline = true;
                    if (ep.id === this.activeEndpointId && data.active_account_id) {
                        primaryActiveId = data.active_account_id;
                    }
                    const accountsList = data.accounts || [];
                    accountsList.forEach(acc => {
                        const isPaused = this.isAccountPaused(acc.id);
                        allAccounts.push({
                            ...acc,
                            endpointId: ep.id,
                            endpointName: ep.name,
                            endpointUrl: ep.url,
                            endpointApiKey: ep.apiKey,
                            is_paused: isPaused,
                            is_connected: !isPaused && ep.status === 'online'
                        });
                    });
                }
            }

            const wasPreviouslyConnected = this.isConnected;
            this.accounts = allAccounts;
            this.isConnected = anyOnline;

            // Pick active account ID: prefer active on primary endpoint, or keep current if valid, else pick first
            if (primaryActiveId && this.accounts.some(a => a.id === primaryActiveId)) {
                this.activeAccountId = primaryActiveId;
            } else if (!this.accounts.some(a => a.id === this.activeAccountId)) {
                const firstActive = this.accounts.find(a => a.is_active && !a.is_paused);
                this.activeAccountId = firstActive ? firstActive.id : (this.accounts[0] ? this.accounts[0].id : null);
            }

            // Cache accounts to localStorage and update Symbol Search exchanges dynamically
            try {
                localStorage.setItem('mt5_accounts_cache', JSON.stringify(this.accounts));
                if (typeof configurationData !== 'undefined' && typeof window.getExchangesConfig === 'function') {
                    configurationData.exchanges = window.getExchangesConfig();
                }
            } catch (_) {}

            // Auto-Connect & Auto-Refresh: When connection is established/restored, auto-sync open chart & quotes!
            if (!wasPreviouslyConnected && anyOnline) {
                console.log(`[MT5API] ✓ Bridge Fleet Connected (${enabledEndpoints.filter(e => e.status === 'online').length} online)! Auto-syncing live chart & quotes...`);
                this.reconnectWebSocket();
                this.refreshActiveChart();
            }

            // Preload full symbol catalog into memory once connected for 0ms instant search
            if (!this._allSymbols && !this._loadingSymbolsPromise && anyOnline) {
                this.loadAllSymbolsCache();
            }

            // Preload symbols & history across all accounts for 0ms instant details
            this.preloadAllAccountsData();

            // Sync positions for active account
            if (this.activeAccountId) {
                this.fetchPositions(this.activeAccountId);
            }

            this.notifyAccountListeners();
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
                return;
            }

            this.ensureWebSocket();
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

            const firstWord = (target.server || target.nickname || 'MT5').split(/[-_\s]/)[0].toUpperCase();
            return firstWord || 'MT5';
        }

        getBrokerExchangeName(accOrServer = null) {
            if (!accOrServer) return this.getCleanBrokerExchange();
            if (typeof accOrServer === 'object') return this.getCleanBrokerExchange(accOrServer);
            if (typeof accOrServer === 'string') {
                const str = accOrServer.trim();
                const matched = this.accounts.find(a => 
                    String(a.id) === str || 
                    (a.server && a.server.toLowerCase() === str.toLowerCase()) ||
                    (a.nickname && a.nickname.toLowerCase() === str.toLowerCase())
                );
                if (matched) return this.getCleanBrokerExchange(matched);
                const raw = str.toUpperCase();
                if (raw.includes('FUNDEDNEXT')) return 'FUNDEDNEXT';
                if (raw.includes('FIVEPERCENT') || raw.includes('5ERS') || raw.includes('THE5ERS')) return 'THE 5%ERS';
                if (raw.includes('METAQUOTES')) return 'METAQUOTES';
                if (raw.includes('EXNESS')) return 'EXNESS';
                if (raw.includes('FTMO')) return 'FTMO';
                const firstWord = str.split(/[-_\s]/)[0].toUpperCase();
                return firstWord || 'MT5';
            }
            return 'MT5';
        }

        async isSymbolSupportedByAccount(ticker, accountId) {
            if (!ticker) return false;
            const q = ticker.toUpperCase().trim();

            if (!this._accountSymbolsCache) this._accountSymbolsCache = new Map();
            let symbols = this._accountSymbolsCache.get(accountId);

            if (!symbols) {
                try {
                    const ep = this.getEndpointForAccount(accountId);
                    if (ep && ep.url) {
                        const accParam = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
                        const res = await fetch(`${ep.url}/api/symbols${accParam}`, { headers: this.getReqHeaders(ep) });
                        if (res.ok) {
                            const data = await res.json();
                            symbols = data.symbols || [];
                            this._accountSymbolsCache.set(accountId, symbols);
                        }
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

        async preloadAllAccountsData() {
            if (!this.accounts || this.accounts.length === 0) return;
            for (const acc of this.accounts) {
                const accId = String(acc.id);
                const cached = this._accountSymbolsCache && this._accountSymbolsCache.get(accId);
                if (!cached || cached.length <= 2) {
                    try {
                        const localSyms = localStorage.getItem(`mt5_symbols_${accId}`);
                        if (localSyms) {
                            const parsed = JSON.parse(localSyms);
                            if (Array.isArray(parsed) && parsed.length > 2) {
                                if (!this._accountSymbolsCache) this._accountSymbolsCache = new Map();
                                this._accountSymbolsCache.set(accId, parsed);
                                continue;
                            } else {
                                localStorage.removeItem(`mt5_symbols_${accId}`);
                            }
                        }
                    } catch (_) {}

                    const ep = this.getEndpointForAccount(accId);
                    if (!ep || !ep.url) continue;

                    fetch(`${ep.url}/api/symbols?account_id=${encodeURIComponent(accId)}`, {
                        headers: this.getReqHeaders(ep)
                    }).then(r => r.ok ? r.json() : null).then(data => {
                        if (data && data.symbols && data.symbols.length > 2) {
                            if (!this._accountSymbolsCache) this._accountSymbolsCache = new Map();
                            this._accountSymbolsCache.set(accId, data.symbols);
                            try {
                                localStorage.setItem(`mt5_symbols_${accId}`, JSON.stringify(data.symbols));
                            } catch (_) {}
                        }
                    }).catch(() => {});
                }
            }
        }

        async setActiveAccount(id, onProgress = null, skipChartSwitch = false) {
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

                this.activeAccountId = id;
                this.accounts.forEach(a => {
                    a.is_active = (String(a.id) === String(id));
                });

                this.notifyAccountListeners();
                this.reconnectWebSocket();

                if (!skipChartSwitch) {
                    this.switchChartFeedToAccount(id);
                }

                report(5, `✓ Active Feed Switched!`, `Connected to ${accName} (${brokerName}). Live chart feed ready.`, 100);

                const ep = this.getEndpointForAccount(id);
                if (ep && ep.url) {
                    fetch(`${ep.url}/api/accounts/active`, {
                        method: 'POST',
                        headers: this.getReqHeaders(ep),
                        body: JSON.stringify({ account_id: id })
                    }).then(async res => {
                        if (res.ok) {
                            this.fetchPositions(id);
                            this.loadAllSymbolsCache();
                        }
                    }).catch(e => {
                        console.warn('[MT5API] Background active account switch note:', e.message);
                    });
                }

                return true;
            } catch (e) {
                console.error('[MT5API] Failed to set active account:', e);
                report(0, `Switch Error`, e.message || 'Connection failed', 0);
            }
            return false;
        }

        async switchChartFeedToAccount(accountId) {
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
            if (!chart && window.tvWidget && typeof window.tvWidget.chart === 'function') {
                try {
                    chart = window.tvWidget.chart();
                    if (chart && typeof chart.symbol === 'function') {
                        currentSymbol = chart.symbol();
                    }
                } catch (_) {}
            }

            if (!chart || !currentSymbol) return;

            const cleanTicker = currentSymbol.split('|')[0].split(':').pop().toUpperCase().trim();
            const isMt5 = this.isMt5Symbol(currentSymbol) || this.isMt5Symbol(cleanTicker);
            if (!isMt5) {
                return;
            }

            const targetAcc = this.accounts.find(a => String(a.id) === String(accountId)) || this.getActiveAccount();
            const newBrokerExchange = this.getCleanBrokerExchange(targetAcc);
            const targetSymbol = newBrokerExchange ? `${newBrokerExchange}:${cleanTicker}` : cleanTicker;

            console.log(`[MT5API] ⚡ Switching open chart feed from '${currentSymbol}' to '${targetSymbol}' (${targetAcc ? targetAcc.nickname : accountId})`);

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

            if (window.tvWidget && typeof window.tvWidget.resetCache === 'function') {
                try { window.tvWidget.resetCache(); } catch (_) {}
            }
            if (window._mt5ResetCallbacks) {
                window._mt5ResetCallbacks.forEach(cb => {
                    try { if (typeof cb === 'function') cb(); } catch (_) {}
                });
            }

            try {
                if (chart.symbol() !== targetSymbol && typeof chart.setSymbol === 'function') {
                    chart.setSymbol(targetSymbol);
                } else if (typeof chart.resetData === 'function') {
                    chart.resetData();
                }
            } catch (chartErr) {
                console.warn('[MT5API] Error updating chart on active account switch:', chartErr);
            }

            if (this.activeSymbol) {
                this.subscribeQuotes(this.activeSymbol, this.activeResolution);
            }
        }

        async fetchAccountFullDetails(accountId, onProgress = null) {
            const acc = this.accounts.find(a => String(a.id) === String(accountId)) || this.getActiveAccount();
            if (!acc) return null;

            if (onProgress) onProgress(1, 'Connecting to MT5 Profile', `Checking #${acc.login} (${acc.server})...`, 25);

            let symbols = [];
            if (!this._accountSymbolsCache) this._accountSymbolsCache = new Map();
            if (this._accountSymbolsCache.has(accountId)) {
                const cached = this._accountSymbolsCache.get(accountId);
                if (Array.isArray(cached) && cached.length > 2) {
                    symbols = cached;
                }
            }

            if (symbols.length <= 2) {
                try {
                    const localSyms = localStorage.getItem(`mt5_symbols_${accountId}`);
                    if (localSyms) {
                        const parsed = JSON.parse(localSyms);
                        if (Array.isArray(parsed) && parsed.length > 2) {
                            symbols = parsed;
                            this._accountSymbolsCache.set(accountId, symbols);
                        } else {
                            localStorage.removeItem(`mt5_symbols_${accountId}`);
                        }
                    }
                } catch (_) {}
            }

            if (symbols.length <= 2) {
                if (onProgress) onProgress(2, 'Loading Supported Tickers', 'Querying broker symbols and market watch...', 50);
                try {
                    const ep = this.getEndpointForAccount(accountId);
                    if (ep && ep.url) {
                        const accParam = `?account_id=${encodeURIComponent(accountId)}`;
                        const res = await fetch(`${ep.url}/api/symbols${accParam}`, {
                            headers: this.getReqHeaders(ep)
                        });
                        if (res.ok) {
                            const data = await res.json();
                            if (data.symbols && data.symbols.length > 2) {
                                symbols = data.symbols;
                                this._accountSymbolsCache.set(accountId, symbols);
                                try {
                                    localStorage.setItem(`mt5_symbols_${accountId}`, JSON.stringify(symbols));
                                } catch (_) {}
                            }
                        }
                    }
                } catch (e) {}
            } else {
                const ep = this.getEndpointForAccount(accountId);
                if (ep && ep.url) {
                    const accParam = `?account_id=${encodeURIComponent(accountId)}`;
                    fetch(`${ep.url}/api/symbols${accParam}`, { headers: this.getReqHeaders(ep) })
                        .then(r => r.ok ? r.json() : null)
                        .then(data => {
                            if (data && data.symbols && data.symbols.length > 2) {
                                this._accountSymbolsCache.set(accountId, data.symbols);
                                try {
                                    localStorage.setItem(`mt5_symbols_${accountId}`, JSON.stringify(data.symbols));
                                } catch (_) {}
                            }
                        }).catch(() => {});
                }
            }

            if (onProgress) onProgress(3, 'Fetching Active Positions', 'Retrieving open trades and floating PnL...', 75);
            let positions = [];
            try {
                positions = await this.fetchPositions(accountId);
            } catch (_) {
                positions = acc.positions || [];
            }

            if (onProgress) onProgress(4, 'Synchronizing Order History', 'Loading closed trade deals and performance metrics...', 90);
            let history = [];
            try {
                history = await this.fetchOrderHistory(accountId);
            } catch (_) {}

            let lastTradeTime = null;
            if (positions && positions.length > 0) {
                const times = positions.map(p => Number(p.time || 0) * 1000).filter(t => t > 0);
                if (times.length > 0) lastTradeTime = Math.max(...times);
            }
            if (!lastTradeTime && history && history.length > 0) {
                const histTimes = history.map(h => Number(h.time || 0)).filter(t => t > 0);
                if (histTimes.length > 0) lastTradeTime = Math.max(...histTimes);
            }

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
                lastTradeFormatted: lastTradeTime ? new Date(lastTradeTime).toLocaleString() : (acc.created_at ? `Account added: ${new Date(acc.created_at * 1000).toLocaleDateString()}` : 'Ready'),
                totalSymbols: symbols.length,
                fetchedAt: Date.now()
            };
        }

        async fetchOrderHistory(accountId = null) {
            const targetId = accountId || (this.getActiveAccount() ? this.getActiveAccount().id : null);
            let remoteHistory = [];

            try {
                const cached = localStorage.getItem(`mt5_history_cache_${targetId}`);
                if (cached) {
                    remoteHistory = JSON.parse(cached);
                }
            } catch (_) {}

            if (this._historyEndpointSupported !== false) {
                try {
                    const ep = this.getEndpointForAccount(targetId);
                    if (ep && ep.url) {
                        const accParam = targetId ? `?account_id=${encodeURIComponent(targetId)}&days=3650&limit=1000` : '?days=3650&limit=1000';
                        const res = await fetch(`${ep.url}/api/history${accParam}`, {
                            headers: this.getReqHeaders(ep)
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
                    }
                } catch (e) {}
            }

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

        // Master Client Vault Cryptographic Subsystem (AES-GCM-256 via Web Crypto API)
        async getVaultCryptoKey() {
            if (this._vaultCryptoKey) return this._vaultCryptoKey;
            if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
                return null;
            }
            try {
                let token = localStorage.getItem('mt5_vault_device_token');
                if (!token) {
                    const raw = new Uint8Array(32);
                    window.crypto.getRandomValues(raw);
                    token = btoa(String.fromCharCode(...raw));
                    localStorage.setItem('mt5_vault_device_token', token);
                }
                const rawKey = Uint8Array.from(atob(token), c => c.charCodeAt(0));
                this._vaultCryptoKey = await window.crypto.subtle.importKey(
                    'raw',
                    rawKey,
                    { name: 'AES-GCM' },
                    false,
                    ['encrypt', 'decrypt']
                );
                return this._vaultCryptoKey;
            } catch (e) {
                console.warn('[MT5API] Could not initialize vault key:', e);
                return null;
            }
        }

        async encryptVaultSecret(plaintext) {
            if (!plaintext) return '';
            if (typeof plaintext === 'string' && (plaintext.startsWith('enc:v1:') || plaintext.startsWith('b64:v1:'))) {
                return plaintext;
            }
            try {
                const key = await this.getVaultCryptoKey();
                if (!key) {
                    return 'b64:v1:' + btoa(unescape(encodeURIComponent(plaintext)));
                }
                const iv = new Uint8Array(12);
                window.crypto.getRandomValues(iv);
                const encoded = new TextEncoder().encode(plaintext);
                const ciphertext = await window.crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv },
                    key,
                    encoded
                );
                const ivB64 = btoa(String.fromCharCode(...iv));
                const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
                return `enc:v1:${ivB64}:${ctB64}`;
            } catch (e) {
                console.warn('[MT5API] Vault encryption fallback:', e);
                return 'b64:v1:' + btoa(unescape(encodeURIComponent(plaintext)));
            }
        }

        async decryptVaultSecret(encryptedStr) {
            if (!encryptedStr) return '';
            if (typeof encryptedStr !== 'string') return String(encryptedStr);

            if (!encryptedStr.startsWith('enc:v1:') && !encryptedStr.startsWith('b64:v1:')) {
                return encryptedStr;
            }

            try {
                if (encryptedStr.startsWith('b64:v1:')) {
                    return decodeURIComponent(escape(atob(encryptedStr.slice(7))));
                }

                const parts = encryptedStr.split(':');
                if (parts.length !== 4) return '';
                const ivB64 = parts[2];
                const ctB64 = parts[3];
                const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
                const ct = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));

                const key = await this.getVaultCryptoKey();
                if (!key) return '';

                const decrypted = await window.crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv },
                    key,
                    ct
                );
                return new TextDecoder().decode(decrypted);
            } catch (e) {
                console.warn('[MT5API] Failed to decrypt vault secret:', e);
                return '';
            }
        }

        // End-to-End (E2E) In-Transit Payload Encryption Subsystem (AES-GCM-256 via Bridge Secret)
        async deriveE2EKey(apiKey) {
            const secret = (apiKey || this.apiKey || 'mt5_secret_key_2026').trim();
            if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) return null;
            try {
                const rawKey = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
                return await window.crypto.subtle.importKey(
                    'raw',
                    rawKey,
                    { name: 'AES-GCM' },
                    false,
                    ['encrypt', 'decrypt']
                );
            } catch (e) {
                console.warn('[MT5API] Could not derive E2E key:', e);
                return null;
            }
        }

        async encryptE2EPayload(plaintext, apiKey) {
            if (!plaintext) return '';
            if (typeof plaintext === 'string' && plaintext.startsWith('e2e:v1:')) return plaintext;
            try {
                const key = await this.deriveE2EKey(apiKey);
                if (!key) return plaintext;
                const iv = new Uint8Array(12);
                window.crypto.getRandomValues(iv);
                const encoded = new TextEncoder().encode(plaintext);
                const ciphertext = await window.crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv },
                    key,
                    encoded
                );
                const ivB64 = btoa(String.fromCharCode(...iv));
                const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
                return `e2e:v1:${ivB64}:${ctB64}`;
            } catch (e) {
                console.warn('[MT5API] E2E payload encryption fallback:', e);
                return plaintext;
            }
        }

        async decryptE2EPayload(payload, apiKey) {
            if (!payload) return '';
            if (typeof payload !== 'string' || !payload.startsWith('e2e:v1:')) return payload;
            try {
                const parts = payload.split(':');
                if (parts.length !== 4) return payload;
                const ivB64 = parts[2];
                const ctB64 = parts[3];
                const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
                const ct = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));
                const key = await this.deriveE2EKey(apiKey);
                if (!key) return payload;
                const decrypted = await window.crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv },
                    key,
                    ct
                );
                return new TextDecoder().decode(decrypted);
            } catch (e) {
                console.warn('[MT5API] E2E payload decryption failed:', e);
                return payload;
            }
        }

        async saveAccountToClientVault(accountData, endpointTarget) {
            try {
                const raw = localStorage.getItem('mt5_client_vault');
                const vault = raw ? JSON.parse(raw) : [];
                const targetLogin = String(accountData.login || '').trim();
                const targetServer = (accountData.server || '').trim().toLowerCase();

                const idx = vault.findIndex(a => {
                    const aLogin = String(a.login || '').trim();
                    const aServer = (a.server || '').trim().toLowerCase();
                    return aLogin === targetLogin && (aServer === targetServer || aServer.includes(targetServer) || targetServer.includes(aServer));
                });
                const existing = idx >= 0 ? vault[idx] : null;

                let targets = [];
                if (Array.isArray(endpointTarget)) {
                    targets = endpointTarget;
                } else if (endpointTarget) {
                    targets = [endpointTarget];
                } else if (existing && Array.isArray(existing.targetEndpoints)) {
                    targets = existing.targetEndpoints;
                } else if (existing && existing.endpointId) {
                    targets = [existing.endpointId];
                }

                let encryptedPassword = '';
                if (accountData.password) {
                    encryptedPassword = await this.encryptVaultSecret(accountData.password);
                } else if (existing && existing.password) {
                    encryptedPassword = existing.password.startsWith('enc:v1:')
                        ? existing.password
                        : await this.encryptVaultSecret(existing.password);
                }

                const item = {
                    nickname: accountData.nickname || (existing ? existing.nickname : ''),
                    server: accountData.server || (existing ? existing.server : ''),
                    login: accountData.login || (existing ? existing.login : ''),
                    password: encryptedPassword,
                    lot_multiplier: accountData.lot_multiplier !== undefined ? accountData.lot_multiplier : (existing ? existing.lot_multiplier : 1.0),
                    risk_percent: accountData.risk_percent !== undefined ? accountData.risk_percent : (existing ? existing.risk_percent : 1.0),
                    targetEndpoints: targets,
                    endpointId: targets[0] || (existing ? existing.endpointId : null),
                    saved_at: Date.now()
                };
                if (idx >= 0) {
                    vault[idx] = item;
                } else {
                    vault.push(item);
                }
                localStorage.setItem('mt5_client_vault', JSON.stringify(vault));
            } catch (e) {
                console.error('[MT5API] Failed to save to client vault:', e);
            }
        }

        async getAccountPasswordFromVault(login, server) {
            const vault = this.getClientVault();
            const targetLogin = String(login || '').trim();
            const targetServer = (server || '').trim().toLowerCase();

            const entry = vault.find(a => {
                const aLogin = String(a.login || '').trim();
                const aServer = (a.server || '').trim().toLowerCase();
                return aLogin === targetLogin && (aServer === targetServer || aServer.includes(targetServer) || targetServer.includes(aServer));
            });

            if (!entry || !entry.password) return '';
            return await this.decryptVaultSecret(entry.password);
        }

        getClientVault() {
            try {
                const raw = localStorage.getItem('mt5_client_vault');
                return raw ? JSON.parse(raw) : [];
            } catch (_) {
                return [];
            }
        }

        async addAccount(accountData, endpointTarget = null) {
            try {
                let targets = [];
                if (Array.isArray(endpointTarget)) {
                    targets = endpointTarget;
                } else if (endpointTarget) {
                    targets = [endpointTarget];
                } else {
                    const active = this.getActiveEndpoint();
                    if (active) targets = [active.id];
                }

                if (targets.length === 0) {
                    return { success: false, error: 'No bridge endpoint available to add account to.' };
                }

                let lastSuccessAccount = null;
                const errors = [];
                const successfulTargets = [];

                for (const epId of targets) {
                    const ep = this.endpoints.find(e => e.id === epId);
                    if (!ep || !ep.url) continue;

                    try {
                        const bridgeApiKey = ep.apiKey || this.apiKey || 'mt5_secret_key_2026';
                        const encryptedPasswordForBridge = await this.encryptE2EPayload(accountData.password, bridgeApiKey);
                        const payload = {
                            ...accountData,
                            password: encryptedPasswordForBridge
                        };

                        const res = await fetch(`${ep.url}/api/accounts/add`, {
                            method: 'POST',
                            headers: this.getReqHeaders(ep),
                            body: JSON.stringify(payload)
                        });
                        const data = await res.json();
                        if (data.success) {
                            lastSuccessAccount = data.account;
                            successfulTargets.push(ep.id);
                        } else {
                            errors.push(`${ep.name}: ${data.error || 'Failed'}`);
                        }
                    } catch (err) {
                        errors.push(`${ep.name}: ${err.message}`);
                    }
                }

                if (successfulTargets.length > 0) {
                    // Master Client Vault: Persist securely in browser's local storage bounded to these bridges
                    await this.saveAccountToClientVault(accountData, successfulTargets);
                    await this.syncAccounts(true);
                    return { success: true, account: lastSuccessAccount, targets: successfulTargets };
                }

                return { success: false, error: errors.join('; ') || 'Failed to add account' };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

        async syncWorkingPasswordFromConnectedBridges(login, server) {
            const targetLogin = String(login || '').trim();
            const targetServer = (server || '').trim().toLowerCase();

            // Find all matching instances across connected accounts
            const matchingInstances = (this.accounts || []).filter(a => {
                const aLogin = String(a.login || '').trim();
                const aServer = (a.server || '').trim().toLowerCase();
                return aLogin === targetLogin && (aServer === targetServer || aServer.includes(targetServer) || targetServer.includes(aServer));
            });

            // Gather candidate endpoints: first from existing instances, then any online endpoint
            const candidateEndpoints = [];
            for (const inst of matchingInstances) {
                const ep = this.endpoints.find(e => e.id === inst.endpointId && e.enabled && e.status === 'online');
                if (ep && !candidateEndpoints.some(c => c.ep.id === ep.id)) {
                    candidateEndpoints.push({ ep, accountId: inst.id });
                }
            }
            for (const ep of this.endpoints) {
                if (ep.enabled && ep.status === 'online' && !candidateEndpoints.some(c => c.ep.id === ep.id)) {
                    candidateEndpoints.push({ ep, accountId: targetLogin });
                }
            }

            for (const { ep, accountId } of candidateEndpoints) {
                try {
                    const res = await fetch(`${ep.url}/api/accounts/${accountId}/credentials`, {
                        headers: this.getReqHeaders(ep),
                        signal: AbortSignal.timeout(4000)
                    });
                    if (!res.ok) continue;
                    const data = await res.json();
                    if (data && data.success && data.verified_working && data.password) {
                        const bridgeApiKey = ep.apiKey || this.apiKey || 'mt5_secret_key_2026';
                        const plainPassword = await this.decryptE2EPayload(data.password, bridgeApiKey);

                        // Found verified working credentials! Save into local vault encrypted with device token
                        await this.saveAccountToClientVault({
                            login: data.login || targetLogin,
                            server: data.server || targetServer,
                            nickname: data.nickname,
                            lot_multiplier: data.lot_multiplier,
                            risk_percent: data.risk_percent,
                            password: plainPassword
                        });
                        console.log(`[MT5API] ✓ Successfully synced verified working password for account #${targetLogin} from bridge '${ep.name}' with E2E payload decryption.`);
                        return {
                            success: true,
                            verified_working: true,
                            password: plainPassword,
                            sourceBridge: ep.name
                        };
                    }
                } catch (e) {
                    // Try next endpoint
                }
            }

            return {
                success: false,
                error: `No connected bridge currently has a verified active MT5 session for account #${targetLogin}.`
            };
        }

        async updateAccountBridgeRouting(login, server, newEndpointIds, manualPassword = '') {
            try {
                const targetLogin = String(login || '').trim();
                const targetServer = (server || '').trim().toLowerCase();

                const currentInstances = (this.accounts || []).filter(a => {
                    const aLogin = String(a.login || '').trim();
                    const aServer = (a.server || '').trim().toLowerCase();
                    return aLogin === targetLogin && (aServer === targetServer || aServer.includes(targetServer) || targetServer.includes(aServer));
                });
                const currentEndpointIds = currentInstances.map(a => a.endpointId);

                const toAdd = newEndpointIds.filter(id => !currentEndpointIds.includes(id));
                const toRemove = currentEndpointIds.filter(id => !newEndpointIds.includes(id));

                const errors = [];
                const added = [];
                const removed = [];
                let syncedFromBridge = null;

                // 1. Resolve password from manual input or local encrypted vault
                let password = (manualPassword || '').trim();
                if (!password) {
                    password = await this.getAccountPasswordFromVault(targetLogin, targetServer);
                }

                // 2. If adding new bridge and still no password in vault, attempt auto-sync from existing connected bridge!
                if (toAdd.length > 0 && !password) {
                    const syncRes = await this.syncWorkingPasswordFromConnectedBridges(targetLogin, targetServer);
                    if (syncRes.success && syncRes.password) {
                        password = syncRes.password;
                        syncedFromBridge = syncRes.sourceBridge;
                    }
                }

                if (toAdd.length > 0 && !password) {
                    return {
                        success: false,
                        error: 'Account password required to deploy credentials to newly authorized bridge server(s).'
                    };
                }

                const raw = localStorage.getItem('mt5_client_vault');
                const vault = raw ? JSON.parse(raw) : [];
                const idx = vault.findIndex(a => {
                    const aLogin = String(a.login || '').trim();
                    const aServer = (a.server || '').trim().toLowerCase();
                    return aLogin === targetLogin && (aServer === targetServer || aServer.includes(targetServer) || targetServer.includes(aServer));
                });
                const vaultItem = idx >= 0 ? vault[idx] : null;

                // Deploy to newly authorized bridge servers
                if (toAdd.length > 0) {
                    const nickname = vaultItem?.nickname || currentInstances[0]?.nickname || `MT5 ${login}`;
                    const lotMultiplier = vaultItem?.lot_multiplier ?? currentInstances[0]?.lot_multiplier ?? 1.0;
                    const riskPercent = vaultItem?.risk_percent ?? currentInstances[0]?.risk_percent ?? 1.0;

                    const accountData = {
                        nickname,
                        server,
                        login: Number(login),
                        password,
                        lot_multiplier: lotMultiplier,
                        risk_percent: riskPercent
                    };

                    for (const epId of toAdd) {
                        const ep = this.endpoints.find(e => e.id === epId);
                        if (!ep || !ep.url) continue;

                        try {
                            const bridgeApiKey = ep.apiKey || this.apiKey || 'mt5_secret_key_2026';
                            const encryptedPasswordForBridge = await this.encryptE2EPayload(password, bridgeApiKey);
                            const payload = {
                                ...accountData,
                                password: encryptedPasswordForBridge
                            };

                            const res = await fetch(`${ep.url}/api/accounts/add`, {
                                method: 'POST',
                                headers: this.getReqHeaders(ep),
                                body: JSON.stringify(payload)
                            });
                            const data = await res.json();
                            if (data.success) {
                                added.push(ep.name);
                            } else {
                                errors.push(`${ep.name}: ${data.error || 'Failed to add'}`);
                            }
                        } catch (err) {
                            errors.push(`${ep.name}: ${err.message}`);
                        }
                    }
                }

                // Revoke from unchecked bridge servers
                for (const epId of toRemove) {
                    const ep = this.endpoints.find(e => e.id === epId);
                    if (!ep || !ep.url) continue;

                    const inst = currentInstances.find(a => a.endpointId === epId);
                    if (inst && inst.id) {
                        try {
                            await fetch(`${ep.url}/api/accounts/${inst.id}`, {
                                method: 'DELETE',
                                headers: this.getReqHeaders(ep)
                            });
                            removed.push(ep.name);
                        } catch (err) {
                            console.warn(`[MT5API] Could not delete account from ${ep.name}:`, err);
                        }
                    }
                }

                // Update master client vault (encrypts password into AES-GCM before saving)
                await this.saveAccountToClientVault({
                    nickname: vaultItem?.nickname || currentInstances[0]?.nickname || `MT5 ${login}`,
                    server,
                    login: Number(login),
                    password: password || '',
                    lot_multiplier: vaultItem?.lot_multiplier ?? currentInstances[0]?.lot_multiplier ?? 1.0,
                    risk_percent: vaultItem?.risk_percent ?? currentInstances[0]?.risk_percent ?? 1.0,
                    targetEndpoints: newEndpointIds
                }, newEndpointIds);

                await this.syncAccounts(true);

                return {
                    success: errors.length === 0,
                    added,
                    removed,
                    syncedFromBridge,
                    errors
                };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

        async deleteAccount(id) {
            try {
                const ep = this.getEndpointForAccount(id);
                if (ep && ep.url) {
                    await fetch(`${ep.url}/api/accounts/${id}`, {
                        method: 'DELETE',
                        headers: this.getReqHeaders(ep)
                    });
                }
                // Also clean from client vault
                try {
                    const raw = localStorage.getItem('mt5_client_vault');
                    if (raw) {
                        const vault = JSON.parse(raw);
                        const filtered = vault.filter(a => String(a.id) !== String(id) && String(a.login) !== String(id));
                        localStorage.setItem('mt5_client_vault', JSON.stringify(filtered));
                    }
                } catch (_) {}
                await this.syncAccounts(true);
                return true;
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
                    const ep = this.getEndpointForAccount(acc ? acc.id : null);
                    if (!ep || !ep.url) return this.getMockSymbols();
                    const accParam = acc ? `?account_id=${encodeURIComponent(acc.id)}` : '';
                    const url = `${ep.url}/api/symbols${accParam}`;
                    const res = await fetch(url, { headers: this.getReqHeaders(ep) });
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

        async getSymbolsForAccount(accountId) {
            if (!accountId) return this._allSymbols || [];
            const accId = String(accountId);
            if (!this._accountSymbolsCache) this._accountSymbolsCache = new Map();

            // 1. In-memory cache hit
            if (this._accountSymbolsCache.has(accId)) {
                const mem = this._accountSymbolsCache.get(accId);
                if (Array.isArray(mem) && mem.length > 0) return mem;
            }

            // 2. localStorage cache hit
            try {
                const local = localStorage.getItem(`mt5_symbols_${accId}`);
                if (local) {
                    const parsed = JSON.parse(local);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        this._accountSymbolsCache.set(accId, parsed);
                        return parsed;
                    }
                }
            } catch (_) {}

            // 3. Direct network fetch from bridge
            try {
                const ep = this.getEndpointForAccount(accId);
                if (ep && ep.url) {
                    const res = await fetch(`${ep.url}/api/symbols?account_id=${encodeURIComponent(accId)}`, {
                        headers: this.getReqHeaders(ep),
                        signal: AbortSignal.timeout(10000)
                    });
                    if (res.ok) {
                        const data = await res.json();
                        const syms = data.symbols || [];
                        if (syms.length > 0) {
                            this._accountSymbolsCache.set(accId, syms);
                            try {
                                localStorage.setItem(`mt5_symbols_${accId}`, JSON.stringify(syms));
                            } catch (_) {}
                            return syms;
                        }
                    }
                }
            } catch (e) {
                console.warn(`[MT5API] Failed to fetch symbols for account ${accId}:`, e.message);
            }

            return this._allSymbols || this.getMockSymbols();
        }

        async fetchSymbols(search = '', category = '', targetAccountId = null) {
            let all = null;
            if (targetAccountId) {
                all = await this.getSymbolsForAccount(targetAccountId);
            } else {
                if (!this._allSymbols || this._allSymbols.length === 0) {
                    await this.loadAllSymbolsCache();
                }
                all = (this._allSymbols && this._allSymbols.length > 0) ? this._allSymbols : this.getMockSymbols();
            }

            if (!Array.isArray(all) || all.length === 0) {
                all = this.getMockSymbols();
            }

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

        async fetchSymbolInfo(symbol, targetAccountId = null) {
            const clean = (symbol || 'EURUSD').split(':').pop().toUpperCase().trim();
            if (this._symbolMap && this._symbolMap.has(clean)) {
                return this._symbolMap.get(clean);
            }
            try {
                const acc = targetAccountId 
                    ? (this.accounts.find(a => String(a.id) === String(targetAccountId)) || this.getActiveAccount())
                    : this.getActiveAccount();
                const ep = this.getEndpointForAccount(acc ? acc.id : null);
                if (!ep || !ep.url) return null;
                const accParam = acc ? `&account_id=${encodeURIComponent(acc.id)}` : '';
                const url = `${ep.url}/api/symbol_info?symbol=${encodeURIComponent(clean)}${accParam}`;
                const res = await fetch(url, { headers: this.getReqHeaders(ep) });
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
            const clean = s.split('|')[0].split(':').pop().trim();
            if (this._symbolMap && this._symbolMap.has(clean)) return true;
            const KNOWN_BROKERS = ['THE 5%ERS', 'FUNDEDNEXT', 'FTMO', 'EXNESS', 'IC MARKETS', 'PEPPERSTONE', 'VANTAGE', 'METAQUOTES', 'OCTAFX', 'XM', 'FBS', 'HFM', 'AVATRADE', 'ROBOFOREX', 'TICKMILL', 'FXPRO', 'IG'];
            if (KNOWN_BROKERS.some(b => s.startsWith(b + ':'))) return true;
            if (this.accounts && this.accounts.some(a => s.startsWith(this.getCleanBrokerExchange(a) + ':'))) return true;
            const POPULAR = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'XAUUSD', 'XAGUSD', 'US30', 'USTEC', 'US500', 'DE40', 'UK100', 'BTCUSD', 'ETHUSD', 'WTI', 'BRENT', 'XTIUSD', 'XBRUSD', 'USOIL', 'UKOIL', 'NGAS', 'NAS100', 'SP500', 'GER40', 'DJ30'];
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
        async fetchQuotes(symbols, targetAccountId = null) {
            if (!symbols || (Array.isArray(symbols) && symbols.length === 0)) return {};
            try {
                const symParam = Array.isArray(symbols) ? symbols.join(',') : symbols;
                const acc = targetAccountId 
                    ? (this.accounts.find(a => String(a.id) === String(targetAccountId)) || this.getActiveAccount())
                    : this.getActiveAccount();
                const ep = this.getEndpointForAccount(acc ? acc.id : null);
                if (!ep || !ep.url) return {};
                const accParam = acc ? `&account_id=${encodeURIComponent(acc.id)}` : '';
                const url = `${ep.url}/api/quotes?symbols=${encodeURIComponent(symParam)}${accParam}`;
                const res = await fetch(url, { headers: this.getReqHeaders(ep) });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const quotes = data.quotes || {};

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

        async fetchBars(symbol, resolution, from = null, to = null, count = 500, accountId = null) {
            try {
                const cleanSym = (symbol || 'EURUSD').split(':').pop();
                const acc = accountId 
                    ? (this.accounts.find(a => String(a.id) === String(accountId)) || this.getActiveAccount())
                    : this.getActiveAccount();
                const accParam = acc ? `&account_id=${encodeURIComponent(acc.id)}` : '';
                let rangeParams = '';
                if (from && to) {
                    rangeParams = `&from=${Math.floor(from)}&to=${Math.ceil(to)}`;
                }
                const ep = this.getEndpointForAccount(acc ? acc.id : null);
                if (!ep || !ep.url) return [];
                const url = `${ep.url}/api/bars?symbol=${encodeURIComponent(cleanSym)}&resolution=${encodeURIComponent(resolution)}&count=${count}${rangeParams}${accParam}`;
                const res = await fetch(url, { headers: this.getReqHeaders(ep) });
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

        // --- Real-Time Multi-Bridge WebSocket Quote Streams ---
        subscribeQuotes(symbol, resolution, callback, accountId = null) {
            if (typeof resolution === 'function') {
                callback = resolution;
                resolution = null;
            }
            const clean = (symbol || '').split(':').pop().toUpperCase().trim();
            if (clean && !this.isMt5Symbol(clean)) {
                return;
            }
            if (clean) {
                this.activeSymbol = clean;
            }
            if (resolution) {
                this.activeResolution = String(resolution);
            }
            if (callback) {
                this.tickListeners.add(callback);
            }
            this.ensureWebSocket();
            this.startFallbackTickPolling();

            let targetAcc = null;
            if (accountId && this.accounts) {
                targetAcc = this.accounts.find(a => String(a.id) === String(accountId));
            }
            if (!targetAcc) {
                targetAcc = this.getActiveAccount();
            }

            this.wsSockets.forEach((socket) => {
                if (socket && socket.readyState === WebSocket.OPEN) {
                    try {
                        socket.send(JSON.stringify({
                            action: 'subscribe',
                            symbol: this.activeSymbol,
                            resolution: this.activeResolution || '1',
                            account_id: targetAcc ? targetAcc.id : null
                        }));
                    } catch (_) {}
                }
            });
        }

        unsubscribeQuotes(callback) {
            this.tickListeners.delete(callback);
        }

        startFallbackTickPolling() {
            if (this._fallbackTickTimer) return;
            this._fallbackTickTimer = setInterval(async () => {
                if (!this.endpoints || this.endpoints.length === 0 || !this.tickListeners || this.tickListeners.size === 0) return;
                if (!this.activeSymbol || !this.isMt5Symbol(this.activeSymbol)) return;

                if (Date.now() - (this._lastTickReceivedTime || 0) < 1800) {
                    return;
                }

                try {
                    const acc = this.getActiveAccount();
                    const ep = this.getEndpointForAccount(acc ? acc.id : null);
                    if (!ep || !ep.url) return;
                    const accParam = acc ? `&account_id=${encodeURIComponent(acc.id)}` : '';
                    const url = `${ep.url}/api/tick?symbol=${encodeURIComponent(this.activeSymbol)}&resolution=${encodeURIComponent(this.activeResolution || '1')}${accParam}`;
                    const res = await fetch(url, { headers: this.getReqHeaders(ep) });
                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.success) {
                            this._lastTickReceivedTime = Date.now();
                            const tickMsg = { type: 'tick', ...data };
                            this.tickListeners.forEach(cb => {
                                try { cb(tickMsg); } catch (_) {}
                            });
                        }
                    }
                } catch (_) {}
            }, 1000);
        }

        ensureWebSocket() {
            const enabledEndpoints = (this.endpoints || []).filter(e => e.enabled && e.status !== 'offline');
            if (enabledEndpoints.length === 0) return;

            enabledEndpoints.forEach(ep => {
                let socket = this.wsSockets.get(ep.id);
                if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
                    return;
                }

                try {
                    const wsProto = ep.url.startsWith('https') ? 'wss:' : 'ws:';
                    const host = ep.url.replace(/^https?:\/\//, '');
                    const wsUrl = `${wsProto}//${host}/ws/quotes`;

                    socket = new WebSocket(wsUrl);
                    this.wsSockets.set(ep.id, socket);
                    if (ep.id === this.activeEndpointId || !this.ws) {
                        this.ws = socket;
                    }

                    let pingTimer = null;
                    const sendLivePing = () => {
                        if (socket.readyState === WebSocket.OPEN) {
                            try {
                                socket.send(JSON.stringify({ action: 'ping', t: performance.now() }));
                            } catch (_) {}
                        }
                    };

                    socket.onopen = () => {
                        if (socket.readyState !== WebSocket.OPEN) return;
                        const acc = this.getActiveAccount();
                        const handshake = {
                            action: 'subscribe',
                            symbol: this.activeSymbol,
                            resolution: this.activeResolution || '1',
                            token: ep.apiKey,
                            account_id: acc ? acc.id : null
                        };
                        try {
                            socket.send(JSON.stringify(handshake));
                        } catch (_) {}

                        // Send instant ping and schedule continuous 2.5s live ping heartbeat
                        sendLivePing();
                        if (pingTimer) clearInterval(pingTimer);
                        pingTimer = setInterval(sendLivePing, 2500);
                    };

                    socket.onmessage = (evt) => {
                        try {
                            const msg = JSON.parse(evt.data);
                            if (msg.type === 'pong' && msg.t) {
                                const livePing = Math.round(performance.now() - Number(msg.t));
                                ep.ping = livePing;
                                ep.status = 'online';
                                if (ep.id === this.activeEndpointId) {
                                    this.pingMs = livePing;
                                }
                                this.notifyPingListeners(ep.id, livePing);
                            } else if (msg.type === 'tick') {
                                this._lastTickReceivedTime = Date.now();
                                this.tickListeners.forEach(cb => {
                                    try { cb(msg); } catch (_) {}
                                });
                            } else if (msg.type === 'positions') {
                                const newPositions = msg.positions || [];
                                const accId = msg.account_id || (this.getActiveAccount() ? this.getActiveAccount().id : null);
                                this.processPositionDiff(accId, newPositions);
                                if (!accId || (this.getActiveAccount() && this.getActiveAccount().id === accId)) {
                                    this.positions = newPositions;
                                    this.notifyPositionListeners();
                                }
                            } else if (msg.type === 'tunnel_migration' && msg.new_url) {
                                console.log(`[MT5API] 🚀 In-band tunnel migration event received for ${ep.name}: ${msg.new_url}`);
                                ep.url = String(msg.new_url).trim().replace(/\/+$/, '');
                                this.saveConfig();
                                this.reconnectWebSocket(ep.id);
                                this.testSingleEndpoint(ep.id);
                            }
                        } catch (_) {}
                    };

                    socket.onclose = () => {
                        if (pingTimer) {
                            clearInterval(pingTimer);
                            pingTimer = null;
                        }
                        this.wsSockets.delete(ep.id);
                        if (this.ws === socket) this.ws = null;
                        // Auto-discover via Gist if WebSocket dropped unexpectedly
                        this.syncFromGist();
                        setTimeout(() => {
                            if (this.tickListeners && this.tickListeners.size > 0 && ep.enabled) {
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
                    console.warn(`[MT5API] WebSocket init error for ${ep.name}:`, err);
                }
            });
        }

        reconnectWebSocket() {
            this.wsSockets.forEach((sock) => {
                try {
                    sock.onclose = null;
                    sock.close();
                } catch (_) {}
            });
            this.wsSockets.clear();
            this.ws = null;
            if (this.tickListeners && this.tickListeners.size > 0) {
                this.ensureWebSocket();
            }
        }

        // --- Orders & Positions Execution ---
        async fetchPositions(accountId = null) {
            if (accountId) {
                const ep = this.getEndpointForAccount(accountId);
                if (!ep || !ep.url) return [];
                try {
                    const accParam = `?account_id=${encodeURIComponent(accountId)}`;
                    const res = await fetch(`${ep.url}/api/positions${accParam}`, {
                        headers: this.getReqHeaders(ep)
                    });
                    if (res.ok) {
                        const data = await res.json();
                        const pos = data.positions || [];
                        this.processPositionDiff(accountId, pos);
                        if (!this.activeAccountId || this.activeAccountId === accountId) {
                            this.positions = pos;
                            this.notifyPositionListeners();
                        }
                        return pos;
                    }
                } catch (e) {}
                const acc = this.accounts.find(a => String(a.id) === String(accountId));
                return (acc && acc.positions) ? acc.positions : [];
            }

            // Global parallel sync: fetch positions from all online enabled endpoints
            const enabledEndpoints = (this.endpoints || []).filter(e => e.enabled && e.status !== 'offline');
            if (enabledEndpoints.length === 0) return this.positions || [];

            const allPromises = enabledEndpoints.map(async ep => {
                try {
                    const res = await fetch(`${ep.url}/api/positions`, {
                        headers: this.getReqHeaders(ep),
                        signal: AbortSignal.timeout(4000)
                    });
                    if (res.ok) {
                        const data = await res.json();
                        return (data.positions || []).map(p => ({
                            ...p,
                            endpointId: ep.id,
                            endpointName: ep.name
                        }));
                    }
                } catch (_) {}
                return [];
            });

            const results = await Promise.allSettled(allPromises);
            const combinedPositions = [];
            for (const r of results) {
                if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                    combinedPositions.push(...r.value);
                }
            }

            const activeAcc = this.getActiveAccount();
            if (activeAcc) {
                this.positions = combinedPositions.filter(p => String(p.account_id) === String(activeAcc.id) || !p.account_id);
            } else {
                this.positions = combinedPositions;
            }
            this.notifyPositionListeners();
            return combinedPositions;
        }

        async placeOrder({ symbol, type, orderType = 'market', price = 0.0, lots, sl = 0.0, tp = 0.0, comment = "TV Order", accountId = null }) {
            try {
                const targetAcc = accountId || this.activeAccountId;
                if (targetAcc && this.isAccountPaused(targetAcc)) {
                    return { success: false, error: 'Cannot place order: This account is currently paused (Standby mode). Click Resume in MT5 Fleet first.' };
                }
                const ep = this.getEndpointForAccount(targetAcc);
                if (!ep || !ep.url) {
                    return { success: false, error: 'Bridge endpoint is not configured or offline for this account.' };
                }
                const cleanSym = (symbol || 'EURUSD').split(':').pop();
                let effectiveType = type.toUpperCase();
                if (orderType === 'limit') {
                    effectiveType = effectiveType === 'BUY' ? 'BUY_LIMIT' : 'SELL_LIMIT';
                } else if (orderType === 'stop') {
                    effectiveType = effectiveType === 'BUY' ? 'BUY_STOP' : 'SELL_STOP';
                }
                const res = await fetch(`${ep.url}/api/orders/place`, {
                    method: 'POST',
                    headers: this.getReqHeaders(ep),
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
                await this.fetchPositions(targetAcc);
                return data;
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

        async modifyPosition({ ticket, sl, tp, accountId = null }) {
            try {
                const targetAcc = accountId || this.activeAccountId;
                const ep = this.getEndpointForAccount(targetAcc);
                if (!ep || !ep.url) return { success: false, error: 'Bridge endpoint offline' };
                const res = await fetch(`${ep.url}/api/orders/modify`, {
                    method: 'POST',
                    headers: this.getReqHeaders(ep),
                    body: JSON.stringify({
                        account_id: targetAcc,
                        ticket: Number(ticket),
                        sl: Number(sl),
                        tp: Number(tp)
                    })
                });
                const data = await res.json();
                await this.fetchPositions(targetAcc);
                return data;
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

        async closePosition({ ticket, lots = null, accountId = null }) {
            try {
                const targetAcc = accountId || this.activeAccountId;
                const ep = this.getEndpointForAccount(targetAcc);
                if (!ep || !ep.url) return { success: false, error: 'Bridge endpoint offline' };
                const res = await fetch(`${ep.url}/api/orders/close`, {
                    method: 'POST',
                    headers: this.getReqHeaders(ep),
                    body: JSON.stringify({
                        account_id: targetAcc,
                        ticket: Number(ticket),
                        lots: lots ? Number(lots) : null
                    })
                });
                const data = await res.json();
                await this.fetchPositions(targetAcc);
                return data;
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

        // --- Multi-Bridge Parallel Broadcast Execution ---
        async broadcastOrder({ accountIds, symbol, type, baseLots, sl = 0.0, tp = 0.0 }) {
            try {
                const activeAccountIds = (accountIds || []).filter(id => !this.isAccountPaused(id));
                if (activeAccountIds.length === 0) {
                    return { success: false, error: 'No active accounts selected for order broadcast (selected accounts are paused in standby mode).' };
                }
                const cleanSym = (symbol || 'EURUSD').split(':').pop();

                // Group accounts by endpoint
                const endpointMap = new Map();
                for (const accId of activeAccountIds) {
                    const ep = this.getEndpointForAccount(accId);
                    if (!ep || !ep.url) continue;
                    if (!endpointMap.has(ep.id)) {
                        endpointMap.set(ep.id, { ep, accIds: [] });
                    }
                    endpointMap.get(ep.id).accIds.push(accId);
                }

                if (endpointMap.size === 0) {
                    return { success: false, error: 'No active bridge endpoints reachable for selected accounts.' };
                }

                const requests = Array.from(endpointMap.values()).map(async ({ ep, accIds }) => {
                    try {
                        const res = await fetch(`${ep.url}/api/orders/broadcast`, {
                            method: 'POST',
                            headers: this.getReqHeaders(ep),
                            body: JSON.stringify({
                                account_ids: accIds,
                                symbol: cleanSym,
                                type: type.toUpperCase(),
                                base_lots: Number(baseLots),
                                sl: Number(sl) || 0.0,
                                tp: Number(tp) || 0.0
                            })
                        });
                        const data = await res.json();
                        return { ep, data };
                    } catch (err) {
                        return { ep, data: { success: false, error: err.message, results: [] } };
                    }
                });

                const settled = await Promise.allSettled(requests);
                const aggregatedResults = [];
                let totalSuccessful = 0;
                let totalFailed = 0;

                for (const s of settled) {
                    if (s.status === 'fulfilled' && s.value.data) {
                        const d = s.value.data;
                        if (Array.isArray(d.results)) {
                            aggregatedResults.push(...d.results);
                            totalSuccessful += (d.successful || 0);
                            totalFailed += (d.failed || 0);
                        } else if (d.success) {
                            totalSuccessful++;
                            aggregatedResults.push(d);
                        } else {
                            totalFailed++;
                            aggregatedResults.push(d);
                        }
                    }
                }

                await this.fetchPositions();
                return {
                    success: totalSuccessful > 0,
                    successful: totalSuccessful,
                    failed: totalFailed,
                    results: aggregatedResults
                };
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

        onPing(cb) {
            if (typeof cb === 'function') this.pingListeners.add(cb);
        }

        offPing(cb) {
            this.pingListeners.delete(cb);
        }

        notifyPingListeners(endpointId, pingMs) {
            this.pingListeners.forEach(cb => {
                try { cb(endpointId, pingMs); } catch (_) {}
            });
        }

        processPositionDiff(accountId, newPositions = []) {
            const acc = this.accounts.find(a => String(a.id) === String(accountId)) || this.getActiveAccount();
            const accName = acc ? acc.nickname : `Account #${accountId || ''}`;
            const accIdStr = String(accountId || (acc ? acc.id : 'default'));

            if (!this._accountPositionsMap) this._accountPositionsMap = new Map();
            const prevPositions = this._accountPositionsMap.get(accIdStr);

            if (!prevPositions) {
                // Initial baseline snapshot for this specific account
                const map = new Map();
                newPositions.forEach(p => {
                    map.set(String(p.ticket), p);
                });
                this._accountPositionsMap.set(accIdStr, map);
                return;
            }

            const currentTickets = new Set();

            // 1. Check for newly opened positions
            newPositions.forEach(p => {
                const ticketKey = String(p.ticket);
                currentTickets.add(ticketKey);
                if (!prevPositions.has(ticketKey)) {
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
                    const oldP = prevPositions.get(ticketKey);
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
            prevPositions.forEach((oldP, ticketKey) => {
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

            // Refresh map for this specific account
            const updatedMap = new Map();
            newPositions.forEach(p => {
                updatedMap.set(String(p.ticket), p);
            });
            this._accountPositionsMap.set(accIdStr, updatedMap);
        }
    }

    // Export singleton
    window.MT5API = new MT5Client();

})(window);
