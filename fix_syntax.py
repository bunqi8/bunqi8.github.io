import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

# Fix the broken try block in resolveParquetFiles
old_broken = """    resolveParquetFiles: async (symbolInfo, resolution, qFrom, qTo) => {
        const fileSuffix = resolutionToSuffix(resolution);
        let allFiles = [];
        
            for (let exp of expiries) {"""

new_fixed = """    resolveParquetFiles: async (symbolInfo, resolution, qFrom, qTo) => {
        const fileSuffix = resolutionToSuffix(resolution);
        let allFiles = [];
        try {
            const expiries = await window.SyncManager.getAllExpiries();
            for (let exp of expiries) {"""

js = js.replace(old_broken, new_fixed)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

