/**
 * Authentic Native TradingView On-Chart Trading Suite & Side Order Panel (100% Visual Fidelity)
 * Features:
 *  1. Native on-chart Buy/Sell widget anchored directly inside <div class="legendMainSourceWrapper-YTFIJ62h">
 *     under the series title, naturally pushing indicators down without any overlap!
 *  2. Dual Modes: DOCKED (Right or Left, dynamically resizes chart canvas so price axis is fully visible)
 *     and UNDOCKED / FLOATING (movable draggable card with rounded corners and drop shadow).
 *  3. Header Toolbar [ ⇋ Trade ⌵ ] toggle button matching native TradingView.
 *  4. Real-time chart close price auto-detection (for NIFTY, Gold, Forex, etc.) so prices match the active chart.
 *  5. 100% Light Theme styling matching TradingView screenshots (pure white #ffffff, #e0e3eb borders).
 *  6. One-Click Trading toggle and full Trading Settings modal.
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
            this.currentBid = 4140.690;
            this.currentAsk = 4141.340;
            this.positions = [];

            // UI visibility & mode
            this.isPanelOpen = false;
            this.dockMode = this.settings.dockMode || 'docked'; // 'docked' or 'floating'
            this.dockSide = this.settings.dockSide || 'right'; // 'right' or 'left'

            // Floating drag coordinates
            this.floatingPos = this.loadFloatingPos();

            this.init();
        }

        loadSettings() {
            const defaults = {
                showBuySellButtons: true,
                oneClickTrading: false, // Default false: opens order ticket on click
                dockMode: 'docked', // 'docked' or 'floating'
                dockSide: 'right', // 'right' or 'left'
                defaultLots: 1.0,
            };
            try {
                const saved = localStorage.getItem('tv_trading_settings_v5');
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
                localStorage.setItem('tv_trading_settings_v5', JSON.stringify(this.settings));
            } catch (_) {}
        }

        loadFloatingPos() {
            try {
                const p = localStorage.getItem('tv_trade_floating_pos');
                return p ? JSON.parse(p) : { top: '80px', left: 'auto', right: '30px' };
            } catch (_) {
                return { top: '80px', left: 'auto', right: '30px' };
            }
        }

        saveFloatingPos(top, left, right = 'auto') {
            this.floatingPos = { top, left, right };
            try {
                localStorage.setItem('tv_trade_floating_pos', JSON.stringify(this.floatingPos));
            } catch (_) {}
        }

        isDarkTheme() {
            if (document.body.classList.contains('theme-dark')) return true;
            const iframe = document.querySelector('#tv_chart_container iframe') || document.querySelector('iframe');
            if (iframe) {
                try {
                    const doc = iframe.contentDocument || iframe.contentWindow.document;
                    if (doc && doc.body) {
                        if (doc.body.classList.contains('theme-dark')) return true;
                        const bg = window.getComputedStyle(doc.body).backgroundColor;
                        if (bg === 'rgb(19, 23, 34)' || bg === 'rgb(30, 34, 45)') return true;
                    }
                } catch (_) {}
            }
            return false;
        }

        getTheme() {
            const isDark = this.isDarkTheme();
            return {
                isDark,
                panelBg: isDark ? '#1e222d' : '#ffffff',
                border: isDark ? '#2a2e39' : '#e0e3eb',
                cardBg: isDark ? '#131722' : '#f8f9fd',
                subtabBg: isDark ? '#131722' : '#f0f3fa',
                text: isDark ? '#d1d4dc' : '#131722',
                textMuted: isDark ? '#868993' : '#787b86',
                inputBg: isDark ? '#1e222d' : '#ffffff',
                inputBorder: isDark ? '#363c4e' : '#e0e3eb',
                buyColor: '#2962ff',
                sellColor: '#f23645',
                buyActiveBg: isDark ? 'rgba(41, 98, 255, 0.25)' : '#d4e5ff',
                sellActiveBg: isDark ? 'rgba(242, 54, 69, 0.25)' : '#ffd9dc',
                unselectedSideBg: isDark ? '#1e222d' : '#ffffff',
                shadow: isDark ? '0 12px 36px rgba(0,0,0,0.45)' : '0 12px 36px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.06)',
            };
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

            // Sync with chart symbol and price changes
            setInterval(() => {
                this.detectSymbolChange();
                this.renderOnChartWidget();
                this.injectToolbarButton();
            }, 800);
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
                        const p = parseFloat(closeEl.innerText.replace(/,/g, ''));
                        if (!isNaN(p) && p > 0) return p;
                    }
                }
            } catch (_) {}
            return null;
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

        // ==========================================
        // 1. TOP TOOLBAR [ ⇋ Trade ⌵ ] BUTTON
        // ==========================================
        injectToolbarButton(targetEl = null, iframeDoc = null) {
            if (!iframeDoc) {
                const iframe = document.querySelector('#tv_chart_container iframe') || document.querySelector('iframe[id^="tradingview_"]') || document.querySelector('iframe');
                if (iframe) {
                    try {
                        iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    } catch (_) {}
                }
            }
            const targetDoc = iframeDoc || document;
            if (targetDoc.getElementById(this.toolbarBtnId)) {
                this.updateToolbarBtnState(targetDoc);
                return;
            }

            const mt5Wrapper = targetDoc.getElementById('header-toolbar-mt5-manager');
            const fyersWrapper = targetDoc.getElementById('header-toolbar-broker-manager');
            const symbolSearch = targetDoc.getElementById('header-toolbar-symbol-search') || targetEl;

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

            // Insert after MT5 button if present, or after Fyers, or before symbol search
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

        updateToolbarBtnState(targetDoc = document) {
            const btn = targetDoc.getElementById(this.toolbarBtnId) || 
                        (document.querySelector('iframe') && document.querySelector('iframe').contentDocument && document.querySelector('iframe').contentDocument.getElementById(this.toolbarBtnId));
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
        // Fitted directly inside .legendMainSourceWrapper-YTFIJ62h
        // ==========================================
        renderOnChartWidget() {
            const iframe = document.querySelector('#tv_chart_container iframe') || document.querySelector('iframe[id^="tradingview_"]') || document.querySelector('iframe');
            if (!iframe) return;
            let iframeDoc;
            try {
                iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            } catch (_) { return; }
            if (!iframeDoc) return;

            // Remove any stale widget from outer body
            const staleOuter = document.getElementById(this.onChartWidgetId);
            if (staleOuter && staleOuter.parentNode === document.body) {
                staleOuter.remove();
            }

            // Find TradingView's native legend main source wrapper
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

            // Place directly inside legendMainSourceWrapper right after the main series row
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

            const spreadPoints = this.getSpreadFormatted();
            const bidFormatted = this.formatPrice(this.currentBid);
            const askFormatted = this.formatPrice(this.currentAsk);

            // If widget exists and rendered, quickly update live price nodes
            const bidDisp = widget.querySelector('#tv-native-bid-disp');
            const askDisp = widget.querySelector('#tv-native-ask-disp');
            const spreadDisp = widget.querySelector('#tv-native-spread-disp');
            const lotDisp = widget.querySelector('#tv-native-lot-disp');

            if (bidDisp && askDisp && spreadDisp && lotDisp) {
                bidDisp.innerText = bidFormatted;
                askDisp.innerText = askFormatted;
                spreadDisp.innerText = spreadPoints;
                lotDisp.innerText = this.lots;
                return;
            }

            widget.innerHTML = `
                <!-- Main Buy / Sell Buttons Row -->
                <div style="display: flex; align-items: center; gap: 8px;">
                    <!-- SELL BUTTON -->
                    <button id="tv-native-btn-sell" type="button" title="Sell ${this.currentSymbol}" style="
                        background: #ffffff;
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
                        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                        transition: transform 0.1s;
                    ">
                        <span id="tv-native-bid-disp" style="color: #f23645; font-size: 12px; font-weight: 700; line-height: 1.15;">${bidFormatted}</span>
                        <span style="color: #f23645; font-size: 9px; font-weight: 700; letter-spacing: 0.6px; line-height: 1.1;">SELL</span>
                    </button>

                    <!-- SPREAD -->
                    <div id="tv-native-spread-disp" style="
                        color: #131722;
                        font-size: 11px;
                        font-weight: 600;
                        min-width: 24px;
                        text-align: center;
                        letter-spacing: 0.2px;
                    ">${spreadPoints}</div>

                    <!-- BUY BUTTON -->
                    <button id="tv-native-btn-buy" type="button" title="Buy ${this.currentSymbol}" style="
                        background: #ffffff;
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
                        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                        transition: transform 0.1s;
                    ">
                        <span id="tv-native-ask-disp" style="color: #2962ff; font-size: 12px; font-weight: 700; line-height: 1.15;">${askFormatted}</span>
                        <span style="color: #2962ff; font-size: 9px; font-weight: 700; letter-spacing: 0.6px; line-height: 1.1;">BUY</span>
                    </button>
                </div>

                <!-- LOT SELECTOR PILL (Placed directly underneath Sell button) -->
                <div style="position: relative; align-self: flex-start; margin-top: 1px;">
                    <button id="tv-native-lot-toggle-btn" type="button" title="Select Lot Size" style="
                        background: #ffffff;
                        border: 1px solid #d1d4dc;
                        border-radius: 3px;
                        padding: 1px 5px;
                        height: 18px;
                        font-size: 11px;
                        font-weight: 600;
                        color: #131722;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 3px;
                        outline: none;
                        box-shadow: 0 1px 2px rgba(0,0,0,0.04);
                    ">
                        <svg width="7" height="4" viewBox="0 0 10 6" fill="currentColor" style="opacity: 0.8;">
                            <path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                        </svg>
                        <span id="tv-native-lot-disp">${this.lots}</span>
                    </button>

                    <!-- Dropdown lot menu -->
                    <div id="tv-native-lot-dropdown" style="
                        display: none;
                        position: absolute;
                        top: 22px;
                        left: 0;
                        background: #ffffff;
                        border: 1px solid #e0e3eb;
                        border-radius: 6px;
                        box-shadow: 0 6px 18px rgba(0,0,0,0.15);
                        padding: 6px;
                        z-index: 9999;
                        min-width: 110px;
                        flex-direction: column;
                        gap: 4px;
                    ">
                        <div style="font-size: 9px; color: #787b86; font-weight: 700; padding: 2px 4px;">QUICK LOTS</div>
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px;">
                            ${[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0].map(v => `
                                <button class="tv-lot-preset-btn" data-lot="${v}" style="
                                    background: ${this.lots === v ? '#2962ff' : '#f0f3fa'};
                                    color: ${this.lots === v ? '#ffffff' : '#131722'};
                                    border: none;
                                    border-radius: 3px;
                                    padding: 3px 0;
                                    font-size: 10px;
                                    font-weight: 600;
                                    cursor: pointer;
                                ">${v}</button>
                            `).join('')}
                        </div>
                        <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid #e0e3eb; display: flex; align-items: center; gap: 4px;">
                            <input type="number" id="tv-lot-custom-in" step="0.01" min="0.01" value="${this.lots}" style="
                                width: 100%;
                                padding: 3px 5px;
                                background: #ffffff;
                                color: #131722;
                                border: 1px solid #d1d4dc;
                                border-radius: 3px;
                                font-size: 11px;
                                font-weight: 600;
                                text-align: center;
                                outline: none;
                                box-sizing: border-box;
                            ">
                        </div>
                    </div>
                </div>
            `;

            this.bindOnChartEvents(widget, iframeDoc);
        }

        bindOnChartEvents(widget, iframeDoc) {
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

                iframeDoc.addEventListener('click', () => {
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
                window.FyersAPI.showToast(`Submitting 1-Click ${type} ${lots} ${this.currentSymbol}...`, 'info');
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
        // 3. NATIVE SIDE TRADE PANEL (DOCKED OR FLOATING)
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
                    top: 38px;
                    bottom: 0;
                    ${isDockRight ? 'right: 0; left: auto;' : 'left: 0; right: auto;'}
                    width: 320px;
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
                // Floating Undocked Window (Image 2)
                const fPos = this.floatingPos;
                panel.style.cssText = `
                    position: fixed;
                    top: ${fPos.top || '80px'};
                    ${fPos.left && fPos.left !== 'auto' ? `left: ${fPos.left}; right: auto;` : `right: ${fPos.right || '30px'}; left: auto;`}
                    width: 320px;
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

            const isBuy = this.selectedSide === 'BUY';
            const spreadPoints = this.getSpreadFormatted();
            const bidFormatted = this.formatPrice(this.currentBid);
            const askFormatted = this.formatPrice(this.currentAsk);

            panel.innerHTML = `
                <!-- 1. Header Bar (Drag handle in floating mode) -->
                <div id="tv-panel-drag-header" style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px 14px;
                    border-bottom: 1px solid ${theme.border};
                    cursor: ${isDocked ? 'default' : 'move'};
                ">
                    <!-- Left: Symbol Badge & Title -->
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
                        <span id="tv-side-panel-symbol" style="font-size: 13.5px; font-weight: 700; color: ${theme.text};">${this.currentSymbol}</span>
                    </div>

                    <!-- Right Controls: Dock/Undock, DOM, Settings, Close -->
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
                        <button id="tv-panel-btn-close" type="button" title="Close Panel" style="
                            background: transparent; border: none; color: ${theme.textMuted}; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center;
                        ">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 6L6 18M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- 2. Subtabs: Order | DOM -->
                <div style="
                    display: flex;
                    margin: 10px 14px 6px;
                    background: ${theme.subtabBg};
                    border-radius: 6px;
                    padding: 2px;
                ">
                    <button id="tv-subtab-order" type="button" style="
                        flex: 1;
                        padding: 5px 0;
                        border: none;
                        border-radius: 4px;
                        background: ${this.selectedTab === 'order' ? theme.panelBg : 'transparent'};
                        color: ${this.selectedTab === 'order' ? theme.text : theme.textMuted};
                        font-weight: ${this.selectedTab === 'order' ? '700' : '500'};
                        font-size: 12px;
                        cursor: pointer;
                        box-shadow: ${this.selectedTab === 'order' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'};
                    ">Order</button>
                    <button id="tv-subtab-dom" type="button" style="
                        flex: 1;
                        padding: 5px 0;
                        border: none;
                        border-radius: 4px;
                        background: ${this.selectedTab === 'dom' ? theme.panelBg : 'transparent'};
                        color: ${this.selectedTab === 'dom' ? theme.text : theme.textMuted};
                        font-weight: ${this.selectedTab === 'dom' ? '700' : '500'};
                        font-size: 12px;
                        cursor: pointer;
                        box-shadow: ${this.selectedTab === 'dom' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'};
                    ">DOM</button>
                </div>

                <!-- Main Scrollable Body -->
                <div id="tv-panel-content-body" style="flex: 1; overflow-y: auto; padding: 6px 14px 14px; display: flex; flex-direction: column; gap: 12px;">
                    ${this.selectedTab === 'order' ? this.getOrderTabHtml(theme, isBuy, spreadPoints, bidFormatted, askFormatted) : this.getDomTabHtml(theme)}
                </div>

                <!-- 3. Bottom Execution Button (Order Tab Only) -->
                ${this.selectedTab === 'order' ? `
                <div style="padding: 10px 14px 14px; border-top: 1px solid ${theme.border}; background: ${theme.panelBg};">
                    <button id="tv-ticket-btn-execute" type="button" style="
                        width: 100%;
                        background: ${isBuy ? '#2962ff' : '#f23645'};
                        color: #ffffff;
                        border: none;
                        border-radius: 8px;
                        height: 44px;
                        cursor: pointer;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        outline: none;
                        transition: opacity 0.15s;
                    ">
                        <span style="font-size: 14px; font-weight: 700; line-height: 1.2;">${isBuy ? 'Buy' : 'Sell'}</span>
                        <span id="tv-ticket-btn-summary-text" style="font-size: 11px; font-weight: 600; opacity: 0.95; line-height: 1.2;">
                            ${this.lots} ${this.currentSymbol} ${this.orderType.toUpperCase()}
                        </span>
                    </button>
                </div>
                ` : ''}
            `;

            this.bindSidePanelEvents(panel);

            if (!isDocked) {
                this.makeDraggable(panel, panel.querySelector('#tv-panel-drag-header'), (top, left) => {
                    this.saveFloatingPos(top, left);
                });
            }
        }

        getOrderTabHtml(theme, isBuy, spreadPoints, bidFormatted, askFormatted) {
            return `
                <!-- A. Split Bid / Ask Segmented Pill -->
                <div style="
                    display: flex;
                    position: relative;
                    border-radius: 8px;
                    overflow: hidden;
                    border: 1px solid ${theme.border};
                    height: 46px;
                    cursor: pointer;
                ">
                    <!-- Sell Half -->
                    <div id="tv-ticket-split-sell" style="
                        flex: 1;
                        padding: 5px 12px;
                        background: ${!isBuy ? theme.sellActiveBg : theme.unselectedSideBg};
                        color: ${!isBuy ? '#f23645' : theme.text};
                        border-right: 1px solid ${theme.border};
                        transition: background 0.15s;
                    ">
                        <div style="font-size: 11px; font-weight: 700;">Sell</div>
                        <div id="tv-ticket-bid-val" style="font-size: 14px; font-weight: 600; margin-top: 1px;">${bidFormatted}</div>
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
                        font-size: 10.5px;
                        font-weight: 600;
                        color: ${theme.text};
                        box-shadow: 0 1px 2px rgba(0,0,0,0.06);
                        z-index: 2;
                    ">${spreadPoints}</div>

                    <!-- Buy Half -->
                    <div id="tv-ticket-split-buy" style="
                        flex: 1;
                        padding: 5px 12px;
                        text-align: right;
                        background: ${isBuy ? theme.buyActiveBg : theme.unselectedSideBg};
                        color: ${isBuy ? '#2962ff' : theme.text};
                        transition: background 0.15s;
                    ">
                        <div style="font-size: 11px; font-weight: 700;">Buy</div>
                        <div id="tv-ticket-ask-val" style="font-size: 14px; font-weight: 600; margin-top: 1px;">${askFormatted}</div>
                    </div>
                </div>

                <!-- B. Order Type Tabs (Market, Limit, Stop) -->
                <div style="
                    display: flex;
                    align-items: center;
                    border-bottom: 1px solid ${theme.border};
                    margin-top: 2px;
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
                                font-weight: ${active ? '600' : '500'};
                                padding: 7px 0;
                                cursor: pointer;
                                text-transform: capitalize;
                            ">${t}</button>
                        `;
                    }).join('')}
                </div>

                <!-- Price input if Limit or Stop -->
                ${this.orderType !== 'market' ? `
                <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 2px;">
                    <label style="font-size: 11px; color: ${theme.textMuted}; font-weight: 600;">
                        ${this.orderType === 'limit' ? 'Limit Price' : 'Stop Price'}
                    </label>
                    <input type="number" id="tv-ticket-price-in" step="0.01" value="${this.formatPrice(this.selectedSide === 'BUY' ? this.currentAsk : this.currentBid)}" style="
                        width: 100%;
                        padding: 6px 10px;
                        background: ${theme.inputBg};
                        color: ${theme.text};
                        border: 1px solid #2962ff;
                        border-radius: 6px;
                        font-size: 13px;
                        font-weight: 600;
                        outline: none;
                        box-sizing: border-box;
                    ">
                </div>
                ` : ''}

                <!-- C. Units / Lots Selector (with blue border accent matching SS) -->
                <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 2px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 11px; color: ${theme.textMuted}; font-weight: 500;">Units ⌵</span>
                    </div>
                    <div style="
                        display: flex;
                        align-items: center;
                        background: ${theme.inputBg};
                        border: 1px solid #2962ff;
                        border-radius: 6px;
                        padding: 3px 10px;
                    ">
                        <input type="number" id="tv-ticket-units-in" step="0.01" min="0.01" value="${this.lots}" style="
                            flex: 1;
                            background: transparent;
                            border: none;
                            color: ${theme.text};
                            font-size: 13px;
                            font-weight: 600;
                            outline: none;
                            padding: 4px 0;
                        ">
                        <span style="color: ${theme.textMuted}; margin: 0 6px; font-size: 12px;">⇄</span>
                        <span id="tv-ticket-usd-val" style="font-size: 11.5px; font-weight: 500; color: ${theme.textMuted};">
                            ${this.calculateTradeValueUSD()} USD ⌵
                        </span>
                    </div>
                </div>

                <!-- D. Financial Summary Card -->
                <div style="
                    background: ${theme.cardBg};
                    border-radius: 6px;
                    padding: 10px 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    font-size: 11px;
                ">
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: ${theme.textMuted};">Trade value (50x)</span>
                        <strong id="tv-val-trade-summary" style="font-weight: 600; color: ${theme.text};">${this.calculateTradeValueUSD()} USD</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: ${theme.textMuted};">Available margin</span>
                        <strong id="tv-val-avail-margin" style="font-weight: 600; color: ${theme.text};">${this.getAvailableMarginFormatted()} USD</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: ${theme.textMuted};">Tick value</span>
                        <strong style="font-weight: 600; color: ${theme.text};">0.001 USD</strong>
                    </div>
                </div>

                <!-- E. Exits Accordion (Take Profit & Stop Loss) -->
                <div style="border-top: 1px solid ${theme.border}; padding-top: 10px; display: flex; flex-direction: column; gap: 8px;">
                    <!-- Accordion Header -->
                    <div id="tv-ticket-exits-toggle" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                        <span style="font-size: 12.5px; font-weight: 700; color: ${theme.text};">Exits</span>
                        <span style="color: ${theme.textMuted}; font-size: 11px;">${this.isExitsExpanded ? '⌃' : '⌵'}</span>
                    </div>

                    ${this.isExitsExpanded ? `
                        <!-- Take Profit -->
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-size: 11.5px; color: ${theme.text}; font-weight: 500;">Take profit price ⌵</span>
                                <label class="tv-toggle-switch">
                                    <input type="checkbox" id="tv-ticket-check-tp" ${this.isTpEnabled ? 'checked' : ''}>
                                    <span class="tv-toggle-slider"></span>
                                </label>
                            </div>
                            <div style="
                                display: flex;
                                align-items: center;
                                background: ${theme.inputBg};
                                border: 1px solid ${this.isTpEnabled ? '#2962ff' : theme.border};
                                border-radius: 6px;
                                padding: 2px 8px;
                            ">
                                <input type="number" id="tv-ticket-tp-price-in" step="0.01" value="${this.calculateExitPrice('tp')}" ${!this.isTpEnabled ? 'disabled' : ''} style="
                                    flex: 1;
                                    background: transparent;
                                    border: none;
                                    color: ${this.isTpEnabled ? theme.text : '#b2b5be'};
                                    font-size: 12px;
                                    font-weight: 500;
                                    outline: none;
                                    padding: 5px 0;
                                ">
                                <span style="color: ${theme.textMuted}; margin: 0 4px; font-size: 12px;">⇄</span>
                                <input type="number" id="tv-ticket-tp-ticks-in" value="${this.tpTicks}" ${!this.isTpEnabled ? 'disabled' : ''} style="
                                    width: 45px;
                                    background: transparent;
                                    border: none;
                                    color: ${this.isTpEnabled ? theme.text : '#b2b5be'};
                                    font-size: 11px;
                                    font-weight: 500;
                                    text-align: right;
                                    outline: none;
                                ">
                                <span style="color: ${theme.textMuted}; font-size: 10px; margin-left: 2px;">ticks ⌵</span>
                            </div>
                        </div>

                        <!-- Stop Loss -->
                        <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-size: 11.5px; color: ${theme.text}; font-weight: 500;">Stop loss price ⌵</span>
                                <label class="tv-toggle-switch">
                                    <input type="checkbox" id="tv-ticket-check-sl" ${this.isSlEnabled ? 'checked' : ''}>
                                    <span class="tv-toggle-slider"></span>
                                </label>
                            </div>
                            <div style="
                                display: flex;
                                align-items: center;
                                background: ${theme.inputBg};
                                border: 1px solid ${this.isSlEnabled ? '#2962ff' : theme.border};
                                border-radius: 6px;
                                padding: 2px 8px;
                            ">
                                <input type="number" id="tv-ticket-sl-price-in" step="0.01" value="${this.calculateExitPrice('sl')}" ${!this.isSlEnabled ? 'disabled' : ''} style="
                                    flex: 1;
                                    background: transparent;
                                    border: none;
                                    color: ${this.isSlEnabled ? theme.text : '#b2b5be'};
                                    font-size: 12px;
                                    font-weight: 500;
                                    outline: none;
                                    padding: 5px 0;
                                ">
                                <span style="color: ${theme.textMuted}; margin: 0 4px; font-size: 12px;">⇄</span>
                                <input type="number" id="tv-ticket-sl-ticks-in" value="${this.slTicks}" ${!this.isSlEnabled ? 'disabled' : ''} style="
                                    width: 45px;
                                    background: transparent;
                                    border: none;
                                    color: ${this.isSlEnabled ? theme.text : '#b2b5be'};
                                    font-size: 11px;
                                    font-weight: 500;
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
                    <span>1-Click: ${this.settings.oneClickTrading ? 'ON' : 'OFF'}</span>
                </div>
                <div style="
                    border: 1px solid ${theme.border};
                    border-radius: 6px;
                    overflow: hidden;
                    font-size: 11.5px;
                ">
                    <div style="display: grid; grid-template-columns: 1fr 1.2fr 1fr; background: ${theme.cardBg}; padding: 6px 8px; font-weight: 600; border-bottom: 1px solid ${theme.border};">
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
                            <span style="text-align: center; font-weight: 600; color: ${theme.text};">${r.price}</span>
                            <span style="text-align: right; color: #f23645; font-weight: 600;">${r.isAskSide ? r.vol : ''}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        bindSidePanelEvents(panel) {
            const btnClose = panel.querySelector('#tv-panel-btn-close');
            const btnDockToggle = panel.querySelector('#tv-panel-btn-dock-toggle');
            const btnDomToggle = panel.querySelector('#tv-panel-btn-dom-toggle');
            const btnSettings = panel.querySelector('#tv-panel-btn-settings');
            const subtabOrder = panel.querySelector('#tv-subtab-order');
            const subtabDom = panel.querySelector('#tv-subtab-dom');

            if (btnClose) btnClose.onclick = () => this.closeOrderTicket();

            if (btnDockToggle) {
                btnDockToggle.onclick = () => {
                    this.dockMode = this.dockMode === 'docked' ? 'floating' : 'docked';
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
            this.updateToolbarBtnState();
        }

        closeOrderTicket() {
            this.isPanelOpen = false;
            const panel = document.getElementById(this.sidePanelId);
            if (panel) panel.style.display = 'none';
            this.updateChartContainerLayout();
            this.updateToolbarBtnState();
        }

        // ==========================================
        // 4. CHART RESIZE & CANVAS SHIFT (Image 3)
        // ==========================================
        updateChartContainerLayout() {
            const chartCont = document.getElementById('tv_chart_container');
            if (!chartCont) return;

            const isDocked = this.dockMode === 'docked';
            const isDockRight = this.dockSide === 'right';

            if (this.isPanelOpen && isDocked) {
                chartCont.style.width = 'calc(100% - 320px)';
                if (isDockRight) {
                    chartCont.style.marginLeft = '0';
                    chartCont.style.left = '0';
                    chartCont.style.right = 'auto';
                } else {
                    chartCont.style.marginLeft = '320px';
                    chartCont.style.left = '0';
                    chartCont.style.right = 'auto';
                }
            } else {
                chartCont.style.width = '100%';
                chartCont.style.marginLeft = '0';
                chartCont.style.left = '0';
                chartCont.style.right = '0';
            }

            window.dispatchEvent(new Event('resize'));
            setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
            setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
        }

        // ==========================================
        // 5. TRADING SETTINGS MODAL (Images 3 & 4)
        // ==========================================
        openTradingSettingsModal() {
            let modal = document.getElementById(this.settingsModalId);
            if (!modal) {
                modal = document.createElement('div');
                modal.id = this.settingsModalId;
                modal.style.cssText = `
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0, 0, 0, 0.45);
                    backdrop-filter: blur(3px);
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
                    box-shadow: 0 16px 40px rgba(0,0,0,0.25);
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
                                <span style="font-weight: 600; color: ${theme.text};">Panel mode & alignment</span>
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
                                    <option value="docked-right" ${this.dockMode === 'docked' && this.dockSide === 'right' ? 'selected' : ''}>Right (Docked)</option>
                                    <option value="docked-left" ${this.dockMode === 'docked' && this.dockSide === 'left' ? 'selected' : ''}>Left (Docked)</option>
                                    <option value="floating" ${this.dockMode === 'floating' ? 'selected' : ''}>Floating (Undocked)</option>
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

                    const dockVal = selectDock ? selectDock.value : 'docked-right';
                    if (dockVal === 'floating') {
                        this.dockMode = 'floating';
                    } else if (dockVal === 'docked-left') {
                        this.dockMode = 'docked';
                        this.dockSide = 'left';
                    } else {
                        this.dockMode = 'docked';
                        this.dockSide = 'right';
                    }

                    this.saveSettings();
                    closeMe();
                    this.renderOnChartWidget();
                    if (this.isPanelOpen) {
                        this.renderSidePanel();
                    }
                };
            }
        }

        // ==========================================
        // 6. DRAG HELPER (For floating panel)
        // ==========================================
        makeDraggable(element, handle, onSave) {
            if (!handle) return;
            let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
            let hasDragged = false;

            handle.onmousedown = (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                    return;
                }
                e.preventDefault();
                hasDragged = false;
                pos3 = e.clientX;
                pos4 = e.clientY;

                document.onmouseup = () => {
                    document.onmouseup = null;
                    document.onmousemove = null;
                    if (hasDragged && onSave) {
                        onSave(element.style.top, element.style.left);
                    }
                };

                document.onmousemove = (e2) => {
                    e2.preventDefault();
                    hasDragged = true;
                    pos1 = pos3 - e2.clientX;
                    pos2 = pos4 - e2.clientY;
                    pos3 = e2.clientX;
                    pos4 = e2.clientY;

                    const newTop = Math.max(10, element.offsetTop - pos2);
                    const newLeft = Math.max(10, Math.min(window.innerWidth - element.offsetWidth - 10, element.offsetLeft - pos1));

                    element.style.top = newTop + "px";
                    element.style.left = newLeft + "px";
                    element.style.right = "auto";
                    element.style.bottom = "auto";
                };
            };
        }

        // ==========================================
        // 7. PRICE & CALCULATIONS HELPERS
        // ==========================================
        updatePrices() {
            this.syncPricesWithChart();

            // Update side panel
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
            if (window.MT5API) {
                const acc = window.MT5API.getActiveAccount();
                if (acc && acc.margin_free != null) {
                    return Number(acc.margin_free).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                }
                if (acc && acc.balance != null) {
                    return Number(acc.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    }

    // Inject styles for toggle switches
    const styleEl = document.createElement('style');
    styleEl.innerHTML = `
        /* iOS-style toggle switches */
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
    document.head.appendChild(styleEl);

    // Export singleton
    window.TradeUI = new TradeUI();

})(window);
