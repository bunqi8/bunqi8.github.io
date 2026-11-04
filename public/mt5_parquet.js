// ============================================================================
// MT5 Hugging Face Parquet Archival & 0ms DuckDB Datafeed Engine
// Brings 0ms historical charts and 100% offline backfill to MetaTrader 5 brokers.
// ============================================================================

(function () {
    const manifestCache = new Map();

    function sanitizeHfName(name) {
        if (!name) return '';
        let clean = String(name).trim()
            .replace(/\s+/g, '-')
            .replace(/[\/:]/g, '-')
            .replace(/[^a-zA-Z0-9._-]/g, '')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        return clean;
    }

    function getResolutionMinutes(res) {
        const s = String(res || '1').toUpperCase().trim();
        if (s === 'D' || s === '1D') return 1440;
        if (s === 'W' || s === '1W') return 10080;
        if (s === 'M' || s === '1M') return 43200;
        const n = parseInt(s, 10);
        return isNaN(n) ? 1 : n;
    }

    function isDailyOrHigher(res) {
        const s = String(res || '').toUpperCase().trim();
        return s.includes('D') || s.includes('W') || s.includes('M');
    }

    const MT5ParquetIndex = {
        author: window.HF_AUTHOR || (function() {
            try { return localStorage.getItem('hf_author') || 'deep776'; } catch(_) { return 'deep776'; }
        })(),

        setAuthor(newAuthor) {
            if (newAuthor && typeof newAuthor === 'string') {
                this.author = newAuthor.trim();
                try { localStorage.setItem('hf_author', this.author); } catch(_) {}
                console.log(`[MT5Parquet] Author namespace updated to: ${this.author}`);
            }
        },

        getRepoName(server, symbol) {
            const cleanServer = sanitizeHfName(server || 'FundedNext-Server3');
            const cleanSym = sanitizeHfName(String(symbol || '').split(':').pop());
            return `MT5_${cleanServer}_${cleanSym}`;
        },

        async getManifest(server, symbol) {
            const cleanServer = sanitizeHfName(server || 'FundedNext-Server3');
            const cleanSym = sanitizeHfName(String(symbol || '').split(':').pop());
            const repoKey = `${cleanServer}_${cleanSym}`;

            const cached = manifestCache.get(repoKey);
            if (cached && (Date.now() - cached.fetchedAt) < 300000) { // 5-min cache
                return cached.manifest;
            }

            const author = this.author || 'deep776';
            const repoName = this.getRepoName(server, symbol);
            const manifestUrl = `https://huggingface.co/datasets/${author}/${repoName}/raw/main/manifest.json`;

            try {
                const res = await fetch(manifestUrl, { cache: 'no-cache' });
                if (res.ok) {
                    const manifest = await res.json();
                    manifestCache.set(repoKey, { manifest, fetchedAt: Date.now() });
                    console.log(`[MT5Parquet] ✓ Loaded manifest for ${repoName}: ${Object.keys(manifest['1m'] || {}).length} 1m months, ${Object.keys(manifest['1D'] || {}).length} 1D decades`);
                    return manifest;
                }
            } catch (err) {
                console.debug(`[MT5Parquet] Manifest not found for ${repoName}:`, err.message);
            }

            return null;
        },

        async resolveParquetFiles(server, symbol, resolution, fromSec, toSec) {
            const manifest = await this.getManifest(server, symbol);
            if (!manifest) return null;

            const isDwm = isDailyOrHigher(resolution);
            const author = this.author || 'deep776';
            const repoName = this.getRepoName(server, symbol);

            const urls = [];
            let earliestSec = Infinity;
            let latestSec = 0;

            if (isDwm && manifest['1D']) {
                for (const [decadeKey, chunk] of Object.entries(manifest['1D'])) {
                    const cFrom = chunk.from || 0;
                    const cTo = chunk.to || Infinity;
                    earliestSec = Math.min(earliestSec, cFrom);
                    latestSec = Math.max(latestSec, cTo);

                    // Check overlap with requested [fromSec, toSec]
                    if (cTo >= fromSec && cFrom <= toSec) {
                        urls.push(`https://huggingface.co/datasets/${author}/${repoName}/resolve/main/${chunk.file}`);
                    }
                }
            } else if (!isDwm && manifest['1m']) {
                for (const [monthKey, chunk] of Object.entries(manifest['1m'])) {
                    const cFrom = chunk.from || 0;
                    const cTo = chunk.to || Infinity;
                    earliestSec = Math.min(earliestSec, cFrom);
                    latestSec = Math.max(latestSec, cTo);

                    if (cTo >= fromSec && cFrom <= toSec) {
                        urls.push(`https://huggingface.co/datasets/${author}/${repoName}/resolve/main/${chunk.file}`);
                    }
                }
            }

            return {
                urls,
                isDwm,
                earliestSec: earliestSec === Infinity ? 0 : earliestSec,
                latestSec,
                manifest
            };
        },

        async queryBars(server, symbol, resolution, fromSec, toSec, countBack = 500, firstDataRequest = false) {
            if (!window.db || typeof window.ensureParquetLoaded !== 'function') {
                return null;
            }

            const resolved = await this.resolveParquetFiles(server, symbol, resolution, fromSec, toSec);
            if (!resolved || !resolved.urls || resolved.urls.length === 0) {
                return null;
            }

            const t0 = performance.now();
            const vfsNames = [];
            for (const url of resolved.urls) {
                try {
                    const vfs = await window.ensureParquetLoaded(url);
                    if (vfs) vfsNames.push(vfs);
                } catch (e) {
                    console.warn(`[MT5Parquet] Could not load Parquet chunk ${url}:`, e);
                }
            }

            if (vfsNames.length === 0) return null;

            let conn = null;
            try {
                conn = await window.db.connect();
                const unionStmts = vfsNames.map(v => `SELECT * FROM read_parquet('${v}')`).join(' UNION ALL ');

                // Query bars strictly prior to toSec
                const fetchLimit = firstDataRequest ? Math.max(countBack * 10, 5000) : Math.max(countBack * 3, 2000);
                const sql = `
                    SELECT time, open, high, low, close, volume
                    FROM (${unionStmts})
                    WHERE time < ${toSec}
                    ORDER BY time DESC
                    LIMIT ${fetchLimit}
                `;

                const result = await conn.query(sql);
                await conn.close();
                conn = null;

                const rawRows = [];
                for (const row of result) {
                    rawRows.push({
                        time: Number(row.time),
                        open: Number(row.open),
                        high: Number(row.high),
                        low: Number(row.low),
                        close: Number(row.close),
                        volume: Number(row.volume || 1.0)
                    });
                }

                // Reverse back to ascending order
                rawRows.sort((a, b) => a.time - b.time);

                // Deduplicate by timestamp
                const dedup = [];
                let lastTime = -1;
                for (const r of rawRows) {
                    if (r.time !== lastTime) {
                        dedup.push(r);
                        lastTime = r.time;
                    }
                }

                let finalBars = [];
                const resMinutes = getResolutionMinutes(resolution);

                if (resolved.isDwm) {
                    // DWM files store daily bars: time is midnight UTC
                    finalBars = dedup.map(b => {
                        const d = new Date(b.time * 1000);
                        d.setUTCHours(0, 0, 0, 0);
                        return {
                            time: d.getTime(),
                            open: b.open,
                            high: b.high,
                            low: b.low,
                            close: b.close,
                            volume: b.volume
                        };
                    });
                } else if (resMinutes === 1) {
                    // Exact 1m bars: time is true UTC
                    finalBars = dedup.map(b => ({
                        time: b.time * 1000,
                        open: b.open,
                        high: b.high,
                        low: b.low,
                        close: b.close,
                        volume: b.volume
                    }));
                } else {
                    // Synthesize higher intraday resolution (e.g. 5m, 15m, 1h, 4h)
                    finalBars = this.aggregateIntradayBars(dedup, resMinutes);
                }

                const elapsed = (performance.now() - t0).toFixed(1);
                console.log(`[MT5Parquet] ⚡ DuckDB query executed in ${elapsed}ms: ${finalBars.length} ${resolution} bars for ${symbol}`);

                return {
                    bars: finalBars,
                    earliestSec: resolved.earliestSec,
                    latestSec: resolved.latestSec,
                    fromParquet: true
                };
            } catch (err) {
                console.error("[MT5Parquet] DuckDB query error:", err);
                if (conn) {
                    try { await conn.close(); } catch(_) {}
                }
                return null;
            }
        },

        aggregateIntradayBars(oneMinBars, resMinutes) {
            const intervalSec = resMinutes * 60;
            const grouped = new Map();

            for (const b of oneMinBars) {
                const bucketSec = Math.floor(b.time / intervalSec) * intervalSec;
                const bucketMs = bucketSec * 1000;

                const cur = grouped.get(bucketMs);
                if (!cur) {
                    grouped.set(bucketMs, {
                        time: bucketMs,
                        open: b.open,
                        high: b.high,
                        low: b.low,
                        close: b.close,
                        volume: b.volume
                    });
                } else {
                    cur.high = Math.max(cur.high, b.high);
                    cur.low = Math.min(cur.low, b.low);
                    cur.close = b.close;
                    cur.volume += b.volume;
                }
            }

            return Array.from(grouped.values()).sort((a, b) => a.time - b.time);
        },

        mergeBars(historicalBars, liveBars) {
            if (!historicalBars || historicalBars.length === 0) return liveBars || [];
            if (!liveBars || liveBars.length === 0) return historicalBars || [];

            const map = new Map();
            for (const b of historicalBars) {
                map.set(b.time, b);
            }
            // Overwrite with live bars
            for (const b of liveBars) {
                map.set(b.time, b);
            }

            return Array.from(map.values()).sort((a, b) => a.time - b.time);
        }
    };

    window.MT5ParquetIndex = MT5ParquetIndex;
    console.log("[MT5Parquet] MT5 Parquet & DuckDB offline engine initialized.");
})();
