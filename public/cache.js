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

    async syncRoot() {
        try {
            console.log("[SyncManager] Fetching root HF directory...");
            const res = await fetch(ROOT_URL);
            const data = await res.json();
            
            // 1. Group by dateStr and find the latest timeStr
            const latestFolders = {};
            for (let item of data) {
                if (item.type === 'directory') {
                    const folderName = item.path.split('/').pop();
                    const match = folderName.match(/_(\d{8})_(\d{6})$/);
                    if (match) {
                        const dateStr = match[1];
                        const timeStr = match[2];
                        if (!latestFolders[dateStr] || timeStr > latestFolders[dateStr].timeStr) {
                            latestFolders[dateStr] = {
                                dateStr, timeStr, folderPath: item.path
                            };
                        }
                    }
                }
            }

            // 2. Compare against local cache
            const cachedExpiries = await this.getAllExpiries();
            const cacheMap = {};
            cachedExpiries.forEach(e => cacheMap[e.dateStr] = e);

            const fetchPromises = [];

            for (const dateStr in latestFolders) {
                const remote = latestFolders[dateStr];
                const local = cacheMap[dateStr];
                
                // If we don't have it, or the remote has a newer timestamp, we must fetch its files
                if (!local || remote.timeStr > local.timeStr) {
                    console.log(`[SyncManager] Syncing new/updated expiry: ${dateStr} (Time: ${remote.timeStr})`);
                    
                    const p = fetch(`https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/${remote.folderPath}`)
                        .then(r => r.json())
                        .then(files => {
                            // Extract metadata for the UI
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
                                dateObjValue: dateObj.getTime(), // IDB doesn't always sort Date objects easily, store timestamp
                                monthLabel: monthLabel,
                                day: day,
                                year: year
                            };
                            
                            return this.saveExpiry(expiryData);
                        })
                        .catch(err => console.error(`Failed to sync files for ${dateStr}`, err));
                        
                    fetchPromises.push(p);
                }
            }
            
            if (fetchPromises.length > 0) {
                await Promise.all(fetchPromises);
                console.log(`[SyncManager] Finished syncing ${fetchPromises.length} folders to IndexedDB.`);
            } else {
                console.log("[SyncManager] Cache is completely up to date!");
            }
            
        } catch (e) {
            console.error("[SyncManager] Root sync failed", e);
        }
    }
};

window.SyncManager = SyncManager;
