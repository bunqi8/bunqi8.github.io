/**
 * Historical Candle Buffer Limit Manager & In-Chart TradingView UI Controller
 * 
 * Enforces a strict default 40,000 (40K) historical candle limit to prevent browser tab crashes,
 * excessive RAM consumption, and WebGL buffer exhaustion.
 * 
 * Key Features:
 * 1. Clean, refined Light-Theme TradingView UI matching the site's official white styling.
 * 2. In-chart card placed strictly on chart canvas to the right of the left drawing toolbar (left >= 68px).
 * 3. Direct 1-click expansion up to 40,000 bars and quick presets that instantly load earlier candles
 *    seamlessly without blanking the chart or jumping the camera view.
 * 4. Manual bar input with confirmation (expansion only from card; reduction via top toolbar button).
 * 5. Complete theme adaptability (crisp white in light theme; #1e222d in dark theme).
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
            this.modalId = 'bar-limit-settings-modal';

            this._barCounts = {};          // cacheKey -> count of loaded bars
            this._oldestBarTimeSec = {};   // cacheKey -> oldest timestamp in seconds
            this._limitReached = {};       // cacheKey -> boolean
            this._dismissed = {};          // cacheKey -> boolean
            this._isExpanding = false;

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

            const key = this.getCurrentCacheKey();
            if (key && window._barsCache && window._barsCache[key]) {
                if (window._barsCache[key].length > num) {
                    window._barsCache[key] = window._barsCache[key].slice(window._barsCache[key].length - num);
                }
            }

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
                // When new candle forms and chart is at capacity, oldest candle vanishes
                if (window._barsCache && window._barsCache[cacheKey] && window._barsCache[cacheKey].length >= limit) {
                    window._barsCache[cacheKey].shift();
                    const newOldest = window._barsCache[cacheKey][0];
                    if (newOldest) {
                        this.setOldestBar(cacheKey, Math.floor(newOldest.time / 1000));
                    }
                }
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
                    const raw = chart.symbol() || '';
                    const clean = raw.split(':').pop().toUpperCase().replace(/[^A-Z0-9]/g, '');
                    const res = chart.resolution() || '5';
                    return `${clean}_${res}`;
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
                if (this._currentLineShapeId) return;
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
                    inputBorder: '#363a45',
                    modalBg: '#1e222d',
                    modalBorder: '#2a2e39',
                    modalHeaderBg: '#181b22',
                    modalFooterBg: '#181b22',
                    modalBackdrop: 'rgba(0, 0, 0, 0.65)'
                };
            } else {
                return {
                    isDark: false,
                    cardBg: '#ffffff',
                    cardBorder: '#e0e3eb',
                    cardShadow: '0 4px 24px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04)',
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
                    inputBorder: '#d1d4dc',
                    modalBg: '#ffffff',
                    modalBorder: '#e0e3eb',
                    modalHeaderBg: '#ffffff',
                    modalFooterBg: '#fafbfc',
                    modalBackdrop: 'rgba(0, 0, 0, 0.35)'
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

                if (!document.getElementById('tv-limit-anim-styles')) {
                    const st = document.createElement('style');
                    st.id = 'tv-limit-anim-styles';
                    st.textContent = `
                        @keyframes tvSpin {
                            from { transform: rotate(0deg); }
                            to { transform: rotate(360deg); }
                        }
                    `;
                    document.head.appendChild(st);
                }

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

            // Clear left drawing toolbar (width ~52px to 64px)
            const leftToolbarOffset = 68;
            const cardWidth = 330;
            const availableSpace = lineX - leftToolbarOffset;

            let cardLeft = leftToolbarOffset;
            if (lineX >= contWidth) {
                cardLeft = Math.round(leftToolbarOffset + Math.max(16, (contWidth - leftToolbarOffset - cardWidth) / 2));
            } else if (availableSpace > cardWidth + 24) {
                cardLeft = Math.round(leftToolbarOffset + (availableSpace - cardWidth) / 2);
            } else {
                cardLeft = leftToolbarOffset + 8;
            }

            let card = document.getElementById(this.cardId);
            let lineEl = document.getElementById(this.lineId);
            let badgeEl = document.getElementById(this.badgeId);

            // 1. Vertical Dashed Line
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
            lineEl.style.display = (lineX > leftToolbarOffset && lineX < contWidth) ? 'block' : 'none';

            // 2. Cutoff Badge
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
                    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
                    white-space: nowrap;
                `;
                badgeEl.textContent = 'Data Cutoff';
                overlay.appendChild(badgeEl);
            }
            badgeEl.style.left = `${lineX}px`;
            badgeEl.style.display = (lineX > leftToolbarOffset + 20 && lineX < contWidth - 20) ? 'block' : 'none';

            // 3. Card Container
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
                padding: 28px 22px 22px;
                text-align: center;
                pointer-events: auto;
                z-index: 20;
                transition: left 0.05s linear, opacity 0.2s ease;
                display: flex;
                flex-direction: column;
                align-items: center;
            `;

            // If an expansion operation is currently executing, render loading state
            if (this._isExpanding) {
                card.innerHTML = `
                    <div style="padding: 24px 10px; display: flex; flex-direction: column; align-items: center; gap: 12px;">
                        <div style="font-size: 32px; animation: tvSpin 1s linear infinite;">⏳</div>
                        <div style="font-size: 15px; font-weight: 700; color: #2962ff;">
                            Expanding to ${this.getLimit().toLocaleString()} bars...
                        </div>
                        <div style="font-size: 12px; color: ${th.textSecondary};">
                            Loading earlier candles seamlessly...
                        </div>
                    </div>
                `;
                return;
            }

            // Available expansion presets (ONLY values greater than current limit)
            const allPresets = [5000, 10000, 20000, 40000];
            const expandPresets = allPresets.filter(val => val > curLimit);

            let presetsHtml = '';
            if (expandPresets.length > 0) {
                presetsHtml = `
                    <div style="width: 100%; margin-bottom: 12px;">
                        <div style="font-size: 11px; font-weight: 600; color: ${th.textMuted}; text-align: left; margin-bottom: 6px;">
                            Quick 1-Click Expansion:
                        </div>
                        <div style="display: flex; gap: 6px;">
                            ${expandPresets.map(p => `
                                <button type="button" class="btn-card-quick-preset" data-val="${p}" style="flex: 1; background: rgba(41, 98, 255, 0.06); border: 1px solid rgba(41, 98, 255, 0.3); color: #2962ff; padding: 7px 4px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.15s;">
                                    +${this.formatLimitShort(p)} ⚡
                                </button>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            card.innerHTML = `
                <!-- Close Button -->
                <button id="btn-tv-limit-close" style="position: absolute; top: 12px; right: 14px; background: none; border: none; font-size: 20px; color: ${th.textMuted}; cursor: pointer; line-height: 1; padding: 2px 4px;" title="Dismiss">&times;</button>
                
                <!-- Outline Rocket SVG -->
                <div style="color: ${th.textPrimary}; margin-bottom: 2px;">
                    <svg width="42" height="42" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M24 6C24 6 15 15 15 27C15 32 18 36.5 21 38.5V42H27V38.5C30 36.5 33 32 33 27C33 15 24 6 24 6Z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                        <circle cx="24" cy="22" r="3.2" stroke="currentColor" stroke-width="2.2"/>
                        <path d="M15 28L9 34V38L15 37" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M33 28L39 34V38L33 37" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M21 42V44H27V42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </div>

                <!-- Title -->
                <div style="font-size: 19px; font-weight: 700; color: ${th.textPrimary}; margin-top: 10px; margin-bottom: 4px;">
                    Historical data limit
                </div>

                <!-- Subtitle -->
                <div style="font-size: 12.5px; line-height: 1.45; color: ${th.textSecondary}; margin-bottom: 14px;">
                    You're limited to ${limitStr} bars. Loading further back is restricted to prevent browser memory crashes.
                </div>

                <!-- Box 1: Current Limit (Static Display) -->
                <div style="background: ${th.box1Bg}; border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; width: 100%; box-sizing: border-box;">
                    <div style="text-align: left;">
                        <div style="font-size: 10.5px; color: ${th.textMuted}; font-weight: 500;">Current</div>
                        <div style="font-size: 13.5px; font-weight: 700; color: ${th.textPrimary};">Active limit</div>
                    </div>
                    <div style="font-size: 13.5px; font-weight: 600; color: ${th.textPrimary};">${limitStr} bars</div>
                </div>

                <!-- Box 2: Recommended 40,000 Bars (DIRECT 1-CLICK EXPANSION FEATURE) -->
                <div id="box-card-recommended-40k" style="background: ${curLimit < 40000 ? 'rgba(41, 98, 255, 0.05)' : th.box2Bg}; border: 1.5px solid ${curLimit < 40000 ? '#2962ff' : th.box2Border}; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; width: 100%; box-sizing: border-box; cursor: ${curLimit < 40000 ? 'pointer' : 'default'}; transition: all 0.15s ease;" title="${curLimit < 40000 ? 'Click to instantly expand limit to 40,000 bars' : 'Active buffer is at safe maximum'}">
                    <div style="text-align: left;">
                        <div style="font-size: 10.5px; color: ${curLimit < 40000 ? '#2962ff' : th.textMuted}; font-weight: 600; display: flex; align-items: center; gap: 4px;">
                            <span>Recommended</span>
                            ${curLimit < 40000 ? '<span style="background: #2962ff; color: #fff; font-size: 8.5px; padding: 1px 4px; border-radius: 3px; font-weight: 700;">1-CLICK</span>' : ''}
                        </div>
                        <div style="font-size: 13.5px; font-weight: 700; color: ${th.textPrimary};">Safe buffer</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 5px;">
                        <span style="font-size: 13.5px; font-weight: 700; color: ${curLimit < 40000 ? '#2962ff' : th.textPrimary};">40,000 bars</span>
                        ${curLimit < 40000 ? '<span style="font-size: 14px; color: #2962ff;">⚡</span>' : ''}
                    </div>
                </div>

                ${presetsHtml}

                <!-- Manual Input and Confirm (Expansion Only) -->
                <div style="width: 100%; margin-bottom: 8px;">
                    <div style="display: flex; gap: 6px;">
                        <input id="card-custom-input" type="number" min="${curLimit + 1000}" step="1000" placeholder="Custom bars (> ${curLimit.toLocaleString()})" style="flex: 1; padding: 8px 10px; font-size: 12px; border-radius: 6px; border: 1px solid ${th.box2Border}; background: ${th.inputBg}; color: ${th.textPrimary}; outline: none; font-family: monospace;">
                        <button id="btn-card-custom-confirm" style="background: ${th.btnBg}; color: ${th.btnColor}; border: none; border-radius: 6px; padding: 0 14px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background 0.15s;">
                            Expand
                        </button>
                    </div>
                    
                    <div id="card-input-validation-msg" style="display: none; font-size: 10.5px; text-align: left; margin-top: 4px; line-height: 1.35;"></div>
                    
                    <div id="card-risk-warning" style="display: none; background: #fff5f5; border: 1px solid #fecaca; border-radius: 6px; padding: 6px 8px; margin-top: 6px; text-align: left;">
                        <div style="font-size: 10.5px; font-weight: 700; color: #dc2626;">⚠️ High Memory Risk (&gt;40K)</div>
                        <label style="display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 10px; color: #991b1b; cursor: pointer;">
                            <input type="checkbox" id="card-risk-cb" style="width: 12px; height: 12px; cursor: pointer;">
                            <span>Accept risk of browser tab crash</span>
                        </label>
                    </div>
                </div>

                <div style="font-size: 10px; color: ${th.textMuted}; line-height: 1.3; margin-top: 2px;">
                    💡 Card only expands. To reduce bars, use top toolbar <strong>📊 Bars</strong> button.
                </div>
            `;

            // Setup Event Handlers
            const closeBtn = card.querySelector('#btn-tv-limit-close');
            if (closeBtn) {
                closeBtn.onclick = (e) => {
                    e.stopPropagation();
                    this._dismissed[key] = true;
                    this.hideInChartCard();
                };
            }

            // Direct 1-Click Click on Recommended Box (Up to 40K)
            const recBox = card.querySelector('#box-card-recommended-40k');
            if (recBox && curLimit < 40000) {
                recBox.onclick = (e) => {
                    e.stopPropagation();
                    this.expandLimitSeamlessly(40000);
                };
            }

            // Quick Preset Buttons
            const presetBtns = card.querySelectorAll('.btn-card-quick-preset');
            presetBtns.forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const target = parseInt(btn.getAttribute('data-val'), 10);
                    if (target > curLimit) {
                        this.expandLimitSeamlessly(target);
                    }
                };
            });

            // Manual Input Validation and Expansion
            const input = card.querySelector('#card-custom-input');
            const confirmBtn = card.querySelector('#btn-card-custom-confirm');
            const valMsg = card.querySelector('#card-input-validation-msg');
            const riskBox = card.querySelector('#card-risk-warning');
            const riskCb = card.querySelector('#card-risk-cb');

            const validateInput = () => {
                const val = parseInt(input.value, 10);
                if (isNaN(val) || !val) {
                    valMsg.style.display = 'none';
                    riskBox.style.display = 'none';
                    return;
                }

                if (val <= curLimit) {
                    valMsg.style.display = 'block';
                    valMsg.style.color = '#dc2626';
                    valMsg.textContent = `⚠️ You can only expand from here (> ${curLimit.toLocaleString()}). Use top toolbar to reduce.`;
                    riskBox.style.display = 'none';
                } else if (val > 40000) {
                    valMsg.style.display = 'none';
                    riskBox.style.display = 'block';
                } else {
                    valMsg.style.display = 'none';
                    riskBox.style.display = 'none';
                }
            };

            input.oninput = validateInput;

            confirmBtn.onclick = (e) => {
                e.stopPropagation();
                const target = parseInt(input.value, 10);
                if (isNaN(target) || target <= curLimit) {
                    valMsg.style.display = 'block';
                    valMsg.style.color = '#dc2626';
                    valMsg.textContent = `Please enter a value higher than current limit (${curLimit.toLocaleString()} bars).`;
                    return;
                }

                if (target > 40000 && riskCb && !riskCb.checked) {
                    alert('Please confirm that you accept the risk of potential browser tab crashes by checking the box.');
                    return;
                }

                this.expandLimitSeamlessly(target);
            };

            input.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    confirmBtn.click();
                }
            };
        }

        // Seamless Expansion Execution (No Blank Data, No Viewport Jump)
        async expandLimitSeamlessly(targetLimit) {
            const key = this.getCurrentCacheKey();
            if (!key) return;

            this._isExpanding = true;

            // Show immediate spinner feedback on in-chart card
            const card = document.getElementById(this.cardId);
            const th = this.getThemeStyles();
            if (card) {
                card.innerHTML = `
                    <div style="padding: 24px 10px; display: flex; flex-direction: column; align-items: center; gap: 12px;">
                        <div style="font-size: 32px; animation: tvSpin 1s linear infinite;">⏳</div>
                        <div style="font-size: 15px; font-weight: 700; color: #2962ff;">
                            Expanding to ${targetLimit.toLocaleString()} bars...
                        </div>
                        <div style="font-size: 12px; color: ${th.textSecondary};">
                            Loading earlier candles seamlessly...
                        </div>
                    </div>
                `;
            }

            // 1. Update limit in storage & memory
            localStorage.setItem(this.storageKey, String(targetLimit));
            this._limitReached[key] = false;
            this._dismissed[key] = false;
            this.updateButtonLabel();

            // 2. Fetch earlier candles proactively from MT5 if connected
            try {
                if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
                    const chart = window.tvWidget.activeChart();
                    const sym = chart.symbol();
                    const cleanSym = (sym || 'EURUSD').split(':').pop().toUpperCase().trim();
                    const res = chart.resolution() || '5';

                    const isMt5 = (window.MT5API && typeof window.MT5API.isMt5Symbol === 'function' && window.MT5API.isMt5Symbol(sym)) ||
                                  (sym && sym.startsWith('MT5:')) ||
                                  (window.MT5API && window.MT5API.quotes && window.MT5API.quotes[cleanSym]);

                    if (isMt5 && window.MT5API) {
                        const currentBars = (window._barsCache && window._barsCache[key]) ? window._barsCache[key] : [];
                        const oldestSec = currentBars.length > 0 
                            ? Math.floor(currentBars[0].time / 1000) 
                            : (this._oldestBarTimeSec[key] || Math.floor(Date.now() / 1000));

                        const currentCount = currentBars.length;
                        const batchSize = Math.max(500, Math.min(2500, targetLimit - currentCount));

                        console.log(`[BarLimitManager] Proactively fetching ${batchSize} earlier bars prior to ${new Date(oldestSec * 1000).toISOString()}`);
                        
                        const newBars = await window.MT5API.fetchBars(cleanSym, res, null, oldestSec, batchSize);
                        
                        if (newBars && newBars.length > 0) {
                            const maxAllowedTime = Date.now() + 300000;
                            const isDwm = String(res).toUpperCase().includes('D') || 
                                          String(res).toUpperCase().includes('W') || 
                                          String(res).toUpperCase().includes('M');
                            const validNew = newBars
                                .filter(b => b.time && b.time < (oldestSec * 1000) && b.time <= maxAllowedTime && !isNaN(b.close))
                                .map(b => {
                                    if (isDwm) {
                                        const d = new Date(b.time);
                                        d.setUTCHours(0, 0, 0, 0);
                                        return { ...b, time: d.getTime() };
                                    }
                                    return b;
                                });
                            
                            if (validNew.length > 0) {
                                const map = new Map();
                                for (const b of validNew) map.set(b.time, b);
                                for (const b of currentBars) map.set(b.time, b);
                                const combined = Array.from(map.values()).sort((a, b) => a.time - b.time);
                                
                                if (!window._barsCache) window._barsCache = {};
                                window._barsCache[key] = combined;
                                this.setBarCount(key, combined.length);
                                this.setOldestBar(key, Math.floor(combined[0].time / 1000));
                                console.log(`[BarLimitManager] Cache expanded with ${validNew.length} earlier bars. Total now: ${combined.length}`);
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn('[BarLimitManager] Pre-fetch earlier bars warning:', err);
            }

            // 3. Save visible range
            let savedRange = null;
            let chartRef = null;
            try {
                if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
                    chartRef = window.tvWidget.activeChart();
                    if (chartRef && typeof chartRef.getVisibleRange === 'function') {
                        savedRange = chartRef.getVisibleRange();
                    }
                }
            } catch (_) {}

            // 4. Hook onDataLoaded to seamlessly restore visible range
            if (chartRef && typeof chartRef.onDataLoaded === 'function' && savedRange) {
                chartRef.onDataLoaded().subscribe(null, () => {
                    setTimeout(() => {
                        try {
                            if (savedRange && chartRef.setVisibleRange) {
                                chartRef.setVisibleRange(savedRange, { percentRightMargin: 0 }).catch(() => {});
                            }
                        } catch (_) {}
                    }, 25);
                }, true);
            }

            // 5. Trigger resetCache and chart.resetData()
            try {
                if (window.tvWidget && typeof window.tvWidget.resetCache === 'function') {
                    window.tvWidget.resetCache();
                } else if (typeof window._tvResetCache === 'function') {
                    window._tvResetCache();
                }

                if (chartRef && typeof chartRef.resetData === 'function') {
                    chartRef.resetData();
                }

                const cw = chartRef ? chartRef._chartWidget : null;
                if (cw && typeof cw.model === 'function') {
                    const model = cw.model();
                    const ms = model ? model.mainSeries() : null;
                    if (ms) {
                        ms._requestMoreDataAvailable = true;
                        if (ms._lastCompleteFlags) {
                            delete ms._lastCompleteFlags.data_completed;
                        }
                    }
                }
            } catch (e) {
                console.warn('[BarLimitManager] Reset execution error:', e);
            }

            // 6. Complete expansion & hide card
            this._isExpanding = false;
            this.hideInChartCard();
            this.removeLineShape();
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

        // --- Toolbar Button Injection (Exact TradingView Icon & Style) ---
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

            const watchlistWrap = targetDoc.getElementById('tv-watchlist-toolbar-wrapper');
            const optionChainWrapper = targetDoc.getElementById('header-toolbar-option-chain');
            const symbolSearch = targetDoc.getElementById('header-toolbar-symbol-search') || targetEl;

            let refTarget = watchlistWrap || optionChainWrapper || symbolSearch;
            if (!refTarget) {
                refTarget = targetDoc.querySelector('.group-wWM3zP_M') || targetDoc.querySelector('.group-MBOVGQRI');
            }

            if (!refTarget || !refTarget.parentNode) return;

            const limitShort = this.formatLimitShort(this.getLimit());
            const btnContainer = targetDoc.createElement('div');
            btnContainer.id = 'header-toolbar-bar-limit-wrap';
            btnContainer.className = 'group-MBOVGQRI';
            btnContainer.style.cssText = 'margin: 0 4px; display: inline-flex; align-items: center; vertical-align: middle;';

            btnContainer.innerHTML = `
                <button aria-label="Candle Limit (${limitShort})" data-role="button" data-tooltip="Historical Candle Limit (${limitShort})" tabindex="-1" type="button" 
                    class="button-OhqNVIYA button-ptpAHg8E button-GwQQdU8S apply-common-tooltip isInteractive-GwQQdU8S accessible-GwQQdU8S" 
                    id="${this.btnId}" 
                    style="padding: 0 6px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; height: 28px; border: none; background: transparent; border-radius: 4px; transition: background 0.15s; color: inherit;">
                    <span role="img" class="icon-GwQQdU8S" aria-hidden="true" style="display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; color: currentColor;">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="24" height="24" fill="none">
                            <!-- Crisp TradingView candlestick bars -->
                            <path stroke="currentColor" stroke-width="1.2" stroke-linecap="round" d="M7 6v16M13 5v18M19 8v14"/>
                            <rect x="5.5" y="9.5" width="3" height="8" rx="0.5" fill="currentColor"/>
                            <rect x="11.5" y="8" width="3" height="11" rx="0.5" fill="currentColor"/>
                            <rect x="17.5" y="11" width="3" height="7" rx="0.5" fill="currentColor"/>
                            <!-- Limit cutoff line on right -->
                            <path stroke="#2962ff" stroke-width="1.4" stroke-dasharray="2 2" stroke-linecap="round" d="M24 4v20"/>
                        </svg>
                    </span>
                    <span id="bar-limit-badge-text" style="font-size: 13px; font-weight: 700; color: #2962ff; font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif; letter-spacing: -0.2px; margin-left: 1px;">${limitShort}</span>
                </button>
            `;

            const btn = btnContainer.querySelector('button');
            if (btn) {
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openSettingsModal();
                };

                btn.addEventListener('mouseenter', () => {
                    const isDark = this.isDarkTheme();
                    btn.style.backgroundColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
                    btn.setAttribute('title', `Historical Candle Limit (${this.formatLimitShort(this.getLimit())})`);
                });
                btn.addEventListener('mouseleave', () => {
                    btn.style.backgroundColor = 'transparent';
                    btn.removeAttribute('title');
                });
            }

            refTarget.parentNode.insertBefore(btnContainer, refTarget.nextSibling);
        }

        // Refined TradingView-Style Modal matching the white site theme
        openSettingsModal() {
            const existing = document.getElementById(this.modalId);
            if (existing) existing.remove();

            const th = this.getThemeStyles();
            const curLimit = this.getLimit();
            const overlay = document.createElement('div');
            overlay.id = this.modalId;
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: ${th.modalBackdrop};
                backdrop-filter: blur(3px);
                z-index: 99999999;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif;
            `;

            overlay.innerHTML = `
                <div style="background: ${th.modalBg}; color: ${th.textPrimary}; border: 1px solid ${th.modalBorder}; border-radius: 12px; width: 440px; max-width: calc(100vw - 32px); box-shadow: 0 16px 48px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.04); overflow: hidden;">
                    <!-- Header -->
                    <div style="padding: 16px 20px; border-bottom: 1px solid ${th.box1Bg}; display: flex; align-items: center; justify-content: space-between; background: ${th.modalHeaderBg};">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-size: 20px;">📊</span>
                            <div>
                                <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: ${th.textPrimary};">Historical Candle Buffer Limit</h3>
                                <p style="margin: 2px 0 0; font-size: 11.5px; color: ${th.textMuted};">Expand or reduce chart historical depth & memory usage</p>
                            </div>
                        </div>
                        <button id="modal-close-x" style="background: transparent; border: none; color: ${th.textMuted}; font-size: 20px; cursor: pointer; padding: 0 4px; line-height: 1;">&times;</button>
                    </div>

                    <!-- Body -->
                    <div style="padding: 20px;">
                        <div style="margin-bottom: 16px;">
                            <label style="font-size: 11.5px; font-weight: 600; color: ${th.textMuted}; display: block; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.3px;">Select Preset Limit:</label>
                            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">
                                <button type="button" class="preset-btn" data-val="5000" style="background: ${curLimit===5000?'#2962ff':th.presetBg}; color: ${curLimit===5000?'#fff':th.textPrimary}; border: 1px solid ${curLimit===5000?'#2962ff':th.presetBorder}; padding: 10px 4px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; text-align: center; transition: all 0.15s;">5K<br><span style="font-size: 9.5px; opacity: 0.8; font-weight: 400;">Ultra Light</span></button>
                                <button type="button" class="preset-btn" data-val="10000" style="background: ${curLimit===10000?'#2962ff':th.presetBg}; color: ${curLimit===10000?'#fff':th.textPrimary}; border: 1px solid ${curLimit===10000?'#2962ff':th.presetBorder}; padding: 10px 4px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; text-align: center; transition: all 0.15s;">10K<br><span style="font-size: 9.5px; opacity: 0.8; font-weight: 400;">Fast</span></button>
                                <button type="button" class="preset-btn" data-val="20000" style="background: ${curLimit===20000?'#2962ff':th.presetBg}; color: ${curLimit===20000?'#fff':th.textPrimary}; border: 1px solid ${curLimit===20000?'#2962ff':th.presetBorder}; padding: 10px 4px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; text-align: center; transition: all 0.15s;">20K<br><span style="font-size: 9.5px; opacity: 0.8; font-weight: 400;">Balanced</span></button>
                                <button type="button" class="preset-btn" data-val="40000" style="background: ${curLimit===40000?'#2962ff':th.presetBg}; color: ${curLimit===40000?'#fff':th.textPrimary}; border: 1px solid ${curLimit===40000?'#2962ff':th.presetBorder}; padding: 10px 4px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; text-align: center; transition: all 0.15s;">40K<br><span style="font-size: 9.5px; opacity: 0.8; font-weight: 400;">Default</span></button>
                            </div>
                        </div>

                        <div style="margin-bottom: 16px;">
                            <label for="custom-limit-input" style="font-size: 11.5px; font-weight: 600; color: ${th.textMuted}; display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.3px;">
                                <span>Custom Limit (Bars):</span>
                                <span style="font-size: 11px; color: ${th.textMuted}; font-weight: 400; text-transform: none;">Min: 1,000 | Recommended: 40,000</span>
                            </label>
                            <input id="custom-limit-input" type="number" min="1000" step="1000" value="${curLimit}" style="width: 100%; box-sizing: border-box; background: ${th.inputBg}; border: 1px solid ${th.inputBorder}; color: ${th.textPrimary}; padding: 10px 12px; border-radius: 8px; font-size: 14px; font-family: monospace; outline: none;">
                        </div>

                        <!-- Dynamic Warning Box for values > 40K -->
                        <div id="beyond-40k-warning" style="display: ${curLimit > 40000 ? 'block' : 'none'}; background: #fff5f5; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                            <div style="font-size: 12px; font-weight: 700; color: #dc2626; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                                <span>🚨 CRITICAL HIGH-MEMORY WARNING</span>
                            </div>
                            <div style="font-size: 11.5px; line-height: 1.45; color: #991b1b;">
                                Values above <strong>40,000 candles</strong> place heavy strain on browser RAM and WebGL buffers. May freeze indicator rendering or trigger tab crashes.
                            </div>
                            <label style="display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 11.5px; color: #7f1d1d; cursor: pointer;">
                                <input type="checkbox" id="accept-risk-checkbox" style="cursor: pointer; width: 14px; height: 14px;">
                                <span>I accept potential browser crashes.</span>
                            </label>
                        </div>

                        <!-- Technical Note -->
                        <div style="background: rgba(41, 98, 255, 0.05); border: 1px solid rgba(41, 98, 255, 0.18); border-radius: 8px; padding: 10px 12px; font-size: 11.5px; line-height: 1.45; color: #1e53e5;">
                            💡 <strong>40,000 bars (~200,000 data points)</strong> is the optimal threshold for fluid 60 FPS panning without browser tab memory overflow.
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="padding: 14px 20px; border-top: 1px solid ${th.box1Bg}; display: flex; align-items: center; justify-content: flex-end; gap: 10px; background: ${th.modalFooterBg};">
                        <button id="modal-btn-cancel" style="background: #ffffff; border: 1px solid #d1d4dc; color: #131722; padding: 9px 18px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s;">Cancel</button>
                        <button id="modal-btn-apply" style="background: #2962ff; border: none; color: #fff; padding: 9px 20px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s;">Apply</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            const input = overlay.querySelector('#custom-limit-input');
            const warningBox = overlay.querySelector('#beyond-40k-warning');
            const riskCheckbox = overlay.querySelector('#accept-risk-checkbox');
            const presetBtns = overlay.querySelectorAll('.preset-btn');

            input.addEventListener('input', () => {
                const val = parseInt(input.value, 10);
                if (val > 40000) {
                    warningBox.style.display = 'block';
                } else {
                    warningBox.style.display = 'none';
                    if (riskCheckbox) riskCheckbox.checked = false;
                }
            });

            presetBtns.forEach(btn => {
                btn.addEventListener('click', () => {
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
                    if (parseInt(bVal, 10) > 40000) {
                        warningBox.style.display = 'block';
                    } else {
                        warningBox.style.display = 'none';
                    }
                });
            });

            const close = () => overlay.remove();
            overlay.querySelector('#modal-close-x').onclick = close;
            overlay.querySelector('#modal-btn-cancel').onclick = close;

            overlay.querySelector('#modal-btn-apply').onclick = () => {
                const targetLimit = parseInt(input.value, 10);
                if (isNaN(targetLimit) || targetLimit < 1000) {
                    alert('Please enter a valid limit (minimum 1,000 candles).');
                    return;
                }

                if (targetLimit > 40000 && riskCheckbox && !riskCheckbox.checked) {
                    alert('Please confirm that you accept the risk of potential browser tab crashes by checking the box.');
                    return;
                }

                close();

                // If user is expanding, do seamless expansion; if reducing, reset data cleanly
                if (targetLimit > curLimit) {
                    this.expandLimitSeamlessly(targetLimit);
                } else {
                    this.setLimit(targetLimit);
                }
            };

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) close();
            });
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
