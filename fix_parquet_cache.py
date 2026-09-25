import re

with open('public/cache.js', 'r') as f:
    js = f.read()

js = js.replace('const DB_VERSION = 3;', 'const DB_VERSION = 4;')

old_upgrade = """            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (e.oldVersion < 3 && db.objectStoreNames.contains('expiries')) {
                    db.deleteObjectStore('expiries');
                }
                if (!db.objectStoreNames.contains('expiries')) {
                    db.createObjectStore('expiries', { keyPath: 'id' });
                }
            };"""

new_upgrade = """            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (e.oldVersion < 3 && db.objectStoreNames.contains('expiries')) {
                    db.deleteObjectStore('expiries');
                }
                if (!db.objectStoreNames.contains('expiries')) {
                    db.createObjectStore('expiries', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('parquetFiles')) {
                    db.createObjectStore('parquetFiles', { keyPath: 'url' });
                }
            };"""

js = js.replace(old_upgrade, new_upgrade)

new_methods = """
    async getParquetFile(url) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('parquetFiles', 'readonly');
            const store = tx.objectStore('parquetFiles');
            const req = store.get(url);
            req.onsuccess = () => resolve(req.result ? req.result.buffer : null);
            req.onerror = () => reject(req.error);
        });
    },

    async saveParquetFile(url, buffer) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('parquetFiles', 'readwrite');
            const store = tx.objectStore('parquetFiles');
            const req = store.put({ url: url, buffer: buffer });
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },
"""

js = js.replace('async getAllExpiries() {', new_methods + '\n    async getAllExpiries() {')

with open('public/cache.js', 'w') as f:
    f.write(js)

