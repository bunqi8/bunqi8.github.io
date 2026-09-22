const DB_NAME = 'TradingViewCacheDB';
const DB_VERSION = 1;
const ROOT_URL = "https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/NSE_NIFTY50_INDEX/option_data/parquet";

const SyncManager = {
    db: null,

    init() {
        return new Promise((resolve, reject) => {
            if (this.db) return resolve(this.db);
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('expiries')) {
                    db.createObjectStore('expiries', { keyPath: 'dateStr' });
                }
            };
            req.onsuccess = (e) => {
                this.db = e.target.result;
                resolve(this.db);
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
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },

    async forceSyncExpiry(dateStr) {
        // Force-sync a single expiry immediately (used when user clicks a tab)
        const remote = this.latestFolders && this.latestFolders[dateStr];
        if (!remote) return false;
        
        const local = await this.getExpiry(dateStr);
        if (!local || remote.timeStr > local.timeStr) {
            console.log(`[SyncManager] Force syncing clicked expiry: ${dateStr}`);
            await this._fetchAndSaveExpiry(dateStr, remote);
            return true; // Indicates it was updated
        }
        return false;
    },
    
    async getExpiry(dateStr) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('expiries', 'readonly');
            const req = tx.objectStore('expiries').get(dateStr);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    
    async _fetchAndSaveExpiry(dateStr, remote) {
        try {
            const res = await fetch(`https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/${remote.folderPath}`);
            const files = await res.json();
            
            const year = parseInt(dateStr.slice(0,4), 10);
            const monthNum = parseInt(dateStr.slice(4,6), 10);
            const day = parseInt(dateStr.slice(6,8), 10);
            
            const dateObj = new Date(year, monthNum - 1, day);
            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            let monthLabel = monthNames[dateObj.getMonth()] || "Unk";
            
            const currentYear = new Date().getFullYear();
            if (year !== currentYear && year > 2000) {
                monthLabel += " '" + (year % 100).toString().padStart(2, '0');
            }
            
            const expiryData = {
                dateStr: dateStr,
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
            console.error(`Failed to fetch files for ${dateStr}`, e);
        }
    },

    async syncRoot() {
        try {
            console.log("[SyncManager] Fetching root HF directory...");
            const res = await fetch(ROOT_URL);
            const data = await res.json();
            
            this.latestFolders = {};
            for (let item of data) {
                if (item.type === 'directory') {
                    const folderName = item.path.split('/').pop();
                    const match = folderName.match(/_(\d{8})_(\d{6})$/);
                    if (match) {
                        const dateStr = match[1];
                        const timeStr = match[2];
                        if (!this.latestFolders[dateStr] || timeStr > this.latestFolders[dateStr].timeStr) {
                            this.latestFolders[dateStr] = {
                                dateStr, timeStr, folderPath: item.path
                            };
                        }
                    }
                }
            }

            const cachedExpiries = await this.getAllExpiries();
            const cacheMap = {};
            cachedExpiries.forEach(e => cacheMap[e.dateStr] = e);

            const outdated = [];
            for (const dateStr in this.latestFolders) {
                const remote = this.latestFolders[dateStr];
                const local = cacheMap[dateStr];
                if (!local || remote.timeStr > local.timeStr) {
                    outdated.push({dateStr, remote});
                }
            }
            
            if (outdated.length > 0) {
                console.log(`[SyncManager] Found ${outdated.length} outdated folders. Starting slow background sync...`);
                // Do NOT block UI. Slowly fetch one by one in the background.
                this._processQueue(outdated);
            } else {
                console.log("[SyncManager] Cache is completely up to date!");
            }
            
        } catch (e) {
            console.error("[SyncManager] Root sync failed", e);
        }
    },
    
    async _processQueue(outdatedQueue) {
        if (this._isProcessingQueue) return;
        this._isProcessingQueue = true;
        
        for (let task of outdatedQueue) {
            // Check if it was already force-synced by the user clicking a tab
            const local = await this.getExpiry(task.dateStr);
            if (!local || task.remote.timeStr > local.timeStr) {
                await this._fetchAndSaveExpiry(task.dateStr, task.remote);
                // Sleep for 500ms to avoid slamming Hugging Face API
                await new Promise(r => setTimeout(r, 500));
            }
        }
        
        this._isProcessingQueue = false;
        console.log("[SyncManager] Background slow sync complete.");
    }
};

window.SyncManager = SyncManager;
