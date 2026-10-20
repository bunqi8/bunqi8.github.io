// Fyers Live Data & WebSocket Engine
// Fully decoupled and portable module for the frontend

class FyersEngine {
    constructor() {
        this.token = localStorage.getItem('fyers_token') || null;
        this.appId = null; // Can be parsed from token if JWT, or we require user to input it
        this.profileName = null;
        this.fyId = null;
        this.isConnected = false;
        
        // Initialize multi-account broker management
        this.initBrokerAccounts();
        
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

    // ==========================================
    // MULTI-ACCOUNT BROKER TOKEN MANAGER & JWT
    // ==========================================

    parseJwt(token) {
        if (!token || typeof token !== 'string') return null;
        try {
            let clean = token.trim();
            if (clean.includes(':') && clean.split(':').length === 2 && clean.includes('.')) {
                clean = clean.split(':')[1];
            }
            const parts = clean.split('.');
            if (parts.length < 2) return null;
            let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4) base64 += '=';
            const jsonStr = decodeURIComponent(Array.prototype.map.call(atob(base64), function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            return JSON.parse(jsonStr);
        } catch (e) {
            try {
                return JSON.parse(atob(token.trim().split('.')[1]));
            } catch (_) {
                return null;
            }
        }
    }

    extractTokenInfo(token) {
        const payload = this.parseJwt(token);
        if (!payload) return null;
        return {
            fyId: payload.fy_id || payload.userId || payload.user_id || payload.sub || null,
            displayName: payload.display_name || payload.name || payload.fullName || null,
            appId: payload.app_id || payload.client_id || payload.aud || null,
            exp: payload.exp ? Number(payload.exp) : null,
            iat: payload.iat ? Number(payload.iat) : null
        };
    }

    getInitials(name, fallbackId) {
        if (name && typeof name === 'string' && name.trim()) {
            const parts = name.trim().split(/\s+/).filter(Boolean);
            if (parts.length >= 2) {
                return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
            } else if (parts.length === 1) {
                return parts[0].slice(0, 2).toUpperCase();
            }
        }
        if (fallbackId && typeof fallbackId === 'string' && fallbackId.trim()) {
            return fallbackId.trim().slice(0, 2).toUpperCase();
        }
        return 'FY';
    }

    formatExpiry(timestampSec) {
        if (!timestampSec) return 'Unknown';
        const date = new Date(timestampSec * 1000);
        const now = Date.now();
        const diffMs = (timestampSec * 1000) - now;
        const isExpired = diffMs <= 0;
        
        const formatted = date.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        }) + ', ' + date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
        
        let relative = '';
        const absDiffSec = Math.floor(Math.abs(diffMs) / 1000);
        if (isExpired) {
            if (absDiffSec < 3600) relative = `${Math.floor(absDiffSec / 60)}m ago`;
            else if (absDiffSec < 86400) relative = `${Math.floor(absDiffSec / 3600)}h ago`;
            else relative = `${Math.floor(absDiffSec / 86400)}d ago`;
            return `${formatted} (Expired ${relative})`;
        } else {
            if (absDiffSec < 3600) relative = `in ${Math.floor(absDiffSec / 60)}m`;
            else if (absDiffSec < 86400) relative = `in ${Math.floor(absDiffSec / 3600)}h`;
            else relative = `in ${Math.floor(absDiffSec / 86400)}d`;
            return `${formatted} (${relative})`;
        }
    }

    isAccountExpired(account) {
        if (!account) return true;
        if (!account.apiExpiresAt) return false;
        return account.apiExpiresAt <= Math.floor(Date.now() / 1000);
    }

    isRefreshExpired(account) {
        if (!account) return true;
        if (!account.refreshExpiresAt) return false;
        return account.refreshExpiresAt <= Math.floor(Date.now() / 1000);
    }

    getAccounts() {
        try {
            const raw = localStorage.getItem('tv_broker_accounts');
            if (raw) {
                const list = JSON.parse(raw);
                if (Array.isArray(list)) return list;
            }
        } catch (_) {}
        return [];
    }

    saveAccounts(accounts) {
        localStorage.setItem('tv_broker_accounts', JSON.stringify(accounts || []));
    }

    getActiveAccountId() {
        return localStorage.getItem('tv_active_broker_id') || null;
    }

    getActiveAccount() {
        const accounts = this.getAccounts();
        if (accounts.length === 0) return null;
        const activeId = this.getActiveAccountId();
        if (activeId) {
            const found = accounts.find(a => a.id === activeId);
            if (found) return found;
        }
        return accounts[0];
    }

    setActiveAccount(accountId) {
        const accounts = this.getAccounts();
        const acc = accounts.find(a => a.id === accountId);
        if (!acc) return false;
        
        localStorage.setItem('tv_active_broker_id', accountId);
        
        const authHeader = (acc.apiAccessToken && acc.apiAccessToken.includes(':'))
            ? acc.apiAccessToken
            : (acc.appId ? `${acc.appId}:${acc.apiAccessToken}` : acc.apiAccessToken);
            
        this.token = authHeader;
        this.appId = acc.appId;
        this.profileName = acc.displayName;
        this.fyId = acc.fyId;
        this.isConnected = !this.isAccountExpired(acc);
        
        localStorage.setItem('fyers_token', authHeader);
        
        window.dispatchEvent(new CustomEvent('fyers_connection_status', { 
            detail: { connected: this.isConnected, name: this.profileName, account: acc }
        }));
        return true;
    }

    initBrokerAccounts() {
        const accounts = this.getAccounts();
        // Auto-migrate legacy token if accounts list is currently empty
        if (accounts.length === 0) {
            const legacyToken = localStorage.getItem('fyers_token');
            if (legacyToken) {
                const info = this.extractTokenInfo(legacyToken);
                if (info && info.fyId) {
                    let inferredAppId = info.appId || 'FYERS-APP';
                    if (legacyToken.includes(':') && legacyToken.split(':').length === 2) {
                        inferredAppId = legacyToken.split(':')[0];
                    }
                    const migrated = {
                        id: 'acc_' + Date.now(),
                        broker: 'fyers',
                        appId: inferredAppId,
                        fyId: info.fyId,
                        displayName: info.displayName || info.fyId,
                        initials: this.getInitials(info.displayName, info.fyId),
                        apiAccessToken: legacyToken.includes(':') ? legacyToken.split(':')[1] : legacyToken,
                        webuiRefreshToken: '',
                        webuiAccessToken: '',
                        apiExpiresAt: info.exp,
                        refreshExpiresAt: null,
                        webuiExpiresAt: null,
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                    };
                    this.saveAccounts([migrated]);
                    localStorage.setItem('tv_active_broker_id', migrated.id);
                }
            }
        }
        
        // Sync active account state
        const active = this.getActiveAccount();
        if (active) {
            const authHeader = (active.apiAccessToken && active.apiAccessToken.includes(':'))
                ? active.apiAccessToken
                : (active.appId ? `${active.appId}:${active.apiAccessToken}` : active.apiAccessToken);
            this.token = authHeader;
            this.appId = active.appId;
            this.profileName = active.displayName;
            this.fyId = active.fyId;
            this.isConnected = !this.isAccountExpired(active);
        }
    }

    validateTokens({ appId, apiAccessToken, webuiRefreshToken, webuiAccessToken, isReplace = false, existingAccount = null }) {
        if (!appId || !appId.trim()) {
            return { valid: false, error: "App ID is required." };
        }
        
        const hasApi = Boolean(apiAccessToken && apiAccessToken.trim());
        const hasRefresh = Boolean(webuiRefreshToken && webuiRefreshToken.trim());
        const hasWebui = Boolean(webuiAccessToken && webuiAccessToken.trim());
        
        if (!isReplace) {
            if (!hasApi) return { valid: false, error: "API Access Token is required." };
            // WebUI Refresh Token is optional but highly recommended
        } else {
            if (!hasApi && !hasRefresh && !hasWebui && existingAccount && existingAccount.appId === appId.trim()) {
                return { valid: false, error: "No changes entered to replace." };
            }
        }
        
        const infoApi = hasApi ? this.extractTokenInfo(apiAccessToken) : (existingAccount ? { fyId: existingAccount.fyId, displayName: existingAccount.displayName, exp: existingAccount.apiExpiresAt } : null);
        const infoRefresh = hasRefresh ? this.extractTokenInfo(webuiRefreshToken) : (existingAccount ? { fyId: existingAccount.fyId, displayName: existingAccount.displayName, exp: existingAccount.refreshExpiresAt } : null);
        const infoWebui = hasWebui ? this.extractTokenInfo(webuiAccessToken) : (existingAccount && existingAccount.webuiAccessToken ? { fyId: existingAccount.fyId, exp: existingAccount.webuiExpiresAt } : null);
        
        if (hasApi && !infoApi) return { valid: false, error: "API Access Token is not a valid JWT format." };
        if (hasRefresh && !infoRefresh) return { valid: false, error: "WebUI Refresh Token is not a valid JWT format." };
        if (hasWebui && !infoWebui) return { valid: false, error: "WebUI Access Token is not a valid JWT format." };
        
        if (hasApi && !infoApi.fyId) return { valid: false, error: "API Access Token missing User ID ('fy_id')." };
        if (hasRefresh && !infoRefresh.fyId) return { valid: false, error: "WebUI Refresh Token missing User ID ('fy_id')." };
        if (hasWebui && !infoWebui.fyId) return { valid: false, error: "WebUI Access Token missing User ID ('fy_id')." };
        
        // Cross-token validation
        const targetFyId = (infoRefresh && infoRefresh.fyId) || (infoApi && infoApi.fyId) || (existingAccount && existingAccount.fyId);
        
        if (infoApi && infoRefresh && infoApi.fyId !== infoRefresh.fyId) {
            return {
                valid: false,
                error: `Cross-token validation failed: API Access Token belongs to User ID "${infoApi.fyId}", but WebUI Refresh Token belongs to "${infoRefresh.fyId}". All tokens must belong to the same user.`
            };
        }
        
        if (infoWebui && targetFyId && infoWebui.fyId !== targetFyId) {
            return {
                valid: false,
                error: `Cross-token validation failed: WebUI Access Token belongs to User ID "${infoWebui.fyId}", which does not match User ID "${targetFyId}".`
            };
        }
        
        if (existingAccount && targetFyId && existingAccount.fyId && targetFyId !== existingAccount.fyId) {
            return {
                valid: false,
                error: `Cross-token validation failed: Provided tokens belong to User ID "${targetFyId}", but this account is registered to "${existingAccount.fyId}". Replacement tokens must belong to the same user.`
            };
        }
        
        const displayName = (infoRefresh && infoRefresh.displayName) || (infoApi && infoApi.displayName) || (existingAccount && existingAccount.displayName) || targetFyId || "Fyers User";
        const initials = this.getInitials(displayName, targetFyId);
        
        return {
            valid: true,
            fyId: targetFyId,
            displayName: displayName,
            initials: initials,
            apiExpiresAt: (infoApi && infoApi.exp) || null,
            refreshExpiresAt: (infoRefresh && infoRefresh.exp) || null,
            webuiExpiresAt: (infoWebui && infoWebui.exp) || null
        };
    }

    saveAccount({ appId, apiAccessToken, webuiRefreshToken, webuiAccessToken, id = null }) {
        const accounts = this.getAccounts();
        const isReplace = Boolean(id);
        const existing = isReplace ? accounts.find(a => a.id === id) : null;
        
        const check = this.validateTokens({
            appId,
            apiAccessToken,
            webuiRefreshToken,
            webuiAccessToken,
            isReplace,
            existingAccount: existing
        });
        
        if (!check.valid) {
            return { success: false, error: check.error };
        }
        
        let accountObj = null;
        if (isReplace && existing) {
            accountObj = existing;
            accountObj.appId = appId.trim();
            accountObj.fyId = check.fyId;
            accountObj.displayName = check.displayName;
            accountObj.initials = check.initials;
            if (apiAccessToken && apiAccessToken.trim()) {
                let cleanApi = apiAccessToken.trim();
                if (cleanApi.includes(':') && cleanApi.split(':').length === 2 && cleanApi.includes('.')) {
                    cleanApi = cleanApi.split(':')[1];
                }
                accountObj.apiAccessToken = cleanApi;
                accountObj.apiExpiresAt = check.apiExpiresAt;
            }
            if (webuiRefreshToken && webuiRefreshToken.trim()) {
                accountObj.webuiRefreshToken = webuiRefreshToken.trim();
                accountObj.refreshExpiresAt = check.refreshExpiresAt;
            }
            if (webuiAccessToken && webuiAccessToken.trim()) {
                accountObj.webuiAccessToken = webuiAccessToken.trim();
                accountObj.webuiExpiresAt = check.webuiExpiresAt;
            }
            accountObj.updatedAt = Date.now();
        } else {
            let cleanApi = (apiAccessToken || '').trim();
            if (cleanApi.includes(':') && cleanApi.split(':').length === 2 && cleanApi.includes('.')) {
                cleanApi = cleanApi.split(':')[1];
            }
            accountObj = {
                id: 'acc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                broker: 'fyers',
                appId: appId.trim(),
                fyId: check.fyId,
                displayName: check.displayName,
                initials: check.initials,
                apiAccessToken: cleanApi,
                webuiRefreshToken: (webuiRefreshToken || '').trim(),
                webuiAccessToken: (webuiAccessToken || '').trim(),
                apiExpiresAt: check.apiExpiresAt,
                refreshExpiresAt: check.refreshExpiresAt,
                webuiExpiresAt: check.webuiExpiresAt,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            accounts.push(accountObj);
        }
        
        this.saveAccounts(accounts);
        
        // If it is the active account or the first account, activate it
        const currentActiveId = this.getActiveAccountId();
        if (!currentActiveId || currentActiveId === accountObj.id || accounts.length === 1) {
            this.setActiveAccount(accountObj.id);
        } else {
            window.dispatchEvent(new CustomEvent('fyers_connection_status', { 
                detail: { connected: this.isConnected, name: this.profileName, account: this.getActiveAccount() }
            }));
        }
        
        return { success: true, account: accountObj };
    }

    deleteAccount(accountId) {
        let accounts = this.getAccounts();
        const remaining = accounts.filter(a => a.id !== accountId);
        this.saveAccounts(remaining);
        
        const activeId = this.getActiveAccountId();
        if (activeId === accountId) {
            if (remaining.length > 0) {
                this.setActiveAccount(remaining[0].id);
            } else {
                localStorage.removeItem('tv_active_broker_id');
                localStorage.removeItem('fyers_token');
                this.token = null;
                this.appId = null;
                this.profileName = null;
                this.fyId = null;
                this.isConnected = false;
                window.dispatchEvent(new CustomEvent('fyers_connection_status', { detail: { connected: false }}));
            }
        } else {
            window.dispatchEvent(new CustomEvent('fyers_connection_status', { 
                detail: { connected: this.isConnected, name: this.profileName, account: this.getActiveAccount() }
            }));
        }
        return { success: true };
    }

    markActiveAccountExpired(reason) {
        this.isConnected = false;
        window.dispatchEvent(new CustomEvent('fyers_connection_status', { 
            detail: { connected: false, error: reason || 'Token Expired', account: this.getActiveAccount() }
        }));
    }

    setToken(token) {
        this.token = token;
        localStorage.setItem('fyers_token', token);
        const info = this.extractTokenInfo(token);
        if (info && info.fyId) {
            const accounts = this.getAccounts();
            const existing = accounts.find(a => a.fyId === info.fyId);
            if (existing) {
                existing.apiAccessToken = token.includes(':') ? token.split(':')[1] : token;
                existing.apiExpiresAt = info.exp;
                this.saveAccounts(accounts);
            }
        }
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
                            this.markActiveAccountExpired('Token Expired');
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
                            this.markActiveAccountExpired('Token Expired');
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
                                        subs.forEach(sub => sub.cb(tick));
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
                                            // Trigger TradingView to reload history to fetch the missing gap!
                                            const subs = this.subscribers.get(sym);
                                            if (subs) {
                                                subs.forEach(sub => {
                                                    if (sub.resetCb) sub.resetCb();
                                                });
                                            }
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

    subscribe(symbol, callback, resetCallback) {
        if (!this.subscribers.has(symbol)) {
            this.subscribers.set(symbol, new Set());
        }
        this.subscribers.get(symbol).add({ cb: callback, resetCb: resetCallback });
        
        if (!this.pollInterval) {
            this.connectWebSocket();
        }
    }
    
    unsubscribe(symbol, callback) {
        if (this.subscribers.has(symbol)) {
            const subs = this.subscribers.get(symbol);
            for (let sub of subs) {
                if (sub.cb === callback) {
                    subs.delete(sub);
                    break;
                }
            }
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
