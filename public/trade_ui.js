/**
 * Authentic Native TradingView On-Chart Trading Suite, Right-Side Order Ticket & Bottom Trading Activity Panel
 * 
 * Features:
 *  1. Native on-chart Buy/Sell widget anchored directly inside <div class="legendMainSourceWrapper-YTFIJ62h">.
 *     - Filled vs Non-Filled Button states based on live broker / paper trading connection status.
 *     - Authentic TV hover tooltips with keyboard shortcuts ("Buy Market | Shift B", "Sell Market | Shift S").
 *     - Single center quantity pill shown ONLY when One-Click Trading is enabled.
 *     - Authentic Quantity Keypad Popup (Image 2) mounted to root body with position:fixed (NEVER CROPPED!).
 *  2. Pure Right-Side Order Ticket (100% Matching Image 2):
 *     - Header: [TV] black square logo (20x20px), Symbol text, DOM 4-square icon, ···, ✕ close.
 *     - Segmented Control: [Order] [DOM] pills in #f0f3fa container.
 *     - Split Sell / Buy Quote Box with soft red/blue tint when active and center floating spread pill.
 *     - Order Type Tabs: [Market] [Limit] [Stop] with authentic bottom dark underline indicator.
 *     - Price Input: visible for Limit/Stop with 2px blue focus border, ⇄ swap icon, and offset helper ("Ask + 290").
 *     - Units Input: "Units ˇ" label, ⇄ swap icon, and currency conversion dropdown ("82.75 USD ˇ").
 *     - Financial Breakdown Card (#f8f9fd): Trade value (50x), Available margin, Tick value.
 *     - Exits Section: collapsible "Exits ⌃", Take Profit & Stop Loss rows with iOS toggle switches and tick inputs.
 *     - Extra Settings Section: collapsible "Extra settings ⌃", Time in force dropdown ("Week ˇ").
 *     - Big Action Button: solid blue (#2962ff) or red (#f23645) with dual-line text:
 *       Line 1: Buy (or Sell) in bold 16px white.
 *       Line 2: 1 XAUUSD @ 4,137.390 LIMIT (or 1 NIFTY50-INDEX MARKET) in 11px uppercase white.
 *  3. Dedicated Bottom-Docked Trading Activity Panel / Account Manager (100% Matching Images 3, 4, 5):
 *     - Docked horizontally below the chart; top edge resize handle with ns-resize cursor.
 *     - Resizes #tv_chart_container bottom offset dynamically so the chart is NEVER covered or cropped!
 *     - Top Header: [TV Logo] Paper Trading ˇ / MT5 ˇ / Fyers ˇ + Account pill [FusionPhantom USD ˇ].
 *     - Account Summary KPIs (Exact 8 metrics):
 *       Account balance | Equity | Realized PnL | Unrealized PnL | Account margin | Available funds | Orders margin | Margin buffer
 *     - Window Controls: Minimize [—], Maximize [⤢], Close [✕].
 *     - Navigation Tabs: [Positions 1] [Orders] [Order history] [Balance history] [Activity log] [Trade history] [Analytics] + Export [⤓].
 *     - Sub-filters: [All] [Working] [Inactive] [Filled] [Cancelled] [Rejected].
 *     - Pixel-perfect Tables:
 *       • Positions Tab (Image 3): Symbol badge, Side (Long/Short), Quantity, Avg fill price, TP, SL, Last price,
 *         Unrealized PnL, Unrealized PnL %, Trade value, Market value, Leverage, Margin, Expiry, ✎ Protect, ✕ Close.
 *       • Orders Tab (Image 4): Symbol badge, Side, Type, Quantity, Limit/Stop/Fill prices, Status badge, Placing time, Order ID, ✕ Cancel.
 *       • Order History Tab (Image 5): Symbol badge, Side, Type, Quantity, Fill price, Status, Commission, Placing/Closing time, Order ID, Leverage, Margin.
 *       • Balance History Tab: Time, Type, Amount, Balance, Comment with deposit & reset buttons.
 *       • Activity Log Tab: Live audit log of trades, orders, modifications, and cancellations.
 *       • Analytics Tab: Summary KPI performance cards (Win Rate %, Profit Factor, Max Drawdown, Sharpe Ratio).
 *  4. Persistent Bottom Bar Launcher Tab:
 *     - [TV Logo] Trading Panel ({posCount}) pill button at the bottom of the window to toggle the panel anytime.
 *  5. Interactive On-Chart Canvas Trades:
 *     - Official TradingView primitives: LineToolPosition & LineToolOrder via chart.createPositionLine() & chart.createOrderLine().
 */

(function(window) {
    'use strict';

    class TradeUI {
        constructor() {
            this.onChartWidgetId = 'tv-native-onchart-trade-widget';
            this.sideTicketId = 'tv-native-side-order-ticket';
            this.bottomPanelId = 'tv-native-bottom-trading-panel';
            this.bottomLauncherId = 'tv-native-bottom-launcher-bar';
            this.settingsModalId = 'tv-trading-settings-modal';
            this.toolbarBtnId = 'header-toolbar-trade-btn';
            this.toolbarGroupId = 'header-toolbar-trade-manager';
            this.keypadPopupId = 'tv-native-qty-keypad-popup';
            this.tooltipId = 'tv-native-chart-tooltip';
            this.overlayContainerId = 'tv-chart-positions-overlay';

            // Settings & Persistence
            this.settings = this.loadSettings();

            // Right-Side Order Ticket State
            this.isOrderTicketOpen = false;
            this.isPanelOpen = false; // Backward-compatibility alias
            this.dockMode = this.settings.dockMode || 'docked'; // 'docked' or 'floating'
            this.dockSide = this.settings.dockSide || 'right'; // 'right' or 'left'
            this.floatingPos = this.settings.floatingPos || { top: '80px', right: '30px', left: 'auto' };
            this.selectedSide = 'BUY'; // 'BUY' or 'SELL'
            this.orderType = 'market'; // 'market', 'limit', 'stop'
            this.ticketTab = 'order'; // 'order' or 'dom'
            this.limitPrice = 0.0;
            this.stopPrice = 0.0;
            this.lots = this.settings.defaultLots || 1.0;
            this.isExitsExpanded = true;
            this.isExtraSettingsExpanded = false;
            this.timeInForce = 'Week';
            this.isTpEnabled = false;
            this.isSlEnabled = false;
            this.tpTicks = 75;
            this.slTicks = 25;

            // Bottom Trading Activity Panel State
            this.isBottomPanelOpen = false;
            this.isBottomPanelFullscreen = false;
            this.bottomPanelHeight = this.settings.bottomPanelHeight || 270;
            this.minBottomHeight = 160;
            this.bottomActiveTab = 'positions'; // 'positions', 'orders', 'history', 'balance', 'activity', 'trades', 'analytics'
            this.ordersSubFilter = 'all'; // 'all', 'working', 'inactive', 'filled', 'cancelled', 'rejected'
            this.historySubFilter = 'all'; // 'all', 'filled', 'cancelled', 'rejected'

            // Live State
            this.currentSymbol = 'NIFTY50-INDEX';
            this.currentBid = 22811.35;
            this.currentAsk = 22811.85;
            this.positions = [];
            this.nativeLines = new Map(); // Official TradingView line tool adapters

            // Activity Log Tracking
            this.activityLogs = this.loadActivityLogs();

            this.init();
        }

        loadSettings() {
            const defaults = {
                showBuySellButtons: true,
                oneClickTrading: false,
                dockMode: 'docked',
                dockSide: 'right',
                defaultLots: 1.0,
                bottomPanelHeight: 270
            };
            try {
                const saved = localStorage.getItem('tv_trading_settings_v8');
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
                this.settings.bottomPanelHeight = this.bottomPanelHeight;
                localStorage.setItem('tv_trading_settings_v8', JSON.stringify(this.settings));
            } catch (_) {}
        }

        loadActivityLogs() {
            try {
                const saved = localStorage.getItem('tv_trading_activity_logs');
                if (saved) return JSON.parse(saved);
            } catch (_) {}
            return [
                { time: '2026-10-22 03:17:09', event: 'Order Filled', broker: 'Paper Trading', details: 'Buy 1 XAUUSD Market @ 4,139.590', status: 'Success' },
                { time: '2026-10-22 02:25:38', event: 'Order Filled', broker: 'Paper Trading', details: 'Sell 1 XAUUSD Market @ 4,139.190', status: 'Success' }
            ];
        }

        saveActivityLogs() {
            try {
                localStorage.setItem('tv_trading_activity_logs', JSON.stringify(this.activityLogs.slice(0, 100)));
            } catch (_) {}
        }

        logActivity(event, details, broker = 'Paper Trading', status = 'Success') {
            const now = new Date();
            const timeStr = now.toISOString().replace('T', ' ').substring(0, 19);
            this.activityLogs.unshift({ time: timeStr, event, broker, details, status });
            this.saveActivityLogs();
            if (this.isBottomPanelOpen && this.bottomActiveTab === 'activity') {
                this.renderBottomTradingPanel();
            }
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
                    this.syncNativeChartLines();
                    if (this.isBottomPanelOpen) this.renderBottomTradingPanel();
                    this.updateBottomLauncherBadge();
                });
            }

            // Bind to PaperTrading updates
            if (window.PaperTrading) {
                window.PaperTrading.onUpdate(() => {
                    if (window.TradingEngine && window.TradingEngine.getActiveBrokerKey(this.currentSymbol) === 'paper') {
                        this.positions = window.PaperTrading.getPositions();
                        this.syncNativeChartLines();
                        if (this.isBottomPanelOpen) this.renderBottomTradingPanel();
                        this.updateBottomLauncherBadge();
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

            // Periodic sync interval (prices, symbol, toolbar button, chart lines, launcher)
            setInterval(() => {
                this.detectSymbolChange();
                this.renderOnChartWidget();
                this.injectToolbarButton();
                this.renderBottomLauncherBar();
                this.updatePrices();
                this.syncNativeChartLines();
            }, 600);

            // Bind Bottom Resizer Drag Events
            this.bindBottomPanelResizer();

            // Keyboard Shortcuts
            window.addEventListener('keydown', (e) => {
                if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
                if (e.key === 'Escape') {
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
        }

        mount() {
            this.renderOnChartWidget();
            this.renderSideOrderTicket();
            this.renderBottomTradingPanel();
            this.renderBottomLauncherBar();
            this.injectToolbarButton();
            this.updateChartContainerLayout();
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
                            this.clearAllNativeChartLines();
                            this.syncNativeChartLines();
                            this.renderHeader();
                            this.updatePrices();
                            this.renderOnChartWidget();
                            if (this.isOrderTicketOpen) this.renderSideOrderTicket();
                            if (this.isBottomPanelOpen) this.renderBottomTradingPanel();
                        }
                    }
                }
            } catch (_) {}
        }

        // ==========================================
        // 1. TOP TOOLBAR BUTTON
        // ==========================================
        injectToolbarButton() {
            const targetDoc = document;
            if (targetDoc.getElementById(this.toolbarGroupId)) return;

            const mt5Wrapper = targetDoc.getElementById('header-toolbar-mt5-manager');
            const fyersWrapper = targetDoc.getElementById('header-toolbar-broker-manager');
            const symbolSearch = targetDoc.getElementById('header-toolbar-symbol-search');

            const btnHtml = `
            <div class="group-MBOVGQRI" id="${this.toolbarGroupId}" style="margin: 0 4px; display: inline-flex; align-items: center;">
                <button aria-label="Trade Ticket" data-role="button" tabindex="-1" type="button" 
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
                        background: ${this.isOrderTicketOpen ? '#f0f3fa' : '#ffffff'};
                        color: ${this.isOrderTicketOpen ? '#2962ff' : '#131722'};
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
                    this.toggleOrderTicket();
                };
            }
        }

        updateToolbarBtnState() {
            const btn = document.getElementById(this.toolbarBtnId);
            if (!btn) return;
            if (this.isOrderTicketOpen) {
                btn.style.background = '#f0f3fa';
                btn.style.color = '#2962ff';
            } else {
                btn.style.background = '#ffffff';
                btn.style.color = '#131722';
            }
        }

        toggleOrderTicket() {
            if (this.isOrderTicketOpen) {
                this.closeOrderTicket();
            } else {
                this.openOrderTicket(this.selectedSide);
            }
        }

        // Backward compatibility
        togglePanel() {
            this.toggleOrderTicket();
        }

        renderSidePanel() {
            this.renderSideOrderTicket();
        }

        // ==========================================
        // 2. NATIVE ON-CHART BUY/SELL WIDGET
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
                    bidDisp.innerHTML = this.formatPipPriceHtml(this.currentBid);
                    askDisp.innerHTML = this.formatPipPriceHtml(this.currentAsk);
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
                        <span id="tv-native-bid-disp" style="color: ${sellTextColor}; font-size: 12px; font-weight: 700; line-height: 1.15;">${this.formatPipPriceHtml(this.currentBid)}</span>
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
                        <span id="tv-native-ask-disp" style="color: ${buyTextColor}; font-size: 12px; font-weight: 700; line-height: 1.15;">${this.formatPipPriceHtml(this.currentAsk)}</span>
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
        // ==========================================
        ensureKeypadPopup(iframeDoc) {
            let popup = iframeDoc.getElementById(this.keypadPopupId);
            if (popup) return popup;

            popup = iframeDoc.createElement('div');
            popup.id = this.keypadPopupId;
            popup.style.cssText = `
                display: none;
                position: fixed;
                width: 210px;
                background: #ffffff;
                border: 1px solid #e0e3eb;
                border-radius: 8px;
                box-shadow: 0 8px 28px rgba(0,0,0,0.22);
                z-index: 2147483647;
                padding: 10px;
                font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif;
                user-select: none;
            `;

            popup.innerHTML = `
                <!-- Display Box -->
                <div style="display: flex; align-items: center; justify-content: space-between; background: #f0f3fa; border-radius: 5px; padding: 4px 8px; margin-bottom: 8px;">
                    <span id="tv-keypad-val-disp" style="font-size: 15px; font-weight: 700; color: #131722;">1</span>
                    <button id="tv-keypad-btn-backspace" type="button" title="Backspace" style="background: transparent; border: none; cursor: pointer; color: #787b86; padding: 2px; display: flex; align-items: center;">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>
                    </button>
                </div>

                <!-- 3x4 Number Grid -->
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-bottom: 8px;">
                    ${['1','2','3','4','5','6','7','8','9','.','0','C'].map(n => `
                        <button type="button" class="tv-keypad-num-btn" data-key="${n}" style="
                            height: 32px;
                            background: #ffffff;
                            border: 1px solid #d1d4dc;
                            border-radius: 4px;
                            font-size: 13px;
                            font-weight: 700;
                            color: #131722;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            transition: background 0.1s;
                        ">${n}</button>
                    `).join('')}
                </div>

                <!-- Quick Presets -->
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 8px;">
                    ${['0.1', '0.5', '1', '5'].map(p => `
                        <button type="button" class="tv-keypad-preset-btn" data-preset="${p}" style="
                            padding: 3px 0;
                            background: #f8f9fd;
                            border: 1px solid #e0e3eb;
                            border-radius: 4px;
                            font-size: 10px;
                            font-weight: 700;
                            color: #2962ff;
                            cursor: pointer;
                            text-align: center;
                        ">${p}</button>
                    `).join('')}
                </div>

                <!-- Done Button -->
                <button id="tv-keypad-btn-done" type="button" style="
                    width: 100%;
                    height: 28px;
                    background: #2962ff;
                    color: #ffffff;
                    border: none;
                    border-radius: 4px;
                    font-size: 12px;
                    font-weight: 700;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">Apply</button>
            `;

            iframeDoc.body.appendChild(popup);

            let curInput = String(this.lots);

            const updateDisp = () => {
                const disp = popup.querySelector('#tv-keypad-val-disp');
                if (disp) disp.innerText = curInput || '0';
            };

            popup.querySelectorAll('.tv-keypad-num-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const key = btn.getAttribute('data-key');
                    if (key === 'C') {
                        curInput = '';
                    } else if (key === '.') {
                        if (!curInput.includes('.')) curInput = (curInput || '0') + '.';
                    } else {
                        if (curInput === '0') curInput = key;
                        else curInput += key;
                    }
                    updateDisp();
                };
            });

            popup.querySelectorAll('.tv-keypad-preset-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    curInput = btn.getAttribute('data-preset');
                    updateDisp();
                };
            });

            const backBtn = popup.querySelector('#tv-keypad-btn-backspace');
            if (backBtn) {
                backBtn.onclick = (e) => {
                    e.stopPropagation();
                    curInput = curInput.slice(0, -1);
                    updateDisp();
                };
            }

            const doneBtn = popup.querySelector('#tv-keypad-btn-done');
            if (doneBtn) {
                doneBtn.onclick = (e) => {
                    e.stopPropagation();
                    const parsed = parseFloat(curInput);
                    if (!isNaN(parsed) && parsed > 0) {
                        this.setLots(parsed);
                    }
                    popup.style.display = 'none';
                };
            }

            iframeDoc.addEventListener('click', (e) => {
                if (popup.style.display !== 'none' && !popup.contains(e.target)) {
                    popup.style.display = 'none';
                }
            });

            return popup;
        }

        toggleQuantityKeypad(anchorBtn, iframeDoc) {
            const popup = this.ensureKeypadPopup(iframeDoc);
            if (popup.style.display === 'block') {
                popup.style.display = 'none';
                return;
            }

            const rect = anchorBtn.getBoundingClientRect();
            popup.style.top = (rect.bottom + 6) + 'px';
            popup.style.left = Math.max(10, rect.left - 40) + 'px';
            popup.style.display = 'block';

            const disp = popup.querySelector('#tv-keypad-val-disp');
            if (disp) disp.innerText = String(this.lots);
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
        // 4. INTERACTIVE ON-CHART TRADING LINES (Canvas Primitives)
        // ==========================================
        syncNativeChartLines() {
            if (!window.tvWidget) return;
            let chart;
            try {
                chart = window.tvWidget.activeChart ? window.tvWidget.activeChart() : window.tvWidget.chart();
            } catch (_) { return; }
            if (!chart || typeof chart.createPositionLine !== 'function') return;

            // Remove legacy HTML overlays
            try {
                const iframe = document.querySelector('#tv_chart_container iframe') || document.querySelector('iframe');
                if (iframe && iframe.contentDocument) {
                    const oldOverlay = iframe.contentDocument.getElementById(this.overlayContainerId);
                    if (oldOverlay) oldOverlay.remove();
                }
            } catch (_) {}

            // Ensure trading properties are active
            try {
                const model = chart._chartWidget?.model?.()?.model?.();
                if (model && model.properties) {
                    const tp = model.properties().tradingProperties;
                    if (tp) {
                        if (tp.showPositions && !tp.showPositions.value()) tp.showPositions.setValue(true);
                        if (tp.showOrders && !tp.showOrders.value()) tp.showOrders.setValue(true);
                        if (tp.positionPL && tp.positionPL.visibility && !tp.positionPL.visibility.value()) tp.positionPL.visibility.setValue(true);
                        if (tp.bracketsPL && tp.bracketsPL.visibility && !tp.bracketsPL.visibility.value()) tp.bracketsPL.visibility.setValue(true);
                    }
                }
            } catch (_) {}

            const currentSym = (this.currentSymbol || '').split(':').pop().toUpperCase();
            const allPositions = (this.positions && this.positions.length > 0)
                ? this.positions
                : (window.PaperTrading ? window.PaperTrading.getPositions() : []);
            const symPositions = (allPositions || []).filter(p => p.symbol && p.symbol.toUpperCase() === currentSym);
            const activeTickets = new Set(symPositions.map(p => p.ticket));

            // Remove closed lines
            for (const [ticket, data] of this.nativeLines.entries()) {
                if (!activeTickets.has(ticket)) {
                    try { if (data.posLine) data.posLine.remove(); } catch (_) {}
                    try { if (data.tpLine) data.tpLine.remove(); } catch (_) {}
                    try { if (data.slLine) data.slLine.remove(); } catch (_) {}
                    this.nativeLines.delete(ticket);
                }
            }

            // Synchronize active position lines
            for (const pos of symPositions) {
                let data = this.nativeLines.get(pos.ticket);
                if (!data) {
                    data = {
                        posLine: null,
                        tpLine: null,
                        slLine: null,
                        creatingPos: false,
                        creatingTp: false,
                        creatingSl: false,
                        posConfigured: false,
                        tpConfigured: false,
                        slConfigured: false,
                        lastPrice: null,
                        lastPnl: null,
                        lastLots: null,
                        lastTp: null,
                        lastSl: null
                    };
                    this.nativeLines.set(pos.ticket, data);
                }

                // Position Line
                if (!data.posLine && !data.creatingPos) {
                    data.creatingPos = true;
                    chart.createPositionLine().then(line => {
                        data.posLine = line;
                        data.creatingPos = false;
                        this.applyPositionLineProperties(line, pos, data);
                    }).catch(err => {
                        console.error("[TradeUI] Error creating position line:", err);
                        data.creatingPos = false;
                    });
                } else if (data.posLine) {
                    this.applyPositionLineProperties(data.posLine, pos, data);
                }

                // Take Profit Line
                if (pos.tp && pos.tp > 0) {
                    if (!data.tpLine && !data.creatingTp) {
                        data.creatingTp = true;
                        chart.createOrderLine().then(line => {
                            data.tpLine = line;
                            data.creatingTp = false;
                            this.applyTpOrderProperties(line, pos, data);
                        }).catch(err => {
                            console.error("[TradeUI] Error creating TP line:", err);
                            data.creatingTp = false;
                        });
                    } else if (data.tpLine) {
                        this.applyTpOrderProperties(data.tpLine, pos, data);
                    }
                } else if (data.tpLine) {
                    try { data.tpLine.remove(); } catch (_) {}
                    data.tpLine = null;
                    data.tpConfigured = false;
                    data.lastTp = null;
                }

                // Stop Loss Line
                if (pos.sl && pos.sl > 0) {
                    if (!data.slLine && !data.creatingSl) {
                        data.creatingSl = true;
                        chart.createOrderLine().then(line => {
                            data.slLine = line;
                            data.creatingSl = false;
                            this.applySlOrderProperties(line, pos, data);
                        }).catch(err => {
                            console.error("[TradeUI] Error creating SL line:", err);
                            data.creatingSl = false;
                        });
                    } else if (data.slLine) {
                        this.applySlOrderProperties(data.slLine, pos, data);
                    }
                } else if (data.slLine) {
                    try { data.slLine.remove(); } catch (_) {}
                    data.slLine = null;
                    data.slConfigured = false;
                    data.lastSl = null;
                }
            }
        }

        applyPositionLineProperties(posLine, pos, data) {
            if (!posLine) return;
            const isBuy = pos.type === 'BUY';
            const pnl = pos.profit || 0.0;
            const pnlFormatted = `${pnl >= 0 ? '+' : ''}$${Number(pnl).toFixed(2)}`;
            const bodyText = `${pos.type} ${pnlFormatted}`;

            if (!data.posConfigured) {
                data.posConfigured = true;
                posLine
                    .setDirection(isBuy ? 'buy' : 'sell')
                    .setLineColor(isBuy ? '#2962ff' : '#f23645')
                    .setLineStyle(2) // Dotted
                    .setLineWidth(1)
                    .setExtendLeft(true)
                    .setCloseTooltip("Close Position")
                    .setProtectTooltip("Protect / Modify Position")
                    .onClose(() => {
                        if (window.TradingEngine) {
                            window.TradingEngine.closePosition({ ticket: pos.ticket });
                        }
                    })
                    .onModify(() => {
                        this.openProtectionModal(pos);
                    });
            }

            if (data.lastPrice !== pos.open_price) {
                data.lastPrice = pos.open_price;
                posLine.setPrice(Number(pos.open_price));
            }
            if (data.lastLots !== pos.lots) {
                data.lastLots = pos.lots;
                posLine.setQuantity(String(pos.lots));
            }
            if (data.lastPnl !== bodyText) {
                data.lastPnl = bodyText;
                posLine.setText(bodyText);
                posLine.setProfitState(pnl >= 0 ? 'positive' : 'negative');
            }
        }

        applyTpOrderProperties(tpLine, pos, data) {
            if (!tpLine) return;
            const isBuy = pos.type === 'BUY';
            const tpPrice = Number(pos.tp);
            const tpDiff = isBuy ? (tpPrice - pos.open_price) : (pos.open_price - tpPrice);
            const tpProfit = (tpDiff * pos.lots * 100).toFixed(2);
            const tpText = `TP +$${tpProfit}`;

            if (!data.tpConfigured) {
                data.tpConfigured = true;
                tpLine
                    .setDirection(isBuy ? 'sell' : 'buy')
                    .setLineColor("#089981")
                    .setLineStyle(1) // Dashed
                    .setLineWidth(1)
                    .setExtendLeft(true)
                    .setCancelTooltip("Cancel Take Profit")
                    .setModifyTooltip("Drag to adjust Take Profit")
                    .setCancellable(true)
                    .setEditable(true)
                    .onMove(function() {
                        const newPrice = tpLine.getPrice();
                        if (newPrice && newPrice > 0 && window.TradingEngine) {
                            window.TradingEngine.modifyPosition({ ticket: pos.ticket, tp: Number(newPrice.toFixed(2)) });
                        }
                    })
                    .onCancel(function() {
                        if (window.TradingEngine) {
                            window.TradingEngine.modifyPosition({ ticket: pos.ticket, tp: 0 });
                        }
                    });
            }

            if (data.lastTp !== tpPrice) {
                data.lastTp = tpPrice;
                tpLine.setPrice(tpPrice);
                tpLine.setText(tpText);
            }
            if (data.lastTpLots !== pos.lots) {
                data.lastTpLots = pos.lots;
                tpLine.setQuantity(String(pos.lots));
            }
        }

        applySlOrderProperties(slLine, pos, data) {
            if (!slLine) return;
            const isBuy = pos.type === 'BUY';
            const slPrice = Number(pos.sl);
            const slDiff = isBuy ? (pos.open_price - slPrice) : (slPrice - pos.open_price);
            const slLoss = (slDiff * pos.lots * 100).toFixed(2);
            const slText = `SL -$${slLoss}`;

            if (!data.slConfigured) {
                data.slConfigured = true;
                slLine
                    .setDirection(isBuy ? 'sell' : 'buy')
                    .setLineColor("#f23645")
                    .setLineStyle(1) // Dashed
                    .setLineWidth(1)
                    .setExtendLeft(true)
                    .setCancelTooltip("Cancel Stop Loss")
                    .setModifyTooltip("Drag to adjust Stop Loss")
                    .setCancellable(true)
                    .setEditable(true)
                    .onMove(function() {
                        const newPrice = slLine.getPrice();
                        if (newPrice && newPrice > 0 && window.TradingEngine) {
                            window.TradingEngine.modifyPosition({ ticket: pos.ticket, sl: Number(newPrice.toFixed(2)) });
                        }
                    })
                    .onCancel(function() {
                        if (window.TradingEngine) {
                            window.TradingEngine.modifyPosition({ ticket: pos.ticket, sl: 0 });
                        }
                    });
            }

            if (data.lastSl !== slPrice) {
                data.lastSl = slPrice;
                slLine.setPrice(slPrice);
                slLine.setText(slText);
            }
            if (data.lastSlLots !== pos.lots) {
                data.lastSlLots = pos.lots;
                slLine.setQuantity(String(pos.lots));
            }
        }

        clearAllNativeChartLines() {
            for (const [ticket, data] of this.nativeLines.entries()) {
                try { if (data.posLine) data.posLine.remove(); } catch (_) {}
                try { if (data.tpLine) data.tpLine.remove(); } catch (_) {}
                try { if (data.slLine) data.slLine.remove(); } catch (_) {}
            }
            this.nativeLines.clear();
        }

        openProtectionModal(pos) {
            let modal = document.getElementById(this.settingsModalId);
            if (!modal) {
                modal = document.createElement('div');
                modal.id = this.settingsModalId;
                document.body.appendChild(modal);
            }

            const theme = this.getTheme();
            modal.style.cssText = `
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.45);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 100000;
                font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif;
            `;

            modal.innerHTML = `
                <div style="
                    background: ${theme.panelBg};
                    border: 1px solid ${theme.border};
                    border-radius: 10px;
                    width: 320px;
                    box-shadow: 0 12px 32px rgba(0,0,0,0.3);
                    overflow: hidden;
                ">
                    <div style="padding: 12px 16px; border-bottom: 1px solid ${theme.border}; display: flex; justify-content: space-between; align-items: center;">
                        <strong style="color: ${theme.text}; font-size: 13.5px;">Modify Position Protection</strong>
                        <button id="tv-prot-close" style="background: transparent; border: none; font-size: 14px; color: ${theme.textMuted}; cursor: pointer;">✕</button>
                    </div>
                    <div style="padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; font-size: 12px;">
                        <div style="display: flex; justify-content: space-between;">
                            <span style="color: ${theme.textMuted};">Ticket #${pos.ticket}</span>
                            <strong style="color: ${pos.type === 'BUY' ? '#2962ff' : '#f23645'};">${pos.type} ${pos.lots} ${pos.symbol}</strong>
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 4px; color: ${theme.textMuted}; font-weight: 600;">Take Profit Price</label>
                            <input type="number" id="tv-prot-tp-in" step="any" value="${pos.tp || ''}" placeholder="0.00 (No TP)" style="width: 100%; border: 1px solid ${theme.border}; border-radius: 4px; padding: 6px 8px; font-size: 12px; outline: none; background: ${theme.inputBg}; color: ${theme.text};">
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 4px; color: ${theme.textMuted}; font-weight: 600;">Stop Loss Price</label>
                            <input type="number" id="tv-prot-sl-in" step="any" value="${pos.sl || ''}" placeholder="0.00 (No SL)" style="width: 100%; border: 1px solid ${theme.border}; border-radius: 4px; padding: 6px 8px; font-size: 12px; outline: none; background: ${theme.inputBg}; color: ${theme.text};">
                        </div>
                        <div style="display: flex; gap: 8px; margin-top: 6px;">
                            <button type="button" id="tv-prot-cancel" style="flex: 1; padding: 7px; background: transparent; border: 1px solid ${theme.border}; border-radius: 4px; color: ${theme.text}; font-weight: 600; cursor: pointer;">Cancel</button>
                            <button type="button" id="tv-prot-save" style="flex: 1; padding: 7px; background: #2962ff; border: none; border-radius: 4px; color: #fff; font-weight: 700; cursor: pointer;">Save Protection</button>
                        </div>
                    </div>
                </div>
            `;

            const close = () => { modal.style.display = 'none'; };
            modal.querySelector('#tv-prot-close').onclick = close;
            modal.querySelector('#tv-prot-cancel').onclick = close;
            modal.querySelector('#tv-prot-save').onclick = () => {
                const newTp = parseFloat(modal.querySelector('#tv-prot-tp-in').value) || 0;
                const newSl = parseFloat(modal.querySelector('#tv-prot-sl-in').value) || 0;
                if (window.TradingEngine) {
                    window.TradingEngine.modifyPosition({ ticket: pos.ticket, tp: newTp, sl: newSl });
                    this.logActivity('Position Modified', `Ticket #${pos.ticket} TP: ${newTp || 'None'}, SL: ${newSl || 'None'}`);
                }
                close();
            };
        }

        // ==========================================
        // 5. PURE RIGHT-SIDE ORDER TICKET (100% Match to Image 2)
        // ==========================================
        renderSideOrderTicket() {
            let panel = document.getElementById(this.sideTicketId);
            if (!panel) {
                panel = document.createElement('div');
                panel.id = this.sideTicketId;
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
                    display: ${this.isOrderTicketOpen ? 'flex' : 'none'};
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
                    max-height: 92vh;
                    background: ${theme.panelBg};
                    color: ${theme.text};
                    border: 1px solid ${theme.border};
                    border-radius: 12px;
                    display: ${this.isOrderTicketOpen ? 'flex' : 'none'};
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

            const isBuy = this.selectedSide === 'BUY';
            const spreadPoints = this.getSpreadFormatted();
            const bidFormatted = this.formatPrice(this.currentBid);
            const askFormatted = this.formatPrice(this.currentAsk);

            const displaySymbol = this.currentSymbol;

            panel.innerHTML = `
                <!-- 1. Header Bar (TV Logo, Symbol, DOM grid icon, ···, ✕) -->
                <div id="tv-ticket-drag-header" style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px 16px 8px;
                    border-bottom: none;
                    cursor: ${isDocked ? 'default' : 'move'};
                ">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <div style="
                            width: 22px;
                            height: 22px;
                            border-radius: 4px;
                            background: #131722;
                            color: #ffffff;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 11px;
                            font-weight: 900;
                            letter-spacing: -0.5px;
                        ">TV</div>
                        <span id="tv-ticket-symbol-disp" style="font-size: 15px; font-weight: 700; color: ${theme.text};">${displaySymbol}</span>
                    </div>

                    <div style="display: flex; align-items: center; gap: 4px;">
                        <button id="tv-ticket-btn-dom-header" type="button" title="Depth of Market" style="background: transparent; border: none; color: ${theme.textMuted}; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center;">
                            <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6">
                                <rect x="2" y="2" width="6" height="6" rx="1"/><rect x="10" y="2" width="6" height="6" rx="1"/>
                                <rect x="2" y="10" width="6" height="6" rx="1"/><path d="M13 10v6m-3-3h6"/>
                            </svg>
                        </button>
                        <button id="tv-ticket-btn-dock" type="button" title="${isDocked ? 'Undock to Floating' : 'Dock to Right'}" style="background: transparent; border: none; color: ${theme.textMuted}; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center;">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/>
                            </svg>
                        </button>
                        <button id="tv-ticket-btn-close" type="button" title="Close Ticket" style="background: transparent; border: none; color: ${theme.textMuted}; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 6L6 18M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- 2. Segmented Pill Switch: Order | DOM -->
                <div style="padding: 0 16px 8px;">
                    <div style="
                        display: flex;
                        background: ${theme.subtabBg};
                        border-radius: 6px;
                        padding: 3px;
                        gap: 2px;
                    ">
                        <button id="tv-ticket-tab-order" type="button" style="
                            flex: 1;
                            padding: 6px 0;
                            border: none;
                            border-radius: 4px;
                            background: ${this.ticketTab === 'order' ? '#ffffff' : 'transparent'};
                            color: ${this.ticketTab === 'order' ? '#131722' : '#787b86'};
                            font-size: 12.5px;
                            font-weight: 600;
                            cursor: pointer;
                            box-shadow: ${this.ticketTab === 'order' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none'};
                        ">Order</button>
                        <button id="tv-ticket-tab-dom" type="button" style="
                            flex: 1;
                            padding: 6px 0;
                            border: none;
                            border-radius: 4px;
                            background: ${this.ticketTab === 'dom' ? '#ffffff' : 'transparent'};
                            color: ${this.ticketTab === 'dom' ? '#131722' : '#787b86'};
                            font-size: 12.5px;
                            font-weight: 600;
                            cursor: pointer;
                            box-shadow: ${this.ticketTab === 'dom' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none'};
                        ">DOM</button>
                    </div>
                </div>

                ${this.ticketTab === 'dom' ? this.renderDomLadder(theme) : `
                    <!-- 3. Scrollable Order Form Body -->
                    <div style="flex: 1; overflow-y: auto; padding: 4px 16px 16px; display: flex; flex-direction: column; gap: 14px;">
                        <!-- Split Sell / Buy Quote Box -->
                        <div style="
                            display: grid;
                            grid-template-columns: 1fr 1fr;
                            border-radius: 8px;
                            border: 1px solid ${theme.border};
                            overflow: hidden;
                            position: relative;
                            background: #ffffff;
                        ">
                            <!-- SELL BOX -->
                            <div id="tv-ticket-split-sell" style="
                                padding: 10px 12px;
                                background: ${!isBuy ? theme.sellActiveBg : '#ffffff'};
                                border-right: 1px solid ${theme.border};
                                cursor: pointer;
                                display: flex;
                                flex-direction: column;
                                transition: background 0.15s;
                            ">
                                <span style="color: ${!isBuy ? theme.sellColor : theme.textMuted}; font-size: 11.5px; font-weight: 600;">Sell</span>
                                <span id="tv-ticket-bid-val" style="color: ${!isBuy ? theme.sellColor : theme.text}; font-size: 15.5px; font-weight: 700; margin-top: 3px;">${this.formatPipPriceHtml(this.currentBid)}</span>
                            </div>

                            <!-- CENTER SPREAD BADGE PILL -->
                            <div style="
                                position: absolute;
                                left: 50%;
                                top: 50%;
                                transform: translate(-50%, -50%);
                                background: #ffffff;
                                border: 1px solid ${theme.border};
                                border-radius: 4px;
                                padding: 2px 7px;
                                font-size: 11px;
                                font-weight: 600;
                                color: #131722;
                                box-shadow: 0 1px 3px rgba(0,0,0,0.06);
                                pointer-events: none;
                            ">
                                <span id="tv-ticket-spread-badge">${spreadPoints}</span>
                            </div>

                            <!-- BUY BOX -->
                            <div id="tv-ticket-split-buy" style="
                                padding: 10px 12px;
                                background: ${isBuy ? theme.buyActiveBg : '#ffffff'};
                                text-align: right;
                                cursor: pointer;
                                display: flex;
                                flex-direction: column;
                                transition: background 0.15s;
                            ">
                                <span style="color: ${theme.buyColor}; font-size: 11.5px; font-weight: 600;">Buy</span>
                                <span id="tv-ticket-ask-val" style="color: ${theme.buyColor}; font-size: 15.5px; font-weight: 700; margin-top: 3px;">${this.formatPipPriceHtml(this.currentAsk)}</span>
                            </div>
                        </div>

                        <!-- Order Type Tabs: Market | Limit | Stop with Solid Underline -->
                        <div style="display: flex; border-bottom: 1px solid ${theme.border}; position: relative;">
                            <button type="button" class="tv-order-type-btn" data-type="market" style="
                                flex: 1;
                                padding: 8px 0;
                                border: none;
                                background: transparent;
                                color: ${this.orderType === 'market' ? '#131722' : '#787b86'};
                                font-weight: 700;
                                font-size: 12.5px;
                                cursor: pointer;
                                position: relative;
                            ">
                                Market
                                ${this.orderType === 'market' ? `<div style="position: absolute; bottom: -1px; left: 0; right: 0; height: 2px; background: #131722;"></div>` : ''}
                            </button>
                            <button type="button" class="tv-order-type-btn" data-type="limit" style="
                                flex: 1;
                                padding: 8px 0;
                                border: none;
                                background: transparent;
                                color: ${this.orderType === 'limit' ? '#131722' : '#787b86'};
                                font-weight: 700;
                                font-size: 12.5px;
                                cursor: pointer;
                                position: relative;
                            ">
                                Limit
                                ${this.orderType === 'limit' ? `<div style="position: absolute; bottom: -1px; left: 0; right: 0; height: 2px; background: #131722;"></div>` : ''}
                            </button>
                            <button type="button" class="tv-order-type-btn" data-type="stop" style="
                                flex: 1;
                                padding: 8px 0;
                                border: none;
                                background: transparent;
                                color: ${this.orderType === 'stop' ? '#131722' : '#787b86'};
                                font-weight: 700;
                                font-size: 12.5px;
                                cursor: pointer;
                                position: relative;
                            ">
                                Stop
                                ${this.orderType === 'stop' ? `<div style="position: absolute; bottom: -1px; left: 0; right: 0; height: 2px; background: #131722;"></div>` : ''}
                            </button>
                        </div>

                        <!-- Price Input (Shown for Limit & Stop) -->
                        ${this.orderType !== 'market' ? `
                            <div>
                                <label style="display: block; font-size: 12px; color: ${theme.textMuted}; margin-bottom: 5px;">Price</label>
                                <div style="
                                    display: flex;
                                    align-items: center;
                                    border: 2px solid #2962ff;
                                    border-radius: 6px;
                                    padding: 6px 12px;
                                    background: #ffffff;
                                ">
                                    <input type="number" id="tv-ticket-price-in" step="any" value="${this.limitPrice || (isBuy ? askFormatted : bidFormatted)}" style="
                                        width: 110px;
                                        border: none;
                                        outline: none;
                                        font-size: 14px;
                                        font-weight: 700;
                                        color: #131722;
                                        background: transparent;
                                    ">
                                    <span style="color: ${theme.textMuted}; margin: 0 8px; cursor: pointer;">⇄</span>
                                    <span style="margin-left: auto; font-size: 12px; color: ${theme.textMuted};">Ask + 290</span>
                                </div>
                            </div>
                        ` : ''}

                        <!-- Units Input Box (Quantity & Currency Conversion) -->
                        <div>
                            <div style="display: flex; justify-content: space-between; font-size: 12px; color: ${theme.textMuted}; margin-bottom: 5px;">
                                <span>Units ⌵</span>
                            </div>
                            <div style="
                                display: flex;
                                align-items: center;
                                border: 1px solid ${theme.border};
                                border-radius: 6px;
                                padding: 6px 12px;
                                background: #ffffff;
                            ">
                                <input type="number" id="tv-ticket-units-in" min="0.01" step="0.1" value="${this.lots}" style="
                                    width: 80px;
                                    border: none;
                                    outline: none;
                                    background: transparent;
                                    color: #131722;
                                    font-size: 14px;
                                    font-weight: 700;
                                ">
                                <span style="color: ${theme.textMuted}; margin: 0 8px;">⇄</span>
                                <span id="tv-ticket-usd-val" style="margin-left: auto; font-size: 12px; font-weight: 600; color: ${theme.textMuted}; cursor: pointer;">
                                    ${this.calculateTradeValueUSD()} USD ⌵
                                </span>
                            </div>
                        </div>

                        <!-- Financial Metrics Card (Trade Value, Available Margin, Tick Value) -->
                        <div style="
                            background: ${theme.cardBg};
                            border-radius: 6px;
                            padding: 10px 14px;
                            display: flex;
                            flex-direction: column;
                            gap: 8px;
                            font-size: 11.5px;
                        ">
                            <div style="display: flex; justify-content: space-between;">
                                <span style="color: ${theme.textMuted};">Trade value (50x)</span>
                                <span id="tv-val-trade-summary" style="font-weight: 700; color: ${theme.text};">${this.calculateTradeValueUSD()} USD</span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span style="color: ${theme.textMuted};">Available margin</span>
                                <span id="tv-val-avail-margin" style="font-weight: 700; color: ${theme.text};">${this.getAvailableMarginFormatted()} USD</span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span style="color: ${theme.textMuted};">Tick value</span>
                                <span style="font-weight: 700; color: ${theme.text};">0.001 USD</span>
                            </div>
                        </div>

                        <!-- Exits Section (Take Profit & Stop Loss with iOS Toggles) -->
                        <div>
                            <div id="tv-ticket-exits-toggle" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: 4px 0;">
                                <span style="font-size: 13px; font-weight: 700; color: ${theme.text};">Exits</span>
                                <span style="font-size: 11px; color: ${theme.textMuted};">${this.isExitsExpanded ? '▲' : '▼'}</span>
                            </div>

                            ${this.isExitsExpanded ? `
                                <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px;">
                                    <!-- Take Profit -->
                                    <div>
                                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                                            <span style="font-size: 12px; color: ${theme.text}; font-weight: 600;">Take profit price ⌵</span>
                                            <label class="tv-toggle-switch" style="cursor: pointer; margin: 0;">
                                                <input type="checkbox" id="tv-ticket-check-tp" ${this.isTpEnabled ? 'checked' : ''}>
                                                <span class="tv-toggle-slider"></span>
                                            </label>
                                        </div>
                                        <div style="
                                            display: flex;
                                            align-items: center;
                                            border: 1px solid ${this.isTpEnabled ? '#2962ff' : theme.border};
                                            border-radius: 6px;
                                            padding: 6px 12px;
                                            background: ${this.isTpEnabled ? '#ffffff' : '#f8f9fd'};
                                        ">
                                            <input type="text" id="tv-ticket-tp-price-disp" value="${this.calculateExitPrice('tp')}" ${!this.isTpEnabled ? 'disabled' : ''} style="
                                                border: none;
                                                outline: none;
                                                background: transparent;
                                                font-size: 13px;
                                                font-weight: 600;
                                                color: ${this.isTpEnabled ? theme.text : theme.textMuted};
                                                width: 100px;
                                            ">
                                            <span style="color: ${theme.textMuted}; margin: 0 8px;">⇄</span>
                                            <div style="margin-left: auto; display: flex; align-items: center; gap: 4px;">
                                                <input type="number" id="tv-ticket-tp-ticks-in" value="${this.tpTicks}" ${!this.isTpEnabled ? 'disabled' : ''} style="
                                                    width: 44px;
                                                    border: none;
                                                    text-align: right;
                                                    outline: none;
                                                    background: transparent;
                                                    font-size: 12px;
                                                    font-weight: 600;
                                                    color: ${this.isTpEnabled ? theme.text : theme.textMuted};
                                                ">
                                                <span style="font-size: 11.5px; color: ${theme.textMuted};">ticks ⌵</span>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Stop Loss -->
                                    <div>
                                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                                            <span style="font-size: 12px; color: ${theme.text}; font-weight: 600;">Stop loss price ⌵</span>
                                            <label class="tv-toggle-switch" style="cursor: pointer; margin: 0;">
                                                <input type="checkbox" id="tv-ticket-check-sl" ${this.isSlEnabled ? 'checked' : ''}>
                                                <span class="tv-toggle-slider"></span>
                                            </label>
                                        </div>
                                        <div style="
                                            display: flex;
                                            align-items: center;
                                            border: 1px solid ${this.isSlEnabled ? '#2962ff' : theme.border};
                                            border-radius: 6px;
                                            padding: 6px 12px;
                                            background: ${this.isSlEnabled ? '#ffffff' : '#f8f9fd'};
                                        ">
                                            <input type="text" id="tv-ticket-sl-price-disp" value="${this.calculateExitPrice('sl')}" ${!this.isSlEnabled ? 'disabled' : ''} style="
                                                border: none;
                                                outline: none;
                                                background: transparent;
                                                font-size: 13px;
                                                font-weight: 600;
                                                color: ${this.isSlEnabled ? theme.text : theme.textMuted};
                                                width: 100px;
                                            ">
                                            <span style="color: ${theme.textMuted}; margin: 0 8px;">⇄</span>
                                            <div style="margin-left: auto; display: flex; align-items: center; gap: 4px;">
                                                <input type="number" id="tv-ticket-sl-ticks-in" value="${this.slTicks}" ${!this.isSlEnabled ? 'disabled' : ''} style="
                                                    width: 44px;
                                                    border: none;
                                                    text-align: right;
                                                    outline: none;
                                                    background: transparent;
                                                    font-size: 12px;
                                                    font-weight: 600;
                                                    color: ${this.isSlEnabled ? theme.text : theme.textMuted};
                                                ">
                                                <span style="font-size: 11.5px; color: ${theme.textMuted};">ticks ⌵</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ` : ''}
                        </div>

                        <!-- Extra Settings Section -->
                        <div>
                            <div id="tv-ticket-extra-toggle" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: 4px 0;">
                                <span style="font-size: 13px; font-weight: 700; color: ${theme.text};">Extra settings</span>
                                <span style="font-size: 11px; color: ${theme.textMuted};">${this.isExtraSettingsExpanded ? '▲' : '▼'}</span>
                            </div>

                            ${this.isExtraSettingsExpanded ? `
                                <div style="margin-top: 8px;">
                                    <label style="display: block; font-size: 12px; color: ${theme.textMuted}; margin-bottom: 5px;">Time in force</label>
                                    <select id="tv-ticket-tif-select" style="
                                        width: 100%;
                                        border: 1px solid ${theme.border};
                                        border-radius: 6px;
                                        padding: 6px 10px;
                                        background: #ffffff;
                                        color: ${theme.text};
                                        font-size: 12px;
                                        font-weight: 600;
                                        outline: none;
                                        cursor: pointer;
                                    ">
                                        <option value="Day" ${this.timeInForce === 'Day' ? 'selected' : ''}>Day</option>
                                        <option value="GTC" ${this.timeInForce === 'GTC' ? 'selected' : ''}>GTC (Good 'Til Cancelled)</option>
                                        <option value="IOC" ${this.timeInForce === 'IOC' ? 'selected' : ''}>IOC (Immediate or Cancel)</option>
                                        <option value="Week" ${this.timeInForce === 'Week' ? 'selected' : ''}>Week</option>
                                    </select>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- 4. Big Action Button (Dual-line Text) -->
                    <div style="padding: 12px 16px 16px; border-top: 1px solid ${theme.border}; background: #ffffff;">
                        <button id="tv-ticket-btn-execute" type="button" style="
                            width: 100%;
                            height: 50px;
                            background: ${isBuy ? theme.buyColor : theme.sellColor};
                            color: #ffffff;
                            border: none;
                            border-radius: 8px;
                            cursor: pointer;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            box-shadow: 0 2px 6px rgba(0,0,0,0.12);
                            transition: background 0.15s, opacity 0.15s;
                        ">
                            <span style="font-size: 16px; font-weight: 700; line-height: 1.15;">${isBuy ? 'Buy' : 'Sell'}</span>
                            <span id="tv-ticket-btn-summary-text" style="font-size: 11px; opacity: 0.95; letter-spacing: 0.4px; margin-top: 2px;">
                                ${this.lots} ${displaySymbol} @ ${this.orderType === 'market' ? (isBuy ? askFormatted : bidFormatted) : (this.limitPrice || askFormatted)} ${this.orderType.toUpperCase()}
                            </span>
                        </button>
                    </div>
                `}
            `;

            this.bindSideOrderTicketEvents(panel);
        }

        renderDomLadder(theme) {
            const cleanSym = this.currentSymbol.split(':').pop().toUpperCase();
            const curPositions = (window.PaperTrading && window.TradingEngine && window.TradingEngine.getActiveBrokerKey(this.currentSymbol) === 'paper') 
                ? window.PaperTrading.getPositions() 
                : (this.positions || []);
            const positions = curPositions.filter(p => p.symbol.split(':').pop().toUpperCase() === cleanSym);
            const totalLots = positions.reduce((sum, p) => sum + (p.type === 'BUY' ? p.lots : -p.lots), 0);
            const totalProfit = positions.reduce((sum, p) => sum + (p.profit || 0), 0);
            const hasPosition = positions.length > 0 && Math.abs(totalLots) > 0.0001;

            const posText = hasPosition ? `${Math.abs(totalLots)} ${totalLots > 0 ? 'BUY' : 'SELL'}` : '—';
            const pnlText = hasPosition ? (totalProfit >= 0 ? `+${totalProfit.toFixed(2)} USD` : `${totalProfit.toFixed(2)} USD`) : '—';
            const pnlColor = totalProfit > 0 ? '#089981' : (totalProfit < 0 ? '#f23645' : theme.text);

            const step = this.currentBid > 1000 ? 0.5 : (this.currentBid > 100 ? 0.1 : (this.currentBid > 10 ? 0.05 : 0.0001));
            const offsets = [7, 6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -7];

            const rowsHtml = offsets.map((offset) => {
                const priceNum = this.currentBid + offset * step;
                const priceFormatted = this.formatPrice(priceNum);
                const isMarket = offset === 0;

                const askDepth = offset >= 0 ? Math.floor(Math.sin((offset + 1) * 0.5) * 45 + 12) : 0;
                const bidDepth = offset <= 0 ? Math.floor(Math.sin((Math.abs(offset) + 1) * 0.5) * 45 + 12) : 0;
                const maxDepth = 60;
                const askMeterPct = Math.min(100, Math.round((askDepth / maxDepth) * 100));
                const bidMeterPct = Math.min(100, Math.round((bidDepth / maxDepth) * 100));

                return `
                    <div class="tv-dom-row" data-price="${priceNum}" style="
                        display: grid;
                        grid-template-columns: 1fr 100px 1fr;
                        height: 25px;
                        align-items: center;
                        font-size: 11.5px;
                        font-weight: 600;
                        border-bottom: 1px solid ${theme.border};
                        background: ${isMarket ? '#e8f0fe' : '#ffffff'};
                        position: relative;
                        cursor: pointer;
                        user-select: none;
                        transition: background 0.1s;
                    ">
                        <!-- BID CELL (LEFT) -->
                        <div class="tv-dom-cell-bid" data-price="${priceNum}" title="Click to place Buy order @ ${priceFormatted}" style="
                            height: 100%;
                            display: flex;
                            align-items: center;
                            justify-content: flex-end;
                            padding-right: 10px;
                            position: relative;
                            overflow: hidden;
                        ">
                            ${bidDepth > 0 ? `
                                <div style="
                                    position: absolute;
                                    right: 0;
                                    top: 0;
                                    bottom: 0;
                                    width: ${bidMeterPct}%;
                                    background: rgba(41, 98, 255, 0.14);
                                    pointer-events: none;
                                "></div>
                                <span style="position: relative; z-index: 1; color: #2962ff; font-weight: 700;">${bidDepth}</span>
                            ` : ''}
                        </div>

                        <!-- PRICE CELL (CENTER) -->
                        <div style="
                            height: 100%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            border-left: 1px solid ${theme.border};
                            border-right: 1px solid ${theme.border};
                            background: ${isMarket ? '#d2e3fc' : '#f8f9fa'};
                            color: #131722;
                            font-weight: 700;
                            letter-spacing: -0.2px;
                        ">
                            ${priceFormatted}
                        </div>

                        <!-- ASK CELL (RIGHT) -->
                        <div class="tv-dom-cell-ask" data-price="${priceNum}" title="Click to place Sell order @ ${priceFormatted}" style="
                            height: 100%;
                            display: flex;
                            align-items: center;
                            justify-content: flex-start;
                            padding-left: 10px;
                            position: relative;
                            overflow: hidden;
                        ">
                            ${askDepth > 0 ? `
                                <div style="
                                    position: absolute;
                                    left: 0;
                                    top: 0;
                                    bottom: 0;
                                    width: ${askMeterPct}%;
                                    background: rgba(242, 54, 69, 0.14);
                                    pointer-events: none;
                                "></div>
                                <span style="position: relative; z-index: 1; color: #f23645; font-weight: 700;">${askDepth}</span>
                            ` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden; background: #ffffff;">
                    <!-- 1. Column Header -->
                    <div style="
                        display: grid;
                        grid-template-columns: 1fr 100px 1fr;
                        padding: 6px 0;
                        background: #f8f9fa;
                        border-bottom: 1px solid ${theme.border};
                        font-size: 11px;
                        font-weight: 700;
                        color: #787b86;
                        text-align: center;
                    ">
                        <div style="display: flex; align-items: center; justify-content: space-between; padding: 0 8px;">
                            <span id="tv-dom-cancel-all-buy" title="Cancel All Buy Orders" style="cursor: pointer; opacity: 0.6; font-size: 10px;">✕</span>
                            <span>Bid size</span>
                        </div>
                        <div style="border-left: 1px solid ${theme.border}; border-right: 1px solid ${theme.border};">Price</div>
                        <div style="display: flex; align-items: center; justify-content: space-between; padding: 0 8px;">
                            <span>Ask size</span>
                            <span id="tv-dom-cancel-all-sell" title="Cancel All Sell Orders" style="cursor: pointer; opacity: 0.6; font-size: 10px;">✕</span>
                        </div>
                    </div>

                    <!-- 2. Scrollable Ladder Rows -->
                    <div id="tv-dom-rows-scroll" style="flex: 1; overflow-y: auto;">
                        ${rowsHtml}
                    </div>

                    <!-- 3. Bottom Action Controls matching TV 100% -->
                    <div style="border-top: 1px solid ${theme.border}; background: #ffffff; padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 8px;">
                        <!-- Position / P&L Info Row -->
                        <div style="display: flex; gap: 8px;">
                            <button id="tv-dom-pos-badge" type="button" style="
                                flex: 1;
                                height: 26px;
                                border: 1px solid ${theme.border};
                                border-radius: 4px;
                                background: #f0f3fa;
                                color: #131722;
                                font-size: 11px;
                                font-weight: 700;
                                cursor: default;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            ">${posText}</button>
                            <button id="tv-dom-pnl-badge" type="button" style="
                                flex: 1;
                                height: 26px;
                                border: 1px solid ${theme.border};
                                border-radius: 4px;
                                background: #f0f3fa;
                                color: ${pnlColor};
                                font-size: 11px;
                                font-weight: 700;
                                cursor: default;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            ">${pnlText}</button>
                        </div>

                        <!-- Flatten / CXL All / Reverse Buttons -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">
                            <button id="tv-dom-btn-flatten" type="button" ${hasPosition ? '' : 'disabled'} style="
                                height: 28px;
                                border: 1px solid ${theme.border};
                                border-radius: 4px;
                                background: #f0f3fa;
                                color: #131722;
                                font-size: 11.5px;
                                font-weight: 600;
                                cursor: ${hasPosition ? 'pointer' : 'not-allowed'};
                                opacity: ${hasPosition ? '1' : '0.5'};
                            ">Flatten</button>
                            <button id="tv-dom-btn-cxl-all" type="button" style="
                                height: 28px;
                                border: 1px solid ${theme.border};
                                border-radius: 4px;
                                background: #f0f3fa;
                                color: #131722;
                                font-size: 11.5px;
                                font-weight: 600;
                                cursor: pointer;
                            ">CXL All</button>
                            <button id="tv-dom-btn-reverse" type="button" ${hasPosition ? '' : 'disabled'} style="
                                height: 28px;
                                border: 1px solid ${theme.border};
                                border-radius: 4px;
                                background: #f0f3fa;
                                color: #131722;
                                font-size: 11.5px;
                                font-weight: 600;
                                cursor: ${hasPosition ? 'pointer' : 'not-allowed'};
                                opacity: ${hasPosition ? '1' : '0.5'};
                            ">Reverse</button>
                        </div>

                        <!-- Buy Mkt | Units | Sell Mkt -->
                        <div style="display: grid; grid-template-columns: 1fr 70px 1fr; gap: 6px; align-items: center;">
                            <button id="tv-dom-btn-buy-mkt" type="button" style="
                                height: 34px;
                                border: none;
                                border-radius: 4px;
                                background: #2962ff;
                                color: #ffffff;
                                font-size: 12.5px;
                                font-weight: 700;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                transition: opacity 0.15s;
                            ">Buy Mkt</button>

                            <input id="tv-dom-units-in" type="number" step="any" min="0.01" value="${this.lots}" style="
                                height: 32px;
                                border: 1px solid #d1d4dc;
                                border-radius: 4px;
                                background: #ffffff;
                                color: #131722;
                                font-size: 13px;
                                font-weight: 700;
                                text-align: center;
                                outline: none;
                                width: 100%;
                                box-sizing: border-box;
                            " />

                            <button id="tv-dom-btn-sell-mkt" type="button" style="
                                height: 34px;
                                border: none;
                                border-radius: 4px;
                                background: #f23645;
                                color: #ffffff;
                                font-size: 12.5px;
                                font-weight: 700;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                transition: opacity 0.15s;
                            ">Sell Mkt</button>
                        </div>

                        <!-- Time in Force Selector -->
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; color: ${theme.textMuted}; padding-top: 2px;">
                            <span>Details</span>
                            <select id="tv-dom-tif-select" style="
                                border: 1px solid ${theme.border};
                                border-radius: 4px;
                                padding: 2px 6px;
                                font-size: 11px;
                                font-weight: 600;
                                background: #ffffff;
                                color: #131722;
                                outline: none;
                                cursor: pointer;
                            ">
                                <option value="Day" ${this.timeInForce === 'Day' ? 'selected' : ''}>Day</option>
                                <option value="GTC" ${this.timeInForce === 'GTC' ? 'selected' : ''}>GTC</option>
                                <option value="IOC" ${this.timeInForce === 'IOC' ? 'selected' : ''}>IOC</option>
                                <option value="Week" ${this.timeInForce === 'Week' ? 'selected' : ''}>Week</option>
                            </select>
                        </div>
                    </div>
                </div>
            `;
        }

        bindDomLadderEvents(panel) {
            const btnFlatten = panel.querySelector('#tv-dom-btn-flatten');
            const btnCxlAll = panel.querySelector('#tv-dom-btn-cxl-all');
            const btnReverse = panel.querySelector('#tv-dom-btn-reverse');
            const btnBuyMkt = panel.querySelector('#tv-dom-btn-buy-mkt');
            const btnSellMkt = panel.querySelector('#tv-dom-btn-sell-mkt');
            const unitsIn = panel.querySelector('#tv-dom-units-in');
            const cancelAllBuy = panel.querySelector('#tv-dom-cancel-all-buy');
            const cancelAllSell = panel.querySelector('#tv-dom-cancel-all-sell');
            const tifSelect = panel.querySelector('#tv-dom-tif-select');

            if (btnFlatten) {
                btnFlatten.onclick = async () => {
                    if (window.TradingEngine) {
                        await window.TradingEngine.flatten(this.currentSymbol);
                        this.renderSideOrderTicket();
                    }
                };
            }
            if (btnCxlAll) {
                btnCxlAll.onclick = async () => {
                    if (window.TradingEngine) {
                        await window.TradingEngine.cancelAllOrders(this.currentSymbol);
                        this.renderSideOrderTicket();
                    }
                };
            }
            if (btnReverse) {
                btnReverse.onclick = async () => {
                    if (window.TradingEngine) {
                        await window.TradingEngine.reverse(this.currentSymbol);
                        this.renderSideOrderTicket();
                    }
                };
            }
            if (btnBuyMkt) {
                btnBuyMkt.onclick = async () => {
                    const units = unitsIn ? parseFloat(unitsIn.value) || this.lots : this.lots;
                    if (window.TradingEngine) {
                        await window.TradingEngine.placeOrder({
                            symbol: this.currentSymbol,
                            side: 'BUY',
                            orderType: 'market',
                            lots: units
                        });
                        this.renderSideOrderTicket();
                    }
                };
            }
            if (btnSellMkt) {
                btnSellMkt.onclick = async () => {
                    const units = unitsIn ? parseFloat(unitsIn.value) || this.lots : this.lots;
                    if (window.TradingEngine) {
                        await window.TradingEngine.placeOrder({
                            symbol: this.currentSymbol,
                            side: 'SELL',
                            orderType: 'market',
                            lots: units
                        });
                        this.renderSideOrderTicket();
                    }
                };
            }
            if (unitsIn) {
                unitsIn.oninput = (e) => {
                    const val = Math.max(0.01, parseFloat(e.target.value) || 1.0);
                    this.setLots(val);
                };
            }
            if (cancelAllBuy) {
                cancelAllBuy.onclick = async () => {
                    if (window.TradingEngine) {
                        await window.TradingEngine.cancelAllOrders(this.currentSymbol);
                        this.renderSideOrderTicket();
                    }
                };
            }
            if (cancelAllSell) {
                cancelAllSell.onclick = async () => {
                    if (window.TradingEngine) {
                        await window.TradingEngine.cancelAllOrders(this.currentSymbol);
                        this.renderSideOrderTicket();
                    }
                };
            }
            if (tifSelect) {
                tifSelect.onchange = (e) => {
                    this.timeInForce = e.target.value;
                };
            }

            // Price Row cell clicks (Bid = Buy limit/stop, Ask = Sell limit/stop)
            panel.querySelectorAll('.tv-dom-cell-bid').forEach(cell => {
                cell.onclick = (e) => {
                    e.stopPropagation();
                    const p = parseFloat(cell.getAttribute('data-price'));
                    if (isNaN(p)) return;
                    const orderType = p < this.currentBid ? 'limit' : 'stop';
                    if (this.settings.oneClickTrading) {
                        if (window.TradingEngine) {
                            window.TradingEngine.placeOrder({
                                symbol: this.currentSymbol,
                                side: 'BUY',
                                orderType: orderType,
                                price: p,
                                lots: this.lots
                            });
                        }
                    } else {
                        this.ticketTab = 'order';
                        this.selectedSide = 'BUY';
                        this.orderType = orderType;
                        this.limitPrice = p;
                        this.renderSideOrderTicket();
                    }
                };
            });

            panel.querySelectorAll('.tv-dom-cell-ask').forEach(cell => {
                cell.onclick = (e) => {
                    e.stopPropagation();
                    const p = parseFloat(cell.getAttribute('data-price'));
                    if (isNaN(p)) return;
                    const orderType = p > this.currentAsk ? 'limit' : 'stop';
                    if (this.settings.oneClickTrading) {
                        if (window.TradingEngine) {
                            window.TradingEngine.placeOrder({
                                symbol: this.currentSymbol,
                                side: 'SELL',
                                orderType: orderType,
                                price: p,
                                lots: this.lots
                            });
                        }
                    } else {
                        this.ticketTab = 'order';
                        this.selectedSide = 'SELL';
                        this.orderType = orderType;
                        this.limitPrice = p;
                        this.renderSideOrderTicket();
                    }
                };
            });
        }

        bindSideOrderTicketEvents(panel) {
            const btnClose = panel.querySelector('#tv-ticket-btn-close');
            const btnDock = panel.querySelector('#tv-ticket-btn-dock');
            const tabOrder = panel.querySelector('#tv-ticket-tab-order');
            const tabDom = panel.querySelector('#tv-ticket-tab-dom');
            const splitSell = panel.querySelector('#tv-ticket-split-sell');
            const splitBuy = panel.querySelector('#tv-ticket-split-buy');

            if (btnClose) btnClose.onclick = () => this.closeOrderTicket();
            if (btnDock) {
                btnDock.onclick = () => {
                    this.dockMode = this.dockMode === 'docked' ? 'floating' : 'docked';
                    this.saveSettings();
                    this.renderSideOrderTicket();
                };
            }

            if (tabOrder) {
                tabOrder.onclick = () => {
                    this.ticketTab = 'order';
                    this.renderSideOrderTicket();
                };
            }
            if (tabDom) {
                tabDom.onclick = () => {
                    this.ticketTab = 'dom';
                    this.renderSideOrderTicket();
                };
            }

            if (this.ticketTab === 'dom') {
                this.bindDomLadderEvents(panel);
                return;
            }

            if (splitSell) {
                splitSell.onclick = () => {
                    this.selectedSide = 'SELL';
                    this.renderSideOrderTicket();
                };
            }
            if (splitBuy) {
                splitBuy.onclick = () => {
                    this.selectedSide = 'BUY';
                    this.renderSideOrderTicket();
                };
            }

            // Order type tabs
            panel.querySelectorAll('.tv-order-type-btn').forEach(btn => {
                btn.onclick = (e) => {
                    this.orderType = e.currentTarget.getAttribute('data-type');
                    this.renderSideOrderTicket();
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
                    this.updateTicketButtonSummary();
                };
            }

            // Price input
            const priceIn = panel.querySelector('#tv-ticket-price-in');
            if (priceIn) {
                priceIn.oninput = (e) => {
                    this.limitPrice = parseFloat(e.target.value) || 0;
                    this.updateTicketButtonSummary();
                };
            }

            // Exits accordion toggle
            const exitsToggle = panel.querySelector('#tv-ticket-exits-toggle');
            if (exitsToggle) {
                exitsToggle.onclick = () => {
                    this.isExitsExpanded = !this.isExitsExpanded;
                    this.renderSideOrderTicket();
                };
            }

            // Extra settings toggle
            const extraToggle = panel.querySelector('#tv-ticket-extra-toggle');
            if (extraToggle) {
                extraToggle.onclick = () => {
                    this.isExtraSettingsExpanded = !this.isExtraSettingsExpanded;
                    this.renderSideOrderTicket();
                };
            }

            // Time in force select
            const tifSelect = panel.querySelector('#tv-ticket-tif-select');
            if (tifSelect) {
                tifSelect.onchange = (e) => {
                    this.timeInForce = e.target.value;
                };
            }

            // TP & SL checkboxes
            const checkTp = panel.querySelector('#tv-ticket-check-tp');
            const checkSl = panel.querySelector('#tv-ticket-check-sl');
            if (checkTp) {
                checkTp.onchange = (e) => {
                    this.isTpEnabled = e.target.checked;
                    this.renderSideOrderTicket();
                };
            }
            if (checkSl) {
                checkSl.onchange = (e) => {
                    this.isSlEnabled = e.target.checked;
                    this.renderSideOrderTicket();
                };
            }

            // TP & SL ticks
            const tpTicksIn = panel.querySelector('#tv-ticket-tp-ticks-in');
            const slTicksIn = panel.querySelector('#tv-ticket-sl-ticks-in');
            if (tpTicksIn) {
                tpTicksIn.oninput = (e) => {
                    this.tpTicks = parseFloat(e.target.value) || 75;
                    const disp = panel.querySelector('#tv-ticket-tp-price-disp');
                    if (disp) disp.value = this.calculateExitPrice('tp');
                };
            }
            if (slTicksIn) {
                slTicksIn.oninput = (e) => {
                    this.slTicks = parseFloat(e.target.value) || 25;
                    const disp = panel.querySelector('#tv-ticket-sl-price-disp');
                    if (disp) disp.value = this.calculateExitPrice('sl');
                };
            }

            // Execute button
            const btnExecute = panel.querySelector('#tv-ticket-btn-execute');
            if (btnExecute) {
                btnExecute.onclick = () => this.executeTicketOrder();
            }

            // Floating drag handler
            if (this.dockMode === 'floating') {
                const header = panel.querySelector('#tv-ticket-drag-header');
                this.makeDraggable(panel, header, (top, left) => {
                    this.floatingPos = { top: top + 'px', left: left + 'px', right: 'auto' };
                });
            }
        }

        updateTicketButtonSummary() {
            const btnSummary = document.querySelector('#tv-ticket-btn-summary-text');
            if (!btnSummary) return;
            const refPrice = this.orderType === 'market' 
                ? (this.selectedSide === 'BUY' ? this.formatPrice(this.currentAsk) : this.formatPrice(this.currentBid))
                : (this.limitPrice || this.formatPrice(this.currentAsk));
            btnSummary.innerText = `${this.lots} ${this.currentSymbol} @ ${refPrice} ${this.orderType.toUpperCase()}`;
        }

        openOrderTicket(side = 'BUY') {
            this.selectedSide = side;
            this.isOrderTicketOpen = true;
            this.isPanelOpen = true;
            this.renderSideOrderTicket();
            this.updateChartContainerLayout();
            this.updateToolbarBtnState();
        }

        closeOrderTicket() {
            this.isOrderTicketOpen = false;
            this.isPanelOpen = false;
            const panel = document.getElementById(this.sideTicketId);
            if (panel) panel.style.display = 'none';
            this.updateChartContainerLayout();
            this.updateToolbarBtnState();
        }

        // ==========================================
        // 6. DEDICATED BOTTOM TRADING ACTIVITY PANEL (100% Match to Images 3, 4, 5)
        // ==========================================
        renderBottomTradingPanel() {
            let panel = document.getElementById(this.bottomPanelId);
            if (!panel) {
                panel = document.createElement('div');
                panel.id = this.bottomPanelId;
                document.body.appendChild(panel);
            }

            const theme = this.getTheme();
            const isDockedRight = this.isOrderTicketOpen && this.dockMode === 'docked' && this.dockSide === 'right';
            const isDockedLeft = this.isOrderTicketOpen && this.dockMode === 'docked' && this.dockSide === 'left';
            const panelHeight = this.isBottomPanelFullscreen ? window.innerHeight : (this.bottomPanelHeight || 270);

            panel.style.cssText = `
                position: fixed;
                left: ${isDockedLeft ? '340px' : '0'};
                right: ${isDockedRight ? '340px' : '0'};
                bottom: 0;
                height: ${panelHeight}px;
                background: ${theme.panelBg};
                color: ${theme.text};
                border-top: 1px solid ${theme.border};
                display: ${this.isBottomPanelOpen ? 'flex' : 'none'};
                flex-direction: column;
                z-index: 9998;
                font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif;
                user-select: none;
                box-shadow: 0 -2px 10px rgba(0,0,0,0.05);
            `;

            this.updateChartContainerLayout();

            const activeBrokerKey = window.TradingEngine ? window.TradingEngine.getActiveBrokerKey(this.currentSymbol) : 'paper';
            const activeBrokerName = window.TradingEngine ? window.TradingEngine.getActiveAdapter(this.currentSymbol).name : 'Paper Trading';
            const acc = (window.TradingEngine && window.TradingEngine.getAccountSummary()) || {
                balance: 100000.00,
                equity: 100000.00,
                floatingPnl: 0.0,
                usedMargin: 0.0,
                freeMargin: 100000.00,
                currency: 'USD'
            };

            const curPositions = (window.PaperTrading && activeBrokerKey === 'paper') ? window.PaperTrading.getPositions() : (this.positions || []);
            const curOrders = (window.PaperTrading && activeBrokerKey === 'paper') ? window.PaperTrading.getOrders() : [];
            const history = (window.PaperTrading && activeBrokerKey === 'paper') ? window.PaperTrading.getHistory() : [];

            // Calculate live KPIs
            const unrealizedPnl = curPositions.reduce((accPnl, p) => accPnl + (p.profit || 0), 0);
            const realizedPnl = history.reduce((accPnl, h) => accPnl + (h.profit || 0), 0);
            const unrealizedPnlFormatted = `${unrealizedPnl >= 0 ? '+' : ''}${acc.currency === 'INR' ? '₹' : ''}${unrealizedPnl.toFixed(2)}`;
            const realizedPnlFormatted = `${realizedPnl >= 0 ? '+' : ''}${acc.currency === 'INR' ? '₹' : ''}${realizedPnl.toFixed(2)}`;

            const marginBuffer = acc.equity > 0 ? `${Math.max(0, ((acc.equity - acc.usedMargin) / acc.equity) * 100).toFixed(2)}%` : '99.92%';

            panel.innerHTML = `
                <!-- Top Drag Resizer Handle -->
                <div id="tv-bottom-drag-handle" style="
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    height: 5px;
                    cursor: ns-resize;
                    z-index: 10;
                "></div>

                <!-- 1. Top Header Bar (Broker Select, Account Pill, 8 KPI Summary, Window Controls) -->
                <div style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 16px;
                    border-bottom: 1px solid ${theme.border};
                    background: ${theme.panelBg};
                    min-height: 44px;
                    box-sizing: border-box;
                ">
                    <!-- Left: Broker Dropdown & Account Pill -->
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <div style="
                            display: flex;
                            align-items: center;
                            gap: 6px;
                            border: 1px solid ${theme.border};
                            border-radius: 4px;
                            padding: 3px 8px;
                            background: #ffffff;
                        ">
                            <div style="
                                width: 14px;
                                height: 14px;
                                border-radius: 2px;
                                background: #131722;
                                color: #ffffff;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                font-size: 8px;
                                font-weight: 900;
                            ">TV</div>
                            <select id="tv-bottom-broker-select" style="
                                border: none;
                                outline: none;
                                background: transparent;
                                font-size: 11.5px;
                                font-weight: 600;
                                color: #131722;
                                cursor: pointer;
                            ">
                                <option value="paper" ${activeBrokerKey === 'paper' ? 'selected' : ''}>Paper Trading ⌵</option>
                                <option value="mt5" ${activeBrokerKey === 'mt5' ? 'selected' : ''}>MetaTrader 5 ⌵</option>
                                <option value="fyers" ${activeBrokerKey === 'fyers' ? 'selected' : ''}>Fyers Broker ⌵</option>
                            </select>
                        </div>

                        <!-- Account Pill (FusionPhantom USD) -->
                        <div style="
                            padding: 3px 8px;
                            border: 1px solid ${theme.border};
                            border-radius: 4px;
                            font-size: 11.5px;
                            font-weight: 600;
                            color: ${theme.text};
                            background: #ffffff;
                        ">
                            FusionPhantom usd ⌵
                        </div>
                    </div>

                    <!-- Center: Account Summary KPIs (Exact 8 Metrics from Images 3, 4, 5) -->
                    <div style="display: flex; align-items: center; gap: 22px;">
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 10.5px; color: ${theme.textMuted}; line-height: 1.1;">Account balance</span>
                            <span style="font-size: 12px; font-weight: 700; color: ${theme.text}; line-height: 1.2;">${Number(acc.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                        </div>
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 10.5px; color: ${theme.textMuted}; line-height: 1.1;">Equity</span>
                            <span style="font-size: 12px; font-weight: 700; color: ${theme.text}; line-height: 1.2;">${Number(acc.equity || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                        </div>
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 10.5px; color: ${theme.textMuted}; line-height: 1.1;">Realized PnL</span>
                            <span style="font-size: 12px; font-weight: 700; color: ${realizedPnl >= 0 ? '#089981' : '#f23645'}; line-height: 1.2;">${realizedPnlFormatted}</span>
                        </div>
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 10.5px; color: ${theme.textMuted}; line-height: 1.1;">Unrealized PnL</span>
                            <span style="font-size: 12px; font-weight: 700; color: ${unrealizedPnl >= 0 ? '#089981' : '#f23645'}; line-height: 1.2;">${unrealizedPnlFormatted}</span>
                        </div>
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 10.5px; color: ${theme.textMuted}; line-height: 1.1;">Account margin</span>
                            <span style="font-size: 12px; font-weight: 700; color: ${theme.text}; line-height: 1.2;">${Number(acc.usedMargin || 0).toFixed(2)}</span>
                        </div>
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 10.5px; color: ${theme.textMuted}; line-height: 1.1;">Available funds</span>
                            <span style="font-size: 12px; font-weight: 700; color: ${theme.text}; line-height: 1.2;">${Number(acc.freeMargin || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                        </div>
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 10.5px; color: ${theme.textMuted}; line-height: 1.1;">Orders margin</span>
                            <span style="font-size: 12px; font-weight: 700; color: ${theme.text}; line-height: 1.2;">0.00</span>
                        </div>
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 10.5px; color: ${theme.textMuted}; line-height: 1.1;">Margin buffer</span>
                            <span style="font-size: 12px; font-weight: 700; color: ${theme.text}; line-height: 1.2;">${marginBuffer}</span>
                        </div>
                    </div>

                    <!-- Right: Window Controls (Minimize, Maximize, Close) -->
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <button id="tv-bottom-btn-min" type="button" title="Minimize to Toolbar" style="background: transparent; border: none; color: ${theme.textMuted}; cursor: pointer; padding: 4px; border-radius: 4px;">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>
                        </button>
                        <button id="tv-bottom-btn-max" type="button" title="${this.isBottomPanelFullscreen ? 'Restore Height' : 'Maximize'}" style="background: transparent; border: none; color: ${theme.textMuted}; cursor: pointer; padding: 4px; border-radius: 4px;">
                            ${this.isBottomPanelFullscreen ? `
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                            ` : `
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6m0-6L10 14M9 21H3v-6m0 6l11-11"/></svg>
                            `}
                        </button>
                        <button id="tv-bottom-btn-close" type="button" title="Close Panel" style="background: transparent; border: none; color: ${theme.textMuted}; cursor: pointer; padding: 4px; border-radius: 4px;">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                    </div>
                </div>

                <!-- 2. Navigation Pills Row (Positions, Orders, History, Balance, Activity, Trades, Analytics + Export Tray) -->
                <div style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 16px;
                    border-bottom: 1px solid ${theme.border};
                    background: ${theme.panelBg};
                ">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button class="tv-bottom-tab-btn" data-tab="positions" style="
                            padding: 4px 12px;
                            border: none;
                            border-radius: 14px;
                            background: ${this.bottomActiveTab === 'positions' ? '#131722' : theme.pillBg};
                            color: ${this.bottomActiveTab === 'positions' ? '#ffffff' : '#131722'};
                            font-size: 11.5px;
                            font-weight: 600;
                            cursor: pointer;
                        ">Positions ${curPositions.length > 0 ? curPositions.length : ''}</button>

                        <button class="tv-bottom-tab-btn" data-tab="orders" style="
                            padding: 4px 12px;
                            border: none;
                            border-radius: 14px;
                            background: ${this.bottomActiveTab === 'orders' ? '#131722' : theme.pillBg};
                            color: ${this.bottomActiveTab === 'orders' ? '#ffffff' : '#131722'};
                            font-size: 11.5px;
                            font-weight: 600;
                            cursor: pointer;
                        ">Orders ${curOrders.length > 0 ? curOrders.length : ''}</button>

                        <button class="tv-bottom-tab-btn" data-tab="history" style="
                            padding: 4px 12px;
                            border: none;
                            border-radius: 14px;
                            background: ${this.bottomActiveTab === 'history' ? '#131722' : theme.pillBg};
                            color: ${this.bottomActiveTab === 'history' ? '#ffffff' : '#131722'};
                            font-size: 11.5px;
                            font-weight: 600;
                            cursor: pointer;
                        ">Order history</button>

                        <button class="tv-bottom-tab-btn" data-tab="balance" style="
                            padding: 4px 12px;
                            border: none;
                            border-radius: 14px;
                            background: ${this.bottomActiveTab === 'balance' ? '#131722' : theme.pillBg};
                            color: ${this.bottomActiveTab === 'balance' ? '#ffffff' : '#131722'};
                            font-size: 11.5px;
                            font-weight: 600;
                            cursor: pointer;
                        ">Balance history</button>

                        <button class="tv-bottom-tab-btn" data-tab="activity" style="
                            padding: 4px 12px;
                            border: none;
                            border-radius: 14px;
                            background: ${this.bottomActiveTab === 'activity' ? '#131722' : theme.pillBg};
                            color: ${this.bottomActiveTab === 'activity' ? '#ffffff' : '#131722'};
                            font-size: 11.5px;
                            font-weight: 600;
                            cursor: pointer;
                        ">Activity log</button>

                        <button class="tv-bottom-tab-btn" data-tab="trades" style="
                            padding: 4px 12px;
                            border: none;
                            border-radius: 14px;
                            background: ${this.bottomActiveTab === 'trades' ? '#131722' : theme.pillBg};
                            color: ${this.bottomActiveTab === 'trades' ? '#ffffff' : '#131722'};
                            font-size: 11.5px;
                            font-weight: 600;
                            cursor: pointer;
                        ">Trade history</button>

                        <button class="tv-bottom-tab-btn" data-tab="analytics" style="
                            padding: 4px 12px;
                            border: none;
                            border-radius: 14px;
                            background: ${this.bottomActiveTab === 'analytics' ? '#131722' : theme.pillBg};
                            color: ${this.bottomActiveTab === 'analytics' ? '#ffffff' : '#131722'};
                            font-size: 11.5px;
                            font-weight: 600;
                            cursor: pointer;
                        ">Analytics</button>
                    </div>

                    <!-- Right: Export Tray Icon -->
                    <button id="tv-bottom-btn-export" type="button" title="Export CSV" style="
                        background: transparent;
                        border: none;
                        color: ${theme.textMuted};
                        cursor: pointer;
                        padding: 4px;
                        border-radius: 4px;
                        display: flex;
                        align-items: center;
                    ">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </button>
                </div>

                <!-- 3. Sub-Filters Row (Only for Orders & History tabs) -->
                ${this.renderSubFiltersRow(theme, curOrders, history)}

                <!-- 4. Table Body Area -->
                <div style="flex: 1; overflow: auto; background: #ffffff;">
                    ${this.renderBottomActiveTable(theme, activeBrokerKey, curPositions, curOrders, history, acc)}
                </div>
            `;

            this.bindBottomTradingPanelEvents(panel);
        }

        renderSubFiltersRow(theme, curOrders, history) {
            if (this.bottomActiveTab === 'orders') {
                const f = this.ordersSubFilter;
                const workingCount = curOrders.filter(o => o.status === 'working' || !o.status).length;
                return `
                    <div style="display: flex; align-items: center; gap: 8px; padding: 6px 16px; border-bottom: 1px solid ${theme.border}; background: #ffffff; font-size: 11.5px;">
                        <button class="tv-orders-filter-btn" data-filter="all" style="padding: 2px 8px; border: none; border-radius: 4px; background: ${f === 'all' ? '#131722' : 'transparent'}; color: ${f === 'all' ? '#ffffff' : theme.text}; font-weight: 600; cursor: pointer;">All ${curOrders.length}</button>
                        <button class="tv-orders-filter-btn" data-filter="working" style="padding: 2px 8px; border: none; border-radius: 4px; background: ${f === 'working' ? '#131722' : 'transparent'}; color: ${f === 'working' ? '#ffffff' : theme.textMuted}; font-weight: 600; cursor: pointer;">Working ${workingCount > 0 ? workingCount : ''}</button>
                        <button class="tv-orders-filter-btn" data-filter="inactive" style="padding: 2px 8px; border: none; border-radius: 4px; background: ${f === 'inactive' ? '#131722' : 'transparent'}; color: ${f === 'inactive' ? '#ffffff' : theme.textMuted}; font-weight: 600; cursor: pointer;">Inactive</button>
                        <button class="tv-orders-filter-btn" data-filter="filled" style="padding: 2px 8px; border: none; border-radius: 4px; background: ${f === 'filled' ? '#131722' : 'transparent'}; color: ${f === 'filled' ? '#ffffff' : theme.textMuted}; font-weight: 600; cursor: pointer;">Filled</button>
                        <button class="tv-orders-filter-btn" data-filter="cancelled" style="padding: 2px 8px; border: none; border-radius: 4px; background: ${f === 'cancelled' ? '#131722' : 'transparent'}; color: ${f === 'cancelled' ? '#ffffff' : theme.textMuted}; font-weight: 600; cursor: pointer;">Cancelled</button>
                        <button class="tv-orders-filter-btn" data-filter="rejected" style="padding: 2px 8px; border: none; border-radius: 4px; background: ${f === 'rejected' ? '#131722' : 'transparent'}; color: ${f === 'rejected' ? '#ffffff' : theme.textMuted}; font-weight: 600; cursor: pointer;">Rejected</button>
                    </div>
                `;
            } else if (this.bottomActiveTab === 'history') {
                const f = this.historySubFilter;
                return `
                    <div style="display: flex; align-items: center; gap: 8px; padding: 6px 16px; border-bottom: 1px solid ${theme.border}; background: #ffffff; font-size: 11.5px;">
                        <button class="tv-history-filter-btn" data-filter="all" style="padding: 2px 8px; border: none; border-radius: 4px; background: ${f === 'all' ? '#131722' : 'transparent'}; color: ${f === 'all' ? '#ffffff' : theme.text}; font-weight: 600; cursor: pointer;">All ${history.length}</button>
                        <button class="tv-history-filter-btn" data-filter="filled" style="padding: 2px 8px; border: none; border-radius: 4px; background: ${f === 'filled' ? '#131722' : 'transparent'}; color: ${f === 'filled' ? '#ffffff' : theme.textMuted}; font-weight: 600; cursor: pointer;">Filled ${history.length}</button>
                        <button class="tv-history-filter-btn" data-filter="cancelled" style="padding: 2px 8px; border: none; border-radius: 4px; background: ${f === 'cancelled' ? '#131722' : 'transparent'}; color: ${f === 'cancelled' ? '#ffffff' : theme.textMuted}; font-weight: 600; cursor: pointer;">Cancelled</button>
                        <button class="tv-history-filter-btn" data-filter="rejected" style="padding: 2px 8px; border: none; border-radius: 4px; background: ${f === 'rejected' ? '#131722' : 'transparent'}; color: ${f === 'rejected' ? '#ffffff' : theme.textMuted}; font-weight: 600; cursor: pointer;">Rejected</button>
                    </div>
                `;
            }
            return '';
        }

        renderBottomActiveTable(theme, activeBrokerKey, curPositions, curOrders, history, acc) {
            if (this.bottomActiveTab === 'positions') {
                return this.renderPositionsTable(theme, curPositions);
            } else if (this.bottomActiveTab === 'orders') {
                return this.renderOrdersTable(theme, curOrders);
            } else if (this.bottomActiveTab === 'history') {
                return this.renderOrderHistoryTable(theme, history);
            } else if (this.bottomActiveTab === 'balance') {
                return this.renderBalanceHistoryTable(theme, activeBrokerKey, acc);
            } else if (this.bottomActiveTab === 'activity') {
                return this.renderActivityLogTable(theme);
            } else if (this.bottomActiveTab === 'trades') {
                return this.renderTradeHistoryTable(theme, history);
            } else if (this.bottomActiveTab === 'analytics') {
                return this.renderAnalyticsView(theme, history, acc);
            }
            return '';
        }

        // --- Positions Table (Image 3) ---
        renderPositionsTable(theme, curPositions) {
            if (curPositions.length === 0) {
                return `
                    <div style="padding: 40px; text-align: center; color: ${theme.textMuted}; font-size: 12px;">
                        No open positions. Use the Buy / Sell button or Order Ticket to enter a trade.
                    </div>
                `;
            }

            return `
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 11.5px; white-space: nowrap;">
                    <thead>
                        <tr style="height: 32px; border-bottom: 1px solid ${theme.border}; color: ${theme.textMuted}; font-weight: 500; font-size: 11px;">
                            <th style="padding: 0 16px;">Symbol</th>
                            <th style="padding: 0 12px;">Side</th>
                            <th style="padding: 0 12px; text-align: right;">Quantity</th>
                            <th style="padding: 0 12px; text-align: right;">Avg fill price</th>
                            <th style="padding: 0 12px; text-align: right;">Take profit</th>
                            <th style="padding: 0 12px; text-align: right;">Stop loss</th>
                            <th style="padding: 0 12px; text-align: right;">Last price</th>
                            <th style="padding: 0 12px; text-align: right;">Unrealized PnL</th>
                            <th style="padding: 0 12px; text-align: right;">Unrealized PnL %</th>
                            <th style="padding: 0 12px; text-align: right;">Trade value</th>
                            <th style="padding: 0 12px; text-align: right;">Market value</th>
                            <th style="padding: 0 12px; text-align: right;">Leverage</th>
                            <th style="padding: 0 12px; text-align: right;">Margin</th>
                            <th style="padding: 0 12px;">Expiration date</th>
                            <th style="padding: 0 16px; text-align: center;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${curPositions.map(p => {
                            const isBuy = p.type === 'BUY';
                            const sideText = isBuy ? 'Long' : 'Short';
                            const sideColor = isBuy ? '#2962ff' : '#f23645';
                            const pnl = p.profit || 0.0;
                            const pnlFormatted = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USD`;
                            const pnlPct = ((pnl / (p.open_price * p.lots || 1)) * 100).toFixed(2);
                            const pnlPctFormatted = `${pnl >= 0 ? '+' : ''}${pnlPct}%`;
                            const pnlColor = pnl >= 0 ? '#089981' : '#f23645';

                            const lastPrice = p.current_price || (isBuy ? this.currentBid : this.currentAsk);
                            const tradeValue = (p.open_price * p.lots).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                            const marketValue = (lastPrice * p.lots).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                            const marginVal = ((p.open_price * p.lots) / 50).toFixed(2);

                            const symFormatted = p.symbol.includes(':') ? p.symbol : `OANDA:${p.symbol}`;

                            return `
                                <tr style="height: 38px; border-bottom: 1px solid #f0f3fa; transition: background 0.1s;">
                                    <td style="padding: 0 16px;">
                                        <div style="display: flex; align-items: center; gap: 6px;">
                                            <div style="width: 16px; height: 16px; border-radius: 50%; background: #f59e0b; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 8.5px; font-weight: 800;">O</div>
                                            <span style="background: #2962ff; color: #ffffff; font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: 3px; letter-spacing: 0.3px;">${symFormatted}</span>
                                        </div>
                                    </td>
                                    <td style="padding: 0 12px; color: ${sideColor}; font-weight: 600;">${sideText}</td>
                                    <td style="padding: 0 12px; text-align: right; font-weight: 600; color: ${theme.text};">${p.lots}</td>
                                    <td style="padding: 0 12px; text-align: right; font-weight: 600; color: ${theme.text};">${p.open_price}</td>
                                    <td style="padding: 0 12px; text-align: right; color: ${theme.textMuted};">${p.tp ? p.tp : '—'}</td>
                                    <td style="padding: 0 12px; text-align: right; color: ${theme.textMuted};">${p.sl ? p.sl : '—'}</td>
                                    <td style="padding: 0 12px; text-align: right; font-weight: 600; color: ${theme.text};">${lastPrice}</td>
                                    <td style="padding: 0 12px; text-align: right; font-weight: 700; color: ${pnlColor};">${pnlFormatted}</td>
                                    <td style="padding: 0 12px; text-align: right; font-weight: 700; color: ${pnlColor};">${pnlPctFormatted}</td>
                                    <td style="padding: 0 12px; text-align: right; color: ${theme.text};">${tradeValue} USD</td>
                                    <td style="padding: 0 12px; text-align: right; color: ${theme.text};">${marketValue} USD</td>
                                    <td style="padding: 0 12px; text-align: right; color: ${theme.textMuted};">50x</td>
                                    <td style="padding: 0 12px; text-align: right; color: ${theme.text};">${marginVal} USD</td>
                                    <td style="padding: 0 12px; color: ${theme.textMuted};">—</td>
                                    <td style="padding: 0 16px; text-align: center;">
                                        <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                                            <button type="button" class="tv-btn-pos-protect" data-ticket="${p.ticket}" title="Protect / Modify Position" style="background: transparent; border: none; color: ${theme.textMuted}; cursor: pointer; padding: 2px;">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                                            </button>
                                            <button type="button" class="tv-btn-pos-close" data-ticket="${p.ticket}" title="Close Position at Market" style="background: transparent; border: none; color: ${theme.textMuted}; cursor: pointer; padding: 2px;">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
        }

        // --- Orders Table (Image 4) ---
        renderOrdersTable(theme, curOrders) {
            if (curOrders.length === 0) {
                return `
                    <div style="padding: 40px; text-align: center; color: ${theme.textMuted}; font-size: 12px;">
                        No pending or working orders currently.
                    </div>
                `;
            }

            return `
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 11.5px; white-space: nowrap;">
                    <thead>
                        <tr style="height: 32px; border-bottom: 1px solid ${theme.border}; color: ${theme.textMuted}; font-weight: 500; font-size: 11px;">
                            <th style="padding: 0 16px;">Symbol</th>
                            <th style="padding: 0 12px;">Side</th>
                            <th style="padding: 0 12px;">Type</th>
                            <th style="padding: 0 12px; text-align: right;">Quantity</th>
                            <th style="padding: 0 12px; text-align: right;">Limit price</th>
                            <th style="padding: 0 12px; text-align: right;">Stop price</th>
                            <th style="padding: 0 12px; text-align: right;">Fill price</th>
                            <th style="padding: 0 12px; text-align: right;">Take profit</th>
                            <th style="padding: 0 12px; text-align: right;">Stop loss</th>
                            <th style="padding: 0 12px;">Instruction</th>
                            <th style="padding: 0 12px;">Status</th>
                            <th style="padding: 0 12px;">Placing time</th>
                            <th style="padding: 0 12px;">Order ID</th>
                            <th style="padding: 0 12px;">Level ID</th>
                            <th style="padding: 0 12px;">Expiry</th>
                            <th style="padding: 0 16px; text-align: center;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${curOrders.map(o => {
                            const isBuy = o.type === 'BUY';
                            const sideColor = isBuy ? '#2962ff' : '#f23645';
                            const status = o.status || 'Working';
                            const statusColor = status === 'Filled' ? '#089981' : (status === 'Working' ? '#2962ff' : '#787b86');
                            const symFormatted = o.symbol.includes(':') ? o.symbol : `OANDA:${o.symbol}`;

                            return `
                                <tr style="height: 38px; border-bottom: 1px solid #f0f3fa; transition: background 0.1s;">
                                    <td style="padding: 0 16px;">
                                        <div style="display: flex; align-items: center; gap: 6px;">
                                            <div style="width: 16px; height: 16px; border-radius: 50%; background: #f59e0b; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 8.5px; font-weight: 800;">O</div>
                                            <span style="background: #2962ff; color: #ffffff; font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: 3px; letter-spacing: 0.3px;">${symFormatted}</span>
                                        </div>
                                    </td>
                                    <td style="padding: 0 12px; color: ${sideColor}; font-weight: 600;">${isBuy ? 'Buy' : 'Sell'}</td>
                                    <td style="padding: 0 12px; color: ${theme.text}; font-weight: 500;">${o.orderType ? o.orderType.toUpperCase() : 'LIMIT'}</td>
                                    <td style="padding: 0 12px; text-align: right; font-weight: 600; color: ${theme.text};">${o.lots}</td>
                                    <td style="padding: 0 12px; text-align: right; color: ${theme.text};">${o.price || '—'}</td>
                                    <td style="padding: 0 12px; text-align: right; color: ${theme.textMuted};">—</td>
                                    <td style="padding: 0 12px; text-align: right; color: ${theme.text};">${o.fillPrice || '—'}</td>
                                    <td style="padding: 0 12px; text-align: right; color: ${theme.textMuted};">${o.tp || '—'}</td>
                                    <td style="padding: 0 12px; text-align: right; color: ${theme.textMuted};">${o.sl || '—'}</td>
                                    <td style="padding: 0 12px; color: ${theme.textMuted};">—</td>
                                    <td style="padding: 0 12px; font-weight: 600; color: ${statusColor};">${status}</td>
                                    <td style="padding: 0 12px; color: ${theme.textMuted};">${o.time || '2026-10-22 03:17:09'}</td>
                                    <td style="padding: 0 12px; color: ${theme.textMuted}; font-family: monospace;">${o.ticket || '3703008190'}</td>
                                    <td style="padding: 0 12px; color: ${theme.textMuted};">—</td>
                                    <td style="padding: 0 12px; color: ${theme.textMuted};">2026-11-22 03:17:09</td>
                                    <td style="padding: 0 16px; text-align: center;">
                                        <button type="button" class="tv-btn-ord-cancel" data-ticket="${o.ticket}" title="Cancel Order" style="background: transparent; border: none; color: #f23645; cursor: pointer; padding: 2px;">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                        </button>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
        }

        // --- Order History Table (Image 5) ---
        renderOrderHistoryTable(theme, history) {
            if (history.length === 0) {
                return `
                    <div style="padding: 40px; text-align: center; color: ${theme.textMuted}; font-size: 12px;">
                        No closed trade history yet.
                    </div>
                `;
            }

            return `
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 11.5px; white-space: nowrap;">
                    <thead>
                        <tr style="height: 32px; border-bottom: 1px solid ${theme.border}; color: ${theme.textMuted}; font-weight: 500; font-size: 11px;">
                            <th style="padding: 0 16px;">Symbol</th>
                            <th style="padding: 0 12px;">Side</th>
                            <th style="padding: 0 12px;">Type</th>
                            <th style="padding: 0 12px; text-align: right;">Quantity</th>
                            <th style="padding: 0 12px; text-align: right;">Limit price</th>
                            <th style="padding: 0 12px; text-align: right;">Stop price</th>
                            <th style="padding: 0 12px; text-align: right;">Fill price</th>
                            <th style="padding: 0 12px;">Status</th>
                            <th style="padding: 0 12px; text-align: right;">Commission</th>
                            <th style="padding: 0 12px;">Placing time</th>
                            <th style="padding: 0 12px;">Closing time</th>
                            <th style="padding: 0 12px;">Order ID</th>
                            <th style="padding: 0 12px;">Level ID</th>
                            <th style="padding: 0 12px; text-align: right;">Leverage</th>
                            <th style="padding: 0 12px; text-align: right;">Margin</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${history.map(h => {
                            const isBuy = h.type === 'BUY';
                            const sideColor = isBuy ? '#2962ff' : '#f23645';
                            const symFormatted = h.symbol.includes(':') ? h.symbol : `OANDA:${h.symbol}`;
                            const marginVal = ((h.open_price * h.lots) / 50).toFixed(2);

                            return `
                                <tr style="height: 38px; border-bottom: 1px solid #f0f3fa; transition: background 0.1s;">
                                    <td style="padding: 0 16px;">
                                        <div style="display: flex; align-items: center; gap: 6px;">
                                            <div style="width: 16px; height: 16px; border-radius: 50%; background: #f59e0b; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 8.5px; font-weight: 800;">O</div>
                                            <span style="background: #2962ff; color: #ffffff; font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: 3px; letter-spacing: 0.3px;">${symFormatted}</span>
                                        </div>
                                    </td>
                                    <td style="padding: 0 12px; color: ${sideColor}; font-weight: 600;">${isBuy ? 'Buy' : 'Sell'}</td>
                                    <td style="padding: 0 12px; color: ${theme.text}; font-weight: 500;">Market</td>
                                    <td style="padding: 0 12px; text-align: right; font-weight: 600; color: ${theme.text};">${h.lots}</td>
                                    <td style="padding: 0 12px; text-align: right; color: ${theme.textMuted};">—</td>
                                    <td style="padding: 0 12px; text-align: right; color: ${theme.textMuted};">—</td>
                                    <td style="padding: 0 12px; text-align: right; font-weight: 600; color: ${theme.text};">${h.open_price}</td>
                                    <td style="padding: 0 12px; font-weight: 600; color: #089981;">Filled</td>
                                    <td style="padding: 0 12px; text-align: right; color: ${theme.textMuted};">0.00</td>
                                    <td style="padding: 0 12px; color: ${theme.textMuted};">${h.openTime || '2026-10-22 02:25:33'}</td>
                                    <td style="padding: 0 12px; color: ${theme.textMuted};">${h.closeTime || '2026-10-22 02:25:35'}</td>
                                    <td style="padding: 0 12px; color: ${theme.textMuted}; font-family: monospace;">${h.ticket || '3702952833'}</td>
                                    <td style="padding: 0 12px; color: ${theme.textMuted};">—</td>
                                    <td style="padding: 0 12px; text-align: right; color: ${theme.textMuted};">50x</td>
                                    <td style="padding: 0 12px; text-align: right; color: ${theme.text};">${marginVal} USD</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
        }

        // --- Balance History Tab ---
        renderBalanceHistoryTable(theme, activeBrokerKey, acc) {
            const isPaper = activeBrokerKey === 'paper';
            return `
                <div style="padding: 16px; display: flex; flex-direction: column; gap: 14px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid ${theme.border}; padding-bottom: 12px;">
                        <div>
                            <span style="font-size: 13px; font-weight: 700; color: ${theme.text};">Account Funding & Equity History</span>
                            <span style="font-size: 11px; color: ${theme.textMuted}; margin-left: 8px;">Active balance: $${Number(acc.balance || 0).toLocaleString()}</span>
                        </div>
                        ${isPaper ? `
                            <div style="display: flex; gap: 8px;">
                                <input type="number" id="tv-bottom-deposit-in" placeholder="Deposit Amount ($)" style="border: 1px solid ${theme.border}; border-radius: 4px; padding: 4px 8px; font-size: 11px; width: 140px; outline: none;">
                                <button type="button" id="tv-bottom-deposit-btn" style="background: #2962ff; color: #fff; border: none; border-radius: 4px; padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: pointer;">Deposit</button>
                                <button type="button" id="tv-bottom-reset-btn" style="background: #f0f3fa; color: #f23645; border: 1px solid ${theme.border}; border-radius: 4px; padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: pointer;">Reset $100k</button>
                            </div>
                        ` : ''}
                    </div>

                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 11.5px; white-space: nowrap;">
                        <thead>
                            <tr style="height: 30px; border-bottom: 1px solid ${theme.border}; color: ${theme.textMuted}; font-weight: 500;">
                                <th>Date & Time</th>
                                <th>Transaction Type</th>
                                <th style="text-align: right;">Amount</th>
                                <th style="text-align: right;">Balance</th>
                                <th>Comment</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style="height: 36px; border-bottom: 1px solid #f0f3fa;">
                                <td>2026-10-22 00:00:00</td>
                                <td style="color: #089981; font-weight: 600;">Initial Account Allocation</td>
                                <td style="text-align: right; color: #089981; font-weight: 600;">+$100,000.00</td>
                                <td style="text-align: right; font-weight: 700;">$100,000.00</td>
                                <td style="color: ${theme.textMuted};">Paper Trading Provisioning</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            `;
        }

        // --- Activity Log Tab ---
        renderActivityLogTable(theme) {
            return `
                <div style="padding: 12px 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-size: 12px; font-weight: 700; color: ${theme.text};">Live Audit & Execution Journal (${this.activityLogs.length})</span>
                        <button id="tv-btn-clear-logs" type="button" style="background: transparent; border: 1px solid ${theme.border}; border-radius: 4px; padding: 2px 8px; font-size: 10.5px; color: ${theme.textMuted}; cursor: pointer;">Clear Logs</button>
                    </div>

                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 11.5px; white-space: nowrap;">
                        <thead>
                            <tr style="height: 30px; border-bottom: 1px solid ${theme.border}; color: ${theme.textMuted}; font-weight: 500;">
                                <th style="width: 160px;">Time</th>
                                <th style="width: 140px;">Event</th>
                                <th style="width: 120px;">Broker</th>
                                <th>Details</th>
                                <th style="width: 90px; text-align: center;">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.activityLogs.map(l => `
                                <tr style="height: 34px; border-bottom: 1px solid #f0f3fa;">
                                    <td style="color: ${theme.textMuted};">${l.time}</td>
                                    <td style="font-weight: 600; color: ${theme.text};">${l.event}</td>
                                    <td><span style="background: #eef3ff; color: #2962ff; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 3px;">${l.broker}</span></td>
                                    <td style="color: ${theme.text};">${l.details}</td>
                                    <td style="text-align: center;"><span style="color: #089981; font-weight: 700; font-size: 11px;">${l.status}</span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        // --- Trade History Tab ---
        renderTradeHistoryTable(theme, history) {
            return this.renderOrderHistoryTable(theme, history);
        }

        // --- Analytics View Tab ---
        renderAnalyticsView(theme, history, acc) {
            const totalTrades = history.length;
            const winningTrades = history.filter(h => (h.profit || 0) > 0);
            const losingTrades = history.filter(h => (h.profit || 0) < 0);
            const winRate = totalTrades > 0 ? ((winningTrades.length / totalTrades) * 100).toFixed(1) : '0.0';
            const grossProfit = winningTrades.reduce((sum, h) => sum + h.profit, 0);
            const grossLoss = Math.abs(losingTrades.reduce((sum, h) => sum + h.profit, 0));
            const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? '∞' : '1.00');
            const netProfit = grossProfit - grossLoss;

            return `
                <div style="padding: 16px; display: flex; flex-direction: column; gap: 16px;">
                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;">
                        <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 8px; padding: 12px;">
                            <span style="font-size: 11px; color: ${theme.textMuted};">Win Rate</span>
                            <div style="font-size: 18px; font-weight: 800; color: #089981; margin-top: 4px;">${winRate}%</div>
                            <span style="font-size: 10px; color: ${theme.textMuted};">${winningTrades.length} win / ${losingTrades.length} loss</span>
                        </div>
                        <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 8px; padding: 12px;">
                            <span style="font-size: 11px; color: ${theme.textMuted};">Profit Factor</span>
                            <div style="font-size: 18px; font-weight: 800; color: #2962ff; margin-top: 4px;">${profitFactor}</div>
                            <span style="font-size: 10px; color: ${theme.textMuted};">Gross: +$${grossProfit.toFixed(2)}</span>
                        </div>
                        <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 8px; padding: 12px;">
                            <span style="font-size: 11px; color: ${theme.textMuted};">Net Realized PnL</span>
                            <div style="font-size: 18px; font-weight: 800; color: ${netProfit >= 0 ? '#089981' : '#f23645'}; margin-top: 4px;">${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}</div>
                            <span style="font-size: 10px; color: ${theme.textMuted};">${totalTrades} total closed</span>
                        </div>
                        <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 8px; padding: 12px;">
                            <span style="font-size: 11px; color: ${theme.textMuted};">Max Drawdown</span>
                            <div style="font-size: 18px; font-weight: 800; color: #131722; margin-top: 4px;">0.08%</div>
                            <span style="font-size: 10px; color: ${theme.textMuted};">Peak equity: $${Number(acc.equity || 100000).toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            `;
        }

        bindBottomTradingPanelEvents(panel) {
            // Window controls
            const btnClose = panel.querySelector('#tv-bottom-btn-close');
            const btnMin = panel.querySelector('#tv-bottom-btn-min');
            const btnMax = panel.querySelector('#tv-bottom-btn-max');
            const brokerSelect = panel.querySelector('#tv-bottom-broker-select');

            if (btnClose) btnClose.onclick = () => this.closeBottomPanel();
            if (btnMin) btnMin.onclick = () => this.closeBottomPanel();
            if (btnMax) {
                btnMax.onclick = () => {
                    this.isBottomPanelFullscreen = !this.isBottomPanelFullscreen;
                    this.renderBottomTradingPanel();
                };
            }

            if (brokerSelect) {
                brokerSelect.onchange = (e) => {
                    if (window.TradingEngine) {
                        window.TradingEngine.setBrokerMode(e.target.value);
                        this.renderBottomTradingPanel();
                        this.renderOnChartWidget();
                    }
                };
            }

            // Navigation pill buttons
            panel.querySelectorAll('.tv-bottom-tab-btn').forEach(btn => {
                btn.onclick = (e) => {
                    this.bottomActiveTab = e.currentTarget.getAttribute('data-tab');
                    this.renderBottomTradingPanel();
                };
            });

            // Sub-filter buttons (orders)
            panel.querySelectorAll('.tv-orders-filter-btn').forEach(btn => {
                btn.onclick = (e) => {
                    this.ordersSubFilter = e.currentTarget.getAttribute('data-filter');
                    this.renderBottomTradingPanel();
                };
            });

            // Sub-filter buttons (history)
            panel.querySelectorAll('.tv-history-filter-btn').forEach(btn => {
                btn.onclick = (e) => {
                    this.historySubFilter = e.currentTarget.getAttribute('data-filter');
                    this.renderBottomTradingPanel();
                };
            });

            // CSV Export button
            const btnExport = panel.querySelector('#tv-bottom-btn-export');
            if (btnExport) {
                btnExport.onclick = () => this.exportTableToCSV();
            }

            // Position protect & close buttons
            panel.querySelectorAll('.tv-btn-pos-protect').forEach(btn => {
                btn.onclick = (e) => {
                    const ticket = parseInt(btn.getAttribute('data-ticket'), 10);
                    const pos = (this.positions || []).find(p => p.ticket === ticket) || (window.PaperTrading && window.PaperTrading.getPositions().find(p => p.ticket === ticket));
                    if (pos) this.openProtectionModal(pos);
                };
            });

            panel.querySelectorAll('.tv-btn-pos-close').forEach(btn => {
                btn.onclick = (e) => {
                    const ticket = parseInt(btn.getAttribute('data-ticket'), 10);
                    if (window.TradingEngine) {
                        window.TradingEngine.closePosition({ ticket });
                        this.logActivity('Position Closed', `Ticket #${ticket} closed at market`);
                        this.renderBottomTradingPanel();
                    }
                };
            });

            // Order cancel buttons
            panel.querySelectorAll('.tv-btn-ord-cancel').forEach(btn => {
                btn.onclick = (e) => {
                    const ticket = parseInt(btn.getAttribute('data-ticket'), 10);
                    if (window.TradingEngine) {
                        window.TradingEngine.cancelOrder(ticket);
                        this.logActivity('Order Cancelled', `Order #${ticket} cancelled`);
                        this.renderBottomTradingPanel();
                    }
                };
            });

            // Paper Deposit & Reset actions
            const depBtn = panel.querySelector('#tv-bottom-deposit-btn');
            const depIn = panel.querySelector('#tv-bottom-deposit-in');
            if (depBtn && depIn) {
                depBtn.onclick = () => {
                    const amt = parseFloat(depIn.value);
                    if (amt > 0 && window.PaperTrading) {
                        const cur = window.PaperTrading.state.balance || 100000;
                        window.PaperTrading.setBalance(cur + amt);
                        depIn.value = '';
                        this.logActivity('Account Deposit', `Deposited $${amt.toLocaleString()} into Paper Trading`);
                        this.renderBottomTradingPanel();
                    }
                };
            }

            const resetBtn = panel.querySelector('#tv-bottom-reset-btn');
            if (resetBtn) {
                resetBtn.onclick = () => {
                    if (confirm('Reset Paper Trading account balance to $100,000.00?')) {
                        if (window.PaperTrading) {
                            window.PaperTrading.resetAccount(100000.00);
                            this.logActivity('Account Reset', 'Reset Paper Trading to $100,000.00');
                            this.renderBottomTradingPanel();
                        }
                    }
                };
            }

            // Clear log button
            const clearLogsBtn = panel.querySelector('#tv-btn-clear-logs');
            if (clearLogsBtn) {
                clearLogsBtn.onclick = () => {
                    this.activityLogs = [];
                    this.saveActivityLogs();
                    this.renderBottomTradingPanel();
                };
            }
        }

        bindBottomPanelResizer() {
            let isResizing = false;
            let startY = 0;
            let startHeight = 0;

            document.addEventListener('mousedown', (e) => {
                if (e.target && e.target.id === 'tv-bottom-drag-handle') {
                    isResizing = true;
                    startY = e.clientY;
                    startHeight = this.bottomPanelHeight || 270;
                    document.body.style.cursor = 'ns-resize';
                    e.preventDefault();
                }
            });

            document.addEventListener('mousemove', (e) => {
                if (!isResizing) return;
                const delta = startY - e.clientY;
                const newHeight = Math.max(this.minBottomHeight, Math.min(window.innerHeight * 0.85, startHeight + delta));
                this.bottomPanelHeight = newHeight;
                const panel = document.getElementById(this.bottomPanelId);
                if (panel) panel.style.height = `${newHeight}px`;
                this.updateChartContainerLayout();
            });

            document.addEventListener('mouseup', () => {
                if (isResizing) {
                    isResizing = false;
                    document.body.style.cursor = '';
                    this.saveSettings();
                }
            });
        }

        openBottomPanel(tab = 'positions') {
            this.bottomActiveTab = tab;
            this.isBottomPanelOpen = true;
            this.renderBottomTradingPanel();
            this.updateChartContainerLayout();
            this.updateBottomLauncherBadge();
        }

        closeBottomPanel() {
            this.isBottomPanelOpen = false;
            const panel = document.getElementById(this.bottomPanelId);
            if (panel) panel.style.display = 'none';
            this.updateChartContainerLayout();
            this.updateBottomLauncherBadge();
        }

        toggleBottomPanel() {
            if (this.isBottomPanelOpen) {
                this.closeBottomPanel();
            } else {
                this.openBottomPanel();
            }
        }

        // ==========================================
        // 7. PERSISTENT BOTTOM BAR LAUNCHER TAB
        // ==========================================
        renderBottomLauncherBar() {
            let bar = document.getElementById(this.bottomLauncherId);
            if (!bar) {
                bar = document.createElement('div');
                bar.id = this.bottomLauncherId;
                document.body.appendChild(bar);
            }

            const theme = this.getTheme();
            const curPositions = (window.PaperTrading && (!window.TradingEngine || window.TradingEngine.getActiveBrokerKey(this.currentSymbol) === 'paper')) 
                ? window.PaperTrading.getPositions() 
                : (this.positions || []);
            const posCount = curPositions.length;

            bar.style.cssText = `
                position: fixed;
                left: 0;
                bottom: 0;
                height: 30px;
                display: flex;
                align-items: center;
                gap: 8px;
                padding-left: 10px;
                z-index: 9999;
                font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif;
                pointer-events: auto;
            `;

            bar.innerHTML = `
                <button id="tv-bottom-launcher-btn" type="button" style="
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    height: 24px;
                    padding: 0 10px;
                    background: ${this.isBottomPanelOpen ? '#131722' : '#ffffff'};
                    color: ${this.isBottomPanelOpen ? '#ffffff' : '#131722'};
                    border: 1px solid ${theme.border};
                    border-radius: 4px;
                    font-size: 11.5px;
                    font-weight: 600;
                    cursor: pointer;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
                    transition: all 0.15s;
                ">
                    <span style="
                        width: 13px;
                        height: 13px;
                        border-radius: 2px;
                        background: ${this.isBottomPanelOpen ? '#ffffff' : '#131722'};
                        color: ${this.isBottomPanelOpen ? '#131722' : '#ffffff'};
                        font-size: 7.5px;
                        font-weight: 900;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    ">TV</span>
                    <span>Trading Panel</span>
                    ${posCount > 0 ? `
                        <span style="
                            background: ${this.isBottomPanelOpen ? '#2962ff' : '#131722'};
                            color: #ffffff;
                            font-size: 10px;
                            font-weight: 700;
                            padding: 0 5px;
                            border-radius: 8px;
                        ">${posCount}</span>
                    ` : ''}
                </button>
            `;

            const btn = bar.querySelector('#tv-bottom-launcher-btn');
            if (btn) {
                btn.onclick = () => this.toggleBottomPanel();
            }
        }

        updateBottomLauncherBadge() {
            this.renderBottomLauncherBar();
        }

        exportTableToCSV() {
            const curPositions = (window.PaperTrading) ? window.PaperTrading.getPositions() : [];
            const history = (window.PaperTrading) ? window.PaperTrading.getHistory() : [];
            let csv = '';
            let filename = `${this.bottomActiveTab}_export.csv`;

            if (this.bottomActiveTab === 'positions') {
                csv = 'Ticket,Symbol,Type,Lots,OpenPrice,CurrentPrice,Profit,TP,SL\n' +
                    curPositions.map(p => `${p.ticket},${p.symbol},${p.type},${p.lots},${p.open_price},${p.current_price || p.open_price},${p.profit || 0},${p.tp || ''},${p.sl || ''}`).join('\n');
            } else if (this.bottomActiveTab === 'history' || this.bottomActiveTab === 'trades') {
                csv = 'Ticket,Symbol,Type,Lots,OpenPrice,ClosePrice,Profit,OpenTime,CloseTime\n' +
                    history.map(h => `${h.ticket},${h.symbol},${h.type},${h.lots},${h.open_price},${h.close_price},${h.profit || 0},${h.openTime || ''},${h.closeTime || ''}`).join('\n');
            } else {
                csv = 'Time,Event,Broker,Details,Status\n' +
                    this.activityLogs.map(l => `"${l.time}","${l.event}","${l.broker}","${l.details}","${l.status}"`).join('\n');
            }

            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        }

        // ==========================================
        // 8. DYNAMIC DUAL-PANEL CHART LAYOUT COORDINATOR
        // ==========================================
        updateChartContainerLayout() {
            const chartCont = document.getElementById('tv_chart_container');
            if (!chartCont) return;

            const isSideDocked = this.isOrderTicketOpen && this.dockMode === 'docked';
            const sideWidth = isSideDocked ? 340 : 0;

            const isBottomOpen = this.isBottomPanelOpen && !this.isBottomPanelFullscreen;
            const bottomHeight = isBottomOpen ? (this.bottomPanelHeight || 270) : 30; // 30px for launcher bar

            if (this.isBottomPanelFullscreen) {
                chartCont.style.display = 'none';
            } else {
                chartCont.style.display = 'block';
            }

            if (isSideDocked) {
                if (this.dockSide === 'right') {
                    chartCont.style.width = `calc(100% - ${sideWidth}px)`;
                    chartCont.style.left = '0';
                    chartCont.style.right = `${sideWidth}px`;
                } else {
                    chartCont.style.width = `calc(100% - ${sideWidth}px)`;
                    chartCont.style.left = `${sideWidth}px`;
                    chartCont.style.right = '0';
                }
            } else {
                chartCont.style.width = '100%';
                chartCont.style.left = '0';
                chartCont.style.right = '0';
            }

            chartCont.style.bottom = `${bottomHeight}px`;
            chartCont.style.height = `calc(100% - ${bottomHeight}px)`;

            // Align bottom panel width so it sits flush next to the docked side panel
            const bottomPanel = document.getElementById(this.bottomPanelId);
            if (bottomPanel) {
                if (isSideDocked && this.dockSide === 'right') {
                    bottomPanel.style.right = `${sideWidth}px`;
                    bottomPanel.style.width = `calc(100% - ${sideWidth}px)`;
                } else if (isSideDocked && this.dockSide === 'left') {
                    bottomPanel.style.left = `${sideWidth}px`;
                    bottomPanel.style.width = `calc(100% - ${sideWidth}px)`;
                } else {
                    bottomPanel.style.left = '0';
                    bottomPanel.style.right = '0';
                    bottomPanel.style.width = '100%';
                }
            }

            window.dispatchEvent(new Event('resize'));
        }

        // ==========================================
        // 9. ORDER EXECUTION & PRICING HELPERS
        // ==========================================
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
                        this.logActivity('1-Click Fill', `${side} ${lots} ${this.currentSymbol} @ ${price}`, brokerName);
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
            if (this.isTpEnabled) sl = parseFloat(this.calculateExitPrice('sl')) || 0.0;
            if (this.isTpEnabled) tp = parseFloat(this.calculateExitPrice('tp')) || 0.0;

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
                if (this.isOrderTicketOpen) this.renderSideOrderTicket();
            }

            if (res && res.success) {
                this.logActivity('Order Submitted', `${type} ${lots} ${this.currentSymbol} ${this.orderType.toUpperCase()} @ ${price}`, brokerName);
                const msg = `✓ [${brokerName}] ${type} ${lots} ${this.currentSymbol} ${this.orderType.toUpperCase()} submitted!`;
                if (window.FyersAPI && window.FyersAPI.showToast) {
                    window.FyersAPI.showToast(msg, 'success');
                }
            } else {
                alert(`Order Execution Failed: ${res && res.error ? res.error : 'Execution rejected by broker'}`);
            }
        }

        getTheme() {
            let isDark = false;
            try {
                if (window.tvWidget && typeof window.tvWidget.getTheme === 'function') {
                    isDark = window.tvWidget.getTheme().toLowerCase() === 'dark';
                }
            } catch (_) {}
            if (!isDark) {
                isDark = document.body.classList.contains('theme-dark') ||
                         document.documentElement.getAttribute('data-theme') === 'dark';
            }

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
                    pillBg: '#2a2e39',
                    pillActiveBg: '#ffffff',
                    pillActiveText: '#131722',
                    sellActiveBg: 'rgba(242,54,69,0.18)',
                    buyActiveBg: 'rgba(41,98,255,0.18)',
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
                pillBg: '#f0f3fa',
                pillActiveBg: '#131722',
                pillActiveText: '#ffffff',
                sellActiveBg: '#fce8e8',
                buyActiveBg: '#e8f0fe',
                sellColor: '#f23645',
                buyColor: '#2962ff',
                shadow: '0 8px 24px rgba(0,0,0,0.10)'
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
            if (ticketBid) ticketBid.innerHTML = this.formatPipPriceHtml(this.currentBid);
            if (ticketAsk) ticketAsk.innerHTML = this.formatPipPriceHtml(this.currentAsk);
            if (ticketSpread) ticketSpread.innerText = this.getSpreadFormatted();

            this.updateFinancialSummary();
        }

        renderHeader() {
            const symEl = document.getElementById('tv-ticket-symbol-disp');
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
            return '99,913.45';
        }

        calculateExitPrice(type) {
            const refPrice = this.selectedSide === 'BUY' ? this.currentAsk : this.currentBid;
            const pipUnit = this.currentSymbol.includes('JPY') ? 0.01 : (this.currentSymbol.includes('XAU') ? 0.01 : (this.currentSymbol.includes('US30') ? 1.0 : (this.currentSymbol.includes('NIFTY') ? 0.05 : 0.0001)));

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

        formatPipPriceHtml(price) {
            const str = this.formatPrice(price);
            if (!str || str.length < 2) return str;
            const dotIdx = str.lastIndexOf('.');
            if (dotIdx !== -1 && dotIdx < str.length - 1) {
                const base = str.slice(0, -1);
                const last = str.slice(-1);
                return `${base}<span style="font-size: 0.72em; vertical-align: 0.35em; line-height: 0; font-weight: 700; margin-left: 0.5px;">${last}</span>`;
            }
            return str;
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
            this.updateTicketButtonSummary();
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
    }

    window.TradeUI = TradeUI;
    window.tradeUIInstance = new TradeUI();

})(window);
