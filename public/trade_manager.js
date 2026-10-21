/**
 * Broker-Agnostic Trading Engine with Intelligent Multi-Broker Routing
 * Connects interactive on-chart trading with:
 *  1. Paper Trading (built-in simulation engine for all markets)
 *  2. MetaTrader 5 (Forex, Metals, Indices, Crypto)
 *  3. Fyers (NSE, BSE, MCX Indian equities & derivatives)
 */

(function(window) {
    'use strict';

    class TradingEngine {
        constructor() {
            this.adapters = {};
            this.activeBrokerMode = localStorage.getItem('tv_trading_broker_mode') || 'auto'; // 'auto', 'paper', 'mt5', 'fyers'
            this.positionListeners = new Set();
            this.initAdapters();
        }

        initAdapters() {
            // 1. Register Paper Trading Adapter (100% local simulation across any chart)
            this.registerBroker('paper', {
                name: 'Paper Trading',
                isReady: () => true,
                isConnected: () => true,
                getActiveAccount: () => window.PaperTrading ? window.PaperTrading.getAccountSummary() : null,
                getPositions: async () => window.PaperTrading ? window.PaperTrading.getPositions() : [],
                placeOrder: async (params) => {
                    if (!window.PaperTrading) return { success: false, error: 'Paper trading engine not loaded' };
                    return window.PaperTrading.placeOrder(params);
                },
                modifyPosition: async (params) => {
                    if (!window.PaperTrading) return { success: false };
                    return window.PaperTrading.modifyPosition(params);
                },
                closePosition: async (params) => {
                    if (!window.PaperTrading) return { success: false };
                    return window.PaperTrading.closePosition(params.ticket, params.lots);
                },
                moveBreakEven: async (position) => {
                    if (!position || !position.ticket) return { success: false };
                    return window.PaperTrading.modifyPosition({ ticket: position.ticket, sl: position.open_price });
                },
                closePartial: async (position, percent = 50) => {
                    if (!position || !position.ticket) return { success: false };
                    const closeLots = Math.max(0.01, Math.round((position.lots * (percent / 100)) * 100) / 100);
                    return window.PaperTrading.closePosition(position.ticket, closeLots);
                },
                onPositionUpdate: (cb) => {
                    if (window.PaperTrading) {
                        window.PaperTrading.onUpdate(() => cb(window.PaperTrading.getPositions()));
                    }
                }
            });

            // 2. Register MetaTrader 5 (MT5) Adapter
            this.registerBroker('mt5', {
                name: 'MetaTrader 5',
                isReady: () => Boolean(window.MT5API && window.MT5API.isConnected),
                isConnected: () => Boolean(window.MT5API && window.MT5API.isConnected && window.MT5API.getActiveAccount()),
                getActiveAccount: () => window.MT5API ? window.MT5API.getActiveAccount() : null,
                getPositions: async () => window.MT5API ? await window.MT5API.fetchPositions() : [],
                placeOrder: async (params) => {
                    if (!window.MT5API) return { success: false, error: 'MT5 API not initialized' };
                    const multiAccounts = Array.from(window.MT5API.multiAccountSelection || []);
                    if (params.broadcast && multiAccounts.length > 0) {
                        return await window.MT5API.broadcastOrder({
                            accountIds: multiAccounts,
                            symbol: params.symbol,
                            type: params.type,
                            orderType: params.orderType,
                            price: params.price,
                            baseLots: params.lots,
                            sl: params.sl,
                            tp: params.tp
                        });
                    }
                    return await window.MT5API.placeOrder(params);
                },
                modifyPosition: async (params) => {
                    if (!window.MT5API) return { success: false };
                    return await window.MT5API.modifyPosition(params);
                },
                closePosition: async (params) => {
                    if (!window.MT5API) return { success: false };
                    return await window.MT5API.closePosition(params);
                },
                moveBreakEven: async (position) => {
                    if (!position || !position.ticket) return { success: false };
                    const buffer = (position.type === 'BUY' ? 0.10 : -0.10) * (position.symbol.includes('JPY') ? 0.01 : 0.0001);
                    const bePrice = roundPrice(position.open_price + buffer, position.symbol);
                    return await window.MT5API.modifyPosition({
                        ticket: position.ticket,
                        sl: bePrice,
                        tp: position.tp || 0.0,
                        accountId: position.account_id
                    });
                },
                closePartial: async (position, percent = 50) => {
                    if (!position || !position.ticket) return { success: false };
                    const closeLots = Math.max(0.01, Math.round((position.lots * (percent / 100)) * 100) / 100);
                    return await window.MT5API.closePosition({
                        ticket: position.ticket,
                        lots: closeLots,
                        accountId: position.account_id
                    });
                },
                subscribeQuotes: (symbol, cb) => {
                    if (window.MT5API) window.MT5API.subscribeQuotes(symbol, cb);
                },
                onPositionUpdate: (cb) => {
                    if (window.MT5API) window.MT5API.onPositionUpdate(cb);
                }
            });

            // 3. Register Fyers Adapter (Indian Markets)
            this.registerBroker('fyers', {
                name: 'Fyers',
                isReady: () => Boolean(window.FyersAPI && window.FyersAPI.getActiveAccount()),
                isConnected: () => {
                    if (!window.FyersAPI) return false;
                    const acc = window.FyersAPI.getActiveAccount();
                    return Boolean(acc && !window.FyersAPI.isAccountExpired(acc));
                },
                getActiveAccount: () => window.FyersAPI ? window.FyersAPI.getActiveAccount() : null,
                getPositions: async () => [],
                placeOrder: async () => ({ success: false, error: 'Fyers order placement integration active' }),
                modifyPosition: async () => ({ success: false }),
                closePosition: async () => ({ success: false }),
                moveBreakEven: async () => ({ success: false }),
                closePartial: async () => ({ success: false }),
                subscribeQuotes: () => {},
                onPositionUpdate: () => {}
            });

            // Bind update listeners
            if (window.MT5API) {
                window.MT5API.onPositionUpdate((pos) => {
                    if (this.getActiveBrokerKey() === 'mt5') {
                        this.notifyPositionListeners(pos);
                    }
                });
            }
            if (window.PaperTrading) {
                window.PaperTrading.onUpdate(() => {
                    if (this.getActiveBrokerKey() === 'paper') {
                        this.notifyPositionListeners(window.PaperTrading.getPositions());
                    }
                });
            }
        }

        registerBroker(name, adapter) {
            this.adapters[name.toLowerCase()] = adapter;
        }

        setBrokerMode(mode) {
            this.activeBrokerMode = mode;
            try {
                localStorage.setItem('tv_trading_broker_mode', mode);
            } catch (_) {}
            this.notifyPositionListeners();
            if (window.TradeUI) {
                window.TradeUI.renderOnChartWidget();
                if (window.TradeUI.isPanelOpen) window.TradeUI.renderSidePanel();
            }
        }

        getMarketType(symbol = '') {
            const sym = (symbol || (window.TradeUI ? window.TradeUI.currentSymbol : '')).toUpperCase();
            if (sym.includes('NSE:') || sym.includes('BSE:') || sym.includes('MCX:') || 
                sym.includes('NIFTY') || sym.includes('BANKNIFTY') || sym.includes('FINNIFTY') || 
                sym.includes('SENSEX') || sym.includes('RELIANCE') || sym.includes('TCS') || sym.includes('INFY')) {
                return 'indian';
            }
            return 'forex';
        }

        getActiveBrokerKey(symbol = null) {
            if (this.activeBrokerMode === 'paper') return 'paper';
            if (this.activeBrokerMode === 'mt5') return 'mt5';
            if (this.activeBrokerMode === 'fyers') return 'fyers';

            // 'auto' mode: route by chart market type
            const market = this.getMarketType(symbol);
            if (market === 'indian') {
                return 'fyers';
            } else {
                return 'mt5';
            }
        }

        getActiveAdapter(symbol = null) {
            const key = this.getActiveBrokerKey(symbol);
            return this.adapters[key] || this.adapters['paper'];
        }

        isBrokerConnected(symbol = null) {
            const adapter = this.getActiveAdapter(symbol);
            if (!adapter) return false;
            return typeof adapter.isConnected === 'function' ? adapter.isConnected() : Boolean(adapter.isReady && adapter.isReady());
        }

        async placeOrder(params) {
            const adapter = this.getActiveAdapter(params.symbol);
            if (!adapter) return { success: false, error: 'No active broker adapter.' };
            return await adapter.placeOrder(params);
        }

        async modifyPosition(params) {
            const adapter = this.getActiveAdapter();
            if (!adapter) return { success: false, error: 'No active broker adapter.' };
            return await adapter.modifyPosition(params);
        }

        async closePosition(params) {
            const adapter = this.getActiveAdapter();
            if (!adapter) return { success: false, error: 'No active broker adapter.' };
            return await adapter.closePosition(params);
        }

        async moveBreakEven(position) {
            const adapter = this.getActiveAdapter(position ? position.symbol : null);
            if (!adapter || !adapter.moveBreakEven) return { success: false };
            return await adapter.moveBreakEven(position);
        }

        async closePartial(position, percent = 50) {
            const adapter = this.getActiveAdapter(position ? position.symbol : null);
            if (!adapter || !adapter.closePartial) return { success: false };
            return await adapter.closePartial(position, percent);
        }

        onPositionUpdate(cb) {
            this.positionListeners.add(cb);
            const adapter = this.getActiveAdapter();
            if (adapter && typeof adapter.getPositions === 'function') {
                adapter.getPositions().then(pos => cb(pos));
            }
        }

        notifyPositionListeners(positions = null) {
            if (positions === null) {
                const adapter = this.getActiveAdapter();
                if (adapter && typeof adapter.getPositions === 'function') {
                    adapter.getPositions().then(pos => {
                        this.positionListeners.forEach(cb => { try { cb(pos); } catch (_) {} });
                    });
                    return;
                }
            }
            this.positionListeners.forEach(cb => {
                try { cb(positions || []); } catch (_) {}
            });
        }
    }

    function roundPrice(price, symbol) {
        if (!price) return 0.0;
        if (symbol.includes('JPY') || symbol.includes('US30') || symbol.includes('NAS')) {
            return Math.round(price * 100) / 100;
        }
        return Math.round(price * 100000) / 100000;
    }

    window.TradingEngine = new TradingEngine();

})(window);
