import re

with open('public/cache.js', 'r') as f:
    js = f.read()

old_get = """    async getParquetFile(url) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('parquetFiles', 'readonly');
            const store = tx.objectStore('parquetFiles');
            const req = store.get(url);
            req.onsuccess = () => resolve(req.result ? req.result.buffer : null);
            req.onerror = () => reject(req.error);
        });
    },"""

new_get = """    async getParquetFile(url) {
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
    },"""

js = js.replace(old_get, new_get)

old_save = """    async saveParquetFile(url, buffer) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('parquetFiles', 'readwrite');
            const store = tx.objectStore('parquetFiles');
            const req = store.put({ url: url, buffer: buffer });"""

new_save = """    async saveParquetFile(url, buffer) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('parquetFiles', 'readwrite');
            const store = tx.objectStore('parquetFiles');
            const req = store.put({ url: url, buffer: buffer, lastAccessed: Date.now() });"""

js = js.replace(old_save, new_save)

gc_method = """    async garbageCollectCache() {
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
"""

js = js.replace('async getAllExpiries() {', gc_method + '\n    async getAllExpiries() {')

with open('public/cache.js', 'w') as f:
    f.write(js)

