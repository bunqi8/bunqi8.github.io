/**
 * Historical Candle Buffer Limit Manager & In-Chart TradingView UI Controller
 * 
 * Enforces a strict default 40,000 (40K) historical candle limit to prevent browser tab crashes,
 * excessive RAM consumption, and WebGL buffer exhaustion.
 * 
 * Renders an in-chart limitation card and vertical boundary line directly inside the chart pane
 * (exact TradingView design matching official layout, without disruptive blocking popups or screen dims).
 */

(function(window) {
    'use strict';

    class BarLimitController {
        constructor() {
            this.storageKey = 'tv_chart_max_bars_limit';
            this.defaultLimit = 40000;
            this.btnId = 'header-toolbar-bar-limit';
            this.overlayId = 'tv-bar-limit-overlay';
            this.cardId = 'tv-bar-limit-card';
            this.lineId = 'tv-bar-limit-vertical-line';
            this.badgeId = 'tv-bar-limit-time-badge';

            this._barCounts = {};          // cacheKey -> count of loaded bars
            this._oldestBarTimeSec = {};   // cacheKey -> oldest timestamp in seconds
            this._limitReached = {};       // cacheKey -> boolean
            this._dismissed = {};          // cacheKey -> boolean
            this._isEditorOpen = false;

            this._hookedWidget = false;
            this._lastVisibleRange = null;
            this._currentLineShapeId = null;

            this.init();
        }

        init() {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.mount());
            } else {
                this.mount();
            }
        }

        mount() {
            this.injectButton();
            this.hookChartWidget();
            setInterval(() => {
                this.injectButton();
                this.hookChartWidget();
            }, 2000);
        }

        getLimit() {
            try {
                const saved = localStorage.getItem(this.storageKey);
                if (saved) {
                    const parsed = parseInt(saved, 10);
                    if (!isNaN(parsed) && parsed >= 1000) {
                        return parsed;
                    }
                }
            } catch (_) {}
            return this.defaultLimit;
        }

        setLimit(newLimit) {
            const num = parseInt(newLimit, 10);
            if (isNaN(num) || num < 1000) {
                alert('Please enter a valid candle limit of at least 1,000 bars.');
                return false;
            }

            try {
                localStorage.setItem(this.storageKey, String(num));
            } catch (_) {}

            this.resetCounts();
            this.updateButtonLabel();
            this.hideInChartCard();
            this.reloadChartData();
            return true;
        }

        formatLimitShort(limit) {
            if (limit >= 1000000) return (limit / 1000000).toFixed(1).replace('.0', '') + 'M';
            if (limit >= 1000) return Math.round(limit / 1000) + 'K';
            return String(limit);
        }

        resetCounts() {
            this._barCounts = {};
            this._limitReached = {};
            this._dismissed = {};
            if (window._symbolBarCount) window._symbolBarCount = {};
            this.removeLineShape();
        }

        getBarCount(cacheKey) {
            return this._barCounts[cacheKey] || (window._symbolBarCount ? window._symbolBarCount[cacheKey] : 0) || 0;
        }

        setBarCount(cacheKey, count) {
            const limit = this.getLimit();
            const clamped = Math.min(count, limit);
            this._barCounts[cacheKey] = clamped;
            if (!window._symbolBarCount) window._symbolBarCount = {};
            window._symbolBarCount[cacheKey] = clamped;
        }

        incrementBarCount(cacheKey, delta) {
            const current = this.getBarCount(cacheKey);
            this.setBarCount(cacheKey, current + delta);
        }

        onLiveBarAdded(cacheKey) {
            const limit = this.getLimit();
            const current = this.getBarCount(cacheKey);
            if (current >= limit) {
                this.setBarCount(cacheKey, limit);
            } else {
                this.setBarCount(cacheKey, current + 1);
            }
        }

        setOldestBar(cacheKey, timeSec) {
            if (timeSec && !isNaN(timeSec)) {
                this._oldestBarTimeSec[cacheKey] = timeSec;
            }
        }

        onLimitBoundaryReached(cacheKey, oldestTimeSec = null) {
            this._limitReached[cacheKey] = true;
            if (oldestTimeSec) {
                this._oldestBarTimeSec[cacheKey] = oldestTimeSec;
            }
            this.checkAndUpdateInChartDisplay();
        }

        getCurrentCacheKey() {
            try {
                if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
                    const chart = window.tvWidget.activeChart();
                    const sym = (chart.symbol() || '').replace(/[^A-Za-z0-9_]/g, '');
                    const res = chart.resolution() || '';
                    return `${sym}_${res}`;
                }
            } catch (_) {}
            return null;
        }

        hookChartWidget() {
            if (this._hookedWidget) return;
            if (window.tvWidget && typeof window.tvWidget.chartReady === 'function') {
                window.tvWidget.chartReady().then(() => {
                    this._hookedWidget = true;
                    this.setupChartSubscriptions();
                }).catch(() => {});
            }
        }

        setupChartSubscriptions() {
            try {
                const chart = window.tvWidget.activeChart();
                if (!chart) return;

                if (typeof chart.onVisibleRangeChanged === 'function') {
                    chart.onVisibleRangeChanged().subscribe(null, (range) => {
                        this.onVisibleRangeChanged(range);
                    });
                }

                if (typeof chart.onSymbolChanged === 'function') {
                    chart.onSymbolChanged().subscribe(null, () => {
                        this.onSymbolOrIntervalChanged();
                    });
                }

                if (typeof chart.onIntervalChanged === 'function') {
                    chart.onIntervalChanged().subscribe(null, () => {
                        this.onSymbolOrIntervalChanged();
                    });
                }

                // Initial check
                if (typeof chart.getVisibleRange === 'function') {
                    this.onVisibleRangeChanged(chart.getVisibleRange());
                }
            } catch (e) {
                console.warn('[BarLimitManager] Hook subscriptions warning:', e);
            }
        }

        onSymbolOrIntervalChanged() {
            const key = this.getCurrentCacheKey();
            if (key) {
                this._dismissed[key] = false;
            }
            this.removeLineShape();
            this.hideInChartCard();
        }

        checkAndUpdateInChartDisplay() {
            try {
                if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
                    const chart = window.tvWidget.activeChart();
                    if (chart && typeof chart.getVisibleRange === 'function') {
                        const range = chart.getVisibleRange();
                        this.onVisibleRangeChanged(range);
                    }
                }
            } catch (_) {}
        }

        onVisibleRangeChanged(range) {
            if (!range || isNaN(range.from) || isNaN(range.to)) return;
            this._lastVisibleRange = range;

            const key = this.getCurrentCacheKey();
            if (!key) return;

            const isLimit = this._limitReached[key];
            const oldestSec = this._oldestBarTimeSec[key];

            if (!isLimit || !oldestSec) {
                this.hideInChartCard();
                this.removeLineShape();
                return;
            }

            if (this._dismissed[key]) {
                return;
            }

            // Visible range check:
            // If range.from <= oldestSec + 120, the historical boundary is in or past the left view
            if (range.from <= oldestSec + 120 && range.to >= oldestSec - 600) {
                const chartCont = document.getElementById('tv_chart_container');
                if (!chartCont) return;

                const contWidth = chartCont.clientWidth || window.innerWidth;
                const totalSpan = range.to - range.from;
                if (totalSpan <= 0) return;

                const timeRatio = (oldestSec - range.from) / totalSpan;
                const lineX = Math.round(contWidth * timeRatio);

                this.renderInChartCard(lineX, oldestSec, key);
                this.ensureVerticalLineShape(oldestSec);
            } else {
                this.hideInChartCard();
            }
        }

        ensureVerticalLineShape(oldestSec) {
            try {
                if (this._currentLineShapeId) return; // Shape already placed
                if (!window.tvWidget || typeof window.tvWidget.activeChart !== 'function') return;
                const chart = window.tvWidget.activeChart();
                if (!chart || typeof chart.createShape !== 'function') return;

                chart.createShape({ time: oldestSec }, {
                    shape: 'vertical_line',
                    lock: true,
                    disableSelection: true,
                    disableSave: true,
                    disableUndo: true,
                    overrides: {
                        linecolor: '#2962ff',
                        linewidth: 1.5,
                        linestyle: 1 // dashed line
                    }
                }).then(id => {
                    this._currentLineShapeId = id;
                }).catch(() => {});
            } catch (_) {}
        }

        removeLineShape() {
            try {
                if (this._currentLineShapeId && window.tvWidget) {
                    const chart = window.tvWidget.activeChart();
                    if (chart && typeof chart.removeEntity === 'function') {
                        chart.removeEntity(this._currentLineShapeId, { disableUndo: true });
                    }
                }
            } catch (_) {}
            this._currentLineShapeId = null;
        }

        isDarkTheme() {
            try {
                if (window.tvWidget && typeof window.tvWidget.getTheme === 'function') {
                    return (window.tvWidget.getTheme() || '').toLowerCase() === 'dark';
                }
                const iframe = document.querySelector('#tv_chart_container iframe') || document.querySelector('iframe');
                if (iframe && iframe.contentDocument) {
                    return iframe.contentDocument.body.classList.contains('theme-dark') || 
                           iframe.contentDocument.documentElement.classList.contains('theme-dark');
                }
            } catch (_) {}
            return false;
        }

        getThemeStyles() {
            const isDark = this.isDarkTheme();
            if (isDark) {
                return {
                    isDark: true,
                    cardBg: '#1e222d',
                    cardBorder: '#2a2e39',
                    cardShadow: '0 8px 32px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.25)',
                    textPrimary: '#ffffff',
                    textSecondary: '#b2b5be',
                    textMuted: '#787b86',
                    box1Bg: '#2a2e39',
                    box2Bg: '#1e222d',
                    box2Border: '#363a45',
                    btnBg: '#2962ff',
                    btnHover: '#1e53e5',
                    btnColor: '#ffffff',
                    presetBg: '#2a2e39',
                    presetBorder: '#363a45',
                    inputBg: '#131722',
                    inputBorder: '#363a45'
                };
            } else {
                return {
                    isDark: false,
                    cardBg: '#ffffff',
                    cardBorder: '#e0e3eb',
                    cardShadow: '0 4px 24px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)',
                    textPrimary: '#131722',
                    textSecondary: '#50535e',
                    textMuted: '#787b86',
                    box1Bg: '#f0f3f6',
                    box2Bg: '#ffffff',
                    box2Border: '#e0e3eb',
                    btnBg: '#131722',
                    btnHover: '#2a2e39',
                    btnColor: '#ffffff',
                    presetBg: '#f0f3f6',
                    presetBorder: '#e0e3eb',
                    inputBg: '#ffffff',
                    inputBorder: '#d1d4dc'
                };
            }
        }

        getOrCreateOverlayContainer() {
            const chartCont = document.getElementById('tv_chart_container');
            if (!chartCont) return null;

            let overlay = document.getElementById(this.overlayId);
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = this.overlayId;
                overlay.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    z-index: 45;
                    overflow: hidden;
                    font-family: -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif;
                `;
                chartCont.appendChild(overlay);
            }
            return overlay;
        }

        renderInChartCard(lineX, oldestSec, key) {
            const overlay = this.getOrCreateOverlayContainer();
            if (!overlay) return;

            const chartCont = document.getElementById('tv_chart_container');
            const contWidth = chartCont.clientWidth || window.innerWidth;
            const th = this.getThemeStyles();
            const curLimit = this.getLimit();
            const limitStr = curLimit.toLocaleString();

            // Calculate card horizontal position:
            // Centered in the historical empty space to the left of the line
            const cardWidth = 330;
            let cardLeft = 0;

            if (lineX >= contWidth) {
                cardLeft = Math.round((contWidth - cardWidth) / 2);
            } else if (lineX <= cardWidth + 30) {
                cardLeft = Math.max(14, Math.round((lineX - cardWidth) / 2));
            } else {
                cardLeft = Math.round((lineX - cardWidth) / 2);
                cardLeft = Math.max(18, Math.min(cardLeft, lineX - cardWidth - 20));
            }

            let card = document.getElementById(this.cardId);
            let lineEl = document.getElementById(this.lineId);
            let badgeEl = document.getElementById(this.badgeId);

            // 1. Draw HTML Vertical Dashed Line
            if (!lineEl) {
                lineEl = document.createElement('div');
                lineEl.id = this.lineId;
                lineEl.style.cssText = `
                    position: absolute;
                    top: 0;
                    bottom: 26px;
                    width: 0;
                    border-left: 1.5px dashed #2962ff;
                    pointer-events: none;
                    z-index: 10;
                    transition: left 0.05s linear;
                `;
                overlay.appendChild(lineEl);
            }
            lineEl.style.left = `${lineX}px`;
            lineEl.style.display = (lineX > 0 && lineX < contWidth) ? 'block' : 'none';

            // 2. Draw Time Axis Cutoff Badge
            if (!badgeEl) {
                badgeEl = document.createElement('div');
                badgeEl.id = this.badgeId;
                badgeEl.style.cssText = `
                    position: absolute;
                    bottom: 4px;
                    background: #2962ff;
                    color: #ffffff;
                    font-size: 10px;
                    font-weight: 700;
                    padding: 2px 6px;
                    border-radius: 3px;
                    pointer-events: none;
                    z-index: 12;
                    transform: translateX(-50%);
                    box-shadow: 0 2px 6px rgba(0,0,0,0.25);
                    white-space: nowrap;
                `;
                badgeEl.textContent = 'Data Cutoff';
                overlay.appendChild(badgeEl);
            }
            badgeEl.style.left = `${lineX}px`;
            badgeEl.style.display = (lineX > 20 && lineX < contWidth - 20) ? 'block' : 'none';

            // 3. Render Card (Matching TradingView Screenshot Pixel-for-Pixel)
            if (!card) {
                card = document.createElement('div');
                card.id = this.cardId;
                overlay.appendChild(card);
            }

            card.style.cssText = `
                position: absolute;
                top: 50%;
                left: ${cardLeft}px;
                transform: translateY(-50%);
                width: ${cardWidth}px;
                box-sizing: border-box;
                background: ${th.cardBg};
                border: 1px solid ${th.cardBorder};
                border-radius: 16px;
                box-shadow: ${th.cardShadow};
                padding: 32px 24px 24px;
                text-align: center;
                pointer-events: auto;
                z-index: 20;
                transition: left 0.05s linear, opacity 0.2s ease;
                display: flex;
                flex-direction: column;
                align-items: center;
            `;

            // If user has opened the inline editor, render editor; otherwise render standard TV layout
            if (this._isEditorOpen) {
                this.renderCardEditor(card, th, curLimit, key);
            } else {
                this.renderCardStandard(card, th, limitStr, key);
            }
        }

        renderCardStandard(card, th, limitStr, key) {
            card.innerHTML = `
                <!-- Close Button -->
                <button id="btn-tv-limit-close" style="position: absolute; top: 14px; right: 16px; background: none; border: none; font-size: 20px; color: ${th.textMuted}; cursor: pointer; line-height: 1; padding: 2px 4px;" title="Dismiss">&times;</button>
                
                <!-- Outline Rocket SVG (Exact match to TradingView screenshot) -->
                <div style="color: ${th.textPrimary}; margin-bottom: 2px;">
                    <svg width="44" height="44" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M24 6C24 6 15 15 15 27C15 32 18 36.5 21 38.5V42H27V38.5C30 36.5 33 32 33 27C33 15 24 6 24 6Z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                        <circle cx="24" cy="22" r="3.2" stroke="currentColor" stroke-width="2.2"/>
                        <path d="M15 28L9 34V38L15 37" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M33 28L39 34V38L33 37" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M21 42V44H27V42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </div>

                <!-- Title -->
                <div style="font-size: 20px; font-weight: 700; color: ${th.textPrimary}; margin-top: 14px; margin-bottom: 6px;">
                    Historical data limit
                </div>

                <!-- Subtitle explaining limitations (Not upgrade) -->
                <div style="font-size: 13px; line-height: 1.45; color: ${th.textSecondary}; margin-bottom: 18px;">
                    You're limited to ${limitStr} bars. Loading further back is restricted to prevent browser memory crashes.
                </div>

                <!-- Box 1: Current Active Limit -->
                <div style="background: ${th.box1Bg}; border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; width: 100%; box-sizing: border-box;">
                    <div style="text-align: left;">
                        <div style="font-size: 11px; color: ${th.textMuted}; font-weight: 500;">Current</div>
                        <div style="font-size: 13.5px; font-weight: 700; color: ${th.textPrimary};">Active limit</div>
                    </div>
                    <div style="font-size: 13.5px; font-weight: 500; color: ${th.textPrimary};">${limitStr} bars</div>
                </div>

                <!-- Box 2: Recommended Safe Buffer -->
                <div style="background: ${th.box2Bg}; border: 1px solid ${th.box2Border}; border-radius: 8px; padding: 10px 14px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; width: 100%; box-sizing: border-box;">
                    <div style="text-align: left;">
                        <div style="font-size: 11px; color: ${th.textMuted}; font-weight: 500;">Recommended</div>
                        <div style="font-size: 13.5px; font-weight: 700; color: ${th.textPrimary};">Safe buffer</div>
                    </div>
                    <div style="font-size: 13.5px; font-weight: 500; color: ${th.textPrimary};">40,000 bars</div>
                </div>

                <!-- Action Button: Adjust Bar Limit -->
                <button id="btn-tv-limit-adjust" style="background: ${th.btnBg}; color: ${th.btnColor}; border: none; border-radius: 8px; padding: 12px 20px; font-size: 14px; font-weight: 600; cursor: pointer; width: 100%; transition: background 0.15s;">
                    Adjust bar limit
                </button>
            `;

            const closeBtn = card.querySelector('#btn-tv-limit-close');
            if (closeBtn) {
                closeBtn.onclick = (e) => {
                    e.stopPropagation();
                    this._dismissed[key] = true;
                    this.hideInChartCard();
                };
            }

            const adjustBtn = card.querySelector('#btn-tv-limit-adjust');
            if (adjustBtn) {
                adjustBtn.onclick = (e) => {
                    e.stopPropagation();
                    this._isEditorOpen = true;
                    this.checkAndUpdateInChartDisplay();
                };
            }
        }

        renderCardEditor(card, th, curLimit, key) {
            card.innerHTML = `
                <!-- Close Button -->
                <button id="btn-tv-editor-close" style="position: absolute; top: 14px; right: 16px; background: none; border: none; font-size: 20px; color: ${th.textMuted}; cursor: pointer; line-height: 1; padding: 2px 4px;" title="Dismiss">&times;</button>

                <div style="font-size: 16px; font-weight: 700; color: ${th.textPrimary}; margin-bottom: 4px;">
                    Configure Candle Limit
                </div>
                <div style="font-size: 11.5px; color: ${th.textSecondary}; margin-bottom: 14px;">
                    Select a preset or set a custom bar buffer
                </div>

                <!-- Presets -->
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; width: 100%; margin-bottom: 12px;">
                    <button type="button" class="tv-card-preset" data-val="5000" style="background: ${curLimit===5000?'#2962ff':th.presetBg}; color: ${curLimit===5000?'#fff':th.textPrimary}; border: 1px solid ${curLimit===5000?'#2962ff':th.presetBorder}; padding: 7px 2px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">5K</button>
                    <button type="button" class="tv-card-preset" data-val="10000" style="background: ${curLimit===10000?'#2962ff':th.presetBg}; color: ${curLimit===10000?'#fff':th.textPrimary}; border: 1px solid ${curLimit===10000?'#2962ff':th.presetBorder}; padding: 7px 2px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">10K</button>
                    <button type="button" class="tv-card-preset" data-val="20000" style="background: ${curLimit===20000?'#2962ff':th.presetBg}; color: ${curLimit===20000?'#fff':th.textPrimary}; border: 1px solid ${curLimit===20000?'#2962ff':th.presetBorder}; padding: 7px 2px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">20K</button>
                    <button type="button" class="tv-card-preset" data-val="40000" style="background: ${curLimit===40000?'#2962ff':th.presetBg}; color: ${curLimit===40000?'#fff':th.textPrimary}; border: 1px solid ${curLimit===40000?'#2962ff':th.presetBorder}; padding: 7px 2px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">40K</button>
                </div>

                <!-- Custom Input -->
                <div style="width: 100%; margin-bottom: 10px; text-align: left;">
                    <label style="font-size: 11px; color: ${th.textMuted}; display: block; margin-bottom: 4px; font-weight: 500;">Custom Limit (Bars):</label>
                    <input id="tv-card-limit-input" type="number" min="1000" step="1000" value="${curLimit}" style="width: 100%; box-sizing: border-box; background: ${th.inputBg}; border: 1px solid ${th.inputBorder}; color: ${th.textPrimary}; padding: 8px 10px; border-radius: 6px; font-size: 13px; font-family: monospace; outline: none;">
                </div>

                <!-- Dynamic Warning for > 40K -->
                <div id="tv-card-risk-warning" style="display: ${curLimit > 40000 ? 'block' : 'none'}; background: rgba(242, 54, 69, 0.1); border: 1px solid #f23645; border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; width: 100%; box-sizing: border-box; text-align: left;">
                    <div style="font-size: 11px; font-weight: 700; color: #ff5252; margin-bottom: 2px;">⚠️ High Memory Risk</div>
                    <div style="font-size: 10.5px; line-height: 1.35; color: ${th.textSecondary};">
                        Values &gt; 40,000 bars can cause browser RAM exhaustion and tab crashes.
                    </div>
                    <label style="display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 10.5px; color: ${th.textPrimary}; cursor: pointer;">
                        <input type="checkbox" id="tv-card-risk-cb" style="width: 13px; height: 13px; cursor: pointer;">
                        <span>I accept crash risk</span>
                    </label>
                </div>

                <!-- Action Buttons -->
                <div style="display: flex; gap: 8px; width: 100%; margin-top: 4px;">
                    <button id="btn-tv-editor-cancel" style="background: transparent; border: 1px solid ${th.box2Border}; color: ${th.textPrimary}; padding: 8px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; flex: 1;">Cancel</button>
                    <button id="btn-tv-editor-apply" style="background: ${th.btnBg}; color: ${th.btnColor}; border: none; padding: 8px 16px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; flex: 1.2;">Apply</button>
                </div>
            `;

            const input = card.querySelector('#tv-card-limit-input');
            const riskBox = card.querySelector('#tv-card-risk-warning');
            const riskCb = card.querySelector('#tv-card-risk-cb');
            const presetBtns = card.querySelectorAll('.tv-card-preset');

            const checkRisk = () => {
                const val = parseInt(input.value, 10) || 0;
                if (val > 40000) {
                    riskBox.style.display = 'block';
                } else {
                    riskBox.style.display = 'none';
                    if (riskCb) riskCb.checked = false;
                }
            };

            presetBtns.forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const bVal = btn.getAttribute('data-val');
                    input.value = bVal;
                    presetBtns.forEach(b => {
                        b.style.background = th.presetBg;
                        b.style.borderColor = th.presetBorder;
                        b.style.color = th.textPrimary;
                    });
                    btn.style.background = '#2962ff';
                    btn.style.borderColor = '#2962ff';
                    btn.style.color = '#fff';
                    checkRisk();
                };
            });

            input.oninput = () => {
                const val = parseInt(input.value, 10);
                presetBtns.forEach(btn => {
                    const bVal = parseInt(btn.getAttribute('data-val'), 10);
                    if (bVal === val) {
                        btn.style.background = '#2962ff';
                        btn.style.borderColor = '#2962ff';
                        btn.style.color = '#fff';
                    } else {
                        btn.style.background = th.presetBg;
                        btn.style.borderColor = th.presetBorder;
                        btn.style.color = th.textPrimary;
                    }
                });
                checkRisk();
            };

            const closeEditor = () => {
                this._isEditorOpen = false;
                this.checkAndUpdateInChartDisplay();
            };

            const cancelBtn = card.querySelector('#btn-tv-editor-cancel');
            if (cancelBtn) cancelBtn.onclick = (e) => { e.stopPropagation(); closeEditor(); };

            const closeX = card.querySelector('#btn-tv-editor-close');
            if (closeX) closeX.onclick = (e) => { e.stopPropagation(); closeEditor(); };

            const applyBtn = card.querySelector('#btn-tv-editor-apply');
            if (applyBtn) {
                applyBtn.onclick = (e) => {
                    e.stopPropagation();
                    const targetLimit = parseInt(input.value, 10);
                    if (isNaN(targetLimit) || targetLimit < 1000) {
                        alert('Please enter a valid limit (minimum 1,000 candles).');
                        return;
                    }

                    if (targetLimit > 40000 && riskCb && !riskCb.checked) {
                        alert('Please confirm that you accept the risk of potential browser tab crashes by checking the box.');
                        return;
                    }

                    this._isEditorOpen = false;
                    this.setLimit(targetLimit);
                };
            }
        }

        hideInChartCard() {
            const card = document.getElementById(this.cardId);
            if (card) card.remove();

            const lineEl = document.getElementById(this.lineId);
            if (lineEl) lineEl.style.display = 'none';

            const badgeEl = document.getElementById(this.badgeId);
            if (badgeEl) badgeEl.style.display = 'none';
        }

        reloadChartData() {
            try {
                if (window.tvWidget) {
                    if (typeof window.tvWidget.resetCache === 'function') {
                        window.tvWidget.resetCache();
                    }
                    if (typeof window.tvWidget.activeChart === 'function') {
                        const chart = window.tvWidget.activeChart();
                        if (chart && typeof chart.resetData === 'function') {
                            chart.resetData();
                        }
                    }
                }
            } catch (e) {
                console.warn('[BarLimitManager] Chart reload warning:', e);
            }
        }

        // --- Toolbar Button Injection ---
        injectButton(targetEl = null, iframeDoc = null) {
            if (!iframeDoc) {
                const iframe = document.querySelector('#tv_chart_container iframe') || document.querySelector('iframe[id^="tradingview_"]');
                if (iframe) {
                    try {
                        iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    } catch (_) {}
                }
            }
            const targetDoc = iframeDoc || document;

            if (targetDoc.getElementById(this.btnId)) {
                this.updateButtonLabel();
                return;
            }

            const refTarget = targetEl || 
                              targetDoc.getElementById('header-toolbar-option-chain') ||
                              targetDoc.getElementById('header-toolbar-symbol-search') ||
                              targetDoc.querySelector('.group-wWM3zP_M') ||
                              targetDoc.querySelector('.group-MBOVGQRI');

            if (!refTarget || !refTarget.parentNode) return;

            const limitShort = this.formatLimitShort(this.getLimit());
            const btnContainer = targetDoc.createElement('div');
            btnContainer.id = this.btnId;
            btnContainer.className = 'group-MBOVGQRI';
            btnContainer.style.cssText = 'margin: 0 4px; display: inline-flex; align-items: center; vertical-align: middle;';

            btnContainer.innerHTML = `
                <button type="button" class="button-OhqNVIYA button-ptpAHg8E button-GwQQdU8S apply-common-tooltip isInteractive-GwQQdU8S accessible-GwQQdU8S"
                        style="display: flex; align-items: center; gap: 5px; height: 28px; padding: 0 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); cursor: pointer; color: #d1d4dc; font-size: 11.5px; font-weight: 600;"
                        title="Historical Candle Buffer Limit (Click to view or adjust)">
                    <span style="font-size: 13px; line-height: 1;">📊</span>
                    <span id="bar-limit-badge-text" style="color: #2962ff; font-weight: 700;">${limitShort}</span>
                    <span style="font-size: 10px; opacity: 0.65; color: #9db2c6;">Bars</span>
                </button>
            `;

            btnContainer.querySelector('button').onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Toggle editor or scroll chart to oldest bar
                const key = this.getCurrentCacheKey();
                if (key) {
                    this._dismissed[key] = false;
                }
                this._isEditorOpen = true;
                try {
                    if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
                        const chart = window.tvWidget.activeChart();
                        if (typeof chart.scrollToFirstBar === 'function') {
                            chart.scrollToFirstBar();
                        }
                    }
                } catch (_) {}
                this.checkAndUpdateInChartDisplay();
            };

            refTarget.parentNode.insertBefore(btnContainer, refTarget.nextSibling);
        }

        updateButtonLabel() {
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach(ifr => {
                try {
                    const doc = ifr.contentDocument || ifr.contentWindow.document;
                    const badge = doc.getElementById('bar-limit-badge-text');
                    if (badge) badge.textContent = this.formatLimitShort(this.getLimit());
                } catch (_) {}
            });
            const badge = document.getElementById('bar-limit-badge-text');
            if (badge) badge.textContent = this.formatLimitShort(this.getLimit());
        }
    }

    window.BarLimitController = BarLimitController;
    window.BarLimitManager = new BarLimitController();
    window.BarLimitUI = window.BarLimitManager;

})(window);
