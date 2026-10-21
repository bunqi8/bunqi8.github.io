/**
 * Authentic Native TradingView On-Chart Trading Suite, Interactive On-Chart Orders & Side Panel
 * Features:
 *  1. Native on-chart Buy/Sell widget anchored directly inside <div class="legendMainSourceWrapper-YTFIJ62h">.
 *  2. Filled vs Non-Filled Button states based on live broker / paper trading connection status.
 *  3. Authentic TV hover tooltips with keyboard shortcuts ("Buy Market | Shift B", "Sell Market | Shift S").
 *  4. Single center quantity pill shown ONLY when One-Click Trading is enabled (redundant dropdown removed).
 *  5. Authentic Quantity Keypad Popup (Image 2) mounted to root body with position:fixed (NEVER CROPPED!).
 *  6. Side docked panel starts flush at top: 0 (zero whitespace at top).
 *  7. Instant One-Click Trading toggle right on the FRONT of the panel for effortless 1-click toggling.
 *  8. Interactive On-Chart Trades (Matching Image 4):
 *     - Dotted entry line at open price with TV badge ([Buy/Sell], [TP], [SL], [Lots], [+$PnL], [✕ Close]).
 *     - Interactive draggable TP line (green dashed) with live projected profit & drag-to-modify.
 *     - Interactive draggable SL line (red dashed) with live projected risk & drag-to-modify.
 *     - Click [TP] or [SL] on position line to place new TP/SL directly on chart via ghost cursor line.
 *     - Right price scale badges pointing to exact price levels.
 *  9. Live Broker-Separated Monitoring:
 *     - Subtabs: [Order] [Positions] [Orders] [History] [Account]
 *     - Distinct balances, trades, and equity per broker (Paper Trading, MT5, Fyers).
 *     - Real-time P&L status ticker bar at all times.
 */

(function(window) {
    'use strict';

    class TradeUI {
        constructor() {
            this.onChartWidgetId = 'tv-native-onchart-trade-widget';
            this.sidePanelId = 'tv-native-side-trade-panel';
            this.settingsModalId = 'tv-trading-settings-modal';
            this.toolbarBtnId = 'header-toolbar-trade-btn';
            this.toolbarGroupId = 'header-toolbar-trade-manager';
            this.keypadPopupId = 'tv-native-qty-keypad-popup';
            this.tooltipId = 'tv-native-chart-tooltip';
            this.overlayContainerId = 'tv-chart-positions-overlay';

            // Settings & State
            this.settings = this.loadSettings();

            // Order state
            this.selectedSide = 'BUY'; // 'BUY' or 'SELL'
            this.selectedTab = 'order'; // 'order', 'positions', 'orders', 'history', 'account'
            this.orderType = 'market'; // 'market', 'limit', 'stop'
            this.limitPrice = 0.0;
            this.stopPrice = 0.0;
            this.lots = this.settings.defaultLots || 1.0;

            // Exits
            this.isTpEnabled = false;
            this.isSlEnabled = false;
            this.tpTicks = 75;
            this.slTicks = 25;
            this.isExitsExpanded = true;

            // Panel view state
            this.isPanelOpen = false;
            this.dockMode = this.settings.dockMode || 'docked';
            this.dockSide = this.settings.dockSide || 'right';
            this.floatingPos = { top: '80px', right: '30px', left: 'auto' };

            // Live state
            this.currentSymbol = 'NIFTY50-INDEX';
            this.currentBid = 22811.35;
            this.currentAsk = 22811.85;
            this.positions = [];

            // Interactive chart dragging state
            this.activeDrag = null; // { type: 'tp'|'sl', ticket, startY, startPrice }
            this.ghostPlacement = null; // { type: 'tp'|'sl', ticket, isBuy }

            this.init();
        }

        loadSettings() {
            const defaults = {
                showBuySellButtons: true,
                oneClickTrading: false,
                dockMode: 'docked',
                dockSide: 'right',
                defaultLots: 1.0,
            };
            try {
                const saved = localStorage.getItem('tv_trading_settings_v7');
                return saved ? Object.assign(defaults, JSON.parse(saved)) : defaults;
            } catch (_) {
                return defaults;
            }
        }

        saveSettings() {
            try {
                this.settings.dockMode = this.dockMode;
                this.settings.dockSide = this.dockSide;
                this.settings.defaultLots = this.lots;
                localStorage.setItem('tv_trading_settings_v7', JSON.stringify(this.settings));
            } catch (_) {}
        }

        init() {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.boot());
            } else {
                this.boot();
            }
        }

        boot() {
            this.syncPricesWithChart();
            this.injectCSS();
            this.mount();

            // Bind to TradingEngine positions
            if (window.TradingEngine) {
                window.TradingEngine.onPositionUpdate((pos) => {
                    this.positions = pos || [];
                    this.renderChartOverlay();
                    if (this.isPanelOpen) this.renderSidePanel();
                });
            }

            // Bind to PaperTrading updates
            if (window.PaperTrading) {
                window.PaperTrading.onUpdate(() => {
                    if (window.TradingEngine && window.TradingEngine.getActiveBrokerKey(this.currentSymbol) === 'paper') {
                        this.positions = window.PaperTrading.getPositions();
                        this.renderChartOverlay();
                        if (this.isPanelOpen) this.renderSidePanel();
                    }
                });
            }

            // Bind to live ticks from broker
            if (window.MT5API) {
                window.MT5API.subscribeQuotes(this.currentSymbol, (tick) => {
                    if (tick && tick.bid && tick.ask) {
                        this.currentBid = Number(tick.bid);
                        this.currentAsk = Number(tick.ask);
                        this.updatePrices();
                    }
                });
            }

            // Periodic sync interval: detects symbol, mounts/updates buttons in legend, updates prices and toolbar
            setInterval(() => {
                this.detectSymbolChange();
                this.renderOnChartWidget();
                this.injectToolbarButton();
                this.updatePrices();
            }, 500);

            // Keyboard Shortcuts
            window.addEventListener('keydown', (e) => {
                if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
                if (e.key === 'Escape') {
                    if (this.ghostPlacement) {
                        this.ghostPlacement = null;
                        this.renderChartOverlay();
                    }
                    this.hideKeypad();
                } else if (e.shiftKey && e.key.toUpperCase() === 'B') {
                    e.preventDefault();
                    if (this.settings.oneClickTrading) this.executeInstantOrder('BUY');
                    else this.openOrderTicket('BUY');
                } else if (e.shiftKey && e.key.toUpperCase() === 'S') {
                    e.preventDefault();
                    if (this.settings.oneClickTrading) this.executeInstantOrder('SELL');
                    else this.openOrderTicket('SELL');
                }
            });

            // Re-render chart overlay on animation frames
            this.startOverlayLoop();
        }

        startOverlayLoop() {
            let lastRangeStr = '';
            const loop = () => {
                this.renderChartOverlay();
                requestAnimationFrame(loop);
            };
            requestAnimationFrame(loop);
        }

        mount() {
            this.renderOnChartWidget();
            this.renderSidePanel();
            this.injectToolbarButton();
        }

        getChartPrice() {
            try {
                const iframe = document.querySelector('#tv_chart_container iframe') || document.querySelector('iframe');
                if (iframe && iframe.contentDocument) {
                    const closeEl = iframe.contentDocument.querySelector('[data-test-id-value-title="C"] [class*="valueValue"]') ||
                                    iframe.contentDocument.querySelector('[data-test-id-value-title="C"] .valueValue-YTFIJ62h');
                    if (closeEl && closeEl.innerText) {
                        const parsed = parseFloat(closeEl.innerText.replace(/,/g, ''));
                        if (!isNaN(parsed) && parsed > 0) return parsed;
                    }
                }
            } catch (_) {}
            return null;
        }

        detectSymbolChange() {
            try {
                const iframe = document.querySelector('#tv_chart_container iframe') || document.querySelector('iframe');
                if (iframe && iframe.contentDocument) {
                    const titleBtn = iframe.contentDocument.querySelector('button[aria-label="Change symbol"]') ||
                                     iframe.contentDocument.querySelector('.title-YTFIJ62h');
                    if (titleBtn && titleBtn.innerText) {
                        const newSym = titleBtn.innerText.trim();
                        if (newSym && newSym !== this.currentSymbol) {
                            this.currentSymbol = newSym;
                            this.renderHeader();
                            this.updatePrices();
                            this.renderOnChartWidget();
                            this.renderSidePanel();
                        }
                    }
                }
            } catch (_) {}
        }

        // ==========================================
        // 1. TOOLBAR BUTTON
        // ==========================================
        injectToolbarButton() {
            const targetDoc = document;
            if (targetDoc.getElementById(this.toolbarGroupId)) return;

            const mt5Wrapper = targetDoc.getElementById('header-toolbar-mt5-manager');
            const fyersWrapper = targetDoc.getElementById('header-toolbar-broker-manager');
            const symbolSearch = targetDoc.getElementById('header-toolbar-symbol-search');

            const btnHtml = `
            <div class="group-MBOVGQRI" id="${this.toolbarGroupId}" style="margin: 0 4px; display: inline-flex; align-items: center;">
                <button aria-label="Trade Panel" data-role="button" tabindex="-1" type="button" 
                    class="button-OhqNVIYA button-ptpAHg8E button-GwQQdU8S apply-common-tooltip isInteractive-GwQQdU8S accessible-GwQQdU8S tv-trade-toggle-btn" 
                    id="${this.toolbarBtnId}" style="
                        padding: 0 9px;
                        display: inline-flex;
                        align-items: center;
                        gap: 5px;
                        cursor: pointer;
                        height: 28px;
                        border-radius: 4px;
                        border: 1px solid #e0e3eb;
                        background: ${this.isPanelOpen ? '#f0f3fa' : '#ffffff'};
                        color: ${this.isPanelOpen ? '#2962ff' : '#131722'};
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        font-size: 12px;
                        font-weight: 600;
                        outline: none;
                        transition: all 0.15s;
                    ">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="color: inherit;">
                        <path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
                    </svg>
                    <span>Trade</span>
                    <svg width="7" height="4" viewBox="0 0 10 6" fill="currentColor" style="opacity: 0.7; color: inherit;">
                        <path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                    </svg>
                </button>
            </div>
            `;

            if (mt5Wrapper && mt5Wrapper.parentNode) {
                mt5Wrapper.insertAdjacentHTML('afterend', btnHtml);
            } else if (fyersWrapper && fyersWrapper.parentNode) {
                fyersWrapper.insertAdjacentHTML('afterend', btnHtml);
            } else if (symbolSearch && symbolSearch.parentNode) {
                symbolSearch.insertAdjacentHTML('beforebegin', btnHtml);
            }

            const btn = targetDoc.getElementById(this.toolbarBtnId);
            if (btn) {
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.togglePanel();
                };
            }
        }

        updateToolbarBtnState() {
            const btn = document.getElementById(this.toolbarBtnId);
            if (!btn) return;
            if (this.isPanelOpen) {
                btn.style.background = '#f0f3fa';
                btn.style.borderColor = '#2962ff';
                btn.style.color = '#2962ff';
            } else {
                btn.style.background = '#ffffff';
                btn.style.borderColor = '#e0e3eb';
                btn.style.color = '#131722';
            }
        }

        togglePanel() {
            if (this.isPanelOpen) {
                this.closeOrderTicket();
            } else {
                this.openOrderTicket(this.selectedSide);
            }
        }

        // ==========================================
        // 2. NATIVE ON-CHART BUY/SELL WIDGET (Image 1)
        // Authentic Filled vs Outlined States & Center Lot Pill
        // ==========================================
        renderOnChartWidget() {
            const iframe = document.querySelector('#tv_chart_container iframe') || document.querySelector('iframe[id^="tradingview_"]') || document.querySelector('iframe');
            if (!iframe) return;
            let iframeDoc;
            try {
                iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            } catch (_) { return; }
            if (!iframeDoc) return;

            const legendWrapper = iframeDoc.querySelector('.legendMainSourceWrapper-YTFIJ62h') ||
                                  iframeDoc.querySelector('[class*="legendMainSourceWrapper"]') ||
                                  iframeDoc.querySelector('[data-qa-id="legend-series-item"]')?.parentElement;

            if (!legendWrapper) return;

            let widget = iframeDoc.getElementById(this.onChartWidgetId);
            const isNew = !widget;
            if (isNew) {
                widget = iframeDoc.createElement('div');
                widget.id = this.onChartWidgetId;
            }

            if (!this.settings.showBuySellButtons) {
                widget.style.display = 'none';
                return;
            }

            widget.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 2px;
                margin-top: 4px;
                margin-bottom: 4px;
                padding: 0;
                pointer-events: auto;
                user-select: none;
                font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif;
                position: relative;
                z-index: 20;
            `;

            const seriesItem = legendWrapper.querySelector('[data-qa-id="legend-series-item"]') || 
                               legendWrapper.querySelector('[class*="series-"]') || 
                               legendWrapper.firstElementChild;

            if (seriesItem && seriesItem.parentNode === legendWrapper) {
                if (seriesItem.nextSibling !== widget) {
                    seriesItem.parentNode.insertBefore(widget, seriesItem.nextSibling);
                }
            } else if (!legendWrapper.contains(widget)) {
                legendWrapper.appendChild(widget);
            }

            this.syncPricesWithChart();

            const isBrokerConnected = window.TradingEngine ? window.TradingEngine.isBrokerConnected(this.currentSymbol) : false;
            const isOneClick = Boolean(this.settings.oneClickTrading);

            const spreadPoints = this.getSpreadFormatted();
            const bidFormatted = this.formatPrice(this.currentBid);
            const askFormatted = this.formatPrice(this.currentAsk);

            const curConnectedAttr = widget.getAttribute('data-connected');
            const curOneClickAttr = widget.getAttribute('data-oneclick');
            const needsFullRebuild = curConnectedAttr !== String(isBrokerConnected) || curOneClickAttr !== String(isOneClick);

            if (!needsFullRebuild) {
                const bidDisp = widget.querySelector('#tv-native-bid-disp');
                const askDisp = widget.querySelector('#tv-native-ask-disp');
                const spreadDisp = widget.querySelector('#tv-native-spread-disp');
                const centerLotDisp = widget.querySelector('#tv-native-center-lot-disp');

                if (bidDisp && askDisp && spreadDisp) {
                    bidDisp.innerText = bidFormatted;
                    askDisp.innerText = askFormatted;
                    spreadDisp.innerText = spreadPoints;
                    if (centerLotDisp) centerLotDisp.innerText = this.lots;
                    return;
                }
            }

            widget.setAttribute('data-connected', String(isBrokerConnected));
            widget.setAttribute('data-oneclick', String(isOneClick));

            // Solid Filled when connected, Outlined when disconnected!
            const sellBg = isBrokerConnected ? '#f23645' : '#ffffff';
            const sellTextColor = isBrokerConnected ? '#ffffff' : '#f23645';
            const buyBg = isBrokerConnected ? '#2962ff' : '#ffffff';
            const buyTextColor = isBrokerConnected ? '#ffffff' : '#2962ff';

            widget.innerHTML = `
                <!-- Main Buy / Sell Buttons Row -->
                <div style="display: flex; align-items: center; gap: 6px; position: relative;">
                    <!-- SELL BUTTON -->
                    <button id="tv-native-btn-sell" type="button" style="
                        background: ${sellBg};
                        border: 1px solid #f23645;
                        border-radius: 4px;
                        padding: 2px 10px;
                        min-width: 80px;
                        height: 32px;
                        cursor: pointer;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        outline: none;
                        box-shadow: 0 1px 2px rgba(0,0,0,0.06);
                        transition: background 0.15s, transform 0.1s;
                    ">
                        <span id="tv-native-bid-disp" style="color: ${sellTextColor}; font-size: 12px; font-weight: 700; line-height: 1.15;">${bidFormatted}</span>
                        <span style="color: ${sellTextColor}; font-size: 9px; font-weight: 700; letter-spacing: 0.6px; line-height: 1.1;">SELL</span>
                    </button>

                    <!-- SPREAD & SINGLE AUTHENTIC CENTER QUANTITY PILL (Only when One-Click is ON!) -->
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 28px;">
                        <span id="tv-native-spread-disp" style="color: #131722; font-size: 10.5px; font-weight: 600; line-height: 1.1;">${spreadPoints}</span>
                        ${isOneClick ? `
                            <button id="tv-native-center-lot-btn" type="button" title="Set Order Quantity" style="
                                background: #f0f3fa;
                                border: 1px solid #d1d4dc;
                                border-radius: 3px;
                                padding: 1px 5px;
                                font-size: 10.5px;
                                font-weight: 700;
                                color: #131722;
                                cursor: pointer;
                                margin-top: 1px;
                                line-height: 1.1;
                                outline: none;
                            ">
                                <span id="tv-native-center-lot-disp">${this.lots}</span>
                            </button>
                        ` : ''}
                    </div>

                    <!-- BUY BUTTON -->
                    <button id="tv-native-btn-buy" type="button" style="
                        background: ${buyBg};
                        border: 1px solid #2962ff;
                        border-radius: 4px;
                        padding: 2px 10px;
                        min-width: 80px;
                        height: 32px;
                        cursor: pointer;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        outline: none;
                        box-shadow: 0 1px 2px rgba(0,0,0,0.06);
                        transition: background 0.15s, transform 0.1s;
                    ">
                        <span id="tv-native-ask-disp" style="color: ${buyTextColor}; font-size: 12px; font-weight: 700; line-height: 1.15;">${askFormatted}</span>
                        <span style="color: ${buyTextColor}; font-size: 9px; font-weight: 700; letter-spacing: 0.6px; line-height: 1.1;">BUY</span>
                    </button>
                </div>

                <!-- Floating Tooltip Container -->
                <div id="${this.tooltipId}" style="
                    display: none;
                    position: absolute;
                    top: 36px;
                    left: 0;
                    background: #2a2e39;
                    color: #ffffff;
                    border-radius: 6px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.35);
                    padding: 5px 10px;
                    font-size: 12px;
                    font-weight: 500;
                    align-items: center;
                    gap: 8px;
                    z-index: 9999;
                    pointer-events: none;
                    white-space: nowrap;
                "></div>
            `;

            this.bindOnChartEvents(widget, iframeDoc, isBrokerConnected);
        }

        bindOnChartEvents(widget, iframeDoc, isBrokerConnected) {
            const btnSell = widget.querySelector('#tv-native-btn-sell');
            const btnBuy = widget.querySelector('#tv-native-btn-buy');
            const centerLotBtn = widget.querySelector('#tv-native-center-lot-btn');
            const tooltip = widget.querySelector('#' + this.tooltipId);

            const showTooltip = (targetEl, text, hotkey) => {
                if (!tooltip) return;
                const offsetLeft = targetEl.offsetLeft;
                tooltip.style.left = offsetLeft + 'px';
                if (isBrokerConnected) {
                    tooltip.innerHTML = `
                        <span>${text}</span>
                        <span style="color: rgba(255,255,255,0.3);">|</span>
                        <span style="background: rgba(255,255,255,0.18); border: 1px solid rgba(255,255,255,0.25); border-radius: 3px; padding: 1px 5px; font-size: 10.5px; font-weight: 600;">Shift</span>
                        <span style="background: rgba(255,255,255,0.18); border: 1px solid rgba(255,255,255,0.25); border-radius: 3px; padding: 1px 5px; font-size: 10.5px; font-weight: 600;">${hotkey}</span>
                    `;
                } else {
                    const brokerName = window.TradingEngine ? window.TradingEngine.getActiveAdapter(this.currentSymbol).name : 'Broker';
                    tooltip.innerHTML = `<span>Connect ${brokerName} to Trade</span>`;
                }
                tooltip.style.display = 'flex';
            };

            const hideTooltip = () => {
                if (tooltip) tooltip.style.display = 'none';
            };

            if (btnSell) {
                btnSell.onmouseenter = () => showTooltip(btnSell, 'Sell Market', 'S');
                btnSell.onmouseleave = hideTooltip;
                btnSell.onclick = (e) => {
                    e.stopPropagation();
                    hideTooltip();
                    if (this.settings.oneClickTrading) this.executeInstantOrder('SELL');
                    else this.openOrderTicket('SELL');
                };
            }

            if (btnBuy) {
                btnBuy.onmouseenter = () => showTooltip(btnBuy, 'Buy Market', 'B');
                btnBuy.onmouseleave = hideTooltip;
                btnBuy.onclick = (e) => {
                    e.stopPropagation();
                    hideTooltip();
                    if (this.settings.oneClickTrading) this.executeInstantOrder('BUY');
                    else this.openOrderTicket('BUY');
                };
            }

            if (centerLotBtn) {
                centerLotBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.toggleQuantityKeypad(centerLotBtn, iframeDoc);
                };
            }
        }

        // ==========================================
        // 3. AUTHENTIC QUANTITY KEYPAD POPUP (Never Cropped)
        // Mounted directly to root iframeDoc.body with position: fixed
        // ==========================================
        ensureKeypadPopup(iframeDoc) {
            let popup = iframeDoc.getElementById(this.keypadPopupId);
            if (!popup) {
                popup = iframeDoc.createElement('div');
                popup.id = this.keypadPopupId;
                popup.style.cssText = `
                    display: none;
                    position: fixed;
                    background: #ffffff;
                    border: 1px solid #e0e3eb;
                    border-radius: 8px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.22);
                    padding: 12px;
                    width: 175px;
                    z-index: 9999999;
                    flex-direction: column;
                    gap: 8px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif;
                    user-select: none;
                    pointer-events: auto;
                `;
                popup.innerHTML = `
                    <div style="font-size: 12px; color: #787b86; font-weight: 600;">Quantity</div>

                    <div style="
                        border: 1.5px solid #2962ff;
                        border-radius: 6px;
                        padding: 3px 8px;
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        height: 30px;
                        background: #ffffff;
                    ">
                        <input type="number" id="tv-keypad-qty-in" step="1" min="0.01" value="${this.lots}" style="
                            width: 100%;
                            border: none;
                            outline: none;
                            font-size: 15px;
                            font-weight: 700;
                            color: #131722;
                            background: transparent;
                        ">
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                        <button type="button" class="tv-keypad-btn" data-act="minus" style="background: #ffffff; border: 1px solid #e0e3eb; border-radius: 6px; height: 30px; font-size: 14px; font-weight: 600; color: #131722; cursor: pointer;">−</button>
                        <button type="button" class="tv-keypad-btn" data-act="plus" style="background: #ffffff; border: 1px solid #e0e3eb; border-radius: 6px; height: 30px; font-size: 14px; font-weight: 600; color: #131722; cursor: pointer;">+</button>

                        <button type="button" class="tv-keypad-btn" data-val="1" style="background: #ffffff; border: 1px solid #e0e3eb; border-radius: 6px; height: 30px; font-size: 12px; font-weight: 600; color: #131722; cursor: pointer;">1</button>
                        <button type="button" class="tv-keypad-btn" data-val="5" style="background: #ffffff; border: 1px solid #e0e3eb; border-radius: 6px; height: 30px; font-size: 12px; font-weight: 600; color: #131722; cursor: pointer;">5</button>

                        <button type="button" class="tv-keypad-btn" data-val="25" style="background: #ffffff; border: 1px solid #e0e3eb; border-radius: 6px; height: 30px; font-size: 12px; font-weight: 600; color: #131722; cursor: pointer;">25</button>
                        <button type="button" class="tv-keypad-btn" data-val="100" style="background: #ffffff; border: 1px solid #e0e3eb; border-radius: 6px; height: 30px; font-size: 12px; font-weight: 600; color: #131722; cursor: pointer;">100</button>

                        <button type="button" class="tv-keypad-btn" data-val="500" style="background: #ffffff; border: 1px solid #e0e3eb; border-radius: 6px; height: 30px; font-size: 12px; font-weight: 600; color: #131722; cursor: pointer;">500</button>
                        <button type="button" class="tv-keypad-btn" data-val="1000" style="background: #ffffff; border: 1px solid #e0e3eb; border-radius: 6px; height: 30px; font-size: 12px; font-weight: 600; color: #131722; cursor: pointer;">1000</button>

                        <button type="button" class="tv-keypad-btn" data-act="clear" style="background: #ffffff; border: 1px solid #e0e3eb; border-radius: 6px; height: 30px; font-size: 12px; font-weight: 600; color: #131722; cursor: pointer;">C</button>
                        <button type="button" class="tv-keypad-btn" data-act="reset" style="background: #ffffff; border: 1px solid #e0e3eb; border-radius: 6px; height: 30px; font-size: 12px; font-weight: 600; color: #131722; cursor: pointer;">⟲</button>
                    </div>
                `;
                iframeDoc.body.appendChild(popup);

                // Bind clicks inside keypad
                const qtyIn = popup.querySelector('#tv-keypad-qty-in');
                if (qtyIn) {
                    qtyIn.onchange = (e) => {
                        const val = Math.max(0.01, parseFloat(e.target.value) || 1.0);
                        this.setLots(val);
                    };
                }

                popup.querySelectorAll('.tv-keypad-btn').forEach(b => {
                    b.onclick = (e) => {
                        e.stopPropagation();
                        const val = b.getAttribute('data-val');
                        const act = b.getAttribute('data-act');
                        if (val) {
                            this.setLots(parseFloat(val));
                            if (qtyIn) qtyIn.value = val;
                        } else if (act === 'plus') {
                            const cur = parseFloat(this.lots) || 1.0;
                            const next = cur < 1 ? Math.round((cur + 0.1) * 10) / 10 : cur + 1;
                            this.setLots(next);
                            if (qtyIn) qtyIn.value = next;
                        } else if (act === 'minus') {
                            const cur = parseFloat(this.lots) || 1.0;
                            const next = Math.max(0.01, cur <= 1 ? Math.max(0.01, Math.round((cur - 0.1) * 10) / 10) : cur - 1);
                            this.setLots(next);
                            if (qtyIn) qtyIn.value = next;
                        } else if (act === 'clear') {
                            this.setLots(0.01);
                            if (qtyIn) qtyIn.value = '';
                        } else if (act === 'reset') {
                            this.setLots(1.0);
                            if (qtyIn) qtyIn.value = 1.0;
                        }
                    };
                });

                iframeDoc.addEventListener('click', (e) => {
                    if (popup && popup.style.display === 'flex' && !popup.contains(e.target)) {
                        popup.style.display = 'none';
                    }
                });
            }
            return popup;
        }

        toggleQuantityKeypad(anchorBtn, iframeDoc) {
            const popup = this.ensureKeypadPopup(iframeDoc);
            if (popup.style.display === 'flex') {
                popup.style.display = 'none';
                return;
            }

            const rect = anchorBtn.getBoundingClientRect();
            popup.style.top = (rect.bottom + 6) + 'px';
            popup.style.left = Math.max(10, Math.min(iframeDoc.body.clientWidth - 190, rect.left - 50)) + 'px';
            popup.style.display = 'flex';

            const qtyIn = popup.querySelector('#tv-keypad-qty-in');
            if (qtyIn) {
                qtyIn.value = this.lots;
                qtyIn.focus();
                qtyIn.select();
            }
        }

        hideKeypad() {
            try {
                const iframe = document.querySelector('#tv_chart_container iframe') || document.querySelector('iframe');
                if (iframe && iframe.contentDocument) {
                    const popup = iframe.contentDocument.getElementById(this.keypadPopupId);
                    if (popup) popup.style.display = 'none';
                }
            } catch (_) {}
        }

        // ==========================================
        // 4. INTERACTIVE ON-CHART TRADING OVERLAY (Matching Image 4)
        // Position line, TP line, SL line, and Draggable Modifications
        // ==========================================
        renderChartOverlay() {
            const iframe = document.querySelector('#tv_chart_container iframe') || document.querySelector('iframe');
            if (!iframe) return;
            let iframeDoc;
            try {
                iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            } catch (_) { return; }
            if (!iframeDoc) return;

            const chartPane = iframeDoc.querySelector('.chart-gui-wrapper[data-qa-id="pane-widget-chart-gui-wrapper"]') ||
                              iframeDoc.querySelector('.chart-gui-wrapper') ||
                              iframeDoc.querySelector('td.chart-markup-table');
            if (!chartPane) return;

            let overlay = iframeDoc.getElementById(this.overlayContainerId);
            if (!overlay) {
                overlay = iframeDoc.createElement('div');
                overlay.id = this.overlayContainerId;
                overlay.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    z-index: 15;
                    overflow: visible;
                `;
                chartPane.appendChild(overlay);
            }

            // Get active positions for current chart symbol
            const currentSym = this.currentSymbol.split(':').pop().toUpperCase();
            const allPositions = (this.positions && this.positions.length > 0) ? this.positions : (window.PaperTrading ? window.PaperTrading.getPositions() : []);
            const symPositions = (allPositions || []).filter(p => p.symbol.toUpperCase() === currentSym);

            if (symPositions.length === 0 && !this.ghostPlacement) {
                overlay.innerHTML = '';
                return;
            }

            let html = '';
            symPositions.forEach(pos => {
                const isBuy = pos.type === 'BUY';
                const entryY = this.priceToY(pos.open_price);
                const pnl = pos.profit || 0.0;
                const pnlFormatted = `${pnl >= 0 ? '+' : ''}$${Number(pnl).toFixed(2)}`;
                const pnlColor = pnl >= 0 ? '#089981' : '#f23645';

                // 1. Position Entry Line
                if (entryY !== null && entryY >= 0 && entryY <= chartPane.offsetHeight) {
                    html += `
                        <div style="position: absolute; top: ${entryY}px; left: 0; right: 0; border-top: 1.5px dotted ${isBuy ? '#2962ff' : '#f23645'}; pointer-events: none; z-index: 20;">
                            <!-- Interactive TradingView Position Badge (Matching Image 4) -->
                            <div style="
                                position: absolute;
                                right: 80px;
                                transform: translateY(-50%);
                                display: inline-flex;
                                align-items: center;
                                gap: 3px;
                                pointer-events: auto;
                                font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif;
                                font-size: 11px;
                                white-space: nowrap;
                                background: transparent;
                            ">
                                <span style="background: ${isBuy ? '#2962ff' : '#f23645'}; color: #ffffff; font-weight: 700; padding: 2px 8px; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.15);">${pos.type}</span>
                                <button type="button" class="tv-ov-btn-tp" data-ticket="${pos.ticket}" title="Set Take Profit" style="background: #ffffff; border: 1px dashed #089981; color: #089981; font-weight: 700; padding: 2px 6px; border-radius: 4px; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.08);">TP</button>
                                <button type="button" class="tv-ov-btn-sl" data-ticket="${pos.ticket}" title="Set Stop Loss" style="background: #ffffff; border: 1px dashed #f23645; color: #f23645; font-weight: 700; padding: 2px 6px; border-radius: 4px; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.08);">SL</button>
                                <span style="background: #ffffff; border: 1px solid #d1d4dc; color: #131722; font-weight: 700; padding: 2px 6px; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.08);">${pos.lots}</span>
                                <span style="background: #ffffff; border: 1px solid #d1d4dc; color: ${pnlColor}; font-weight: 700; padding: 2px 7px; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.08);">${pnlFormatted}</span>
                                <button type="button" class="tv-ov-btn-close" data-ticket="${pos.ticket}" title="Close Position" style="background: #ffffff; border: 1px solid #d1d4dc; color: #787b86; font-weight: 700; padding: 2px 6px; border-radius: 4px; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.08);">✕</button>
                            </div>
                        </div>
                    `;
                }

                // 2. Take Profit Line (Green Dashed & Draggable)
                if (pos.tp && pos.tp > 0) {
                    const tpY = this.priceToY(pos.tp);
                    if (tpY !== null && tpY >= 0 && tpY <= chartPane.offsetHeight) {
                        const tpDiff = isBuy ? (pos.tp - pos.open_price) : (pos.open_price - pos.tp);
                        const tpProfit = (tpDiff * pos.lots * 100).toFixed(2);
                        html += `
                            <div style="position: absolute; top: ${tpY}px; left: 0; right: 0; border-top: 1.5px dashed #089981; pointer-events: none; z-index: 20;">
                                <div class="tv-ov-drag-tp" data-ticket="${pos.ticket}" style="
                                    position: absolute;
                                    right: 80px;
                                    transform: translateY(-50%);
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 3px;
                                    pointer-events: auto;
                                    font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif;
                                    font-size: 11px;
                                    white-space: nowrap;
                                    cursor: ns-resize;
                                ">
                                    <span style="background: #089981; color: #ffffff; font-weight: 700; padding: 2px 7px; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.15);">TP</span>
                                    <span style="background: #ffffff; border: 1px solid #089981; color: #131722; font-weight: 700; padding: 2px 6px; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.08);">${pos.lots}</span>
                                    <span style="background: #ffffff; border: 1px solid #089981; color: #089981; font-weight: 700; padding: 2px 7px; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.08);">+$${tpProfit}</span>
                                    <button type="button" class="tv-ov-btn-del-tp" data-ticket="${pos.ticket}" title="Cancel TP" style="background: #ffffff; border: 1px solid #089981; color: #787b86; font-weight: 700; padding: 2px 6px; border-radius: 4px; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.08);">✕</button>
                                </div>
                            </div>
                        `;
                    }
                }

                // 3. Stop Loss Line (Red Dashed & Draggable)
                if (pos.sl && pos.sl > 0) {
                    const slY = this.priceToY(pos.sl);
                    if (slY !== null && slY >= 0 && slY <= chartPane.offsetHeight) {
                        const slDiff = isBuy ? (pos.open_price - pos.sl) : (pos.sl - pos.open_price);
                        const slLoss = (slDiff * pos.lots * 100).toFixed(2);
                        html += `
                            <div style="position: absolute; top: ${slY}px; left: 0; right: 0; border-top: 1.5px dashed #f23645; pointer-events: none; z-index: 20;">
                                <div class="tv-ov-drag-sl" data-ticket="${pos.ticket}" style="
                                    position: absolute;
                                    right: 80px;
                                    transform: translateY(-50%);
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 3px;
                                    pointer-events: auto;
                                    font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif;
                                    font-size: 11px;
                                    white-space: nowrap;
                                    cursor: ns-resize;
                                ">
                                    <span style="background: #f23645; color: #ffffff; font-weight: 700; padding: 2px 7px; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.15);">SL</span>
                                    <span style="background: #ffffff; border: 1px solid #f23645; color: #131722; font-weight: 700; padding: 2px 6px; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.08);">${pos.lots}</span>
                                    <span style="background: #ffffff; border: 1px solid #f23645; color: #f23645; font-weight: 700; padding: 2px 7px; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.08);">-$${slLoss}</span>
                                    <button type="button" class="tv-ov-btn-del-sl" data-ticket="${pos.ticket}" title="Cancel SL" style="background: #ffffff; border: 1px solid #f23645; color: #787b86; font-weight: 700; padding: 2px 6px; border-radius: 4px; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.08);">✕</button>
                                </div>
                            </div>
                        `;
                    }
                }
            });

            overlay.innerHTML = html;
            this.bindOverlayEvents(overlay, iframeDoc, chartPane);
        }

        bindOverlayEvents(overlay, iframeDoc, chartPane) {
            // Close position button
            overlay.querySelectorAll('.tv-ov-btn-close').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const ticket = parseInt(btn.getAttribute('data-ticket'), 10);
                    if (window.TradingEngine) {
                        window.TradingEngine.closePosition({ ticket });
                    }
                };
            });

            // Delete TP button
            overlay.querySelectorAll('.tv-ov-btn-del-tp').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const ticket = parseInt(btn.getAttribute('data-ticket'), 10);
                    if (window.TradingEngine) {
                        window.TradingEngine.modifyPosition({ ticket, tp: 0 });
                    }
                };
            });

            // Delete SL button
            overlay.querySelectorAll('.tv-ov-btn-del-sl').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const ticket = parseInt(btn.getAttribute('data-ticket'), 10);
                    if (window.TradingEngine) {
                        window.TradingEngine.modifyPosition({ ticket, sl: 0 });
                    }
                };
            });

            // Click TP on main position line to start set-mode
            overlay.querySelectorAll('.tv-ov-btn-tp').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const ticket = parseInt(btn.getAttribute('data-ticket'), 10);
                    this.startGhostPlacement('tp', ticket, chartPane, iframeDoc);
                };
            });

            // Click SL on main position line to start set-mode
            overlay.querySelectorAll('.tv-ov-btn-sl').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const ticket = parseInt(btn.getAttribute('data-ticket'), 10);
                    this.startGhostPlacement('sl', ticket, chartPane, iframeDoc);
                };
            });

            // Draggable TP badge
            overlay.querySelectorAll('.tv-ov-drag-tp').forEach(badge => {
                badge.onmousedown = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const ticket = parseInt(badge.getAttribute('data-ticket'), 10);
                    this.startDragLine('tp', ticket, chartPane, iframeDoc);
                };
            });

            // Draggable SL badge
            overlay.querySelectorAll('.tv-ov-drag-sl').forEach(badge => {
                badge.onmousedown = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const ticket = parseInt(badge.getAttribute('data-ticket'), 10);
                    this.startDragLine('sl', ticket, chartPane, iframeDoc);
                };
            });
        }

        startDragLine(type, ticket, chartPane, iframeDoc) {
            const onMouseMove = (e) => {
                const rect = chartPane.getBoundingClientRect();
                const relY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
                const newPrice = this.yToPrice(relY);
                if (newPrice) {
                    if (window.TradingEngine) {
                        if (type === 'tp') window.TradingEngine.modifyPosition({ ticket, tp: newPrice });
                        else window.TradingEngine.modifyPosition({ ticket, sl: newPrice });
                    }
                }
            };

            const onMouseUp = () => {
                iframeDoc.removeEventListener('mousemove', onMouseMove);
                iframeDoc.removeEventListener('mouseup', onMouseUp);
            };

            iframeDoc.addEventListener('mousemove', onMouseMove);
            iframeDoc.addEventListener('mouseup', onMouseUp);
        }

        startGhostPlacement(type, ticket, chartPane, iframeDoc) {
            const onMouseMove = (e) => {
                const rect = chartPane.getBoundingClientRect();
                const relY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
                const price = this.yToPrice(relY);
                if (price) {
                    let ghost = iframeDoc.getElementById('tv-chart-ghost-line');
                    if (!ghost) {
                        ghost = iframeDoc.createElement('div');
                        ghost.id = 'tv-chart-ghost-line';
                        ghost.style.cssText = `position: absolute; left: 0; right: 0; z-index: 25; pointer-events: none;`;
                        chartPane.appendChild(ghost);
                    }
                    const isTp = type === 'tp';
                    ghost.style.top = relY + 'px';
                    ghost.style.borderTop = `1.5px dashed ${isTp ? '#089981' : '#f23645'}`;
                    ghost.innerHTML = `
                        <div style="position: absolute; right: 120px; transform: translateY(-50%); background: ${isTp ? '#089981' : '#f23645'}; color: #fff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px;">
                            Click to set ${isTp ? 'Take Profit' : 'Stop Loss'}: ${this.formatPrice(price)}
                        </div>
                    `;
                }
            };

            const onClick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                cleanup();
                const rect = chartPane.getBoundingClientRect();
                const relY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
                const price = this.yToPrice(relY);
                if (price && window.TradingEngine) {
                    if (type === 'tp') window.TradingEngine.modifyPosition({ ticket, tp: price });
                    else window.TradingEngine.modifyPosition({ ticket, sl: price });
                }
            };

            const onKeyDown = (e) => {
                if (e.key === 'Escape') cleanup();
            };

            const cleanup = () => {
                const ghost = iframeDoc.getElementById('tv-chart-ghost-line');
                if (ghost) ghost.remove();
                iframeDoc.removeEventListener('mousemove', onMouseMove);
                iframeDoc.removeEventListener('click', onClick, true);
                iframeDoc.removeEventListener('keydown', onKeyDown);
            };

            iframeDoc.addEventListener('mousemove', onMouseMove);
            iframeDoc.addEventListener('click', onClick, true);
            iframeDoc.addEventListener('keydown', onKeyDown);
        }

        priceToY(price) {
            if (!window.tvWidget) return null;
            try {
                const chart = window.tvWidget.activeChart ? window.tvWidget.activeChart() : window.tvWidget.chart();
                if (!chart) return null;
                const panes = chart.getPanes();
                if (!panes || !panes[0]) return null;
                const mainPane = panes[0];
                const priceScale = mainPane.getMainSourcePriceScale();
                if (!priceScale) return null;
                const range = priceScale.getVisiblePriceRange();
                if (!range || isNaN(range.from) || isNaN(range.to) || range.from === range.to) return null;
                const height = mainPane.getHeight();
                if (!height || height <= 0) return null;

                const isInverted = typeof priceScale.isInverted === 'function' ? priceScale.isInverted() : false;
                const ratio = (price - range.from) / (range.to - range.from);
                const y = isInverted ? (ratio * height) : ((1 - ratio) * height);
                return Math.round(y * 10) / 10;
            } catch (_) {
                return null;
            }
        }

        yToPrice(y) {
            if (!window.tvWidget) return null;
            try {
                const chart = window.tvWidget.activeChart ? window.tvWidget.activeChart() : window.tvWidget.chart();
                if (!chart) return null;
                const panes = chart.getPanes();
                if (!panes || !panes[0]) return null;
                const mainPane = panes[0];
                const priceScale = mainPane.getMainSourcePriceScale();
                if (!priceScale) return null;
                const range = priceScale.getVisiblePriceRange();
                if (!range || isNaN(range.from) || isNaN(range.to) || range.from === range.to) return null;
                const height = mainPane.getHeight();
                if (!height || height <= 0) return null;

                const isInverted = typeof priceScale.isInverted === 'function' ? priceScale.isInverted() : false;
                const ratio = isInverted ? (y / height) : (1 - (y / height));
                const price = range.from + ratio * (range.to - range.from);
                return Math.round(price * 100) / 100;
            } catch (_) {
                return null;
            }
        }

        // ==========================================
        // 5. NATIVE SIDE TRADE PANEL (DOCKED OR FLOATING)
        // Starts flush at top: 0, with Instant One-Click Toggle & Broker Tabs
        // ==========================================
        renderSidePanel() {
            let panel = document.getElementById(this.sidePanelId);
            if (!panel) {
                panel = document.createElement('div');
                panel.id = this.sidePanelId;
                document.body.appendChild(panel);
            }

            const theme = this.getTheme();
            const isDocked = this.dockMode === 'docked';
            const isDockRight = this.dockSide === 'right';

            if (isDocked) {
                panel.style.cssText = `
                    position: fixed;
                    top: 0;
                    bottom: 0;
                    ${isDockRight ? 'right: 0; left: auto;' : 'left: 0; right: auto;'}
                    width: 340px;
                    background: ${theme.panelBg};
                    color: ${theme.text};
                    ${isDockRight ? `border-left: 1px solid ${theme.border};` : `border-right: 1px solid ${theme.border};`}
                    display: ${this.isPanelOpen ? 'flex' : 'none'};
                    flex-direction: column;
                    z-index: 9999;
                    font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif;
                    box-shadow: none;
                    border-radius: 0;
                    user-select: none;
                `;
            } else {
                const fPos = this.floatingPos;
                panel.style.cssText = `
                    position: fixed;
                    top: ${fPos.top || '80px'};
                    ${fPos.left && fPos.left !== 'auto' ? `left: ${fPos.left}; right: auto;` : `right: ${fPos.right || '30px'}; left: auto;`}
                    width: 340px;
                    max-height: 90vh;
                    background: ${theme.panelBg};
                    color: ${theme.text};
                    border: 1px solid ${theme.border};
                    border-radius: 12px;
                    display: ${this.isPanelOpen ? 'flex' : 'none'};
                    flex-direction: column;
                    z-index: 99999;
                    font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif;
                    box-shadow: ${theme.shadow};
                    user-select: none;
                    overflow: hidden;
                `;
            }

            this.updateChartContainerLayout();
            this.updateToolbarBtnState();
            this.syncPricesWithChart();

            const activeBrokerMode = window.TradingEngine ? window.TradingEngine.activeBrokerMode : 'auto';
            const activeBrokerKey = window.TradingEngine ? window.TradingEngine.getActiveBrokerKey(this.currentSymbol) : 'paper';
            const activeBrokerName = window.TradingEngine ? window.TradingEngine.getActiveAdapter(this.currentSymbol).name : 'Paper Trading';
            const isConnected = window.TradingEngine ? window.TradingEngine.isBrokerConnected(this.currentSymbol) : false;

            const acc = (window.TradingEngine && window.TradingEngine.getAccountSummary()) || {
                balance: 100000.00,
                equity: 100000.00,
                floatingPnl: 0.0,
                usedMargin: 0.0,
                freeMargin: 100000.00,
                currency: 'USD'
            };

            const curPositions = (window.PaperTrading && activeBrokerKey === 'paper') ? window.PaperTrading.getPositions() : this.positions;
            const curOrders = (window.PaperTrading && activeBrokerKey === 'paper') ? window.PaperTrading.getOrders() : [];
            const posCount = curPositions.length;
            const ordCount = curOrders.length;

            panel.innerHTML = `
                <!-- 1. Header Bar -->
                <div id="tv-panel-drag-header" style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 10px 14px;
                    border-bottom: 1px solid ${theme.border};
                    cursor: ${isDocked ? 'default' : 'move'};
                ">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <div style="
                            width: 20px;
                            height: 20px;
                            border-radius: 4px;
                            background: #131722;
                            color: #ffffff;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 10px;
                            font-weight: 800;
                            letter-spacing: -0.5px;
                        ">TV</div>
                        <div>
                            <span id="tv-side-panel-symbol" style="font-size: 13.5px; font-weight: 700; color: ${theme.text};">${this.currentSymbol}</span>
                            <span style="font-size: 10px; color: #2962ff; font-weight: 600; margin-left: 4px;">[${activeBrokerName}]</span>
                        </div>
                    </div>

                    <div style="display: flex; align-items: center; gap: 4px;">
                        <button id="tv-panel-btn-dock-toggle" type="button" title="${isDocked ? 'Undock to Floating Window' : 'Dock to Side'}" style="
                            background: transparent; border: none; color: ${theme.textMuted}; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center;
                        ">
                            ${isDocked ? `
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M15 3h6v6m0-6L10 14M9 21H3v-6m0 6l11-11"/>
                                </svg>
                            ` : `
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>
                                </svg>
                            `}
                        </button>
                        <button id="tv-panel-btn-settings" type="button" title="Trading Settings" style="
                            background: transparent; border: none; color: ${theme.textMuted}; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center;
                        ">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/>
                            </svg>
                        </button>
                        <button id="tv-panel-btn-close" type="button" title="Close Panel" style="
                            background: transparent; border: none; color: ${theme.textMuted}; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center;
                        ">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 6L6 18M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- Broker Switcher Pill Bar -->
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 14px; background: ${theme.cardBg}; border-bottom: 1px solid ${theme.border}; font-size: 11px;">
                    <span style="color: ${theme.textMuted}; font-weight: 600;">Broker:</span>
                    <select id="tv-panel-broker-select" style="
                        background: ${theme.inputBg};
                        color: ${theme.text};
                        border: 1px solid ${theme.border};
                        border-radius: 4px;
                        padding: 2px 6px;
                        font-size: 11px;
                        font-weight: 600;
                        outline: none;
                        cursor: pointer;
                    ">
                        <option value="auto" ${activeBrokerMode === 'auto' ? 'selected' : ''}>⚡ Auto (Fyers / MT5)</option>
                        <option value="paper" ${activeBrokerMode === 'paper' ? 'selected' : ''}>📝 Paper Trading</option>
                        <option value="mt5" ${activeBrokerMode === 'mt5' ? 'selected' : ''}>📊 MetaTrader 5</option>
                        <option value="fyers" ${activeBrokerMode === 'fyers' ? 'selected' : ''}>🇮🇳 Fyers Broker</option>
                    </select>
                </div>

                <!-- INSTANT ONE-CLICK TRADING STRIP (Front of Panel) -->
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 7px 14px; background: ${this.settings.oneClickTrading ? '#eef3ff' : '#f8f9fd'}; border-bottom: 1px solid ${theme.border};">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 13px; color: ${this.settings.oneClickTrading ? '#2962ff' : '#787b86'};">⚡</span>
                        <span style="font-size: 12px; font-weight: 600; color: ${this.settings.oneClickTrading ? '#2962ff' : theme.text};">Instant One-Click Trading</span>
                    </div>
                    <label class="tv-toggle-switch" style="cursor: pointer; margin: 0;">
                        <input type="checkbox" id="tv-panel-quick-oneclick" ${this.settings.oneClickTrading ? 'checked' : ''}>
                        <span class="tv-toggle-slider"></span>
                    </label>
                </div>

                <!-- 2. Subtabs: Order | Positions | Orders | History | Account -->
                <div style="
                    display: flex;
                    margin: 8px 12px 4px;
                    background: ${theme.subtabBg};
                    border-radius: 6px;
                    padding: 2px;
                    gap: 2px;
                ">
                    <button id="tv-subtab-order" type="button" class="tv-subtab-btn" data-tab="order" style="flex: 1; padding: 5px 0; border: none; border-radius: 4px; background: ${this.selectedTab === 'order' ? theme.panelBg : 'transparent'}; color: ${this.selectedTab === 'order' ? theme.text : theme.textMuted}; font-weight: ${this.selectedTab === 'order' ? '700' : '600'}; font-size: 11px; cursor: pointer;">Order</button>
                    <button id="tv-subtab-positions" type="button" class="tv-subtab-btn" data-tab="positions" style="flex: 1; padding: 5px 0; border: none; border-radius: 4px; background: ${this.selectedTab === 'positions' ? theme.panelBg : 'transparent'}; color: ${this.selectedTab === 'positions' ? theme.text : theme.textMuted}; font-weight: ${this.selectedTab === 'positions' ? '700' : '600'}; font-size: 11px; cursor: pointer;">Positions (${posCount})</button>
                    <button id="tv-subtab-orders" type="button" class="tv-subtab-btn" data-tab="orders" style="flex: 1; padding: 5px 0; border: none; border-radius: 4px; background: ${this.selectedTab === 'orders' ? theme.panelBg : 'transparent'}; color: ${this.selectedTab === 'orders' ? theme.text : theme.textMuted}; font-weight: ${this.selectedTab === 'orders' ? '700' : '600'}; font-size: 11px; cursor: pointer;">Orders (${ordCount})</button>
                    <button id="tv-subtab-history" type="button" class="tv-subtab-btn" data-tab="history" style="flex: 1; padding: 5px 0; border: none; border-radius: 4px; background: ${this.selectedTab === 'history' ? theme.panelBg : 'transparent'}; color: ${this.selectedTab === 'history' ? theme.text : theme.textMuted}; font-weight: ${this.selectedTab === 'history' ? '700' : '600'}; font-size: 11px; cursor: pointer;">History</button>
                    <button id="tv-subtab-account" type="button" class="tv-subtab-btn" data-tab="account" style="flex: 1; padding: 5px 0; border: none; border-radius: 4px; background: ${this.selectedTab === 'account' ? theme.panelBg : 'transparent'}; color: ${this.selectedTab === 'account' ? theme.text : theme.textMuted}; font-weight: ${this.selectedTab === 'account' ? '700' : '600'}; font-size: 11px; cursor: pointer;">Account</button>
                </div>

                <!-- LIVE BROKER MONEY STATUS BAR -->
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 14px; background: #fafbfc; border-bottom: 1px solid ${theme.border}; font-size: 11px;">
                    <div><span style="color: ${theme.textMuted};">Bal:</span> <strong style="color: ${theme.text};">${acc.currency === 'INR' ? '₹' : '$'}${Number(acc.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong></div>
                    <div><span style="color: ${theme.textMuted};">Eq:</span> <strong style="color: ${theme.text};">${acc.currency === 'INR' ? '₹' : '$'}${Number(acc.equity || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong></div>
                    <div><span style="color: ${theme.textMuted};">P&L:</span> <strong style="color: ${(acc.floatingPnl || 0) >= 0 ? '#089981' : '#f23645'};">${(acc.floatingPnl || 0) >= 0 ? '+' : ''}${acc.currency === 'INR' ? '₹' : '$'}${Number(acc.floatingPnl || 0).toFixed(2)}</strong></div>
                </div>

                <!-- 3. Dynamic Tab Content Body -->
                <div style="flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 12px;">
                    ${this.renderTabContent(theme, activeBrokerKey, activeBrokerName, curPositions, curOrders, acc)}
                </div>
            `;

            this.bindSidePanelEvents(panel);
        }

        renderTabContent(theme, activeBrokerKey, activeBrokerName, curPositions, curOrders, acc) {
            if (this.selectedTab === 'positions') {
                return this.getPositionsTabHtml(theme, activeBrokerName, curPositions);
            } else if (this.selectedTab === 'orders') {
                return this.getOrdersTabHtml(theme, activeBrokerName, curOrders);
            } else if (this.selectedTab === 'history') {
                return this.getHistoryTabHtml(theme, activeBrokerName);
            } else if (this.selectedTab === 'account') {
                return this.getAccountTabHtml(theme, activeBrokerKey, activeBrokerName, acc);
            } else {
                return this.getOrderTabHtml(theme);
            }
        }

        getOrderTabHtml(theme) {
            const isBuy = this.selectedSide === 'BUY';
            const spreadPoints = this.getSpreadFormatted();
            const bidFormatted = this.formatPrice(this.currentBid);
            const askFormatted = this.formatPrice(this.currentAsk);

            return `
                <!-- Split Card: Sell / Buy -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; border-radius: 8px; border: 1.5px solid ${theme.border}; overflow: hidden; position: relative;">
                    <div id="tv-ticket-split-sell" style="
                        padding: 10px;
                        background: ${!isBuy ? theme.sellActiveBg : theme.cardBg};
                        border-right: 1px solid ${theme.border};
                        cursor: pointer;
                        display: flex;
                        flex-direction: column;
                        transition: background 0.15s;
                    ">
                        <span style="color: ${theme.sellColor}; font-size: 11px; font-weight: 700;">Sell</span>
                        <span id="tv-ticket-bid-val" style="color: ${!isBuy ? theme.sellColor : theme.text}; font-size: 16px; font-weight: 700; margin-top: 2px;">${bidFormatted}</span>
                    </div>

                    <div style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); background: ${theme.panelBg}; border: 1px solid ${theme.border}; border-radius: 10px; padding: 2px 6px; font-size: 10px; font-weight: 600; color: ${theme.textMuted};">
                        <span id="tv-ticket-spread-badge">${spreadPoints}</span>
                    </div>

                    <div id="tv-ticket-split-buy" style="
                        padding: 10px;
                        background: ${isBuy ? theme.buyActiveBg : theme.cardBg};
                        text-align: right;
                        cursor: pointer;
                        display: flex;
                        flex-direction: column;
                        transition: background 0.15s;
                    ">
                        <span style="color: ${theme.buyColor}; font-size: 11px; font-weight: 700;">Buy</span>
                        <span id="tv-ticket-ask-val" style="color: ${isBuy ? theme.buyColor : theme.text}; font-size: 16px; font-weight: 700; margin-top: 2px;">${askFormatted}</span>
                    </div>
                </div>

                <!-- Order Type Tabs: Market | Limit | Stop -->
                <div style="display: flex; border-bottom: 1px solid ${theme.border};">
                    <button type="button" class="tv-order-type-btn" data-type="market" style="flex: 1; padding: 8px 0; border: none; background: transparent; color: ${this.orderType === 'market' ? theme.text : theme.textMuted}; font-weight: 700; font-size: 12px; border-bottom: 2px solid ${this.orderType === 'market' ? theme.text : 'transparent'}; cursor: pointer;">Market</button>
                    <button type="button" class="tv-order-type-btn" data-type="limit" style="flex: 1; padding: 8px 0; border: none; background: transparent; color: ${this.orderType === 'limit' ? theme.text : theme.textMuted}; font-weight: 700; font-size: 12px; border-bottom: 2px solid ${this.orderType === 'limit' ? theme.text : 'transparent'}; cursor: pointer;">Limit</button>
                    <button type="button" class="tv-order-type-btn" data-type="stop" style="flex: 1; padding: 8px 0; border: none; background: transparent; color: ${this.orderType === 'stop' ? theme.text : theme.textMuted}; font-weight: 700; font-size: 12px; border-bottom: 2px solid ${this.orderType === 'stop' ? theme.text : 'transparent'}; cursor: pointer;">Stop</button>
                </div>

                <!-- Units Input Box -->
                <div>
                    <div style="display: flex; justify-content: space-between; font-size: 11.5px; color: ${theme.textMuted}; margin-bottom: 4px;">
                        <span>Units ⌵</span>
                    </div>
                    <div style="display: flex; align-items: center; border: 1.5px solid #2962ff; border-radius: 6px; padding: 4px 10px; background: ${theme.inputBg};">
                        <input type="number" id="tv-ticket-units-in" min="0.01" step="0.1" value="${this.lots}" style="width: 70px; border: none; outline: none; background: transparent; color: ${theme.text}; font-size: 14px; font-weight: 700;">
                        <span style="color: ${theme.textMuted}; margin: 0 8px;">⇄</span>
                        <span id="tv-ticket-usd-val" style="margin-left: auto; font-size: 12px; font-weight: 600; color: ${theme.textMuted};">${this.calculateTradeValueUSD()} USD ⌵</span>
                    </div>
                </div>

                <!-- Financial Metrics Breakdown -->
                <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 8px 12px; display: flex; flex-direction: column; gap: 6px; font-size: 11px;">
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: ${theme.textMuted};">Trade value (50x)</span>
                        <span id="tv-val-trade-summary" style="font-weight: 700; color: ${theme.text};">${this.calculateTradeValueUSD()} USD</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: ${theme.textMuted};">Available margin</span>
                        <span id="tv-val-avail-margin" style="font-weight: 700; color: ${theme.text};">${this.getAvailableMarginFormatted()} USD</span>
                    </div>
                </div>

                <!-- Exits Accordion (Take Profit / Stop Loss) -->
                <div>
                    <div id="tv-ticket-exits-toggle" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: 4px 0;">
                        <span style="font-size: 12px; font-weight: 700; color: ${theme.text};">Exits</span>
                        <span style="font-size: 12px; color: ${theme.textMuted};">${this.isExitsExpanded ? '▲' : '▼'}</span>
                    </div>

                    ${this.isExitsExpanded ? `
                        <!-- Take Profit -->
                        <div style="margin-top: 6px; border: 1px solid ${this.isTpEnabled ? '#2962ff' : theme.border}; border-radius: 6px; padding: 6px 10px; background: ${theme.inputBg};">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <label style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: ${theme.text}; cursor: pointer;">
                                    <input type="checkbox" id="tv-ticket-check-tp" ${this.isTpEnabled ? 'checked' : ''}>
                                    <span>Take profit price ⌵</span>
                                </label>
                                <input type="number" id="tv-ticket-tp-ticks-in" value="${this.tpTicks}" style="width: 50px; border: none; text-align: right; outline: none; font-weight: 600; font-size: 11px;">
                                <span style="font-size: 10px; color: ${theme.textMuted}; margin-left: 2px;">ticks</span>
                            </div>
                        </div>

                        <!-- Stop Loss -->
                        <div style="margin-top: 6px; border: 1px solid ${this.isSlEnabled ? '#2962ff' : theme.border}; border-radius: 6px; padding: 6px 10px; background: ${theme.inputBg};">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <label style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: ${theme.text}; cursor: pointer;">
                                    <input type="checkbox" id="tv-ticket-check-sl" ${this.isSlEnabled ? 'checked' : ''}>
                                    <span>Stop loss price ⌵</span>
                                </label>
                                <input type="number" id="tv-ticket-sl-ticks-in" value="${this.slTicks}" style="width: 50px; border: none; text-align: right; outline: none; font-weight: 600; font-size: 11px;">
                                <span style="font-size: 10px; color: ${theme.textMuted}; margin-left: 2px;">ticks</span>
                            </div>
                        </div>
                    ` : ''}
                </div>

                <!-- Big Execution Button -->
                <button id="tv-ticket-btn-execute" type="button" style="
                    background: ${isBuy ? theme.buyColor : theme.sellColor};
                    color: #ffffff;
                    border: none;
                    border-radius: 8px;
                    padding: 12px;
                    font-size: 14px;
                    font-weight: 700;
                    cursor: pointer;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    margin-top: auto;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
                    transition: opacity 0.15s;
                ">
                    <span>${isBuy ? 'Buy' : 'Sell'}</span>
                    <span id="tv-ticket-btn-summary-text" style="font-size: 10.5px; opacity: 0.9; margin-top: 2px;">
                        ${this.lots} ${this.currentSymbol} ${this.orderType.toUpperCase()}
                    </span>
                </button>
            `;
        }

        getPositionsTabHtml(theme, activeBrokerName, curPositions) {
            if (curPositions.length === 0) {
                return `
                    <div style="text-align: center; color: ${theme.textMuted}; font-size: 12px; padding: 40px 10px;">
                        No open positions for <strong>${activeBrokerName}</strong>.
                    </div>
                `;
            }

            return `
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${curPositions.map(p => {
                        const isBuy = p.type === 'BUY';
                        const pnl = p.profit || 0.0;
                        const pnlFormatted = `${pnl >= 0 ? '+' : ''}$${Number(pnl).toFixed(2)}`;
                        const pnlColor = pnl >= 0 ? '#089981' : '#f23645';

                        return `
                            <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 10px;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span style="background: ${isBuy ? '#2962ff' : '#f23645'}; color: #fff; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px;">${p.type}</span>
                                        <strong style="font-size: 13px; color: ${theme.text};">${p.symbol}</strong>
                                        <span style="font-size: 11px; color: ${theme.textMuted};">${p.lots} lots</span>
                                    </div>
                                    <strong style="font-size: 13px; color: ${pnlColor};">${pnlFormatted}</strong>
                                </div>
                                <div style="display: flex; justify-content: space-between; font-size: 11px; color: ${theme.textMuted}; margin-bottom: 8px;">
                                    <span>Entry: <strong style="color: ${theme.text};">${p.open_price}</strong></span>
                                    <span>Cur: <strong style="color: ${theme.text};">${p.current_price || p.open_price}</strong></span>
                                    <span>SL: <strong style="color: ${theme.text};">${p.sl || '—'}</strong></span>
                                    <span>TP: <strong style="color: ${theme.text};">${p.tp || '—'}</strong></span>
                                </div>
                                <div style="display: flex; gap: 6px;">
                                    <button type="button" class="tv-pos-be-btn" data-ticket="${p.ticket}" style="flex: 1; padding: 4px; font-size: 11px; font-weight: 600; border: 1px solid ${theme.border}; border-radius: 4px; background: #fff; cursor: pointer;">Break Even</button>
                                    <button type="button" class="tv-pos-partial-btn" data-ticket="${p.ticket}" style="flex: 1; padding: 4px; font-size: 11px; font-weight: 600; border: 1px solid ${theme.border}; border-radius: 4px; background: #fff; cursor: pointer;">Close 50%</button>
                                    <button type="button" class="tv-pos-close-btn" data-ticket="${p.ticket}" style="flex: 1; padding: 4px; font-size: 11px; font-weight: 600; border: 1px solid #f23645; color: #f23645; border-radius: 4px; background: #fff; cursor: pointer;">✕ Close</button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        getOrdersTabHtml(theme, activeBrokerName, curOrders) {
            if (curOrders.length === 0) {
                return `
                    <div style="text-align: center; color: ${theme.textMuted}; font-size: 12px; padding: 40px 10px;">
                        No pending limit or stop orders for <strong>${activeBrokerName}</strong>.
                    </div>
                `;
            }

            return `
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${curOrders.map(o => `
                        <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span style="background: #f0f3fa; color: #131722; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px;">${o.type}</span>
                                    <strong style="font-size: 13px; color: ${theme.text};">${o.symbol}</strong>
                                    <span style="font-size: 11px; color: ${theme.textMuted};">${o.lots} lots</span>
                                </div>
                                <strong style="font-size: 12px; color: ${theme.text};">@ ${o.price}</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 11px;">
                                <span style="color: ${theme.textMuted};">SL: ${o.sl || '—'} | TP: ${o.tp || '—'}</span>
                                <button type="button" class="tv-ord-cancel-btn" data-ticket="${o.ticket}" style="padding: 3px 8px; font-size: 11px; font-weight: 600; border: 1px solid #f23645; color: #f23645; border-radius: 4px; background: #fff; cursor: pointer;">✕ Cancel</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        getHistoryTabHtml(theme, activeBrokerName) {
            const history = window.PaperTrading ? window.PaperTrading.getHistory() : [];
            return `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <div style="font-size: 11.5px; font-weight: 700; color: ${theme.text};">Closed Trades (${history.length})</div>
                    <div style="display: flex; gap: 4px;">
                        <button id="tv-btn-clear-history" type="button" style="background: rgba(242,54,69,0.1); color: #f23645; border: 1px solid rgba(242,54,69,0.25); border-radius: 4px; padding: 2px 6px; font-size: 10px; font-weight: 600; cursor: pointer;">Clear</button>
                        <button id="tv-btn-reset-account" type="button" style="background: rgba(41,98,255,0.1); color: #2962ff; border: 1px solid rgba(41,98,255,0.25); border-radius: 4px; padding: 2px 6px; font-size: 10px; font-weight: 600; cursor: pointer;">Reset $100k</button>
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 6px;">
                    ${history.length === 0 ? `
                        <div style="text-align: center; color: ${theme.textMuted}; font-size: 11.5px; padding: 24px 0;">No closed trades yet for ${activeBrokerName}.</div>
                    ` : history.map(h => {
                        const isProf = (h.profit || 0) >= 0;
                        return `
                            <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-left: 3px solid ${isProf ? '#089981' : '#f23645'}; border-radius: 4px; padding: 6px 8px; font-size: 11px;">
                                <div style="display: flex; justify-content: space-between;">
                                    <strong>${h.type} ${h.lots} ${h.symbol}</strong>
                                    <strong style="color: ${isProf ? '#089981' : '#f23645'};">${isProf ? '+' : ''}$${Number(h.profit || 0).toFixed(2)}</strong>
                                </div>
                                <div style="display: flex; justify-content: space-between; color: ${theme.textMuted}; font-size: 10px; margin-top: 2px;">
                                    <span>${h.open_price} → ${h.close_price}</span>
                                    <span>${h.reason || 'Closed'}</span>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        getAccountTabHtml(theme, activeBrokerKey, activeBrokerName, acc) {
            const isPaper = activeBrokerKey === 'paper';
            return `
                <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 8px; padding: 12px; font-size: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid ${theme.border}; padding-bottom: 8px; margin-bottom: 8px;">
                        <strong>${activeBrokerName}</strong>
                        <span style="background: #eef3ff; color: #2962ff; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 3px;">Active</span>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
                        <div>Balance: <strong>${acc.currency === 'INR' ? '₹' : '$'}${Number(acc.balance || 0).toLocaleString()}</strong></div>
                        <div>Equity: <strong>${acc.currency === 'INR' ? '₹' : '$'}${Number(acc.equity || 0).toLocaleString()}</strong></div>
                        <div>Used Margin: <strong>${acc.currency === 'INR' ? '₹' : '$'}${Number(acc.usedMargin || 0).toLocaleString()}</strong></div>
                        <div>Free Margin: <strong>${acc.currency === 'INR' ? '₹' : '$'}${Number(acc.freeMargin || 0).toLocaleString()}</strong></div>
                    </div>

                    ${isPaper ? `
                        <div style="border-top: 1px solid ${theme.border}; padding-top: 10px; display: flex; flex-direction: column; gap: 8px;">
                            <span style="font-size: 11px; font-weight: 600; color: ${theme.textMuted};">Paper Trading Controls:</span>
                            <div style="display: flex; gap: 6px;">
                                <input type="number" id="tv-account-deposit-in" placeholder="Deposit Amount" style="flex: 1; border: 1px solid ${theme.border}; border-radius: 4px; padding: 4px 8px; font-size: 11px;">
                                <button type="button" id="tv-account-deposit-btn" style="background: #2962ff; color: #fff; border: none; border-radius: 4px; padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: pointer;">Deposit</button>
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        bindSidePanelEvents(panel) {
            const btnClose = panel.querySelector('#tv-panel-btn-close');
            const btnDockToggle = panel.querySelector('#tv-panel-btn-dock-toggle');
            const btnSettings = panel.querySelector('#tv-panel-btn-settings');
            const brokerSelect = panel.querySelector('#tv-panel-broker-select');
            const quickOneClick = panel.querySelector('#tv-panel-quick-oneclick');

            if (btnClose) btnClose.onclick = () => this.closeOrderTicket();

            if (brokerSelect) {
                brokerSelect.onchange = (e) => {
                    if (window.TradingEngine) {
                        window.TradingEngine.setBrokerMode(e.target.value);
                    }
                };
            }

            if (quickOneClick) {
                quickOneClick.onchange = (e) => {
                    this.settings.oneClickTrading = e.target.checked;
                    this.saveSettings();
                    this.renderOnChartWidget();
                    this.renderSidePanel();
                };
            }

            if (btnDockToggle) {
                btnDockToggle.onclick = () => {
                    this.dockMode = this.dockMode === 'docked' ? 'floating' : 'docked';
                    this.saveSettings();
                    this.renderSidePanel();
                };
            }

            if (btnSettings) btnSettings.onclick = () => this.openTradingSettingsModal();

            // Subtab buttons
            panel.querySelectorAll('.tv-subtab-btn').forEach(btn => {
                btn.onclick = (e) => {
                    this.selectedTab = e.currentTarget.getAttribute('data-tab');
                    this.renderSidePanel();
                };
            });

            // Position Action Buttons
            panel.querySelectorAll('.tv-pos-be-btn').forEach(btn => {
                btn.onclick = (e) => {
                    const ticket = parseInt(btn.getAttribute('data-ticket'), 10);
                    const pos = (this.positions || []).find(p => p.ticket === ticket) || (window.PaperTrading && window.PaperTrading.getPositions().find(p => p.ticket === ticket));
                    if (pos && window.TradingEngine) {
                        window.TradingEngine.moveBreakEven(pos);
                        this.renderSidePanel();
                    }
                };
            });

            panel.querySelectorAll('.tv-pos-partial-btn').forEach(btn => {
                btn.onclick = (e) => {
                    const ticket = parseInt(btn.getAttribute('data-ticket'), 10);
                    const pos = (this.positions || []).find(p => p.ticket === ticket) || (window.PaperTrading && window.PaperTrading.getPositions().find(p => p.ticket === ticket));
                    if (pos && window.TradingEngine) {
                        window.TradingEngine.closePartial(pos, 50);
                        this.renderSidePanel();
                    }
                };
            });

            panel.querySelectorAll('.tv-pos-close-btn').forEach(btn => {
                btn.onclick = (e) => {
                    const ticket = parseInt(btn.getAttribute('data-ticket'), 10);
                    if (window.TradingEngine) {
                        window.TradingEngine.closePosition({ ticket });
                        this.renderSidePanel();
                    }
                };
            });

            // Order Cancel Button
            panel.querySelectorAll('.tv-ord-cancel-btn').forEach(btn => {
                btn.onclick = (e) => {
                    const ticket = parseInt(btn.getAttribute('data-ticket'), 10);
                    if (window.TradingEngine) {
                        window.TradingEngine.cancelOrder(ticket);
                        this.renderSidePanel();
                    }
                };
            });

            // History actions
            const btnClear = panel.querySelector('#tv-btn-clear-history');
            const btnReset = panel.querySelector('#tv-btn-reset-account');
            if (btnClear) {
                btnClear.onclick = () => {
                    if (window.PaperTrading && confirm('Clear all paper trading trade history?')) {
                        window.PaperTrading.clearHistory();
                        this.renderSidePanel();
                    }
                };
            }
            if (btnReset) {
                btnReset.onclick = () => {
                    if (window.PaperTrading && confirm('Reset Paper Trading account to $100,000 balance?')) {
                        window.PaperTrading.resetAccount(100000.00);
                        this.renderSidePanel();
                    }
                };
            }

            // Paper Deposit
            const depBtn = panel.querySelector('#tv-account-deposit-btn');
            const depIn = panel.querySelector('#tv-account-deposit-in');
            if (depBtn && depIn) {
                depBtn.onclick = () => {
                    const amt = parseFloat(depIn.value);
                    if (amt > 0 && window.PaperTrading) {
                        const cur = window.PaperTrading.state.balance || 100000;
                        window.PaperTrading.setBalance(cur + amt);
                        depIn.value = '';
                        this.renderSidePanel();
                    }
                };
            }

            // Split card (Sell / Buy)
            const splitSell = panel.querySelector('#tv-ticket-split-sell');
            const splitBuy = panel.querySelector('#tv-ticket-split-buy');
            if (splitSell) {
                splitSell.onclick = () => {
                    this.selectedSide = 'SELL';
                    this.renderSidePanel();
                };
            }
            if (splitBuy) {
                splitBuy.onclick = () => {
                    this.selectedSide = 'BUY';
                    this.renderSidePanel();
                };
            }

            // Order type tabs
            panel.querySelectorAll('.tv-order-type-btn').forEach(btn => {
                btn.onclick = (e) => {
                    this.orderType = e.target.getAttribute('data-type');
                    this.renderSidePanel();
                };
            });

            // Units input
            const unitsIn = panel.querySelector('#tv-ticket-units-in');
            if (unitsIn) {
                unitsIn.oninput = (e) => {
                    const val = Math.max(0.01, parseFloat(e.target.value) || 1.0);
                    this.lots = val;
                    this.settings.defaultLots = val;
                    this.updateFinancialSummary();
                    const btnSummary = panel.querySelector('#tv-ticket-btn-summary-text');
                    if (btnSummary) {
                        btnSummary.innerText = `${this.lots} ${this.currentSymbol} ${this.orderType.toUpperCase()}`;
                    }
                };
            }

            // Exits accordion toggle
            const exitsToggle = panel.querySelector('#tv-ticket-exits-toggle');
            if (exitsToggle) {
                exitsToggle.onclick = () => {
                    this.isExitsExpanded = !this.isExitsExpanded;
                    this.renderSidePanel();
                };
            }

            // TP & SL toggles
            const checkTp = panel.querySelector('#tv-ticket-check-tp');
            const checkSl = panel.querySelector('#tv-ticket-check-sl');
            if (checkTp) {
                checkTp.onchange = (e) => {
                    this.isTpEnabled = e.target.checked;
                    this.renderSidePanel();
                };
            }
            if (checkSl) {
                checkSl.onchange = (e) => {
                    this.isSlEnabled = e.target.checked;
                    this.renderSidePanel();
                };
            }

            // TP & SL numeric inputs
            const tpTicksIn = panel.querySelector('#tv-ticket-tp-ticks-in');
            const slTicksIn = panel.querySelector('#tv-ticket-sl-ticks-in');
            if (tpTicksIn) {
                tpTicksIn.oninput = (e) => {
                    this.tpTicks = parseFloat(e.target.value) || 75;
                };
            }
            if (slTicksIn) {
                slTicksIn.oninput = (e) => {
                    this.slTicks = parseFloat(e.target.value) || 25;
                };
            }

            // Execute button
            const btnExecute = panel.querySelector('#tv-ticket-btn-execute');
            if (btnExecute) {
                btnExecute.onclick = () => this.executeTicketOrder();
            }

            if (this.dockMode === 'floating') {
                const header = panel.querySelector('#tv-panel-drag-header');
                this.makeDraggable(panel, header, (top, left) => {
                    this.floatingPos = { top: top + 'px', left: left + 'px', right: 'auto' };
                });
            }
        }

        executeInstantOrder(side) {
            this.syncPricesWithChart();
            const price = side === 'BUY' ? this.currentAsk : this.currentBid;
            const lots = this.lots || 1.0;

            if (window.TradingEngine) {
                window.TradingEngine.placeOrder({
                    symbol: this.currentSymbol,
                    type: side,
                    orderType: 'market',
                    lots: lots,
                    price: price,
                    sl: 0.0,
                    tp: 0.0
                }).then(res => {
                    if (res && res.success) {
                        const brokerName = window.TradingEngine.getActiveAdapter(this.currentSymbol).name;
                        if (window.FyersAPI && window.FyersAPI.showToast) {
                            window.FyersAPI.showToast(`✓ [${brokerName}] 1-Click ${side} ${lots} ${this.currentSymbol} filled @ ${price}!`, 'success');
                        }
                    } else {
                        alert(`Order Failed: ${res && res.error ? res.error : 'Connection or Margin Error'}`);
                    }
                });
            }
        }

        async executeTicketOrder() {
            const btn = document.getElementById('tv-ticket-btn-execute');
            if (btn) btn.style.opacity = '0.7';

            this.syncPricesWithChart();
            const type = this.selectedSide;
            const lots = this.lots || 1.0;
            const price = type === 'BUY' ? this.currentAsk : this.currentBid;

            let sl = 0.0;
            let tp = 0.0;
            if (this.isTpEnabled) sl = parseFloat(this.calculateExitPrice('tp')) || 0.0;
            if (this.isSlEnabled) tp = parseFloat(this.calculateExitPrice('sl')) || 0.0;

            const brokerName = window.TradingEngine ? window.TradingEngine.getActiveAdapter(this.currentSymbol).name : 'Broker';
            const res = await window.TradingEngine.placeOrder({
                symbol: this.currentSymbol,
                type: type,
                orderType: this.orderType,
                lots: lots,
                price: price,
                sl: sl,
                tp: tp
            });

            if (btn) {
                btn.style.opacity = '1';
                this.renderSidePanel();
            }

            if (res && res.success) {
                const msg = `✓ [${brokerName}] ${type} ${lots} ${this.currentSymbol} ${this.orderType.toUpperCase()} submitted!`;
                if (window.FyersAPI && window.FyersAPI.showToast) {
                    window.FyersAPI.showToast(msg, 'success');
                }
            } else {
                alert(`Order Execution Failed: ${res && res.error ? res.error : 'Execution rejected by broker'}`);
            }
        }

        openOrderTicket(side = 'BUY') {
            this.selectedSide = side;
            this.isPanelOpen = true;
            this.renderSidePanel();
            this.updateToolbarBtnState();
        }

        closeOrderTicket() {
            this.isPanelOpen = false;
            const panel = document.getElementById(this.sidePanelId);
            if (panel) panel.style.display = 'none';
            this.updateChartContainerLayout();
            this.updateToolbarBtnState();
        }

        updateChartContainerLayout() {
            const chartCont = document.getElementById('tv_chart_container');
            if (!chartCont) return;

            if (this.isPanelOpen && this.dockMode === 'docked') {
                const panelWidth = 340;
                if (this.dockSide === 'right') {
                    chartCont.style.width = `calc(100% - ${panelWidth}px)`;
                    chartCont.style.left = '0';
                    chartCont.style.right = `${panelWidth}px`;
                } else {
                    chartCont.style.width = `calc(100% - ${panelWidth}px)`;
                    chartCont.style.left = `${panelWidth}px`;
                    chartCont.style.right = '0';
                }
            } else {
                chartCont.style.width = '100%';
                chartCont.style.left = '0';
                chartCont.style.right = '0';
            }
        }

        getTheme() {
            const isDark = document.body.classList.contains('theme-dark') ||
                           document.querySelector('[data-theme="dark"]') !== null;
            if (isDark) {
                return {
                    isDark: true,
                    panelBg: '#1e222d',
                    cardBg: '#131722',
                    border: '#2a2e39',
                    text: '#d1d4dc',
                    textMuted: '#787b86',
                    inputBg: '#131722',
                    subtabBg: '#2a2e39',
                    sellActiveBg: 'rgba(242,54,69,0.15)',
                    buyActiveBg: 'rgba(41,98,255,0.15)',
                    sellColor: '#f23645',
                    buyColor: '#2962ff',
                    shadow: '0 8px 24px rgba(0,0,0,0.5)'
                };
            }
            return {
                isDark: false,
                panelBg: '#ffffff',
                cardBg: '#f8f9fd',
                border: '#e0e3eb',
                text: '#131722',
                textMuted: '#787b86',
                inputBg: '#ffffff',
                subtabBg: '#f0f3fa',
                sellActiveBg: '#ffeef0',
                buyActiveBg: '#eef3ff',
                sellColor: '#f23645',
                buyColor: '#2962ff',
                shadow: '0 8px 24px rgba(0,0,0,0.12)'
            };
        }

        makeDraggable(element, handle, onSave) {
            if (!handle) return;
            let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
            handle.onmousedown = (e) => {
                if (['BUTTON', 'INPUT', 'SELECT'].includes(e.target.tagName)) return;
                e.preventDefault();
                pos3 = e.clientX;
                pos4 = e.clientY;
                document.onmouseup = () => {
                    document.onmouseup = null;
                    document.onmousemove = null;
                    if (onSave) onSave(parseInt(element.style.top, 10), parseInt(element.style.left, 10));
                };
                document.onmousemove = (e2) => {
                    e2.preventDefault();
                    pos1 = pos3 - e2.clientX;
                    pos2 = pos4 - e2.clientY;
                    pos3 = e2.clientX;
                    pos4 = e2.clientY;

                    let newTop = element.offsetTop - pos2;
                    let newLeft = element.offsetLeft - pos1;
                    newTop = Math.max(10, Math.min(window.innerHeight - 200, newTop));
                    newLeft = Math.max(10, Math.min(window.innerWidth - 350, newLeft));

                    element.style.top = newTop + "px";
                    element.style.left = newLeft + "px";
                    element.style.right = "auto";
                    element.style.bottom = "auto";
                };
            };
        }

        updatePrices() {
            this.syncPricesWithChart();

            if (window.PaperTrading) {
                window.PaperTrading.onPriceTick(this.currentSymbol, this.currentBid, this.currentAsk);
            }

            const ticketBid = document.getElementById('tv-ticket-bid-val');
            const ticketAsk = document.getElementById('tv-ticket-ask-val');
            const ticketSpread = document.getElementById('tv-ticket-spread-badge');
            if (ticketBid) ticketBid.innerText = this.formatPrice(this.currentBid);
            if (ticketAsk) ticketAsk.innerText = this.formatPrice(this.currentAsk);
            if (ticketSpread) ticketSpread.innerText = this.getSpreadFormatted();

            this.updateFinancialSummary();
        }

        renderHeader() {
            const symEl = document.getElementById('tv-side-panel-symbol');
            if (symEl) symEl.innerText = this.currentSymbol;
        }

        updateFinancialSummary() {
            const tradeValEl = document.getElementById('tv-ticket-usd-val');
            const tradeSumEl = document.getElementById('tv-val-trade-summary');
            const availMarginEl = document.getElementById('tv-val-avail-margin');

            const valStr = this.calculateTradeValueUSD();
            if (tradeValEl) tradeValEl.innerText = `${valStr} USD ⌵`;
            if (tradeSumEl) tradeSumEl.innerText = `${valStr} USD`;
            if (availMarginEl) availMarginEl.innerText = `${this.getAvailableMarginFormatted()} USD`;
        }

        calculateTradeValueUSD() {
            const refPrice = this.selectedSide === 'BUY' ? this.currentAsk : this.currentBid;
            let contractSize = 100000;
            if (this.currentSymbol.includes('XAU')) contractSize = 100;
            else if (this.currentSymbol.includes('US30') || this.currentSymbol.includes('NAS')) contractSize = 1;

            const totalValue = this.lots * refPrice * (contractSize > 1 ? contractSize / 1000 : 1);
            return totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        getAvailableMarginFormatted() {
            const adapterKey = window.TradingEngine ? window.TradingEngine.getActiveBrokerKey(this.currentSymbol) : 'paper';
            if (adapterKey === 'paper' && window.PaperTrading) {
                const s = window.PaperTrading.getAccountSummary();
                return Number(s.freeMargin).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
            if (window.MT5API) {
                const acc = window.MT5API.getActiveAccount();
                if (acc && acc.margin_free != null) {
                    return Number(acc.margin_free).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                }
            }
            return '99,999.20';
        }

        calculateExitPrice(type) {
            const refPrice = this.selectedSide === 'BUY' ? this.currentAsk : this.currentBid;
            const pipUnit = this.currentSymbol.includes('JPY') ? 0.01 : (this.currentSymbol.includes('XAU') ? 0.01 : (this.currentSymbol.includes('US30') ? 1.0 : 0.0001));

            if (type === 'tp') {
                const diff = this.tpTicks * pipUnit;
                const p = this.selectedSide === 'BUY' ? (refPrice + diff) : (refPrice - diff);
                return this.formatPrice(p);
            } else {
                const diff = this.slTicks * pipUnit;
                const p = this.selectedSide === 'BUY' ? (refPrice - diff) : (refPrice + diff);
                return this.formatPrice(p);
            }
        }

        getSpreadFormatted() {
            const diff = Math.abs(this.currentAsk - this.currentBid);
            if (this.currentSymbol.includes('JPY') || this.currentSymbol.includes('XAU')) {
                return (diff * 100).toFixed(1);
            } else if (this.currentSymbol.includes('NIFTY') || this.currentSymbol.includes('BANKNIFTY') || this.currentSymbol.includes('US30') || this.currentSymbol.includes('NAS')) {
                return diff.toFixed(1);
            } else if (diff < 1) {
                return (diff * 10000).toFixed(1);
            }
            return diff.toFixed(1);
        }

        formatPrice(price) {
            if (!price || isNaN(price)) return '0.00';
            if (this.currentSymbol.includes('JPY')) return Number(price).toFixed(3);
            if (this.currentSymbol.includes('XAU')) return Number(price).toFixed(2);
            if (this.currentSymbol.includes('US30') || this.currentSymbol.includes('NAS')) return Number(price).toFixed(2);
            if (this.currentSymbol.includes('NIFTY') || this.currentSymbol.includes('BANKNIFTY') || price > 500) {
                return Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
            if (price < 10) return Number(price).toFixed(5);
            return Number(price).toFixed(2);
        }

        syncPricesWithChart() {
            const chartP = this.getChartPrice();
            if (chartP && (!window.MT5API || !window.MT5API.isConnected || !this.currentSymbol.includes('USD'))) {
                const spreadStep = chartP > 500 ? 0.50 : (chartP > 10 ? 0.05 : 0.0002);
                this.currentBid = chartP;
                this.currentAsk = chartP + spreadStep;
            }
        }

        setLots(val) {
            this.lots = val;
            this.settings.defaultLots = val;
            this.saveSettings();
            const centerDisp = document.getElementById('tv-native-center-lot-disp');
            if (centerDisp) centerDisp.innerText = this.lots;
            const unitsIn = document.getElementById('tv-ticket-units-in');
            if (unitsIn) unitsIn.value = this.lots;
            this.updateFinancialSummary();
        }

        injectCSS() {
            const style = document.createElement('style');
            style.innerHTML = `
                .tv-toggle-switch {
                    position: relative;
                    display: inline-block;
                    width: 32px;
                    height: 18px;
                }
                .tv-toggle-switch input {
                    opacity: 0;
                    width: 0;
                    height: 0;
                }
                .tv-toggle-slider {
                    position: absolute;
                    cursor: pointer;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background-color: #b2b5be;
                    transition: .15s;
                    border-radius: 18px;
                }
                .tv-toggle-slider:before {
                    position: absolute;
                    content: "";
                    height: 14px;
                    width: 14px;
                    left: 2px;
                    bottom: 2px;
                    background-color: white;
                    transition: .15s;
                    border-radius: 50%;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                }
                .tv-toggle-switch input:checked + .tv-toggle-slider {
                    background-color: #2962ff;
                }
                .tv-toggle-switch input:checked + .tv-toggle-slider:before {
                    transform: translateX(14px);
                }
            `;
            document.head.appendChild(style);
        }

        openTradingSettingsModal() {
            // Trading settings dialog
            alert('Settings: Customize default order sizes, broker routing, and hotkeys.');
        }
    }

    // Export singleton
    window.TradeUI = new TradeUI();

})(window);
