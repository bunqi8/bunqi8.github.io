// -----------------------------------------------------------------------
// Custom Datafeed Architecture
// DuckDB-WASM Parquet Datafeed with in-memory ArrayBuffer caching
// -----------------------------------------------------------------------

const configurationData = {
    supported_resolutions: [
        // Seconds
        '5S', '10S', '15S', '30S', '45S',
        // Minutes
        '1', '2', '3', '5', '10', '15', '30', '45',
        // Hours
        '60', '120', '180', '240',
        // Days, Weeks, Months
        '1D', '1W', '1M', '3M', '6M', '12M'
    ],
    supports_marks: false,
    supports_timescale_marks: false,
    supports_time: true,
    exchanges: [
        { value: '', name: 'All Exchanges', desc: 'All connected markets' },
        { value: 'MT5', name: 'MetaTrader 5', desc: 'MT5 Broker Fleet' },
        { value: 'NSE', name: 'NSE', desc: 'National Stock Exchange of India' },
        { value: 'BSE', name: 'BSE', desc: 'Bombay Stock Exchange' },
        { value: 'MCX', name: 'MCX', desc: 'Multi Commodity Exchange' }
    ],
    symbols_types: [
        { value: '', name: 'All' },
        { value: 'commodity', name: 'Commodities' },
        { value: 'forex', name: 'Forex' },
        { value: 'index', name: 'Indices' },
        { value: 'crypto', name: 'Crypto' },
        { value: 'stock', name: 'Stocks' },
        { value: 'futures', name: 'Futures' },
        { value: 'option', name: 'Options' }
    ]
};

// -----------------------------------------------------------------------
// Universal Market Schedule & Live Open/Close Status Engine
// Determines authoritative TradingView session specs and real-time open/closed state
// -----------------------------------------------------------------------
window.getMarketStatus = function(symbol) {
    const raw = (symbol || '').split(':').pop().toUpperCase().trim();
    const clean = raw.replace(/[^A-Z0-9_-]/g, '');

    // 1. Crypto CFD / Spot: 24/7 continuous trading
    if (clean.startsWith('BTC') || clean.startsWith('ETH') || clean.startsWith('SOL') || clean.includes('CRYPTO')) {
        return {
            isOpen: true,
            session: '24x7',
            timezone: 'Etc/UTC',
            market: 'CRYPTO',
            reason: '24/7 Crypto Market'
        };
    }

    // 2. Indian Equities & Indices (NSE / BSE: NIFTY, BANKNIFTY, SENSEX, etc.)
    const isIndianStock = clean.includes('NIFTY') || clean.includes('SENSEX') || 
                          clean.includes('BANKEX') || clean.includes('MIDCP') || 
                          clean.includes('FINNIFTY');
    if (isIndianStock) {
        const now = new Date();
        const istParts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Kolkata',
            hour12: false,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit'
        }).formatToParts(now);

        let weekday = '', hour = 0, minute = 0;
        istParts.forEach(p => {
            if (p.type === 'weekday') weekday = p.value;
            if (p.type === 'hour') hour = parseInt(p.value, 10);
            if (p.type === 'minute') minute = parseInt(p.value, 10);
        });

        // Weekend check
        if (weekday === 'Sat' || weekday === 'Sun') {
            return {
                isOpen: false,
                session: '0915-1530:23456',
                timezone: 'Asia/Kolkata',
                market: 'NSE/BSE',
                reason: 'Weekend Closed (Opens Monday 09:15 IST)'
            };
        }

        const curMins = hour * 60 + minute;
        const openMins = 9 * 60 + 15;   // 09:15 IST = 555
        const closeMins = 15 * 60 + 30; // 15:30 IST = 930

        if (curMins >= openMins && curMins < closeMins) {
            return {
                isOpen: true,
                session: '0915-1530:23456',
                timezone: 'Asia/Kolkata',
                market: 'NSE/BSE',
                reason: 'Trading Session Active (09:15 - 15:30 IST)'
            };
        } else if (curMins < openMins) {
            return {
                isOpen: false,
                session: '0915-1530:23456',
                timezone: 'Asia/Kolkata',
                market: 'NSE/BSE',
                reason: `Pre-Market (Opens at 09:15 IST)`
            };
        } else {
            return {
                isOpen: false,
                session: '0915-1530:23456',
                timezone: 'Asia/Kolkata',
                market: 'NSE/BSE',
                reason: 'Market Closed for Today (Closed at 15:30 IST)'
            };
        }
    }

    // 3. Indian Commodities (MCX: CRUDEOIL, GOLDM, SILVERM, NATURALGAS)
    const isMcx = clean.includes('MCX') || clean.includes('CRUDE') || 
                  clean.includes('GOLDM') || clean.includes('SILVERM') || 
                  clean.includes('NATURALGAS');
    if (isMcx) {
        const now = new Date();
        const istParts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Kolkata',
            hour12: false,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit'
        }).formatToParts(now);

        let weekday = '', hour = 0, minute = 0;
        istParts.forEach(p => {
            if (p.type === 'weekday') weekday = p.value;
            if (p.type === 'hour') hour = parseInt(p.value, 10);
            if (p.type === 'minute') minute = parseInt(p.value, 10);
        });

        if (weekday === 'Sat' || weekday === 'Sun') {
            return {
                isOpen: false,
                session: '0900-2330:23456',
                timezone: 'Asia/Kolkata',
                market: 'MCX',
                reason: 'MCX Weekend Closed'
            };
        }

        const curMins = hour * 60 + minute;
        const openMins = 9 * 60;        // 09:00 IST = 540
        const closeMins = 23 * 60 + 30; // 23:30 IST = 1410

        if (curMins >= openMins && curMins < closeMins) {
            return {
                isOpen: true,
                session: '0900-2330:23456',
                timezone: 'Asia/Kolkata',
                market: 'MCX',
                reason: 'MCX Live Session Active (09:00 - 23:30 IST)'
            };
        } else {
            return {
                isOpen: false,
                session: '0900-2330:23456',
                timezone: 'Asia/Kolkata',
                market: 'MCX',
                reason: 'MCX Market Closed'
            };
        }
    }

    // 4. Global Forex, Metals, and Indices (MT5 / International)
    // Evaluated in UTC
    const nowUtc = new Date();
    const dayUtc = nowUtc.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
    const curMinsUtc = nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes();

    const isMetal = clean.includes('XAU') || clean.includes('XAG') || clean.includes('OIL');
    const isIndex = clean.includes('30') || clean.includes('100') || clean.includes('500') || clean.includes('DE40') || clean.includes('UK100');

    // Detect broker context: The 5%ers vs MetaQuotes-Demo vs FundedNext / FTMO / Standard Prop Firms
    const acc = (window.MT5API && typeof window.MT5API.getActiveAccount === 'function') ? window.MT5API.getActiveAccount() : null;
    const serverStr = (acc && acc.server) ? acc.server : '';
    const brokerStr = (acc && acc.broker_name) ? acc.broker_name : '';
    const cleanBroker = (window.MT5API && typeof window.MT5API.getCleanBrokerExchange === 'function') ? window.MT5API.getCleanBrokerExchange(acc) : '';
    const is5ers = cleanBroker === 'THE 5%ERS' || serverStr.toLowerCase().includes('fivepercent');

    const defaultSession = isMetal 
        ? (is5ers ? '2205-2050:12345' : '2200-2100:12345') 
        : (isIndex ? '2300-2200:12345' : '2200-2200:12345');

    // Weekend Closure:
    // Closes Friday 22:00 UTC
    // Reopens Sunday (Forex: 22:00 UTC, Metals/Indices: 23:00 UTC)
    if (dayUtc === 6) { // Saturday
        return {
            isOpen: false,
            session: defaultSession,
            timezone: 'Etc/UTC',
            market: isMetal ? 'METALS' : (isIndex ? 'INDICES' : 'FOREX'),
            reason: 'Weekend Closed (Opens Sunday Evening UTC)'
        };
    }
    if (dayUtc === 5 && curMinsUtc >= 22 * 60) { // Friday after 22:00 UTC
        return {
            isOpen: false,
            session: defaultSession,
            timezone: 'Etc/UTC',
            market: isMetal ? 'METALS' : (isIndex ? 'INDICES' : 'FOREX'),
            reason: 'Weekend Closed (Closes Friday 22:00 UTC)'
        };
    }
    if (dayUtc === 0) { // Sunday
        const openSunMins = (isMetal || isIndex) ? (23 * 60) : (22 * 60);
        if (curMinsUtc < openSunMins) {
            return {
                isOpen: false,
                session: defaultSession,
                timezone: 'Etc/UTC',
                market: isMetal ? 'METALS' : (isIndex ? 'INDICES' : 'FOREX'),
                reason: `Weekend Closed (Opens Sunday ${Math.floor(openSunMins / 60)}:00 UTC)`
            };
        }
    }

    // Daily Rollover Maintenance Breaks (Mon - Thu):
    // Metals (Gold/Silver):
    if (isMetal) {
        if (is5ers) {
            // The 5%ers Gold (XAUUSD) closes at 23:50 server time (02:20 IST / 20:50 UTC) and reopens at 01:05 server time (03:35 IST / 22:05 UTC)
            if (curMinsUtc >= (20 * 60 + 50) && curMinsUtc < (22 * 60 + 5)) {
                return {
                    isOpen: false,
                    session: defaultSession,
                    timezone: 'Etc/UTC',
                    market: 'METALS',
                    reason: 'The 5%ers Daily Break (02:20 - 03:35 IST / Opens at 03:35 IST)'
                };
            }
        } else {
            // MetaQuotes-Demo, FundedNext, FTMO, and standard brokers: 02:30 AM to 03:30 AM IST (21:00 to 22:00 UTC)
            const brokerLabel = serverStr.toLowerCase().includes('metaquotes') ? 'MetaQuotes-Demo' : (cleanBroker || 'Broker');
            if (curMinsUtc >= (21 * 60) && curMinsUtc < (22 * 60)) {
                return {
                    isOpen: false,
                    session: defaultSession,
                    timezone: 'Etc/UTC',
                    market: 'METALS',
                    reason: `${brokerLabel} Daily Break (02:30 - 03:30 IST / Opens at 03:30 IST)`
                };
            }
        }
    }

    // Indices (US30, USTEC): Daily maintenance break 21:00 - 22:00 UTC
    if (isIndex && (curMinsUtc >= 21 * 60 && curMinsUtc < 22 * 60)) {
        return {
            isOpen: false,
            session: defaultSession,
            timezone: 'Etc/UTC',
            market: 'INDICES',
            reason: 'Daily Maintenance Break (21:00 - 22:00 UTC)'
        };
    }

    return {
        isOpen: true,
        session: defaultSession,
        timezone: 'Etc/UTC',
        market: isMetal ? 'METALS' : (isIndex ? 'INDICES' : 'FOREX'),
        reason: 'Market Open - Live Ticking'
    };
};

// -----------------------------------------------------------------------
// Structured Logger with color-coded output
// -----------------------------------------------------------------------
const DFLog = {
    _ts: () => new Date().toISOString().split('T')[1].slice(0, 12),
    info:  (tag, msg) => console.log(`%c[${DFLog._ts()}] [DF::${tag}]`, 'color:#2962FF;font-weight:bold', msg),
    warn:  (tag, msg) => console.warn(`%c[${DFLog._ts()}] [DF::${tag}]`, 'color:#FF9800;font-weight:bold', msg),
    error: (tag, msg, e) => console.error(`%c[${DFLog._ts()}] [DF::${tag}]`, 'color:#F44336;font-weight:bold', msg, e),
    debug: (tag, msg) => console.debug(`%c[${DFLog._ts()}] [DF::${tag}]`, 'color:#9E9E9E', msg),
};

// -----------------------------------------------------------------------
// In-memory Parquet file cache & DuckDB VFS registration
// Each URL is downloaded exactly ONCE, then all queries run locally.
// -----------------------------------------------------------------------
const parquetCache = {};

async function resolveParquetUrlWithFallback(url) {
    try {
        const m = url.match(/datasets\/deep776\/FYERS_([A-Z0-9_]+)\/resolve\/main\/([A-Z0-9_]+)\/option_data\/parquet\/([A-Z0-9_]+)\/([^/]+)$/);
        if (!m) return null;
        
        const baseTicker = m[1];
        const folder = m[3];
        const requestedFile = m[4];
        
        if (window.SyncManager) {
            const expiries = await window.SyncManager.getAllExpiries();
            let exp = expiries.find(e => e.folderPath === folder || (e.id && e.id.includes(folder)));
            if (!exp) {
                exp = { baseTicker, folderPath: folder, id: folder };
            }
            
            DFLog.warn('cache', `[404 Fallback] Requesting manual Tree API check (1000 files) for ${folder}...`);
            const realFiles = await window.SyncManager.ensureFilesLoaded(exp);
            
            if (realFiles && realFiles.length > 0) {
                const prefixMatch = requestedFile.match(/^([A-Z0-9\-]+_[A-Z0-9]+)_/);
                const prefix = prefixMatch ? prefixMatch[1] + '_' : requestedFile.split('_')[0];
                
                const matched = realFiles.find(f => {
                    const fn = f.path.split('/').pop();
                    return fn.startsWith(prefix);
                });
                
                if (matched) {
                    const realUrl = `https://huggingface.co/datasets/deep776/FYERS_${baseTicker}/resolve/main/${matched.path}`;
                    DFLog.info('cache', `[404 Fallback] Found confirmed real file in Tree API: ${matched.path}`);
                    return realUrl;
                } else {
                    DFLog.error('cache', `[404 Fallback] 100% Confirmation: File starting with "${prefix}" does NOT exist in ${folder}`);
                }
            }
        }
    } catch(e) {
        DFLog.error('cache', 'Error during fallback resolution', e);
    }
    return null;
}

async function ensureParquetLoaded(url) {
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
        let response = await fetch(url);
        
        // 404 Fallback: If dynamic URL was not found, manually check the Tree API for confirmed dates!
        if (!response.ok && response.status === 404) {
            DFLog.warn('cache', `404 for ${url}. Attempting Tree API search fallback...`);
            const fallbackUrl = await resolveParquetUrlWithFallback(url);
            if (fallbackUrl && fallbackUrl !== url) {
                url = fallbackUrl;
                response = await fetch(url);
            }
        }

        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        buffer = await response.arrayBuffer();
        
        // Save to IndexedDB asynchronously
        if (window.SyncManager) {
            // We MUST create a copy using slice(0) because DuckDB's registerFileBuffer 
            // will detach the original ArrayBuffer by transferring it to WASM memory.
            window.SyncManager.saveParquetFile(url, buffer.slice(0)).catch(e => console.error("Failed to save parquet cache", e));
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
}

window.ensureParquetLoaded = ensureParquetLoaded;

function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
}

// -----------------------------------------------------------------------
// Resolution → Parquet file suffix mapping
// -----------------------------------------------------------------------
function resolutionToSuffix(resolution) {
    // 1. If exact parquet is available, use it (5S, 1, 5, 60, D)
    if (['1', '5', '60', 'D', '5S'].includes(resolution)) return resolution;
    
    // 2. For seconds, use smallest second available (5S)
    if (resolution.includes('S')) return '5S';
    
    // 3. For daily and higher, use daily (D)
    if (resolution.includes('D') || resolution.includes('W') || resolution.includes('M')) return 'D';
    
    // 4. For minutes, use smallest minute available (1)
    return '1';
}

// -----------------------------------------------------------------------
// Convert DuckDB Arrow result rows to TradingView bar objects
// DuckDB-WASM returns Apache Arrow Tables. int64 columns come as BigInt.
// -----------------------------------------------------------------------

function alignFyersDwmTime(bars, resolution) {
    if (resolution && (resolution.includes('D') || resolution.includes('W') || resolution.includes('M'))) {
        const unique = new Map();
        bars.forEach(b => {
            const d = new Date(b.time);
            d.setUTCHours(0, 0, 0, 0);
            b.time = d.getTime();
            
            if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
                unique.set(b.time, b);
            }
        });
        return Array.from(unique.values()).sort((a,b) => a.time - b.time);
    }
    return bars;
}





function getBarLimitCacheKey(symbolInfo, resolution) {
    if (!symbolInfo) return '';
    const raw = symbolInfo.name || symbolInfo.ticker || '';
    const clean = raw.split(':').pop().toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Partition MT5 bar cache by broker exchange & account ID so account switches never serve stale broker bars
    const isMt5 = (symbolInfo.exchange && symbolInfo.exchange.includes('MT5')) ||
                  (symbolInfo.exchange && symbolInfo.exchange !== 'NSE' && symbolInfo.exchange !== 'BSE' && symbolInfo.exchange !== 'MCX') ||
                  (window.MT5API && window.MT5API.isMt5Symbol(clean));
    if (isMt5 && window.MT5API) {
        let acc = null;
        if (symbolInfo.exchange && symbolInfo.exchange !== 'MT5' && window.MT5API.accounts) {
            acc = window.MT5API.accounts.find(a => window.MT5API.getCleanBrokerExchange(a) === symbolInfo.exchange);
        }
        if (!acc) acc = window.MT5API.getActiveAccount();
        const accId = acc ? acc.id : 'default';
        return `MT5_${accId}_${clean}_${resolution}`;
    }

    return `${clean}_${resolution}`;
}

function safeHistoryCallback(bars, cb, resolution, symbolInfo = null) {
    let safeBars = bars;
    const resString = resolution ? resolution.toString() : 'undefined';
    const sfx = resolution ? resolutionToSuffix(resolution) : 'undefined';
    const isDWM = resolution && (resString.includes('D') || resString.includes('W') || resString.includes('M') || sfx === 'D');
    const isMcx = symbolInfo && (symbolInfo.exchange === 'MCX' || (symbolInfo.name && (symbolInfo.name.includes('CRUDE') || symbolInfo.name.includes('GOLD') || symbolInfo.name.includes('SILVER') || symbolInfo.name.includes('NATURALGAS'))));
    
    if (isDWM) {
        const unique = new Map();
        safeBars.forEach(b => {
            let tNum = Number(b.time);
            const d = new Date(tNum);
            d.setUTCHours(0, 0, 0, 0);
            b.time = d.getTime();
            
            // PREVENT TRADINGVIEW SNAP BUG
            if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
                unique.set(b.time, b);
            }
        });
        safeBars = Array.from(unique.values()).sort((a,b) => a.time - b.time);
        
        // Apply date range filter if configured in DatasetTimingManager
        if (window.DatasetTimingManager && typeof window.DatasetTimingManager.filterBars === 'function') {
            safeBars = window.DatasetTimingManager.filterBars(safeBars, resolution, symbolInfo, isMcx);
        }
    } else {
        // Intraday: filter via DatasetTimingManager (or fallback to strict RTH session)
        if (window.DatasetTimingManager && typeof window.DatasetTimingManager.filterBars === 'function') {
            safeBars = window.DatasetTimingManager.filterBars(safeBars, resolution, symbolInfo, isMcx);
        } else {
            const filtered = [];
            for (const b of safeBars) {
                let tNum = Number(b.time);
                b.time = tNum;
                const istDate = new Date(tNum + 19800000);
                const mins = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
                if (isMcx) {
                    if (mins < 540 || mins >= 1410) continue; // MCX: 09:00 - 23:30 IST
                } else {
                    if (mins < 555 || mins >= 930) continue;  // NSE/BSE: 09:15 - 15:30 IST (full market session)
                }
                filtered.push(b);
            }
            safeBars = filtered;
        }
    }
    
    const dedupedBars = [];
    let lastTime = -1;
    for (let b of safeBars) {
        if (b.time > lastTime) {
            dedupedBars.push(b);
            lastTime = b.time;
        }
    }
    
    if (dedupedBars.length === 0) {
        if (bars.length > 0) {
            cb([], { noData: true, nextTime: bars[0].time - 86400000 });
        } else {
            cb([], { noData: true });
        }
    } else {
        const lastBar = dedupedBars[dedupedBars.length - 1];
        if (lastBar && lastBar.close != null) {
            if (!window._tvLatestMarketPrice) window._tvLatestMarketPrice = {};
            const p = Number(lastBar.close);
            window._tvCurrentLastPrice = p;
            if (symbolInfo) {
                if (symbolInfo.name) {
                    window._tvLatestMarketPrice[symbolInfo.name.toUpperCase()] = p;
                    const cleanName = symbolInfo.name.replace(/^[A-Z0-9_-]+:/, '').toUpperCase();
                    window._tvLatestMarketPrice[cleanName] = p;
                }
                if (symbolInfo.ticker) {
                    window._tvLatestMarketPrice[symbolInfo.ticker.toUpperCase()] = p;
                }
            }
            if (window.TradeUIInstance && typeof window.TradeUIInstance.onLivePriceUpdate === 'function') {
                window.TradeUIInstance.onLivePriceUpdate(p, symbolInfo ? symbolInfo.name : null);
            }
        }
        let returnBars = dedupedBars;
        let hitLimit = false;

        if (window.BarLimitManager && symbolInfo) {
            const maxBarsLimit = window.BarLimitManager.getLimit();
            const genKey = getBarLimitCacheKey(symbolInfo, resolution);
            const currentLoaded = window.BarLimitManager.getBarCount(genKey);
            const remaining = maxBarsLimit - currentLoaded;

            if (remaining <= 0) {
                const oldestSec = returnBars.length > 0 ? Math.floor(returnBars[0].time / 1000) : null;
                window.BarLimitManager.onLimitBoundaryReached(genKey, oldestSec);
                cb([], { noData: true });
                return;
            }

            if (returnBars.length >= remaining) {
                returnBars = returnBars.slice(returnBars.length - remaining);
                window.BarLimitManager.setBarCount(genKey, maxBarsLimit);
                hitLimit = true;
            } else {
                window.BarLimitManager.incrementBarCount(genKey, returnBars.length);
            }

            // Sync with global _barsCache
            if (!window._barsCache) window._barsCache = {};
            const curCache = window._barsCache[genKey] || [];
            const bMap = new Map();
            for (const b of curCache) bMap.set(b.time, b);
            for (const b of returnBars) bMap.set(b.time, b);
            window._barsCache[genKey] = Array.from(bMap.values()).sort((a, b) => a.time - b.time);

            if (returnBars.length > 0) {
                const oldestSec = Math.floor(returnBars[0].time / 1000);
                window.BarLimitManager.setOldestBar(genKey, oldestSec);
            }

            if (hitLimit) {
                const oldestSec = returnBars.length > 0 ? Math.floor(returnBars[0].time / 1000) : null;
                window.BarLimitManager.onLimitBoundaryReached(genKey, oldestSec);
                cb(returnBars, { noData: true });
                return;
            }
        }

        cb(returnBars, { noData: false });
    }
}




function arrowToTVBars(arrowResult, resolution = '', symbolInfo = null) {
    const bars = [];
    const seenTimes = new Set();
    
    const resString = resolution ? resolution.toString() : '';
    const sfx = resolution ? resolutionToSuffix(resolution) : '';
    const isDWM = resString.includes('D') || resString.includes('W') || resString.includes('M') || sfx === 'D';
    const isMcx = symbolInfo && (symbolInfo.exchange === 'MCX' || (symbolInfo.name && (symbolInfo.name.includes('CRUDE') || symbolInfo.name.includes('GOLD') || symbolInfo.name.includes('SILVER') || symbolInfo.name.includes('NATURALGAS'))));
    
    for (const row of arrowResult) {
        let t = Number(row.time);
        
        if (isDWM) {
            // Daily/Weekly/Monthly Parquet files ALREADY have true 00:00:00 UTC timestamps.
            // DO NOT subtract 5.5 hours, otherwise it pushes Monday to Sunday!
            const d = new Date(t);
            d.setUTCHours(0, 0, 0, 0);
            t = d.getTime();
        } else {
            // Intraday Parquet files store "09:15 IST" as "09:15 UTC" (pseudo-UTC)
            // Subtract 5.5 hours to convert back to true UTC
            t -= 19800000;

            // Strictly filter out non-RTH (Regular Trading Hours) bars to match TradingView RTH sessions
            const istDate = new Date(t + 19800000);
            const mins = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
            if (isMcx) {
                if (mins < 540 || mins >= 1410) continue; // MCX: 09:00 - 23:30 IST
            } else {
                if (mins < 555 || mins >= 930) continue;  // NSE/BSE: 09:15 - 15:30 IST (full market session)
            }
        }
        
        if (seenTimes.has(t)) continue;
        seenTimes.add(t);
        
        bars.push({
            time:   t,
            open:   Number(row.open),
            high:   Number(row.high),
            low:    Number(row.low),
            close:  Number(row.close),
            volume: Number(row.volume),
        });
    }
    return bars;
}

window.triggerTvCacheReset = (symbol) => {
    console.log('[datafeed] triggerTvCacheReset notice for:', symbol || 'all');
    // IMPORTANT: Do NOT invoke onResetCacheNeededCallback() here!
    // In TradingView's direct transport, invoking onResetCacheNeededCallback causes the library
    // to execute unsubscribeBars() and permanently unhook the active chart from real-time streaming.
    // Real-time ticks stream continuously and self-heal automatically without dropping subscriptions.
};

// -----------------------------------------------------------------------
// THE DATAFEED
// -----------------------------------------------------------------------
const Datafeed = {
    onReady: (callback) => {
        setTimeout(() => callback(configurationData));
    },

    searchSymbols: async (userInput, exchange, symbolType, onResultReadyCallback) => {
        const query = (userInput || '').toUpperCase().trim();
        const results = [];
        const popMap = { 'XAUUSD':1, 'EURUSD':2, 'GBPUSD':3, 'USDJPY':4, 'US30':5, 'USTEC':6, 'US500':7, 'BTCUSD':8, 'NIFTY50-INDEX':9, 'BANKNIFTY-INDEX':10, 'SENSEX-INDEX':11, 'FINNIFTY-INDEX':12, 'MIDCPNIFTY-INDEX':13 };

        try {
            // Check exchange filter from TradingView dropdown
            const acc = (window.MT5API && typeof window.MT5API.getActiveAccount === 'function') ? window.MT5API.getActiveAccount() : null;
            const brokerExchange = (window.MT5API && typeof window.MT5API.getCleanBrokerExchange === 'function')
                ? window.MT5API.getCleanBrokerExchange(acc)
                : (acc ? (acc.server || 'MT5').split(/[-_\s]/)[0].toUpperCase() : 'MT5');

            const isMt5Allowed = !exchange || exchange === 'MT5' || exchange === brokerExchange || exchange.includes('MT5');
            const isIndianAllowed = !exchange || exchange === 'NSE' || exchange === 'BSE' || exchange === 'MCX';

            // 1. Instant MT5 In-Memory Search (< 1ms)
            if (isMt5Allowed && window.MT5API && window.MT5API.isConnected) {
                try {
                    const mt5Symbols = await window.MT5API.fetchSymbols(query, symbolType || '');
                    if (mt5Symbols && mt5Symbols.length > 0) {
                        const limit = query ? 50 : 25;
                        mt5Symbols.slice(0, limit).forEach(s => {
                            const fullSym = brokerExchange ? `${brokerExchange}:${s.name}` : s.name;
                            results.push({
                                symbol: s.name,
                                ticker: fullSym,
                                full_name: fullSym,
                                description: s.description || s.name,
                                exchange: brokerExchange,
                                type: s.type || 'forex'
                            });
                        });
                    }
                } catch (mt5Err) {
                    console.warn('[datafeed] MT5 searchSymbols notice:', mt5Err);
                }
            }

            // 2. Pre-Indexed Indian Base Indices & Commodities
            if (isIndianAllowed) {
                const INDICES = [
                    { symbol: 'NIFTY50-INDEX', full_name: 'NIFTY50-INDEX', description: 'NIFTY 50 Index', exchange: 'NSE', type: 'index' },
                    { symbol: 'BANKNIFTY-INDEX', full_name: 'BANKNIFTY-INDEX', description: 'NIFTY Bank Index', exchange: 'NSE', type: 'index' },
                    { symbol: 'FINNIFTY-INDEX', full_name: 'FINNIFTY-INDEX', description: 'NIFTY Financial Services Index', exchange: 'NSE', type: 'index' },
                    { symbol: 'SENSEX-INDEX', full_name: 'SENSEX-INDEX', description: 'BSE SENSEX Index', exchange: 'BSE', type: 'index' },
                    { symbol: 'MIDCPNIFTY-INDEX', full_name: 'MIDCPNIFTY-INDEX', description: 'NIFTY Midcap Select Index', exchange: 'NSE', type: 'index' },
                    { symbol: 'CRUDEOIL', full_name: 'CRUDEOIL', description: 'Crude Oil Futures', exchange: 'MCX', type: 'futures' },
                    { symbol: 'GOLD', full_name: 'GOLD', description: 'Gold Futures', exchange: 'MCX', type: 'futures' },
                    { symbol: 'SILVER', full_name: 'SILVER', description: 'Silver Futures', exchange: 'MCX', type: 'futures' },
                ];

                INDICES.forEach(idx => {
                    if (symbolType && symbolType !== idx.type) return;
                    if (exchange && exchange !== idx.exchange) return;
                    if (!query || idx.symbol.includes(query) || idx.description.toUpperCase().includes(query)) {
                        results.push(idx);
                    }
                });

                // 3. Deep Option Contracts (Searched on-demand only when user types strike/option/futures queries)
                const isOptionQuery = query && (query.includes('CE') || query.includes('PE') || query.includes('FUT') || /\d{3,}/.test(query) || symbolType === 'option' || symbolType === 'futures');
                if (isOptionQuery && window.SyncManager) {
                    try {
                        const expiries = await window.SyncManager.getAllExpiries();
                        for (let exp of expiries) {
                            for (let f of exp.files) {
                                const filename = f.path.split('/').pop();
                                const match = filename.match(/[A-Z]+.+?(\d{3,6})([CP]E)_/);
                                if (match) {
                                    const symbol = filename.split('_')[0];
                                    if (symbol.includes(query)) {
                                        const strike = parseInt(match[1], 10);
                                        const type = match[2];
                                        const typeDesc = type === 'CE' ? 'CALL' : 'PUT';
                                        const baseName = symbol.replace(/\d.*/, '');
                                        const desc = `${baseName} ${strike} ${typeDesc} (${exp.day} ${exp.monthLabel} ${exp.year})`;
                                        results.push({
                                            symbol: symbol,
                                            ticker: symbol,
                                            full_name: symbol,
                                            description: desc,
                                            exchange: (exp.baseTicker || "NSE_").split('_')[0],
                                            type: "option"
                                        });
                                        if (results.length > 60) break;
                                    }
                                }
                            }
                            if (results.length > 60) break;
                        }
                    } catch (_) {}
                }
            }
        } catch(e) {
            console.error("Search error", e);
        }

        // Deduplicate symbols
        const unique = [];
        const seen = new Set();
        for (let r of results) {
            const k = r.symbol.toUpperCase();
            if (!seen.has(k)) {
                seen.add(k);
                unique.push(r);
            }
        }

        // Intelligent Ranking:
        // Rank 1: Exact symbol match (e.g. XAUUSD)
        // Rank 2: Symbol starts with query
        // Rank 3: Description contains query
        // Rank 4: Popularity priority booster
        if (query) {
            unique.sort((a, b) => {
                const aSym = a.symbol.toUpperCase();
                const bSym = b.symbol.toUpperCase();

                // 1. Exact match always wins
                if (aSym === query && bSym !== query) return -1;
                if (bSym === query && aSym !== query) return 1;

                // 2. Starts with query
                const aStarts = aSym.startsWith(query);
                const bStarts = bSym.startsWith(query);
                if (aStarts && !bStarts) return -1;
                if (!aStarts && bStarts) return 1;

                // 3. Popularity booster
                const aPop = popMap[aSym] || 99;
                const bPop = popMap[bSym] || 99;
                if (aPop !== bPop) return aPop - bPop;

                return aSym.localeCompare(bSym);
            });
        }

        onResultReadyCallback(unique.slice(0, 60));
    },

    resolveSymbol: (symbolName, onSymbolResolvedCallback, onResolveErrorCallback) => {
        let exchange = 'NSE';
        let session = '0915-1530'; // Standard NSE/BSE trading hours
        
        let isLive = false;
        let actualName = symbolName;
        if (symbolName.includes('|LIVE')) {
            isLive = true;
            actualName = symbolName.split('|')[0];
        }

        // MT5 Forex, Commodity, Index & Stock Symbols Resolution
        const parts = actualName.split(':');
        const prefix = parts.length > 1 ? parts[0].toUpperCase().trim() : '';
        const cleanUpper = parts[parts.length - 1].toUpperCase().replace(/[^A-Z0-9]/g, '');
        const MT5_POPULAR = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'XAUUSD', 'XAGUSD', 'US30', 'USTEC', 'US500', 'DE40', 'UK100', 'AAPL', 'TSLA', 'NVDA', 'BTCUSD', 'ETHUSD', 'WTI', 'BRENT', 'XTIUSD', 'XBRUSD', 'USOIL', 'UKOIL', 'NGAS', 'NAS100', 'SP500', 'GER40', 'DJ30'];
        const KNOWN_BROKERS = ['THE 5%ERS', 'FUNDEDNEXT', 'FTMO', 'EXNESS', 'IC MARKETS', 'PEPPERSTONE', 'VANTAGE', 'METAQUOTES', 'OCTAFX', 'XM', 'FBS', 'HFM', 'AVATRADE', 'ROBOFOREX', 'TICKMILL', 'FXPRO', 'IG'];
        const isKnownBrokerPrefix = prefix === 'MT5' || KNOWN_BROKERS.includes(prefix) || (prefix && prefix !== 'NSE' && prefix !== 'BSE' && prefix !== 'MCX' && window.MT5API && window.MT5API.accounts && window.MT5API.accounts.some(a => (window.MT5API.getCleanBrokerExchange(a) === prefix) || (a.server && a.server.toUpperCase().includes(prefix))));
        const isMt5 = isKnownBrokerPrefix ||
                      actualName.startsWith('MT5:') ||
                      (window.MT5API && window.MT5API.isMt5Symbol(actualName)) ||
                      MT5_POPULAR.some(s => cleanUpper.startsWith(s));

        if (isMt5) {
            const cleanSym = actualName.split(':').pop().toUpperCase().trim();
            const acc = window.MT5API ? window.MT5API.getActiveAccount() : null;
            let brokerExchange = '';
            if (prefix && prefix !== 'MT5' && prefix !== 'NSE' && prefix !== 'BSE' && prefix !== 'MCX') {
                brokerExchange = prefix;
                if (window.MT5API && window.MT5API.accounts) {
                    const matchedAcc = window.MT5API.accounts.find(a => window.MT5API.getCleanBrokerExchange(a) === prefix);
                    if (matchedAcc && String(matchedAcc.id) !== String(window.MT5API.activeAccountId)) {
                        window.MT5API.setActiveAccount(matchedAcc.id);
                    }
                }
            } else if (window.MT5API && typeof window.MT5API.getCleanBrokerExchange === 'function') {
                brokerExchange = window.MT5API.getCleanBrokerExchange(acc);
            } else {
                brokerExchange = acc ? (acc.server || 'MT5').split(/[-_\s]/)[0].toUpperCase() : 'MT5';
            }
            const symInfo = window.MT5API ? window.MT5API.getSymbolInfo(cleanSym) : null;

            const proceedWithSymbol = (info) => {
                const mkt = window.getMarketStatus ? window.getMarketStatus(cleanSym) : null;

                let priceScale = 100000;
                if (info && info.pricescale) {
                    priceScale = Number(info.pricescale);
                } else if (cleanSym.includes('JPY') || cleanSym.includes('XAU') || cleanSym.includes('US30') || cleanSym.includes('USTEC') || cleanSym.includes('US500')) {
                    priceScale = 100;
                }

                let assetType = 'forex';
                if (info && info.type) {
                    assetType = info.type;
                } else if (cleanSym.includes('XAU') || cleanSym.includes('XAG') || cleanSym.includes('OIL')) {
                    assetType = 'commodity';
                } else if (cleanSym.includes('30') || cleanSym.includes('100') || cleanSym.includes('500') || cleanSym.includes('DE40')) {
                    assetType = 'index';
                } else if (cleanSym.includes('BTC') || cleanSym.includes('ETH')) {
                    assetType = 'crypto';
                }

                const desc = info && info.description ? info.description : cleanSym;
                const sessionStr = (info && info.session) ? info.session : (mkt ? mkt.session : (assetType === 'crypto' ? '24x7' : '2200-2200:12345'));
                const tzStr = (info && info.timezone) ? info.timezone : (mkt ? mkt.timezone : 'Etc/UTC');

                const earliestSec = (info && info.earliest_time) ? info.earliest_time : 1086912000;
                const earliestMs = earliestSec * 1000;
                const earliestDate = (info && info.earliest_date) ? info.earliest_date : '2004-06-11';

                if (!window._symbolEarliestTime) window._symbolEarliestTime = {};
                window._symbolEarliestTime[cleanSym] = earliestMs;
                if (!window._symbolEarliestDate) window._symbolEarliestDate = {};
                window._symbolEarliestDate[cleanSym] = earliestDate;

                const fullSymbolName = brokerExchange ? `${brokerExchange}:${cleanSym}` : cleanSym;
                const symbolInfo = {
                    name: fullSymbolName,
                    ticker: fullSymbolName,
                    full_name: fullSymbolName,
                    isLive: true,
                    description: desc,
                    type: assetType,
                    exchange: brokerExchange,
                    listed_exchange: brokerExchange,
                    format: 'price',
                    session: sessionStr,
                    timezone: tzStr,
                    minmov: 1,
                    pricescale: priceScale,
                    has_intraday: true,
                    has_no_volume: false,
                    has_empty_bars: false,
                    has_daily: true,
                    has_weekly_and_monthly: true,
                    supported_resolutions: ['1', '2', '3', '5', '10', '15', '30', '60', '120', '240', 'D', 'W', 'M'],
                    intraday_multipliers: ['1', '2', '3', '5', '10', '15', '30', '60', '120', '240'],
                    has_seconds: false,
                    volume_precision: 2,
                    data_status: 'streaming',
                    earliest_time: earliestSec,
                    earliest_time_ms: earliestMs,
                    earliest_date: earliestDate
                };
                setTimeout(() => onSymbolResolvedCallback(symbolInfo));
            };

            if (!symInfo && window.MT5API && typeof window.MT5API.fetchSymbolInfo === 'function') {
                window.MT5API.fetchSymbolInfo(cleanSym).then(fetched => {
                    proceedWithSymbol(fetched || symInfo);
                }).catch(() => {
                    proceedWithSymbol(symInfo);
                });
            } else {
                proceedWithSymbol(symInfo);
            }
            return;
        }
        
        if (actualName.includes('SENSEX') || actualName.includes('BANKEX')) {
            exchange = 'BSE';
        } else if (actualName.includes('CRUDE') || actualName.includes('GOLD') || actualName.includes('SILVER') || actualName.includes('NATURALGAS') || actualName.includes('NATGASMINI')) {
            exchange = 'MCX';
            session = '0900-2330:23456'; // Standard MCX trading hours Mon-Fri
        } else {
            session = '0915-1530:23456'; // Standard NSE/BSE trading hours Mon-Fri
        }

        const isMcx = exchange === 'MCX';
        let symType = 'option';
        if (actualName.includes('INDEX')) {
            symType = 'index';
        } else if (actualName.includes('FUT') || (isMcx && !actualName.endsWith('CE') && !actualName.endsWith('PE'))) {
            symType = 'futures';
        }

        const mktIndian = window.getMarketStatus ? window.getMarketStatus(actualName) : null;
        const sessionIndian = mktIndian ? mktIndian.session : session;
        const tzIndian = mktIndian ? mktIndian.timezone : 'Asia/Kolkata';

        const symbolInfo = {
            name: actualName,
            ticker: actualName,
            full_name: `${exchange}:${actualName}`,
            isLive: isLive,
            description: actualName,
            type: symType,
            exchange: exchange,
            listed_exchange: exchange,
            session: sessionIndian,
            timezone: tzIndian,
            minmov: 1,
            pricescale: 100,
            has_intraday: true,
            has_empty_bars: false,
            has_daily: true,
            has_weekly_and_monthly: false,
            supported_resolutions: configurationData.supported_resolutions,
            intraday_multipliers: ['1', '5', '60'],
            has_seconds: true,
            seconds_multipliers: ['5'],
            volume_precision: 0,
            data_status: 'streaming',
        };
        setTimeout(() => onSymbolResolvedCallback(symbolInfo));
    },

    // ==================================================================
    // getBars — the core data-loading method
    //
    // Design decisions based on TradingView docs + DuckDB-WASM constraints:
    //
    // 1. TradingView says: "countBack has higher priority than from".
    //    So if the [from,to) range has no data, we MUST return the latest
    //    countBack bars from wherever they exist in the file.
    //
    // 2. DuckDB-WASM crashes with "memory access out of bounds" when
    //    running queries against HTTP-served Parquet files. To fix this,
    //    we download each Parquet file ONCE into an ArrayBuffer cache,
    //    mount it into DuckDB's Virtual File System, and query it locally.
    //
    // 3. We use a SINGLE code path for both "data in range" and "data
    //    not in range" scenarios. No separate "forceful fetch" path.
    // ==================================================================
    resolveParquetFiles: async (symbolInfo, resolution, qFrom, qTo) => {
        const fileSuffix = resolutionToSuffix(resolution);
        let allFiles = [];
        try {
            const expiries = await window.SyncManager.getAllExpiries();
            const cleanSym = symbolInfo.name.replace(/^[A-Z]+:/, '');
            const isMcx = symbolInfo.exchange === 'MCX';

            for (let exp of expiries) {
                // Determine approximate time bounds for this folder
                let endT = Math.floor(exp.dateObjValue / 1000) + 86400;
                let startT = endT - (100 * 86400); // Default to 100 days
                
                if (exp.trackerData) {
                    if (exp.trackerData.start_date) {
                        startT = new Date(exp.trackerData.start_date).getTime() / 1000;
                    }
                    if (exp.trackerData.end_date) {
                        endT = new Date(exp.trackerData.end_date).getTime() / 1000 + 86400;
                    }
                }

                // Check base asset match!
                const expBase = exp.baseTicker.replace('NSE_', '').replace('BSE_', '').replace('MCX_', '').replace('_INDEX', '');
                const expSym = (exp.trackerData && exp.trackerData.symbol) ? exp.trackerData.symbol : expBase;

                let matchesBase = false;
                if (cleanSym.startsWith(expSym)) {
                    if (expSym === 'CRUDEOIL' && cleanSym.startsWith('CRUDEOILM')) {
                        matchesBase = false;
                    } else if (expSym === 'GOLD' && cleanSym.startsWith('GOLDM')) {
                        matchesBase = false;
                    } else if (expSym === 'SILVER' && cleanSym.startsWith('SILVERM')) {
                        matchesBase = false;
                    } else if (expSym === 'NATURALGAS' && cleanSym.startsWith('NATGASMINI')) {
                        matchesBase = false;
                    } else {
                        matchesBase = true;
                    }
                } else if (expBase && cleanSym.startsWith(expBase)) {
                    if (expBase === 'CRUDEOIL' && cleanSym.startsWith('CRUDEOILM')) {
                        matchesBase = false;
                    } else if (expBase === 'GOLD' && cleanSym.startsWith('GOLDM')) {
                        matchesBase = false;
                    } else if (expBase === 'SILVER' && cleanSym.startsWith('SILVERM')) {
                        matchesBase = false;
                    } else if (expBase === 'NATURALGAS' && cleanSym.startsWith('NATGASMINI')) {
                        matchesBase = false;
                    } else {
                        matchesBase = true;
                    }
                }
                if (!matchesBase) continue;
                
                // For options contracts, check expiry matching
                if (symbolInfo.type !== 'index' && symbolInfo.type !== 'futures') {
                    let expCode = exp.expiryCode;
                    let monthCode = null;
                    if (exp.dateStr && exp.dateStr.length >= 6) {
                        const m = parseInt(exp.dateStr.slice(4, 6), 10);
                        const monthNames = ['', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
                        monthCode = monthNames[m];
                    }
                    
                    let matchesExp = false;
                    if (expCode && cleanSym.includes(expCode)) {
                        matchesExp = true;
                    }
                    if (monthCode && cleanSym.includes(monthCode)) {
                        matchesExp = true;
                    }
                    if (exp.dateStr && exp.dateStr.length >= 4) {
                        const yy = exp.dateStr.slice(2, 4);
                        if (!cleanSym.includes(yy)) {
                            matchesExp = false;
                        }
                    }
                    if (!matchesExp) continue;
                }

                if (exp.files && exp.files.length > 0) {
                    for (let f of exp.files) {
                        const filename = f.path.split('/').pop();
                        
                        const dateMatch = filename.match(/_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})\.parquet/);
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
                            if (filename.startsWith(cleanSym + '_')) {
                                isMatch = true; priority = 10;
                            } else if (filename.includes('FUT_')) {
                                const prefix = cleanSym.replace(/\d{2}[A-Z]{3}FUT/, '');
                                if (filename.startsWith(prefix)) {
                                    isMatch = true; priority = 1;
                                }
                            }
                        } else if (symbolInfo.type === 'index') {
                            if (filename.startsWith(cleanSym + '_')) {
                                isMatch = true; priority = 10;
                            }
                        } else { // Option
                            if (filename.startsWith(cleanSym + '_')) {
                                isMatch = true; priority = 10;
                            }
                        }
                        
                        if (isMatch && !allFiles.find(x => x.path === f.path)) {
                            allFiles.push({ path: f.path, fStart, fEnd, priority, filename });
                        }
                    }
                } else {
                    // FAST PATH: Construct dynamic Parquet filename from tracker metadata (0 Tree API calls!)
                    let endDateStr = '';
                    let startDateStr = '';
                    if (exp.trackerData && exp.trackerData.end_date) {
                        endDateStr = exp.trackerData.end_date;
                    } else if (exp.dateStr) {
                        endDateStr = `${exp.dateStr.slice(0,4)}-${exp.dateStr.slice(4,6)}-${exp.dateStr.slice(6,8)}`;
                    }
                    if (exp.trackerData && exp.trackerData.start_date) {
                        startDateStr = exp.trackerData.start_date;
                    } else if (endDateStr) {
                        const parts = endDateStr.split('-').map(Number);
                        const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
                        d.setUTCDate(d.getUTCDate() - 100);
                        startDateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
                    }
                    
                    const fStart = new Date(startDateStr).getTime() / 1000;
                    const fEnd = (new Date(endDateStr).getTime() / 1000) + 86400;
                    
                    if (startDateStr && endDateStr) {
                        let targetSym = cleanSym;
                        if (symbolInfo.type === 'futures' && !targetSym.endsWith('FUT')) {
                            if (isMcx) {
                                const m = parseInt(exp.dateStr.slice(4, 6), 10);
                                const nextM = (m % 12) + 1;
                                let yyNum = parseInt(exp.dateStr.slice(2, 4), 10);
                                if (m === 12) yyNum = (yyNum + 1) % 100;
                                const yyStr = String(yyNum).padStart(2, '0');
                                const monthNames = ['', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
                                targetSym = `${expSym}${yyStr}${monthNames[nextM]}FUT`;
                            } else {
                                const yy = exp.dateStr.slice(2, 4);
                                targetSym = `${expSym}${yy}${exp.expiryCode || 'OCT'}FUT`;
                            }
                        }
                        const filename = `${targetSym}_${fileSuffix}_${startDateStr}_to_${endDateStr}.parquet`;
                        const path = `${exp.baseTicker}/option_data/parquet/${exp.folderPath}/${filename}`;
                        if (!allFiles.find(x => x.path === path)) {
                            allFiles.push({ path, fStart, fEnd, priority: 10, filename });
                        }
                    }
                }
            }
            
            // For index and futures:
            // Continuous symbols across multiple expiries should have candidate files sorted newest first.
            if (symbolInfo.type === 'index' || symbolInfo.type === 'futures') {
                let candidateFiles = allFiles.filter(f => f.fStart <= qTo);
                if (candidateFiles.length === 0) {
                    candidateFiles = allFiles;
                }
                candidateFiles.sort((a, b) => b.priority - a.priority || b.fEnd - a.fEnd);
                let selected = candidateFiles.slice(0, 4);
                console.log("[resolveSymbolFiles] index/futures selected:", selected);
                return selected.map(f => {
                    const baseTicker = f.path.split('/')[0];
                    return `https://huggingface.co/datasets/deep776/FYERS_${baseTicker}/resolve/main/${f.path}`;
                });
            }
            
            // For options:
            let intersecting = allFiles.filter(f => f.fEnd >= qFrom && f.fStart <= qTo);
            if (intersecting.length === 0) {
                let pastFiles = allFiles.filter(f => f.fStart <= qTo);
                if (pastFiles.length > 0) {
                    pastFiles.sort((a, b) => b.fEnd - a.fEnd);
                    const newestEnd = pastFiles[0].fEnd;
                    intersecting = pastFiles.filter(f => f.fEnd === newestEnd);
                }
            }
            if (intersecting.length === 0 && allFiles.length > 0) {
                intersecting = allFiles;
            }
            intersecting.sort((a, b) => b.priority - a.priority || b.fEnd - a.fEnd);
            let selected = intersecting.slice(0, 4);
            return selected.map(f => {
                const baseTicker = f.path.split('/')[0];
                return `https://huggingface.co/datasets/deep776/FYERS_${baseTicker}/resolve/main/${f.path}`;
            });
            
        } catch(e) {
            console.error("Resolve error", e);
            return [];
        }
    },

    // Returns the absolute earliest timestamp (in seconds) across all Parquet files for a symbol
    getEarliestParquetTime: async (symbolInfo) => {
        try {
            const expiries = await window.SyncManager.getAllExpiries();
            const cleanSym = symbolInfo.name.replace(/^[A-Z]+:/, '');
            let earliest = Infinity;
            for (let exp of expiries) {
                const expBase = exp.baseTicker.replace('NSE_', '').replace('BSE_', '').replace('MCX_', '').replace('_INDEX', '');
                const expSym = (exp.trackerData && exp.trackerData.symbol) ? exp.trackerData.symbol : expBase;
                if (!cleanSym.startsWith(expSym) && !cleanSym.startsWith(expBase)) continue;

                if (exp.files && exp.files.length > 0) {
                    for (let f of exp.files) {
                        const filename = f.path.split('/').pop();
                        if (!filename.startsWith(cleanSym)) continue;
                        const dateMatch = filename.match(/_(\d{4}-\d{2}-\d{2})_to_/);
                        if (dateMatch) {
                            const fStart = new Date(dateMatch[1]).getTime() / 1000;
                            if (fStart < earliest) earliest = fStart;
                        }
                    }
                } else if (exp.trackerData && exp.trackerData.start_date) {
                    const startT = new Date(exp.trackerData.start_date).getTime() / 1000;
                    if (startT < earliest) earliest = startT;
                } else if (exp.dateObjValue) {
                    let endT = Math.floor(exp.dateObjValue / 1000) + 86400;
                    let startT = endT - (100 * 86400);
                    if (startT < earliest) earliest = startT;
                }
            }
            return earliest;
        } catch(e) {
            return Infinity;
        }
    },

    getBars: async (symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) => {
        let { from, to, countBack, firstDataRequest } = periodParams;
        const rawFrom = from;
        const rawTo = to;
        countBack = countBack || 300;

        const maxBarsLimit = (window.BarLimitManager && typeof window.BarLimitManager.getLimit === 'function') 
            ? window.BarLimitManager.getLimit() 
            : 40000;
        const generalCacheKey = getBarLimitCacheKey(symbolInfo, resolution);

        // Ensure global bars cache is initialized
        if (!window._barsCache) window._barsCache = {};

        // FAST PATH: If firstDataRequest and we already have cached bars in memory (e.g. after limit expansion or reset)
        if (firstDataRequest && window._barsCache[generalCacheKey] && window._barsCache[generalCacheKey].length > 0) {
            let cachedBars = window._barsCache[generalCacheKey];
            if (cachedBars.length > maxBarsLimit) {
                cachedBars = cachedBars.slice(cachedBars.length - maxBarsLimit);
                window._barsCache[generalCacheKey] = cachedBars;
            }

            if (window.BarLimitManager) {
                window.BarLimitManager.setBarCount(generalCacheKey, cachedBars.length);
                if (cachedBars.length > 0) {
                    window.BarLimitManager.setOldestBar(generalCacheKey, Math.floor(cachedBars[0].time / 1000));
                }
            }

            const cleanSym = symbolInfo.name.split(':').pop().toUpperCase().trim();
            const acc = (window.MT5API && typeof window.MT5API.getActiveAccount === 'function') ? window.MT5API.getActiveAccount() : null;
            const accId = acc ? acc.id : 'default';
            const cacheKey = `MT5_${accId}_${cleanSym}_${resolution}`;
            if (!window._tvLastBar) window._tvLastBar = {};
            const last = cachedBars[cachedBars.length - 1];
            if (last) {
                window._tvLastBar[cacheKey] = {
                    time: last.time,
                    open: Number(last.open),
                    high: Number(last.high),
                    low: Number(last.low),
                    close: Number(last.close),
                    volume: Number(last.volume)
                };
            }

            console.log(`[datafeed] Fast cache hit for ${generalCacheKey}: returning ${cachedBars.length} bars directly.`);
            setTimeout(() => {
                onHistoryCallback(cachedBars, { noData: false });
            }, 0);
            return;
        }

        // If not firstDataRequest, check if current symbol/resolution has already reached maxBarsLimit
        if (!firstDataRequest && window.BarLimitManager) {
            const currentLoaded = window.BarLimitManager.getBarCount(generalCacheKey);
            if (currentLoaded >= maxBarsLimit) {
                console.warn(`[datafeed] Hardcore bar limit reached for ${generalCacheKey} (${currentLoaded}/${maxBarsLimit} bars). Halting historical load.`);
                window.BarLimitManager.onLimitBoundaryReached(generalCacheKey);
                onHistoryCallback([], { noData: true });
                return;
            }
        }
        
        // 1. MT5 Live Feed - ALWAYS CHECK FIRST FOR ALL MT5 INSTRUMENTS
        const isMt5Exchange = (symbolInfo.exchange && symbolInfo.exchange.includes('MT5')) ||
                              symbolInfo.name.startsWith('MT5:') ||
                              (symbolInfo.exchange !== 'NSE' && symbolInfo.exchange !== 'BSE' && symbolInfo.exchange !== 'MCX' && ((window.MT5API && window.MT5API.isMt5Symbol(symbolInfo.name)) || /USD|EUR|GBP|JPY|AUD|CAD|CHF|NZD|XAU|XAG|BTC|ETH|US30|USTEC|US500/.test(symbolInfo.name.toUpperCase())));

        if (isMt5Exchange) {
            if (!window.MT5API) {
                for (let i = 0; i < 15; i++) {
                    await new Promise(r => setTimeout(r, 100));
                    if (window.MT5API) break;
                }
            }
            if (!window.MT5API) {
                console.warn('[datafeed] MT5API client not ready for MT5 symbol:', symbolInfo.name);
                onHistoryCallback([], { noData: true });
                return;
            }
            const cleanSym = symbolInfo.name.split(':').pop().toUpperCase().trim();
            let targetAcc = null;
            if (symbolInfo.exchange && symbolInfo.exchange !== 'MT5' && window.MT5API && window.MT5API.accounts) {
                targetAcc = window.MT5API.accounts.find(a => window.MT5API.getCleanBrokerExchange(a) === symbolInfo.exchange);
            }
            if (!targetAcc && window.MT5API && typeof window.MT5API.getActiveAccount === 'function') {
                targetAcc = window.MT5API.getActiveAccount();
            }
            const accId = targetAcc ? targetAcc.id : 'default';
            const cacheKey = `MT5_${accId}_${cleanSym}_${resolution}`;

            // Retrieve cached inception start time for this symbol (guarantees we know if data has ended)
            const earliestTimeMs = (window._symbolEarliestTime && window._symbolEarliestTime[cleanSym])
                || (symbolInfo.earliest_time_ms)
                || (1086912000 * 1000);
            const earliestTimeSec = Math.floor(earliestTimeMs / 1000);
            const earliestDateStr = (window._symbolEarliestDate && window._symbolEarliestDate[cleanSym])
                || (symbolInfo.earliest_date)
                || '2004-06-11';

            try {
                // If requested range is completely before the confirmed inception date, stop immediately
                if (rawTo <= earliestTimeSec) {
                    console.log(`[datafeed] Inception date reached for ${cleanSym} (${earliestDateStr}). Stopping backward pagination.`);
                    onHistoryCallback([], { noData: true });
                    return;
                }

                let mt5Bars = await window.MT5API.fetchBars(cleanSym, resolution, rawFrom, rawTo, countBack || 500, accId);

                // If fetchBars returned empty (e.g. server in middle of restart), quick retry once after 350ms
                if ((!mt5Bars || mt5Bars.length === 0) && (firstDataRequest || (window.MT5API && window.MT5API.wasDisconnected))) {
                    await new Promise(r => setTimeout(r, 350));
                    mt5Bars = await window.MT5API.fetchBars(cleanSym, resolution, rawFrom, rawTo, countBack || 500, accId);
                }

                // If still empty when scrolling back (not firstDataRequest), look back up to 4 days prior to bridge weekend gap
                if ((!mt5Bars || mt5Bars.length === 0) && !firstDataRequest && rawTo > earliestTimeSec) {
                    const weekendLookback = 4 * 86400; // 4 days prior
                    const bridgeFrom = Math.max(earliestTimeSec, rawFrom - weekendLookback);
                    mt5Bars = await window.MT5API.fetchBars(cleanSym, resolution, bridgeFrom, rawTo, countBack || 500, accId);
                }

                if (mt5Bars && mt5Bars.length > 0) {
                    // Filter out any invalid bars or future anomalies (allowing 5 min buffer)
                    const maxAllowedTime = Date.now() + 300000;
                    const isDwm = String(resolution).toUpperCase().includes('D') || 
                                  String(resolution).toUpperCase().includes('W') || 
                                  String(resolution).toUpperCase().includes('M');
                    const validBars = mt5Bars
                        .filter(b => b.time && b.time <= maxAllowedTime && !isNaN(b.close))
                        .map(b => {
                            if (isDwm) {
                                const d = new Date(b.time);
                                d.setUTCHours(0, 0, 0, 0);
                                return { ...b, time: d.getTime() };
                            }
                            return b;
                        });
                    validBars.sort((a, b) => a.time - b.time);

                    if (validBars.length > 0) {
                        let returnBars = validBars;
                        let hitLimit = false;

                        if (window.BarLimitManager) {
                            if (firstDataRequest) {
                                if (returnBars.length > maxBarsLimit) {
                                    returnBars = returnBars.slice(returnBars.length - maxBarsLimit);
                                    hitLimit = true;
                                }
                            } else {
                                const currentLoaded = window.BarLimitManager.getBarCount(generalCacheKey);
                                const remaining = maxBarsLimit - currentLoaded;
                                if (remaining <= 0) {
                                    const oldestSec = returnBars.length > 0 ? Math.floor(returnBars[0].time / 1000) : null;
                                    window.BarLimitManager.onLimitBoundaryReached(generalCacheKey, oldestSec);
                                    onHistoryCallback([], { noData: true });
                                    return;
                                }
                                if (returnBars.length >= remaining) {
                                    returnBars = returnBars.slice(returnBars.length - remaining);
                                    hitLimit = true;
                                }
                            }

                            // Accumulate into window._barsCache[generalCacheKey]
                            const curCache = window._barsCache[generalCacheKey] || [];
                            const bMap = new Map();
                            for (const b of curCache) bMap.set(b.time, b);
                            for (const b of returnBars) bMap.set(b.time, b);
                            const merged = Array.from(bMap.values()).sort((a, b) => a.time - b.time);
                            window._barsCache[generalCacheKey] = merged;

                            window.BarLimitManager.setBarCount(generalCacheKey, merged.length);
                            if (merged.length > 0) {
                                const oldestSec = Math.floor(merged[0].time / 1000);
                                window.BarLimitManager.setOldestBar(generalCacheKey, oldestSec);
                            }
                        }

                        // Only update _tvLastBar if this is the initial load or a newer bar.
                        // NEVER overwrite active forming candle with older historical chunks when scrolling back!
                        if (!window._tvLastBar) window._tvLastBar = {};
                        const last = returnBars[returnBars.length - 1];
                        const currLast = window._tvLastBar[cacheKey];
                        if (firstDataRequest || !currLast || last.time >= currLast.time) {
                            window._tvLastBar[cacheKey] = {
                                time: last.time,
                                open: Number(last.open),
                                high: Number(last.high),
                                low: Number(last.low),
                                close: Number(last.close),
                                volume: Number(last.volume)
                            };
                        }

                        if (hitLimit && window.BarLimitManager) {
                            const oldestSec = returnBars.length > 0 ? Math.floor(returnBars[0].time / 1000) : null;
                            window.BarLimitManager.onLimitBoundaryReached(generalCacheKey, oldestSec);
                            onHistoryCallback(returnBars, { noData: true });
                            return;
                        }

                        onHistoryCallback(returnBars, { noData: false });
                        return;
                    }
                }

                // If no bars returned for requested range:
                // Only bridge via nextTime when scrolling backward into history (never on firstDataRequest)
                if (!firstDataRequest && rawTo > earliestTimeSec) {
                    // DATA IS NOT ENDED! We are simply traversing a weekend, holiday, or broker quote pause.
                    // Supply nextTime so TradingView jumps across the gap and keeps scrolling back!
                    const gapHopSec = Math.max(earliestTimeSec, rawTo - (3 * 86400));
                    console.log(`[datafeed] Gap encountered for ${cleanSym} at ${new Date(rawTo * 1000).toISOString()} (inception: ${earliestDateStr}). Bridging via nextTime: ${new Date(gapHopSec * 1000).toISOString()}`);
                    onHistoryCallback([], { noData: true, nextTime: gapHopSec * 1000 });
                    return;
                }

                // If rawTo is at or before inception date, history is truly exhausted.
                console.log(`[datafeed] True inception date reached for ${cleanSym} (${earliestDateStr}). History exhausted.`);
                onHistoryCallback([], { noData: true });
                return;
            } catch (err) {
                console.warn('[datafeed] MT5 fetchBars error:', err);
                if (firstDataRequest && typeof onErrorCallback === 'function') {
                    onErrorCallback(err.message || 'MT5 server reconnecting');
                } else if (rawTo > earliestTimeSec) {
                    const fallbackNextTime = Math.max(earliestTimeSec, rawTo - 86400);
                    onHistoryCallback([], { noData: true, nextTime: fallbackNextTime * 1000 });
                } else {
                    onHistoryCallback([], { noData: true });
                }
                return;
            }
        }

        // 2. Live Options (No Parquet) for Indian Fyers
        if (symbolInfo.isLive && window.FyersAPI && (symbolInfo.exchange === 'NSE' || symbolInfo.exchange === 'BSE' || symbolInfo.exchange === 'MCX')) {
            let fyersBars = await window.FyersAPI.getHistory(symbolInfo.name, resolution, rawFrom, rawTo);
            fyersBars = alignFyersDwmTime(fyersBars, resolution);
            if (fyersBars && fyersBars.length > 0) {
                const last = fyersBars[fyersBars.length - 1];
                if (window.WatchlistUI && typeof window.WatchlistUI.onLivePrice === 'function') {
                    window.WatchlistUI.onLivePrice(symbolInfo.name, last.close, last.open);
                }
            }
            return safeHistoryCallback(fyersBars, onHistoryCallback, resolution, symbolInfo);
        }

        let conn = null;
        let finalBars = [];
        let duckdbHit = false;

        try {
            // 2. Identify Fyers Base Symbol for stitching
            let fyersSymbol = `${symbolInfo.exchange}:${symbolInfo.name}`;
            if (symbolInfo.type === 'futures' && window.HF_EXPIRIES) {
                const baseTickerMatch = symbolInfo.name.match(/^([A-Z]+)\d/);
                if (baseTickerMatch) {
                    const rawBase = baseTickerMatch[1];
                    const isMcx = symbolInfo.exchange === 'MCX';
                    const baseExpiries = window.HF_EXPIRIES.filter(e => {
                        if (isMcx) return e.baseTicker === `MCX_${rawBase}`;
                        return e.baseTicker.includes(rawBase) && e.expiryType === 'M' && !e.isDummy;
                    });
                    if (baseExpiries.length > 0) {
                        baseExpiries.sort((a,b) => a.dateObjValue - b.dateObjValue);
                        const now = Date.now();
                        let activeExp = baseExpiries.find(e => now < (e.dateObjValue + 86400000));
                        if (!activeExp) activeExp = baseExpiries[baseExpiries.length - 1];
                        const yy = activeExp.dateStr.slice(2,4);
                        const base = activeExp.baseTicker.replace('NSE_', '').replace('BSE_', '').replace('_INDEX', '').replace('MCX_', '');
                        if (isMcx) {
                            const m = parseInt(activeExp.dateStr.slice(4, 6), 10);
                            const nextM = (m % 12) + 1;
                            let yyNum = parseInt(yy, 10);
                            if (m === 12) yyNum = (yyNum + 1) % 100;
                            const yyStr = String(yyNum).padStart(2, '0');
                            const monthNames = ['', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
                            fyersSymbol = `${symbolInfo.exchange}:${base}${yyStr}${monthNames[nextM]}FUT`;
                        } else {
                            fyersSymbol = `${symbolInfo.exchange}:${base}${yy}${activeExp.expiryCode}FUT`;
                        }
                    }
                }
            }

            // 3. Query DuckDB Parquet Data
            if (window.db && Datafeed.resolveParquetFiles) {
                const fileUrls = await Datafeed.resolveParquetFiles(symbolInfo, resolution, rawFrom, rawTo);
                if (fileUrls.length > 0) {
                    let vfsNames = [];
                    for (let url of fileUrls) {
                        vfsNames.push(await window.ensureParquetLoaded(url));
                    }
                    const unionStmts = vfsNames.map(vfs => `SELECT * FROM read_parquet('${vfs}')`).join(' UNION ALL ');
                    
                    conn = await window.db.connect();
                    
                    const resString = resolution ? resolution.toString() : '';
                    const sfx = resolution ? resolutionToSuffix(resolution) : '';
                    const isDWM = resString.includes('D') || resString.includes('W') || resString.includes('M') || sfx === 'D';
                    const timeShift = isDWM ? 0 : 19800; // Intraday parquet stores pseudo-UTC (IST)
                    
                    // Fetch bars strictly prior to rawTo, with sufficient margin to satisfy countBack and indicator warmup
                    const fetchLimit = firstDataRequest ? Math.max(countBack * 10, 2000) : Math.max(countBack * 3, 1000);
                    const rangeSQL = `
                        SELECT time * 1000 AS time, open, high, low, close, volume
                        FROM (${unionStmts})
                        WHERE time < ${rawTo + timeShift}
                        ORDER BY time DESC
                        LIMIT ${fetchLimit}
                    `;
                    const rangeResult = await conn.query(rangeSQL);
                    try { await conn.close(); } catch(_) {}
                    conn = null;
                    
                    let parquetBars = arrowToTVBars(rangeResult, resolution, symbolInfo);
                    
                    if (parquetBars.length > 0) {
                        duckdbHit = true;
                        
                        // Deduplicate by timestamp
                        const dedupMap = new Map();
                        for (let b of parquetBars) {
                            if (!dedupMap.has(b.time)) {
                                dedupMap.set(b.time, b);
                            }
                        }
                        let sortedBars = Array.from(dedupMap.values()).sort((a, b) => a.time - b.time);
                        
                        let chosenBars = [];
                        if (firstDataRequest) {
                            // Initial load: return full historical buffer so technical indicators (e.g. 200 SMA, Bollinger Bands)
                            // have immediate warmup bars and render completely across all visible candles without needing to scroll back
                            chosenBars = sortedBars;
                        } else {
                            // Backward pagination: fulfill countBack relative to requested window
                            let inRangeBars = sortedBars.filter(b => b.time >= rawFrom * 1000 && b.time < rawTo * 1000);
                            if (inRangeBars.length >= countBack) {
                                chosenBars = inRangeBars;
                            } else {
                                let needed = countBack - inRangeBars.length;
                                let olderBars = sortedBars.filter(b => b.time < rawFrom * 1000);
                                let prependBars = olderBars.slice(-needed);
                                chosenBars = prependBars.concat(inRangeBars);
                            }
                        }
                        
                        if (chosenBars.length > 0) {
                            finalBars = chosenBars;
                            let earliestParquet = finalBars[0].time / 1000;
                            let latestParquet = finalBars[finalBars.length - 1].time / 1000;
                            
                            // LEFT GAP: Fetch Deep History if TV wants older data than Parquet has
                            if (rawFrom < earliestParquet && window.FyersAPI && window.FyersAPI.token) {
                                try {
                                    DFLog.info('getBars', `Fetching LEFT GAP from Fyers: ${rawFrom} to ${earliestParquet}`);
                                    let leftBars = await window.FyersAPI.getDeepHistory(fyersSymbol, resolution, rawFrom, earliestParquet);
                                    leftBars = alignFyersDwmTime(Array.isArray(leftBars) ? leftBars : (leftBars.data || []), resolution);
                                    finalBars = leftBars.concat(finalBars);
                                } catch(e) { DFLog.error('getBars', 'Left gap fetch failed', e); }
                            }
                            
                            // RIGHT GAP: Fetch Recent History if TV wants newer data than Parquet has
                            if (rawTo > latestParquet && window.FyersAPI && window.FyersAPI.token) {
                                try {
                                    DFLog.info('getBars', `Fetching RIGHT GAP from Fyers: ${latestParquet} to ${rawTo}`);
                                    let rightBars = await window.FyersAPI.getDeepHistory(fyersSymbol, resolution, latestParquet, rawTo);
                                    rightBars = alignFyersDwmTime(Array.isArray(rightBars) ? rightBars : (rightBars.data || []), resolution);
                                    finalBars = finalBars.concat(rightBars);
                                } catch(e) { DFLog.error('getBars', 'Right gap fetch failed', e); }
                            }
                        }
                    }
                }
            }
            
            // 4. If DuckDB returned absolutely nothing for this range
            let isEnd = false;
            const isIndianSymbol = symbolInfo.exchange === 'NSE' || symbolInfo.exchange === 'BSE' || symbolInfo.exchange === 'MCX';
            const isNotMt5 = !fyersSymbol.includes('MT5') && !symbolInfo.name.startsWith('MT5:') && !(window.MT5API && window.MT5API.isMt5Symbol(symbolInfo.name));
            if (!duckdbHit && isIndianSymbol && isNotMt5 && window.FyersAPI && window.FyersAPI.token) {
                DFLog.info('getBars', `No Parquet data found for range. Falling back to Fyers Deep History.`);
                let res = await window.FyersAPI.getDeepHistory(fyersSymbol, resolution, rawFrom, rawTo);
                let deepBars = Array.isArray(res) ? res : (res.data || []);
                isEnd = res.isEnd || false;
                
                finalBars = alignFyersDwmTime(deepBars, resolution);
            }

            // 5. Final Deduplication and Time Filtering
            if (finalBars.length > 0) {
                // Strictly guarantee bars do NOT exceed rawTo
                finalBars = finalBars.filter(b => b.time < rawTo * 1000);
                
                const uniqueMap = new Map();
                for (let b of finalBars) {
                    uniqueMap.set(b.time, b);
                }
                
                let cleanBars = Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time);
                
                if (cleanBars.length > 0) {
                    if (!window._tvLastBar) window._tvLastBar = {};
                    const cacheKey = `${fyersSymbol}_${resolution}`;
                    const currentLastBar = window._tvLastBar[cacheKey];
                    const batchLastBar = cleanBars[cleanBars.length - 1];
                    if (!currentLastBar || batchLastBar.time > currentLastBar.time) {
                        window._tvLastBar[cacheKey] = { ...batchLastBar };
                    }
                    if (batchLastBar && batchLastBar.close != null) {
                        if (!window._tvLatestMarketPrice) window._tvLatestMarketPrice = {};
                        const p = Number(batchLastBar.close);
                        window._tvCurrentLastPrice = p;
                        if (symbolInfo && symbolInfo.name) {
                            window._tvLatestMarketPrice[symbolInfo.name.toUpperCase()] = p;
                            const cleanName = symbolInfo.name.replace(/^[A-Z0-9_-]+:/, '').toUpperCase();
                            window._tvLatestMarketPrice[cleanName] = p;
                        }
                        if (window.TradeUIInstance && typeof window.TradeUIInstance.onLivePriceUpdate === 'function') {
                            window.TradeUIInstance.onLivePriceUpdate(p, symbolInfo ? symbolInfo.name : null);
                        }
                        if (window.WatchlistUI && typeof window.WatchlistUI.onLivePrice === 'function') {
                            const symName = symbolInfo ? symbolInfo.name : null;
                            window.WatchlistUI.onLivePrice(symName, p, null, null);
                            if (symName && symName.includes(':')) {
                                window.WatchlistUI.onLivePrice(symName.split(':').pop(), p, null, null);
                            }
                        }
                    }
                    
                    DFLog.info('getBars', `Returning ${cleanBars.length} beautifully stitched bars`);
                    return safeHistoryCallback(cleanBars, onHistoryCallback, resolution, symbolInfo);
                }
            }
            
            // 6. No data at all — determine whether to halt or continue pagination
            if (isEnd) {
                return onHistoryCallback([], { noData: true });
            }
            
            // Calculate absolute earliest time from Parquet metadata
            const absoluteEarliest = await Datafeed.getEarliestParquetTime(symbolInfo);
            const fyersOffline = !window.FyersAPI || !window.FyersAPI.token;
            
            if (fyersOffline && absoluteEarliest !== Infinity && rawFrom < absoluteEarliest) {
                DFLog.info('getBars', `Broker offline & past Parquet inception (${new Date(absoluteEarliest * 1000).toISOString()}). Halting.`);
                return onHistoryCallback([], { noData: true });
            }
            
            // Tell TV to look one day earlier (in milliseconds as per TV docs)
            DFLog.info('getBars', `No data in range. Sending nextTime = ${new Date((rawFrom - 86400) * 1000).toISOString()}`);
            return onHistoryCallback([], { noData: true, nextTime: (rawFrom - 86400) * 1000 });

        } catch (error) {
            if (conn) { try { await conn.close(); } catch (_) {} }
            DFLog.error('getBars', `Error for ${symbolInfo.name}`, error);
            onHistoryCallback([], { noData: true });
        }
    },

    subscribeBars: (symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) => {
        DFLog.info('subscribeBars', `UID: ${subscriberUID}`);
        window._tvResetCache = onResetCacheNeededCallback;

        // MT5 Live Real-Time Subscription Hook
        const isMt5Sub = (symbolInfo.exchange && symbolInfo.exchange.includes('MT5')) ||
                         symbolInfo.name.startsWith('MT5:') ||
                         (symbolInfo.exchange !== 'NSE' && symbolInfo.exchange !== 'BSE' && symbolInfo.exchange !== 'MCX' && ((window.MT5API && window.MT5API.isMt5Symbol(symbolInfo.name)) || /USD|EUR|GBP|JPY|AUD|CAD|CHF|NZD|XAU|XAG|BTC|ETH|US30|USTEC|US500/.test(symbolInfo.name.toUpperCase())));

        if (isMt5Sub) {
            if (!window.MT5API) {
                console.warn('[datafeed] MT5API client not ready for subscription:', symbolInfo.name);
                return;
            }
            const cleanSym = symbolInfo.name.split(':').pop().toUpperCase().trim();
            const acc = (window.MT5API && typeof window.MT5API.getActiveAccount === 'function') ? window.MT5API.getActiveAccount() : null;
            const accId = acc ? acc.id : 'default';
            const cacheKey = `MT5_${accId}_${cleanSym}_${resolution}`;

            if (!window._mt5ResetCallbacks) window._mt5ResetCallbacks = new Map();
            window._mt5ResetCallbacks.set(subscriberUID, onResetCacheNeededCallback);

            const getResolutionMs = (res) => {
                const r = String(res).toUpperCase();
                if (r === 'D' || r === '1D') return 86400 * 1000;
                if (r === 'W' || r === '1W') return 7 * 86400 * 1000;
                if (r === 'M' || r === '1M') return 30 * 86400 * 1000;
                const m = parseInt(r, 10);
                return (!isNaN(m) && m > 0) ? m * 60 * 1000 : 5 * 60 * 1000;
            };
            const tfMs = getResolutionMs(resolution);
            const isDwm = String(resolution).toUpperCase().includes('D') || 
                          String(resolution).toUpperCase().includes('W') || 
                          String(resolution).toUpperCase().includes('M');

            const alignTime = (t) => {
                if (!isDwm) return t;
                const d = new Date(t);
                d.setUTCHours(0, 0, 0, 0);
                return d.getTime();
            };

            const mt5Cb = (tick) => {
                if (!tick) return;
                // Only process ticks for this exact symbol
                const tickSym = (tick.symbol || '').split(':').pop().toUpperCase().trim();
                if (tickSym && tickSym !== cleanSym) return;

                const price = Number(tick.last && tick.last > 0 ? tick.last : tick.bid);
                if (!price || isNaN(price)) return;

                // Stream real-time bid/ask to trade ticket and floating badges
                if (window.TradeUIInstance && typeof window.TradeUIInstance.onLivePriceUpdate === 'function') {
                    window.TradeUIInstance.onLivePriceUpdate(price, symbolInfo.name, tick.bid, tick.ask);
                }

                if (window.WatchlistUI && typeof window.WatchlistUI.onLivePrice === 'function') {
                    window.WatchlistUI.onLivePrice(cleanSym, price, tick.daily_open || null, tick.daily_change !== undefined ? tick.daily_change : null);
                }

                const currentAcc = (window.MT5API && typeof window.MT5API.getActiveAccount === 'function') ? window.MT5API.getActiveAccount() : null;
                const currentAccId = currentAcc ? currentAcc.id : accId;
                const activeKey = `MT5_${currentAccId}_${cleanSym}_${resolution}`;

                if (!window._tvLastBar) window._tvLastBar = {};
                let lastBar = window._tvLastBar[activeKey] || window._tvLastBar[cacheKey];
                if (!lastBar && window._barsCache) {
                    const genKey = `${(symbolInfo.ticker || symbolInfo.name || '').replace(/[^A-Za-z0-9_]/g, '')}_${resolution}`;
                    const cached = window._barsCache[genKey];
                    if (cached && cached.length > 0) {
                        const l = cached[cached.length - 1];
                        lastBar = { ...l };
                        window._tvLastBar[activeKey] = lastBar;
                    }
                }

                const tickTime = Number(tick.time) || Date.now();
                let barTime;
                if (isDwm) {
                    const d = new Date(tickTime);
                    d.setUTCHours(0, 0, 0, 0);
                    barTime = d.getTime();
                } else {
                    barTime = Math.floor(tickTime / tfMs) * tfMs;
                }

                // Check if tick includes matching candle data from MT5 terminal for THIS exact resolution
                const tickRes = String(tick.resolution || '').toUpperCase();
                const chartRes = String(resolution || '').toUpperCase();
                const isMatchingCandle = !!(tick.candle && (tickRes === chartRes || !tickRes));

                // Authoritative candle time from broker tick if matching candle provided
                const brokerCandleTime = (isMatchingCandle && tick.candle && tick.candle.time) ? alignTime(Number(tick.candle.time)) : null;
                const effectiveBarTime = (brokerCandleTime && brokerCandleTime >= barTime) ? brokerCandleTime : barTime;

                if (!lastBar) {
                    lastBar = {
                        time: effectiveBarTime,
                        open: (isMatchingCandle && tick.candle && tick.candle.open) ? Number(tick.candle.open) : price,
                        high: (isMatchingCandle && tick.candle && tick.candle.high) ? Math.max(Number(tick.candle.high), price) : price,
                        low: (isMatchingCandle && tick.candle && tick.candle.low) ? Math.min(Number(tick.candle.low), price) : price,
                        close: price,
                        volume: (isMatchingCandle && tick.candle && tick.candle.volume) ? Number(tick.candle.volume) : 1
                    };
                    window._tvLastBar[activeKey] = lastBar;
                    onRealtimeCallback({ ...lastBar });
                    return;
                }

                // Transition to new candle if interval has moved forward
                if (effectiveBarTime > lastBar.time) {
                    if (window.BarLimitManager) {
                        const genKey = `${(symbolInfo.ticker || symbolInfo.name || '').replace(/[^A-Za-z0-9_]/g, '')}_${resolution}`;
                        window.BarLimitManager.onLiveBarAdded(genKey);
                    }
                    if (tick.prev_candle && isMatchingCandle) {
                        const p = tick.prev_candle;
                        const pTime = alignTime(Number(p.time));
                        if (pTime === lastBar.time) {
                            lastBar.open = Number(p.open);
                            lastBar.high = Number(p.high);
                            lastBar.low = Number(p.low);
                            lastBar.close = Number(p.close);
                            lastBar.volume = Number(p.volume);
                            onRealtimeCallback({ ...lastBar });
                        }
                    }

                    lastBar = {
                        time: effectiveBarTime,
                        open: (isMatchingCandle && tick.candle && brokerCandleTime === effectiveBarTime) ? Number(tick.candle.open) : price,
                        high: (isMatchingCandle && tick.candle && brokerCandleTime === effectiveBarTime) ? Math.max(Number(tick.candle.high), price) : price,
                        low: (isMatchingCandle && tick.candle && brokerCandleTime === effectiveBarTime) ? Math.min(Number(tick.candle.low), price) : price,
                        close: price,
                        volume: (isMatchingCandle && tick.candle && brokerCandleTime === effectiveBarTime) ? Number(tick.candle.volume) : 1
                    };
                    window._tvLastBar[activeKey] = lastBar;
                    onRealtimeCallback({ ...lastBar });
                    return;
                }

                // Update active forming candle (never drop ticks!)
                if (isMatchingCandle && tick.candle && brokerCandleTime === lastBar.time) {
                    lastBar.open = Number(tick.candle.open) || lastBar.open;
                    lastBar.high = Math.max(lastBar.high, Number(tick.candle.high), price);
                    lastBar.low = Math.min(lastBar.low, Number(tick.candle.low), price);
                    lastBar.close = price;
                    lastBar.volume = Number(tick.candle.volume) || (lastBar.volume || 0) + 1;
                } else {
                    lastBar.high = Math.max(lastBar.high, price);
                    lastBar.low = Math.min(lastBar.low, price);
                    lastBar.close = price;
                    lastBar.volume = (lastBar.volume || 0) + (tick.volume || 1);
                }

                onRealtimeCallback({ ...lastBar });
            };

            window.MT5API.subscribeQuotes(cleanSym, resolution, mt5Cb);
            if (!window._mt5Subscribers) window._mt5Subscribers = new Map();
            window._mt5Subscribers.set(subscriberUID, { symbol: cleanSym, cb: mt5Cb });
            return;
        }

        if (!window.FyersAPI) return;
        
        let fyersSymbol = symbolInfo.name;
        if (!symbolInfo.isLive) {
            fyersSymbol = `${symbolInfo.exchange}:${symbolInfo.name}`;
        }
        
        if (!window._tvSubscribers) window._tvSubscribers = new Map();
        
        const resString = resolution ? resolution.toString() : '';
        const sfx = resolution ? resolutionToSuffix(resolution) : '';
        const isDWM = resString.includes('D') || resString.includes('W') || resString.includes('M') || sfx === 'D';
        const getFyersResolutionMs = (res) => {
            const r = String(res).toUpperCase();
            if (r === 'D' || r === '1D') return 86400 * 1000;
            if (r === 'W' || r === '1W') return 7 * 86400 * 1000;
            if (r === 'M' || r === '1M') return 30 * 86400 * 1000;
            const m = parseInt(r, 10);
            return (!isNaN(m) && m > 0) ? m * 60 * 1000 : 5 * 60 * 1000;
        };
        const tfMs = getFyersResolutionMs(resolution);
        
        const cb = (tick) => {
            let alignedTick = { ...tick };
            const cacheKey = `${fyersSymbol}_${resolution}`;
            
            // Filter real-time ticks outside the configured dataset session
            if (window.DatasetTimingManager && typeof window.DatasetTimingManager.isBarAllowed === 'function') {
                if (!window.DatasetTimingManager.isBarAllowed(alignedTick.time, resolution, symbolInfo)) {
                    return;
                }
            }
            
            const rawTickTime = Number(alignedTick.time) || Date.now();
            let barTime;
            if (isDWM) {
                const d = new Date(rawTickTime);
                d.setUTCHours(0, 0, 0, 0);
                barTime = d.getTime();
            } else {
                barTime = Math.floor(rawTickTime / tfMs) * tfMs;
            }
            
            if (!window._tvLastBar) window._tvLastBar = {};
            let lastBar = window._tvLastBar[cacheKey];
            
            if (!lastBar) {
                lastBar = {
                    time: barTime,
                    open: alignedTick.close,
                    high: alignedTick.close,
                    low: alignedTick.close,
                    close: alignedTick.close,
                    volume: alignedTick.volume || 0
                };
                window._tvLastBar[cacheKey] = lastBar;
                onRealtimeCallback({ ...lastBar });
                return;
            }
            
            // Advance to new candle if interval has moved forward
            if (barTime > lastBar.time) {
                if (window.BarLimitManager) {
                    const genKey = `${(symbolInfo.ticker || symbolInfo.name || '').replace(/[^A-Za-z0-9_]/g, '')}_${resolution}`;
                    window.BarLimitManager.onLiveBarAdded(genKey);
                }
                lastBar = {
                    time: barTime,
                    open: alignedTick.close,
                    high: alignedTick.close,
                    low: alignedTick.close,
                    close: alignedTick.close,
                    volume: alignedTick.volume || 0
                };
                window._tvLastBar[cacheKey] = lastBar;
            } else {
                // Update forming candle (never drop)
                if (isDWM) {
                    lastBar.open = alignedTick.open || lastBar.open;
                    lastBar.high = Math.max(lastBar.high, alignedTick.high || alignedTick.close);
                    lastBar.low = Math.min(lastBar.low, alignedTick.low || alignedTick.close);
                } else {
                    lastBar.high = Math.max(lastBar.high, alignedTick.close);
                    lastBar.low = Math.min(lastBar.low, alignedTick.close);
                }
                lastBar.close = alignedTick.close;
                lastBar.volume = alignedTick.volume || lastBar.volume;
            }
            
            if (window.TradeUIInstance && typeof window.TradeUIInstance.onLivePriceUpdate === 'function') {
                window.TradeUIInstance.onLivePriceUpdate(alignedTick.close || (lastBar && lastBar.close), fyersSymbol, alignedTick.bid, alignedTick.ask);
            }

            if (window.WatchlistUI && typeof window.WatchlistUI.onLivePrice === 'function') {
                const fPrice = alignedTick.close || (lastBar && lastBar.close);
                window.WatchlistUI.onLivePrice(fyersSymbol, fPrice, alignedTick.daily_open || null, alignedTick.change !== undefined ? alignedTick.change : null);
            }
            
            onRealtimeCallback({ ...lastBar });
        };
        window._tvSubscribers.set(subscriberUID, { symbol: fyersSymbol, cb });
        window.FyersAPI.subscribe(fyersSymbol, cb, onResetCacheNeededCallback);
    },

    unsubscribeBars: (subscriberUID) => {
        DFLog.info('unsubscribeBars', `UID: ${subscriberUID}`);
        if (window._mt5Subscribers && window._mt5Subscribers.has(subscriberUID)) {
            const sub = window._mt5Subscribers.get(subscriberUID);
            const cb = (sub && sub.cb) ? sub.cb : sub;
            if (window.MT5API && cb) {
                window.MT5API.unsubscribeQuotes(cb);
            }
            window._mt5Subscribers.delete(subscriberUID);
            if (window._mt5ResetCallbacks) {
                window._mt5ResetCallbacks.delete(subscriberUID);
            }
            return;
        }
        if (window._tvSubscribers && window._tvSubscribers.has(subscriberUID)) {
            const sub = window._tvSubscribers.get(subscriberUID);
            if (window.FyersAPI) window.FyersAPI.unsubscribe(sub.symbol, sub.cb);
            window._tvSubscribers.delete(subscriberUID);
        }
    }
};

// Listen for Parquet database updates from Hugging Face
let tvReloadTimer = null;
window.addEventListener('hf_expiry_updated', () => {
    if (tvReloadTimer) clearTimeout(tvReloadTimer);
    tvReloadTimer = setTimeout(() => {
        console.log("[Datafeed] New Parquet file downloaded! Forcing TradingView to reload chart history...");
        if (window.FyersAPI && window.FyersAPI.subscribers) {
            window.FyersAPI.subscribers.forEach((subs, symbol) => {
                subs.forEach(sub => {
                    if (sub.resetCb) sub.resetCb();
                });
            });
        }
    }, 2000);
});
