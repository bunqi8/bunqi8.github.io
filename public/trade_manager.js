/**
 * Broker-Agnostic Trading Engine
 * Modular abstraction layer connecting interactive on-chart trading with any broker
 * (MetaTrader 5 now, Fyers or others in the future).
 */

(function(window) {
    'use strict';

    class TradingEngine {
        constructor() {
            this.adapters = {};
            this.activeBrokerName = 'mt5';
            this.positionListeners = new Set();
            this.tickListeners = new Set();
            this.initAdapters();
        }

        initAdapters() {
            // Register MT5 Adapter
            this.registerBroker('mt5', {
                name: 'MetaTrader 5',
                isReady: () => Boolean(window.MT5API && window.MT5API.isConnected),
                getActiveAccount: () => window.MT5API ? window.MT5API.getActiveAccount() : null,
                getPositions: async () => window.MT5API ? await window.MT5API.fetchPositions() : [],
                placeOrder: async (params) => {
                    if (!window.MT5API) return { success: false, error: 'MT5 API not initialized' };
                    // If multi-account broadcast is enabled
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
                subscribeQuotes: (symbol, cb) => {
                    if (window.MT5API) window.MT5API.subscribeQuotes(symbol, cb);
                },
                onPositionUpdate: (cb) => {
                    if (window.MT5API) window.MT5API.onPositionUpdate(cb);
                }
            });

            // Register Fyers Adapter placeholder (ready for activation anytime)
            this.registerBroker('fyers', {
                name: 'Fyers',
                isReady: () => Boolean(window.FyersAPI && window.FyersAPI.getActiveAccount()),
                getActiveAccount: () => window.FyersAPI ? window.FyersAPI.getActiveAccount() : null,
                getPositions: async () => [],
                placeOrder: async () => ({ success: false, error: 'Fyers order placement not yet mapped' }),
                modifyPosition: async () => ({ success: false }),
                closePosition: async () => ({ success: false }),
                subscribeQuotes: () => {},
                onPositionUpdate: () => {}
            });

            // Auto-bind MT5 position updates
            if (window.MT5API) {
                window.MT5API.onPositionUpdate((positions) => {
                    if (this.activeBrokerName === 'mt5') {
                        this.notifyPositionListeners(positions);
                    }
                });
            }
        }

        registerBroker(name, adapter) {
            this.adapters[name.toLowerCase()] = adapter;
        }

        setBroker(name) {
            const key = name.toLowerCase();
            if (this.adapters[key]) {
                this.activeBrokerName = key;
                return true;
            }
            return false;
        }

        getAdapter() {
            return this.adapters[this.activeBrokerName] || null;
        }

        async placeOrder({ symbol, type, lots, orderType = 'market', price = 0.0, sl = 0.0, tp = 0.0, broadcast = false }) {
            const adapter = this.getAdapter();
            if (!adapter) return { success: false, error: 'No active broker adapter.' };
            return await adapter.placeOrder({ symbol, type, lots, orderType, price, sl, tp, broadcast });
        }

        async modifyPosition({ ticket, sl, tp, accountId = null }) {
            const adapter = this.getAdapter();
            if (!adapter) return { success: false, error: 'No active broker adapter.' };
            return await adapter.modifyPosition({ ticket, sl, tp, accountId });
        }

        async closePosition({ ticket, lots = null, accountId = null }) {
            const adapter = this.getAdapter();
            if (!adapter) return { success: false, error: 'No active broker adapter.' };
            return await adapter.closePosition({ ticket, lots, accountId });
        }

        async moveBreakEven(position) {
            if (!position || !position.ticket) return { success: false };
            // Move SL to open_price plus tiny buffer
            const buffer = (position.type === 'BUY' ? 0.10 : -0.10) * (position.symbol.includes('JPY') ? 0.01 : 0.0001);
            const bePrice = roundPrice(position.open_price + buffer, position.symbol);
            return await this.modifyPosition({
                ticket: position.ticket,
                sl: bePrice,
                tp: position.tp || 0.0,
                accountId: position.account_id
            });
        }

        async closePartial(position, percent = 50) {
            if (!position || !position.ticket) return { success: false };
            const closeLots = Math.max(0.01, Math.round((position.lots * (percent / 100)) * 100) / 100);
            return await this.closePosition({
                ticket: position.ticket,
                lots: closeLots,
                accountId: position.account_id
            });
        }

        onPositionUpdate(cb) {
            this.positionListeners.add(cb);
            const adapter = this.getAdapter();
            if (adapter && typeof adapter.getPositions === 'function') {
                adapter.getPositions().then(pos => cb(pos));
            }
        }

        notifyPositionListeners(positions) {
            this.positionListeners.forEach(cb => {
                try { cb(positions); } catch (_) {}
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
