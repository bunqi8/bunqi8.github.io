/**
 * Interactive On-Chart Trading Suite for TradingView
 * Renders quick Buy/Sell bar, visual position levels, and draggable SL/TP lines.
 * Designed broker-agnostic — works with MT5, Fyers, and future brokers.
 */

(function(window) {
    'use strict';

    class TradeUI {
        constructor() {
            this.containerId = 'tv-onchart-trade-suite-container';
            this.widgetId = 'tv-onchart-quick-trade-bar';
            this.positionsOverlayId = 'tv-onchart-positions-overlay';

            this.defaultLots = 1.0;
            this.defaultSlPips = 20;
            this.defaultTpPips = 40;
            this.isSlEnabled = false;
            this.isTpEnabled = false;
            this.broadcastMode = false;

            this.currentSymbol = 'EURUSD';
            this.currentBid = 1.0850;
            this.currentAsk = 1.0852;
            this.positions = [];

            this.isDragging = false;
            this.dragTarget = null; // { type: 'sl' | 'tp', position, element }

            this.init();
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

            // Bind to live ticks
            if (window.MT5API) {
                window.MT5API.subscribeQuotes(this.currentSymbol, (tick) => {
                    this.currentBid = tick.bid;
                    this.currentAsk = tick.ask;
                    this.updatePrices();
                });
            }

            // Sync with current chart symbol changes if available
            setInterval(() => this.detectSymbolChange(), 1500);
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
                                    this.currentBid = t.bid;
                                    this.currentAsk = t.ask;
                                    this.updatePrices();
                                });
                            }
                            this.updatePrices();
                        }
                    }
                }
            } catch (_) {}
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

            this.renderQuickTradeBar(container);
            this.renderPositionsOverlay(container);
        }

        renderQuickTradeBar(container) {
            let bar = document.getElementById(this.widgetId);
            if (!bar) {
                bar = document.createElement('div');
                bar.id = this.widgetId;
                bar.style.cssText = `
                    position: absolute;
                    top: 55px;
                    left: 20px;
                    pointer-events: auto;
                    background: rgba(30, 34, 45, 0.92);
                    backdrop-filter: blur(8px);
                    border: 1px solid rgba(255, 255, 255, 0.12);
                    border-radius: 8px;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
                    padding: 8px 12px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    color: #fff;
                    font-size: 12px;
                    user-select: none;
                    z-index: 60;
                `;
                container.appendChild(bar);
            }

            const multiCount = window.MT5API ? window.MT5API.multiAccountSelection.size : 0;
            const isBroadcast = multiCount > 1;

            bar.innerHTML = `
                <!-- SELL BUTTON -->
                <button id="tv-btn-chart-sell" type="button" style="
                    background: #f23645; color: #fff; border: none; padding: 7px 14px;
                    border-radius: 6px; font-weight: 700; font-size: 13px; cursor: pointer;
                    display: flex; flex-direction: column; align-items: center; min-width: 82px;
                    transition: transform 0.1s;
                ">
                    <span style="font-size: 11px; opacity: 0.85;">SELL</span>
                    <span id="tv-val-bid">${this.currentBid}</span>
                </button>

                <!-- LOT SIZE -->
                <div style="display: flex; flex-direction: column; align-items: center; gap: 3px;">
                    <div style="font-size: 10px; color: #787b86; font-weight: 600;">LOTS</div>
                    <input type="number" id="tv-in-chart-lots" step="0.01" min="0.01" value="${this.defaultLots}" style="
                        width: 60px; padding: 4px 6px; background: #131722; color: #fff;
                        border: 1px solid #363c4e; border-radius: 4px; font-weight: 700;
                        text-align: center; font-size: 13px; outline: none;
                    ">
                </div>

                <!-- BUY BUTTON -->
                <button id="tv-btn-chart-buy" type="button" style="
                    background: #089981; color: #fff; border: none; padding: 7px 14px;
                    border-radius: 6px; font-weight: 700; font-size: 13px; cursor: pointer;
                    display: flex; flex-direction: column; align-items: center; min-width: 82px;
                    transition: transform 0.1s;
                ">
                    <span style="font-size: 11px; opacity: 0.85;">BUY</span>
                    <span id="tv-val-ask">${this.currentAsk}</span>
                </button>

                <!-- SL & TP Quick Settings -->
                <div style="display: flex; align-items: center; gap: 6px; margin-left: 4px; padding-left: 8px; border-left: 1px solid rgba(255,255,255,0.15);">
                    <label style="display: inline-flex; align-items: center; gap: 3px; font-size: 11px; cursor: pointer;">
                        <input type="checkbox" id="tv-check-chart-sl" ${this.isSlEnabled ? 'checked' : ''} style="cursor: pointer;">
                        <span style="color: #f23645; font-weight: 600;">SL</span>
                        <input type="number" id="tv-in-chart-sl" value="${this.defaultSlPips}" style="width: 38px; padding: 2px 4px; background: #131722; color: #fff; border: 1px solid #363c4e; border-radius: 4px; font-size: 11px; text-align: center;">
                    </label>
                    <label style="display: inline-flex; align-items: center; gap: 3px; font-size: 11px; cursor: pointer;">
                        <input type="checkbox" id="tv-check-chart-tp" ${this.isTpEnabled ? 'checked' : ''} style="cursor: pointer;">
                        <span style="color: #089981; font-weight: 600;">TP</span>
                        <input type="number" id="tv-in-chart-tp" value="${this.defaultTpPips}" style="width: 38px; padding: 2px 4px; background: #131722; color: #fff; border: 1px solid #363c4e; border-radius: 4px; font-size: 11px; text-align: center;">
                    </label>
                </div>

                <!-- Multi-Account Target Indicator -->
                <div style="margin-left: 4px; padding-left: 8px; border-left: 1px solid rgba(255,255,255,0.15);">
                    <span id="tv-badge-trade-target" style="
                        font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 4px;
                        background: ${isBroadcast ? 'rgba(255,152,0,0.18)' : 'rgba(41,98,255,0.18)'};
                        color: ${isBroadcast ? '#ff9800' : '#2962ff'};
                        border: 1px solid ${isBroadcast ? 'rgba(255,152,0,0.35)' : 'rgba(41,98,255,0.35)'};
                        white-space: nowrap;
                    ">
                        ${isBroadcast ? `⚡ Broadcast (${multiCount} Accts)` : (window.MT5API && window.MT5API.getActiveAccount() ? window.MT5API.getActiveAccount().nickname : 'MT5')}
                    </span>
                </div>
            `;

            this.bindBarEvents(bar);
        }

        bindBarEvents(bar) {
            const btnBuy = bar.querySelector('#tv-btn-chart-buy');
            const btnSell = bar.querySelector('#tv-btn-chart-sell');
            const inLots = bar.querySelector('#tv-in-chart-lots');
            const checkSl = bar.querySelector('#tv-check-chart-sl');
            const inSl = bar.querySelector('#tv-in-chart-sl');
            const checkTp = bar.querySelector('#tv-check-chart-tp');
            const inTp = bar.querySelector('#tv-in-chart-tp');

            if (checkSl) checkSl.onchange = (e) => this.isSlEnabled = e.target.checked;
            if (checkTp) checkTp.onchange = (e) => this.isTpEnabled = e.target.checked;
            if (inSl) inSl.oninput = (e) => this.defaultSlPips = parseFloat(e.target.value) || 20;
            if (inTp) inTp.oninput = (e) => this.defaultTpPips = parseFloat(e.target.value) || 40;
            if (inLots) inLots.oninput = (e) => this.defaultLots = parseFloat(e.target.value) || 1.0;

            const execute = async (type) => {
                const lots = parseFloat(inLots.value) || 1.0;
                const slPips = checkSl.checked ? (parseFloat(inSl.value) || 20) : 0;
                const tpPips = checkTp.checked ? (parseFloat(inTp.value) || 40) : 0;

                const refPrice = type === 'BUY' ? this.currentAsk : this.currentBid;
                const pipUnit = this.currentSymbol.includes('JPY') ? 0.01 : (this.currentSymbol.includes('XAU') ? 0.10 : (this.currentSymbol.includes('US30') ? 1.0 : 0.0001));

                let slPrice = 0.0;
                let tpPrice = 0.0;
                if (slPips > 0) {
                    slPrice = type === 'BUY' ? (refPrice - slPips * pipUnit) : (refPrice + slPips * pipUnit);
                }
                if (tpPips > 0) {
                    tpPrice = type === 'BUY' ? (refPrice + tpPips * pipUnit) : (refPrice - tpPips * pipUnit);
                }

                const multiCount = window.MT5API ? window.MT5API.multiAccountSelection.size : 0;
                const shouldBroadcast = multiCount > 1;

                const res = await window.TradingEngine.placeOrder({
                    symbol: this.currentSymbol,
                    type,
                    lots,
                    sl: slPrice,
                    tp: tpPrice,
                    broadcast: shouldBroadcast
                });

                if (res.success) {
                    const msg = shouldBroadcast ? `⚡ Broadcast ${type} executed across ${res.total_accounts} accounts!` : `✓ ${type} ${lots} lots executed at ${refPrice}!`;
                    if (window.FyersAPI && window.FyersAPI.showToast) {
                        window.FyersAPI.showToast(msg, 'success');
                    }
                } else {
                    alert(`Trade Execution Failed: ${res.error || 'Check margin or connection'}`);
                }
            };

            if (btnBuy) btnBuy.onclick = () => execute('BUY');
            if (btnSell) btnSell.onclick = () => execute('SELL');
        }

        updatePrices() {
            const bidEl = document.getElementById('tv-val-bid');
            const askEl = document.getElementById('tv-val-ask');
            if (bidEl) bidEl.innerText = this.currentBid;
            if (askEl) askEl.innerText = this.currentAsk;
        }

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

            // Bind position action buttons
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

    // Export singleton
    window.TradeUI = new TradeUI();

})(window);
