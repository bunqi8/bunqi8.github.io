// -----------------------------------------------------------------------
// Dataset Timing & Session Filter Manager
// Allows configuring start and end time (and optional date range)
// for chart dataset filtering directly from the UI, saved in localStorage.
// -----------------------------------------------------------------------

(function () {
    const STORAGE_KEY = 'tv_dataset_timing_settings';

    const DEFAULT_GLOBAL = {
        enabled: true,
        startTime: '09:15',
        endTime: '15:30',
        filterDates: false,
        startDate: '',
        endDate: ''
    };

    const DEFAULT_MCX = {
        enabled: true,
        startTime: '09:00',
        endTime: '23:30',
        filterDates: false,
        startDate: '',
        endDate: ''
    };

    const PRESETS = [
        { id: 'tv_default', name: 'TradingView Default', start: '09:15', end: '15:30', desc: '09:15 – 15:30 (75 bars/day)', color: '#2962FF' },
        { id: 'early_cutoff', name: 'Early Cutoff', start: '09:15', end: '15:10', desc: '09:15 – 15:10 (72 bars/day)', color: '#e65100' },
        { id: 'mcx', name: 'MCX Commodity', start: '09:00', end: '23:30', desc: '09:00 – 23:30 IST', color: '#00897b' },
        { id: 'full_24h', name: 'Full Session (24h)', start: '00:00', end: '23:59', desc: '00:00 – 23:59 (Unrestricted)', color: '#5d606b' }
    ];

    function normalizeSymbol(sym) {
        if (!sym || typeof sym !== 'string') return '';
        let s = sym.trim();
        if (s.includes('|')) s = s.split('|')[0];
        if (s.includes(':')) s = s.split(':')[1];
        return s.toUpperCase();
    }

    // Bulletproof time parser handling 24h ("15:10") and 12h AM/PM ("03:10 PM", "3:10 PM")
    function parseTimeMins(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') return null;
        const clean = timeStr.trim();
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
                    this.data = JSON.parse(raw);
                } else {
                    this.data = { global: { ...DEFAULT_GLOBAL }, symbols: {} };
                }
            } catch (e) {
                console.warn('[DatasetTiming] Failed to parse localStorage settings, using defaults.', e);
                this.data = { global: { ...DEFAULT_GLOBAL }, symbols: {} };
            }
            if (!this.data.global) this.data.global = { ...DEFAULT_GLOBAL };
            if (!this.data.symbols) this.data.symbols = {};
        }

        saveSettings() {
            try {
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
                if (normSym && this.data.symbols[normSym] && this.data.symbols[normSym].enabled) {
                    return { ...this.data.symbols[normSym], isSymbolSpecific: true, symbol: normSym };
                }
                if (rawSym && this.data.symbols[rawSym] && this.data.symbols[rawSym].enabled) {
                    return { ...this.data.symbols[rawSym], isSymbolSpecific: true, symbol: rawSym };
                }
            }

            if (isMcx && (!this.data.global || (this.data.global.startTime === DEFAULT_GLOBAL.startTime && this.data.global.endTime === DEFAULT_GLOBAL.endTime))) {
                return { ...DEFAULT_MCX, isSymbolSpecific: false, symbol: normSym };
            }
            return { ...(this.data.global || DEFAULT_GLOBAL), isSymbolSpecific: false, symbol: normSym };
        }

        filterBars(bars, resolution, symbolInfo, isMcx) {
            if (!bars || bars.length === 0) return bars;
            const symName = symbolInfo ? symbolInfo.name : this.getActiveSymbol();
            const isMcxSymbol = isMcx !== undefined ? isMcx : (symbolInfo && (symbolInfo.exchange === 'MCX' || (symbolInfo.name && (symbolInfo.name.includes('CRUDE') || symbolInfo.name.includes('GOLD') || symbolInfo.name.includes('SILVER') || symbolInfo.name.includes('NATURALGAS')))));

            const settings = this.getSettingsForSymbol(symName, isMcxSymbol);
            if (!settings || !settings.enabled) return bars;

            const resString = resolution ? resolution.toString() : '';
            const isDWM = resString.includes('D') || resString.includes('W') || resString.includes('M') || resolution === 'D' || resolution === '1D';

            const startMins = parseTimeMins(settings.startTime) ?? (isMcxSymbol ? 540 : 555);
            const endMins = parseTimeMins(settings.endTime) ?? (isMcxSymbol ? 1410 : 930);

            let startTs = null;
            let endTs = null;
            if (settings.filterDates) {
                if (settings.startDate) {
                    const d = new Date(settings.startDate + 'T00:00:00+05:30');
                    if (!isNaN(d.getTime())) startTs = d.getTime();
                }
                if (settings.endDate) {
                    const d = new Date(settings.endDate + 'T23:59:59.999+05:30');
                    if (!isNaN(d.getTime())) endTs = d.getTime();
                }
            }

            const filtered = [];
            for (let i = 0; i < bars.length; i++) {
                const b = bars[i];
                const tNum = Number(b.time);

                // Calendar date filter check
                if (startTs !== null && tNum < startTs) continue;
                if (endTs !== null && tNum > endTs) continue;

                if (!isDWM) {
                    // Intraday session time filter check (IST)
                    const istDate = new Date(tNum + 19800000);
                    const mins = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();

                    let allowed = false;
                    if (startMins <= endMins) {
                        allowed = (mins >= startMins && mins < endMins);
                    } else {
                        // Overnight session (spans midnight)
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
            const res = this.filterBars([{ time: barTimeMs }], resolution, symbolInfo, isMcx);
            return res.length > 0;
        }

        // Header toolbar button injection
        injectButton(targetEl, iframeDoc) {
            if (!iframeDoc || iframeDoc.getElementById(this.btnId)) return;

            const sym = this.getActiveSymbol();
            const normSym = normalizeSymbol(sym);
            const isMcx = normSym.includes('CRUDE') || normSym.includes('GOLD') || normSym.includes('SILVER') || normSym.includes('NATURALGAS');
            const settings = this.getSettingsForSymbol(normSym, isMcx);

            const isCustom = (settings.startTime !== (isMcx ? '09:00' : '09:15') || settings.endTime !== (isMcx ? '23:30' : '15:30') || settings.filterDates);
            const labelText = `${settings.startTime}–${settings.endTime}`;

            const btnHtml = `
            <div class="group-MBOVGQRI" id="header-toolbar-dataset-timing" style="margin: 0 4px;">
                <button id="${this.btnId}" class="button-OhqNVIYA button-ptpAHg8E apply-common-tooltip isInteractive-GwQQdU8S" 
                    title="Dataset Session Filter: ${labelText}${settings.isSymbolSpecific ? ' (' + normSym + ')' : ''} (Click to change)" 
                    style="padding: 0 10px; font-weight: 600; font-size: 12px; color: ${isCustom ? '#e65100' : '#2962FF'}; border: 1.5px solid ${isCustom ? '#ff9800' : '#2962FF'}; background: ${isCustom ? 'rgba(255,152,0,0.1)' : 'rgba(41,98,255,0.08)'}; border-radius: 4px; display: inline-flex; align-items: center; gap: 6px; height: 28px; cursor: pointer; transition: all 0.2s ease;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    <span id="dataset-timing-btn-label">${labelText}</span>
                </button>
            </div>
            `;
            targetEl.insertAdjacentHTML('afterend', btnHtml);

            const btn = iframeDoc.getElementById(this.btnId);
            if (btn) {
                btn.addEventListener('click', () => this.showModal());
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

        updateButtonLabel() {
            const iframe = document.querySelector('iframe[id^="tradingview_"]');
            if (!iframe) return;
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            if (!iframeDoc) return;

            const btn = iframeDoc.getElementById(this.btnId);
            const lbl = iframeDoc.getElementById('dataset-timing-btn-label');
            if (!btn || !lbl) return;

            const sym = this.getActiveSymbol();
            const normSym = normalizeSymbol(sym);
            const isMcx = normSym.includes('CRUDE') || normSym.includes('GOLD') || normSym.includes('SILVER') || normSym.includes('NATURALGAS');
            const settings = this.getSettingsForSymbol(normSym, isMcx);

            const isCustom = (settings.startTime !== (isMcx ? '09:00' : '09:15') || settings.endTime !== (isMcx ? '23:30' : '15:30') || settings.filterDates);
            const labelText = `${settings.startTime}–${settings.endTime}`;

            lbl.innerText = labelText;
            btn.title = `Dataset Session Filter: ${labelText}${settings.isSymbolSpecific ? ' (' + normSym + ')' : ''} (Click to change)`;
            btn.style.color = isCustom ? '#e65100' : '#2962FF';
            btn.style.borderColor = isCustom ? '#ff9800' : '#2962FF';
            btn.style.background = isCustom ? 'rgba(255,152,0,0.1)' : 'rgba(41,98,255,0.08)';
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

            // 3. Clear chart model data and trigger re-request
            if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
                const chart = window.tvWidget.activeChart();
                try {
                    if (chart._chartWidget && chart._chartWidget.model && chart._chartWidget.model().mainSeries) {
                        const ms = chart._chartWidget.model().mainSeries();
                        if (ms && ms.data && typeof ms.data().clear === 'function') {
                            ms.data().clear();
                        }
                    }
                } catch (_) {}

                try {
                    if (typeof chart.resetData === 'function') {
                        chart.resetData();
                    }
                } catch (_) {}
            }
        }

        showModal() {
            let modal = document.getElementById(this.modalId);
            const sym = this.getActiveSymbol();
            const normSym = normalizeSymbol(sym);
            const isMcx = normSym.includes('CRUDE') || normSym.includes('GOLD') || normSym.includes('SILVER') || normSym.includes('NATURALGAS');
            const currentSettings = this.getSettingsForSymbol(normSym, isMcx);
            let activeScope = (this.data.symbols && this.data.symbols[normSym] && this.data.symbols[normSym].enabled) ? 'symbol' : 'global';

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
                <div style="background: #ffffff; width: 520px; max-width: 95vw; border-radius: 12px; box-shadow: 0 20px 48px rgba(0,0,0,0.28); overflow: hidden; display: flex; flex-direction: column; border: 1px solid #e0e3eb; animation: dtFadeIn 0.15s ease-out;">
                    <style>
                        @keyframes dtFadeIn { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
                        .dt-preset-card {
                            border: 1.5px solid #e0e3eb;
                            border-radius: 8px;
                            padding: 12px 14px;
                            background: #ffffff;
                            cursor: pointer;
                            transition: all 0.15s ease;
                            position: relative;
                            display: flex;
                            flex-direction: column;
                            user-select: none;
                        }
                        .dt-preset-card:hover {
                            border-color: #b2b5be;
                            background: #f8f9fd;
                            transform: translateY(-1px);
                        }
                        .dt-preset-card.is-active {
                            border: 2px solid #2962FF !important;
                            background: #f0f4ff !important;
                            box-shadow: 0 0 0 1px #2962FF, 0 4px 12px rgba(41,98,255,0.12) !important;
                        }
                        .dt-scope-btn {
                            flex: 1;
                            padding: 8px 12px;
                            font-size: 13px;
                            font-weight: 600;
                            border: none;
                            border-radius: 6px;
                            cursor: pointer;
                            transition: all 0.15s ease;
                            background: transparent;
                            color: #5d606b;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            gap: 6px;
                        }
                        .dt-scope-btn.is-active {
                            background: #ffffff;
                            color: #2962FF;
                            box-shadow: 0 2px 6px rgba(0,0,0,0.1);
                        }
                    </style>

                    <!-- Header -->
                    <div style="padding: 18px 22px; border-bottom: 1px solid #e5e8f0; display: flex; align-items: center; justify-content: space-between; background: #fafbfc;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div style="width: 32px; height: 32px; border-radius: 8px; background: #edf3ff; color: #2962FF; display: flex; align-items: center; justify-content: center;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                            </div>
                            <div>
                                <div style="font-size: 16px; font-weight: 700; color: #131722;">Dataset Session & Timing Filter</div>
                                <div style="font-size: 12px; color: #787b86;">Strip outside candles before applying data to chart</div>
                            </div>
                        </div>
                        <button id="dt-modal-close" style="width: 30px; height: 30px; border-radius: 6px; background: transparent; border: none; font-size: 18px; color: #787b86; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.15s;">✕</button>
                    </div>

                    <!-- Body -->
                    <div style="padding: 20px 22px; display: flex; flex-direction: column; gap: 18px; overflow-y: auto; max-height: 75vh;">
                        <!-- Scope Segmented Control -->
                        <div style="background: #f0f3fa; border-radius: 8px; padding: 4px; display: flex;">
                            <button type="button" id="dt-scope-global" class="dt-scope-btn ${activeScope === 'global' ? 'is-active' : ''}">
                                <span>🌐 All Symbols (Global)</span>
                            </button>
                            <button type="button" id="dt-scope-symbol" class="dt-scope-btn ${activeScope === 'symbol' ? 'is-active' : ''}">
                                <span>🎯 Current: <strong style="color: inherit;">${normSym}</strong></span>
                            </button>
                        </div>

                        <!-- Presets Section with High-Visibility Selection Clues -->
                        <div>
                            <div style="font-size: 12px; font-weight: 700; color: #434651; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
                                Quick Session Presets:
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
                                ${PRESETS.map(p => `
                                    <div class="dt-preset-card" data-preset-id="${p.id}" data-start="${p.start}" data-end="${p.end}">
                                        <div style="display: flex; align-items: center; justify-content: space-between;">
                                            <span style="font-weight: 700; font-size: 13px; color: ${p.color};">${p.name}</span>
                                            <span class="dt-preset-badge" style="display: none; background: #2962FF; color: #fff; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 10px; line-height: 1.2;">✓ ACTIVE</span>
                                        </div>
                                        <span style="color: #787b86; font-size: 11px; margin-top: 4px;">${p.desc}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <!-- Time Inputs Container -->
                        <div style="background: #ffffff; border: 1.5px solid #e0e3eb; border-radius: 8px; padding: 16px;">
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                                <div style="font-size: 13px; font-weight: 700; color: #131722;">Session Hours (IST):</div>
                                <div id="dt-live-preset-indicator" style="font-size: 11px; font-weight: 600; color: #2962FF; background: #edf3ff; padding: 3px 8px; border-radius: 4px;"></div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 14px;">
                                <div style="flex: 1;">
                                    <label style="display: block; font-size: 11px; font-weight: 700; color: #787b86; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">START TIME (OPEN)</label>
                                    <input type="time" id="dt-start-time" value="${currentSettings.startTime || '09:15'}" style="width: 100%; padding: 10px 12px; font-size: 15px; font-weight: 600; color: #131722; border: 1.5px solid #d1d4dc; border-radius: 6px; box-sizing: border-box; outline: none; transition: border-color 0.15s;">
                                </div>
                                <div style="font-size: 18px; color: #9598a1; font-weight: bold; margin-top: 20px;">&rarr;</div>
                                <div style="flex: 1;">
                                    <label style="display: block; font-size: 11px; font-weight: 700; color: #787b86; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">END TIME (CUTOFF)</label>
                                    <input type="time" id="dt-end-time" value="${currentSettings.endTime || '15:30'}" style="width: 100%; padding: 10px 12px; font-size: 15px; font-weight: 600; color: #131722; border: 1.5px solid #d1d4dc; border-radius: 6px; box-sizing: border-box; outline: none; transition: border-color 0.15s;">
                                </div>
                            </div>
                            <div id="dt-live-explain-banner" style="margin-top: 12px; padding: 8px 12px; background: #fbf0ea; border-left: 3px solid #ff9800; border-radius: 4px; font-size: 12px; color: #b75500; line-height: 1.4;">
                            </div>
                        </div>

                        <!-- Date Range Filtering (Optional) -->
                        <div style="border: 1.5px solid #e0e3eb; border-radius: 8px; padding: 14px 16px;">
                            <label style="display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 700; color: #131722; cursor: pointer; user-select: none;">
                                <input type="checkbox" id="dt-filter-dates" ${currentSettings.filterDates ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer; accent-color: #2962FF;">
                                Filter Historical Calendar Dates (Optional)
                            </label>
                            <div id="dt-date-inputs" style="display: ${currentSettings.filterDates ? 'flex' : 'none'}; align-items: center; gap: 14px; margin-top: 12px;">
                                <div style="flex: 1;">
                                    <label style="display: block; font-size: 11px; font-weight: 700; color: #787b86; margin-bottom: 4px;">FROM DATE</label>
                                    <input type="date" id="dt-start-date" value="${currentSettings.startDate || ''}" style="width: 100%; padding: 8px 10px; font-size: 13px; border: 1.5px solid #d1d4dc; border-radius: 6px; box-sizing: border-box;">
                                </div>
                                <div style="font-size: 18px; color: #9598a1; font-weight: bold; margin-top: 18px;">&rarr;</div>
                                <div style="flex: 1;">
                                    <label style="display: block; font-size: 11px; font-weight: 700; color: #787b86; margin-bottom: 4px;">TO DATE</label>
                                    <input type="date" id="dt-end-date" value="${currentSettings.endDate || ''}" style="width: 100%; padding: 8px 10px; font-size: 13px; border: 1.5px solid #d1d4dc; border-radius: 6px; box-sizing: border-box;">
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="padding: 16px 22px; border-top: 1px solid #e5e8f0; display: flex; align-items: center; justify-content: space-between; background: #fafbfc;">
                        <button id="dt-btn-reset" style="padding: 9px 16px; font-size: 13px; font-weight: 600; color: #5d606b; background: #ffffff; border: 1.5px solid #d1d4dc; border-radius: 6px; cursor: pointer; transition: all 0.15s;">
                            Reset to TV Default
                        </button>
                        <div style="display: flex; gap: 12px;">
                            <button id="dt-btn-cancel" style="padding: 9px 18px; font-size: 13px; font-weight: 600; color: #5d606b; background: #ffffff; border: 1.5px solid #d1d4dc; border-radius: 6px; cursor: pointer; transition: all 0.15s;">
                                Cancel
                            </button>
                            <button id="dt-btn-save" style="padding: 9px 22px; font-size: 13px; font-weight: 700; color: #ffffff; background: #2962FF; border: none; border-radius: 6px; cursor: pointer; box-shadow: 0 2px 8px rgba(41,98,255,0.3); transition: all 0.15s;">
                                Save & Apply to Chart
                            </button>
                        </div>
                    </div>
                </div>
            `;

            modal.style.display = 'flex';

            // UI Elements
            const startTimeInput = document.getElementById('dt-start-time');
            const endTimeInput = document.getElementById('dt-end-time');
            const cbDate = document.getElementById('dt-filter-dates');
            const dateInputs = document.getElementById('dt-date-inputs');
            const btnScopeGlobal = document.getElementById('dt-scope-global');
            const btnScopeSymbol = document.getElementById('dt-scope-symbol');
            const liveIndicator = document.getElementById('dt-live-preset-indicator');
            const explainBanner = document.getElementById('dt-live-explain-banner');
            const presetCards = modal.querySelectorAll('.dt-preset-card');

            // Function to synchronize preset active highlights and explain banner
            const updatePresetVisuals = () => {
                const sMins = parseTimeMins(startTimeInput.value) ?? 555;
                const eMins = parseTimeMins(endTimeInput.value) ?? 930;

                const curStart = formatTimeDisplay(sMins);
                const curEnd = formatTimeDisplay(eMins);

                let matchedPreset = null;
                presetCards.forEach(card => {
                    const pStart = card.getAttribute('data-start');
                    const pEnd = card.getAttribute('data-end');
                    const badge = card.querySelector('.dt-preset-badge');

                    if (pStart === curStart && pEnd === curEnd) {
                        card.classList.add('is-active');
                        if (badge) badge.style.display = 'inline-block';
                        matchedPreset = card.getAttribute('data-preset-id');
                    } else {
                        card.classList.remove('is-active');
                        if (badge) badge.style.display = 'none';
                    }
                });

                if (matchedPreset === 'early_cutoff') {
                    liveIndicator.innerText = 'Early Cutoff (09:15–15:10)';
                    liveIndicator.style.color = '#e65100';
                    liveIndicator.style.background = '#fef3e6';
                    explainBanner.style.display = 'block';
                    explainBanner.style.background = '#fef3e6';
                    explainBanner.style.borderLeftColor = '#e65100';
                    explainBanner.style.color = '#b75500';
                    explainBanner.innerHTML = '⚡ <strong>Early Cutoff Active:</strong> Candles at <strong>15:10, 15:15, 15:20, and 15:25</strong> are completely stripped away from the chart dataset.';
                } else if (matchedPreset === 'tv_default') {
                    liveIndicator.innerText = 'TradingView Default (09:15–15:30)';
                    liveIndicator.style.color = '#2962FF';
                    liveIndicator.style.background = '#edf3ff';
                    explainBanner.style.display = 'block';
                    explainBanner.style.background = '#edf3ff';
                    explainBanner.style.borderLeftColor = '#2962FF';
                    explainBanner.style.color = '#1b4bbf';
                    explainBanner.innerHTML = '⚡ <strong>TradingView Standard:</strong> Complete 75 bars/day session preserved (09:15 to 15:30 IST). Post-market candles at/after 15:30 stripped.';
                } else if (matchedPreset === 'full_24h') {
                    liveIndicator.innerText = 'Full 24h Session';
                    liveIndicator.style.color = '#5d606b';
                    liveIndicator.style.background = '#f0f3fa';
                    explainBanner.style.display = 'block';
                    explainBanner.style.background = '#f0f3fa';
                    explainBanner.style.borderLeftColor = '#5d606b';
                    explainBanner.style.color = '#434651';
                    explainBanner.innerHTML = '⚡ <strong>Unrestricted:</strong> Keeps all downloaded candles without session filtering.';
                } else {
                    liveIndicator.innerText = `Custom Range: ${curStart}–${curEnd}`;
                    liveIndicator.style.color = '#787b86';
                    liveIndicator.style.background = '#f0f3fa';
                    explainBanner.style.display = 'block';
                    explainBanner.style.background = '#f8f9fd';
                    explainBanner.style.borderLeftColor = '#2962FF';
                    explainBanner.style.color = '#333';
                    explainBanner.innerHTML = `⚡ <strong>Custom Session:</strong> Only candles opening between <strong>${curStart}</strong> and <strong>${curEnd} IST</strong> will be kept.`;
                }
            };

            // Preset click handlers with instant visual clues
            presetCards.forEach(card => {
                card.onclick = () => {
                    const st = card.getAttribute('data-start');
                    const et = card.getAttribute('data-end');
                    if (st) startTimeInput.value = st;
                    if (et) endTimeInput.value = et;
                    updatePresetVisuals();
                };
            });

            // Live updates when editing time inputs
            startTimeInput.oninput = updatePresetVisuals;
            endTimeInput.oninput = updatePresetVisuals;
            startTimeInput.onchange = updatePresetVisuals;
            endTimeInput.onchange = updatePresetVisuals;

            // Scope buttons toggle
            btnScopeGlobal.onclick = () => {
                activeScope = 'global';
                btnScopeGlobal.classList.add('is-active');
                btnScopeSymbol.classList.remove('is-active');
            };
            btnScopeSymbol.onclick = () => {
                activeScope = 'symbol';
                btnScopeSymbol.classList.add('is-active');
                btnScopeGlobal.classList.remove('is-active');
            };

            // Date checkbox toggle
            cbDate.onchange = () => {
                dateInputs.style.display = cbDate.checked ? 'flex' : 'none';
            };

            // Initial visual update
            updatePresetVisuals();

            // Close actions
            const closeModal = () => { modal.style.display = 'none'; };
            document.getElementById('dt-modal-close').onclick = closeModal;
            document.getElementById('dt-btn-cancel').onclick = closeModal;

            // Reset button
            document.getElementById('dt-btn-reset').onclick = () => {
                startTimeInput.value = '09:15';
                endTimeInput.value = '15:30';
                cbDate.checked = false;
                dateInputs.style.display = 'none';
                document.getElementById('dt-start-date').value = '';
                document.getElementById('dt-end-date').value = '';
                updatePresetVisuals();
            };

            // Save & Apply button
            document.getElementById('dt-btn-save').onclick = () => {
                const sMins = parseTimeMins(startTimeInput.value) ?? 555;
                const eMins = parseTimeMins(endTimeInput.value) ?? 930;

                const startTimeFormatted = formatTimeDisplay(sMins);
                const endTimeFormatted = formatTimeDisplay(eMins);

                const filterDates = cbDate.checked;
                const startDate = document.getElementById('dt-start-date').value || '';
                const endDate = document.getElementById('dt-end-date').value || '';

                const newSettings = {
                    enabled: true,
                    startTime: startTimeFormatted,
                    endTime: endTimeFormatted,
                    filterDates,
                    startDate,
                    endDate
                };

                if (activeScope === 'symbol') {
                    if (!this.data.symbols) this.data.symbols = {};
                    this.data.symbols[normSym] = newSettings;
                    // Also save under raw symbol for guaranteed lookup
                    this.data.symbols[sym] = newSettings;
                } else {
                    this.data.global = newSettings;
                }

                this.saveSettings();
                this.updateButtonLabel();
                closeModal();

                // Trigger complete data flush and chart redraw
                this.applyAndReload();

                this.showToast(`✓ Dataset timing updated to ${startTimeFormatted}–${endTimeFormatted}. Chart reloaded.`);
            };
        }

        showToast(msg) {
            let toast = document.getElementById('dataset-timing-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'dataset-timing-toast';
                toast.style.cssText = `
                    position: fixed; bottom: 35px; left: 50%; transform: translateX(-50%);
                    background: #131722; color: #ffffff; padding: 12px 22px; border-radius: 8px;
                    font-size: 13px; font-weight: 600; z-index: 9999999; box-shadow: 0 6px 18px rgba(0,0,0,0.35);
                    pointer-events: none; opacity: 0; transition: opacity 0.25s ease; border: 1px solid rgba(255,255,255,0.15);
                `;
                document.body.appendChild(toast);
            }
            toast.innerText = msg;
            toast.style.opacity = '1';
            setTimeout(() => { toast.style.opacity = '0'; }, 3200);
        }
    }

    window.DatasetTimingManager = new DatasetTimingManager();
    window.DatasetTimingUI = window.DatasetTimingManager;
})();
