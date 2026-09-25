import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

old_polling = """            // Wait for the background sync manager to download the metadata for this symbol if it's missing
            let fileUrls = [];
            for (let i = 0; i < 50; i++) {
                fileUrls = await Datafeed.resolveParquetFiles(symbolInfo, resolution, from, to);
                if (fileUrls.length > 0) break;
                // If not found, wait and retry just in case the background queue is currently downloading it
                await new Promise(r => setTimeout(r, 200));
            }"""

new_polling = """            // Wait for the background sync manager to download the metadata for this symbol if it's missing
            let fileUrls = [];
            let maxTries = firstDataRequest ? 50 : 1; // Only poll on initial load to avoid hanging when paging backward into empty history
            for (let i = 0; i < maxTries; i++) {
                fileUrls = await Datafeed.resolveParquetFiles(symbolInfo, resolution, from, to);
                if (fileUrls.length > 0) break;
                // If not found, wait and retry just in case the background queue is currently downloading it
                if (i < maxTries - 1) await new Promise(r => setTimeout(r, 200));
            }"""

js = js.replace(old_polling, new_polling)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

