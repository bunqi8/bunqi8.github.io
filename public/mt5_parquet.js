// ============================================================================
// MT5 Hugging Face Parquet Archival & 0ms DuckDB Datafeed Engine
// Brings 0ms historical charts and 100% offline backfill to MetaTrader 5 brokers.
// Supports multi-username discovery across community & personal HF repositories.
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

    // Cleanse any stale 'deep776' Fyers author from MT5 storage (deep776 is reserved strictly for Fyers)
    try {
        if (localStorage.getItem('hf_author') === 'deep776') {
            localStorage.removeItem('hf_author');
        }
        const disc = localStorage.getItem('hf_discovery_authors');
        if (disc && disc.includes('deep776')) {
            const list = JSON.parse(disc).filter(x => x !== 'deep776');
            localStorage.setItem('hf_discovery_authors', JSON.stringify(list));
        }
    } catch (_) {}

    const MT5ParquetIndex = {
        author: (window.HF_AUTHOR && window.HF_AUTHOR !== 'deep776') || (function() {
            try {
                const stored = localStorage.getItem('hf_author');
                if (stored && stored !== 'deep776') return stored;
                return 'bnq-ii';
            } catch(_) { return 'bnq-ii'; }
        })(),

        bridgeStatus: {
            enabled: true,
            is_syncing: false,
            current_symbol: null,
            current_server: null,
            current_chunk: null,
            completed_chunks: 0,
            total_bytes_uploaded: 0,
            author: null,
            last_error: null,
            last_sync_time: null
        },

        lastFeedEvent: {
            source: 'none', // 'parquet' | 'live' | 'stitched'
            symbol: null,
            resolution: null,
            parquetBars: 0,
            liveBars: 0,
            totalBars: 0,
            timestamp: Date.now()
        },

        setAuthor(newAuthor) {
            if (newAuthor && typeof newAuthor === 'string') {
                const clean = newAuthor.trim();
                if (clean === 'deep776') return; // deep776 is reserved strictly for Fyers
                this.author = clean;
                try { localStorage.setItem('hf_author', this.author); } catch(_) {}
                console.log(`[MT5Parquet] Primary author namespace updated to: ${this.author}`);
            }
        },

        getDiscoveryAuthors() {
            try {
                const raw = localStorage.getItem('hf_discovery_authors');
                if (raw) {
                    const list = JSON.parse(raw);
                    if (Array.isArray(list)) return list.filter(a => a && a !== 'deep776');
                }
            } catch (_) {}
            return [];
        },

        addDiscoveryAuthor(author) {
            const clean = String(author || '').trim();
            if (!clean || clean === 'deep776') return false;
            const list = this.getDiscoveryAuthors();
            if (!list.includes(clean) && clean !== this.author) {
                list.push(clean);
                try { localStorage.setItem('hf_discovery_authors', JSON.stringify(list)); } catch(_) {}
                console.log(`[MT5Parquet] Added discovery author: ${clean}`);
                return true;
            }
            return false;
        },

        removeDiscoveryAuthor(author) {
            const clean = String(author || '').trim();
            let list = this.getDiscoveryAuthors();
            list = list.filter(a => a !== clean);
            try { localStorage.setItem('hf_discovery_authors', JSON.stringify(list)); } catch(_) {}
            console.log(`[MT5Parquet] Removed discovery author: ${clean}`);
        },

        getAllAuthors() {
            const primary = (this.author && this.author !== 'deep776') ? this.author : 'bnq-ii';
            const extra = this.getDiscoveryAuthors().filter(a => a && a !== 'deep776');
            const set = new Set([primary, ...extra]);
            return Array.from(set);
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

            const repoName = this.getRepoName(server, symbol);
            const authors = this.getAllAuthors();

            // Multi-Namespace Search: Check primary author first, then discovery authors
            for (const author of authors) {
                if (!author || author === 'deep776') continue;
                const manifestUrl = `https://huggingface.co/datasets/${author}/${repoName}/raw/main/manifest.json`;
                try {
                    const res = await fetch(manifestUrl, { cache: 'no-cache' });
                    if (res.ok) {
                        const manifest = await res.json();
                        manifest._author = author;
                        manifestCache.set(repoKey, { manifest, fetchedAt: Date.now() });
                        console.log(`[MT5Parquet] ✓ Loaded manifest from ${author}/${repoName}: ${Object.keys(manifest['1m'] || {}).length} 1m months, ${Object.keys(manifest['1D'] || {}).length} 1D decades`);
                        return manifest;
                    }
                } catch (err) {
                    console.debug(`[MT5Parquet] ${author}/${repoName} manifest probe note:`, err.message);
                }
            }

            return null;
        },

        recordComboOpened(server, symbol) {
            try {
                const cleanServer = sanitizeHfName(server || 'FundedNext-Server3');
                const cleanSym = sanitizeHfName(String(symbol || '').split(':').pop());
                const key = `${cleanServer}_${cleanSym}`;
                const raw = localStorage.getItem('mt5_combo_last_opened') || '{}';
                const map = JSON.parse(raw);
                map[key] = Date.now();
                localStorage.setItem('mt5_combo_last_opened', JSON.stringify(map));
            } catch (_) {}
        },

        async resolveParquetFiles(server, symbol, resolution, fromSec, toSec) {
            this.recordComboOpened(server, symbol);
            const manifest = await this.getManifest(server, symbol);
            if (!manifest) return null;

            const isDwm = isDailyOrHigher(resolution);
            const author = manifest._author || ((this.author && this.author !== 'deep776') ? this.author : 'bnq-ii');
            const repoName = this.getRepoName(server, symbol);

            // Read explicit broker inception timestamp from manifest
            const inceptionSec = manifest.inception_time || (manifest.inception_date ? Math.floor(new Date(manifest.inception_date).getTime() / 1000) : 0);
            if (inceptionSec > 0 && toSec < inceptionSec) {
                // Requested range is strictly before broker inception - no data exists
                return {
                    urls: [],
                    isDwm,
                    earliestSec: inceptionSec,
                    latestSec: 0,
                    manifest,
                    author,
                    beforeInception: true
                };
            }

            const urls = [];
            let earliestSec = inceptionSec > 0 ? inceptionSec : Infinity;
            let latestSec = 0;

            if (isDwm && manifest['1D']) {
                for (const [decadeKey, chunk] of Object.entries(manifest['1D'])) {
                    if (!chunk || !chunk.file || !chunk.bars || chunk.bars <= 0) continue;
                    const cFrom = chunk.from || 0;
                    const cTo = chunk.to || Infinity;
                    earliestSec = Math.min(earliestSec, cFrom);
                    latestSec = Math.max(latestSec, cTo);

                    if (cTo >= fromSec && cFrom <= toSec) {
                        urls.push(`https://huggingface.co/datasets/${author}/${repoName}/resolve/main/${chunk.file}`);
                    }
                }
            } else if (!isDwm && manifest['1m']) {
                for (const [monthKey, chunk] of Object.entries(manifest['1m'])) {
                    if (!chunk || !chunk.file || !chunk.bars || chunk.bars <= 0) continue;
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
                manifest,
                author
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
                console.log(`[MT5Parquet] ⚡ DuckDB query executed in ${elapsed}ms: ${finalBars.length} ${resolution} bars for ${symbol} (Author: ${resolved.author})`);

                return {
                    bars: finalBars,
                    earliestSec: resolved.earliestSec,
                    latestSec: resolved.latestSec,
                    author: resolved.author,
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
        },

        async pollBridgeStatus() {
            try {
                if (!window.MT5API) return this.bridgeStatus;
                const ep = window.MT5API.getActiveEndpoint();
                if (!ep || !ep.url) return this.bridgeStatus;

                const headers = (typeof window.MT5API.getReqHeaders === 'function')
                    ? window.MT5API.getReqHeaders(ep)
                    : { 'X-Bridge-Key': ep.apiKey || '', 'X-Shield-Token': ep.shieldToken || '' };

                const res = await fetch(`${ep.url}/api/hf/status`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.status) {
                        this.bridgeStatus = { ...this.bridgeStatus, ...data.status };
                        if (data.author) {
                            this.setAuthor(data.author);
                        }
                    }
                }
            } catch (_) {}
            return this.bridgeStatus;
        },

        recordFeedEvent(event) {
            this.lastFeedEvent = { ...this.lastFeedEvent, ...event, timestamp: Date.now() };
            window.dispatchEvent(new CustomEvent('mt5_feed_event', { detail: this.lastFeedEvent }));
        }
    };

    window.MT5ParquetIndex = MT5ParquetIndex;
    console.log("[MT5Parquet] MT5 Parquet & DuckDB offline engine initialized with multi-namespace discovery.");
})();
