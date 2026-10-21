// Fyers Live Data & WebSocket Engine
// Fully decoupled and portable module for the frontend

class FyersEngine {
    constructor() {
        this.token = localStorage.getItem('fyers_token') || null;
        this.appId = null; // Can be parsed from token if JWT, or we require user to input it
        this.profileName = null;
        this.fyId = null;
        this.isConnected = false;
        this._isRefreshing = false;
        this.engineLastLoaded = null;
        
        // Initialize multi-account broker management
        this.initBrokerAccounts();
        
        // Auto-refresh scheduler
        this.setupAutoRefreshScheduler();

        // Lazily preload private engine if PAT is present or cached script exists
        setTimeout(() => {
            const cfg = this.getEngineConfig();
            if (cfg && (cfg.githubPat || this.hasCachedPrivateEngine())) {
                this.loadPrivateEngine(false).catch(() => {});
            }
        }, 1500);
        
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

    isWebuiExpired(account) {
        if (!account) return true;
        if (!account.webuiExpiresAt) return false;
        return account.webuiExpiresAt <= Math.floor(Date.now() / 1000);
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

    async getDecryptedAccount(account) {
        if (!account) return null;
        const copy = { ...account };
        if (copy.apiAccessToken && copy.apiAccessToken.startsWith('enc:v1:')) {
            copy.apiAccessToken = await this.decryptSensitive(copy.apiAccessToken);
        }
        if (copy.webuiRefreshToken && copy.webuiRefreshToken.startsWith('enc:v1:')) {
            copy.webuiRefreshToken = await this.decryptSensitive(copy.webuiRefreshToken);
        }
        if (copy.webuiAccessToken && copy.webuiAccessToken.startsWith('enc:v1:')) {
            copy.webuiAccessToken = await this.decryptSensitive(copy.webuiAccessToken);
        }
        if (copy.pin && copy.pin.startsWith('enc:v1:')) {
            copy.pin = await this.decryptSensitive(copy.pin);
        }
        if (copy.secretKey && copy.secretKey.startsWith('enc:v1:')) {
            copy.secretKey = await this.decryptSensitive(copy.secretKey);
        }
        return copy;
    }

    async setActiveAccount(accountId) {
        const accounts = this.getAccounts();
        const acc = accounts.find(a => a.id === accountId);
        if (!acc) return false;
        
        localStorage.setItem('tv_active_broker_id', accountId);
        
        // Decrypt API Access Token for in-memory session
        let rawApi = acc.apiAccessToken || '';
        if (rawApi && rawApi.startsWith('enc:v1:')) {
            rawApi = await this.decryptSensitive(rawApi);
        }
        
        const authHeader = (rawApi && rawApi.includes(':'))
            ? rawApi
            : (acc.appId ? `${acc.appId}:${rawApi}` : rawApi);
            
        this.token = authHeader;
        this.appId = acc.appId;
        this.profileName = acc.displayName;
        this.fyId = acc.fyId;
        this.isConnected = !this.isAccountExpired(acc);
        
        // Store encrypted token in localStorage for legacy compatibility
        try {
            if (authHeader && authHeader.trim()) {
                const enc = await this.encryptSensitive(authHeader);
                localStorage.setItem('fyers_token', enc);
            }
        } catch (_) {}
        
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
        
        // Auto-encrypt unencrypted credentials & sync active session
        this.autoEncryptAccounts().then(() => {
            const active = this.getActiveAccount();
            if (active) {
                return this.setActiveAccount(active.id);
            }
        }).catch(() => {});
        
        // Synchronous fallback session sync (if already plaintext or immediate)
        const active = this.getActiveAccount();
        if (active) {
            this.appId = active.appId;
            this.profileName = active.displayName;
            this.fyId = active.fyId;
            this.isConnected = !this.isAccountExpired(active);
            if (active.apiAccessToken && !active.apiAccessToken.startsWith('enc:v1:')) {
                const authHeader = (active.apiAccessToken.includes(':'))
                    ? active.apiAccessToken
                    : (active.appId ? `${active.appId}:${active.apiAccessToken}` : active.apiAccessToken);
                this.token = authHeader;
            }
        }
    }

    async autoEncryptAccounts() {
        const accounts = this.getAccounts();
        let changed = false;
        for (const acc of accounts) {
            // 1. API Access Token
            if (acc.apiAccessToken && typeof acc.apiAccessToken === 'string' && !acc.apiAccessToken.startsWith('enc:v1:') && acc.apiAccessToken.trim() !== '') {
                if (!acc.apiExpiresAt) {
                    const info = this.extractTokenInfo(acc.apiAccessToken);
                    if (info && info.exp) acc.apiExpiresAt = info.exp;
                }
                acc.apiAccessToken = await this.encryptSensitive(acc.apiAccessToken);
                changed = true;
            }

            // 2. WebUI Refresh Token
            if (acc.webuiRefreshToken && typeof acc.webuiRefreshToken === 'string' && !acc.webuiRefreshToken.startsWith('enc:v1:') && acc.webuiRefreshToken.trim() !== '') {
                if (!acc.refreshExpiresAt) {
                    const info = this.extractTokenInfo(acc.webuiRefreshToken);
                    if (info && info.exp) acc.refreshExpiresAt = info.exp;
                }
                acc.webuiRefreshToken = await this.encryptSensitive(acc.webuiRefreshToken);
                changed = true;
            }

            // 3. WebUI Access Token
            if (acc.webuiAccessToken && typeof acc.webuiAccessToken === 'string' && !acc.webuiAccessToken.startsWith('enc:v1:') && acc.webuiAccessToken.trim() !== '') {
                if (!acc.webuiExpiresAt) {
                    const info = this.extractTokenInfo(acc.webuiAccessToken);
                    if (info && info.exp) acc.webuiExpiresAt = info.exp;
                }
                acc.webuiAccessToken = await this.encryptSensitive(acc.webuiAccessToken);
                changed = true;
            }

            // If webuiExpiresAt missing but token already encrypted, decrypt once to extract expiry
            if (!acc.webuiExpiresAt && acc.webuiAccessToken && acc.webuiAccessToken.startsWith('enc:v1:')) {
                try {
                    const dec = await this.decryptSensitive(acc.webuiAccessToken);
                    if (dec) {
                        const info = this.extractTokenInfo(dec);
                        if (info && info.exp) {
                            acc.webuiExpiresAt = info.exp;
                            changed = true;
                        }
                    }
                } catch (_) {}
            }

            // 4. PIN
            if (acc.pin && typeof acc.pin === 'string' && !acc.pin.startsWith('enc:v1:') && acc.pin.trim() !== '') {
                acc.pin = await this.encryptSensitive(acc.pin);
                changed = true;
            }

            // 5. Secret Key
            if (acc.secretKey && typeof acc.secretKey === 'string' && !acc.secretKey.startsWith('enc:v1:') && acc.secretKey.trim() !== '') {
                acc.secretKey = await this.encryptSensitive(acc.secretKey);
                changed = true;
            }
        }

        if (changed) {
            this.saveAccounts(accounts);
            window.dispatchEvent(new CustomEvent('fyers_accounts_migrated', { detail: { accounts } }));
        }

        // Also ensure standalone fyers_token in localStorage is encrypted
        const legacyToken = localStorage.getItem('fyers_token');
        if (legacyToken && !legacyToken.startsWith('enc:v1:')) {
            try {
                const enc = await this.encryptSensitive(legacyToken);
                localStorage.setItem('fyers_token', enc);
            } catch (_) {}
        }
    }

    validateTokens({ 
        appId, 
        apiAccessToken, 
        webuiRefreshToken, 
        webuiAccessToken, 
        pin = '', 
        secretKey = '', 
        redirectUri = '', 
        isReplace = false, 
        existingAccount = null 
    }) {
        if (!appId || !appId.trim()) {
            return { valid: false, error: "App ID is required." };
        }
        
        const hasApi = Boolean(apiAccessToken && apiAccessToken.trim());
        const hasRefresh = Boolean(webuiRefreshToken && webuiRefreshToken.trim());
        const hasWebui = Boolean(webuiAccessToken && webuiAccessToken.trim());
        const hasPin = Boolean(pin && pin.trim());
        const hasSecret = Boolean(secretKey && secretKey.trim());
        const hasRedirect = Boolean(redirectUri && redirectUri.trim() && (!existingAccount || existingAccount.redirectUri !== redirectUri.trim()));
        
        if (!isReplace) {
            if (!hasApi) return { valid: false, error: "API Access Token is required." };
            // WebUI Refresh Token is optional but highly recommended
        } else {
            const hasAnyChange = hasApi || hasRefresh || hasWebui || hasPin || hasSecret || hasRedirect || (existingAccount && existingAccount.appId !== appId.trim());
            if (!hasAnyChange) {
                return { valid: false, error: "No changes entered to replace.", noChanges: true };
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

    // ==========================================
    // HARDWARE-GRADE CLIENT-SIDE AES-256 GCM ENCRYPTION
    // ==========================================

    async getCryptoKey() {
        if (this._cachedCryptoKey) return this._cachedCryptoKey;

        let salt = localStorage.getItem('tv_broker_crypto_salt');
        if (!salt) {
            const randomBytes = new Uint8Array(16);
            if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
                crypto.getRandomValues(randomBytes);
            } else if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
                window.crypto.getRandomValues(randomBytes);
            } else if (typeof require === 'function') {
                require('crypto').randomFillSync(randomBytes);
            }
            salt = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
            localStorage.setItem('tv_broker_crypto_salt', salt);
        }

        const subtle = (typeof crypto !== 'undefined' && crypto.subtle)
            ? crypto.subtle
            : (typeof window !== 'undefined' && window.crypto && window.crypto.subtle
                ? window.crypto.subtle
                : (typeof require === 'function' ? require('crypto').webcrypto?.subtle : null));

        if (!subtle) {
            throw new Error("Web Crypto API is not available on this platform.");
        }

        const enc = new TextEncoder();
        const baseSeed = `fyers_secure_vault_${typeof window !== 'undefined' && window.location ? window.location.origin : 'tradingview'}_${salt}`;
        const keyMaterial = await subtle.importKey(
            "raw",
            enc.encode(baseSeed),
            { name: "PBKDF2" },
            false,
            ["deriveKey"]
        );

        this._cachedCryptoKey = await subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: enc.encode("fyers_credential_salt_v1"),
                iterations: 100000,
                hash: "SHA-256"
            },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );

        return this._cachedCryptoKey;
    }

    async encryptSensitive(plaintext) {
        if (!plaintext || typeof plaintext !== 'string' || !plaintext.trim()) return '';
        const clean = plaintext.trim();
        if (clean.startsWith('enc:v1:')) return clean; // already encrypted

        const key = await this.getCryptoKey();
        const subtle = (typeof crypto !== 'undefined' && crypto.subtle)
            ? crypto.subtle
            : (typeof window !== 'undefined' && window.crypto ? window.crypto.subtle : null);

        const iv = new Uint8Array(12);
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            crypto.getRandomValues(iv);
        } else if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
            window.crypto.getRandomValues(iv);
        } else if (typeof require === 'function') {
            require('crypto').randomFillSync(iv);
        }

        const enc = new TextEncoder();
        const encrypted = await subtle.encrypt(
            { name: "AES-GCM", iv },
            key,
            enc.encode(clean)
        );

        let ivBinary = '';
        for (let i = 0; i < iv.length; i++) ivBinary += String.fromCharCode(iv[i]);
        const b64Iv = btoa(ivBinary);

        const cipherBytes = new Uint8Array(encrypted);
        let cipherBinary = '';
        for (let i = 0; i < cipherBytes.length; i++) cipherBinary += String.fromCharCode(cipherBytes[i]);
        const b64Cipher = btoa(cipherBinary);

        return `enc:v1:${b64Iv}:${b64Cipher}`;
    }

    async decryptSensitive(ciphertext) {
        if (!ciphertext || typeof ciphertext !== 'string' || !ciphertext.trim()) return '';
        const clean = ciphertext.trim();
        if (!clean.startsWith('enc:v1:')) return clean; // legacy plaintext fallback

        try {
            const parts = clean.split(':');
            if (parts.length < 4) return clean;
            const b64Iv = parts[2];
            const b64Cipher = parts[3];

            const ivStr = atob(b64Iv);
            const iv = new Uint8Array(ivStr.length);
            for (let i = 0; i < ivStr.length; i++) iv[i] = ivStr.charCodeAt(i);

            const cipherStr = atob(b64Cipher);
            const cipherBytes = new Uint8Array(cipherStr.length);
            for (let i = 0; i < cipherStr.length; i++) cipherBytes[i] = cipherStr.charCodeAt(i);

            const key = await this.getCryptoKey();
            const subtle = (typeof crypto !== 'undefined' && crypto.subtle)
                ? crypto.subtle
                : (typeof window !== 'undefined' && window.crypto ? window.crypto.subtle : null);

            const decrypted = await subtle.decrypt(
                { name: "AES-GCM", iv },
                key,
                cipherBytes.buffer
            );

            return new TextDecoder().decode(decrypted);
        } catch (e) {
            console.error("[FyersEngine] Decryption failed:", e);
            return '';
        }
    }

    async saveAccount({ appId, apiAccessToken, webuiRefreshToken, webuiAccessToken, pin = null, secretKey = null, redirectUri = null, id = null }) {
        const accounts = this.getAccounts();
        const isReplace = Boolean(id);
        const existing = isReplace ? accounts.find(a => a.id === id) : null;
        
        const check = this.validateTokens({
            appId,
            apiAccessToken,
            webuiRefreshToken,
            webuiAccessToken,
            pin: pin || '',
            secretKey: secretKey || '',
            redirectUri: redirectUri || '',
            isReplace,
            existingAccount: existing
        });
        
        if (!check.valid) {
            if (check.noChanges && existing) {
                return { success: true, account: existing, noChanges: true };
            }
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
                accountObj.apiAccessToken = await this.encryptSensitive(cleanApi);
                accountObj.apiExpiresAt = check.apiExpiresAt;
            }
            if (webuiRefreshToken && webuiRefreshToken.trim()) {
                accountObj.webuiRefreshToken = await this.encryptSensitive(webuiRefreshToken.trim());
                accountObj.refreshExpiresAt = check.refreshExpiresAt;
            }
            if (webuiAccessToken && webuiAccessToken.trim()) {
                accountObj.webuiAccessToken = await this.encryptSensitive(webuiAccessToken.trim());
                accountObj.webuiExpiresAt = check.webuiExpiresAt;
            }
            if (pin !== null && pin !== undefined && pin.trim() !== '') {
                accountObj.pin = await this.encryptSensitive(pin.trim());
            }
            if (secretKey !== null && secretKey !== undefined && secretKey.trim() !== '') {
                accountObj.secretKey = await this.encryptSensitive(secretKey.trim());
            }
            if (redirectUri !== null && redirectUri !== undefined && redirectUri.trim() !== '') {
                accountObj.redirectUri = redirectUri.trim();
            }
            accountObj.updatedAt = Date.now();
        } else {
            let cleanApi = (apiAccessToken || '').trim();
            if (cleanApi.includes(':') && cleanApi.split(':').length === 2 && cleanApi.includes('.')) {
                cleanApi = cleanApi.split(':')[1];
            }
            const encApi = cleanApi ? await this.encryptSensitive(cleanApi) : '';
            const encRefresh = webuiRefreshToken ? await this.encryptSensitive(webuiRefreshToken.trim()) : '';
            const encWebui = webuiAccessToken ? await this.encryptSensitive(webuiAccessToken.trim()) : '';
            const encPin = pin ? await this.encryptSensitive(pin.trim()) : '';
            const encSecret = secretKey ? await this.encryptSensitive(secretKey.trim()) : '';
            accountObj = {
                id: 'acc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                broker: 'fyers',
                appId: appId.trim(),
                fyId: check.fyId,
                displayName: check.displayName,
                initials: check.initials,
                apiAccessToken: encApi,
                webuiRefreshToken: encRefresh,
                webuiAccessToken: encWebui,
                pin: encPin,
                secretKey: encSecret,
                redirectUri: (redirectUri || 'https://trade.fyers.in/api-login/redirect-uri/index.html').trim(),
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
            await this.setActiveAccount(accountObj.id);
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

    // ==========================================
    // CLOSED-SOURCE PRIVATE ENGINE & AUTO-REFRESH
    // ==========================================

    getEngineConfig() {
        try {
            const raw = localStorage.getItem('tv_broker_engine_config');
            if (raw) {
                const parsed = JSON.parse(raw);
                return {
                    repo: parsed.repo || 'bunqi8/broker-private',
                    filePath: parsed.filePath || 'fyers_auth.js',
                    githubPat: parsed.githubPat || '',
                    autoRefresh: parsed.autoRefresh !== false,
                    leadTimeMinutes: Number(parsed.leadTimeMinutes) || 10
                };
            }
        } catch (_) {}
        return {
            repo: 'bunqi8/broker-private',
            filePath: 'fyers_auth.js',
            githubPat: '',
            autoRefresh: true,
            leadTimeMinutes: 10
        };
    }

    saveEngineConfig({ repo, filePath, githubPat, autoRefresh, leadTimeMinutes }) {
        const current = this.getEngineConfig();
        const updated = {
            repo: (repo !== undefined && repo !== null && repo.trim()) ? repo.trim() : current.repo,
            filePath: (filePath !== undefined && filePath !== null && filePath.trim()) ? filePath.trim() : current.filePath,
            // Strict write-only: if user leaves PAT blank, preserve existing saved PAT
            githubPat: (githubPat !== undefined && githubPat !== null && githubPat.trim() !== '') 
                ? githubPat.trim() 
                : current.githubPat,
            autoRefresh: autoRefresh !== undefined ? Boolean(autoRefresh) : current.autoRefresh,
            leadTimeMinutes: (leadTimeMinutes !== undefined && !isNaN(leadTimeMinutes)) 
                ? Math.max(1, Number(leadTimeMinutes)) 
                : current.leadTimeMinutes
        };
        localStorage.setItem('tv_broker_engine_config', JSON.stringify(updated));
        return updated;
    }

    parseRepo(repoStr) {
        if (!repoStr) return { owner: 'bunqi8', repo: 'broker-private' };
        let clean = repoStr.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').trim();
        clean = clean.replace(/^\/+|\/+$/g, '');
        const parts = clean.split('/');
        if (parts.length >= 2) {
            return { owner: parts[0], repo: parts[1] };
        }
        return { owner: 'bunqi8', repo: parts[0] || 'broker-private' };
    }

    hasCachedPrivateEngine() {
        if (window.FyersPrivateEngine && typeof window.FyersPrivateEngine.refreshToken === 'function') {
            return true;
        }
        try {
            const cfg = this.getEngineConfig();
            const { owner, repo } = this.parseRepo(cfg.repo);
            const filePath = cfg.filePath || 'fyers_auth.js';
            const cacheKey = `tv_private_script_${owner}_${repo}_${filePath}`;
            const cached = localStorage.getItem(cacheKey) || sessionStorage.getItem(cacheKey);
            return Boolean(cached && cached.trim().length > 50);
        } catch (_) {
            return false;
        }
    }

    getCachedEngineMeta() {
        try {
            const cfg = this.getEngineConfig();
            const { owner, repo } = this.parseRepo(cfg.repo);
            const filePath = cfg.filePath || 'fyers_auth.js';
            const metaKey = `tv_private_script_meta_${owner}_${repo}_${filePath}`;
            const raw = localStorage.getItem(metaKey);
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    clearCachedPrivateEngine() {
        try {
            const cfg = this.getEngineConfig();
            const { owner, repo } = this.parseRepo(cfg.repo);
            const filePath = cfg.filePath || 'fyers_auth.js';
            const cacheKey = `tv_private_script_${owner}_${repo}_${filePath}`;
            const metaKey = `tv_private_script_meta_${owner}_${repo}_${filePath}`;
            localStorage.removeItem(cacheKey);
            localStorage.removeItem(metaKey);
            sessionStorage.removeItem(cacheKey);
        } catch (_) {}
    }

    async loadPrivateEngine(forceReload = false) {
        // Fast path: if already in memory and reload not forced
        if (!forceReload && window.FyersPrivateEngine && typeof window.FyersPrivateEngine.refreshToken === 'function') {
            const meta = this.getCachedEngineMeta();
            return { 
                success: true, 
                engine: window.FyersPrivateEngine, 
                cached: true, 
                version: window.FyersPrivateEngine.version || (meta ? meta.version : '1.0.0'),
                meta 
            };
        }

        const cfg = this.getEngineConfig();
        const { owner, repo } = this.parseRepo(cfg.repo);
        const filePath = cfg.filePath || 'fyers_auth.js';
        const cacheKey = `tv_private_script_${owner}_${repo}_${filePath}`;
        const metaKey = `tv_private_script_meta_${owner}_${repo}_${filePath}`;

        // Step 1: If not forcing reload, try to load from persistent localStorage cache
        if (!forceReload) {
            try {
                const cachedScript = localStorage.getItem(cacheKey) || sessionStorage.getItem(cacheKey);
                if (cachedScript && cachedScript.trim().length > 50) {
                    (new Function(cachedScript))();
                    if (window.FyersPrivateEngine && typeof window.FyersPrivateEngine.refreshToken === 'function') {
                        const meta = this.getCachedEngineMeta();
                        const ver = window.FyersPrivateEngine.version || (meta ? meta.version : '1.0.0');
                        console.log(`[FyersEngine] Loaded private engine from persistent cache (v${ver}).`);
                        return { 
                            success: true, 
                            engine: window.FyersPrivateEngine, 
                            cached: true, 
                            version: ver,
                            meta 
                        };
                    }
                }
            } catch (e) {
                console.warn("[FyersEngine] Cached private engine execution error:", e);
            }
        }

        // Helper to attempt running the cached script if network / PAT fails
        const tryRunCachedFallback = (reason) => {
            try {
                const cachedScript = localStorage.getItem(cacheKey) || sessionStorage.getItem(cacheKey);
                if (cachedScript && cachedScript.trim().length > 50) {
                    (new Function(cachedScript))();
                    if (window.FyersPrivateEngine && typeof window.FyersPrivateEngine.refreshToken === 'function') {
                        const meta = this.getCachedEngineMeta();
                        const ver = window.FyersPrivateEngine.version || (meta ? meta.version : '1.0.0');
                        console.warn(`[FyersEngine] ${reason}. Successfully fell back to cached engine (v${ver}).`);
                        return {
                            success: true,
                            engine: window.FyersPrivateEngine,
                            cached: true,
                            version: ver,
                            meta,
                            warning: `${reason}. Continuing seamlessly with last cached engine (v${ver}).`
                        };
                    }
                }
            } catch (fallbackErr) {
                console.error("[FyersEngine] Fallback execution failed:", fallbackErr);
            }
            return null;
        };

        // Step 2: If no PAT configured, check if we can fall back to cache
        if (!cfg.githubPat || !cfg.githubPat.trim()) {
            const fallback = tryRunCachedFallback("No GitHub PAT configured");
            if (fallback) return fallback;

            return { 
                success: false, 
                error: "GitHub Personal Access Token (PAT) is required to download the private engine for the first time." 
            };
        }

        // Step 3: Fetch fresh version from GitHub API using PAT
        const rawUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
        try {
            const res = await fetch(rawUrl, {
                headers: {
                    'Authorization': `Bearer ${cfg.githubPat.trim()}`,
                    'Accept': 'application/vnd.github.v3.raw',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });

            if (!res.ok) {
                // If authentication fails (HTTP 401 or 403 - PAT expired or revoked), fall back to cached version!
                if (res.status === 401 || res.status === 403) {
                    const fallback = tryRunCachedFallback(`GitHub PAT expired or invalid (HTTP ${res.status})`);
                    if (fallback) {
                        fallback.patExpired = true;
                        return fallback;
                    }
                    return { 
                        success: false, 
                        patExpired: true,
                        error: `GitHub Authentication Failed (HTTP ${res.status}). Your PAT may be expired or lack "repo" (contents:read) scope.` 
                    };
                }

                if (res.status === 404) {
                    const fallback = tryRunCachedFallback(`File "${filePath}" not found in repo "${owner}/${repo}"`);
                    if (fallback) return fallback;
                    return { 
                        success: false, 
                        error: `File "${filePath}" not found in private repo "${owner}/${repo}". Check repository name and file path.` 
                    };
                }

                const fallback = tryRunCachedFallback(`GitHub API error HTTP ${res.status}`);
                if (fallback) return fallback;

                return { 
                    success: false, 
                    error: `GitHub API error: HTTP ${res.status} (${res.statusText || 'Request failed'})` 
                };
            }

            const scriptText = await res.text();
            if (!scriptText || !scriptText.trim()) {
                const fallback = tryRunCachedFallback("Empty script received from GitHub");
                if (fallback) return fallback;
                return { success: false, error: "Private engine script fetched from repository is empty." };
            }

            // Execute in browser global context
            (new Function(scriptText))();

            if (!window.FyersPrivateEngine || typeof window.FyersPrivateEngine.refreshToken !== 'function') {
                const fallback = tryRunCachedFallback("Script did not implement required engine contract");
                if (fallback) return fallback;
                return { 
                    success: false, 
                    error: "Script loaded, but window.FyersPrivateEngine.refreshToken() is not defined. Verify your script implements the required contract." 
                };
            }

            // Cache permanently in localStorage so it survives tab closures & PAT expiration
            const ver = window.FyersPrivateEngine.version || '1.0.0';
            const meta = {
                version: ver,
                timestamp: Date.now(),
                repo: `${owner}/${repo}`,
                filePath: filePath,
                size: scriptText.length
            };

            try {
                localStorage.setItem(cacheKey, scriptText);
                localStorage.setItem(metaKey, JSON.stringify(meta));
                sessionStorage.setItem(cacheKey, scriptText);
                this.engineLastLoaded = Date.now();
                console.log(`[FyersEngine] Successfully fetched and cached private engine v${ver} from GitHub.`);
            } catch (storageErr) {
                console.warn("[FyersEngine] Failed to write script to localStorage:", storageErr);
            }

            return { 
                success: true, 
                engine: window.FyersPrivateEngine, 
                version: ver,
                fresh: true,
                meta
            };
        } catch (err) {
            // Network failure / offline: fall back to cached version!
            const fallback = tryRunCachedFallback(`Network connection error (${err.message})`);
            if (fallback) return fallback;

            return { success: false, error: `Network error connecting to GitHub: ${err.message}` };
        }
    }

    async refreshAccountToken(accountId = null, isManual = false) {
        if (this._isRefreshing) {
            const msg = "Token refresh already in progress...";
            if (isManual) this.showToast(msg, 'warning');
            return { success: false, error: msg };
        }
        this._isRefreshing = true;

        try {
            const accounts = this.getAccounts();
            const targetId = accountId || this.getActiveAccountId();
            const account = accounts.find(a => a.id === targetId);

            if (!account) {
                const err = "Broker account not found.";
                if (isManual) this.showToast(err, 'error');
                return { success: false, error: err };
            }

            if (!account.webuiRefreshToken) {
                const err = `Account "${account.displayName}" has no WebUI Refresh Token. Refresh token is required to generate new access tokens.`;
                if (isManual) this.showToast(err, 'warning');
                return { success: false, error: err };
            }

            if (this.isRefreshExpired(account)) {
                const err = `WebUI Refresh Token for "${account.displayName}" has expired. Please replace it with a fresh refresh token.`;
                this.showToast(err, 'error');
                return { success: false, error: err };
            }

            // Load or fetch private engine
            const engineRes = await this.loadPrivateEngine(false);
            if (!engineRes.success) {
                const err = `Cannot refresh token: ${engineRes.error}`;
                if (isManual) this.showToast(err, 'error');
                return { success: false, error: err };
            }

            const engine = window.FyersPrivateEngine;
            if (!engine || typeof engine.refreshToken !== 'function') {
                const err = "Private engine refreshToken() method is not defined.";
                if (isManual) this.showToast(err, 'error');
                return { success: false, error: err };
            }

            if (isManual) {
                this.showToast(`Requesting fresh access token for ${account.displayName}...`, 'info', 2000);
            }

            // Decrypt ALL credentials and tokens in memory before passing to engine
            const rawRefresh = (account.webuiRefreshToken && account.webuiRefreshToken.startsWith('enc:v1:'))
                ? await this.decryptSensitive(account.webuiRefreshToken)
                : (account.webuiRefreshToken || '');
            const rawApi = (account.apiAccessToken && account.apiAccessToken.startsWith('enc:v1:'))
                ? await this.decryptSensitive(account.apiAccessToken)
                : (account.apiAccessToken || '');
            const rawWebui = (account.webuiAccessToken && account.webuiAccessToken.startsWith('enc:v1:'))
                ? await this.decryptSensitive(account.webuiAccessToken)
                : (account.webuiAccessToken || '');
            const rawPin = (account.pin && account.pin.startsWith('enc:v1:'))
                ? await this.decryptSensitive(account.pin)
                : (account.pin || '');
            const rawSecret = (account.secretKey && account.secretKey.startsWith('enc:v1:'))
                ? await this.decryptSensitive(account.secretKey)
                : (account.secretKey || '');

            // Call proprietary refreshToken logic
            const res = await engine.refreshToken({
                appId: account.appId,
                webuiRefreshToken: rawRefresh,
                apiAccessToken: rawApi,
                webuiAccessToken: rawWebui,
                pin: rawPin,
                secretKey: rawSecret,
                redirectUri: account.redirectUri || 'https://trade.fyers.in/api-login/redirect-uri/index.html'
            });

            if (!res || !res.success || !res.apiAccessToken) {
                const err = (res && res.error) ? res.error : "Private engine failed to generate fresh token.";
                this.showToast(`Token refresh failed: ${err}`, 'error');
                return { success: false, error: err };
            }

            // Clean token if prefixed with app_id
            let cleanApi = res.apiAccessToken.trim();
            if (cleanApi.includes(':') && cleanApi.split(':').length === 2 && cleanApi.includes('.')) {
                cleanApi = cleanApi.split(':')[1];
            }

            const info = this.extractTokenInfo(cleanApi);
            if (info && info.fyId && account.fyId && info.fyId !== account.fyId) {
                const err = `Refreshed token User ID ("${info.fyId}") does not match account User ID ("${account.fyId}").`;
                this.showToast(err, 'error');
                return { success: false, error: err };
            }

            // 1. Update API Access Token (Encrypted)
            account.apiAccessToken = await this.encryptSensitive(cleanApi);
            if (info && info.exp) {
                account.apiExpiresAt = info.exp;
            }

            // 2. Update WebUI Refresh Token (Encrypted)
            if (res.webuiRefreshToken) {
                const cleanRefresh = res.webuiRefreshToken.trim().replace(/^\./, '');
                account.webuiRefreshToken = await this.encryptSensitive(cleanRefresh);
                const refInfo = this.extractTokenInfo(cleanRefresh);
                if (refInfo && refInfo.exp) account.refreshExpiresAt = refInfo.exp;
            }

            // 3. Update WebUI Access Token (Encrypted) - generated during step 1 of refresh
            if (res.webuiAccessToken) {
                const cleanWebui = res.webuiAccessToken.trim().replace(/^\./, '');
                account.webuiAccessToken = await this.encryptSensitive(cleanWebui);
                const webInfo = this.extractTokenInfo(cleanWebui);
                if (webInfo && webInfo.exp) account.webuiExpiresAt = webInfo.exp;
            }

            account.updatedAt = Date.now();
            this.saveAccounts(accounts);

            // Re-activate active account with newly decrypted access token
            const activeId = this.getActiveAccountId();
            if (activeId === account.id || accounts.length === 1) {
                await this.setActiveAccount(account.id);
            }

            const expStr = this.formatExpiry(account.apiExpiresAt);
            this.showToast(`⚡ Access token refreshed for ${account.displayName} (${account.fyId})! Valid ${expStr}.`, 'success', 5000);

            window.dispatchEvent(new CustomEvent('fyers_token_refreshed', { detail: { account } }));
            return { success: true, account };
        } catch (e) {
            console.error("[FyersEngine] Token refresh exception:", e);
            const err = `Token refresh error: ${e.message || e}`;
            this.showToast(err, 'error');
            return { success: false, error: err };
        } finally {
            this._isRefreshing = false;
        }
    }

    async createE2EESession(options = { enableWebhook: true, autoDeleteWebhook: false }) {
        let engineRes = await this.loadPrivateEngine(false);
        if (!engineRes.success) {
            throw new Error(engineRes.error || "GitHub PAT required to load private broker engine.");
        }
        if (!window.FyersPrivateEngine || typeof window.FyersPrivateEngine.createE2EESession !== 'function' || (window.FyersPrivateEngine.version && window.FyersPrivateEngine.version < '1.4.3')) {
            console.log("[FyersAPI] Updating private engine to latest v1.4.3...");
            const reloadRes = await this.loadPrivateEngine(true);
            if (reloadRes.success) {
                engineRes = reloadRes;
            }
        }
        if (!window.FyersPrivateEngine || typeof window.FyersPrivateEngine.createE2EESession !== 'function') {
            throw new Error("Private broker engine does not implement createE2EESession(). Please verify your private repository.");
        }
        const receiver = await window.FyersPrivateEngine.createE2EESession(options);
        // Safety guard: guarantee active ephemeral bridge if older cached engine didn't set webhookUrl
        const existingUrl = (receiver && typeof receiver.getWebhookUrl === 'function') ? receiver.getWebhookUrl() : (receiver ? receiver.webhookUrl : null);
        if (receiver && !existingUrl) {
            const randomPart = (typeof crypto !== "undefined" && crypto.randomUUID)
                ? crypto.randomUUID().replace(/-/g, "")
                : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
            receiver.channelId = `tv_${randomPart}`;
            receiver.webhookUuid = receiver.channelId;
            receiver.webhookUrl = `https://ntfy.sh/${receiver.channelId}`;
            receiver.inspectorUrl = `https://ntfy.sh/${receiver.channelId}`;
        }
        return receiver;
    }

    async generateTokensDirect({ appId, webuiRefreshToken, webuiAccessToken, pin, secretKey, redirectUri }) {
        const engineRes = await this.loadPrivateEngine(false);
        if (!engineRes.success) {
            return { success: false, error: engineRes.error };
        }
        const engine = window.FyersPrivateEngine;
        if (!engine || typeof engine.refreshToken !== 'function') {
            return { success: false, error: "Private engine refreshToken() is not available." };
        }
        return await engine.refreshToken({
            appId,
            webuiRefreshToken,
            webuiAccessToken,
            pin,
            secretKey,
            redirectUri: redirectUri || "https://trade.fyers.in/api-login/redirect-uri/index.html"
        });
    }

    setupAutoRefreshScheduler() {
        if (this._schedulerInterval) clearInterval(this._schedulerInterval);
        
        // Periodic check every 60 seconds
        this._schedulerInterval = setInterval(() => {
            this.checkAndAutoRenewTokens();
        }, 60000);

        // Initial check after 4 seconds
        setTimeout(() => {
            this.checkAndAutoRenewTokens();
        }, 4000);
    }

    async checkAndAutoRenewTokens() {
        const cfg = this.getEngineConfig();
        if (!cfg.autoRefresh) return;
        if (!cfg.githubPat && !this.hasCachedPrivateEngine()) return;

        const active = this.getActiveAccount();
        if (!active || !active.webuiRefreshToken) return;
        if (this.isRefreshExpired(active)) return;

        if (active.apiExpiresAt) {
            const nowSec = Math.floor(Date.now() / 1000);
            const remainingSec = active.apiExpiresAt - nowSec;
            const leadSec = (cfg.leadTimeMinutes || 10) * 60;

            if (remainingSec <= leadSec) {
                console.log(`[FyersEngine] Active token expires in ${Math.round(remainingSec / 60)}m (<= ${cfg.leadTimeMinutes}m threshold). Running auto-refresh...`);
                await this.refreshAccountToken(active.id, false);
            }
        }
    }

    showToast(message, type = 'info', durationMs = 4500) {
        if (typeof document === 'undefined') return;
        let toastContainer = document.getElementById('tv-toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'tv-toast-container';
            toastContainer.style.cssText = `
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 999999;
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-width: 420px;
                pointer-events: none;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            `;
            document.body.appendChild(toastContainer);
        }

        const toast = document.createElement('div');
        toast.style.cssText = `
            pointer-events: auto;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 13px;
            line-height: 1.4;
            color: #ffffff;
            box-shadow: 0 8px 24px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            gap: 10px;
            opacity: 0;
            transform: translateY(12px);
            transition: opacity 0.25s ease, transform 0.25s ease;
        `;

        let bg = '#1e222d';
        let icon = 'ℹ️';
        if (type === 'success') {
            bg = '#089981';
            icon = '✓';
        } else if (type === 'error') {
            bg = '#f23645';
            icon = '⚠️';
        } else if (type === 'warning') {
            bg = '#ff9800';
            icon = '⚡';
        }

        toast.style.background = bg;
        toast.innerHTML = `<span style="font-weight: bold; font-size: 15px;">${icon}</span><span style="flex:1;">${message}</span>`;
        toastContainer.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(12px)';
            setTimeout(() => toast.remove(), 300);
        }, durationMs);
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
            } else if (data.code === -300 || (data.message && data.message.toLowerCase().includes('token')) || res.status === 401) {
                // Attempt automatic reactive refresh if account has refresh token
                const active = this.getActiveAccount();
                if (active && active.webuiRefreshToken && !this.isRefreshExpired(active)) {
                    console.log("[FyersEngine] Token expired during getHistory, attempting reactive refresh...");
                    const refreshed = await this.refreshAccountToken(active.id, false);
                    if (refreshed.success) {
                        try {
                            const retryRes = await fetch(url, { headers: { 'Authorization': this.token } });
                            const retryData = await retryRes.json();
                            if (retryData.s === 'ok' && retryData.candles) {
                                const bars = retryData.candles.map(c => ({
                                    time: c[0] * 1000,
                                    open: c[1],
                                    high: c[2],
                                    low: c[3],
                                    close: c[4],
                                    volume: c[5]
                                }));
                                const tx = db.transaction('history', 'readwrite');
                                tx.objectStore('history').put({ cacheKey, data: bars, timestamp: Date.now() });
                                return bars;
                            }
                        } catch (_) {}
                    }
                }
                // Token expired
                this.markActiveAccountExpired('Token Expired');
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
                        if (data.code === -300 || (data.message && data.message.toLowerCase().includes('token')) || res.status === 401) {
                            const active = this.getActiveAccount();
                            if (active && active.webuiRefreshToken && !this.isRefreshExpired(active)) {
                                console.log("[FyersEngine] Token expired during getDeepHistory, attempting reactive refresh...");
                                const refreshed = await this.refreshAccountToken(active.id, false);
                                if (refreshed.success) {
                                    try {
                                        const retryRes = await fetch(url, { headers: { 'Authorization': this.token } });
                                        const retryData = await retryRes.json();
                                        if (retryData.s === 'ok' && retryData.candles) {
                                            fetchedBars = retryData.candles.map(c => ({
                                                id: `${symbol_res}_${c[0] * 1000}`,
                                                symbol_res: symbol_res,
                                                time: c[0] * 1000,
                                                open: c[1],
                                                high: c[2],
                                                low: c[3],
                                                close: c[4],
                                                volume: c[5]
                                            }));
                                        }
                                    } catch (_) {}
                                }
                            }
                            if (fetchedBars.length === 0) {
                                this.markActiveAccountExpired('Token Expired');
                            }
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
                        
                        if ((data.s === 'error' && (data.code === -15 || (data.message && data.message.toLowerCase().includes('token')))) || res.status === 401) {
                            console.error("Fyers Auth Error:", data.message);
                            const active = this.getActiveAccount();
                            if (active && active.webuiRefreshToken && !this.isRefreshExpired(active)) {
                                console.log("[FyersEngine] Token expired during quotes polling, attempting reactive refresh...");
                                const refreshed = await this.refreshAccountToken(active.id, false);
                                if (refreshed.success) {
                                    return; // Will continue polling next cycle with updated token
                                }
                            }
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
