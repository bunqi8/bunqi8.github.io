/**
 * Paper Trading Engine for TradingView
 * A fully self-contained, 100% functional local simulation broker.
 * Features:
 *  - Supports ANY chart symbol (NSE, BSE, MCX, Forex, Crypto, Indices).
 *  - Real-time P&L calculation, margin tracking, equity, and balance.
 *  - Market, Limit, and Stop order execution with SL/TP auto-triggers.
 *  - Complete trade history and position management.
 *  - Multi-tab synchronization via localStorage storage events.
 *  - Reset account, clear trade history, and custom balance deposits.
 */

(function(window) {
    'use strict';

    const STORAGE_KEY = 'tv_paper_trading_account_v1';

    class PaperTradingEngine {
        constructor() {
            this.state = this.loadState();
            this.listeners = new Set();
            this.initSync();
        }

        getDefaultState() {
            return {
                currency: 'USD',
                initialBalance: 100000.00,
                balance: 100000.00,
                positions: [], // Active open trades
                orders: [],    // Pending limit / stop orders
                history: [],   // Closed trades
                nextTicket: 100101
            };
        }

        loadState() {
            try {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    return Object.assign(this.getDefaultState(), parsed);
                }
            } catch (_) {}
            return this.getDefaultState();
        }

        saveState() {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
                this.notifyListeners();
            } catch (_) {}
        }

        initSync() {
            // Synchronize state seamlessly across all open browser tabs
            window.addEventListener('storage', (e) => {
                if (e.key === STORAGE_KEY && e.newValue) {
                    try {
                        this.state = JSON.parse(e.newValue);
                        this.notifyListeners();
                    } catch (_) {}
                }
            });
        }

        onUpdate(cb) {
            this.listeners.add(cb);
            cb(this.getAccountSummary());
        }

        notifyListeners() {
            const summary = this.getAccountSummary();
            this.listeners.forEach(cb => {
                try { cb(summary); } catch (_) {}
            });
        }

        getContractSize(symbol) {
            if (symbol.includes('XAU')) return 100;
            if (symbol.includes('US30') || symbol.includes('NAS') || symbol.includes('GER')) return 1;
            if (symbol.includes('NIFTY') || symbol.includes('BANKNIFTY')) return 1;
            if (symbol.includes('BTC') || symbol.includes('ETH')) return 1;
            return 100000; // Standard Forex
        }

        getPipUnit(symbol) {
            if (symbol.includes('JPY')) return 0.01;
            if (symbol.includes('XAU')) return 0.01;
            if (symbol.includes('US30') || symbol.includes('NAS')) return 1.0;
            if (symbol.includes('NIFTY') || symbol.includes('BANKNIFTY')) return 0.05;
            return 0.0001;
        }

        getMarginRate(symbol) {
            if (symbol.includes('XAU') || symbol.includes('EUR') || symbol.includes('GBP')) return 0.01; // 100:1 leverage
            if (symbol.includes('NIFTY')) return 0.10; // 10% margin
            return 0.02; // 50:1 leverage
        }

        getPositions() {
            return this.state.positions || [];
        }

        getOrders() {
            return this.state.orders || [];
        }

        cancelOrder(ticket) {
            const idx = (this.state.orders || []).findIndex(o => o.ticket === ticket);
            if (idx === -1) return { success: false, error: 'Order not found' };
            this.state.orders.splice(idx, 1);
            this.saveState();
            return { success: true };
        }

        getHistory() {
            return this.state.history || [];
        }

        getAccountSummary() {
            let floatingPnl = 0.0;
            let usedMargin = 0.0;

            this.state.positions.forEach(p => {
                floatingPnl += (p.profit || 0);
                usedMargin += (p.margin || 0);
            });

            const equity = this.state.balance + floatingPnl;
            const freeMargin = Math.max(0, equity - usedMargin);
            const marginLevel = usedMargin > 0 ? (equity / usedMargin) * 100 : 0;

            return {
                connected: true,
                brokerName: 'Paper Trading',
                balance: this.state.balance,
                equity: equity,
                floatingPnl: floatingPnl,
                usedMargin: usedMargin,
                freeMargin: freeMargin,
                marginLevel: marginLevel,
                currency: this.state.currency,
                openPositionsCount: this.state.positions.length,
                closedTradesCount: this.state.history.length
            };
        }

        // ==========================================
        // TICK STREAM & P&L UPDATES
        // ==========================================
        onPriceTick(symbol, bid, ask) {
            if (!bid || !ask || isNaN(bid) || isNaN(ask)) return;
            const cleanSym = symbol.split(':').pop().toUpperCase();
            let stateChanged = false;

            // 1. Update floating P&L for open positions and check SL / TP
            const remainingPositions = [];
            for (let i = 0; i < this.state.positions.length; i++) {
                const pos = this.state.positions[i];
                if (pos.symbol.toUpperCase() !== cleanSym) {
                    remainingPositions.push(pos);
                    continue;
                }

                const contractSize = this.getContractSize(pos.symbol);
                const pipUnit = this.getPipUnit(pos.symbol);
                const currentPrice = pos.type === 'BUY' ? bid : ask;
                const diff = pos.type === 'BUY' ? (currentPrice - pos.open_price) : (pos.open_price - currentPrice);

                pos.current_price = currentPrice;
                pos.pips = Math.round((diff / pipUnit) * 10) / 10;
                pos.profit = Math.round((diff * pos.lots * (contractSize > 1 ? contractSize / 1000 : 1)) * 100) / 100;

                // Check Take Profit
                if (pos.tp && pos.tp > 0) {
                    const tpHit = pos.type === 'BUY' ? (bid >= pos.tp) : (ask <= pos.tp);
                    if (tpHit) {
                        this.closePositionInternal(pos, pos.tp, 'Take Profit');
                        stateChanged = true;
                        continue;
                    }
                }

                // Check Stop Loss
                if (pos.sl && pos.sl > 0) {
                    const slHit = pos.type === 'BUY' ? (bid <= pos.sl) : (ask >= pos.sl);
                    if (slHit) {
                        this.closePositionInternal(pos, pos.sl, 'Stop Loss');
                        stateChanged = true;
                        continue;
                    }
                }

                remainingPositions.push(pos);
                stateChanged = true;
            }

            this.state.positions = remainingPositions;

            // 2. Check pending limit & stop orders
            const remainingOrders = [];
            for (let i = 0; i < this.state.orders.length; i++) {
                const order = this.state.orders[i];
                if (order.symbol.toUpperCase() !== cleanSym) {
                    remainingOrders.push(order);
                    continue;
                }

                let triggered = false;
                let fillPrice = order.price;

                if (order.type === 'BUY_LIMIT' && ask <= order.price) {
                    triggered = true;
                    fillPrice = ask;
                } else if (order.type === 'SELL_LIMIT' && bid >= order.price) {
                    triggered = true;
                    fillPrice = bid;
                } else if (order.type === 'BUY_STOP' && ask >= order.price) {
                    triggered = true;
                    fillPrice = ask;
                } else if (order.type === 'SELL_STOP' && bid <= order.price) {
                    triggered = true;
                    fillPrice = bid;
                }

                if (triggered) {
                    this.executeFill({
                        symbol: order.symbol,
                        type: order.type.startsWith('BUY') ? 'BUY' : 'SELL',
                        lots: order.lots,
                        price: fillPrice,
                        sl: order.sl,
                        tp: order.tp,
                        comment: `Order #${order.ticket} Triggered`
                    });
                    stateChanged = true;
                } else {
                    remainingOrders.push(order);
                }
            }

            this.state.orders = remainingOrders;

            if (stateChanged) {
                this.saveState();
            }
        }

        // ==========================================
        // ORDER PLACEMENT & EXECUTION
        // ==========================================
        placeOrder({ symbol, type, orderType = 'market', lots = 1.0, price = 0.0, sl = 0.0, tp = 0.0, comment = "Paper Order" }) {
            const cleanSym = symbol.split(':').pop().toUpperCase();
            const ticket = this.state.nextTicket++;

            if (orderType === 'market') {
                const fillPrice = price > 0 ? price : (type === 'BUY' ? (window.TradeUI ? window.TradeUI.currentAsk : 1.0) : (window.TradeUI ? window.TradeUI.currentBid : 1.0));
                const pos = this.executeFill({
                    ticket,
                    symbol: cleanSym,
                    type: type.toUpperCase(),
                    lots: Number(lots),
                    price: fillPrice,
                    sl: Number(sl) || 0.0,
                    tp: Number(tp) || 0.0,
                    comment
                });
                return { success: true, ticket: pos.ticket, fillPrice };
            } else {
                // Pending Limit or Stop Order
                const pendingType = `${type.toUpperCase()}_${orderType.toUpperCase()}`;
                const order = {
                    ticket,
                    symbol: cleanSym,
                    type: pendingType,
                    lots: Number(lots),
                    price: Number(price),
                    sl: Number(sl) || 0.0,
                    tp: Number(tp) || 0.0,
                    time: new Date().toISOString(),
                    comment
                };
                this.state.orders.push(order);
                this.saveState();
                return { success: true, ticket: order.ticket, pending: true };
            }
        }

        executeFill({ ticket, symbol, type, lots, price, sl, tp, comment }) {
            const contractSize = this.getContractSize(symbol);
            const marginRate = this.getMarginRate(symbol);
            const margin = Math.round((lots * price * (contractSize > 1 ? contractSize / 1000 : 1) * marginRate) * 100) / 100;

            const position = {
                ticket: ticket || this.state.nextTicket++,
                symbol,
                type,
                lots,
                open_price: price,
                current_price: price,
                sl: sl || 0.0,
                tp: tp || 0.0,
                profit: 0.0,
                pips: 0.0,
                margin,
                open_time: new Date().toISOString(),
                comment: comment || 'Paper Trade'
            };

            this.state.positions.unshift(position);
            this.saveState();
            return position;
        }

        closePosition(ticket, closeLots = null) {
            const idx = this.state.positions.findIndex(p => p.ticket === ticket);
            if (idx === -1) return { success: false, error: 'Position not found' };

            const pos = this.state.positions[idx];
            const currentPrice = pos.current_price || pos.open_price;

            if (closeLots && closeLots < pos.lots) {
                // Partial close
                const closeRatio = closeLots / pos.lots;
                const realizedPnl = Math.round((pos.profit * closeRatio) * 100) / 100;

                this.state.balance = Math.round((this.state.balance + realizedPnl) * 100) / 100;
                this.state.history.unshift({
                    ticket: pos.ticket,
                    symbol: pos.symbol,
                    type: pos.type,
                    lots: closeLots,
                    open_price: pos.open_price,
                    close_price: currentPrice,
                    open_time: pos.open_time,
                    close_time: new Date().toISOString(),
                    profit: realizedPnl,
                    pips: pos.pips || 0.0,
                    reason: 'Partial Close (50%)'
                });

                pos.lots = Math.round((pos.lots - closeLots) * 100) / 100;
                pos.profit = Math.round((pos.profit * (1 - closeRatio)) * 100) / 100;
                this.saveState();
                return { success: true, partial: true, remainingLots: pos.lots };
            }

            this.state.positions.splice(idx, 1);
            this.closePositionInternal(pos, currentPrice, 'Manual Close');
            this.saveState();
            return { success: true, profit: pos.profit };
        }

        closePositionInternal(pos, exitPrice, reason = 'Closed') {
            const realizedPnl = pos.profit || 0.0;
            this.state.balance = Math.round((this.state.balance + realizedPnl) * 100) / 100;

            this.state.history.unshift({
                ticket: pos.ticket,
                symbol: pos.symbol,
                type: pos.type,
                lots: pos.lots,
                open_price: pos.open_price,
                close_price: exitPrice,
                open_time: pos.open_time,
                close_time: new Date().toISOString(),
                profit: realizedPnl,
                pips: pos.pips || 0.0,
                reason
            });
        }

        modifyPosition({ ticket, sl, tp }) {
            const pos = this.state.positions.find(p => p.ticket === ticket);
            if (!pos) return { success: false, error: 'Position not found' };

            if (sl != null) pos.sl = Number(sl);
            if (tp != null) pos.tp = Number(tp);

            this.saveState();
            return { success: true, sl: pos.sl, tp: pos.tp };
        }

        modifyOrder({ ticket, price, sl, tp, lots }) {
            const order = (this.state.orders || []).find(o => o.ticket === ticket);
            if (!order) return { success: false, error: 'Order not found' };

            if (price != null) order.price = Number(price);
            if (sl != null) order.sl = Number(sl);
            if (tp != null) order.tp = Number(tp);
            if (lots != null) order.lots = Number(lots);

            this.saveState();
            return { success: true, order };
        }

        // ==========================================
        // ACCOUNT MANAGEMENT (Reset, Clear, Deposit)
        // ==========================================
        resetAccount(newBalance = 100000.00) {
            this.state.balance = Number(newBalance);
            this.state.initialBalance = Number(newBalance);
            this.state.positions = [];
            this.state.orders = [];
            this.state.history = [];
            this.saveState();
            return { success: true, balance: this.state.balance };
        }

        clearHistory() {
            this.state.history = [];
            this.saveState();
            return { success: true };
        }

        setBalance(amount) {
            this.state.balance = Math.max(10, Number(amount));
            this.saveState();
            return { success: true, balance: this.state.balance };
        }
    }

    // Export singleton
    window.PaperTrading = new PaperTradingEngine();

})(window);
