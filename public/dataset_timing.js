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

    function parseTimeMins(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') return null;
        const parts = timeStr.trim().split(':');
        if (parts.length < 2) return null;
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (isNaN(h) || isNaN(m)) return null;
        return h * 60 + m;
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
            const sym = symbolName || this.getActiveSymbol();
            if (sym && this.data.symbols && this.data.symbols[sym] && this.data.symbols[sym].enabled) {
                return { ...this.data.symbols[sym], isSymbolSpecific: true, symbol: sym };
            }
            if (isMcx && (!this.data.global || (this.data.global.startTime === DEFAULT_GLOBAL.startTime && this.data.global.endTime === DEFAULT_GLOBAL.endTime))) {
                return { ...DEFAULT_MCX, isSymbolSpecific: false, symbol: sym };
            }
            return { ...(this.data.global || DEFAULT_GLOBAL), isSymbolSpecific: false, symbol: sym };
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

                // Date filter check
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
            const isMcx = sym.includes('CRUDE') || sym.includes('GOLD') || sym.includes('SILVER') || sym.includes('NATURALGAS');
            const settings = this.getSettingsForSymbol(sym, isMcx);

            const isCustom = (settings.startTime !== (isMcx ? '09:00' : '09:15') || settings.endTime !== (isMcx ? '23:30' : '15:30') || settings.filterDates);
            const labelText = `${settings.startTime}–${settings.endTime}`;

            const btnHtml = `
            <div class="group-MBOVGQRI" id="header-toolbar-dataset-timing" style="margin: 0 4px;">
                <button id="${this.btnId}" class="button-OhqNVIYA button-ptpAHg8E apply-common-tooltip isInteractive-GwQQdU8S" 
                    title="Dataset Session & Timing Filter: ${labelText}${settings.isSymbolSpecific ? ' (' + sym + ')' : ''} (Click to change)" 
                    style="padding: 0 10px; font-weight: 600; font-size: 12px; color: ${isCustom ? '#e65100' : '#2962FF'}; border: 1px solid ${isCustom ? '#ff9800' : '#2962FF'}; background: ${isCustom ? 'rgba(255,152,0,0.1)' : 'rgba(41,98,255,0.08)'}; border-radius: 4px; display: inline-flex; align-items: center; gap: 5px; height: 28px; cursor: pointer; transition: all 0.2s ease;">
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
            const isMcx = sym.includes('CRUDE') || sym.includes('GOLD') || sym.includes('SILVER') || sym.includes('NATURALGAS');
            const settings = this.getSettingsForSymbol(sym, isMcx);

            const isCustom = (settings.startTime !== (isMcx ? '09:00' : '09:15') || settings.endTime !== (isMcx ? '23:30' : '15:30') || settings.filterDates);
            const labelText = `${settings.startTime}–${settings.endTime}`;

            lbl.innerText = labelText;
            btn.title = `Dataset Session & Timing Filter: ${labelText}${settings.isSymbolSpecific ? ' (' + sym + ')' : ''} (Click to change)`;
            btn.style.color = isCustom ? '#e65100' : '#2962FF';
            btn.style.borderColor = isCustom ? '#ff9800' : '#2962FF';
            btn.style.background = isCustom ? 'rgba(255,152,0,0.1)' : 'rgba(41,98,255,0.08)';
        }

        showModal() {
            let modal = document.getElementById(this.modalId);
            const sym = this.getActiveSymbol();
            const isMcx = sym.includes('CRUDE') || sym.includes('GOLD') || sym.includes('SILVER') || sym.includes('NATURALGAS');
            const currentSettings = this.getSettingsForSymbol(sym, isMcx);
            const isSymbolActive = !!(this.data.symbols && this.data.symbols[sym] && this.data.symbols[sym].enabled);

            if (!modal) {
                modal = document.createElement('div');
                modal.id = this.modalId;
                modal.style.cssText = `
                    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                    background: rgba(0, 0, 0, 0.55); z-index: 99999;
                    display: flex; align-items: center; justify-content: center;
                    backdrop-filter: blur(2px); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                `;
                document.body.appendChild(modal);
            }

            modal.innerHTML = `
                <div style="background: #ffffff; width: 500px; max-width: 94vw; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.25); overflow: hidden; display: flex; flex-direction: column;">
                    <!-- Header -->
                    <div style="padding: 18px 22px; border-bottom: 1px solid #e0e3eb; display: flex; align-items: center; justify-content: space-between; background: #fafbfc;">
                        <div>
                            <div style="font-size: 16px; font-weight: 700; color: #131722; display: flex; align-items: center; gap: 8px;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2962FF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                                Dataset Timing & Session Filter
                            </div>
                            <div style="font-size: 12px; color: #787b86; margin-top: 3px;">
                                Configure candle session hours and date filtering saved in your browser
                            </div>
                        </div>
                        <button id="dt-modal-close" style="background: none; border: none; font-size: 20px; color: #787b86; cursor: pointer; padding: 4px 8px; line-height: 1;">&times;</button>
                    </div>

                    <!-- Body -->
                    <div style="padding: 20px 22px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; max-height: 75vh;">
                        <!-- Scope Selection -->
                        <div style="background: #f8f9fd; border: 1px solid #e5e9f2; border-radius: 6px; padding: 10px 14px;">
                            <div style="font-size: 12px; font-weight: 600; color: #434651; margin-bottom: 6px;">Filter Scope:</div>
                            <div style="display: flex; gap: 18px;">
                                <label style="font-size: 13px; color: #131722; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                                    <input type="radio" name="dt-scope" value="global" ${!isSymbolActive ? 'checked' : ''}>
                                    All Symbols (Global)
                                </label>
                                <label style="font-size: 13px; color: #131722; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                                    <input type="radio" name="dt-scope" value="symbol" ${isSymbolActive ? 'checked' : ''}>
                                    Current Symbol Only (<strong style="color: #2962FF;">${sym}</strong>)
                                </label>
                            </div>
                        </div>

                        <!-- Quick Presets -->
                        <div>
                            <div style="font-size: 12px; font-weight: 600; color: #434651; margin-bottom: 6px;">Quick Presets:</div>
                            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
                                <button type="button" class="dt-preset-btn" data-start="09:15" data-end="15:30" style="padding: 8px 10px; font-size: 12px; font-weight: 500; border: 1px solid #d1d4dc; border-radius: 6px; background: #fff; cursor: pointer; text-align: left; display: flex; flex-direction: column;">
                                    <span style="font-weight: 600; color: #2962FF;">TradingView Default</span>
                                    <span style="color: #787b86; font-size: 11px;">09:15 – 15:30 (75 bars/day)</span>
                                </button>
                                <button type="button" class="dt-preset-btn" data-start="09:15" data-end="15:10" style="padding: 8px 10px; font-size: 12px; font-weight: 500; border: 1px solid #d1d4dc; border-radius: 6px; background: #fff; cursor: pointer; text-align: left; display: flex; flex-direction: column;">
                                    <span style="font-weight: 600; color: #e65100;">Early Cutoff</span>
                                    <span style="color: #787b86; font-size: 11px;">09:15 – 15:10 (72 bars/day)</span>
                                </button>
                                <button type="button" class="dt-preset-btn" data-start="09:00" data-end="23:30" style="padding: 8px 10px; font-size: 12px; font-weight: 500; border: 1px solid #d1d4dc; border-radius: 6px; background: #fff; cursor: pointer; text-align: left; display: flex; flex-direction: column;">
                                    <span style="font-weight: 600; color: #00897b;">MCX Commodity</span>
                                    <span style="color: #787b86; font-size: 11px;">09:00 – 23:30 IST</span>
                                </button>
                                <button type="button" class="dt-preset-btn" data-start="00:00" data-end="23:59" style="padding: 8px 10px; font-size: 12px; font-weight: 500; border: 1px solid #d1d4dc; border-radius: 6px; background: #fff; cursor: pointer; text-align: left; display: flex; flex-direction: column;">
                                    <span style="font-weight: 600; color: #5d606b;">Full 24h / No Cutoff</span>
                                    <span style="color: #787b86; font-size: 11px;">00:00 – 23:59 (Keep all)</span>
                                </button>
                            </div>
                        </div>

                        <!-- Session Time (Start & End Time) -->
                        <div style="border: 1px solid #e0e3eb; border-radius: 6px; padding: 14px;">
                            <div style="font-size: 13px; font-weight: 600; color: #131722; margin-bottom: 10px;">
                                Daily Candle Session Time (IST):
                            </div>
                            <div style="display: flex; align-items: center; gap: 14px;">
                                <div style="flex: 1;">
                                    <label style="display: block; font-size: 11px; font-weight: 600; color: #787b86; margin-bottom: 4px;">START TIME</label>
                                    <input type="time" id="dt-start-time" value="${currentSettings.startTime || '09:15'}" style="width: 100%; padding: 8px 10px; font-size: 14px; border: 1px solid #d1d4dc; border-radius: 4px; box-sizing: border-box;">
                                </div>
                                <div style="font-size: 16px; color: #787b86; margin-top: 18px;">&rarr;</div>
                                <div style="flex: 1;">
                                    <label style="display: block; font-size: 11px; font-weight: 600; color: #787b86; margin-bottom: 4px;">END TIME (CUTOFF)</label>
                                    <input type="time" id="dt-end-time" value="${currentSettings.endTime || '15:30'}" style="width: 100%; padding: 8px 10px; font-size: 14px; border: 1px solid #d1d4dc; border-radius: 4px; box-sizing: border-box;">
                                </div>
                            </div>
                            <div style="font-size: 11px; color: #787b86; margin-top: 8px;">
                                * Candlestick open times strictly inside this range are kept. All candles starting before or at/after cutoff are stripped away from chart dataset.
                            </div>
                        </div>

                        <!-- Date Range Filtering (Optional) -->
                        <div style="border: 1px solid #e0e3eb; border-radius: 6px; padding: 14px;">
                            <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #131722; cursor: pointer; user-select: none;">
                                <input type="checkbox" id="dt-filter-dates" ${currentSettings.filterDates ? 'checked' : ''}>
                                Enable Date Range Filter (Optional)
                            </label>
                            <div id="dt-date-inputs" style="display: ${currentSettings.filterDates ? 'flex' : 'none'}; align-items: center; gap: 14px; margin-top: 10px;">
                                <div style="flex: 1;">
                                    <label style="display: block; font-size: 11px; font-weight: 600; color: #787b86; margin-bottom: 4px;">START DATE</label>
                                    <input type="date" id="dt-start-date" value="${currentSettings.startDate || ''}" style="width: 100%; padding: 7px 10px; font-size: 13px; border: 1px solid #d1d4dc; border-radius: 4px; box-sizing: border-box;">
                                </div>
                                <div style="font-size: 16px; color: #787b86; margin-top: 18px;">&rarr;</div>
                                <div style="flex: 1;">
                                    <label style="display: block; font-size: 11px; font-weight: 600; color: #787b86; margin-bottom: 4px;">END DATE</label>
                                    <input type="date" id="dt-end-date" value="${currentSettings.endDate || ''}" style="width: 100%; padding: 7px 10px; font-size: 13px; border: 1px solid #d1d4dc; border-radius: 4px; box-sizing: border-box;">
                                </div>
                            </div>
                            <div style="font-size: 11px; color: #787b86; margin-top: 8px;">
                                * When enabled, candles outside this historical calendar date window will be stripped away before loading.
                            </div>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="padding: 14px 22px; border-top: 1px solid #e0e3eb; display: flex; align-items: center; justify-content: space-between; background: #fafbfc;">
                        <button id="dt-btn-reset" style="padding: 8px 14px; font-size: 12px; font-weight: 600; color: #5d606b; background: #fff; border: 1px solid #d1d4dc; border-radius: 4px; cursor: pointer;">
                            Reset to TV Default
                        </button>
                        <div style="display: flex; gap: 10px;">
                            <button id="dt-btn-cancel" style="padding: 8px 16px; font-size: 13px; font-weight: 500; color: #5d606b; background: #fff; border: 1px solid #d1d4dc; border-radius: 4px; cursor: pointer;">
                                Cancel
                            </button>
                            <button id="dt-btn-save" style="padding: 8px 18px; font-size: 13px; font-weight: 600; color: #ffffff; background: #2962FF; border: none; border-radius: 4px; cursor: pointer; box-shadow: 0 2px 5px rgba(41,98,255,0.3);">
                                Save & Apply to Chart
                            </button>
                        </div>
                    </div>
                </div>
            `;

            modal.style.display = 'flex';

            // Event Handlers
            const closeModal = () => { modal.style.display = 'none'; };
            document.getElementById('dt-modal-close').onclick = closeModal;
            document.getElementById('dt-btn-cancel').onclick = closeModal;

            // Date checkbox toggle
            const cbDate = document.getElementById('dt-filter-dates');
            const dateInputs = document.getElementById('dt-date-inputs');
            cbDate.onchange = () => {
                dateInputs.style.display = cbDate.checked ? 'flex' : 'none';
            };

            // Preset buttons
            const presetBtns = modal.querySelectorAll('.dt-preset-btn');
            presetBtns.forEach(pBtn => {
                pBtn.onclick = () => {
                    const st = pBtn.getAttribute('data-start');
                    const et = pBtn.getAttribute('data-end');
                    if (st) document.getElementById('dt-start-time').value = st;
                    if (et) document.getElementById('dt-end-time').value = et;
                };
            });

            // Reset button
            document.getElementById('dt-btn-reset').onclick = () => {
                document.getElementById('dt-start-time').value = '09:15';
                document.getElementById('dt-end-time').value = '15:30';
                cbDate.checked = false;
                dateInputs.style.display = 'none';
                document.getElementById('dt-start-date').value = '';
                document.getElementById('dt-end-date').value = '';
            };

            // Save & Apply button
            document.getElementById('dt-btn-save').onclick = () => {
                const startTime = document.getElementById('dt-start-time').value || '09:15';
                const endTime = document.getElementById('dt-end-time').value || '15:30';
                const filterDates = cbDate.checked;
                const startDate = document.getElementById('dt-start-date').value || '';
                const endDate = document.getElementById('dt-end-date').value || '';

                const scopeRadio = modal.querySelector('input[name="dt-scope"]:checked');
                const isSymbolScope = scopeRadio && scopeRadio.value === 'symbol';

                const newSettings = {
                    enabled: true,
                    startTime,
                    endTime,
                    filterDates,
                    startDate,
                    endDate
                };

                if (isSymbolScope) {
                    if (!this.data.symbols) this.data.symbols = {};
                    this.data.symbols[sym] = newSettings;
                } else {
                    this.data.global = newSettings;
                }

                this.saveSettings();
                this.updateButtonLabel();
                closeModal();

                // Clear live candle cache
                if (window._tvLastBar) {
                    window._tvLastBar = {};
                }

                // Force TradingView to immediately re-request and strip dataset bars
                if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
                    const chart = window.tvWidget.activeChart();
                    if (typeof chart.resetData === 'function') {
                        chart.resetData();
                    } else if (typeof chart.setSymbol === 'function') {
                        const currentSym = chart.symbol();
                        chart.setSymbol(currentSym, () => {});
                    }
                }

                this.showToast(`Dataset timing set to ${startTime}–${endTime}. Chart reloaded.`);
            };
        }

        showToast(msg) {
            let toast = document.getElementById('dataset-timing-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'dataset-timing-toast';
                toast.style.cssText = `
                    position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
                    background: #131722; color: #ffffff; padding: 10px 18px; border-radius: 6px;
                    font-size: 13px; font-weight: 500; z-index: 999999; box-shadow: 0 4px 14px rgba(0,0,0,0.3);
                    pointer-events: none; opacity: 0; transition: opacity 0.3s ease;
                `;
                document.body.appendChild(toast);
            }
            toast.innerText = msg;
            toast.style.opacity = '1';
            setTimeout(() => { toast.style.opacity = '0'; }, 3000);
        }
    }

    window.DatasetTimingManager = new DatasetTimingManager();
    window.DatasetTimingUI = window.DatasetTimingManager;
})();
