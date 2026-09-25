import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

old_wait = """        let conn;
        try {
            // Wait for Options Chain to populate files
            while (!window.ACTIVE_EXPIRY_FILES) {
                await new Promise(r => setTimeout(r, 100));
            }
            
            // 1. Resolve Parquet files dynamically based on requested time range and symbol type"""

new_wait = """        let conn;
        try {
            // Wait for the background sync manager to download the metadata for this symbol if it's missing
            let fileUrls = [];
            for (let i = 0; i < 50; i++) {
                fileUrls = await Datafeed.resolveParquetFiles(symbolInfo, resolution, from, to);
                if (fileUrls.length > 0) break;
                // If not found, wait and retry just in case the background queue is currently downloading it
                await new Promise(r => setTimeout(r, 200));
            }
            
            // 1. Resolve Parquet files dynamically based on requested time range and symbol type"""

js = js.replace(old_wait, new_wait)
js = js.replace('const fileUrls = await Datafeed.resolveParquetFiles(symbolInfo, resolution, from, to);', '')

with open('public/datafeed.js', 'w') as f:
    f.write(js)

