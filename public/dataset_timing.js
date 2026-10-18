// -----------------------------------------------------------------------
// Dataset Timing & Session Filter Manager
// Multi-Exchange & Multi-Timezone support (NSE/MCX, OANDA Forex/Gold, Delta Crypto)
// Supports session timing presets, custom time ranges, timezone translation,
// single-ticker vs global scoping, and one-click deletion/clearing of selections.
// -----------------------------------------------------------------------

(function () {
    const STORAGE_KEY = 'tv_dataset_timing_settings';
    const STORAGE_VERSION = 2;

    const DEFAULT_GLOBAL = {
        enabled: false, // Deselected by default as requested
        timezone: 'Asia/Kolkata',
        startTime: '09:15',
        endTime: '15:30',
        filterDates: false,
        startDate: '',
        endDate: ''
    };

    const SUPPORTED_TIMEZONES = [
        { id: 'Asia/Kolkata', label: '🇮🇳 Asia/Kolkata (IST • UTC+05:30) — Indian Equities / MCX' },
        { id: 'UTC', label: '🌐 UTC (UTC+00:00) — Delta Exchange Crypto / Forex Reference' },
        { id: 'America/New_York', label: '🇺🇸 America/New_York (EST/EDT) — OANDA NY Session / US Equities' },
        { id: 'Europe/London', label: '🇬🇧 Europe/London (GMT/BST) — OANDA London Session / Gold' },
        { id: 'Asia/Tokyo', label: '🇯🇵 Asia/Tokyo (JST • UTC+09:00) — Asian Forex Session' },
        { id: 'Asia/Singapore', label: '🇸🇬 Asia/Singapore (SGT • UTC+08:00) — Singapore / Asian Crypto' },
        { id: 'Asia/Dubai', label: '🇦🇪 Asia/Dubai (GST • UTC+04:00) — Dubai / Middle East Hub' }
    ];

    const MARKET_CATEGORIES = [
        { id: 'indian', name: '🇮🇳 Indian (NSE/MCX)' },
        { id: 'oanda', name: '🌍 OANDA (Forex/Gold)' },
        { id: 'delta', name: '⚡ Delta (Crypto)' }
    ];

    const PRESETS = [
        // 🇮🇳 Indian Markets (NSE / BSE / MCX)
        {
            id: 'nse_full',
            category: 'indian',
            name: 'NSE Full Session',
            market: 'NSE / BSE',
            tz: 'Asia/Kolkata',
            start: '09:15',
            end: '15:30',
            desc: '09:15 – 15:30 IST (75 bars/day)',
            color: '#2962FF'
        },
        {
            id: 'nse_cutoff',
            category: 'indian',
            name: 'NSE Early Cutoff / MIS',
            market: 'NSE / BSE',
            tz: 'Asia/Kolkata',
            start: '09:15',
            end: '15:10',
            desc: '09:15 – 15:10 IST (72 bars/day)',
            color: '#e65100'
        },
        {
            id: 'nse_morning',
            category: 'indian',
            name: 'NSE Morning Momentum',
            market: 'NSE / BSE',
            tz: 'Asia/Kolkata',
            start: '09:15',
            end: '11:30',
            desc: '09:15 – 11:30 IST (Opening momentum)',
            color: '#7b1fa2'
        },
        {
            id: 'mcx_full',
            category: 'indian',
            name: 'MCX Full Commodity',
            market: 'MCX',
            tz: 'Asia/Kolkata',
            start: '09:00',
            end: '23:30',
            desc: '09:00 – 23:30 IST (Full commodity)',
            color: '#00897b'
        },
        {
            id: 'mcx_evening',
            category: 'indian',
            name: 'MCX Evening (US Open)',
            market: 'MCX',
            tz: 'Asia/Kolkata',
            start: '17:00',
            end: '23:30',
            desc: '17:00 – 23:30 IST (Gold/Crude US session)',
            color: '#d81b60'
        },

        // 🌍 OANDA (Forex & Metals / XAUUSD)
        {
            id: 'oanda_xauusd_ist',
            category: 'oanda',
            name: 'OANDA XAUUSD (Gold IST)',
            market: 'OANDA / XAUUSD',
            tz: 'Asia/Kolkata',
            start: '03:30',
            end: '02:30',
            desc: '03:30 AM – 02:30 AM IST (23h trading • 1h rollover break)',
            color: '#b8860b'
        },
        {
            id: 'oanda_23h_ny',
            category: 'oanda',
            name: 'OANDA 23h Session (NY Time)',
            market: 'OANDA / Metals & FX',
            tz: 'America/New_York',
            start: '18:00',
            end: '17:00',
            desc: '18:00 – 17:00 NY (5 PM ET rollover break)',
            color: '#2e7d32'
        },
        {
            id: 'oanda_oil_ist',
            category: 'oanda',
            name: 'OANDA Oil / Brent (IST)',
            market: 'OANDA / WTICO / BCO',
            tz: 'Asia/Kolkata',
            start: '05:30',
            end: '03:30',
            desc: '05:30 AM – 03:30 AM IST (22h commodity session)',
            color: '#c2185b'
        },
        {
            id: 'oanda_us_cash',
            category: 'oanda',
            name: 'US Equities Cash (IST)',
            market: 'OANDA / US30 / NAS100',
            tz: 'Asia/Kolkata',
            start: '19:00',
            end: '01:30',
            desc: '19:00 – 01:30 IST (09:30 – 16:00 ET Wall St cash)',
            color: '#00897b'
        },
        {
            id: 'oanda_london',
            category: 'oanda',
            name: 'London Session',
            market: 'OANDA / FX / Gold',
            tz: 'Europe/London',
            start: '08:00',
            end: '16:30',
            desc: '08:00 – 16:30 London (Primary European liquidity)',
            color: '#1976d2'
        },
        {
            id: 'oanda_ny',
            category: 'oanda',
            name: 'New York Session',
            market: 'OANDA / US Equities',
            tz: 'America/New_York',
            start: '08:00',
            end: '17:00',
            desc: '08:00 – 17:00 NY (Wall St & US Cash session)',
            color: '#388e3c'
        },
        {
            id: 'oanda_overlap',
            category: 'oanda',
            name: 'London + NY Overlap',
            market: 'OANDA / XAUUSD',
            tz: 'Europe/London',
            start: '13:00',
            end: '17:00',
            desc: '13:00 – 17:00 London (Peak Gold & FX volume)',
            color: '#f57c00'
        },
        {
            id: 'oanda_tokyo',
            category: 'oanda',
            name: 'Asian / Tokyo Session',
            market: 'OANDA / Asian FX',
            tz: 'Asia/Tokyo',
            start: '00:00',
            end: '09:00',
            desc: '00:00 – 09:00 Tokyo (Asian liquidity & range)',
            color: '#8e24aa'
        },
        {
            id: 'oanda_24h',
            category: 'oanda',
            name: '24-Hour Forex / CFD',
            market: 'OANDA 24h',
            tz: 'UTC',
            start: '00:00',
            end: '24:00',
            desc: '00:00 – 24:00 UTC (Unrestricted all-day)',
            color: '#546e7a'
        },

        // ⚡ Delta Exchange (Crypto)
        {
            id: 'delta_247',
            category: 'delta',
            name: '24/7 Full Crypto',
            market: 'Delta / Crypto',
            tz: 'UTC',
            start: '00:00',
            end: '24:00',
            desc: '00:00 – 24:00 UTC (Full round-the-clock)',
            color: '#3949ab'
        },
        {
            id: 'delta_settlement',
            category: 'delta',
            name: 'Delta Daily Settlement',
            market: 'Delta Exchange',
            tz: 'UTC',
            start: '12:00',
            end: '12:00',
            desc: '12:00 – 12:00 UTC (Delta 24h cycle • 17:30 IST)',
            color: '#00acc1'
        },
        {
            id: 'delta_us',
            category: 'delta',
            name: 'US Crypto Trading Hours',
            market: 'Delta / Crypto',
            tz: 'UTC',
            start: '13:30',
            end: '20:00',
            desc: '13:30 – 20:00 UTC (09:30 – 16:00 ET cash hours)',
            color: '#fb8c00'
        },
        {
            id: 'delta_asia',
            category: 'delta',
            name: 'Asian Crypto Hours',
            market: 'Delta / Crypto',
            tz: 'UTC',
            start: '00:00',
            end: '08:00',
            desc: '00:00 – 08:00 UTC (Asian morning crypto volume)',
            color: '#5e35b1'
        }
    ];

    function normalizeSymbol(sym) {
        if (!sym || typeof sym !== 'string') return '';
        let s = sym.trim();
        if (s.includes('|')) s = s.split('|')[0];
        if (s.includes(':')) s = s.split(':')[1];
        return s.toUpperCase();
    }

    // High performance timezone minute extractor with daylight saving time caching
    function getTimezoneMinsExtractor(tz) {
        if (!tz || tz === 'UTC') {
            return (tNum) => {
                const d = new Date(tNum);
                return d.getUTCHours() * 60 + d.getUTCMinutes();
            };
        }
        if (tz === 'Asia/Kolkata') {
            return (tNum) => {
                const d = new Date(tNum + 19800000);
                return d.getUTCHours() * 60 + d.getUTCMinutes();
            };
        }
        if (tz === 'Asia/Tokyo') {
            return (tNum) => {
                const d = new Date(tNum + 32400000);
                return d.getUTCHours() * 60 + d.getUTCMinutes();
            };
        }
        if (tz === 'Asia/Singapore') {
            return (tNum) => {
                const d = new Date(tNum + 28800000);
                return d.getUTCHours() * 60 + d.getUTCMinutes();
            };
        }
        if (tz === 'Asia/Dubai') {
            return (tNum) => {
                const d = new Date(tNum + 14400000);
                return d.getUTCHours() * 60 + d.getUTCMinutes();
            };
        }

        // Dynamic timezones with DST (e.g. America/New_York, Europe/London):
        let dtf;
        try {
            dtf = new Intl.DateTimeFormat('en-US', {
                timeZone: tz,
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                hour12: false
            });
        } catch (_) {
            dtf = new Intl.DateTimeFormat('en-US', {
                timeZone: 'UTC',
                hour: 'numeric',
                minute: 'numeric',
                hour12: false
            });
        }

        const offsetCache = new Map();
        return (tNum) => {
            const dayKey = Math.floor(tNum / 86400000);
            let offsetMs = offsetCache.get(dayKey);
            if (offsetMs === undefined) {
                const sampleDate = new Date(tNum);
                const parts = dtf.formatToParts(sampleDate);
                let h = 0, m = 0;
                for (let i = 0; i < parts.length; i++) {
                    if (parts[i].type === 'hour') h = parseInt(parts[i].value, 10);
                    if (parts[i].type === 'minute') m = parseInt(parts[i].value, 10);
                }
                if (h === 24) h = 0;
                const tzMins = h * 60 + m;
                const utcMins = sampleDate.getUTCHours() * 60 + sampleDate.getUTCMinutes();
                let diffMins = tzMins - utcMins;
                if (diffMins > 720) diffMins -= 1440;
                if (diffMins < -720) diffMins += 1440;
                offsetMs = diffMins * 60000;
                offsetCache.set(dayKey, offsetMs);
            }
            const localDate = new Date(tNum + offsetMs);
            return localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
        };
    }

    // Bulletproof time parser handling 24h ("15:10", "24:00") and 12h AM/PM ("03:10 PM", "3:10 PM")
    function parseTimeMins(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') return null;
        const clean = timeStr.trim();
        if (clean === '24:00') return 1440;

        const isPM = /pm/i.test(clean);
        const isAM = /am/i.test(clean);

        const timeOnly = clean.replace(/[^0-9:]/g, '');
        const parts = timeOnly.split(':');
        if (parts.length < 2) return null;

        let h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (isNaN(h) || isNaN(m)) return null;

        if (isPM && h < 12) {
            h += 12;
        } else if (isAM && h === 12) {
            h = 0;
        }

        return h * 60 + m;
    }

    function formatTimeDisplay(mins) {
        if (mins === null || isNaN(mins)) return '';
        if (mins >= 1440) return '24:00';
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        const pad = (n) => (n < 10 ? '0' + n : '' + n);
        return `${pad(h)}:${pad(m)}`;
    }

    class DatasetTimingManager {
        constructor() {
            this.storageKey = STORAGE_KEY;
            this.btnId = 'btn-dataset-timing';
            this.modalId = 'dataset-timing-modal';
            this.loadSettings();
        }

        loadSettings() {
            try {
                const raw = localStorage.getItem(this.storageKey);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    // Migrate from v1 or clean defaults: default must be deselected (enabled: false)
                    if (!parsed.version || parsed.version < STORAGE_VERSION) {
                        this.data = {
                            version: STORAGE_VERSION,
                            global: { ...DEFAULT_GLOBAL },
                            symbols: {}
                        };
                        this.saveSettings();
                    } else {
                        this.data = parsed;
                    }
                } else {
                    this.data = {
                        version: STORAGE_VERSION,
                        global: { ...DEFAULT_GLOBAL },
                        symbols: {}
                    };
                }
            } catch (e) {
                console.warn('[DatasetTiming] Failed to parse localStorage settings, using defaults.', e);
                this.data = {
                    version: STORAGE_VERSION,
                    global: { ...DEFAULT_GLOBAL },
                    symbols: {}
                };
            }
            if (!this.data.global) this.data.global = { ...DEFAULT_GLOBAL };
            if (!this.data.symbols) this.data.symbols = {};
        }

        saveSettings() {
            try {
                this.data.version = STORAGE_VERSION;
                localStorage.setItem(this.storageKey, JSON.stringify(this.data));
            } catch (e) {
                console.error('[DatasetTiming] Failed to save settings to localStorage:', e);
            }
        }

        getActiveSymbol() {
            try {
                if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
                    const chart = window.tvWidget.activeChart();
                    if (chart && typeof chart.symbol === 'function') {
                        return chart.symbol();
                    }
                }
            } catch (_) {}
            return 'NIFTY50-INDEX';
        }

        getSettingsForSymbol(symbolName, isMcx) {
            const rawSym = symbolName || this.getActiveSymbol();
            const normSym = normalizeSymbol(rawSym);

            if (this.data.symbols) {
                if (normSym && this.data.symbols[normSym] && typeof this.data.symbols[normSym].enabled === 'boolean') {
                    return { ...this.data.symbols[normSym], isSymbolSpecific: true, symbol: normSym };
                }
                if (rawSym && this.data.symbols[rawSym] && typeof this.data.symbols[rawSym].enabled === 'boolean') {
                    return { ...this.data.symbols[rawSym], isSymbolSpecific: true, symbol: rawSym };
                }
            }

            if (this.data.global && this.data.global.enabled) {
                return { ...this.data.global, isSymbolSpecific: false, symbol: normSym };
            }

            // Deselected / Disabled by default
            return {
                enabled: false,
                timezone: isMcx ? 'Asia/Kolkata' : 'Asia/Kolkata',
                startTime: isMcx ? '09:00' : '09:15',
                endTime: isMcx ? '23:30' : '15:30',
                filterDates: false,
                startDate: '',
                endDate: '',
                isSymbolSpecific: false,
                symbol: normSym
            };
        }

        filterBars(bars, resolution, symbolInfo, isMcx) {
            if (!bars || bars.length === 0) return bars;
            const symName = symbolInfo ? symbolInfo.name : this.getActiveSymbol();
            const isMcxSymbol = isMcx !== undefined ? isMcx : (symbolInfo && (symbolInfo.exchange === 'MCX' || (symbolInfo.name && (symbolInfo.name.includes('CRUDE') || symbolInfo.name.includes('GOLD') || symbolInfo.name.includes('SILVER') || symbolInfo.name.includes('NATURALGAS')))));

            const settings = this.getSettingsForSymbol(symName, isMcxSymbol);
            // ONLY filter if explicitly selected and enabled by user!
            if (!settings || !settings.enabled) return bars;

            const resString = resolution ? resolution.toString() : '';
            const isDWM = resString.includes('D') || resString.includes('W') || resString.includes('M') || resolution === 'D' || resolution === '1D';

            const tz = settings.timezone || (isMcxSymbol ? 'Asia/Kolkata' : 'Asia/Kolkata');
            const extractor = getTimezoneMinsExtractor(tz);

            const startMins = parseTimeMins(settings.startTime) ?? (isMcxSymbol ? 540 : 555);
            const endMins = parseTimeMins(settings.endTime) ?? (isMcxSymbol ? 1410 : 930);

            // Optional calendar date filter
            let startTs = null;
            let endTs = null;
            if (settings.filterDates) {
                if (settings.startDate) {
                    const d = new Date(settings.startDate + 'T00:00:00Z');
                    if (!isNaN(d.getTime())) startTs = d.getTime();
                }
                if (settings.endDate) {
                    const d = new Date(settings.endDate + 'T23:59:59.999Z');
                    if (!isNaN(d.getTime())) endTs = d.getTime();
                }
            }

            const isFullDay = (startMins === endMins) || (startMins === 0 && endMins >= 1440);

            const filtered = [];
            for (let i = 0; i < bars.length; i++) {
                const b = bars[i];
                const tNum = Number(b.time);

                // Date filter check
                if (startTs !== null && tNum < startTs) continue;
                if (endTs !== null && tNum > endTs) continue;

                if (!isDWM && !isFullDay) {
                    const mins = extractor(tNum);
                    let allowed = false;
                    if (startMins < endMins) {
                        allowed = (mins >= startMins && mins < endMins);
                    } else {
                        // Overnight session (e.g. 17:00 to 03:30 across midnight)
                        allowed = (mins >= startMins || mins < endMins);
                    }
                    if (!allowed) continue;
                }

                filtered.push(b);
            }
            return filtered;
        }

        isBarAllowed(barTimeMs, resolution, symbolInfo) {
            const symName = symbolInfo ? symbolInfo.name : this.getActiveSymbol();
            const isMcx = symbolInfo && (symbolInfo.exchange === 'MCX' || (symbolInfo.name && (symbolInfo.name.includes('CRUDE') || symbolInfo.name.includes('GOLD') || symbolInfo.name.includes('SILVER'))));
            const settings = this.getSettingsForSymbol(symName, isMcx);
            if (!settings || !settings.enabled) return true;

            const res = this.filterBars([{ time: barTimeMs }], resolution, symbolInfo, isMcx);
            return res.length > 0;
        }

        // Header toolbar button: clean, natural button matching TradingView's native Option Chain button
        injectButton(targetEl, iframeDoc) {
            if (!iframeDoc || iframeDoc.getElementById(this.btnId)) return;

            const sym = this.getActiveSymbol();
            const normSym = normalizeSymbol(sym);
            const isMcx = normSym.includes('CRUDE') || normSym.includes('GOLD') || normSym.includes('SILVER') || normSym.includes('NATURALGAS');
            const settings = this.getSettingsForSymbol(normSym, isMcx);
            const isActive = !!settings.enabled;

            const btnHtml = `
            <div class="group-MBOVGQRI" id="header-toolbar-dataset-timing" style="margin: 0 4px;">
                <button aria-label="Dataset Timing" data-role="button" data-tooltip="Dataset Timing" tabindex="-1" type="button" 
                    class="button-OhqNVIYA button-ptpAHg8E button-GwQQdU8S apply-common-tooltip isInteractive-GwQQdU8S accessible-GwQQdU8S" 
                    id="${this.btnId}" style="${isActive ? 'color: #2962FF;' : ''}">
                    <span role="img" class="icon-GwQQdU8S" aria-hidden="true" style="position: relative;">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="none">
                            <circle cx="14" cy="14" r="7.5" stroke="currentColor" stroke-width="1.2"></circle>
                            <path stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" d="M14 10v4.5l3 2"></path>
                        </svg>
                        <span id="dt-btn-dot" style="position: absolute; top: 4px; right: 4px; width: 5px; height: 5px; border-radius: 50%; background: #2962FF; pointer-events: none; display: ${isActive ? 'block' : 'none'};"></span>
                    </span>
                </button>
            </div>
            `;
            targetEl.insertAdjacentHTML('afterend', btnHtml);

            const btn = iframeDoc.getElementById(this.btnId);
            if (btn) {
                btn.addEventListener('click', () => this.showModal());

                // Match Option Chain tooltip listener behavior
                btn.addEventListener('mouseenter', () => {
                    btn.setAttribute('title', this.getTooltipText());
                });
                btn.addEventListener('mouseleave', () => {
                    btn.removeAttribute('title');
                });
            }

            // Sync with symbol changes on active chart
            try {
                if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
                    const chart = window.tvWidget.activeChart();
                    if (chart && typeof chart.onSymbolChanged === 'function') {
                        chart.onSymbolChanged().subscribe(null, () => {
                            this.updateButtonLabel();
                        });
                    }
                }
            } catch (_) {}
        }

        getTooltipText() {
            const sym = this.getActiveSymbol();
            const normSym = normalizeSymbol(sym);
            const isMcx = normSym.includes('CRUDE') || normSym.includes('GOLD') || normSym.includes('SILVER') || normSym.includes('NATURALGAS');
            const settings = this.getSettingsForSymbol(normSym, isMcx);
            if (settings && settings.enabled) {
                const target = settings.isSymbolSpecific ? normSym : 'Global';
                return `Dataset Timing: Active (${settings.startTime}–${settings.endTime} ${settings.timezone || 'IST'})  [${target}]`;
            }
            return `Dataset Timing: Deselected / Off (${normSym})`;
        }

        updateButtonLabel() {
            const iframe = document.querySelector('iframe[id^="tradingview_"]');
            if (!iframe) return;
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            if (!iframeDoc) return;

            const btn = iframeDoc.getElementById(this.btnId);
            const dot = iframeDoc.getElementById('dt-btn-dot');
            if (!btn) return;

            const sym = this.getActiveSymbol();
            const normSym = normalizeSymbol(sym);
            const isMcx = normSym.includes('CRUDE') || normSym.includes('GOLD') || normSym.includes('SILVER') || normSym.includes('NATURALGAS');
            const settings = this.getSettingsForSymbol(normSym, isMcx);
            const isActive = !!settings.enabled;

            btn.setAttribute('data-tooltip', this.getTooltipText());
            btn.style.color = isActive ? '#2962FF' : '';
            if (dot) dot.style.display = isActive ? 'block' : 'none';
        }

        applyAndReload() {
            // 1. Clear in-memory bar cache
            if (window._tvLastBar) {
                window._tvLastBar = {};
            }

            // 2. Invoke TradingView's official datafeed cache reset
            if (typeof window._tvResetCache === 'function') {
                try {
                    window._tvResetCache();
                } catch (e) {
                    console.warn('[DatasetTiming] _tvResetCache failed:', e);
                }
            }

            // 3. Reset main series on active chart to force fresh retrieval
            if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
                const chart = window.tvWidget.activeChart();
                try {
                    if (chart._chartWidget && chart._chartWidget.model && chart._chartWidget.model().mainSeries) {
                        const ms = chart._chartWidget.model().mainSeries();
                        if (ms && typeof ms.clearData === 'function') {
                            ms.clearData();
                        }
                    }
                } catch (_) {}

                try {
                    if (typeof chart.resetData === 'function') {
                        chart.resetData();
                    }
                } catch (_) {}

                try {
                    const sym = chart.symbol ? chart.symbol() : (window.tvWidget.symbolInterval ? window.tvWidget.symbolInterval().symbol : null);
                    const res = chart.resolution ? chart.resolution() : (window.tvWidget.symbolInterval ? window.tvWidget.symbolInterval().interval : null);
                    if (sym && res && typeof window.tvWidget.setSymbol === 'function') {
                        window.tvWidget.setSymbol(sym, res, () => {});
                    }
                } catch (_) {}
            }
        }

        showModal() {
            let modal = document.getElementById(this.modalId);
            const sym = this.getActiveSymbol();
            const normSym = normalizeSymbol(sym);
            const isMcx = normSym.includes('CRUDE') || normSym.includes('GOLD') || normSym.includes('SILVER') || normSym.includes('NATURALGAS');
            const isForexGold = normSym.includes('XAU') || normSym.includes('EUR') || normSym.includes('USD') || normSym.includes('GBP') || normSym.includes('JPY');
            const isCrypto = normSym.includes('BTC') || normSym.includes('ETH') || normSym.includes('SOL') || normSym.includes('USDT');

            const currentSettings = this.getSettingsForSymbol(normSym, isMcx);
            const hasActiveFilter = !!currentSettings.enabled;

            // Default scope is ALWAYS Current Symbol Only as requested
            let activeScope = 'symbol';
            // Determine active market category tab
            let activeTab = isCrypto ? 'delta' : (isForexGold ? 'oanda' : 'indian');

            if (!modal) {
                modal = document.createElement('div');
                modal.id = this.modalId;
                modal.style.cssText = `
                    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                    background: rgba(19, 23, 34, 0.6); z-index: 999999;
                    display: flex; align-items: center; justify-content: center;
                    backdrop-filter: blur(4px); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                `;
                document.body.appendChild(modal);
            }

            modal.innerHTML = `
                <div style="background: #ffffff; border-radius: 12px; width: 620px; max-width: 95vw; max-height: 88vh; display: flex; flex-direction: column; box-shadow: 0 20px 48px rgba(0,0,0,0.22); overflow: hidden; animation: dtFadeIn 0.15s ease-out;">
                    <!-- Header -->
                    <div style="padding: 18px 22px; border-bottom: 1px solid #e5e8f0; display: flex; align-items: center; justify-content: space-between; background: #fafbfc;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div style="width: 34px; height: 34px; border-radius: 8px; background: #edf4ff; display: flex; align-items: center; justify-content: center; color: #2962FF;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                            </div>
                            <div>
                                <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #131722; line-height: 1.2;">Dataset Timing & Session Filter</h3>
                                <div style="font-size: 12px; color: #787b86; margin-top: 2px;">Filter session hours & timezones for Indian Equities, OANDA & Delta Crypto</div>
                            </div>
                        </div>
                        <button id="dt-modal-close" style="background: transparent; border: none; font-size: 20px; color: #787b86; cursor: pointer; padding: 4px 8px; border-radius: 4px;">&times;</button>
                    </div>

                    <!-- Body -->
                    <div style="padding: 20px 22px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px;">
                        
                        <!-- Status Banner -->
                        <div id="dt-status-banner" style="padding: 10px 14px; border-radius: 8px; font-size: 12.5px; display: flex; align-items: center; justify-content: space-between; ${hasActiveFilter ? 'background: #eef5ff; border: 1px solid #b9d5ff; color: #1557bf;' : 'background: #f4f6fa; border: 1px solid #e0e3eb; color: #5d606b;'}">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${hasActiveFilter ? '#2962FF' : '#9598a1'};"></span>
                                <span id="dt-status-text">
                                    ${hasActiveFilter 
                                        ? `<strong>Filter Active:</strong> ${currentSettings.startTime}–${currentSettings.endTime} (${currentSettings.timezone || 'Asia/Kolkata'}) on <strong>${currentSettings.isSymbolSpecific ? normSym : 'All Symbols'}</strong>` 
                                        : `<strong>Filter Deselected:</strong> Displaying all candles unrestricted without timing cutoff.`}
                                </span>
                            </div>
                            ${hasActiveFilter ? `<span style="font-size: 11px; font-weight: 700; background: #2962FF; color: #fff; padding: 2px 7px; border-radius: 4px;">ACTIVE</span>` : `<span style="font-size: 11px; font-weight: 600; color: #787b86;">UNFILTERED</span>`}
                        </div>

                        <!-- Scope Selection: Defaults to Current Symbol Only -->
                        <div>
                            <label style="display: block; font-size: 11px; font-weight: 700; color: #787b86; letter-spacing: 0.5px; margin-bottom: 6px;">APPLY FILTER TO</label>
                            <div style="background: #f0f3fa; border-radius: 8px; padding: 4px; display: flex; gap: 4px;">
                                <button type="button" id="dt-scope-symbol" style="flex: 1; padding: 8px 12px; font-size: 12.5px; font-weight: 700; border: none; border-radius: 6px; cursor: pointer; transition: all 0.15s; background: #ffffff; color: #2962FF; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                                    🎯 ${normSym} Only <span style="font-size: 11px; font-weight: 500; color: #2962FF;">(Default)</span>
                                </button>
                                <button type="button" id="dt-scope-global" style="flex: 1; padding: 8px 12px; font-size: 12.5px; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; transition: all 0.15s; background: transparent; color: #5d606b;">
                                    🌐 All Symbols (Global)
                                </button>
                            </div>
                        </div>

                        <!-- Timezone Selector -->
                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <label style="font-size: 11px; font-weight: 700; color: #787b86; letter-spacing: 0.5px;">EXCHANGE / MARKET TIMEZONE</label>
                                <span style="font-size: 11px; color: #2962FF; font-weight: 600;">Auto-syncs with presets</span>
                            </div>
                            <select id="dt-timezone" style="width: 100%; padding: 9px 12px; font-size: 13px; font-weight: 600; color: #131722; border: 1.5px solid #d1d4dc; border-radius: 8px; background: #ffffff; cursor: pointer; outline: none;">
                                ${SUPPORTED_TIMEZONES.map(tz => `<option value="${tz.id}" ${tz.id === (currentSettings.timezone || 'Asia/Kolkata') ? 'selected' : ''}>${tz.label}</option>`).join('')}
                            </select>
                        </div>

                        <!-- Presets with Market Category Tabs -->
                        <div>
                            <label style="display: block; font-size: 11px; font-weight: 700; color: #787b86; letter-spacing: 0.5px; margin-bottom: 8px;">QUICK MARKET SESSION PRESETS</label>
                            
                            <!-- Market Tabs -->
                            <div style="display: flex; gap: 6px; margin-bottom: 10px; border-bottom: 1.5px solid #e0e3eb; padding-bottom: 6px;">
                                ${MARKET_CATEGORIES.map(cat => `
                                    <button type="button" class="dt-market-tab" data-cat-id="${cat.id}" style="padding: 6px 12px; font-size: 12px; font-weight: 700; border: none; border-radius: 6px; cursor: pointer; transition: all 0.15s; ${cat.id === activeTab ? 'background: #edf4ff; color: #2962FF;' : 'background: transparent; color: #5d606b;'}">
                                        ${cat.name}
                                    </button>
                                `).join('')}
                            </div>

                            <!-- Preset Cards Grid -->
                            <div id="dt-presets-container" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; max-height: 255px; overflow-y: auto; padding-right: 4px;">
                                ${PRESETS.map(p => `
                                    <div class="dt-preset-card" data-preset-id="${p.id}" data-category="${p.category}" data-start="${p.start}" data-end="${p.end}" data-tz="${p.tz}" 
                                        style="display: ${p.category === activeTab ? 'block' : 'none'}; border: 1.5px solid #d1d4dc; border-radius: 8px; padding: 10px 12px; cursor: pointer; transition: all 0.15s; position: relative; background: #ffffff;">
                                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                                            <span style="font-size: 12.5px; font-weight: 700; color: #131722;">${p.name}</span>
                                            <span class="dt-preset-badge" style="display: none; font-size: 10px; font-weight: 800; color: #2962FF; background: #dbeafe; padding: 2px 6px; border-radius: 4px;">✓ SELECTED</span>
                                        </div>
                                        <div style="font-size: 13px; font-weight: 800; color: ${p.color};">${p.start} – ${p.end}</div>
                                        <div style="font-size: 11px; color: #787b86; margin-top: 3px;">${p.desc}</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <!-- Custom Time Inputs -->
                        <div style="border: 1.5px solid #e0e3eb; border-radius: 8px; padding: 12px 16px; background: #ffffff;">
                            <label style="display: block; font-size: 11px; font-weight: 700; color: #787b86; letter-spacing: 0.5px; margin-bottom: 8px;">CUSTOM SESSION TIMING</label>
                            <div style="display: flex; align-items: center; gap: 14px;">
                                <div style="flex: 1;">
                                    <label style="display: block; font-size: 11px; font-weight: 700; color: #5d606b; margin-bottom: 4px;">START TIME (HH:MM)</label>
                                    <input type="time" id="dt-start-time" value="${currentSettings.startTime || '09:15'}" style="width: 100%; padding: 8px 10px; font-size: 13px; font-weight: 700; color: #131722; border: 1.5px solid #d1d4dc; border-radius: 6px; box-sizing: border-box;">
                                </div>
                                <div style="font-size: 18px; color: #9598a1; font-weight: bold; margin-top: 18px;">&rarr;</div>
                                <div style="flex: 1;">
                                    <label style="display: block; font-size: 11px; font-weight: 700; color: #5d606b; margin-bottom: 4px;">END TIME (HH:MM)</label>
                                    <input type="time" id="dt-end-time" value="${currentSettings.endTime || '15:30'}" style="width: 100%; padding: 8px 10px; font-size: 13px; font-weight: 700; color: #131722; border: 1.5px solid #d1d4dc; border-radius: 6px; box-sizing: border-box;">
                                </div>
                            </div>
                            <div id="dt-live-explain-banner" style="margin-top: 10px; padding: 8px 12px; background: #edf4ff; border-left: 3px solid #2962FF; border-radius: 4px; font-size: 12px; color: #1557bf; line-height: 1.4;">
                            </div>
                        </div>

                        <!-- Date Range Filtering (Optional) -->
                        <div style="border: 1.5px solid #e0e3eb; border-radius: 8px; padding: 12px 16px;">
                            <label style="display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 700; color: #131722; cursor: pointer; user-select: none;">
                                <input type="checkbox" id="dt-filter-dates" ${currentSettings.filterDates ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer; accent-color: #2962FF;">
                                Filter Historical Calendar Dates (Optional)
                            </label>
                            <div id="dt-date-inputs" style="display: ${currentSettings.filterDates ? 'flex' : 'none'}; align-items: center; gap: 14px; margin-top: 10px;">
                                <div style="flex: 1;">
                                    <label style="display: block; font-size: 11px; font-weight: 700; color: #787b86; margin-bottom: 4px;">FROM DATE</label>
                                    <input type="date" id="dt-start-date" value="${currentSettings.startDate || ''}" style="width: 100%; padding: 7px 10px; font-size: 13px; border: 1.5px solid #d1d4dc; border-radius: 6px; box-sizing: border-box;">
                                </div>
                                <div style="font-size: 18px; color: #9598a1; font-weight: bold; margin-top: 18px;">&rarr;</div>
                                <div style="flex: 1;">
                                    <label style="display: block; font-size: 11px; font-weight: 700; color: #787b86; margin-bottom: 4px;">TO DATE</label>
                                    <input type="date" id="dt-end-date" value="${currentSettings.endDate || ''}" style="width: 100%; padding: 7px 10px; font-size: 13px; border: 1.5px solid #d1d4dc; border-radius: 6px; box-sizing: border-box;">
                                </div>
                            </div>
                        </div>

                    </div>

                    <!-- Footer -->
                    <div style="padding: 16px 22px; border-top: 1px solid #e5e8f0; display: flex; align-items: center; justify-content: space-between; background: #fafbfc;">
                        <!-- Delete Selection Button: Deselects/deletes filter and shows all raw candles -->
                        <button id="dt-btn-delete" title="Delete filter selection for this ticker and restore all candles" style="padding: 9px 16px; font-size: 13px; font-weight: 700; color: #d32f2f; background: #fff5f5; border: 1.5px solid #ffcdd2; border-radius: 6px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 6px;">
                            <span>🗑</span> Delete Selection
                        </button>
                        <div style="display: flex; gap: 12px;">
                            <button id="dt-btn-cancel" style="padding: 9px 18px; font-size: 13px; font-weight: 600; color: #5d606b; background: transparent; border: 1.5px solid transparent; border-radius: 6px; cursor: pointer;">
                                Cancel
                            </button>
                            <button id="dt-btn-save" style="padding: 9px 22px; font-size: 13px; font-weight: 700; color: #ffffff; background: #2962FF; border: none; border-radius: 6px; cursor: pointer; box-shadow: 0 2px 6px rgba(41,98,255,0.3); transition: background 0.15s;">
                                ✓ Apply Filter
                            </button>
                        </div>
                    </div>
                </div>
            `;

            modal.style.display = 'flex';

            // Element references
            const scopeSymbolBtn = document.getElementById('dt-scope-symbol');
            const scopeGlobalBtn = document.getElementById('dt-scope-global');
            const tzSelect = document.getElementById('dt-timezone');
            const startTimeInput = document.getElementById('dt-start-time');
            const endTimeInput = document.getElementById('dt-end-time');
            const cbDate = document.getElementById('dt-filter-dates');
            const dateInputs = document.getElementById('dt-date-inputs');
            const liveExplain = document.getElementById('dt-live-explain-banner');
            const presetCards = modal.querySelectorAll('.dt-preset-card');
            const marketTabs = modal.querySelectorAll('.dt-market-tab');

            // Switch Scope
            scopeSymbolBtn.onclick = () => {
                activeScope = 'symbol';
                scopeSymbolBtn.style.background = '#ffffff';
                scopeSymbolBtn.style.color = '#2962FF';
                scopeSymbolBtn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
                scopeGlobalBtn.style.background = 'transparent';
                scopeGlobalBtn.style.color = '#5d606b';
                scopeGlobalBtn.style.boxShadow = 'none';
            };

            scopeGlobalBtn.onclick = () => {
                activeScope = 'global';
                scopeGlobalBtn.style.background = '#ffffff';
                scopeGlobalBtn.style.color = '#2962FF';
                scopeGlobalBtn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
                scopeSymbolBtn.style.background = 'transparent';
                scopeSymbolBtn.style.color = '#5d606b';
                scopeSymbolBtn.style.boxShadow = 'none';
            };

            // Switch Market Category Tabs
            marketTabs.forEach(tab => {
                tab.onclick = () => {
                    const catId = tab.getAttribute('data-cat-id');
                    activeTab = catId;
                    marketTabs.forEach(t => {
                        const isCurrent = t.getAttribute('data-cat-id') === catId;
                        t.style.background = isCurrent ? '#edf4ff' : 'transparent';
                        t.style.color = isCurrent ? '#2962FF' : '#5d606b';
                    });
                    presetCards.forEach(c => {
                        c.style.display = (c.getAttribute('data-category') === catId) ? 'block' : 'none';
                    });
                };
            });

            // Dynamic Live Explanation & Preset Visual update
            const updatePresetVisuals = () => {
                const curStart = startTimeInput.value;
                const curEnd = endTimeInput.value;
                const curTz = tzSelect.value;
                let matchedPreset = null;

                presetCards.forEach(card => {
                    const pStart = card.getAttribute('data-start');
                    const pEnd = card.getAttribute('data-end');
                    const pTz = card.getAttribute('data-tz');
                    const badge = card.querySelector('.dt-preset-badge');

                    // If currently enabled and matching preset time and timezone
                    if (hasActiveFilter && pStart === curStart && pEnd === curEnd && pTz === curTz) {
                        card.style.border = '2px solid #2962FF';
                        card.style.background = '#edf4ff';
                        card.style.boxShadow = '0 0 0 1px #2962FF, 0 4px 12px rgba(41,98,255,0.15)';
                        if (badge) badge.style.display = 'inline-block';
                        matchedPreset = card.getAttribute('data-preset-id');
                    } else {
                        card.style.border = '1.5px solid #d1d4dc';
                        card.style.background = '#ffffff';
                        card.style.boxShadow = 'none';
                        if (badge) badge.style.display = 'none';
                    }
                });

                const sM = parseTimeMins(curStart);
                const eM = parseTimeMins(curEnd);

                if (sM === null || eM === null) {
                    liveExplain.innerHTML = `⚠️ Invalid time format. Please use standard HH:MM (e.g. 09:15).`;
                    liveExplain.style.borderColor = '#ef5350';
                    liveExplain.style.background = '#fef2f2';
                    liveExplain.style.color = '#c62828';
                } else if (sM === eM || (sM === 0 && eM >= 1440)) {
                    liveExplain.innerHTML = `🌐 <strong>Full 24-Hour Session (${curTz}):</strong> All 24 hours of candles will be included in the chart.`;
                    liveExplain.style.borderColor = '#2962FF';
                    liveExplain.style.background = '#edf4ff';
                    liveExplain.style.color = '#1557bf';
                } else if (sM < eM) {
                    liveExplain.innerHTML = `✓ <strong>Standard Session (${curTz}):</strong> Only candles between <strong>${curStart}</strong> and <strong>${curEnd}</strong> will be displayed. Out-of-session bars will be stripped.`;
                    liveExplain.style.borderColor = '#2962FF';
                    liveExplain.style.background = '#edf4ff';
                    liveExplain.style.color = '#1557bf';
                } else {
                    liveExplain.innerHTML = `🌙 <strong>Overnight Session (${curTz}):</strong> Active across midnight from <strong>${curStart}</strong> to <strong>${curEnd}</strong>. The daily break between <strong>${curEnd}</strong> and <strong>${curStart}</strong> will be stripped.`;
                    liveExplain.style.borderColor = '#b8860b';
                    liveExplain.style.background = '#fefdf5';
                    liveExplain.style.color = '#7d5c07';
                }
            };

            // Preset click handlers
            presetCards.forEach(card => {
                card.onclick = () => {
                    const st = card.getAttribute('data-start');
                    const et = card.getAttribute('data-end');
                    const tz = card.getAttribute('data-tz');
                    if (st) startTimeInput.value = st;
                    if (et) endTimeInput.value = et;
                    if (tz) tzSelect.value = tz;

                    presetCards.forEach(c => {
                        c.style.border = '1.5px solid #d1d4dc';
                        c.style.background = '#ffffff';
                        c.style.boxShadow = 'none';
                        const b = c.querySelector('.dt-preset-badge');
                        if (b) b.style.display = 'none';
                    });

                    card.style.border = '2px solid #2962FF';
                    card.style.background = '#edf4ff';
                    card.style.boxShadow = '0 0 0 1px #2962FF, 0 4px 12px rgba(41,98,255,0.15)';
                    const badge = card.querySelector('.dt-preset-badge');
                    if (badge) badge.style.display = 'inline-block';

                    updatePresetVisuals();
                };
            });

            startTimeInput.oninput = updatePresetVisuals;
            endTimeInput.oninput = updatePresetVisuals;
            tzSelect.onchange = updatePresetVisuals;

            cbDate.onchange = () => {
                dateInputs.style.display = cbDate.checked ? 'flex' : 'none';
            };

            // Initial visual update
            updatePresetVisuals();

            // Close actions
            const closeModal = () => { modal.style.display = 'none'; };
            document.getElementById('dt-modal-close').onclick = closeModal;
            document.getElementById('dt-btn-cancel').onclick = closeModal;

            const clearSymbolOverrides = () => {
                if (!this.data.symbols) return;
                delete this.data.symbols[normSym];
                delete this.data.symbols[sym];
                Object.keys(this.data.symbols).forEach(k => {
                    if (normalizeSymbol(k) === normSym || k.toUpperCase() === normSym.toUpperCase()) {
                        delete this.data.symbols[k];
                    }
                });
            };

            // DELETE SELECTION BUTTON: Deselects / removes filter for this ticker completely
            document.getElementById('dt-btn-delete').onclick = () => {
                clearSymbolOverrides();
                if (activeScope === 'global') {
                    this.data.global.enabled = false;
                }
                this.saveSettings();
                this.updateButtonLabel();
                closeModal();
                this.applyAndReload();
                this.showToast(`✓ Filter removed for ${activeScope === 'symbol' ? normSym : 'All Symbols'}. All raw dataset candles restored.`);
            };

            // APPLY FILTER BUTTON: Saves selection with enabled=true
            document.getElementById('dt-btn-save').onclick = () => {
                const sMins = parseTimeMins(startTimeInput.value) ?? 555;
                const eMins = parseTimeMins(endTimeInput.value) ?? 930;

                const startTimeFormatted = formatTimeDisplay(sMins);
                const endTimeFormatted = formatTimeDisplay(eMins);
                const selectedTz = tzSelect.value || 'Asia/Kolkata';

                const filterDates = cbDate.checked;
                const startDate = document.getElementById('dt-start-date').value || '';
                const endDate = document.getElementById('dt-end-date').value || '';

                const newSettings = {
                    enabled: true,
                    timezone: selectedTz,
                    startTime: startTimeFormatted,
                    endTime: endTimeFormatted,
                    filterDates,
                    startDate,
                    endDate
                };

                if (activeScope === 'symbol') {
                    if (!this.data.symbols) this.data.symbols = {};
                    this.data.symbols[normSym] = newSettings;
                    this.data.symbols[sym] = newSettings;
                } else {
                    // Global scope: clear symbol override so global takes effect
                    clearSymbolOverrides();
                    this.data.global = newSettings;
                }

                this.saveSettings();
                this.updateButtonLabel();
                closeModal();

                // Trigger complete data flush and chart redraw
                this.applyAndReload();

                const targetDesc = activeScope === 'symbol' ? normSym : 'All Symbols';
                this.showToast(`✓ Filter applied to ${targetDesc}: ${startTimeFormatted}–${endTimeFormatted} (${selectedTz}). Chart reloaded.`);
            };
        }

        showToast(msg) {
            let toast = document.getElementById('dt-toast-notification');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'dt-toast-notification';
                toast.style.cssText = `
                    position: fixed; bottom: 28px; right: 28px; z-index: 9999999;
                    background: #1e222d; color: #ffffff; padding: 12px 20px;
                    border-radius: 8px; font-size: 13px; font-weight: 600;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.25); border-left: 4px solid #2962FF;
                    transition: opacity 0.25s, transform 0.25s; opacity: 0; transform: translateY(12px);
                    pointer-events: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                `;
                document.body.appendChild(toast);
            }
            toast.textContent = msg;
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
            clearTimeout(this._toastTimeout);
            this._toastTimeout = setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(12px)';
            }, 3500);
        }
    }

    // Expose singleton on window
    const manager = new DatasetTimingManager();
    window.DatasetTimingManager = manager;
    window.DatasetTimingUI = manager;

    // Hook into TradingView chart header
    function tryInject() {
        const iframe = document.querySelector('iframe[id^="tradingview_"]');
        if (!iframe) {
            setTimeout(tryInject, 400);
            return;
        }

        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            if (!iframeDoc) {
                setTimeout(tryInject, 400);
                return;
            }

            const indicatorsBtn = iframeDoc.querySelector('[data-name="indicators"]') || iframeDoc.querySelector('#header-toolbar-indicators');
            if (indicatorsBtn && !iframeDoc.getElementById(manager.btnId)) {
                manager.injectButton(indicatorsBtn, iframeDoc);
                return;
            }

            const headerGroup = iframeDoc.querySelector('.group-MBOVGQRI');
            if (headerGroup && !iframeDoc.getElementById(manager.btnId)) {
                manager.injectButton(headerGroup, iframeDoc);
                return;
            }
        } catch (_) {}

        setTimeout(tryInject, 400);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInject);
    } else {
        tryInject();
    }
})();
