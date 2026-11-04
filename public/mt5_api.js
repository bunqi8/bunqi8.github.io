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
            this.masterGistToken = '';
            this._decryptPromise = null;
            this._secretsDecrypted = false;
            this.wsSockets = new Map();
            this._wsPendingRequests = new Map();
            this.loadConfig();

            this.accounts = [];
            this.activeAccountId = null;
            try {
                const cachedAccs = localStorage.getItem('mt5_accounts_cache');
                if (cachedAccs) {
                    const parsed = JSON.parse(cachedAccs);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        this.accounts = parsed;
                        const firstActive = this.accounts.find(a => a.is_active && !a.is_paused);
                        this.activeAccountId = firstActive ? firstActive.id : (this.accounts[0] ? this.accounts[0].id : null);
                    }
                }
            } catch (_) {}
            this.positions = [];
            this.ws = null;
            this.activeSymbol = 'EURUSD';
            this.tickListeners = new Map();
            // Compatibility shim for Set-like .add() invocations across legacy UI modules
            this.tickListeners.add = (cb) => {
                if (typeof cb === 'function') this.tickListeners.set(cb, {});
            };
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

            // Self-Healing 24/7 Watchdog: Heartbeat, zombie socket detector, and un-killable connection guardian
            this._selfHealingTimer = null;
            this.initSelfHealingWatchdog();

            // Listen for system network recovery, tab visibility change, and window focus
            if (typeof window !== 'undefined') {
                const triggerWake = () => {
                    const elapsed = Date.now() - (this._lastVisibleTs || Date.now());
                    if (elapsed > 3000) {
                        const isMajorWake = elapsed > 15000;
                        console.log(`[MT5API] ⚡ System resume event detected (${Math.round(elapsed / 1000)}s sleep)! Executing self-healing sync...`);
                        this.executeSelfHealingWakeRoutine(isMajorWake);
                    }
                    this._lastVisibleTs = Date.now();
                };

                window.addEventListener('online', () => {
                    console.log('[MT5API] 🌐 Network back online! Reconnecting bridge sockets & syncing positions...');
                    this.executeSelfHealingWakeRoutine(true);
                });

                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        triggerWake();
                    } else {
                        this._lastVisibleTs = Date.now();
                    }
                });

                window.addEventListener('focus', () => {
                    triggerWake();
                });
            }
        }

        whenAccountsReady(timeoutMs = 6000) {
            if (this.accounts && this.accounts.length > 0) {
                return Promise.resolve(this.accounts);
            }
            if (!this._accountsReadyPromise) {
                this._accountsReadyPromise = new Promise((resolve) => {
                    this._resolveAccountsReady = resolve;
                    setTimeout(() => {
                        resolve(this.accounts || []);
                    }, timeoutMs);
                });
            }
            return this._accountsReadyPromise;
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
                this.masterGistToken = cfg.masterGistToken || '';
                this.activeEndpointId = cfg.activeEndpointId || (this.endpoints[0] ? this.endpoints[0].id : null);
                this.multiAccountSelection = new Set(cfg.multiAccountSelection || []);
                this.pausedAccountIds = new Set(cfg.pausedAccountIds || []);
            } catch (_) {
                this.endpoints = [];
                this.masterGistToken = '';
                this.activeEndpointId = null;
                this.multiAccountSelection = new Set();
                this.pausedAccountIds = new Set();
            }

            // Immediately kick off asynchronous decryption of encrypted secrets in background
            this.decryptConfigSecrets();

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

        async decryptConfigSecrets() {
            if (this._decryptPromise) return this._decryptPromise;
            this._decryptPromise = (async () => {
                try {
                    if (this.masterGistToken && (this.masterGistToken.startsWith('enc:v1:') || this.masterGistToken.startsWith('b64:v1:'))) {
                        this.masterGistToken = await this.decryptVaultSecret(this.masterGistToken);
                    }
                    for (const ep of (this.endpoints || [])) {
                        if (ep.apiKey && (ep.apiKey.startsWith('enc:v1:') || ep.apiKey.startsWith('b64:v1:'))) {
                            ep.apiKey = await this.decryptVaultSecret(ep.apiKey);
                        }
                        if (ep.shieldToken && (ep.shieldToken.startsWith('enc:v1:') || ep.shieldToken.startsWith('b64:v1:'))) {
                            ep.shieldToken = await this.decryptVaultSecret(ep.shieldToken);
                        }
                        if (ep.gistId && (ep.gistId.startsWith('enc:v1:') || ep.gistId.startsWith('b64:v1:'))) {
                            ep.gistId = await this.decryptVaultSecret(ep.gistId);
                        }
                        if (ep.gistToken && (ep.gistToken.startsWith('enc:v1:') || ep.gistToken.startsWith('b64:v1:'))) {
                            ep.gistToken = await this.decryptVaultSecret(ep.gistToken);
                        }
                    }
                    this._secretsDecrypted = true;
                } catch (e) {
                    console.warn('[MT5API] Error decrypting config secrets:', e);
                }
            })();
            return this._decryptPromise;
        }

        async ensureSecretsDecrypted() {
            if (this._decryptPromise) await this._decryptPromise;
        }

        async saveConfig() {
            try {
                const encryptedEndpoints = await Promise.all((this.endpoints || []).map(async (e) => {
                    const encApiKey = e.apiKey ? await this.encryptVaultSecret(e.apiKey) : '';
                    const encShieldToken = e.shieldToken ? await this.encryptVaultSecret(e.shieldToken) : '';
                    const encGistId = e.gistId ? await this.encryptVaultSecret(e.gistId) : '';
                    const encGistToken = e.gistToken ? await this.encryptVaultSecret(e.gistToken) : '';
                    return {
                        id: e.id,
                        name: e.name,
                        url: e.url,
                        apiKey: encApiKey,
                        shieldToken: encShieldToken,
                        gistId: encGistId,
                        gistToken: encGistToken,
                        enabled: e.enabled !== false,
                        status: e.status || 'unknown',
                        ping: e.ping || 0,
                        error: e.error || null
                    };
                }));

                const encMasterToken = this.masterGistToken ? await this.encryptVaultSecret(this.masterGistToken) : '';

                const payload = {
                    endpoints: encryptedEndpoints,
                    masterGistToken: encMasterToken,
                    activeEndpointId: this.activeEndpointId,
                    endpoint: this.endpoint,
                    multiAccountSelection: Array.from(this.multiAccountSelection || []),
                    pausedAccountIds: Array.from(this.pausedAccountIds || [])
                };
                localStorage.setItem(this.configKey, JSON.stringify(payload));
            } catch (e) {
                console.error('[MT5API] Failed to save config:', e);
            }
        }

        // --- Master GitHub Gist Token Subsystem ---
        getMasterGistToken() {
            return this.masterGistToken || '';
        }

        hasMasterGistToken() {
            return Boolean(this.masterGistToken && this.masterGistToken.trim());
        }

        async setMasterGistToken(token) {
            await this.ensureSecretsDecrypted();
            this.masterGistToken = (token || '').trim();
            await this.saveConfig();
            this.syncAllEndpointsFromGist(false).then(() => this.syncAccounts(true));
            return true;
        }

        async clearMasterGistToken() {
            await this.ensureSecretsDecrypted();
            this.masterGistToken = '';
            await this.saveConfig();
            this.syncAccounts(true);
            return true;
        }

        getEndpointGistToken(endpointId) {
            const ep = (this.endpoints || []).find(e => e.id === endpointId);
            if (ep && ep.gistToken && ep.gistToken.trim()) {
                return ep.gistToken.trim();
            }
            return (this.masterGistToken || '').trim();
        }

        // --- Multi-Bridge Endpoint Management ---
        getEndpoints() {
            return this.endpoints || [];
        }

        async syncEndpointFromGist(endpointId, testEndpoint = false) {
            await this.ensureSecretsDecrypted();
            const ep = (this.endpoints || []).find(e => e.id === endpointId);
            const token = this.getEndpointGistToken(endpointId);
            if (!ep || !ep.gistId) {
                return { success: false, reason: 'Gist ID not configured for this bridge' };
            }

            try {
                const url = `https://api.github.com/gists/${ep.gistId.trim()}?t=${Date.now()}`;
                const headers = {
                    'Accept': 'application/vnd.github.v3+json'
                };
                if (token && token.trim()) {
                    headers['Authorization'] = `token ${token.trim()}`;
                }
                const res = await fetch(url, { headers });
                if (!res.ok) throw new Error(`GitHub Gist HTTP ${res.status}`);
                const data = await res.json();
                const files = data.files || {};

                // Look for bridge_endpoint.json or mt5_bridges.json or first .json file in Gist
                let rawContent = null;
                if (files['bridge_endpoint.json'] && files['bridge_endpoint.json'].content) {
                    rawContent = files['bridge_endpoint.json'].content;
                } else if (files['mt5_bridges.json'] && files['mt5_bridges.json'].content) {
                    rawContent = files['mt5_bridges.json'].content;
                } else {
                    const firstJson = Object.values(files).find(f => f.filename && f.filename.endsWith('.json') && f.content);
                    if (firstJson) rawContent = firstJson.content;
                }

                if (!rawContent) throw new Error('No valid JSON endpoint data found in Gist');
                const parsed = JSON.parse(rawContent);

                // Extract encrypted vault or URL payload
                let targetBlob = parsed.vault || parsed.payload || parsed.endpoint_url || parsed.url;
                if (!targetBlob && parsed.bridges) {
                    const matching = Object.values(parsed.bridges).find(b => b && (b.vault || b.payload || b.endpoint_url || b.url));
                    if (matching) targetBlob = matching.vault || matching.payload || matching.endpoint_url || matching.url;
                }

                if (!targetBlob) throw new Error('No encrypted vault payload found in Gist');

                const vaultData = await this.decryptE2EVault(targetBlob, ep.apiKey);
                if (!vaultData || vaultData.error) {
                    throw new Error('Failed to decrypt Gist vault. Check the bridge API key.');
                }

                const decryptedUrl = vaultData.endpoint_url || vaultData.url || (typeof vaultData === 'string' ? vaultData : '');
                if (!decryptedUrl || !decryptedUrl.startsWith('http')) {
                    throw new Error('Invalid endpoint URL inside decrypted Gist vault.');
                }

                const clean = decryptedUrl.trim().replace(/\/+$/, '');
                const changed = clean !== ep.url;
                if (changed) {
                    console.log(`[MT5API] 🔄 Auto-Discovery: Updated ${ep.name} URL: ${ep.url} -> ${clean}`);
                    ep.url = clean;
                }
                if (vaultData.shield_token && vaultData.shield_token !== ep.shieldToken) {
                    ep.shieldToken = vaultData.shield_token;
                }
                if (vaultData.shield_date) ep.shieldDate = vaultData.shield_date;
                if (vaultData.autoHealedKey && vaultData.autoHealedKey !== ep.apiKey) {
                    console.log(`[MT5API] Auto-healed bridge ${ep.name} API key OCR typos: ${ep.apiKey} -> ${vaultData.autoHealedKey}`);
                    ep.apiKey = vaultData.autoHealedKey;
                }
                if (changed || (vaultData.shield_token && vaultData.shield_token !== ep.shieldToken)) {
                    ep.status = 'unknown';
                    ep.ping = 0;
                    this.saveConfig();
                    this.reconnectWebSocket(ep.id);
                    if (testEndpoint) {
                        await this.testSingleEndpoint(ep.id);
                    }
                }
                return { success: true, url: clean, changed };
            } catch (err) {
                console.warn(`[MT5API] Gist sync failed for ${ep.name}:`, err);
                return { success: false, error: err.message };
            }
        }

        async syncAllEndpointsFromGist(testEndpoints = false) {
            await this.ensureSecretsDecrypted();
            const configured = (this.endpoints || []).filter(e => e.gistId && this.getEndpointGistToken(e.id));
            if (configured.length === 0) return { total: 0, updated: 0 };
            const results = await Promise.all(configured.map(e => this.syncEndpointFromGist(e.id, testEndpoints)));
            const updated = results.filter(r => r.success && r.changed).length;
            return { total: configured.length, updated };
        }

        getActiveEndpoint() {
            if (!this.endpoints || this.endpoints.length === 0) return null;
            // Only consider endpoints that are enabled, online, and NOT unauthorized
            const viable = this.endpoints.filter(e => e.enabled && e.status === 'online' && e.status !== 'unauthorized');
            if (viable.length === 0) return null;

            // An endpoint is only active for general market queries IF it actually has added & enabled accounts!
            const withAccounts = viable.filter(e => 
                (this.accounts || []).some(a => (a.endpointId === e.id || a.endpointUrl === e.url) && !this.isAccountPaused(a.id))
            );

            if (this.activeEndpointId) {
                const matched = withAccounts.find(e => e.id === this.activeEndpointId);
                if (matched) return matched;
            }

            if (withAccounts.length > 0) return withAccounts[0];

            // If no online bridge has added accounts, do NOT arbitrarily return an empty or offline bridge
            return null;
        }

        getEndpointForAccount(accountId) {
            if (accountId && this.accounts) {
                let acc = this.accounts.find(a => String(a.id) === String(accountId));
                if (!acc) {
                    const cleanId = String(accountId).replace(/^mt5_/, '');
                    acc = this.accounts.find(a => String(a.login) === cleanId || String(a.id).replace(/^mt5_/, '') === cleanId);
                }
                if (acc) {
                    // Check if this account is paused
                    if (acc.is_paused || this.isAccountPaused(acc.id)) {
                        return null;
                    }

                    const accLogin = String(acc.login || '').trim();
                    const accServer = (acc.server || '').trim().toLowerCase();

                    // Collect all candidate instances for this physical account across all bridges
                    const candidates = this.accounts.filter(a => {
                        if (String(a.id) === String(acc.id)) return true;
                        if (accLogin && String(a.login || '').trim() === accLogin) {
                            if (!accServer || !a.server || (a.server || '').trim().toLowerCase() === accServer) return true;
                        }
                        return false;
                    });

                    // Multi-Candidate Scoring: Route strictly to the healthiest online, authorized bridge
                    let bestCandidate = null;
                    let bestScore = -1;

                    for (const cand of candidates) {
                        const ep = this.endpoints.find(e => e.id === cand.endpointId || e.url === cand.endpointUrl);
                        if (!ep || !ep.enabled || ep.status !== 'online' || ep.status === 'unauthorized') continue;

                        let score = 0;
                        // MT5 terminal is connected and live
                        if (cand.is_connected) score += 1000;
                        // Live financial data from broker (> 0 balance) gets strong priority over empty/zero instances
                        if (Number(cand.balance || 0) > 0) score += 500;
                        if (Number(cand.equity || 0) > 0) score += 100;
                        // Account is not paused in standby mode
                        if (!cand.is_paused && !this.isAccountPaused(cand.id)) score += 200;
                        // Direct match with requested account instance
                        if (cand.id === acc.id) score += 25;
                        // Lower ping bonus (0 to 50 pts)
                        const ping = typeof ep.ping === 'number' ? ep.ping : 50;
                        score += Math.max(0, 50 - Math.min(50, ping));

                        if (score > bestScore) {
                            bestScore = score;
                            bestCandidate = { cand, ep };
                        }
                    }

                    if (bestCandidate && bestCandidate.ep) {
                        if (acc.endpointId && bestCandidate.ep.id !== acc.endpointId) {
                            console.log(`[MT5API] 🔀 HA Sibling Route: Routing account #${accLogin} via healthiest online bridge '${bestCandidate.ep.name}' (score: ${bestScore}).`);
                        }
                        return bestCandidate.ep;
                    }

                    // Direct endpoint fallback: only if the specific direct endpoint is online and authorized!
                    if (acc.endpointId) {
                        const directEp = this.endpoints.find(e => e.id === acc.endpointId);
                        if (directEp && directEp.enabled && directEp.status === 'online' && directEp.status !== 'unauthorized') {
                            return directEp;
                        }
                    }

                    // Target account has no online, authorized bridge currently connected: return null!
                    return null;
                }
            }
            // If accountId was not provided, only route via an active endpoint that actually has added & enabled accounts!
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
            let key = ep ? ep.apiKey : (this.apiKey || 'mt5_secret_key_2026');
            if (key && (key.startsWith('enc:v1:') || key.startsWith('b64:v1:'))) {
                console.warn('[MT5API] getReqHeaders called with un-decrypted API key ciphertext! Omitting auth header.');
                key = '';
            }
            if (key && key !== 'none') {
                h['Authorization'] = `Bearer ${key}`;
                h['X-Bridge-Key'] = key;
            }

            // Origin-Level Zero-Trust Shield Token
            let shield = ep ? (ep.shieldToken || '') : '';
            if (shield && (shield.startsWith('enc:v1:') || shield.startsWith('b64:v1:'))) {
                shield = '';
            }
            // Auto-detect shield token from URL path if not explicitly provided
            if (!shield && ep && ep.url) {
                try {
                    const parsed = new URL(ep.url);
                    const pathPart = parsed.pathname.replace(/^\/+|\/+$/g, '');
                    if (pathPart && !pathPart.includes('/')) {
                        shield = pathPart;
                    }
                } catch (_) {}
            }
            if (shield) {
                h['X-Shield-Token'] = shield;
            }
            return h;
        }

        getHeaders() {
            return this.getReqHeaders(this.getActiveEndpoint());
        }

        addEndpoint({ name, url, apiKey, shieldToken = '', gistId = '', gistToken = '', enabled = true }) {
            const cleanUrl = (url || '').trim().replace(/\/+$/, '');
            if (!cleanUrl) return { success: false, error: 'Endpoint URL is required' };
            const cleanKey = (apiKey || 'mt5_secret_key_2026').trim();
            const cleanName = (name || '').trim() || `Bridge Server ${this.endpoints.length + 1}`;
            const id = 'ep_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

            // Auto-extract shield token from URL path if provided as e.g. https://...trycloudflare.com/gw_secret
            let autoShield = (shieldToken || '').trim();
            if (!autoShield) {
                try {
                    const parsed = new URL(cleanUrl);
                    const pathPart = parsed.pathname.replace(/^\/+|\/+$/g, '');
                    if (pathPart && !pathPart.includes('/')) {
                        autoShield = pathPart;
                    }
                } catch (_) {}
            }

            const newEp = {
                id,
                name: cleanName,
                url: cleanUrl,
                apiKey: cleanKey,
                shieldToken: autoShield,
                gistId: (gistId || '').trim(),
                gistToken: (gistToken || '').trim(),
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
            if (updates.shieldToken !== undefined) ep.shieldToken = String(updates.shieldToken).trim();
            if (updates.gistId !== undefined) ep.gistId = String(updates.gistId).trim();
            if (updates.gistToken !== undefined) ep.gistToken = String(updates.gistToken).trim();
            if (updates.enabled !== undefined) ep.enabled = Boolean(updates.enabled);

            // Auto-detect shield token from URL path if not explicitly set
            if (!ep.shieldToken && ep.url) {
                try {
                    const parsed = new URL(ep.url);
                    const pathPart = parsed.pathname.replace(/^\/+|\/+$/g, '');
                    if (pathPart && !pathPart.includes('/')) {
                        ep.shieldToken = pathPart;
                    }
                } catch (_) {}
            }

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

        async testSingleEndpoint(endpointId, retry = false) {
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
                // If offline and bridge has Gist configured, attempt Auto-Discovery recovery
                if (ep.gistId && !retry) {
                    try {
                        const sync = await this.syncEndpointFromGist(endpointId);
                        if (sync.success && sync.changed) {
                            return this.testSingleEndpoint(endpointId, true);
                        }
                    } catch (_) {}
                }
                ep.status = 'offline';
                ep.error = err.message;
                this.saveConfig();
                return { success: false, error: err.message };
            }
        }

        async testEndpointDetails({ url, apiKey, shieldToken = '' }) {
            const cleanUrl = (url || '').trim().replace(/\/+$/, '');
            if (!cleanUrl) return { success: false, skipped: true, error: 'Endpoint URL is required' };
            const cleanKey = (apiKey || 'mt5_secret_key_2026').trim();

            let autoShield = (shieldToken || '').trim();
            if (!autoShield) {
                try {
                    const parsed = new URL(cleanUrl);
                    const pathPart = parsed.pathname.replace(/^\/+|\/+$/g, '');
                    if (pathPart && !pathPart.includes('/')) {
                        autoShield = pathPart;
                    }
                } catch (_) {}
            }

            const dummyEp = {
                url: cleanUrl,
                apiKey: cleanKey,
                shieldToken: autoShield
            };

            const start = performance.now();
            try {
                const res = await fetch(`${cleanUrl}/health`, {
                    headers: this.getReqHeaders(dummyEp),
                    signal: AbortSignal.timeout(8000)
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const ping = Math.round(performance.now() - start);

                // Check API key against /api/accounts
                try {
                    const accRes = await fetch(`${cleanUrl}/api/accounts`, {
                        headers: this.getReqHeaders(dummyEp),
                        signal: AbortSignal.timeout(6000)
                    });
                    if (accRes.status === 401 || accRes.status === 403) {
                        return {
                            success: false,
                            authFailed: true,
                            ping,
                            error: 'Bridge Online, but API Key is Invalid (HTTP 401 Unauthorized)'
                        };
                    }
                    if (accRes.ok) {
                        const accData = await accRes.json();
                        const count = Array.isArray(accData.accounts) ? accData.accounts.length : 0;
                        return {
                            success: true,
                            ping,
                            accountsCount: count,
                            data
                        };
                    }
                } catch (authErr) {
                    console.warn('[MT5API] Accounts check during test error:', authErr);
                }
                return { success: true, ping, data };
            } catch (err) {
                return { success: false, ping: 0, error: err.message };
            }
        }

        async testGistAccess({ gistId, gistToken = '', apiKey = '' }) {
            const cleanGistId = (gistId || '').trim();
            if (!cleanGistId) {
                return { success: false, skipped: true, error: 'Gist ID not provided' };
            }

            const masterToken = this.getMasterGistToken();
            const token = (gistToken || '').trim() || masterToken;
            const isUsingMaster = !(gistToken || '').trim() && Boolean(masterToken);

            const headers = {
                'Accept': 'application/vnd.github.v3+json'
            };
            if (token) {
                headers['Authorization'] = `token ${token.trim()}`;
            }

            try {
                const gistFetchUrl = `https://api.github.com/gists/${cleanGistId}?t=${Date.now()}`;
                const res = await fetch(gistFetchUrl, {
                    headers,
                    signal: AbortSignal.timeout(8000)
                });

                if (res.status === 401) {
                    return {
                        success: false,
                        status: 401,
                        error: `GitHub 401 Unauthorized: Invalid PAT token (${isUsingMaster ? 'Master Token' : 'Custom Token'})`
                    };
                }
                if (res.status === 404) {
                    return {
                        success: false,
                        status: 404,
                        error: `Gist Not Found (HTTP 404): Ensure 32-char ID is correct and PAT has 'gist' scope.`
                    };
                }
                if (!res.ok) {
                    return {
                        success: false,
                        status: res.status,
                        error: `GitHub API error (HTTP ${res.status})`
                    };
                }

                const data = await res.json();
                const files = data.files || {};
                let rawContent = null;
                if (files['bridge_endpoint.json'] && files['bridge_endpoint.json'].content) {
                    rawContent = files['bridge_endpoint.json'].content;
                } else if (files['mt5_bridges.json'] && files['mt5_bridges.json'].content) {
                    rawContent = files['mt5_bridges.json'].content;
                } else {
                    const firstJson = Object.values(files).find(f => f.filename && f.filename.endsWith('.json') && f.content);
                    if (firstJson) rawContent = firstJson.content;
                }

                let decrypted = false;
                let decryptedUrl = null;
                let decryptError = null;
                let shieldToken = null;
                let shieldDate = null;
                let isOlder = false;
                let bridgeName = null;
                let autoHealedKey = null;

                if (rawContent) {
                    try {
                        const parsed = JSON.parse(rawContent);
                        bridgeName = parsed.bridge || (parsed.bridges ? Object.keys(parsed.bridges)[0] : null);

                        let targetBlob = parsed.vault || parsed.payload || parsed.endpoint_url || parsed.url;
                        if (!targetBlob && parsed.bridges) {
                            const m = Object.values(parsed.bridges).find(b => b && (b.vault || b.payload || b.endpoint_url || b.url));
                            if (m) targetBlob = m.vault || m.payload || m.endpoint_url || m.url;
                        }

                        if (targetBlob && typeof targetBlob === 'string') {
                            if (targetBlob.startsWith('http')) {
                                decrypted = true;
                                decryptedUrl = targetBlob.trim().replace(/\/+$/, '');
                            } else if (targetBlob.startsWith('e2e:v2:') || targetBlob.startsWith('e2e:v1:')) {
                                if (!apiKey) {
                                    decryptError = 'Bridge API Key is required to decrypt this zero-trust Gist vault.';
                                } else {
                                    const vaultData = await this.decryptE2EVault(targetBlob, apiKey);
                                    if (vaultData && !vaultData.error) {
                                        decrypted = true;
                                        decryptedUrl = (vaultData.endpoint_url || vaultData.url || (typeof vaultData === 'string' ? vaultData : '')).trim().replace(/\/+$/, '');
                                        shieldToken = vaultData.shield_token || null;
                                        shieldDate = vaultData.shield_date || null;
                                        if (vaultData.server_name) bridgeName = vaultData.server_name;
                                        if (vaultData.autoHealedKey) autoHealedKey = vaultData.autoHealedKey;
                                    } else {
                                        decryptError = 'Invalid API Key: Unable to decrypt Gist vault. Please check for character typos (e.g. 1 vs l, _ vs -, 0 vs O). Click 👁️ to inspect your API Key.';
                                    }
                                }
                            }
                        }

                        if (decryptedUrl && !shieldToken) {
                            try {
                                const p = new URL(decryptedUrl);
                                const part = p.pathname.replace(/^\/+|\/+$/g, '');
                                if (part && part.startsWith('gw_')) shieldToken = part;
                            } catch (_) {}
                        }

                        if (shieldToken && !shieldDate && shieldToken.startsWith('gw_')) {
                            const parts = shieldToken.split('_');
                            if (parts.length >= 2 && parts[1].length === 11) {
                                shieldDate = parts[1];
                            }
                        }

                        if (shieldDate) {
                            const todayStr = this.getCurrentDayStr();
                            isOlder = Boolean(shieldDate < todayStr);
                        }
                    } catch (parseErr) {
                        decryptError = 'Invalid Gist JSON: ' + parseErr.message;
                    }
                }

                return {
                    success: true,
                    isUsingMaster,
                    hasToken: Boolean(token),
                    filesCount: Object.keys(files).length,
                    hasPayload: Boolean(rawContent),
                    decrypted,
                    decryptedUrl,
                    shieldToken,
                    shieldDate,
                    isOlder,
                    bridgeName,
                    autoHealedKey,
                    decryptError,
                    owner: data.owner ? data.owner.login : 'anonymous'
                };
            } catch (err) {
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
                // If all enabled endpoints are offline, attempt auto-discovery on any configured Gists
                try {
                    const syncRes = await this.syncAllEndpointsFromGist();
                    if (syncRes && syncRes.updated > 0) {
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
            const strId = String(accountId);
            if (this.pausedAccountIds.has(strId)) return true;
            // Also check if physical login is paused
            const acc = (this.accounts || []).find(a => String(a.id) === strId || String(a.login) === strId);
            if (acc && acc.login && this.pausedAccountIds.has(String(acc.login))) return true;
            return false;
        }

        toggleAccountPause(accountId) {
            if (!this.pausedAccountIds) this.pausedAccountIds = new Set();
            const idStr = String(accountId);
            const isPaused = this.isAccountPaused(idStr);

            // Find all matching instances and logins to keep everything synchronized across all bridges
            const acc = (this.accounts || []).find(a => String(a.id) === idStr || String(a.login) === idStr);
            const targetLogin = acc ? String(acc.login || '').trim() : '';
            const matchingAccs = acc ? (this.accounts || []).filter(a => String(a.login || '').trim() === targetLogin) : [];
            const idsToUpdate = new Set([idStr, ...(targetLogin ? [targetLogin] : []), ...matchingAccs.map(a => String(a.id))]);

            if (isPaused) {
                idsToUpdate.forEach(id => this.pausedAccountIds.delete(id));
                console.log(`[MT5API] ✓ Account ${idStr} (and siblings) resumed to Online mode.`);
            } else {
                idsToUpdate.forEach(id => {
                    this.pausedAccountIds.add(id);
                    if (this.multiAccountSelection) {
                        this.multiAccountSelection.delete(id);
                    }
                });
                console.log(`[MT5API] ⏸️ Account ${idStr} (and siblings) paused (Standby mode).`);
            }
            this.saveConfig();
            this.syncAccounts(true);
            this.notifyAccountListeners();
            return !this.isAccountPaused(idStr);
        }

        initAutoSync() {
            // First ensure all config secrets (API keys, Gist tokens) are decrypted before kicking off the boot sync!
            this.ensureSecretsDecrypted().then(() => {
                this.syncAccounts();
            });

            if (this.syncTimer) clearInterval(this.syncTimer);
            // Smart adaptive sync: only fallback to HTTP poll if any enabled bridge WebSocket is offline
            this.syncTimer = setInterval(() => {
                const anyWsClosed = (this.endpoints || []).some(e => e.enabled && (!this.wsSockets.get(e.id) || this.wsSockets.get(e.id).readyState !== WebSocket.OPEN));
                if (anyWsClosed) {
                    this.syncAccounts();
                }
            }, 15000);

            // Proactive startup Gist auto-discovery:
            // If any bridge has Gist configured, immediately detect rotated Cloudflare URLs
            // so we don't have to wait for connection timeouts or manual user intervention!
            this.decryptConfigSecrets().then(() => {
                const hasGistConfigured = (this.endpoints || []).some(e => e.enabled && e.gistId && this.getEndpointGistToken(e.id));
                if (hasGistConfigured) {
                    this.syncAllEndpointsFromGist(false).then(res => {
                        if (res && res.updated > 0) {
                            console.log(`[MT5API] 🚀 Startup Gist auto-discovery updated ${res.updated} bridge URL(s). Syncing accounts...`);
                            this.syncAccounts(true);
                        }
                    }).catch(err => {
                        console.warn('[MT5API] Startup Gist auto-discovery check:', err);
                    });
                }
            });
        }

        initSelfHealingWatchdog() {
            if (this._selfHealingTimer) clearInterval(this._selfHealingTimer);

            let lastWatchdogTick = Date.now();

            this._selfHealingTimer = setInterval(async () => {
                const now = Date.now();
                const drift = now - lastWatchdogTick;
                lastWatchdogTick = now;

                // 1. Clock Drift Detection (Detects laptop sleep, suspended tab, or system freeze)
                if (drift > 4500) {
                    const isMajorWake = drift > 15000;
                    console.log(`[MT5API] ⚡ System sleep or suspended tab detected (drift: ${Math.round(drift / 1000)}s). Executing self-healing wake routine...`);
                    this.executeSelfHealingWakeRoutine(isMajorWake);
                    return;
                }

                // 2. Active Socket Zombie & Health Check
                const viableEndpoints = (this.endpoints || []).filter(e => e.enabled && e.status !== 'unauthorized');
                for (const ep of viableEndpoints) {
                    const sock = this.wsSockets.get(ep.id);
                    if (!sock) {
                        // Socket missing: auto-create
                        this.ensureWebSocket();
                        continue;
                    }

                    if (sock.readyState === WebSocket.OPEN) {
                        const lastActivity = sock._lastActivityTime || sock._connectedAt || now;
                        const silenceSec = (now - lastActivity) / 1000;

                        // If socket has been completely silent (no ticks, no pongs) for > 8s:
                        if (silenceSec > 8) {
                            console.warn(`[MT5API] ⚠️ Zombie socket detected for '${ep.name}' (${Math.round(silenceSec)}s silence). Forcing self-healing reconnect...`);
                            try {
                                sock.onclose = null;
                                sock.onerror = null;
                                sock.close();
                            } catch (_) {}
                            this.wsSockets.delete(ep.id);
                            if (this.ws === sock) this.ws = null;
                            this.ensureWebSocket();
                        }
                    } else if (sock.readyState === WebSocket.CLOSING || sock.readyState === WebSocket.CLOSED) {
                        // Clean up closed socket and reconnect
                        this.wsSockets.delete(ep.id);
                        if (this.ws === sock) this.ws = null;
                        this.ensureWebSocket();
                    }
                }

                // 3. Stalled Chart Stream Self-Healing
                // If there are active chart listeners but zero ticks received in > 5 seconds:
                if (this.tickListeners && this.tickListeners.size > 0) {
                    const tickSilence = (now - (this._lastTickReceivedTime || now)) / 1000;
                    if (tickSilence > 5) {
                        this.triggerSelfHealingTickRecovery();
                    }
                }
            }, 2500);
        }

        async executeSelfHealingWakeRoutine(isMajorWake = false) {
            if (this._isSelfHealing) return;
            this._isSelfHealing = true;
            this.wasDisconnected = true;
            console.log(`[MT5API] ⚡ Executing self-healing wake sequence (major: ${isMajorWake})...`);

            try {
                // 1. Terminate all stale sockets and cleanly reconnect
                this.reconnectWebSocket();

                // 2. Fetch fresh accounts status from bridges
                try {
                    await this.syncAccounts(true);
                } catch (_) {}

                // 3. Sync positions and floating PnL immediately
                try {
                    await this.fetchPositions();
                } catch (_) {}

                // 4. Trigger active chart recovery & candle gap backfill
                this.refreshActiveChart(isMajorWake);
            } finally {
                setTimeout(() => {
                    this._isSelfHealing = false;
                }, 1500);
            }
        }

        async triggerSelfHealingTickRecovery() {
            if (!this.endpoints || this.endpoints.length === 0 || !this.tickListeners || this.tickListeners.size === 0) return;
            const now = Date.now();
            if (this._isRecoveringTicks || (now - (this._lastTickRecoveryAttempt || 0) < 3000)) return;
            this._isRecoveringTicks = true;
            this._lastTickRecoveryAttempt = now;

            try {
                // Group listeners by symbol + accountId so EVERY open chart gets ticks!
                const targets = new Map();
                this.tickListeners.forEach((info) => {
                    if (info && info.symbol) {
                        const key = `${info.symbol}_${info.accountId || ''}`;
                        if (!targets.has(key)) {
                            targets.set(key, { symbol: info.symbol, accountId: info.accountId, endpointId: info.endpointId });
                        }
                    }
                });

                for (const target of targets.values()) {
                    let targetAcc = null;
                    if (target.accountId && this.accounts) {
                        targetAcc = this.accounts.find(a => String(a.id) === String(target.accountId));
                    }
                    if (!targetAcc) targetAcc = this.getActiveAccount();
                    const ep = this.getEndpointForAccount(targetAcc ? targetAcc.id : null);
                    if (!ep || !ep.url || !ep.enabled || ep.status !== 'online') continue;

                    const accParam = targetAcc ? `&account_id=${encodeURIComponent(targetAcc.id)}` : '';
                    const url = `${ep.url}/api/tick?symbol=${encodeURIComponent(target.symbol)}&resolution=${encodeURIComponent(this.activeResolution || '1')}${accParam}`;
                    const res = await fetch(url, { headers: this.getReqHeaders(ep), signal: AbortSignal.timeout(3000) });
                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.success) {
                            this._lastTickReceivedTime = Date.now();
                            const tickMsg = { type: 'tick', endpointId: ep ? ep.id : null, ...data };
                            this.tickListeners.forEach((info, cb) => {
                                if (info && info.endpointId && ep && info.endpointId !== ep.id) return;
                                if (tickMsg.account_id && info && info.accountId && String(tickMsg.account_id) !== String(info.accountId)) return;
                                try { cb(tickMsg); } catch (_) {}
                            });
                        }
                    }
                }
            } catch (_) {
            } finally {
                this._isRecoveringTicks = false;
            }
        }

        // --- Parallel Multi-Bridge Account Sync ---
        async syncAccounts(force = false) {
            await this.ensureSecretsDecrypted();
            const enabledEndpoints = (this.endpoints || []).filter(e => e.enabled);
            if (enabledEndpoints.length === 0) {
                this.isConnected = false;
                this.accounts = [];
                this.notifyAccountListeners();
                return;
            }

            const fetchPromises = enabledEndpoints.map(async (ep) => {
                // If endpoint already failed with 401 Unauthorized, do not hammer it on background intervals unless forced by user action!
                if (!force && ep.status === 'unauthorized') {
                    return { ep, data: null, error: ep.error };
                }

                const start = performance.now();
                try {
                    const res = await fetch(`${ep.url}/api/accounts`, {
                        headers: this.getReqHeaders(ep),
                        signal: AbortSignal.timeout(6000)
                    });
                    if (res.status === 401) {
                        ep.status = 'unauthorized';
                        ep.error = '401 Unauthorized: Invalid or missing API key';
                        console.warn(`[MT5API] ⚠️ Bridge '${ep.name}' rejected API key (401 Unauthorized). Background syncing paused for this bridge until key is updated.`);
                        return { ep, data: null, error: ep.error };
                    }
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const data = await res.json();
                    ep.ping = Math.round(performance.now() - start);
                    ep.status = 'online';
                    ep.error = null;
                    ep.hasAccounts = Array.isArray(data.accounts) && data.accounts.length > 0;
                    return { ep, data };
                } catch (err) {
                    // AUTO-HEAL: If endpoint has Gist configured and fetch failed (e.g. rotated tunnel URL),
                    // automatically check Gist for the newly generated URL and retry immediately!
                    const now = Date.now();
                    if (ep.gistId && (!ep._lastGistAutoCheck || (now - ep._lastGistAutoCheck > 4000))) {
                        ep._lastGistAutoCheck = now;
                        try {
                            console.log(`[MT5API] 🔍 Endpoint '${ep.name}' unreachable (${err.message}). Auto-checking Gist for rotated tunnel URL...`);
                            const syncRes = await this.syncEndpointFromGist(ep.id, false);
                            if (syncRes && syncRes.success) {
                                if (syncRes.changed) {
                                    console.log(`[MT5API] ✨ Discovered rotated tunnel URL for '${ep.name}': ${ep.url}. Retrying accounts fetch...`);
                                }
                                const retryStart = performance.now();
                                try {
                                    const retryRes = await fetch(`${ep.url}/api/accounts`, {
                                        headers: this.getReqHeaders(ep),
                                        signal: AbortSignal.timeout(6000)
                                    });
                                    if (retryRes.status === 401) {
                                        ep.status = 'unauthorized';
                                        ep.error = '401 Unauthorized: Invalid or missing API key';
                                        return { ep, data: null, error: ep.error };
                                    }
                                    if (retryRes.ok) {
                                        const retryData = await retryRes.json();
                                        ep.ping = Math.round(performance.now() - retryStart);
                                        ep.status = 'online';
                                        ep.error = null;
                                        ep.hasAccounts = Array.isArray(retryData.accounts) && retryData.accounts.length > 0;
                                        return { ep, data: retryData };
                                    }
                                } catch (_) {}
                            }
                        } catch (autoErr) {
                            console.warn(`[MT5API] Gist auto-heal failed for '${ep.name}':`, autoErr.message);
                        }
                    }

                    if (ep.status !== 'unauthorized') {
                        ep.status = 'offline';
                        ep.error = err.message;
                    }
                    if (force) console.warn(`[MT5API] Endpoint '${ep.name}' sync error:`, err.message);
                    return { ep, data: null, error: err.message };
                }
            });

            const results = await Promise.allSettled(fetchPromises);
            const allAccounts = [];
            let anyOnline = false;
            let primaryActiveId = null;

            for (const r of results) {
                if (r.status === 'fulfilled' && r.value) {
                    const { ep, data } = r.value;
                    if (data && Array.isArray(data.accounts)) {
                        anyOnline = true;
                        if (ep.id === this.activeEndpointId && data.active_account_id) {
                            primaryActiveId = data.active_account_id;
                        }
                        const accountsList = data.accounts || [];
                        accountsList.forEach(acc => {
                            const isPaused = this.isAccountPaused(acc.id);
                            const oldAcc = (this.accounts || []).find(a => String(a.id) === String(acc.id) || String(a.login) === String(acc.login));
                            allAccounts.push({
                                ...acc,
                                endpointId: ep.id,
                                endpointName: ep.name,
                                endpointUrl: ep.url,
                                endpointApiKey: ep.apiKey,
                                is_paused: isPaused,
                                is_connected: Boolean(acc.is_connected && !isPaused && ep.status === 'online'),
                                positions: (oldAcc && Array.isArray(oldAcc.positions) && oldAcc.positions.length > 0) ? oldAcc.positions : (acc.positions || []),
                                has_password: Boolean(acc.has_password),
                                has_dpapi: Boolean(acc.has_dpapi),
                                has_native_vault: Boolean(acc.has_native_vault && acc.is_connected),
                                survives_reboot: Boolean(acc.survives_reboot || acc.has_dpapi || (acc.has_native_vault && acc.is_connected)),
                                is_verified: Boolean(acc.is_connected && !isPaused && ep.status === 'online'),
                                auth_mode: acc.auth_mode || (acc.has_dpapi ? 'dpapi_vaulted' : (acc.is_connected ? 'mt5_native_vault' : 'awaiting_credentials')),
                                auth_label: acc.auth_label || (acc.has_dpapi ? 'Bridge Secured (DPAPI)' : (acc.is_connected ? 'Official MT5 Saved' : 'Awaiting Password'))
                            });
                        });
                    } else if (ep && ep.status !== 'unauthorized') {
                        // Bridge is offline/reconnecting: preserve existing cached accounts for this bridge
                        // as standby (is_connected: false) unless the bridge is unauthorized!
                        const cachedForEp = (this.accounts || []).filter(a => a.endpointId === ep.id);
                        cachedForEp.forEach(acc => {
                            allAccounts.push({
                                ...acc,
                                endpointId: ep.id,
                                endpointName: ep.name,
                                endpointUrl: ep.url,
                                endpointApiKey: ep.apiKey,
                                is_connected: false
                            });
                        });
                    }
                }
            }

            // Merge in local client vault accounts if not present in any bridge report,
            // and attach local vault metadata to matching bridge accounts
            const localVault = this.getClientVault();
            if (localVault && Array.isArray(localVault)) {
                localVault.forEach(v => {
                    const vLogin = String(v.login || '').trim();
                    const vServer = String(v.server || '').trim().toLowerCase();
                    if (!vLogin) return;
                    const bridgeMatches = allAccounts.filter(a => String(a.login || '').trim() === vLogin && String(a.server || '').trim().toLowerCase() === vServer);
                    const isRejected = Boolean(v.verification_failed);
                    const isStaged = Boolean(v.staged_offline || v.is_verified === false);

                    if (bridgeMatches.length > 0) {
                        bridgeMatches.forEach(bm => {
                            bm.has_local_vault = true;
                            bm.is_local_vault_verified = !isStaged && !isRejected;
                            bm.is_staged_offline = isStaged && !isRejected;
                            bm.is_verification_failed = isRejected;
                            bm.last_error = isRejected ? (v.last_error || 'Broker rejected credentials') : bm.last_error;
                            if (isRejected && !bm.has_dpapi && !bm.has_native_vault) {
                                bm.auth_mode = 'local_rejected';
                                bm.auth_label = '❌ Rejected by Broker';
                            }
                        });
                    } else {
                        allAccounts.push({
                            id: `local_${vLogin}_${vServer}`,
                            login: Number(vLogin) || vLogin,
                            server: v.server || '',
                            nickname: v.nickname || `MT5 ${vLogin}`,
                            is_connected: false,
                            is_paused: false,
                            has_local_vault: true,
                            is_local_vault_verified: !isStaged && !isRejected,
                            is_staged_offline: isStaged && !isRejected,
                            is_verification_failed: isRejected,
                            last_error: isRejected ? (v.last_error || 'Broker rejected credentials') : null,
                            is_verified: false,
                            has_password: true,
                            has_dpapi: false,
                            has_native_vault: false,
                            survives_reboot: false,
                            auth_mode: isRejected ? 'local_rejected' : (isStaged ? 'local_staged_offline' : 'local_vaulted'),
                            auth_label: isRejected ? '❌ Rejected by Broker' : (isStaged ? 'Staged Offline (Unverified)' : 'Local Vaulted'),
                            balance: 0,
                            equity: 0,
                            currency: 'USD',
                            endpointId: v.endpointId || (Array.isArray(v.targetEndpoints) ? v.targetEndpoints[0] : null) || 'local',
                            endpointName: 'Local Browser Vault'
                        });
                    }
                });
            }

            const wasPreviouslyConnected = this.isConnected;
            this.accounts = allAccounts;
            this.isConnected = anyOnline;
            if (typeof this._resolveAccountsReady === 'function') {
                this._resolveAccountsReady(this.accounts);
                this._resolveAccountsReady = null;
            }

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
            const prevConnectedCount = this._lastConnectedCount || 0;
            const curConnectedCount = (this.accounts || []).filter(a => a.is_connected).length;
            this._lastConnectedCount = curConnectedCount;

            if ((!wasPreviouslyConnected && anyOnline) || (curConnectedCount > prevConnectedCount)) {
                const onlineBridges = enabledEndpoints.filter(e => e.status === 'online').length;
                console.log(`[MT5API] ✓ Bridge Fleet Connected (${onlineBridges} bridge online, ${curConnectedCount} accounts active)! Auto-syncing live chart & quotes...`);
                this.ensureWebSocket();
                this.refreshActiveChart();
            }

            // Preload full symbol catalog into memory once connected for 0ms instant search
            if (!this._allSymbols && !this._loadingSymbolsPromise && anyOnline) {
                this.loadAllSymbolsCache();
            }

            // Preload symbols & history across all accounts for 0ms instant details
            this.preloadAllAccountsData();

            // Auto-heal accounts that have local browser vault password but missing Bridge DPAPI (after broker verification)
            this.checkAndAutoHealLocalVaults().catch(() => {});

            // Sync positions for active account
            if (this.activeAccountId) {
                this.fetchPositions(this.activeAccountId);
            }

            this.notifyAccountListeners();
        }

        async refreshActiveChart(forceReset = false) {
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

            // Self-Healing Chart Recovery: If chart has no bars rendered (initial race condition / stalled chart), or forceReset requested:
            const unifiedKey = `${cleanTicker}_${this.activeResolution || '1'}`;
            const hasBar = !!(window._tvLastBar && window._tvLastBar[unifiedKey]);
            if (!hasBar || forceReset) {
                console.log(`[MT5API] 🔄 Auto-healing chart for ${currentSymbol} via resetData()...`);
                try {
                    if (typeof chart.resetData === 'function') {
                        chart.resetData();
                    } else if (typeof chart.setSymbol === 'function') {
                        chart.setSymbol(currentSymbol);
                    }
                } catch (_) {}
            }
        }

        getActiveAccount() {
            if (!this.activeAccountId && this.accounts.length > 0) {
                const firstConnectedWithBal = this.accounts.find(a => a.is_connected && !a.is_paused && Number(a.balance || 0) > 0);
                const firstConnected = this.accounts.find(a => a.is_connected && !a.is_paused);
                return firstConnectedWithBal || firstConnected || this.accounts[0];
            }
            const direct = this.accounts.find(a => a.id === this.activeAccountId);
            if (direct) {
                const directEp = direct.endpointId ? this.endpoints.find(e => e.id === direct.endpointId) : null;
                const isDirectEpOffline = !directEp || !directEp.enabled || directEp.status === 'offline';
                const directBal = Number(direct.balance || 0);

                // If direct active account is disconnected/offline, OR has zero balance while an online sibling has positive balance
                const accLogin = String(direct.login || '').trim();
                const accServer = (direct.server || '').trim().toLowerCase();
                if (accLogin) {
                    const siblingWithBal = this.accounts.find(a => 
                        String(a.login || '').trim() === accLogin &&
                        (a.server || '').trim().toLowerCase() === accServer &&
                        (a.endpointId !== direct.endpointId || a.id !== direct.id) &&
                        a.is_connected &&
                        !a.is_paused &&
                        Number(a.balance || 0) > 0 &&
                        (() => {
                            const sEp = this.endpoints.find(e => e.id === a.endpointId);
                            return sEp && sEp.enabled && sEp.status !== 'offline';
                        })()
                    );
                    if (siblingWithBal && (directBal === 0 || !direct.is_connected || isDirectEpOffline)) {
                        return siblingWithBal;
                    }
                    if (!direct.is_connected || isDirectEpOffline) {
                        const onlineSibling = this.accounts.find(a => 
                            String(a.login || '').trim() === accLogin &&
                            (a.server || '').trim().toLowerCase() === accServer &&
                            (a.endpointId !== direct.endpointId || a.id !== direct.id) &&
                            a.is_connected &&
                            !a.is_paused &&
                            (() => {
                                const sEp = this.endpoints.find(e => e.id === a.endpointId);
                                return sEp && sEp.enabled && sEp.status !== 'offline';
                            })()
                        );
                        if (onlineSibling) {
                            return onlineSibling;
                        }
                    }
                }
                return direct;
            }
            return null;
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
                    this.getSymbolsForAccount(accId).catch(() => {});
                }
            }
        }

        async checkAndAutoHealLocalVaults() {
            const vault = this.getClientVault();
            if (!vault || vault.length === 0) return;
            this._autoHealAttempts = this._autoHealAttempts || new Set();

            const onlineEndpoints = (this.endpoints || []).filter(e => e.enabled && e.status === 'online' && e.url);
            if (onlineEndpoints.length === 0) return;

            for (const vaultEntry of vault) {
                const targetLogin = Number(vaultEntry.login);
                const targetServer = String(vaultEntry.server || '').trim();
                if (!targetLogin || !targetServer || !vaultEntry.password) continue;

                const compositeKey = `${targetLogin}_${targetServer.toLowerCase()}`;

                const matchingAcc = (this.accounts || []).find(a => 
                    Number(a.login) === targetLogin && 
                    this.isServerMatch(a.server, targetServer)
                );
                const canonicalServer = matchingAcc && matchingAcc.server ? matchingAcc.server : targetServer;

                const isStagedOffline = Boolean(vaultEntry.staged_offline || vaultEntry.is_verified === false);
                const lacksDpapi = matchingAcc && !matchingAcc.has_dpapi;
                const isDisconnected = matchingAcc && !matchingAcc.is_connected;

                // Needs auto-healing if:
                // 1) Password was staged offline (needs broker verification)
                // 2) Account is connected on bridge but missing hardware DPAPI
                // 3) Account is on bridge but currently disconnected/not logged in
                const needsHealing = isStagedOffline || lacksDpapi || isDisconnected;
                if (!needsHealing) continue;

                if (this._autoHealAttempts.has(compositeKey)) continue;
                this._autoHealAttempts.add(compositeKey);

                console.log(`[MT5API] 🛡️ Auto-Healing #${targetLogin} on '${canonicalServer}' (staged_offline=${isStagedOffline}, lacks_dpapi=${lacksDpapi}). Probing broker...`);

                try {
                    const rawPass = await this.decryptVaultSecret(vaultEntry.password);
                    if (!rawPass) continue;

                    const res = await this.verifyAndUpdateBrokerPassword(targetLogin, canonicalServer, rawPass);
                    if (res && res.verified) {
                        console.log(`[MT5API] ✓ Auto-healed Account #${targetLogin} on '${canonicalServer}'! Broker verified & secured in Bridge DPAPI.`);

                        // Update local vault entry explicitly
                        vaultEntry.server = canonicalServer;
                        vaultEntry.is_verified = true;
                        vaultEntry.staged_offline = false;
                        vaultEntry.verification_failed = false;
                        vaultEntry.last_error = null;
                        vaultEntry.verified_at = Date.now();
                        try {
                            const raw = localStorage.getItem('mt5_client_vault');
                            const vList = raw ? JSON.parse(raw) : [];
                            const vIdx = vList.findIndex(v => Number(v.login) === targetLogin && this.isServerMatch(v.server, targetServer));
                            if (vIdx >= 0) {
                                vList[vIdx].server = canonicalServer;
                                vList[vIdx].is_verified = true;
                                vList[vIdx].staged_offline = false;
                                vList[vIdx].verification_failed = false;
                                vList[vIdx].last_error = null;
                                vList[vIdx].verified_at = Date.now();
                                localStorage.setItem('mt5_client_vault', JSON.stringify(vList));
                            }
                        } catch (_) {}

                        if (matchingAcc) {
                            matchingAcc.has_dpapi = true;
                            matchingAcc.is_verified = true;
                            matchingAcc.is_verification_failed = false;
                            matchingAcc.auth_mode = 'dpapi_vaulted';
                            matchingAcc.auth_label = 'Bridge Secured (DPAPI)';
                        }

                        if (window.MT5UI && typeof window.MT5UI.showFloatingSwitchToast === 'function') {
                            const toastTitle = isStagedOffline ? 'Offline Password Verified' : 'Auto-Healed Account';
                            const toastMsg = `Account #${targetLogin} broker verified & secured in Bridge DPAPI`;
                            window.MT5UI.showFloatingSwitchToast(toastTitle, toastMsg, 100, true);
                        }
                        this.notifyAccountListeners();
                    } else if (res && res.verified === false) {
                        console.warn(`[MT5API] Auto-heal rejected for #${targetLogin} on '${canonicalServer}': Broker rejected vault password.`);
                        vaultEntry.verification_failed = true;
                        vaultEntry.last_error = res?.error || 'Broker rejected credentials';
                        try {
                            const raw = localStorage.getItem('mt5_client_vault');
                            const vList = raw ? JSON.parse(raw) : [];
                            const vIdx = vList.findIndex(v => Number(v.login) === targetLogin && this.isServerMatch(v.server, targetServer));
                            if (vIdx >= 0) {
                                vList[vIdx].verification_failed = true;
                                vList[vIdx].last_error = vaultEntry.last_error;
                                localStorage.setItem('mt5_client_vault', JSON.stringify(vList));
                            }
                        } catch (_) {}

                        if (matchingAcc) {
                            matchingAcc.is_verification_failed = true;
                            matchingAcc.last_error = vaultEntry.last_error;
                            matchingAcc.auth_mode = 'local_rejected';
                            matchingAcc.auth_label = '❌ Rejected by Broker';
                        }
                        this.notifyAccountListeners();
                    } else {
                        // Transient connection or network issue: allow retry on next reconnect
                        this._autoHealAttempts.delete(compositeKey);
                    }
                } catch (e) {
                    console.warn(`[MT5API] Auto-heal probe error for #${targetLogin}:`, e);
                    this._autoHealAttempts.delete(compositeKey);
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
                const targetLogin = targetAcc ? String(targetAcc.login || '').trim() : '';
                const targetServer = targetAcc ? (targetAcc.server || '').trim().toLowerCase() : '';
                this.accounts.forEach(a => {
                    const matchId = String(a.id) === String(id);
                    const matchPhysical = targetLogin && String(a.login || '').trim() === targetLogin && (!targetServer || (a.server || '').trim().toLowerCase() === targetServer);
                    a.is_active = matchId || matchPhysical;
                });

                this.notifyAccountListeners();
                this.reconnectWebSocket();

                if (!skipChartSwitch) {
                    this.switchChartFeedToAccount(id);
                }

                report(5, `✓ Active Feed Switched!`, `Connected to ${accName} (${brokerName}). Live chart feed ready.`, 100);

                const ep = this.getEndpointForAccount(id);
                if (ep) {
                    this.wsRequest(ep.id, {
                        action: 'set_active_account',
                        account_id: id
                    }, 2500).then(() => {
                        this.fetchPositions(id);
                        this.loadAllSymbolsCache();
                    }).catch(() => {
                        if (ep.url) {
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
            // First synchronize accounts from bridge so we have the absolute latest login, server, balance, equity
            try {
                await this.syncAccounts(true);
            } catch (_) {}

            let acc = this.accounts.find(a => String(a.id) === String(accountId));
            if (!acc) {
                const cleanId = String(accountId).replace(/^mt5_/, '');
                acc = this.accounts.find(a => String(a.login) === cleanId || String(a.id).replace(/^mt5_/, '') === cleanId);
            }
            if (!acc) acc = this.getActiveAccount();
            if (!acc) return null;
            const targetId = acc.id;

            if (onProgress) onProgress(1, 'Connecting to MT5 Profile', `Checking #${acc.login} (${acc.server})...`, 25);

            let symbols = [];
            if (!this._accountSymbolsCache) this._accountSymbolsCache = new Map();
            if (this._accountSymbolsCache.has(targetId)) {
                const cached = this._accountSymbolsCache.get(targetId);
                if (Array.isArray(cached) && cached.length > 2) {
                    symbols = cached;
                }
            }

            if (symbols.length <= 2) {
                try {
                    const localSyms = localStorage.getItem(`mt5_symbols_${targetId}`);
                    if (localSyms) {
                        const parsed = JSON.parse(localSyms);
                        if (Array.isArray(parsed) && parsed.length > 2) {
                            symbols = parsed;
                            this._accountSymbolsCache.set(targetId, symbols);
                        } else {
                            localStorage.removeItem(`mt5_symbols_${targetId}`);
                        }
                    }
                } catch (_) {}
            }

            if (symbols.length <= 2) {
                if (onProgress) onProgress(2, 'Loading Supported Tickers', 'Querying broker symbols and market watch...', 50);
                try {
                    const ep = this.getEndpointForAccount(targetId);
                    if (ep && ep.url) {
                        const accParam = `?account_id=${encodeURIComponent(targetId)}`;
                        const res = await fetch(`${ep.url}/api/symbols${accParam}`, {
                            headers: this.getReqHeaders(ep)
                        });
                        if (res.ok) {
                            const data = await res.json();
                            if (data.symbols && data.symbols.length > 2) {
                                symbols = data.symbols;
                                this._accountSymbolsCache.set(targetId, symbols);
                                try {
                                    localStorage.setItem(`mt5_symbols_${targetId}`, JSON.stringify(symbols));
                                } catch (_) {}
                            }
                        }
                    }
                } catch (e) {}
            } else {
                const ep = this.getEndpointForAccount(targetId);
                if (ep && ep.url) {
                    const accParam = `?account_id=${encodeURIComponent(targetId)}`;
                    fetch(`${ep.url}/api/symbols${accParam}`, { headers: this.getReqHeaders(ep) })
                        .then(r => r.ok ? r.json() : null)
                        .then(data => {
                            if (data && data.symbols && data.symbols.length > 2) {
                                this._accountSymbolsCache.set(targetId, data.symbols);
                                try {
                                    localStorage.setItem(`mt5_symbols_${targetId}`, JSON.stringify(data.symbols));
                                } catch (_) {}
                            }
                        }).catch(() => {});
                }
            }

            if (onProgress) onProgress(3, 'Fetching Active Positions', 'Retrieving open trades and floating PnL...', 75);
            let positions = [];
            try {
                positions = await this.fetchPositions(targetId);
            } catch (_) {
                positions = acc.positions || [];
            }
            acc.positions = positions;

            if (onProgress) onProgress(4, 'Synchronizing Order History', 'Loading closed trade deals and performance metrics...', 90);
            let history = [];
            try {
                history = await this.fetchOrderHistory(targetId);
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
                    if (ep) {
                        // 1. Try WebSocket RPC first
                        try {
                            const wsRes = await this.wsRequest(ep.id, {
                                action: 'get_history',
                                account_id: targetId ? String(targetId) : null,
                                days: 3650,
                                limit: 1000
                            }, 4000);
                            if (wsRes && wsRes.history && Array.isArray(wsRes.history) && wsRes.history.length > 0) {
                                remoteHistory = wsRes.history;
                                this._historyEndpointSupported = true;
                                try {
                                    localStorage.setItem(`mt5_history_cache_${targetId}`, JSON.stringify(remoteHistory));
                                } catch (_) {}
                            }
                        } catch (_) {}

                        // 2. HTTP REST fallback
                        if (remoteHistory.length === 0 && ep.url) {
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
                console.warn('[MT5API] E2E payload decryption failed:', e.message || e);
                return '';
            }
        }

        getCurrentDayStr() {
            const d = new Date();
            const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
            const y = d.getUTCFullYear();
            const m = months[d.getUTCMonth()];
            const day = String(d.getUTCDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }

        async derivePBKDF2Key(secret, salt) {
            if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) return null;
            const sec = (secret || this.apiKey || 'mt5_secret_key_2026').trim();
            const keyMaterial = await window.crypto.subtle.importKey(
                'raw',
                new TextEncoder().encode(sec),
                { name: 'PBKDF2' },
                false,
                ['deriveBits', 'deriveKey']
            );
            return await window.crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt: salt,
                    iterations: 100000,
                    hash: 'SHA-256'
                },
                keyMaterial,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt']
            );
        }

        generateOcrKeyVariations(str) {
            if (!str || typeof str !== 'string') return [];
            const clean = str.trim();
            const list = [clean];
            const confusions = {
                '1': ['l', 'I'],
                'l': ['1', 'I'],
                'I': ['1', 'l'],
                'F': ['f'],
                'f': ['F'],
                '-': ['_'],
                '_': ['-'],
                '0': ['O', 'o'],
                'O': ['0', 'o'],
                'o': ['0', 'O'],
            };
            for (let i = 0; i < clean.length; i++) {
                const c = clean[i];
                if (confusions[c]) {
                    for (const rep of confusions[c]) {
                        list.push(clean.substring(0, i) + rep + clean.substring(i + 1));
                    }
                }
            }
            // Pairwise combinations of single-character OCR substitutions
            const n = list.length;
            for (let j = 1; j < n; j++) {
                for (let k = j + 1; k < n; k++) {
                    let merged = clean.split('');
                    for (let idx = 0; idx < clean.length; idx++) {
                        if (list[j][idx] !== clean[idx]) merged[idx] = list[j][idx];
                        if (list[k][idx] !== clean[idx]) merged[idx] = list[k][idx];
                    }
                    list.push(merged.join(''));
                }
            }
            return [...new Set(list)];
        }

        async decryptE2EVault(blob, apiKey) {
            if (!blob || typeof blob !== 'string') return null;
            const inputKey = (apiKey || '').trim();

            if (blob.startsWith('e2e:v2:')) {
                const parts = blob.split(':');
                if (parts.length !== 5) return null;
                const salt = Uint8Array.from(atob(parts[2]), c => c.charCodeAt(0));
                const iv = Uint8Array.from(atob(parts[3]), c => c.charCodeAt(0));
                const ct = Uint8Array.from(atob(parts[4]), c => c.charCodeAt(0));

                const candidates = this.generateOcrKeyVariations(inputKey);
                for (const candKey of candidates) {
                    try {
                        const key = await this.derivePBKDF2Key(candKey, salt);
                        if (!key) continue;
                        const decrypted = await window.crypto.subtle.decrypt(
                            { name: 'AES-GCM', iv },
                            key,
                            ct
                        );
                        const decStr = new TextDecoder().decode(decrypted);
                        let result;
                        try {
                            result = JSON.parse(decStr);
                        } catch (_) {
                            result = { endpoint_url: decStr };
                        }
                        if (candKey !== inputKey) {
                            result.autoHealedKey = candKey;
                        }
                        return result;
                    } catch (_) {}
                }
                return { error: 'AUTH_FAILED', message: 'Decryption failed for all key candidates' };
            } else if (blob.startsWith('e2e:v1:')) {
                const candidates = this.generateOcrKeyVariations(inputKey);
                for (const candKey of candidates) {
                    const dec = await this.decryptE2EPayload(blob, candKey);
                    if (dec && dec.startsWith('http')) {
                        const res = { endpoint_url: dec };
                        if (candKey !== inputKey) res.autoHealedKey = candKey;
                        return res;
                    }
                }
                return { error: 'AUTH_FAILED', message: 'Decryption failed' };
            }
            return { endpoint_url: blob };
        }

        cleanServerKey(s) {
            if (!s || typeof s !== 'string') return '';
            return s.toLowerCase().replace(/[\s_\-]+/g, '');
        }

        isServerMatch(s1, s2) {
            if (!s1 || !s2) return false;
            const k1 = this.cleanServerKey(s1);
            const k2 = this.cleanServerKey(s2);
            return k1 === k2 || k1.includes(k2) || k2.includes(k1);
        }

        normalizePassphrase(str) {
            if (!str || typeof str !== 'string') return '';
            return str.toLowerCase().trim().replace(/[\s_\-]+/g, '-').replace(/^-+|-+$/g, '');
        }

        async derivePassphraseKey(passphrase, salt) {
            const norm = this.normalizePassphrase(passphrase);
            if (!norm) return null;
            const enc = new TextEncoder();
            const keyMaterial = await window.crypto.subtle.importKey(
                'raw',
                enc.encode(norm),
                { name: 'PBKDF2' },
                false,
                ['deriveKey']
            );
            return await window.crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt: salt,
                    iterations: 600000,
                    hash: 'SHA-256'
                },
                keyMaterial,
                { name: 'AES-GCM', length: 256 },
                false,
                ['decrypt']
            );
        }

        async decryptQRVault(blob, passphrase) {
            if (!blob || typeof blob !== 'string') return { success: false, error: 'Invalid QR code data' };
            const cleanBlob = blob.trim();
            if (!cleanBlob.startsWith('qr:v1:')) {
                return { success: false, error: 'Unsupported QR code format (expected qr:v1:...)' };
            }
            try {
                const parts = cleanBlob.split(':');
                if (parts.length !== 5) {
                    return { success: false, error: 'Malformed QR vault structure' };
                }
                const salt = Uint8Array.from(atob(parts[2]), c => c.charCodeAt(0));
                const iv = Uint8Array.from(atob(parts[3]), c => c.charCodeAt(0));
                const ct = Uint8Array.from(atob(parts[4]), c => c.charCodeAt(0));

                const key = await this.derivePassphraseKey(passphrase, salt);
                if (!key) return { success: false, error: 'Empty or invalid passphrase' };

                const decrypted = await window.crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv },
                    key,
                    ct
                );
                const decStr = new TextDecoder().decode(decrypted);
                const data = JSON.parse(decStr);
                return {
                    success: true,
                    gistId: data.g || '',
                    pat: data.p || '',
                    apiKey: data.k || ''
                };
            } catch (err) {
                return { success: false, error: 'Incorrect 2-word passphrase. Please check BRIDGE_INFO.txt on your Desktop.' };
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

                const isVerified = accountData.is_verified !== undefined
                    ? Boolean(accountData.is_verified)
                    : (existing && existing.is_verified !== undefined ? Boolean(existing.is_verified) : true);
                const stagedOffline = accountData.staged_offline !== undefined
                    ? Boolean(accountData.staged_offline)
                    : (existing && existing.staged_offline !== undefined ? Boolean(existing.staged_offline) : false);
                const verificationFailed = accountData.verification_failed !== undefined
                    ? Boolean(accountData.verification_failed)
                    : (isVerified ? false : (existing && existing.verification_failed !== undefined ? Boolean(existing.verification_failed) : false));

                const item = {
                    nickname: accountData.nickname || (existing ? existing.nickname : ''),
                    server: accountData.server || (existing ? existing.server : ''),
                    login: accountData.login || (existing ? existing.login : ''),
                    password: encryptedPassword,
                    lot_multiplier: accountData.lot_multiplier !== undefined ? accountData.lot_multiplier : (existing ? existing.lot_multiplier : 1.0),
                    risk_percent: accountData.risk_percent !== undefined ? accountData.risk_percent : (existing ? existing.risk_percent : 1.0),
                    targetEndpoints: targets,
                    endpointId: targets[0] || (existing ? existing.endpointId : null),
                    is_verified: isVerified,
                    staged_offline: stagedOffline,
                    verification_failed: verificationFailed,
                    last_error: verificationFailed ? (accountData.last_error || (existing ? existing.last_error : '')) : null,
                    verified_at: accountData.verified_at || (existing ? existing.verified_at : (isVerified ? Date.now() : null)),
                    staged_at: accountData.staged_at || (existing ? existing.staged_at : (stagedOffline ? Date.now() : null)),
                    saved_at: Date.now()
                };
                if (idx >= 0) {
                    vault[idx] = item;
                } else {
                    vault.push(item);
                }
                localStorage.setItem('mt5_client_vault', JSON.stringify(vault));

                // Clear auto-heal attempt lock when credentials are updated/saved
                const compositeKey = `${targetLogin}_${targetServer}`;
                if (this._autoHealAttempts && this._autoHealAttempts.has(compositeKey)) {
                    this._autoHealAttempts.delete(compositeKey);
                }
            } catch (e) {
                console.error('[MT5API] Failed to save to client vault:', e);
            }
        }

        async verifyAndSaveLocalPassword(login, server, rawPassword) {
            try {
                const targetLogin = Number(login);
                const targetServer = String(server || '').trim();
                const cleanPass = String(rawPassword || '').trim();

                if (!targetLogin || !targetServer || !cleanPass) {
                    return { success: false, error: 'Login, server, and password are required.' };
                }

                // 1. Check if an active/online bridge endpoint exists
                const onlineEndpoints = (this.endpoints || []).filter(e => e.enabled && e.status === 'online' && e.url);
                const hasOnlineBridge = onlineEndpoints.length > 0;

                // 2. If a bridge is online, enforce the Broker Verification Gate
                if (hasOnlineBridge) {
                    console.log(`[MT5API] 🔒 Online bridge available (${onlineEndpoints.length}). Verifying credentials with broker for #${targetLogin}...`);

                    const verifyRes = await this.verifyAndUpdateBrokerPassword(targetLogin, targetServer, cleanPass);

                    if (verifyRes && verifyRes.verified) {
                        return {
                            success: true,
                            verified: true,
                            is_verified: true,
                            staged_offline: false,
                            broker: verifyRes.broker,
                            balance: verifyRes.balance,
                            message: 'Broker verified & saved to encrypted Local Vault and Bridge DPAPI!'
                        };
                    } else {
                        // Broker rejected! DO NOT save to local vault or bridge!
                        const errMsg = verifyRes?.error || 'Broker rejected credentials. Verification failed.';
                        console.warn(`[MT5API] ❌ Broker verification rejected for #${targetLogin}:`, errMsg);
                        return {
                            success: false,
                            verified: false,
                            error: errMsg
                        };
                    }
                } else {
                    // 3. No bridge online: Offline Staging Fallback
                    console.log(`[MT5API] ⚠️ No bridge online. Staging credentials offline in local encrypted vault for #${targetLogin}...`);

                    const matchingInstances = (this.accounts || []).filter(a => 
                        Number(a.login) === targetLogin && 
                        String(a.server || '').trim().toLowerCase() === targetServer.toLowerCase()
                    );

                    await this.saveAccountToClientVault({
                        server: targetServer,
                        login: targetLogin,
                        password: cleanPass,
                        is_verified: false,
                        staged_offline: true,
                        staged_at: Date.now()
                    }, matchingInstances.map(i => i.endpointId));

                    // Update in-memory account representation if present
                    matchingInstances.forEach(inst => {
                        inst.has_local_vault = true;
                        inst.is_local_vault_verified = false;
                        inst.is_staged_offline = true;
                    });

                    this.notifyAccountListeners();

                    return {
                        success: true,
                        verified: false,
                        is_verified: false,
                        staged_offline: true,
                        message: 'Saved to Local Vault (Staged Offline). Will auto-verify with broker once a bridge connects.'
                    };
                }
            } catch (err) {
                console.error('[MT5API] verifyAndSaveLocalPassword error:', err);
                return { success: false, error: err.message };
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

        async addAccount(accountData, endpointTarget = null, onProgress = null) {
            const report = (step, text, pct) => {
                if (typeof onProgress === 'function') {
                    try { onProgress({ step, text, pct }); } catch (_) {}
                }
            };

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

                report(1, 'Encrypting account credentials with E2E AES-256-GCM...', 15);

                let lastSuccessAccount = null;
                const errors = [];
                const successfulTargets = [];

                for (let i = 0; i < targets.length; i++) {
                    const epId = targets[i];
                    const ep = this.endpoints.find(e => e.id === epId);
                    if (!ep || !ep.url) continue;

                    try {
                        const basePct = 20 + Math.floor((i / targets.length) * 60);
                        report(2, `Sending encrypted configuration to ${ep.name}...`, basePct);

                        const bridgeApiKey = ep.apiKey || this.apiKey || 'mt5_secret_key_2026';
                        const encryptedPasswordForBridge = await this.encryptE2EPayload(accountData.password, bridgeApiKey);
                        const payload = {
                            ...accountData,
                            password: encryptedPasswordForBridge
                        };

                        report(3, `Provisioning isolated MT5 directory on ${ep.name}...`, basePct + 15);
                        report(4, `Launching terminal & authenticating with ${accountData.server}...`, basePct + 30);

                        // 35-second client-side timeout ensures UI never hangs indefinitely
                        let res;
                        try {
                            res = await fetch(`${ep.url}/api/accounts/add`, {
                                method: 'POST',
                                headers: this.getReqHeaders(ep),
                                body: JSON.stringify(payload),
                                signal: AbortSignal.timeout(35000)
                            });
                        } catch (fetchErr) {
                            if (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError') {
                                throw new Error(`Connection timed out after 35s while ${ep.name} was initializing MT5.`);
                            }
                            throw fetchErr;
                        }

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
                    report(5, 'Saving credentials to client vault & syncing fleet catalog...', 90);
                    // Master Client Vault: Persist securely in browser's local storage bounded to these bridges
                    await this.saveAccountToClientVault({
                        ...accountData,
                        is_verified: true,
                        staged_offline: false,
                        verified_at: Date.now()
                    }, successfulTargets);
                    await this.syncAccounts(true);
                    report(5, 'Account connected and verified successfully!', 100);
                    return { success: true, account: lastSuccessAccount, targets: successfulTargets };
                }

                return { success: false, error: errors.join('; ') || 'Failed to add account' };
            } catch (e) {
                return { success: false, error: e.message };
            }
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

                // 1. Resolve password from manual input or local encrypted vault
                let password = (manualPassword || '').trim();
                if (!password) {
                    password = await this.getAccountPasswordFromVault(targetLogin, targetServer);
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

        async verifyAndUpdateBrokerPassword(login, server, newPassword) {
            try {
                const targetLogin = Number(login);
                const targetServer = String(server || '').trim();
                const cleanPass = String(newPassword || '').trim();

                if (!targetLogin || !targetServer || !cleanPass) {
                    return { success: false, error: 'Login, server, and new password are required' };
                }

                // 1. Find all endpoints hosting this composite account key (login + server)
                const matchingInstances = (this.accounts || []).filter(a => 
                    Number(a.login) === targetLogin && 
                    this.isServerMatch(a.server, targetServer)
                );

                // 2. Select primary probe bridge
                let primaryEp = null;
                let primaryInst = null;
                if (matchingInstances.length > 0) {
                    primaryInst = matchingInstances.find(a => a.endpointId === this.activeEndpointId) || matchingInstances[0];
                    primaryEp = (this.endpoints || []).find(e => e.id === primaryInst.endpointId);
                }
                if (!primaryEp || primaryEp.status !== 'online') {
                    primaryEp = this.getActiveEndpoint() || (this.endpoints || []).find(e => e.enabled && e.status === 'online' && e.url);
                }

                if (!primaryEp || !primaryEp.url) {
                    return { success: false, error: 'No online bridge server is available to verify credentials with broker' };
                }

                const probeServer = (matchingInstances.length > 0 && matchingInstances[0].server) ? matchingInstances[0].server : targetServer;

                // 3. Broker Verification Gate: Probe primary bridge
                const encPayload = await this.encryptE2EPayload(cleanPass, primaryEp.apiKey);
                const probeRes = await fetch(`${primaryEp.url}/api/accounts/verify_credentials`, {
                    method: 'POST',
                    headers: this.getReqHeaders(primaryEp),
                    body: JSON.stringify({
                        login: targetLogin,
                        server: probeServer,
                        password: encPayload
                    }),
                    signal: AbortSignal.timeout(15000)
                });

                if (!probeRes.ok) {
                    const errData = await probeRes.json().catch(() => ({}));
                    return { 
                        success: false, 
                        error: errData.detail || errData.error || `Bridge returned HTTP ${probeRes.status}` 
                    };
                }

                const probeData = await probeRes.json();
                if (!probeData.verified) {
                    return {
                        success: false,
                        verified: false,
                        error: probeData.error || 'Broker rejected credentials. Existing working password preserved.'
                    };
                }

                // 4. Broker verified! Ensure primary bridge and all other bridges have this account saved
                const hasOnPrimary = matchingInstances.some(inst => inst.endpointId === primaryEp.id);
                if (!hasOnPrimary && primaryEp) {
                    try {
                        const epPayload = await this.encryptE2EPayload(cleanPass, primaryEp.apiKey);
                        await fetch(`${primaryEp.url}/api/accounts/add`, {
                            method: 'POST',
                            headers: this.getReqHeaders(primaryEp),
                            body: JSON.stringify({
                                nickname: primaryInst ? primaryInst.nickname : `MT5 ${targetLogin}`,
                                server: targetServer,
                                login: targetLogin,
                                password: epPayload,
                                lot_multiplier: 1.0,
                                risk_percent: 1.0
                            })
                        });
                    } catch (addErr) {
                        console.warn(`[MT5API] Could not auto-provision verified account to ${primaryEp.name}:`, addErr);
                    }
                }

                // Replicate to all other connected bridges for this composite key
                for (const inst of matchingInstances) {
                    if (inst.endpointId === primaryEp.id || inst.endpointId === 'local') continue;
                    const ep = (this.endpoints || []).find(e => e.id === inst.endpointId);
                    if (!ep || !ep.url) continue;
                    try {
                        const epPayload = await this.encryptE2EPayload(cleanPass, ep.apiKey);
                        await fetch(`${ep.url}/api/accounts/add`, {
                            method: 'POST',
                            headers: this.getReqHeaders(ep),
                            body: JSON.stringify({
                                nickname: inst.nickname || `MT5 ${targetLogin}`,
                                server: targetServer,
                                login: targetLogin,
                                password: epPayload,
                                lot_multiplier: inst.lot_multiplier || 1.0,
                                risk_percent: inst.risk_percent || 1.0
                            })
                        });
                    } catch (epErr) {
                        console.warn(`[MT5API] Could not replicate verified password to ${ep.name}:`, epErr);
                    }
                }

                // 5. Update master client vault in browser with verified status
                const targetEndpoints = matchingInstances.length > 0 
                    ? matchingInstances.map(i => i.endpointId) 
                    : (primaryEp ? [primaryEp.id] : []);

                await this.saveAccountToClientVault({
                    nickname: primaryInst ? primaryInst.nickname : `MT5 ${targetLogin}`,
                    server: targetServer,
                    login: targetLogin,
                    password: cleanPass,
                    is_verified: true,
                    staged_offline: false,
                    verification_failed: false,
                    last_error: null,
                    verified_at: Date.now()
                }, targetEndpoints);

                // 6. Refresh fleet accounts catalog
                await this.syncAccounts(true);

                return {
                    success: true,
                    verified: true,
                    broker: probeData.broker,
                    balance: probeData.balance
                };
            } catch (err) {
                return { success: false, error: `Verification request failed: ${err.message}` };
            }
        }

        async deleteAccount(id, targetEndpointIds = null) {
            try {
                const targetAcc = (this.accounts || []).find(a => String(a.id) === String(id) || String(a.login) === String(id));
                const targetLogin = targetAcc ? String(targetAcc.login || '').trim() : '';
                const targetServer = targetAcc ? (targetAcc.server || '').trim().toLowerCase() : '';

                // Find all matching instances across all bridges
                const matchingAccs = (this.accounts || []).filter(a => {
                    if (String(a.id) === String(id) || String(a.login) === String(id)) return true;
                    if (targetLogin && String(a.login || '').trim() === targetLogin) {
                        if (!targetServer || !a.server || (a.server || '').trim().toLowerCase() === targetServer) return true;
                    }
                    return false;
                });

                // Filter by targetEndpointIds if provided
                const targetEndpointsFilter = Array.isArray(targetEndpointIds) && targetEndpointIds.length > 0
                    ? targetEndpointIds
                    : null;

                // Dispatch DELETE to all bridge endpoints hosting this account
                const deletePromises = [];
                const contactedEpIds = new Set();

                for (const m of matchingAccs) {
                    if (targetEndpointsFilter && !targetEndpointsFilter.includes(m.endpointId)) {
                        continue;
                    }
                    const ep = this.endpoints.find(e => e.id === m.endpointId || e.url === m.endpointUrl);
                    if (ep && ep.url && !contactedEpIds.has(ep.id)) {
                        contactedEpIds.add(ep.id);
                        const deleteUrl = `${ep.url}/api/accounts/${encodeURIComponent(m.id)}`;
                        deletePromises.push(
                            fetch(deleteUrl, {
                                method: 'DELETE',
                                headers: this.getReqHeaders(ep)
                            }).catch(err => console.warn(`[MT5API] Bridge ${ep.name} delete error:`, err))
                        );
                    }
                }

                // Fallback: If no instances found, attempt delete on default/mapped endpoint
                if (contactedEpIds.size === 0 && !targetEndpointsFilter) {
                    const ep = this.getEndpointForAccount(id);
                    if (ep && ep.url) {
                        deletePromises.push(
                            fetch(`${ep.url}/api/accounts/${encodeURIComponent(id)}`, {
                                method: 'DELETE',
                                headers: this.getReqHeaders(ep)
                            }).catch(err => console.warn(`[MT5API] Bridge ${ep.name} delete fallback error:`, err))
                        );
                    }
                }

                await Promise.allSettled(deletePromises);

                // Check if any instances of this account remain on any bridge
                const remainingInstances = (this.accounts || []).filter(a => {
                    if (contactedEpIds.has(a.endpointId)) return false;
                    if (targetLogin && String(a.login) === targetLogin) return true;
                    return false;
                });

                // Clean from client vault only if deleted from all bridges
                if (!targetEndpointsFilter || remainingInstances.length === 0) {
                    try {
                        const raw = localStorage.getItem('mt5_client_vault');
                        if (raw) {
                            const vault = JSON.parse(raw);
                            const filtered = vault.filter(v => {
                                if (String(v.id) === String(id) || String(v.login) === String(id)) return false;
                                if (targetLogin && String(v.login) === targetLogin) {
                                    if (!targetServer || !v.server || (v.server || '').toLowerCase() === targetServer) return false;
                                }
                                return true;
                            });
                            localStorage.setItem('mt5_client_vault', JSON.stringify(filtered));
                        }
                    } catch (_) {}
                }

                // Clean from local state and caches
                const deletedIds = new Set([String(id), ...(targetLogin ? [targetLogin] : []), ...matchingAccs.filter(a => contactedEpIds.has(a.endpointId)).map(a => String(a.id))]);
                deletedIds.forEach(did => {
                    this.pausedAccountIds.delete(did);
                    this.multiAccountSelection.delete(did);
                    if (this._accountSymbolsCache) this._accountSymbolsCache.delete(did);
                    localStorage.removeItem(`mt5_symbols_${did}`);
                });

                if (this.activeAccountId && deletedIds.has(String(this.activeAccountId))) {
                    this.activeAccountId = null;
                }

                this.accounts = this.accounts.filter(a => !deletedIds.has(String(a.id)));
                await this.syncAccounts(true);
                return true;
            } catch (e) {
                console.error('[MT5API] Failed to delete account across bridges:', e);
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
                    if (!ep) return this.getMockSymbols();

                    // 1. Try WebSocket RPC first
                    try {
                        const wsRes = await this.wsRequest(ep.id, {
                            action: 'get_symbols',
                            account_id: acc ? acc.id : null
                        }, 3500);
                        if (wsRes && wsRes.symbols && wsRes.symbols.length > 0) {
                            this._allSymbols = wsRes.symbols;
                            if (!this._symbolMap) this._symbolMap = new Map();
                            this._allSymbols.forEach(s => {
                                this._symbolMap.set(s.symbol.toUpperCase(), s);
                            });
                            console.log(`[MT5API] Cached ${this._allSymbols.length} MT5 symbols in local memory via WebSocket.`);
                            return this._allSymbols;
                        }
                    } catch (_) {}

                    // 2. HTTP REST fallback
                    if (!ep.url) return this.getMockSymbols();
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

            // 3. Direct fetch from bridge (WebSocket RPC first, HTTP fallback)
            try {
                const ep = this.getEndpointForAccount(accId);
                if (ep) {
                    // Try WebSocket RPC
                    try {
                        const wsRes = await this.wsRequest(ep.id, {
                            action: 'get_symbols',
                            account_id: accId
                        }, 10000);
                        if (wsRes && wsRes.symbols && wsRes.symbols.length > 0) {
                            this._accountSymbolsCache.set(accId, wsRes.symbols);
                            try {
                                localStorage.setItem(`mt5_symbols_${accId}`, JSON.stringify(wsRes.symbols));
                            } catch (_) {}
                            return wsRes.symbols;
                        }
                    } catch (_) {}

                    // HTTP fallback
                    if (ep.url) {
                        const res = await fetch(`${ep.url}/api/symbols?account_id=${encodeURIComponent(accId)}`, {
                            headers: this.getReqHeaders(ep),
                            signal: AbortSignal.timeout(25000)
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
                if (!acc) return null;
                const ep = this.getEndpointForAccount(acc ? acc.id : null);
                if (!ep || !ep.enabled || ep.status !== 'online') return null;

                // 1. Try WebSocket RPC first
                try {
                    const wsRes = await this.wsRequest(ep.id, {
                        action: 'get_symbol_info',
                        symbol: clean,
                        account_id: acc ? acc.id : null
                    }, 3000);
                    if (wsRes && wsRes.symbol_info) {
                        if (!this._symbolMap) this._symbolMap = new Map();
                        this._symbolMap.set(clean, wsRes.symbol_info);
                        if (wsRes.symbol_info.earliest_time_ms) {
                            if (!window._symbolEarliestTime) window._symbolEarliestTime = {};
                            window._symbolEarliestTime[clean] = wsRes.symbol_info.earliest_time_ms;
                        }
                        if (wsRes.symbol_info.earliest_date) {
                            if (!window._symbolEarliestDate) window._symbolEarliestDate = {};
                            window._symbolEarliestDate[clean] = wsRes.symbol_info.earliest_date;
                        }
                        return wsRes.symbol_info;
                    }
                } catch (_) {}

                // 2. HTTP REST fallback
                if (!ep.url) return null;
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
                if (!acc) return {};
                const ep = this.getEndpointForAccount(acc ? acc.id : null);
                if (!ep || !ep.enabled || ep.status !== 'online') return {};

                let quotes = null;

                // 1. Try WebSocket RPC first
                try {
                    const wsRes = await this.wsRequest(ep.id, {
                        action: 'get_quotes',
                        symbols: symParam,
                        account_id: acc ? acc.id : null
                    }, 3000);
                    if (wsRes && wsRes.quotes) {
                        quotes = wsRes.quotes;
                    }
                } catch (_) {}

                // 2. HTTP REST fallback
                if (!quotes && ep.url) {
                    const accParam = acc ? `&account_id=${encodeURIComponent(acc.id)}` : '';
                    const url = `${ep.url}/api/quotes?symbols=${encodeURIComponent(symParam)}${accParam}`;
                    const res = await fetch(url, { headers: this.getReqHeaders(ep) });
                    if (res.ok) {
                        const data = await res.json();
                        quotes = data.quotes || {};
                    }
                }

                if (!quotes) quotes = {};

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
            const cleanSym = (symbol || 'EURUSD').split(':').pop();
            const acc = accountId 
                ? (this.accounts.find(a => String(a.id) === String(accountId)) || this.getActiveAccount())
                : this.getActiveAccount();
            if (!acc) return [];
            const targetAccId = acc ? acc.id : null;
            const ep = this.getEndpointForAccount(targetAccId);
            if (!ep || !ep.enabled || ep.status !== 'online') return [];

            // 1. Try WebSocket RPC first
            if (ep) {
                try {
                    const wsRes = await this.wsRequest(ep.id, {
                        action: 'get_bars',
                        symbol: cleanSym,
                        resolution: String(resolution),
                        count: Number(count) || 500,
                        from: from ? Math.floor(from) : null,
                        to: to ? Math.ceil(to) : null,
                        account_id: targetAccId
                    }, 3500);

                    if (wsRes && wsRes.success && Array.isArray(wsRes.bars)) {
                        if (wsRes.earliest_time_ms) {
                            if (!window._symbolEarliestTime) window._symbolEarliestTime = {};
                            window._symbolEarliestTime[cleanSym] = wsRes.earliest_time_ms;
                        }
                        if (wsRes.earliest_date) {
                            if (!window._symbolEarliestDate) window._symbolEarliestDate = {};
                            window._symbolEarliestDate[cleanSym] = wsRes.earliest_date;
                        }
                        return wsRes.bars;
                    }
                } catch (_) {}
            }

            // 2. HTTP REST fallback
            try {
                if (!ep || !ep.url) return [];
                const accParam = acc ? `&account_id=${encodeURIComponent(acc.id)}` : '';
                let rangeParams = '';
                if (from && to) {
                    rangeParams = `&from=${Math.floor(from)}&to=${Math.ceil(to)}`;
                }
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

        async triggerHFSync(symbol, server = null) {
            try {
                const ep = this.getActiveEndpoint();
                if (!ep || !ep.url) return;
                const cleanSym = String(symbol || '').split(':').pop().toUpperCase().trim();
                await fetch(`${ep.url}/api/hf/sync`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': ep.apiKey || '',
                        'X-Shield-Token': ep.shieldToken || ''
                    },
                    body: JSON.stringify({ symbol: cleanSym, server: server || null })
                });
            } catch (_) {}
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

            let targetAcc = null;
            if (accountId && this.accounts) {
                targetAcc = this.accounts.find(a => String(a.id) === String(accountId));
            }
            if (!targetAcc) {
                targetAcc = this.getActiveAccount();
            }

            const targetEp = this.getEndpointForAccount(targetAcc ? targetAcc.id : null);
            const targetEpId = targetEp ? targetEp.id : null;

            if (callback) {
                this.tickListeners.set(callback, {
                    endpointId: targetEpId,
                    accountId: targetAcc ? targetAcc.id : null,
                    symbol: clean
                });
            }
            this.ensureWebSocket();
            this.startFallbackTickPolling();

            // Direct subscription strictly to the specific bridge endpoint hosting this account
            if (targetEp) {
                const targetSocket = this.wsSockets.get(targetEp.id);
                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    try {
                        targetSocket.send(JSON.stringify({
                            action: 'subscribe',
                            symbol: this.activeSymbol,
                            resolution: this.activeResolution || '1',
                            account_id: targetAcc ? targetAcc.id : null
                        }));
                    } catch (_) {}
                }
            } else {
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
        }

        unsubscribeQuotes(callback) {
            this.tickListeners.delete(callback);
        }

        startFallbackTickPolling() {
            if (this._fallbackTickTimer) return;
            this._fallbackTickTimer = setInterval(async () => {
                if (!this.endpoints || this.endpoints.length === 0 || !this.tickListeners || this.tickListeners.size === 0) return;

                if (Date.now() - (this._lastTickReceivedTime || 0) < 1800) {
                    return;
                }

                // Group active listeners by unique symbol and accountId so every open chart gets ticks
                const targets = new Map();
                this.tickListeners.forEach((info) => {
                    if (info && info.symbol) {
                        const key = `${info.symbol}_${info.accountId || ''}`;
                        if (!targets.has(key)) {
                            targets.set(key, { symbol: info.symbol, accountId: info.accountId, endpointId: info.endpointId });
                        }
                    }
                });

                for (const target of targets.values()) {
                    try {
                        let targetAcc = null;
                        if (target.accountId && this.accounts) {
                            targetAcc = this.accounts.find(a => String(a.id) === String(target.accountId));
                        }
                        if (!targetAcc) targetAcc = this.getActiveAccount();
                        const ep = this.getEndpointForAccount(targetAcc ? targetAcc.id : null);
                        if (!ep || !ep.url || !ep.enabled || ep.status !== 'online') continue;

                        const accParam = targetAcc ? `&account_id=${encodeURIComponent(targetAcc.id)}` : '';
                        const url = `${ep.url}/api/tick?symbol=${encodeURIComponent(target.symbol)}&resolution=${encodeURIComponent(this.activeResolution || '1')}${accParam}`;
                        const res = await fetch(url, { headers: this.getReqHeaders(ep), signal: AbortSignal.timeout(3000) });
                        if (res.ok) {
                            const data = await res.json();
                            if (data && data.success) {
                                this._lastTickReceivedTime = Date.now();
                                const tickMsg = { type: 'tick', endpointId: ep ? ep.id : null, ...data };
                                this.tickListeners.forEach((info, cb) => {
                                    if (info && info.endpointId && ep && info.endpointId !== ep.id) return;
                                    if (tickMsg.account_id && info && info.accountId && String(tickMsg.account_id) !== String(info.accountId)) return;
                                    try { cb(tickMsg); } catch (_) {}
                                });
                            }
                        }
                    } catch (_) {}
                }
            }, 1000);
        }

        ensureWebSocket() {
            // Only connect WebSockets to endpoints that are enabled, online or standby, NOT unauthorized,
            // AND actually have added, unpaused accounts!
            const enabledEndpoints = (this.endpoints || []).filter(e => 
                e.enabled && 
                e.status !== 'unauthorized' && 
                e.status !== 'offline' &&
                (this.accounts || []).some(a => (a.endpointId === e.id || a.endpointUrl === e.url) && !this.isAccountPaused(a.id))
            );
            if (enabledEndpoints.length === 0) return;

            enabledEndpoints.forEach(ep => {
                let socket = this.wsSockets.get(ep.id);
                if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
                    return;
                }

                try {
                    const wsProto = ep.url.startsWith('https') ? 'wss:' : 'ws:';
                    const host = ep.url.replace(/^https?:\/\//, '');
                    let wsUrl = `${wsProto}//${host}/ws/quotes`;

                    // Origin Zero-Trust query parameter for WebSocket
                    let shield = ep.shieldToken || '';
                    if (!shield && ep.url) {
                        try {
                            const parsed = new URL(ep.url);
                            const pathPart = parsed.pathname.replace(/^\/+|\/+$/g, '');
                            if (pathPart && !pathPart.includes('/')) {
                                shield = pathPart;
                            }
                        } catch (_) {}
                    }
                    if (shield && !shield.startsWith('enc:v1:')) {
                        wsUrl += (wsUrl.includes('?') ? '&' : '?') + `shield_token=${encodeURIComponent(shield)}`;
                    }

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
                        socket._connectedAt = Date.now();
                        socket._lastActivityTime = Date.now();

                        // 1. Re-subscribe all active chart / quote listeners currently registered
                        let reSubscribedCount = 0;
                        if (this.tickListeners && this.tickListeners.size > 0) {
                            const subsByAcc = new Map();
                            this.tickListeners.forEach((info) => {
                                if (info && info.symbol) {
                                    const epMatches = (!info.endpointId || info.endpointId === ep.id);
                                    if (epMatches) {
                                        const subKey = `${info.symbol}_${info.accountId || ''}`;
                                        subsByAcc.set(subKey, { symbol: info.symbol, account_id: info.accountId });
                                    }
                                }
                            });
                            subsByAcc.forEach((sub) => {
                                reSubscribedCount++;
                                try {
                                    socket.send(JSON.stringify({
                                        action: 'subscribe',
                                        symbol: sub.symbol,
                                        resolution: this.activeResolution || '1',
                                        token: ep.apiKey,
                                        account_id: sub.account_id
                                    }));
                                } catch (_) {}
                            });
                        }

                        // 2. If no existing subscriptions were sent, send primary active symbol handshake
                        if (reSubscribedCount === 0) {
                            const acc = this.getActiveAccount();
                            const accEp = this.getEndpointForAccount(acc ? acc.id : null);
                            const handshakeAid = (acc && accEp && accEp.id === ep.id) ? acc.id : null;
                            const handshake = {
                                action: 'subscribe',
                                symbol: this.activeSymbol,
                                resolution: this.activeResolution || '1',
                                token: ep.apiKey,
                                account_id: handshakeAid
                            };
                            try {
                                socket.send(JSON.stringify(handshake));
                            } catch (_) {}
                        }

                        // 3. Immediately sync positions & floating PnL on connection
                        this.fetchPositions().catch(() => {});

                        // Send instant ping and schedule continuous 2.5s live ping heartbeat
                        sendLivePing();
                        if (pingTimer) clearInterval(pingTimer);
                        pingTimer = setInterval(sendLivePing, 2500);
                    };

                    socket.onmessage = (evt) => {
                        socket._lastActivityTime = Date.now();
                        try {
                            const msg = JSON.parse(evt.data);

                            // Intercept Hugging Face Parquet Archival author broadcasts
                            if (msg.hf_author) {
                                window.HF_AUTHOR = msg.hf_author;
                                try { localStorage.setItem('hf_author', msg.hf_author); } catch (_) {}
                                if (window.MT5ParquetIndex && typeof window.MT5ParquetIndex.setAuthor === 'function') {
                                    window.MT5ParquetIndex.setAuthor(msg.hf_author);
                                }
                            }

                            // Intercept and resolve WebSocket RPC responses
                            if (msg.req_id && this._wsPendingRequests && this._wsPendingRequests.has(msg.req_id)) {
                                const pending = this._wsPendingRequests.get(msg.req_id);
                                clearTimeout(pending.timer);
                                this._wsPendingRequests.delete(msg.req_id);
                                pending.resolve(msg);
                                return;
                            }

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
                                msg.endpointId = ep.id;
                                this.tickListeners.forEach((info, cb) => {
                                    if (info && info.endpointId && info.endpointId !== ep.id) {
                                        // Ignore ticks from other bridges to avoid price crosstalk
                                        return;
                                    }
                                    if (msg.account_id && info && info.accountId && String(msg.account_id) !== String(info.accountId)) {
                                        // Ignore ticks from other accounts on the same bridge
                                        return;
                                    }
                                    try { cb(msg); } catch (_) {}
                                });
                            } else if (msg.type === 'positions') {
                                const newPositions = msg.positions || [];
                                // Isolate positions strictly to the accounts belonging to this specific endpoint
                                const epAccounts = (this.accounts || []).filter(a => a.endpointId === ep.id);
                                if (epAccounts.length > 0) {
                                    epAccounts.forEach(acc => {
                                        const cleanLogin = String(acc.login || '').trim();
                                        const accPositions = newPositions.filter(p => {
                                            const pAid = String(p.account_id || '').trim();
                                            return pAid === String(acc.id) || pAid === cleanLogin || pAid.replace(/^mt5_/, '') === cleanLogin;
                                        });
                                        this.processPositionDiff(acc.id, accPositions);
                                        acc.positions = accPositions;
                                    });
                                } else {
                                    const activeAcc = this.getActiveAccount();
                                    if (activeAcc && activeAcc.endpointId === ep.id) {
                                        this.processPositionDiff(activeAcc.id, newPositions);
                                        activeAcc.positions = newPositions;
                                    }
                                }

                                const curActive = this.getActiveAccount();
                                if (curActive) {
                                    const curLogin = String(curActive.login || '').trim();
                                    const matchingAcc = (this.accounts || []).find(a => 
                                        a.endpointId === ep.id && 
                                        (String(a.id) === String(curActive.id) || (curLogin && String(a.login).trim() === curLogin))
                                    );
                                    if (matchingAcc && matchingAcc.positions) {
                                        this.positions = matchingAcc.positions;
                                        curActive.positions = matchingAcc.positions;
                                        this.notifyPositionListeners();
                                    } else if (curActive.endpointId === ep.id) {
                                        this.positions = curActive.positions || [];
                                        this.notifyPositionListeners();
                                    }
                                }
                            } else if (msg.type === 'accounts') {
                                this.handleWebSocketAccountsUpdate(ep.id, msg);
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

                        // Reject any pending RPC requests for this closed bridge
                        if (this._wsPendingRequests) {
                            this._wsPendingRequests.forEach((pending, reqId) => {
                                if (pending.epId === ep.id) {
                                    clearTimeout(pending.timer);
                                    this._wsPendingRequests.delete(reqId);
                                    pending.reject(new Error(`WebSocket disconnected for ${ep.name || ep.id}`));
                                }
                            });
                        }

                        // Auto-discover via bridge Gist if WebSocket dropped unexpectedly (e.g. tunnel rotation)
                        if (ep.gistId) {
                            setTimeout(() => {
                                this.syncEndpointFromGist(ep.id, true).then(() => {
                                    this.syncAccounts(true);
                                    if (ep.enabled) this.ensureWebSocket();
                                });
                            }, 2500);
                        } else {
                            setTimeout(() => {
                                if (ep.enabled) this.ensureWebSocket();
                            }, 2500);
                        }
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
            if (this._wsPendingRequests) {
                this._wsPendingRequests.forEach((pending, reqId) => {
                    clearTimeout(pending.timer);
                    pending.reject(new Error('WebSocket reconnected'));
                });
                this._wsPendingRequests.clear();
            }
            this.wsSockets.forEach((sock) => {
                try {
                    sock.onclose = null;
                    sock.close();
                } catch (_) {}
            });
            this.wsSockets.clear();
            this.ws = null;
            this.ensureWebSocket();
        }

        // --- WebSocket Request-Response (RPC) Protocol ---
        wsRequest(endpointId, payload, timeoutMs = 4000) {
            return new Promise((resolve, reject) => {
                let ep = null;
                if (endpointId) {
                    ep = (this.endpoints || []).find(e => e.id === endpointId);
                }
                if (!ep) {
                    ep = this.getActiveEndpoint();
                }
                if (!ep) {
                    return reject(new Error('No active bridge endpoint configured'));
                }
                const socket = this.wsSockets.get(ep.id);
                if (!socket || socket.readyState !== WebSocket.OPEN) {
                    return reject(new Error(`WebSocket not connected for ${ep.name || ep.id}`));
                }
                const reqId = `ws_req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                const timer = setTimeout(() => {
                    if (this._wsPendingRequests) {
                        this._wsPendingRequests.delete(reqId);
                    }
                    reject(new Error(`WebSocket request timed out (${timeoutMs}ms)`));
                }, timeoutMs);

                if (!this._wsPendingRequests) {
                    this._wsPendingRequests = new Map();
                }
                this._wsPendingRequests.set(reqId, { resolve, reject, timer, epId: ep.id });

                try {
                    socket.send(JSON.stringify({
                        ...payload,
                        req_id: reqId,
                        token: ep.apiKey || undefined
                    }));
                } catch (err) {
                    clearTimeout(timer);
                    this._wsPendingRequests.delete(reqId);
                    reject(err);
                }
            });
        }

        handleWebSocketAccountsUpdate(endpointId, data) {
            const ep = (this.endpoints || []).find(e => e.id === endpointId);
            if (!ep || !data || !Array.isArray(data.accounts)) return;

            const accountsList = data.accounts;
            const updatedEpAccounts = accountsList.map(acc => {
                const isPaused = this.isAccountPaused(acc.id);
                const oldAcc = (this.accounts || []).find(a => String(a.id) === String(acc.id) || String(a.login) === String(acc.login));
                return {
                    ...acc,
                    endpointId: ep.id,
                    endpointName: ep.name,
                    endpointUrl: ep.url,
                    endpointApiKey: ep.apiKey,
                    is_paused: isPaused,
                    is_connected: Boolean(acc.is_connected && !isPaused && ep.status === 'online'),
                    positions: (oldAcc && Array.isArray(oldAcc.positions) && oldAcc.positions.length > 0) ? oldAcc.positions : (acc.positions || []),
                    has_password: Boolean(acc.has_password),
                    has_dpapi: Boolean(acc.has_dpapi),
                    has_native_vault: Boolean(acc.has_native_vault && acc.is_connected),
                    survives_reboot: Boolean(acc.survives_reboot || acc.has_dpapi || (acc.has_native_vault && acc.is_connected)),
                    is_verified: Boolean(acc.is_connected && !isPaused && ep.status === 'online'),
                    auth_mode: acc.auth_mode || (acc.has_dpapi ? 'dpapi_vaulted' : (acc.is_connected ? 'mt5_native_vault' : 'awaiting_credentials')),
                    auth_label: acc.auth_label || (acc.has_dpapi ? 'Bridge Secured (DPAPI)' : (acc.is_connected ? 'Official MT5 Saved' : 'Awaiting Password'))
                };
            });

            // Merge with accounts from other endpoints
            const otherAccounts = (this.accounts || []).filter(a => a.endpointId !== ep.id);
            this.accounts = [...otherAccounts, ...updatedEpAccounts];
            this.isConnected = true;

            if (ep.id === this.activeEndpointId && data.active_account_id) {
                if (this.accounts.some(a => String(a.id) === String(data.active_account_id))) {
                    this.activeAccountId = data.active_account_id;
                }
            } else if (!this.accounts.some(a => String(a.id) === String(this.activeAccountId))) {
                const firstActive = this.accounts.find(a => a.is_active && !a.is_paused);
                this.activeAccountId = firstActive ? firstActive.id : (this.accounts[0] ? this.accounts[0].id : null);
            }

            // Sync is_active across sibling physical instances
            const curActive = this.getActiveAccount();
            const curLogin = curActive ? String(curActive.login || '').trim() : '';
            if (curLogin) {
                this.accounts.forEach(a => {
                    if (String(a.login || '').trim() === curLogin) {
                        a.is_active = true;
                    }
                });
            }

            try {
                localStorage.setItem('mt5_accounts_cache', JSON.stringify(this.accounts));
            } catch (_) {}

            this.notifyAccountListeners();
        }

        // --- Orders & Positions Execution ---
        async fetchPositions(accountId = null) {
            if (accountId) {
                const ep = this.getEndpointForAccount(accountId);
                if (!ep) return [];

                const cleanLogin = String(accountId).replace(/^mt5_/, '');
                const matchAcc = (a) => String(a.id) === String(accountId) || String(a.login) === cleanLogin || String(a.id).replace(/^mt5_/, '') === cleanLogin;

                // 1. Try WebSocket RPC first
                try {
                    const wsRes = await this.wsRequest(ep.id, {
                        action: 'get_positions',
                        account_id: String(accountId)
                    }, 3000);
                    if (wsRes && wsRes.success && Array.isArray(wsRes.positions)) {
                        const pos = wsRes.positions;
                        this.processPositionDiff(accountId, pos);
                        const acc = this.accounts.find(matchAcc);
                        if (acc) acc.positions = pos;
                        if (!this.activeAccountId || this.activeAccountId === accountId || (acc && acc.is_active)) {
                            this.positions = pos;
                            this.notifyPositionListeners();
                        }
                        return pos;
                    }
                } catch (_) {}

                // 2. HTTP REST fallback
                if (ep.url) {
                    try {
                        const accParam = `?account_id=${encodeURIComponent(accountId)}`;
                        const res = await fetch(`${ep.url}/api/positions${accParam}`, {
                            headers: this.getReqHeaders(ep)
                        });
                        if (res.ok) {
                            const data = await res.json();
                            const pos = data.positions || [];
                            this.processPositionDiff(accountId, pos);
                            const acc = this.accounts.find(matchAcc);
                            if (acc) acc.positions = pos;
                            if (!this.activeAccountId || this.activeAccountId === accountId || (acc && acc.is_active)) {
                                this.positions = pos;
                                this.notifyPositionListeners();
                            }
                            return pos;
                        }
                    } catch (e) {}
                }
                const acc = this.accounts.find(matchAcc);
                return (acc && acc.positions) ? acc.positions : [];
            }

            // Global parallel sync: fetch positions strictly from online enabled endpoints that have added accounts!
            const viableEndpoints = (this.endpoints || []).filter(e => 
                e.enabled && 
                e.status === 'online' && 
                e.status !== 'unauthorized' &&
                (this.accounts || []).some(a => (a.endpointId === e.id || a.endpointUrl === e.url) && !this.isAccountPaused(a.id))
            );
            if (viableEndpoints.length === 0) return this.positions || [];

            const allPromises = viableEndpoints.map(async ep => {
                // Try WebSocket RPC first
                try {
                    const wsRes = await this.wsRequest(ep.id, { action: 'get_positions' }, 3000);
                    if (wsRes && wsRes.success && Array.isArray(wsRes.positions)) {
                        return wsRes.positions.map(p => ({
                            ...p,
                            endpointId: ep.id,
                            endpointName: ep.name
                        }));
                    }
                } catch (_) {}

                // HTTP fallback
                if (ep.url) {
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
                }
                return [];
            });

            const results = await Promise.allSettled(allPromises);
            const combinedPositions = [];
            for (const r of results) {
                if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                    combinedPositions.push(...r.value);
                }
            }

            // Deduplicate positions across multi-bridge reports by ticket
            const seenTickets = new Set();
            const dedupedPositions = [];
            for (const p of combinedPositions) {
                const key = p.ticket != null ? String(p.ticket) : `${p.symbol}_${p.type}_${p.time}`;
                if (!seenTickets.has(key)) {
                    seenTickets.add(key);
                    dedupedPositions.push(p);
                }
            }

            // Distribute positions to respective accounts in this.accounts
            if (this.accounts) {
                this.accounts.forEach(a => {
                    const aId = String(a.id);
                    const aLogin = String(a.login || '').trim();
                    a.positions = dedupedPositions.filter(p => {
                        const pAid = String(p.account_id || '').trim();
                        return pAid === aId || (aLogin && (pAid === aLogin || pAid.replace(/^mt5_/, '') === aLogin));
                    });
                });
            }

            const activeAcc = this.getActiveAccount();
            if (activeAcc) {
                const actId = String(activeAcc.id);
                const actLogin = String(activeAcc.login || '').trim();
                this.positions = dedupedPositions.filter(p => {
                    const pAid = String(p.account_id || '').trim();
                    return pAid === actId || (actLogin && (pAid === actLogin || pAid.replace(/^mt5_/, '') === actLogin)) || !p.account_id;
                });
            } else {
                this.positions = dedupedPositions;
            }
            this.notifyPositionListeners();
            return dedupedPositions;
        }

        async placeOrder({ symbol, type, orderType = 'market', price = 0.0, lots, sl = 0.0, tp = 0.0, comment = "TV Order", accountId = null }) {
            try {
                const targetAcc = accountId || this.activeAccountId;
                if (targetAcc && this.isAccountPaused(targetAcc)) {
                    return { success: false, error: 'Cannot place order: This account is currently paused (Standby mode). Click Resume in MT5 Fleet first.' };
                }
                const ep = this.getEndpointForAccount(targetAcc);
                if (!ep) {
                    return { success: false, error: 'Bridge endpoint is not configured or offline for this account.' };
                }
                const cleanSym = (symbol || 'EURUSD').split(':').pop();
                let effectiveType = type.toUpperCase();
                if (orderType === 'limit') {
                    effectiveType = effectiveType === 'BUY' ? 'BUY_LIMIT' : 'SELL_LIMIT';
                } else if (orderType === 'stop') {
                    effectiveType = effectiveType === 'BUY' ? 'BUY_STOP' : 'SELL_STOP';
                }

                // 1. Try WebSocket RPC first
                try {
                    const wsRes = await this.wsRequest(ep.id, {
                        action: 'order_place',
                        account_id: targetAcc,
                        symbol: cleanSym,
                        type: effectiveType,
                        price: Number(price) || 0.0,
                        lots: Number(lots),
                        sl: Number(sl) || 0.0,
                        tp: Number(tp) || 0.0,
                        comment
                    }, 5000);
                    if (wsRes && (wsRes.success !== undefined || wsRes.ticket !== undefined || wsRes.order !== undefined)) {
                        await this.fetchPositions(targetAcc);
                        return wsRes;
                    }
                } catch (wsErr) {
                    console.warn('[MT5API] WS placeOrder fallback to HTTP:', wsErr.message);
                }

                // 2. HTTP REST fallback
                if (!ep.url) {
                    return { success: false, error: 'Bridge URL not configured' };
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
                if (!ep) return { success: false, error: 'Bridge endpoint offline' };

                // 1. Try WebSocket RPC first
                try {
                    const wsRes = await this.wsRequest(ep.id, {
                        action: 'order_modify',
                        account_id: targetAcc,
                        ticket: Number(ticket),
                        sl: Number(sl),
                        tp: Number(tp)
                    }, 4500);
                    if (wsRes && (wsRes.success !== undefined || wsRes.ticket !== undefined)) {
                        await this.fetchPositions(targetAcc);
                        return wsRes;
                    }
                } catch (wsErr) {
                    console.warn('[MT5API] WS modifyPosition fallback to HTTP:', wsErr.message);
                }

                // 2. HTTP REST fallback
                if (!ep.url) return { success: false, error: 'Bridge URL offline' };
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
                if (!ep) return { success: false, error: 'Bridge endpoint offline' };

                // 1. Try WebSocket RPC first
                try {
                    const wsRes = await this.wsRequest(ep.id, {
                        action: 'order_close',
                        account_id: targetAcc,
                        ticket: Number(ticket),
                        lots: lots ? Number(lots) : null
                    }, 4500);
                    if (wsRes && (wsRes.success !== undefined || wsRes.ticket !== undefined)) {
                        await this.fetchPositions(targetAcc);
                        return wsRes;
                    }
                } catch (wsErr) {
                    console.warn('[MT5API] WS closePosition fallback to HTTP:', wsErr.message);
                }

                // 2. HTTP REST fallback
                if (!ep.url) return { success: false, error: 'Bridge URL offline' };
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

                // Physical deduplication: If multiple bridges host the SAME physical account (login + server),
                // execute on that account ONCE using its best/healthiest bridge route to prevent double orders on the broker!
                const seenPhysical = new Set();
                const dedupedAccountIds = [];
                for (const accId of activeAccountIds) {
                    const acc = this.accounts.find(a => String(a.id) === String(accId) || String(a.login) === String(accId));
                    const physKey = acc && acc.login ? `${String(acc.login).trim()}::${String(acc.server || '').trim().toLowerCase()}` : String(accId);
                    if (!seenPhysical.has(physKey)) {
                        seenPhysical.add(physKey);
                        dedupedAccountIds.push(acc ? acc.id : accId);
                    }
                }

                const cleanSym = (symbol || 'EURUSD').split(':').pop();

                // Group deduped accounts by their optimal bridge endpoint
                const endpointMap = new Map();
                for (const accId of dedupedAccountIds) {
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
                    // 1. Try WebSocket RPC first
                    try {
                        const wsRes = await this.wsRequest(ep.id, {
                            action: 'order_broadcast',
                            account_ids: accIds,
                            symbol: cleanSym,
                            type: type.toUpperCase(),
                            base_lots: Number(baseLots),
                            sl: Number(sl) || 0.0,
                            tp: Number(tp) || 0.0
                        }, 6000);
                        if (wsRes && (wsRes.success !== undefined || wsRes.results)) {
                            return { ep, data: wsRes };
                        }
                    } catch (_) {}

                    // 2. HTTP REST fallback
                    if (ep.url) {
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
                    }
                    return { ep, data: { success: false, error: 'Endpoint unreachable', results: [] } };
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

        onTick(cb) {
            if (typeof cb === 'function') {
                this.tickListeners.set(cb, {});
            }
        }

        offTick(cb) {
            this.tickListeners.delete(cb);
        }

        notifyPingListeners(endpointId, pingMs) {
            this.pingListeners.forEach(cb => {
                try { cb(endpointId, pingMs); } catch (_) {}
            });
        }

        processPositionDiff(accountId, newPositions = []) {
            let acc = this.accounts.find(a => String(a.id) === String(accountId));
            if (!acc) {
                const cleanId = String(accountId).replace(/^mt5_/, '');
                acc = this.accounts.find(a => String(a.login) === cleanId || String(a.id).replace(/^mt5_/, '') === cleanId);
            }
            if (!acc) acc = this.getActiveAccount();
            const targetId = acc ? acc.id : String(accountId || 'default');
            const accName = acc ? acc.nickname : `Account #${accountId || ''}`;

            if (!this._accountPositionsMap) this._accountPositionsMap = new Map();
            const prevPositions = this._accountPositionsMap.get(targetId);

            if (!prevPositions) {
                // Initial baseline snapshot for this specific account - DO NOT notify on first load!
                const map = new Map();
                newPositions.forEach(p => {
                    map.set(String(p.ticket), p);
                });
                this._accountPositionsMap.set(targetId, map);
                return;
            }

            // Flap & Glitch Guard: If previous snapshot had positions, and newPositions is suddenly empty,
            // require 2 consecutive empty snapshots before firing position closure!
            if (prevPositions.size > 0 && newPositions.length === 0) {
                if (!this._emptySnapshotCounters) this._emptySnapshotCounters = new Map();
                const emptyCounter = this._emptySnapshotCounters.get(targetId) || 0;
                if (emptyCounter < 1) {
                    this._emptySnapshotCounters.set(targetId, emptyCounter + 1);
                    return; // Wait for next tick to verify closure
                }
            }
            if (this._emptySnapshotCounters) {
                this._emptySnapshotCounters.delete(targetId);
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
                        lots: p.lots != null ? p.lots : p.volume,
                        price: p.open_price != null ? p.open_price : p.price_open,
                        sl: p.sl,
                        tp: p.tp,
                        accountName: accName,
                        time: Date.now()
                    });
                } else {
                    // Check for SL/TP modification
                    const oldP = prevPositions.get(ticketKey);
                    if (oldP && (Number(oldP.sl || 0) !== Number(p.sl || 0) || Number(oldP.tp || 0) !== Number(p.tp || 0))) {
                        this.notifyNotificationListeners({
                            type: 'modified',
                            action: 'Order Modified',
                            ticket: p.ticket,
                            symbol: p.symbol,
                            side: p.type,
                            lots: p.lots != null ? p.lots : p.volume,
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
                        lots: oldP.lots != null ? oldP.lots : oldP.volume,
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
            this._accountPositionsMap.set(targetId, updatedMap);
        }
    }

    // Export singleton
    window.MT5API = new MT5Client();

})(window);
