/**
 * Authentic Native TradingView On-Chart Trading Suite & Side Order Panel
 * Features:
 *  1. Native on-chart Buy/Sell widget (Red Sell, Spread, Blue Buy, Lot dropdown).
 *  2. One-Click Trading toggle (immediate execution vs opening the Order Ticket).
 *  3. Authentic TradingView Side Trade Panel (Order & DOM tabs, Market/Limit/Stop, Units, Exits SL/TP toggles).
 *  4. Docking: Right or Left docking alignment with automatic chart resizing.
 *  5. Trading Settings modal with One-click trading & Order alignment options.
 * Broker-agnostic (MetaTrader 5, Fyers, and future adapters).
 */

(function(window) {
    'use strict';

    class TradeUI {
        constructor() {
            this.containerId = 'tv-onchart-trade-suite-container';
            this.onChartWidgetId = 'tv-native-onchart-trade-widget';
            this.sidePanelId = 'tv-native-side-trade-panel';
            this.settingsModalId = 'tv-trading-settings-modal';
            this.positionsOverlayId = 'tv-onchart-positions-overlay';

            // Settings & State
            this.settings = this.loadSettings();

            // Order state
            this.selectedSide = 'BUY'; // 'BUY' or 'SELL'
            this.selectedTab = 'order'; // 'order' or 'dom'
            this.orderType = 'market'; // 'market', 'limit', 'stop'
            this.limitPrice = 0.0;
            this.stopPrice = 0.0;

            this.lots = this.settings.defaultLots || 1.0;
            this.isSlEnabled = false;
            this.isTpEnabled = false;
            this.slTicks = 25;
            this.tpTicks = 75;
            this.isExitsExpanded = true;

            // Symbol & Market Data
            this.currentSymbol = 'XAUUSD';
            this.currentBid = 4139.340;
            this.currentAsk = 4139.880;
            this.positions = [];

            // UI visibility
            this.isPanelOpen = false;

            this.init();
        }

        loadSettings() {
            const defaults = {
                showBuySellButtons: true,
                oneClickTrading: false, // Default false: opens order ticket on click
                dockPosition: 'right', // 'right' or 'left'
                defaultLots: 1.0,
            };
            try {
                const saved = localStorage.getItem('tv_trading_settings_v3');
                return saved ? Object.assign(defaults, JSON.parse(saved)) : defaults;
            } catch (_) {
                return defaults;
            }
        }

        saveSettings() {
            try {
                localStorage.setItem('tv_trading_settings_v3', JSON.stringify(this.settings));
            } catch (_) {}
        }

        init() {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.mount());
            } else {
                this.mount();
            }

            // Bind to TradingEngine
            if (window.TradingEngine) {
                window.TradingEngine.onPositionUpdate((pos) => {
                    this.positions = pos || [];
                    this.renderPositions();
                });
            }

            // Bind to live ticks from MT5 or other brokers
            if (window.MT5API) {
                window.MT5API.subscribeQuotes(this.currentSymbol, (tick) => {
                    if (tick && tick.bid && tick.ask) {
                        this.currentBid = Number(tick.bid);
                        this.currentAsk = Number(tick.ask);
                        this.updatePrices();
                    }
                });
            }

            // Sync with active chart symbol changes
            setInterval(() => this.detectSymbolChange(), 1500);

            // Watch theme changes
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
                this.refreshUI();
            });
        }

        detectSymbolChange() {
            try {
                if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
                    const chart = window.tvWidget.activeChart();
                    if (chart && typeof chart.symbol === 'function') {
                        const sym = chart.symbol().split(':').pop();
                        if (sym && sym !== this.currentSymbol) {
                            this.currentSymbol = sym;
                            if (window.MT5API) {
                                window.MT5API.subscribeQuotes(sym, (t) => {
                                    if (t && t.bid && t.ask) {
                                        this.currentBid = Number(t.bid);
                                        this.currentAsk = Number(t.ask);
                                        this.updatePrices();
                                    }
                                });
                            }
                            this.updatePrices();
                            this.renderHeader();
                        }
                    }
                }
            } catch (_) {}
        }

        getTheme() {
            const isDark = document.body.classList.contains('theme-dark') || 
                           (document.querySelector('iframe') && document.querySelector('iframe').contentDocument && document.querySelector('iframe').contentDocument.body.classList.contains('theme-dark')) ||
                           window.matchMedia('(prefers-color-scheme: dark)').matches;
            return {
                isDark,
                panelBg: isDark ? '#1e222d' : '#ffffff',
                panelHeaderBg: isDark ? '#1e222d' : '#ffffff',
                border: isDark ? '#2a2e39' : '#e0e3eb',
                cardBg: isDark ? '#131722' : '#f8f9fd',
                text: isDark ? '#d1d4dc' : '#131722',
                textMuted: isDark ? '#787b86' : '#787b86',
                inputBg: isDark ? '#131722' : '#ffffff',
                inputBorder: isDark ? '#363c4e' : '#d1d4dc',
                buyColor: '#2962ff',
                sellColor: '#f23645',
                buyLightBg: isDark ? 'rgba(41, 98, 255, 0.22)' : '#d4e5ff',
                sellLightBg: isDark ? 'rgba(242, 54, 69, 0.22)' : '#ffd9dc',
                tabActiveBg: isDark ? '#2a2e39' : '#ffffff',
                widgetBg: isDark ? '#1e222d' : '#ffffff',
                widgetBorder: isDark ? '#363c4e' : '#d1d4dc',
            };
        }

        mount() {
            let container = document.getElementById(this.containerId);
            if (!container) {
                container = document.createElement('div');
                container.id = this.containerId;
                container.style.cssText = `
                    position: absolute;
                    top: 0; left: 0; right: 0; bottom: 0;
                    pointer-events: none;
                    z-index: 50;
                    overflow: hidden;
                    font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif;
                `;
                document.body.appendChild(container);
            }

            this.renderOnChartWidget();
            this.renderSidePanel();
            this.renderPositionsOverlay(container);
        }

        refreshUI() {
            this.renderOnChartWidget();
            if (this.isPanelOpen) {
                this.renderSidePanel();
            }
        }

        // ==========================================
        // 1. NATIVE ON-CHART BUY/SELL BUTTON BAR (Image 1)
        // ==========================================
        renderOnChartWidget() {
            let widget = document.getElementById(this.onChartWidgetId);
            if (!widget) {
                widget = document.createElement('div');
                widget.id = this.onChartWidgetId;
                document.body.appendChild(widget);
            }

            if (!this.settings.showBuySellButtons) {
                widget.style.display = 'none';
                return;
            }

            const theme = this.getTheme();
            widget.style.cssText = `
                position: fixed;
                top: 50px;
                left: 16px;
                pointer-events: auto;
                user-select: none;
                z-index: 55;
                display: flex;
                flex-direction: column;
                gap: 3px;
                font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif;
            `;

            const spreadPoints = this.getSpreadFormatted();
            const bidFormatted = this.formatPrice(this.currentBid);
            const askFormatted = this.formatPrice(this.currentAsk);

            widget.innerHTML = `
                <!-- Main Buy / Sell Buttons Row -->
                <div style="display: flex; align-items: center; gap: 8px;">
                    <!-- SELL BUTTON -->
                    <button id="tv-native-btn-sell" type="button" title="Sell ${this.currentSymbol}" style="
                        background: ${theme.widgetBg};
                        border: 1px solid #f23645;
                        border-radius: 6px;
                        padding: 3px 14px;
                        min-width: 86px;
                        cursor: pointer;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        outline: none;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.08);
                        transition: all 0.15s ease;
                    ">
                        <span id="tv-native-bid-disp" style="color: #f23645; font-size: 13px; font-weight: 700; line-height: 1.25;">${bidFormatted}</span>
                        <span style="color: #f23645; font-size: 9.5px; font-weight: 700; letter-spacing: 0.6px; line-height: 1.1;">SELL</span>
                    </button>

                    <!-- SPREAD -->
                    <div id="tv-native-spread-disp" style="
                        color: ${theme.textMuted};
                        font-size: 11px;
                        font-weight: 600;
                        min-width: 26px;
                        text-align: center;
                    ">${spreadPoints}</div>

                    <!-- BUY BUTTON -->
                    <button id="tv-native-btn-buy" type="button" title="Buy ${this.currentSymbol}" style="
                        background: ${theme.widgetBg};
                        border: 1px solid #2962ff;
                        border-radius: 6px;
                        padding: 3px 14px;
                        min-width: 86px;
                        cursor: pointer;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        outline: none;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.08);
                        transition: all 0.15s ease;
                    ">
                        <span id="tv-native-ask-disp" style="color: #2962ff; font-size: 13px; font-weight: 700; line-height: 1.25;">${askFormatted}</span>
                        <span style="color: #2962ff; font-size: 9.5px; font-weight: 700; letter-spacing: 0.6px; line-height: 1.1;">BUY</span>
                    </button>
                </div>

                <!-- LOT SELECTOR PILL (Placed under the SELL button) -->
                <div style="position: relative; align-self: flex-start;">
                    <button id="tv-native-lot-toggle-btn" type="button" title="Select Lot Size" style="
                        background: ${theme.widgetBg};
                        border: 1px solid ${theme.widgetBorder};
                        border-radius: 4px;
                        padding: 2px 7px;
                        font-size: 11px;
                        font-weight: 600;
                        color: ${theme.text};
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        outline: none;
                        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                    ">
                        <svg width="7" height="5" viewBox="0 0 10 6" fill="currentColor" style="opacity: 0.7;">
                            <path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                        </svg>
                        <span id="tv-native-lot-disp">${this.lots}</span>
                    </button>

                    <!-- Dropdown lot menu -->
                    <div id="tv-native-lot-dropdown" style="
                        display: none;
                        position: absolute;
                        top: 26px;
                        left: 0;
                        background: ${theme.panelBg};
                        border: 1px solid ${theme.border};
                        border-radius: 6px;
                        box-shadow: 0 6px 18px rgba(0,0,0,0.25);
                        padding: 6px;
                        z-index: 100;
                        min-width: 110px;
                        flex-direction: column;
                        gap: 4px;
                    ">
                        <div style="font-size: 10px; color: ${theme.textMuted}; font-weight: 700; padding: 2px 4px;">QUICK LOTS</div>
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px;">
                            ${[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0].map(v => `
                                <button class="tv-lot-preset-btn" data-lot="${v}" style="
                                    background: ${this.lots === v ? '#2962ff' : (theme.isDark ? '#2a2e39' : '#f0f3fa')};
                                    color: ${this.lots === v ? '#ffffff' : theme.text};
                                    border: none;
                                    border-radius: 3px;
                                    padding: 3px 0;
                                    font-size: 10.5px;
                                    font-weight: 600;
                                    cursor: pointer;
                                ">${v}</button>
                            `).join('')}
                        </div>
                        <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid ${theme.border}; display: flex; align-items: center; gap: 4px;">
                            <input type="number" id="tv-lot-custom-in" step="0.01" min="0.01" value="${this.lots}" style="
                                width: 100%;
                                padding: 3px 5px;
                                background: ${theme.inputBg};
                                color: ${theme.text};
                                border: 1px solid ${theme.inputBorder};
                                border-radius: 3px;
                                font-size: 11px;
                                font-weight: 600;
                                text-align: center;
                                outline: none;
                            ">
                        </div>
                    </div>
                </div>
            `;

            this.bindOnChartEvents(widget);
        }

        bindOnChartEvents(widget) {
            const btnSell = widget.querySelector('#tv-native-btn-sell');
            const btnBuy = widget.querySelector('#tv-native-btn-buy');
            const lotToggleBtn = widget.querySelector('#tv-native-lot-toggle-btn');
            const lotDropdown = widget.querySelector('#tv-native-lot-dropdown');

            if (lotToggleBtn && lotDropdown) {
                lotToggleBtn.onclick = (e) => {
                    e.stopPropagation();
                    const isOpen = lotDropdown.style.display === 'flex';
                    lotDropdown.style.display = isOpen ? 'none' : 'flex';
                };

                // Close on click outside
                document.addEventListener('click', () => {
                    if (lotDropdown) lotDropdown.style.display = 'none';
                });

                lotDropdown.querySelectorAll('.tv-lot-preset-btn').forEach(b => {
                    b.onclick = (e) => {
                        e.stopPropagation();
                        const val = parseFloat(e.target.getAttribute('data-lot'));
                        this.setLots(val);
                        lotDropdown.style.display = 'none';
                    };
                });

                const customIn = lotDropdown.querySelector('#tv-lot-custom-in');
                if (customIn) {
                    customIn.onchange = (e) => {
                        const val = Math.max(0.01, parseFloat(e.target.value) || 1.0);
                        this.setLots(val);
                    };
                }
            }

            if (btnSell) {
                btnSell.onclick = (e) => {
                    e.stopPropagation();
                    if (this.settings.oneClickTrading) {
                        this.executeInstantOrder('SELL');
                    } else {
                        this.openOrderTicket('SELL');
                    }
                };
            }

            if (btnBuy) {
                btnBuy.onclick = (e) => {
                    e.stopPropagation();
                    if (this.settings.oneClickTrading) {
                        this.executeInstantOrder('BUY');
                    } else {
                        this.openOrderTicket('BUY');
                    }
                };
            }
        }

        setLots(val) {
            this.lots = val;
            this.settings.defaultLots = val;
            this.saveSettings();
            const disp = document.getElementById('tv-native-lot-disp');
            if (disp) disp.innerText = this.lots;
            const unitsIn = document.getElementById('tv-ticket-units-in');
            if (unitsIn) unitsIn.value = this.lots;
            this.updateFinancialSummary();
        }

        async executeInstantOrder(type) {
            const lots = this.lots;
            const refPrice = type === 'BUY' ? this.currentAsk : this.currentBid;
            const multiCount = window.MT5API ? window.MT5API.multiAccountSelection.size : 0;
            const shouldBroadcast = multiCount > 1;

            if (window.FyersAPI && window.FyersAPI.showToast) {
                window.FyersAPI.showToast(`Submitting ${type} ${lots} ${this.currentSymbol}...`, 'info');
            }

            const res = await window.TradingEngine.placeOrder({
                symbol: this.currentSymbol,
                type: type,
                lots: lots,
                broadcast: shouldBroadcast
            });

            if (res && res.success) {
                const msg = shouldBroadcast 
                    ? `⚡ Broadcast ${type} executed across ${res.total_accounts} accounts!` 
                    : `✓ 1-Click: ${type} ${lots} ${this.currentSymbol} filled at ${refPrice}!`;
                if (window.FyersAPI && window.FyersAPI.showToast) {
                    window.FyersAPI.showToast(msg, 'success');
                }
            } else {
                alert(`Order Execution Failed: ${res && res.error ? res.error : 'Connection or Margin Error'}`);
            }
        }

        // ==========================================
        // 2. NATIVE TRADINGVIEW SIDE TRADE PANEL (Images 2 & 5)
        // ==========================================
        renderSidePanel() {
            let panel = document.getElementById(this.sidePanelId);
            if (!panel) {
                panel = document.createElement('div');
                panel.id = this.sidePanelId;
                document.body.appendChild(panel);
            }

            const theme = this.getTheme();
            const isDockRight = this.settings.dockPosition === 'right';

            panel.style.cssText = `
                position: fixed;
                top: 0;
                bottom: 0;
                ${isDockRight ? 'right: 0; left: auto;' : 'left: 0; right: auto;'}
                width: 330px;
                background: ${theme.panelBg};
                color: ${theme.text};
                ${isDockRight ? `border-left: 1px solid ${theme.border};` : `border-right: 1px solid ${theme.border};`}
                display: ${this.isPanelOpen ? 'flex' : 'none'};
                flex-direction: column;
                z-index: 9999;
                font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif;
                box-shadow: ${isDockRight ? '-4px 0 16px rgba(0,0,0,0.15)' : '4px 0 16px rgba(0,0,0,0.15)'};
                user-select: none;
                transition: transform 0.2s ease, width 0.2s ease;
            `;

            this.updateChartContainerLayout();

            const isBuy = this.selectedSide === 'BUY';
            const spreadPoints = this.getSpreadFormatted();
            const bidFormatted = this.formatPrice(this.currentBid);
            const askFormatted = this.formatPrice(this.currentAsk);

            panel.innerHTML = `
                <!-- 1. Header Bar -->
                <div style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px 14px;
                    border-bottom: 1px solid ${theme.border};
                ">
                    <!-- Left: Symbol Badge & Title -->
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
                            font-weight: 800;
                        ">TV</div>
                        <span id="tv-side-panel-symbol" style="font-size: 14px; font-weight: 700; color: ${theme.text};">${this.currentSymbol}</span>
                    </div>

                    <!-- Right Controls: Dock Toggle, DOM, Settings, Close -->
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <button id="tv-panel-btn-dock" type="button" title="Dock to ${isDockRight ? 'Left' : 'Right'}" style="
                            background: transparent; border: none; color: ${theme.textMuted}; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center;
                        ">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
                            </svg>
                        </button>
                        <button id="tv-panel-btn-dom-toggle" type="button" title="Toggle DOM" style="
                            background: transparent; border: none; color: ${this.selectedTab === 'dom' ? '#2962ff' : theme.textMuted}; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center;
                        ">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                            </svg>
                        </button>
                        <button id="tv-panel-btn-settings" type="button" title="Trading Settings" style="
                            background: transparent; border: none; color: ${theme.textMuted}; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center;
                        ">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/>
                            </svg>
                        </button>
                        <button id="tv-panel-btn-close" type="button" title="Close Trade Panel" style="
                            background: transparent; border: none; color: ${theme.textMuted}; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center;
                        ">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 6L6 18M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- 2. Subtabs: Order | DOM -->
                <div style="
                    display: flex;
                    margin: 10px 14px 6px;
                    background: ${theme.cardBg};
                    border: 1px solid ${theme.border};
                    border-radius: 6px;
                    padding: 2px;
                ">
                    <button id="tv-subtab-order" type="button" style="
                        flex: 1;
                        padding: 6px 0;
                        border: none;
                        border-radius: 4px;
                        background: ${this.selectedTab === 'order' ? theme.panelBg : 'transparent'};
                        color: ${this.selectedTab === 'order' ? theme.text : theme.textMuted};
                        font-weight: ${this.selectedTab === 'order' ? '700' : '500'};
                        font-size: 12px;
                        cursor: pointer;
                        box-shadow: ${this.selectedTab === 'order' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'};
                    ">Order</button>
                    <button id="tv-subtab-dom" type="button" style="
                        flex: 1;
                        padding: 6px 0;
                        border: none;
                        border-radius: 4px;
                        background: ${this.selectedTab === 'dom' ? theme.panelBg : 'transparent'};
                        color: ${this.selectedTab === 'dom' ? theme.text : theme.textMuted};
                        font-weight: ${this.selectedTab === 'dom' ? '700' : '500'};
                        font-size: 12px;
                        cursor: pointer;
                        box-shadow: ${this.selectedTab === 'dom' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'};
                    ">DOM</button>
                </div>

                <!-- Main Scrollable Body -->
                <div id="tv-panel-content-body" style="flex: 1; overflow-y: auto; padding: 6px 14px 14px; display: flex; flex-direction: column; gap: 12px;">
                    ${this.selectedTab === 'order' ? this.getOrderTabHtml(theme, isBuy, spreadPoints, bidFormatted, askFormatted) : this.getDomTabHtml(theme)}
                </div>

                <!-- 3. Bottom Primary Action Button (Order Tab Only) -->
                ${this.selectedTab === 'order' ? `
                <div style="padding: 12px 14px; border-top: 1px solid ${theme.border}; background: ${theme.panelBg};">
                    <button id="tv-ticket-btn-execute" type="button" style="
                        width: 100%;
                        background: ${isBuy ? '#2962ff' : '#f23645'};
                        color: #ffffff;
                        border: none;
                        border-radius: 8px;
                        padding: 10px 0;
                        cursor: pointer;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        box-shadow: 0 4px 12px ${isBuy ? 'rgba(41,98,255,0.35)' : 'rgba(242,54,69,0.35)'};
                        outline: none;
                        transition: opacity 0.15s, transform 0.1s;
                    ">
                        <span style="font-size: 15px; font-weight: 700; line-height: 1.2;">${isBuy ? 'Buy' : 'Sell'}</span>
                        <span id="tv-ticket-btn-summary-text" style="font-size: 11.5px; font-weight: 600; opacity: 0.9; line-height: 1.2;">
                            ${this.lots} ${this.currentSymbol} ${this.orderType.toUpperCase()}
                        </span>
                    </button>
                </div>
                ` : ''}
            `;

            this.bindSidePanelEvents(panel);
        }

        getOrderTabHtml(theme, isBuy, spreadPoints, bidFormatted, askFormatted) {
            return `
                <!-- A. Split Bid / Ask Segmented Bar -->
                <div style="
                    display: flex;
                    position: relative;
                    border-radius: 8px;
                    overflow: hidden;
                    border: 1px solid ${theme.border};
                    cursor: pointer;
                ">
                    <!-- Sell Half -->
                    <div id="tv-ticket-split-sell" style="
                        flex: 1;
                        padding: 8px 12px;
                        background: ${!isBuy ? theme.sellLightBg : (theme.isDark ? '#181b24' : '#f4f5f8')};
                        color: ${!isBuy ? '#f23645' : theme.text};
                        border-right: 1px solid ${theme.border};
                        transition: all 0.15s;
                    ">
                        <div style="font-size: 11.5px; font-weight: 700;">Sell</div>
                        <div id="tv-ticket-bid-val" style="font-size: 15px; font-weight: 700; margin-top: 2px;">${bidFormatted}</div>
                    </div>

                    <!-- Spread Center Badge -->
                    <div id="tv-ticket-spread-badge" style="
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        background: ${theme.panelBg};
                        border: 1px solid ${theme.border};
                        border-radius: 4px;
                        padding: 1px 6px;
                        font-size: 10px;
                        font-weight: 700;
                        color: ${theme.textMuted};
                        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                        z-index: 2;
                    ">${spreadPoints}</div>

                    <!-- Buy Half -->
                    <div id="tv-ticket-split-buy" style="
                        flex: 1;
                        padding: 8px 12px;
                        text-align: right;
                        background: ${isBuy ? theme.buyLightBg : (theme.isDark ? '#181b24' : '#f4f5f8')};
                        color: ${isBuy ? '#2962ff' : theme.text};
                        transition: all 0.15s;
                    ">
                        <div style="font-size: 11.5px; font-weight: 700;">Buy</div>
                        <div id="tv-ticket-ask-val" style="font-size: 15px; font-weight: 700; margin-top: 2px;">${askFormatted}</div>
                    </div>
                </div>

                <!-- B. Order Type Tabs (Market, Limit, Stop) -->
                <div style="
                    display: flex;
                    align-items: center;
                    border-bottom: 1px solid ${theme.border};
                    margin-top: 4px;
                ">
                    ${['market', 'limit', 'stop'].map(t => {
                        const active = this.orderType === t;
                        return `
                            <button class="tv-order-type-btn" data-type="${t}" style="
                                flex: 1;
                                background: transparent;
                                border: none;
                                border-bottom: 2px solid ${active ? (theme.isDark ? '#2962ff' : '#131722') : 'transparent'};
                                color: ${active ? theme.text : theme.textMuted};
                                font-size: 12px;
                                font-weight: ${active ? '700' : '600'};
                                padding: 8px 0;
                                cursor: pointer;
                                text-transform: capitalize;
                            ">${t}</button>
                        `;
                    }).join('')}
                </div>

                <!-- Price input if Limit or Stop -->
                ${this.orderType !== 'market' ? `
                <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
                    <label style="font-size: 11px; color: ${theme.textMuted}; font-weight: 600;">
                        ${this.orderType === 'limit' ? 'Limit Price' : 'Stop Price'}
                    </label>
                    <input type="number" id="tv-ticket-price-in" step="0.01" value="${this.formatPrice(this.selectedSide === 'BUY' ? this.currentAsk : this.currentBid)}" style="
                        width: 100%;
                        padding: 8px 10px;
                        background: ${theme.inputBg};
                        color: ${theme.text};
                        border: 1px solid ${theme.inputBorder};
                        border-radius: 6px;
                        font-size: 13px;
                        font-weight: 700;
                        outline: none;
                        box-sizing: border-box;
                    ">
                </div>
                ` : ''}

                <!-- C. Units / Lots Selector -->
                <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 11px; color: ${theme.textMuted}; font-weight: 600;">Units ⌵</span>
                    </div>
                    <div style="
                        display: flex;
                        align-items: center;
                        background: ${theme.inputBg};
                        border: 1px solid ${theme.inputBorder};
                        border-radius: 6px;
                        padding: 2px 8px;
                    ">
                        <input type="number" id="tv-ticket-units-in" step="0.01" min="0.01" value="${this.lots}" style="
                            flex: 1;
                            background: transparent;
                            border: none;
                            color: ${theme.text};
                            font-size: 13px;
                            font-weight: 700;
                            outline: none;
                            padding: 6px 0;
                        ">
                        <span style="color: ${theme.textMuted}; margin: 0 6px; font-size: 13px;">⇄</span>
                        <span id="tv-ticket-usd-val" style="font-size: 11.5px; font-weight: 600; color: ${theme.textMuted};">
                            ${this.calculateTradeValueUSD()} USD ⌵
                        </span>
                    </div>
                </div>

                <!-- D. Financial Summary Card -->
                <div style="
                    background: ${theme.cardBg};
                    border: 1px solid ${theme.border};
                    border-radius: 6px;
                    padding: 10px 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    font-size: 11px;
                ">
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: ${theme.textMuted};">Trade value (50x)</span>
                        <strong id="tv-val-trade-summary">${this.calculateTradeValueUSD()} USD</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: ${theme.textMuted};">Available margin</span>
                        <strong id="tv-val-avail-margin">${this.getAvailableMarginFormatted()} USD</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: ${theme.textMuted};">Tick value</span>
                        <strong>0.001 USD</strong>
                    </div>
                </div>

                <!-- E. Exits Accordion (Take Profit & Stop Loss) -->
                <div style="border-top: 1px solid ${theme.border}; padding-top: 10px; display: flex; flex-direction: column; gap: 8px;">
                    <!-- Accordion Header -->
                    <div id="tv-ticket-exits-toggle" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                        <span style="font-size: 13px; font-weight: 700; color: ${theme.text};">Exits</span>
                        <span style="color: ${theme.textMuted}; font-size: 12px;">${this.isExitsExpanded ? '⌃' : '⌵'}</span>
                    </div>

                    ${this.isExitsExpanded ? `
                        <!-- Take Profit -->
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-size: 11.5px; color: ${theme.text}; font-weight: 600;">Take profit price ⌵</span>
                                <label class="tv-toggle-switch">
                                    <input type="checkbox" id="tv-ticket-check-tp" ${this.isTpEnabled ? 'checked' : ''}>
                                    <span class="tv-toggle-slider"></span>
                                </label>
                            </div>
                            <div style="
                                display: flex;
                                align-items: center;
                                background: ${theme.inputBg};
                                border: 1px solid ${this.isTpEnabled ? theme.inputBorder : theme.border};
                                opacity: ${this.isTpEnabled ? '1' : '0.45'};
                                border-radius: 6px;
                                padding: 2px 8px;
                            ">
                                <input type="number" id="tv-ticket-tp-price-in" step="0.01" value="${this.calculateExitPrice('tp')}" ${!this.isTpEnabled ? 'disabled' : ''} style="
                                    flex: 1;
                                    background: transparent;
                                    border: none;
                                    color: ${theme.text};
                                    font-size: 12px;
                                    font-weight: 600;
                                    outline: none;
                                    padding: 6px 0;
                                ">
                                <span style="color: ${theme.textMuted}; margin: 0 4px; font-size: 12px;">⇄</span>
                                <input type="number" id="tv-ticket-tp-ticks-in" value="${this.tpTicks}" ${!this.isTpEnabled ? 'disabled' : ''} style="
                                    width: 50px;
                                    background: transparent;
                                    border: none;
                                    color: ${theme.textMuted};
                                    font-size: 11px;
                                    font-weight: 600;
                                    text-align: right;
                                    outline: none;
                                ">
                                <span style="color: ${theme.textMuted}; font-size: 10px; margin-left: 2px;">ticks ⌵</span>
                            </div>
                        </div>

                        <!-- Stop Loss -->
                        <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-size: 11.5px; color: ${theme.text}; font-weight: 600;">Stop loss price ⌵</span>
                                <label class="tv-toggle-switch">
                                    <input type="checkbox" id="tv-ticket-check-sl" ${this.isSlEnabled ? 'checked' : ''}>
                                    <span class="tv-toggle-slider"></span>
                                </label>
                            </div>
                            <div style="
                                display: flex;
                                align-items: center;
                                background: ${theme.inputBg};
                                border: 1px solid ${this.isSlEnabled ? theme.inputBorder : theme.border};
                                opacity: ${this.isSlEnabled ? '1' : '0.45'};
                                border-radius: 6px;
                                padding: 2px 8px;
                            ">
                                <input type="number" id="tv-ticket-sl-price-in" step="0.01" value="${this.calculateExitPrice('sl')}" ${!this.isSlEnabled ? 'disabled' : ''} style="
                                    flex: 1;
                                    background: transparent;
                                    border: none;
                                    color: ${theme.text};
                                    font-size: 12px;
                                    font-weight: 600;
                                    outline: none;
                                    padding: 6px 0;
                                ">
                                <span style="color: ${theme.textMuted}; margin: 0 4px; font-size: 12px;">⇄</span>
                                <input type="number" id="tv-ticket-sl-ticks-in" value="${this.slTicks}" ${!this.isSlEnabled ? 'disabled' : ''} style="
                                    width: 50px;
                                    background: transparent;
                                    border: none;
                                    color: ${theme.textMuted};
                                    font-size: 11px;
                                    font-weight: 600;
                                    text-align: right;
                                    outline: none;
                                ">
                                <span style="color: ${theme.textMuted}; font-size: 10px; margin-left: 2px;">ticks ⌵</span>
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        getDomTabHtml(theme) {
            const centerPrice = (this.currentBid + this.currentAsk) / 2;
            const step = this.currentSymbol.includes('JPY') ? 0.05 : (this.currentSymbol.includes('XAU') ? 0.50 : 0.0005);
            const rows = [];
            for (let i = 5; i >= -5; i--) {
                const p = centerPrice + i * step;
                const isBidSide = p <= this.currentBid;
                const isAskSide = p >= this.currentAsk;
                const vol = Math.floor(Math.abs(Math.sin(i * 1.5)) * 80 + 15);
                rows.push({
                    price: this.formatPrice(p),
                    isBidSide,
                    isAskSide,
                    vol
                });
            }

            return `
                <div style="font-size: 11px; color: ${theme.textMuted}; margin-bottom: 4px; display: flex; justify-content: space-between;">
                    <span>Depth of Market</span>
                    <span>1 Click Trading: ${this.settings.oneClickTrading ? 'ON' : 'OFF'}</span>
                </div>
                <div style="
                    border: 1px solid ${theme.border};
                    border-radius: 6px;
                    overflow: hidden;
                    font-size: 11.5px;
                ">
                    <div style="display: grid; grid-template-columns: 1fr 1.2fr 1fr; background: ${theme.cardBg}; padding: 6px 8px; font-weight: 700; border-bottom: 1px solid ${theme.border};">
                        <span style="color: #2962ff;">Bid Vol</span>
                        <span style="text-align: center;">Price</span>
                        <span style="text-align: right; color: #f23645;">Ask Vol</span>
                    </div>
                    ${rows.map(r => `
                        <div style="
                            display: grid;
                            grid-template-columns: 1fr 1.2fr 1fr;
                            padding: 4px 8px;
                            border-bottom: 1px solid ${theme.border};
                            background: ${r.isBidSide ? (theme.isDark ? 'rgba(41,98,255,0.06)' : '#f0f5ff') : (r.isAskSide ? (theme.isDark ? 'rgba(242,54,69,0.06)' : '#fff0f2') : 'transparent')};
                        ">
                            <span style="color: #2962ff; font-weight: 600;">${r.isBidSide ? r.vol : ''}</span>
                            <span style="text-align: center; font-weight: 700; color: ${theme.text};">${r.price}</span>
                            <span style="text-align: right; color: #f23645; font-weight: 600;">${r.isAskSide ? r.vol : ''}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        bindSidePanelEvents(panel) {
            // Header events
            const btnClose = panel.querySelector('#tv-panel-btn-close');
            const btnDock = panel.querySelector('#tv-panel-btn-dock');
            const btnDomToggle = panel.querySelector('#tv-panel-btn-dom-toggle');
            const btnSettings = panel.querySelector('#tv-panel-btn-settings');
            const subtabOrder = panel.querySelector('#tv-subtab-order');
            const subtabDom = panel.querySelector('#tv-subtab-dom');

            if (btnClose) btnClose.onclick = () => this.closeOrderTicket();
            if (btnDock) {
                btnDock.onclick = () => {
                    this.settings.dockPosition = this.settings.dockPosition === 'right' ? 'left' : 'right';
                    this.saveSettings();
                    this.renderSidePanel();
                };
            }
            if (btnDomToggle) {
                btnDomToggle.onclick = () => {
                    this.selectedTab = this.selectedTab === 'dom' ? 'order' : 'dom';
                    this.renderSidePanel();
                };
            }
            if (btnSettings) btnSettings.onclick = () => this.openTradingSettingsModal();
            if (subtabOrder) {
                subtabOrder.onclick = () => {
                    this.selectedTab = 'order';
                    this.renderSidePanel();
                };
            }
            if (subtabDom) {
                subtabDom.onclick = () => {
                    this.selectedTab = 'dom';
                    this.renderSidePanel();
                };
            }

            // Order tab specific events
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
                    this.saveSettings();
                    this.updateFinancialSummary();
                    const quickLotDisp = document.getElementById('tv-native-lot-disp');
                    if (quickLotDisp) quickLotDisp.innerText = this.lots;
                    const btnSummary = document.getElementById('tv-ticket-btn-summary-text');
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

            // Take Profit & Stop Loss toggles
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

            // TP & SL inputs
            const tpTicksIn = panel.querySelector('#tv-ticket-tp-ticks-in');
            const slTicksIn = panel.querySelector('#tv-ticket-sl-ticks-in');
            if (tpTicksIn) {
                tpTicksIn.oninput = (e) => {
                    this.tpTicks = parseFloat(e.target.value) || 75;
                    const tpPriceIn = panel.querySelector('#tv-ticket-tp-price-in');
                    if (tpPriceIn) tpPriceIn.value = this.calculateExitPrice('tp');
                };
            }
            if (slTicksIn) {
                slTicksIn.oninput = (e) => {
                    this.slTicks = parseFloat(e.target.value) || 25;
                    const slPriceIn = panel.querySelector('#tv-ticket-sl-price-in');
                    if (slPriceIn) slPriceIn.value = this.calculateExitPrice('sl');
                };
            }

            // Big execution button
            const btnExecute = panel.querySelector('#tv-ticket-btn-execute');
            if (btnExecute) {
                btnExecute.onclick = async () => {
                    await this.submitOrderFromTicket();
                };
            }
        }

        async submitOrderFromTicket() {
            const type = this.selectedSide;
            const lots = this.lots;
            const refPrice = type === 'BUY' ? this.currentAsk : this.currentBid;

            let price = 0.0;
            if (this.orderType !== 'market') {
                const priceIn = document.getElementById('tv-ticket-price-in');
                price = priceIn ? (parseFloat(priceIn.value) || refPrice) : refPrice;
            }

            let sl = 0.0;
            let tp = 0.0;
            if (this.isSlEnabled) {
                const slIn = document.getElementById('tv-ticket-sl-price-in');
                sl = slIn ? (parseFloat(slIn.value) || 0.0) : 0.0;
            }
            if (this.isTpEnabled) {
                const tpIn = document.getElementById('tv-ticket-tp-price-in');
                tp = tpIn ? (parseFloat(tpIn.value) || 0.0) : 0.0;
            }

            const multiCount = window.MT5API ? window.MT5API.multiAccountSelection.size : 0;
            const shouldBroadcast = multiCount > 1;

            const btn = document.getElementById('tv-ticket-btn-execute');
            if (btn) {
                btn.style.opacity = '0.7';
                btn.innerText = 'Submitting Order...';
            }

            const res = await window.TradingEngine.placeOrder({
                symbol: this.currentSymbol,
                type: type,
                orderType: this.orderType,
                lots: lots,
                price: price,
                sl: sl,
                tp: tp,
                broadcast: shouldBroadcast
            });

            if (btn) {
                btn.style.opacity = '1';
                this.renderSidePanel();
            }

            if (res && res.success) {
                const msg = shouldBroadcast 
                    ? `⚡ Broadcast ${type} executed across ${res.total_accounts} accounts!` 
                    : `✓ ${type} ${lots} ${this.currentSymbol} ${this.orderType.toUpperCase()} submitted!`;
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
        }

        closeOrderTicket() {
            this.isPanelOpen = false;
            const panel = document.getElementById(this.sidePanelId);
            if (panel) panel.style.display = 'none';
            this.updateChartContainerLayout();
        }

        updateChartContainerLayout() {
            const chartCont = document.getElementById('tv_chart_container');
            if (!chartCont) return;

            if (this.isPanelOpen) {
                if (this.settings.dockPosition === 'right') {
                    chartCont.style.right = '330px';
                    chartCont.style.left = '0';
                } else {
                    chartCont.style.left = '330px';
                    chartCont.style.right = '0';
                }
            } else {
                chartCont.style.right = '0';
                chartCont.style.left = '0';
            }

            // Trigger smooth chart canvas resize
            window.dispatchEvent(new Event('resize'));
        }

        // ==========================================
        // 3. TRADING SETTINGS MODAL (Images 3 & 4)
        // ==========================================
        openTradingSettingsModal() {
            let modal = document.getElementById(this.settingsModalId);
            if (!modal) {
                modal = document.createElement('div');
                modal.id = this.settingsModalId;
                modal.style.cssText = `
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0, 0, 0, 0.55);
                    backdrop-filter: blur(4px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 999999;
                    user-select: none;
                    font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif;
                `;
                document.body.appendChild(modal);
            }

            const theme = this.getTheme();
            modal.style.display = 'flex';

            modal.innerHTML = `
                <div style="
                    background: ${theme.panelBg};
                    color: ${theme.text};
                    border: 1px solid ${theme.border};
                    border-radius: 12px;
                    width: 440px;
                    max-width: 90vw;
                    box-shadow: 0 16px 40px rgba(0,0,0,0.35);
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                ">
                    <!-- Header -->
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 14px 18px;
                        border-bottom: 1px solid ${theme.border};
                    ">
                        <span style="font-size: 15px; font-weight: 700;">Trading Settings</span>
                        <button id="tv-settings-close-btn" type="button" style="
                            background: transparent; border: none; color: ${theme.textMuted}; cursor: pointer; padding: 4px;
                        ">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 6L6 18M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>

                    <!-- Content -->
                    <div style="padding: 18px; display: flex; flex-direction: column; gap: 18px; font-size: 12.5px;">
                        <!-- GENERAL SECTION -->
                        <div>
                            <div style="font-size: 11px; font-weight: 700; color: ${theme.textMuted}; letter-spacing: 0.5px; margin-bottom: 12px;">
                                GENERAL
                            </div>

                            <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; margin-bottom: 14px;">
                                <input type="checkbox" id="tv-set-check-buysell" ${this.settings.showBuySellButtons ? 'checked' : ''} style="margin-top: 2px;">
                                <div>
                                    <div style="font-weight: 600; color: ${theme.text};">Buy/sell buttons</div>
                                    <div style="color: ${theme.textMuted}; font-size: 11px; margin-top: 2px;">
                                        Displays buy and sell buttons directly on the chart
                                    </div>
                                </div>
                            </label>

                            <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer;">
                                <input type="checkbox" id="tv-set-check-oneclick" ${this.settings.oneClickTrading ? 'checked' : ''} style="margin-top: 2px;">
                                <div>
                                    <div style="font-weight: 600; color: ${theme.text};">One-click trading</div>
                                    <div style="color: ${theme.textMuted}; font-size: 11px; margin-top: 2px;">
                                        Instantly place, edit, cancel orders, or close positions without confirmation
                                    </div>
                                </div>
                            </label>
                        </div>

                        <!-- APPEARANCE SECTION -->
                        <div style="border-top: 1px solid ${theme.border}; padding-top: 16px;">
                            <div style="font-size: 11px; font-weight: 700; color: ${theme.textMuted}; letter-spacing: 0.5px; margin-bottom: 12px;">
                                APPEARANCE
                            </div>

                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-weight: 600; color: ${theme.text};">Order and position alignment</span>
                                <select id="tv-set-select-dock" style="
                                    background: ${theme.inputBg};
                                    color: ${theme.text};
                                    border: 1px solid ${theme.inputBorder};
                                    border-radius: 6px;
                                    padding: 5px 10px;
                                    font-size: 12px;
                                    font-weight: 600;
                                    outline: none;
                                    cursor: pointer;
                                ">
                                    <option value="right" ${this.settings.dockPosition === 'right' ? 'selected' : ''}>Right</option>
                                    <option value="left" ${this.settings.dockPosition === 'left' ? 'selected' : ''}>Left</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- Footer Buttons -->
                    <div style="
                        display: flex;
                        justify-content: flex-end;
                        gap: 10px;
                        padding: 14px 18px;
                        border-top: 1px solid ${theme.border};
                        background: ${theme.cardBg};
                    ">
                        <button id="tv-set-btn-cancel" type="button" style="
                            padding: 7px 16px;
                            border-radius: 6px;
                            border: 1px solid ${theme.border};
                            background: ${theme.panelBg};
                            color: ${theme.text};
                            font-size: 12.5px;
                            font-weight: 600;
                            cursor: pointer;
                        ">Cancel</button>

                        <button id="tv-set-btn-save" type="button" style="
                            padding: 7px 20px;
                            border-radius: 6px;
                            border: none;
                            background: #2962ff;
                            color: #ffffff;
                            font-size: 12.5px;
                            font-weight: 700;
                            cursor: pointer;
                        ">Ok</button>
                    </div>
                </div>
            `;

            // Bind modal buttons
            const btnClose = modal.querySelector('#tv-settings-close-btn');
            const btnCancel = modal.querySelector('#tv-set-btn-cancel');
            const btnSave = modal.querySelector('#tv-set-btn-save');

            const closeMe = () => { modal.style.display = 'none'; };
            if (btnClose) btnClose.onclick = closeMe;
            if (btnCancel) btnCancel.onclick = closeMe;

            if (btnSave) {
                btnSave.onclick = () => {
                    const checkBuySell = modal.querySelector('#tv-set-check-buysell');
                    const checkOneClick = modal.querySelector('#tv-set-check-oneclick');
                    const selectDock = modal.querySelector('#tv-set-select-dock');

                    this.settings.showBuySellButtons = checkBuySell ? checkBuySell.checked : true;
                    this.settings.oneClickTrading = checkOneClick ? checkOneClick.checked : false;
                    this.settings.dockPosition = selectDock ? selectDock.value : 'right';

                    this.saveSettings();
                    closeMe();
                    this.refreshUI();
                };
            }
        }

        // ==========================================
        // 4. PRICE & CALCULATIONS HELPERS
        // ==========================================
        updatePrices() {
            // Update on-chart widget
            const bidEl = document.getElementById('tv-native-bid-disp');
            const askEl = document.getElementById('tv-native-ask-disp');
            const spreadEl = document.getElementById('tv-native-spread-disp');
            if (bidEl) bidEl.innerText = this.formatPrice(this.currentBid);
            if (askEl) askEl.innerText = this.formatPrice(this.currentAsk);
            if (spreadEl) spreadEl.innerText = this.getSpreadFormatted();

            // Update side panel split card
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
            let contractSize = 100000; // Standard Forex lot
            if (this.currentSymbol.includes('XAU')) contractSize = 100;
            else if (this.currentSymbol.includes('US30') || this.currentSymbol.includes('NAS')) contractSize = 1;

            const totalValue = this.lots * refPrice * (contractSize > 1 ? contractSize / 1000 : 1);
            return totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        getAvailableMarginFormatted() {
            if (window.MT5API) {
                const acc = window.MT5API.getActiveAccount();
                if (acc && acc.margin_free != null) {
                    return Number(acc.margin_free).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                }
                if (acc && acc.balance != null) {
                    return Number(acc.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                }
            }
            return '100,000.00';
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
            if (this.currentSymbol.includes('JPY')) {
                return (diff * 100).toFixed(1);
            } else if (this.currentSymbol.includes('XAU')) {
                return (diff * 100).toFixed(1);
            } else if (this.currentSymbol.includes('US30') || this.currentSymbol.includes('NAS')) {
                return diff.toFixed(1);
            } else if (diff < 1) {
                return (diff * 10000).toFixed(1);
            }
            return diff.toFixed(1);
        }

        formatPrice(price) {
            if (!price) return '0.00';
            if (this.currentSymbol.includes('JPY')) return price.toFixed(3);
            if (this.currentSymbol.includes('XAU')) return price.toFixed(3);
            if (this.currentSymbol.includes('US30') || this.currentSymbol.includes('NAS')) return price.toFixed(2);
            if (price < 10) return price.toFixed(5);
            return price.toFixed(2);
        }

        // ==========================================
        // 5. ON-CHART POSITIONS OVERLAY
        // ==========================================
        renderPositionsOverlay(container) {
            let overlay = document.getElementById(this.positionsOverlayId);
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = this.positionsOverlayId;
                overlay.style.cssText = `
                    position: absolute;
                    bottom: 20px;
                    left: 20px;
                    pointer-events: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    z-index: 60;
                `;
                container.appendChild(overlay);
            }
            this.renderPositions();
        }

        renderPositions() {
            const overlay = document.getElementById(this.positionsOverlayId);
            if (!overlay) return;

            if (this.positions.length === 0) {
                overlay.innerHTML = '';
                return;
            }

            overlay.innerHTML = this.positions.map(p => {
                const isBuy = p.type === 'BUY';
                const pnl = Number(p.profit || 0);
                const isProfit = pnl >= 0;
                const pnlColor = isProfit ? '#089981' : '#f23645';

                return `
                    <div style="
                        background: rgba(30, 34, 45, 0.94);
                        backdrop-filter: blur(8px);
                        border: 1px solid ${isBuy ? 'rgba(8,153,129,0.4)' : 'rgba(242,54,69,0.4)'};
                        border-left: 4px solid ${isBuy ? '#089981' : '#f23645'};
                        border-radius: 6px;
                        padding: 7px 12px;
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                        color: #fff;
                        font-size: 12px;
                    ">
                        <div>
                            <strong style="color: ${isBuy ? '#089981' : '#f23645'};">${p.type}</strong>
                            <span>${p.lots} ${p.symbol} @ ${p.open_price}</span>
                            <span style="color: #787b86; font-size: 11px;">(#${p.ticket})</span>
                        </div>

                        <div>
                            <strong style="color: ${pnlColor}; font-size: 13px;">${isProfit ? '+' : ''}$${pnl.toFixed(2)}</strong>
                            <span style="color: #787b86; font-size: 11px;">(${p.pips || 0} pips)</span>
                        </div>

                        <!-- 1-Click Action Buttons -->
                        <div style="display: flex; gap: 4px;">
                            <button class="tv-btn-pos-be" data-ticket="${p.ticket}" title="Move Stop Loss to Break-Even (Entry Price)" style="background: rgba(41,98,255,0.15); color: #2962ff; border: 1px solid rgba(41,98,255,0.3); padding: 3px 6px; border-radius: 4px; font-size: 10.5px; font-weight: 700; cursor: pointer;">
                                BE
                            </button>
                            <button class="tv-btn-pos-partial" data-ticket="${p.ticket}" title="Close 50% Volume" style="background: rgba(255,152,0,0.15); color: #ff9800; border: 1px solid rgba(255,152,0,0.3); padding: 3px 6px; border-radius: 4px; font-size: 10.5px; font-weight: 700; cursor: pointer;">
                                50%
                            </button>
                            <button class="tv-btn-pos-close" data-ticket="${p.ticket}" title="Close Full Position" style="background: rgba(242,54,69,0.15); color: #f23645; border: 1px solid rgba(242,54,69,0.3); padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; cursor: pointer;">
                                ✕
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

            // Bind position actions
            overlay.querySelectorAll('.tv-btn-pos-be').forEach(b => {
                b.onclick = async (e) => {
                    const ticket = parseInt(e.target.getAttribute('data-ticket'), 10);
                    const pos = this.positions.find(p => p.ticket === ticket);
                    if (pos && window.TradingEngine) {
                        const res = await window.TradingEngine.moveBreakEven(pos);
                        if (res.success && window.FyersAPI && window.FyersAPI.showToast) {
                            window.FyersAPI.showToast(`✓ SL moved to Break-Even at ${res.sl}!`, 'success');
                        }
                    }
                };
            });

            overlay.querySelectorAll('.tv-btn-pos-partial').forEach(b => {
                b.onclick = async (e) => {
                    const ticket = parseInt(e.target.getAttribute('data-ticket'), 10);
                    const pos = this.positions.find(p => p.ticket === ticket);
                    if (pos && window.TradingEngine) {
                        await window.TradingEngine.closePartial(pos, 50);
                    }
                };
            });

            overlay.querySelectorAll('.tv-btn-pos-close').forEach(b => {
                b.onclick = async (e) => {
                    const ticket = parseInt(e.target.getAttribute('data-ticket'), 10);
                    if (confirm(`Close position #${ticket}?`)) {
                        await window.TradingEngine.closePosition({ ticket });
                    }
                };
            });
        }
    }

    // Inject styles for toggles and UI components
    const styleEl = document.createElement('style');
    styleEl.innerHTML = `
        /* iOS-style toggle switches */
        .tv-toggle-switch {
            position: relative;
            display: inline-block;
            width: 34px;
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
            background-color: #787b86;
            transition: .2s;
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
            transition: .2s;
            border-radius: 50%;
        }
        .tv-toggle-switch input:checked + .tv-toggle-slider {
            background-color: #2962ff;
        }
        .tv-toggle-switch input:checked + .tv-toggle-slider:before {
            transform: translateX(16px);
        }
    `;
    document.head.appendChild(styleEl);

    // Export singleton
    window.TradeUI = new TradeUI();

})(window);
