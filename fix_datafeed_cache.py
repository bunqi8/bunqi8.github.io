import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

old_func = """async function ensureParquetLoaded(url) {
    if (parquetCache[url]) {
        DFLog.debug('cache', `HIT: ${url.split('/').pop()}`);
        return parquetCache[url].vfsName;
    }

    DFLog.info('cache', `MISS — downloading: ${url.split('/').pop()}`);
    const t0 = performance.now();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const dt = (performance.now() - t0).toFixed(0);
    DFLog.info('cache', `Downloaded ${(bytes.length / 1024).toFixed(1)} KB in ${dt}ms`);

    // Deterministic VFS filename from URL hash
    const vfsName = 'pq_' + simpleHash(url) + '.parquet';
    await window.db.registerFileBuffer(vfsName, bytes);
    parquetCache[url] = { vfsName, bytes };
    DFLog.info('cache', `Registered in DuckDB VFS as: ${vfsName}`);
    return vfsName;
}"""

new_func = """async function ensureParquetLoaded(url) {
    if (parquetCache[url]) {
        DFLog.debug('cache', `HIT (Memory): ${url.split('/').pop()}`);
        return parquetCache[url].vfsName;
    }

    const t0 = performance.now();
    let buffer = null;
    let isDiskHit = false;

    // Check IndexedDB first
    if (window.SyncManager) {
        buffer = await window.SyncManager.getParquetFile(url);
    }

    if (buffer) {
        isDiskHit = true;
        DFLog.info('cache', `HIT (IndexedDB): ${url.split('/').pop()} in ${(performance.now() - t0).toFixed(0)}ms`);
    } else {
        DFLog.info('cache', `MISS — downloading: ${url.split('/').pop()}`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        buffer = await response.arrayBuffer();
        
        // Save to IndexedDB asynchronously
        if (window.SyncManager) {
            window.SyncManager.saveParquetFile(url, buffer).catch(e => console.error("Failed to save parquet cache", e));
        }
    }

    const bytes = new Uint8Array(buffer);
    if (!isDiskHit) {
        const dt = (performance.now() - t0).toFixed(0);
        DFLog.info('cache', `Downloaded ${(bytes.length / 1024).toFixed(1)} KB in ${dt}ms`);
    }

    // Deterministic VFS filename from URL hash
    const vfsName = 'pq_' + simpleHash(url) + '.parquet';
    await window.db.registerFileBuffer(vfsName, bytes);
    parquetCache[url] = { vfsName, bytes };
    DFLog.info('cache', `Registered in DuckDB VFS as: ${vfsName}`);
    return vfsName;
}"""

js = js.replace(old_func, new_func)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

