import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

old_save = """        // Save to IndexedDB asynchronously
        if (window.SyncManager) {
            window.SyncManager.saveParquetFile(url, buffer).catch(e => console.error("Failed to save parquet cache", e));
        }"""

new_save = """        // Save to IndexedDB asynchronously
        if (window.SyncManager) {
            // We MUST create a copy using slice(0) because DuckDB's registerFileBuffer 
            // will detach the original ArrayBuffer by transferring it to WASM memory.
            window.SyncManager.saveParquetFile(url, buffer.slice(0)).catch(e => console.error("Failed to save parquet cache", e));
        }"""

js = js.replace(old_save, new_save)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

