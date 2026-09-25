import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

# We will inject a helper function `resolveParquetFiles(symbolInfo, resolution, queryStart, queryEnd)`
helper_func = """
    // --- Added for Infinite Scroll and Data Merging ---
    resolveParquetFiles: async (symbolInfo, resolution, qFrom, qTo) => {
        const fileSuffix = resolutionToSuffix(resolution);
        let allFiles = [];
        
        try {
            const expiries = await window.SyncManager.getAllExpiries();
            for (let exp of expiries) {
                for (let f of exp.files) {
                    const filename = f.path.split('/').pop();
                    
                    const dateMatch = filename.match(/_(\\d{4}-\\d{2}-\\d{2})_to_(\\d{4}-\\d{2}-\\d{2})\\.parquet/);
                    if (!dateMatch) continue;
                    
                    // Match resolution
                    if (!filename.includes(`_${fileSuffix}_`)) {
                        if (fileSuffix === 'D' && filename.includes(`_1D_`)) {} 
                        else if (fileSuffix === '1D' && filename.includes(`_D_`)) {}
                        else continue;
                    }
                    
                    const fStart = new Date(dateMatch[1]).getTime() / 1000;
                    // Add 24h to end date to make it inclusive of the last day
                    const fEnd = (new Date(dateMatch[2]).getTime() / 1000) + 86400;
                    
                    let isMatch = false;
                    let priority = 0;
                    
                    if (symbolInfo.type === 'futures') {
                        if (filename.startsWith(symbolInfo.name)) {
                            isMatch = true; priority = 10;
                        } else if (filename.includes('FUT_')) {
                            isMatch = true; priority = 1;
                        }
                    } else if (symbolInfo.type === 'index') {
                        if (filename.startsWith('NIFTY50-INDEX')) {
                            isMatch = true; priority = 10;
                        }
                    } else { // Option
                        if (filename.startsWith(symbolInfo.name)) {
                            isMatch = true; priority = 10;
                        }
                    }
                    
                    if (isMatch) {
                        // deduplicate by path
                        if (!allFiles.find(x => x.path === f.path)) {
                            allFiles.push({ path: f.path, fStart, fEnd, priority, filename });
                        }
                    }
                }
            }
            
            // Filter files that intersect the requested time range
            let intersecting = allFiles.filter(f => f.fEnd >= qFrom && f.fStart <= qTo);
            
            // Sort by priority (exact match first), then by newest data
            intersecting.sort((a, b) => b.priority - a.priority || b.fEnd - a.fEnd);
            
            // If it's a future and we are falling back to older months, we only want 1 or 2 files to prevent downloading 12 months at once.
            // Actually, DuckDB can handle a UNION of 2-3 files quickly.
            // We'll pick up to 3 files to satisfy the range.
            let selected = [];
            let currentPriority = -1;
            for (let f of intersecting) {
                if (selected.length >= 3) break;
                // For futures, don't mix different future months in the same exact time window if possible,
                // but since DuckDB will deduplicate/sort, it's safe to load overlapping futures.
                selected.push(f);
            }
            
            return selected.map(f => `https://huggingface.co/datasets/deep776/fyers-market-data/resolve/main/${f.path}`);
            
        } catch(e) {
            console.error("Resolve error", e);
            return [];
        }
    },
"""

# Replace the getBars body to use this.
