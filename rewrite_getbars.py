import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

helper_func = """    resolveParquetFiles: async (symbolInfo, resolution, qFrom, qTo) => {
        const fileSuffix = resolutionToSuffix(resolution);
        let allFiles = [];
        
        try {
            const expiries = await window.SyncManager.getAllExpiries();
            for (let exp of expiries) {
                for (let f of exp.files) {
                    const filename = f.path.split('/').pop();
                    
                    const dateMatch = filename.match(/_(\\d{4}-\\d{2}-\\d{2})_to_(\\d{4}-\\d{2}-\\d{2})\\.parquet/);
                    if (!dateMatch) continue;
                    
                    if (!filename.includes(`_${fileSuffix}_`)) {
                        if (fileSuffix === 'D' && filename.includes(`_1D_`)) {} 
                        else if (fileSuffix === '1D' && filename.includes(`_D_`)) {}
                        else continue;
                    }
                    
                    const fStart = new Date(dateMatch[1]).getTime() / 1000;
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
                        if (!allFiles.find(x => x.path === f.path)) {
                            allFiles.push({ path: f.path, fStart, fEnd, priority, filename });
                        }
                    }
                }
            }
            
            // Files that intersect the requested range
            let intersecting = allFiles.filter(f => f.fEnd >= qFrom && f.fStart <= qTo);
            
            // If no intersection (e.g. asking for today, but latest data is 1 month ago),
            // find the newest files that are BEFORE qTo
            if (intersecting.length === 0) {
                let pastFiles = allFiles.filter(f => f.fStart <= qTo);
                if (pastFiles.length > 0) {
                    pastFiles.sort((a,b) => b.fEnd - a.fEnd); // Sort newest first
                    // Take the most recent block of files
                    const newestEnd = pastFiles[0].fEnd;
                    intersecting = pastFiles.filter(f => f.fEnd === newestEnd);
                }
            }
            
            intersecting.sort((a, b) => b.priority - a.priority || b.fEnd - a.fEnd);
            
            // Limit to top 4 files to prevent DuckDB OOM during UNION
            let selected = intersecting.slice(0, 4);
            
            // If we are looking for Futures, and the exact match didn't fill the quota,
            // we ALSO want to grab the next older future month so the user can scroll smoothly!
            // To do this, if we have less than 4 files, we can grab files that ended just before our selected files started.
            if (symbolInfo.type === 'futures' || symbolInfo.type === 'index') {
                if (selected.length > 0) {
                    let oldestStart = Math.min(...selected.map(f => f.fStart));
                    let olderFiles = allFiles.filter(f => f.fEnd <= oldestStart);
                    olderFiles.sort((a, b) => b.priority - a.priority || b.fEnd - a.fEnd);
                    for (let of of olderFiles) {
                        if (selected.length >= 4) break;
                        if (!selected.find(s => s.path === of.path)) {
                            selected.push(of);
                        }
                    }
                }
            }
            
            return selected.map(f => `https://huggingface.co/datasets/deep776/fyers-market-data/resolve/main/${f.path}`);
            
        } catch(e) {
            console.error("Resolve error", e);
            return [];
        }
    },
"""

js = js.replace("    getBars: async", helper_func + "\n    getBars: async")

# Now rewrite getBars body
old_getbars_body_start = r'            // 1. Determine which Parquet file to query.*?let vfsName = await ensureParquetLoaded\(fileUrl\);'

new_getbars_body_start = """            // 1. Resolve Parquet files dynamically based on requested time range and symbol type
            // This natively supports Index and Futures merging across rollover months!
            const fileUrls = await Datafeed.resolveParquetFiles(symbolInfo, resolution, from, to);
            
            if (fileUrls.length === 0) {
                DFLog.warn('getBars', `No Parquet files found for ${symbolInfo.name} in range`);
                return onHistoryCallback([], { noData: true });
            }

            // 2. Ensure Parquet files are downloaded & registered in DuckDB VFS
            let vfsNames = [];
            for (let url of fileUrls) {
                vfsNames.push(await window.ensureParquetLoaded(url));
            }
            
            // Build UNION query
            const unionStmts = vfsNames.map(vfs => `SELECT * FROM read_parquet('${vfs}')`).join(' UNION ');
"""

js = re.sub(old_getbars_body_start, lambda m: new_getbars_body_start, js, flags=re.DOTALL)


# Now fix SQL queries inside getBars to use the union alias
old_range_sql = r"""            const rangeSQL = `
                SELECT time \* 1000 AS time, open, high, low, close, volume
                FROM read_parquet\('\$\{vfsName\}'\)
                WHERE time >= \$\{from\} AND time < \$\{to\}
                ORDER BY time ASC
            `;"""
new_range_sql = """            const rangeSQL = `
                SELECT time * 1000 AS time, open, high, low, close, volume
                FROM (
                    ${unionStmts}
                )
                WHERE time >= ${from} AND time < ${to}
                ORDER BY time ASC
            `;"""
js = re.sub(old_range_sql, lambda m: new_range_sql, js, flags=re.DOTALL)

old_latest_sql = r"""                    const latestSQL = `
                        SELECT time \* 1000 AS time, open, high, low, close, volume
                        FROM read_parquet\('\$\{vfsName\}'\)
                        ORDER BY time DESC
                        LIMIT \$\{countBack\}
                    `;"""
new_latest_sql = """                    const latestSQL = `
                        SELECT time * 1000 AS time, open, high, low, close, volume
                        FROM (
                            ${unionStmts}
                        )
                        ORDER BY time DESC
                        LIMIT ${countBack}
                    `;"""
js = re.sub(old_latest_sql, lambda m: new_latest_sql, js, flags=re.DOTALL)

old_all_sql = r"""                    const allSQL = `
                        SELECT time \* 1000 AS time, open, high, low, close, volume
                        FROM read_parquet\('\$\{vfsName\}'\)
                    `;"""
new_all_sql = """                    const allSQL = `
                        SELECT time * 1000 AS time, open, high, low, close, volume
                        FROM (
                            ${unionStmts}
                        )
                    `;"""
js = re.sub(old_all_sql, lambda m: new_all_sql, js, flags=re.DOTALL)

old_older_sql = r"""                    const olderSQL = `
                        SELECT time \* 1000 AS time, open, high, low, close, volume
                        FROM read_parquet\('\$\{vfsName\}'\)
                        WHERE time < \$\{from\}
                        ORDER BY time DESC
                        LIMIT \$\{countBack\}
                    `;"""
new_older_sql = """                    const olderSQL = `
                        SELECT time * 1000 AS time, open, high, low, close, volume
                        FROM (
                            ${unionStmts}
                        )
                        WHERE time < ${from}
                        ORDER BY time DESC
                        LIMIT ${countBack}
                    `;"""
js = re.sub(old_older_sql, lambda m: new_older_sql, js, flags=re.DOTALL)

old_all_older_sql = r"""                    const allSQL = `
                        SELECT time \* 1000 AS time, open, high, low, close, volume
                        FROM read_parquet\('\$\{vfsName\}'\)
                        WHERE time < \$\{from\}
                    `;"""
new_all_older_sql = """                    const allSQL = `
                        SELECT time * 1000 AS time, open, high, low, close, volume
                        FROM (
                            ${unionStmts}
                        )
                        WHERE time < ${from}
                    `;"""
js = re.sub(old_all_older_sql, lambda m: new_all_older_sql, js, flags=re.DOTALL)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

