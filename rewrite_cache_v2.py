import re

with open('public/cache.js', 'r') as f:
    js = f.read()

# DB version and URL
js = js.replace("const DB_VERSION = 1;", "const DB_VERSION = 2;")
js = js.replace("const ROOT_URL = \"https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/NSE_NIFTY50_INDEX/option_data/parquet\";", "const ROOT_URL = \"https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main\";")

# init DB logic
old_init = """            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('expiries')) {
                    db.createObjectStore('expiries', { keyPath: 'dateStr' });
                }
            };"""
new_init = """            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (e.oldVersion < 2 && db.objectStoreNames.contains('expiries')) {
                    db.deleteObjectStore('expiries');
                }
                if (!db.objectStoreNames.contains('expiries')) {
                    db.createObjectStore('expiries', { keyPath: 'id' });
                }
            };"""
js = js.replace(old_init, new_init)

# The core methods
new_methods = """    async forceSyncExpiry(id) {
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
            const res = await fetch(`https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/${remote.folderPath}`);
            const files = await res.json();
            
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
            
            for (let baseTicker of baseTickers) {
                try {
                    const exRes = await fetch(`${ROOT_URL}/${baseTicker}/option_data/parquet`);
                    if (!exRes.ok) continue;
                    const exData = await exRes.json();
                    
                    for (let item of exData) {
                        if (item.type === 'directory') {
                            const folderName = item.path.split('/').pop();
                            const match = folderName.match(/_(\\d{8})_(\\d{6})$/);
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
            }

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
                console.log(`[SyncManager] Found ${outdated.length} outdated folders. Starting slow background sync...`);
                this._processQueue(outdated);
            } else {
                console.log("[SyncManager] Cache is completely up to date!");
            }
            
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
    }"""

js = re.sub(r'    async forceSyncExpiry.*?console\.log\("\[SyncManager\] Background slow sync complete\."\);\n    \}', lambda m: new_methods, js, flags=re.DOTALL)

with open('public/cache.js', 'w') as f:
    f.write(js)

