const DB_NAME = 'TradingViewCacheDB';
const DB_VERSION = 7;
const ROOT_URL = "https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main";

const SyncManager = {
    db: null,

    init() {
        return new Promise((resolve, reject) => {
            if (this.db) return resolve(this.db);
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                // Wipe all stores on any version upgrade to ensure clean state
                if (db.objectStoreNames.contains('expiries')) {
                    db.deleteObjectStore('expiries');
                }
                if (db.objectStoreNames.contains('parquetFiles')) {
                    db.deleteObjectStore('parquetFiles');
                }
                if (db.objectStoreNames.contains('csvExpiries')) {
                    db.deleteObjectStore('csvExpiries');
                }
                db.createObjectStore('expiries', { keyPath: 'id' });
                db.createObjectStore('parquetFiles', { keyPath: 'url' });
                db.createObjectStore('csvExpiries', { keyPath: 'baseTicker' });
            };
            req.onsuccess = (e) => {
                this.db = e.target.result;
                resolve(this.db);
            };
            req.onerror = () => reject(req.error);
        });
    },

    async getCsvExpiries(baseTicker) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('csvExpiries', 'readonly');
            const req = tx.objectStore('csvExpiries').get(baseTicker);
            req.onsuccess = () => resolve(req.result ? req.result.data : null);
            req.onerror = () => reject(req.error);
        });
    },
    
    async getAllCsvExpiries() {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('csvExpiries', 'readonly');
            const req = tx.objectStore('csvExpiries').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    },

    async saveCsvExpiries(baseTicker, data) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('csvExpiries', 'readwrite');
            const store = tx.objectStore('csvExpiries');
            const req = store.put({ baseTicker, data, lastUpdated: Date.now() });
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },
    
    async syncCsvExpiries(baseTickers) {
        for (const bt of baseTickers) {
            try {
                const url = `https://huggingface.co/datasets/deep776/fyers-market-data/resolve/main/${bt}/${bt}_expiries.csv`;
                const res = await fetch(url);
                if (!res.ok) continue;
                const text = await res.text();
                const lines = text.trim().split('\n').slice(1);
                const csvExpiries = [];
                for (const line of lines) {
                    const parts = line.split(',');
                    if (parts.length < 2) continue;
                    const dateStrRaw = parts[0];
                    const ts = parts[1];
                    if (!dateStrRaw || !ts) continue;
                    const dParts = dateStrRaw.split('-');
                    if (dParts.length === 3) {
                        const yyyymmdd = `${dParts[2]}${dParts[1]}${dParts[0]}`;
                        const dateObjValue = parseInt(ts) * 1000;
                        const mStr = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][parseInt(dParts[1])-1];
                        const year = parseInt(dParts[2], 10);
                        let monthLabel = mStr;
                        const currentYear = new Date().getFullYear();
                        if (year !== currentYear && year > 2000) {
                            monthLabel += " '" + (year % 100).toString().padStart(2, '0');
                        }
                        csvExpiries.push({
                            id: `dummy_${bt}_${yyyymmdd}`,
                            baseTicker: bt,
                            dateStr: yyyymmdd,
                            dateObjValue: dateObjValue,
                            day: dParts[0],
                            monthLabel: monthLabel,
                            isDummy: true,
                            expiryCode: parts[4] ? parts[4].trim() : ''
                        });
                    }
                }
                csvExpiries.sort((a,b) => a.dateObjValue - b.dateObjValue);
                await this.saveCsvExpiries(bt, csvExpiries);
                window.dispatchEvent(new CustomEvent('hf_csv_updated', { detail: bt }));
            } catch(e) {}
        }
    },

    
    async getParquetFile(url) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('parquetFiles', 'readwrite');
            const store = tx.objectStore('parquetFiles');
            const req = store.get(url);
            req.onsuccess = () => {
                if (req.result) {
                    req.result.lastAccessed = Date.now();
                    store.put(req.result);
                    resolve(req.result.buffer);
                } else {
                    resolve(null);
                }
            };
            req.onerror = () => reject(req.error);
        });
    },

    async saveParquetFile(url, buffer) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('parquetFiles', 'readwrite');
            const store = tx.objectStore('parquetFiles');
            const req = store.put({ url: url, buffer: buffer, lastAccessed: Date.now() });
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },

        async garbageCollectCache() {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('parquetFiles', 'readwrite');
            const store = tx.objectStore('parquetFiles');
            const req = store.openCursor();
            
            const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
            const now = Date.now();
            let deletedCount = 0;
            
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const lastAccessed = cursor.value.lastAccessed || 0; 
                    if (now - lastAccessed > SEVEN_DAYS_MS) {
                        cursor.delete();
                        deletedCount++;
                    }
                    cursor.continue();
                } else {
                    if (deletedCount > 0) {
                        console.log(`[SyncManager] Garbage collected ${deletedCount} unused Parquet files older than 7 days.`);
                    }
                    resolve();
                }
            };
            req.onerror = () => reject(req.error);
        });
    },

    async getAllExpiries() {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('expiries', 'readonly');
            const store = tx.objectStore('expiries');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    },

    async saveExpiry(expiryData) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('expiries', 'readwrite');
            const store = tx.objectStore('expiries');
            const req = store.put(expiryData); // put will insert or overwrite based on dateStr key
            req.onsuccess = () => {
                window.dispatchEvent(new CustomEvent('hf_expiry_updated', { detail: expiryData.id }));
                resolve();
            };
            req.onerror = () => reject(req.error);
        });
    },

    async forceSyncExpiry(id) {
        const remote = this.latestFolders && this.latestFolders[id];
        if (!remote) return false;
        
        const local = await this.getExpiry(id);
        if (!local || remote.timeStr > local.timeStr) {
            console.log(`[SyncManager] Force syncing clicked expiry: ${id}`);
            await this._fetchAndSaveExpiry(id, remote);
            return true;
        }
        return false;
    },
    
    async getExpiry(id) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('expiries', 'readonly');
            const req = tx.objectStore('expiries').get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    
    async _fetchAndSaveExpiry(id, remote) {
        try {
            let currentUrl = `https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/${remote.folderPath}`;
            let allFiles = [];
            while (currentUrl) {
                const res = await fetch(currentUrl);
                if (!res.ok) break;
                const chunk = await res.json();
                allFiles = allFiles.concat(chunk);
                
                const linkHeader = res.headers.get('link');
                if (linkHeader && linkHeader.includes('rel="next"')) {
                    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
                    if (match) {
                        currentUrl = match[1];
                    } else {
                        currentUrl = null;
                    }
                } else {
                    currentUrl = null;
                }
            }
            const files = allFiles;
            
            const year = parseInt(remote.dateStr.slice(0,4), 10);
            const monthNum = parseInt(remote.dateStr.slice(4,6), 10);
            const day = parseInt(remote.dateStr.slice(6,8), 10);
            
            const dateObj = new Date(year, monthNum - 1, day);
            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            let monthLabel = monthNames[dateObj.getMonth()] || "Unk";
            
            const currentYear = new Date().getFullYear();
            if (year !== currentYear && year > 2000) {
                monthLabel += " '" + (year % 100).toString().padStart(2, '0');
            }
            
            const expiryData = {
                id: id,
                baseTicker: remote.baseTicker,
                dateStr: remote.dateStr,
                timeStr: remote.timeStr,
                folderPath: remote.folderPath,
                files: files,
                dateObjValue: dateObj.getTime(),
                monthLabel: monthLabel,
                day: day,
                year: year
            };
            
            await this.saveExpiry(expiryData);
            return expiryData;
        } catch(e) {
            console.error(`Failed to fetch files for ${id}`, e);
        }
    },

    async syncRoot() {
        try {
            console.log("[SyncManager] Fetching root HF directory...");
            const res = await fetch(ROOT_URL);
            if (!res.ok) throw new Error("Fetch failed");
            const data = await res.json();
            
            this.latestFolders = {};
            const baseTickers = [];
            
            for (let item of data) {
                if (item.type === 'directory' && (item.path.startsWith('NSE_') || item.path.startsWith('BSE_') || item.path.startsWith('MCX_'))) {
                    baseTickers.push(item.path);
                }
            }
            
            // Kick off CSV sync in background for all base tickers
            this.syncCsvExpiries(baseTickers).catch(e => console.error("CSV sync failed", e));
            
            await Promise.all(baseTickers.map(async (baseTicker) => {
                try {
                    const exRes = await fetch(`${ROOT_URL}/${baseTicker}/option_data/parquet`);
                    if (!exRes.ok) return;
                    const exData = await exRes.json();
                    
                    for (let item of exData) {
                        if (item.type === 'directory') {
                            const folderName = item.path.split('/').pop();
                            const match = folderName.match(/_(\d{8})_(\d{6})$/);
                            if (match) {
                                const dateStr = match[1];
                                const timeStr = match[2];
                                const id = `${baseTicker}_${dateStr}`;
                                if (!this.latestFolders[id] || timeStr > this.latestFolders[id].timeStr) {
                                    this.latestFolders[id] = {
                                        id, baseTicker, dateStr, timeStr, folderPath: item.path
                                    };
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error("Failed to fetch expiries for", baseTicker, e);
                }
            }));

            const cachedExpiries = await this.getAllExpiries();
            const cacheMap = {};
            cachedExpiries.forEach(e => cacheMap[e.id] = e);

            const outdated = [];
            for (const id in this.latestFolders) {
                const remote = this.latestFolders[id];
                const local = cacheMap[id];
                if (!local || remote.timeStr > local.timeStr) {
                    outdated.push({id, remote});
                }
            }
            
            if (outdated.length > 0) {
                console.log(`[SyncManager] Found ${outdated.length} outdated folders. Starting prioritized sync...`);
                
                // Determine the active symbol to prioritize
                let activeBase = window.ACTIVE_BASE_TICKER;
                if (!activeBase) {
                    try {
                        // Check URL params for the requested symbol
                        const urlParams = new URLSearchParams(window.location.search);
                        let chartSym = urlParams.get('symbol') || 'NIFTY50-INDEX';
                        try { if (window.tvWidget) chartSym = window.tvWidget.activeChart().symbol(); } catch(e) {}
                        const possible = [...new Set(outdated.map(o => o.remote.baseTicker))];
                        activeBase = possible.find(p => p.includes(chartSym.split('-')[0]) || p.includes(chartSym.replace(/\d.*/, '')));
                        if (!activeBase) activeBase = possible.find(p => p.includes('NIFTY50'));
                    } catch(e) {}
                }
                
                // Split into active (must load now) vs background (load later)
                const activeEntries = outdated.filter(o => o.remote.baseTicker === activeBase);
                const backgroundEntries = outdated.filter(o => o.remote.baseTicker !== activeBase);
                
                // Phase 1: Synchronously download the active symbol's file lists (blocks syncRoot resolution)
                if (activeEntries.length > 0) {
                    console.log(`[SyncManager] Phase 1: Downloading ${activeEntries.length} entries for active symbol ${activeBase}...`);
                    // Sort by newest first within the active symbol
                    activeEntries.sort((a, b) => b.remote.dateStr.localeCompare(a.remote.dateStr));
                    for (const task of activeEntries) {
                        await this._fetchAndSaveExpiry(task.id, task.remote);
                    }
                    console.log(`[SyncManager] Phase 1 complete — chart data is ready!`);
                }
                
                // Phase 2: Download remaining symbols in the background (fire-and-forget)
                if (backgroundEntries.length > 0) {
                    backgroundEntries.sort((a, b) => b.remote.dateStr.localeCompare(a.remote.dateStr));
                    this._processQueue(backgroundEntries);
                }
            } else {
                console.log("[SyncManager] Cache is completely up to date!");
            }
            
            // Fire background garbage collection 10 seconds after sync finishes so it doesn't block the UI
            setTimeout(() => {
                this.garbageCollectCache().catch(e => console.error("GC failed", e));
            }, 10000);
            
        } catch (e) {
            console.error("[SyncManager] Root sync failed", e);
            const cachedExpiries = await this.getAllExpiries();
            if (cachedExpiries.length === 0) {
                alert("Network Error: Could not connect to HuggingFace dataset (Proxy/Connection failed). The chart cannot load without data.");
            }
        }
    },
    
    async _processQueue(outdatedQueue) {
        if (this._isProcessingQueue) return;
        this._isProcessingQueue = true;
        
        for (let task of outdatedQueue) {
            const local = await this.getExpiry(task.id);
            if (!local || task.remote.timeStr > local.timeStr) {
                await this._fetchAndSaveExpiry(task.id, task.remote);
                await new Promise(r => setTimeout(r, 500));
            }
        }
        
        this._isProcessingQueue = false;
        console.log("[SyncManager] Background slow sync complete.");
    }
};

window.SyncManager = SyncManager;

// Start syncing immediately on page load — don't wait for Options Chain or TradingView
SyncManager._syncPromise = SyncManager.init().then(() => SyncManager.syncRoot());

// Poll every 60 seconds to detect new backend uploads (golden period rollover)
setInterval(() => {
    SyncManager.syncRoot();
}, 60000);

window.addEventListener('hf_csv_updated', () => {
    if (window.FyersAPI) window.FyersAPI.clearCache();
});
window.addEventListener('hf_expiry_updated', () => {
    if (window.FyersAPI) window.FyersAPI.clearCache();
});
