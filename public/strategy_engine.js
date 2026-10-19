/**
 * StrategyEngine - Advanced Backtesting & Trade Chain Engine for TradingView Advanced Charts
 * Supports:
 * - Trade Chains: Multiple trades grouped by chainId (averaging in, pyramiding, partial exits, full exits)
 * - Sequential & Concurrent trade chains
 * - Compounding capital growth vs Static capital
 * - Configurable commission & slippage
 * - Comprehensive performance analytics (Win Rate, Profit Factor, Drawdown, Sharpe, Sortino, streaks)
 * - Event-driven communication with the Strategy Tester UI
 */

(function (window) {
    'use strict';

    class StrategyContext {
        constructor(strategyName, config = {}) {
            this.strategyName = strategyName;
            let savedCfg = {};
            try {
                const stored = localStorage.getItem(`tv_strat_cfg_${strategyName}`);
                if (stored) savedCfg = JSON.parse(stored);
            } catch (_) {}
            this.config = {
                initialCapital: 100000,
                compounding: true,
                commissionType: 'none', // 'none' | 'fixed' | 'percent'
                commissionValue: 0,
                slippage: 0, // points
                allowConcurrentChains: false,
                ...savedCfg,
                ...config
            };
            this.reset();
        }

        saveConfig() {
            try {
                localStorage.setItem(`tv_strat_cfg_${this.strategyName}`, JSON.stringify({
                    initialCapital: this.config.initialCapital,
                    compounding: this.config.compounding,
                    commissionType: this.config.commissionType,
                    commissionValue: this.config.commissionValue,
                    slippage: this.config.slippage,
                    allowConcurrentChains: this.config.allowConcurrentChains,
                    rangePreset: this.config.rangePreset,
                    startDate: this.config.startDate,
                    endDate: this.config.endDate,
                    isLiveEnd: this.config.isLiveEnd
                }));
            } catch (_) {}
        }

        reset() {
            this.rawTrades = [];
            this.barIndex = 0;
            this.currentBar = null;
            this.firstBarTime = null;
            this.lastBarTime = null;
            this.pendingPlotBuy = NaN;
            this.pendingPlotBuyText = '';
            this.pendingPlotSell = NaN;
            this.pendingPlotSellText = '';
            this.isCalculationDone = false;
            this.debounceTimer = null;
        }

        init(userConfig = {}) {
            this.config = { ...this.config, ...userConfig };
            this.saveConfig();
            this.reset();
        }

        // Called on each bar before user logic
        onBarStart(barIndex, barData) {
            this.barIndex = barIndex;
            this.currentBar = barData; // { time, open, high, low, close, volume }
            if (barData && barData.time) {
                const bTime = Number(barData.time) < 1e12 ? Number(barData.time) * 1000 : Number(barData.time);
                if (bTime > 0) {
                    if (this.firstBarTime === null || bTime < this.firstBarTime) {
                        this.firstBarTime = bTime;
                    }
                    if (this.lastBarTime === null || bTime > this.lastBarTime) {
                        this.lastBarTime = bTime;
                    }
                }
            }
            this.pendingPlotBuy = NaN;
            this.pendingPlotBuyText = '';
            this.pendingPlotSell = NaN;
            this.pendingPlotSellText = '';
        }

        /**
         * Emits a BUY order
         * @param {Object} order - { id, price, qty, isEnd, tag }
         */
        buy(order = {}) {
            const chainId = order.id !== undefined ? String(order.id) : '1';
            const price = Number(order.price) || (this.currentBar ? this.currentBar.close : 0);
            const qty = Number(order.qty) > 0 ? Number(order.qty) : 1;
            const isEnd = !!order.isEnd;
            const tag = order.tag || '';

            const bar = this.currentBar || {};
            const candleHigh = Number(order.high !== undefined ? order.high : (bar.high !== undefined ? bar.high : price));
            const candleLow = Number(order.low !== undefined ? order.low : (bar.low !== undefined ? bar.low : price));
            const candleClose = Number(bar.close !== undefined ? bar.close : price);
            const candleOpen = Number(bar.open !== undefined ? bar.open : price);
            const tradeTime = bar && bar.time ? (Number(bar.time) < 1e12 ? Number(bar.time) * 1000 : Number(bar.time)) : Date.now();

            const trade = {
                barIndex: this.barIndex,
                time: tradeTime,
                chainId,
                action: 'BUY',
                price,
                candleHigh,
                candleLow,
                candleClose,
                candleOpen,
                qty,
                isEnd,
                tag
            };

            this.rawTrades.push(trade);

            // Shape label text
            const labelText = `B: ${chainId} @ ${price % 1 === 0 ? price : price.toFixed(2)}`;
            this.pendingPlotBuy = price;
            this.pendingPlotBuyText = labelText;

            this._scheduleFinalize();
            return trade;
        }

        /**
         * Emits a SELL order
         * @param {Object} order - { id, price, qty, isEnd, tag }
         */
        sell(order = {}) {
            const chainId = order.id !== undefined ? String(order.id) : '1';
            const price = Number(order.price) || (this.currentBar ? this.currentBar.close : 0);
            const qty = Number(order.qty) > 0 ? Number(order.qty) : 1;
            const isEnd = !!order.isEnd;
            const tag = order.tag || '';

            const bar = this.currentBar || {};
            const candleHigh = Number(order.high !== undefined ? order.high : (bar.high !== undefined ? bar.high : price));
            const candleLow = Number(order.low !== undefined ? order.low : (bar.low !== undefined ? bar.low : price));
            const candleClose = Number(bar.close !== undefined ? bar.close : price);
            const candleOpen = Number(bar.open !== undefined ? bar.open : price);
            const tradeTime = bar && bar.time ? (Number(bar.time) < 1e12 ? Number(bar.time) * 1000 : Number(bar.time)) : Date.now();

            const trade = {
                barIndex: this.barIndex,
                time: tradeTime,
                chainId,
                action: 'SELL',
                price,
                candleHigh,
                candleLow,
                candleClose,
                candleOpen,
                qty,
                isEnd,
                tag
            };

            this.rawTrades.push(trade);

            // Shape label text
            const labelText = `S: ${chainId} @ ${price % 1 === 0 ? price : price.toFixed(2)}`;
            this.pendingPlotSell = price;
            this.pendingPlotSellText = labelText;

            this._scheduleFinalize();
            return trade;
        }

        /**
         * Explicitly closes a trade chain (flattens open position)
         */
        close(order = {}) {
            const chainId = order.id !== undefined ? String(order.id) : '1';
            const price = Number(order.price) || (this.currentBar ? this.currentBar.close : 0);
            const qty = Number(order.qty) > 0 ? Number(order.qty) : null;
            const tag = order.tag || 'Strategy Close';

            const bar = this.currentBar || {};
            const candleHigh = Number(order.high !== undefined ? order.high : (bar.high !== undefined ? bar.high : price));
            const candleLow = Number(order.low !== undefined ? order.low : (bar.low !== undefined ? bar.low : price));
            const candleClose = Number(bar.close !== undefined ? bar.close : price);
            const candleOpen = Number(bar.open !== undefined ? bar.open : price);
            const tradeTime = bar && bar.time ? (Number(bar.time) < 1e12 ? Number(bar.time) * 1000 : Number(bar.time)) : Date.now();

            const trade = {
                barIndex: this.barIndex,
                time: tradeTime,
                chainId,
                action: order.action || 'CLOSE',
                price,
                candleHigh,
                candleLow,
                candleClose,
                candleOpen,
                qty,
                isEnd: true,
                isManual: !!order.isManual,
                tag
            };

            this.rawTrades.push(trade);

            const labelText = `C: ${chainId} @ ${price % 1 === 0 ? price : price.toFixed(2)}`;
            this.pendingPlotSell = price;
            this.pendingPlotSellText = labelText;

            this._scheduleFinalize();
            return trade;
        }

        /**
         * Manual exit method for a trade chain (usable in live market or interactive session)
         */
        manualExit(order = {}) {
            return this.close({ ...order, isManual: true, tag: order.tag || 'Manual User Exit' });
        }

        /**
         * Returns shape plot objects for TradingView PineJS
         */
        getPlots() {
            return [
                { value: this.pendingPlotBuy, text: this.pendingPlotBuyText },
                { value: this.pendingPlotSell, text: this.pendingPlotSellText }
            ];
        }

        _scheduleFinalize() {
            if (this.debounceTimer) clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                StrategyEngine.calculateAndEmit(this);
            }, 80);
        }
    }

    const StrategyEngine = {
        instances: new Map(),
        resultsByStrategy: new Map(),
        activeStrategyName: null,
        lastResults: null,

        getOrCreateContext(strategyName, config = {}) {
            if (!this.instances.has(strategyName)) {
                this.instances.set(strategyName, new StrategyContext(strategyName, config));
            }
            if (!this.activeStrategyName || !this.instances.has(this.activeStrategyName)) {
                this.activeStrategyName = strategyName;
            }
            return this.instances.get(strategyName);
        },

        getContext(strategyName) {
            return this.instances.get(strategyName);
        },

        setActiveStrategy(strategyName) {
            if (!strategyName) return;
            this.activeStrategyName = strategyName;
            try {
                localStorage.setItem('tv_active_strategy', strategyName);
            } catch (_) {}
            const res = this.resultsByStrategy.get(strategyName);
            if (res) {
                this.lastResults = res;
                this.renderTradeShapesOnChart(res.executedTrades);
                window.dispatchEvent(new CustomEvent('strategy_performance_updated', { detail: res }));
            }
            this.emitStrategyListUpdate();
        },

        getActiveStrategyNames() {
            return Array.from(this.instances.keys());
        },

        emitStrategyListUpdate() {
            window.dispatchEvent(new CustomEvent('strategy_list_updated', {
                detail: {
                    strategies: this.getActiveStrategyNames(),
                    activeStrategy: this.activeStrategyName
                }
            }));
        },

        getResolutionInSeconds(res) {
            if (!res) return 86400;
            const r = String(res).toUpperCase();
            if (r.endsWith('S')) {
                return Math.max(1, parseInt(r, 10));
            }
            if (r.endsWith('D')) {
                const mult = parseInt(r, 10) || 1;
                return mult * 86400;
            }
            if (r.endsWith('W')) {
                const mult = parseInt(r, 10) || 1;
                return mult * 7 * 86400;
            }
            if (r.endsWith('M')) {
                const mult = parseInt(r, 10) || 1;
                return mult * 30 * 86400;
            }
            const mins = parseInt(r, 10);
            return isNaN(mins) ? 86400 : mins * 60;
        },

        isStrategyScript(code) {
            if (!code || typeof code !== 'string') return false;
            // Check if code contains buy and sell operations
            const hasBuy = /this\.strategy\.buy|strategy\.buy|action\s*:\s*['"]BUY['"]/i.test(code);
            const hasSell = /this\.strategy\.sell|strategy\.sell|action\s*:\s*['"]SELL['"]/i.test(code);
            return hasBuy && hasSell;
        },

        /**
         * Core backtesting calculation:
         * Pairs trade chains, applies compounding equity, calculates all performance metrics.
         */
        calculateAndEmit(context) {
            const config = context.config;
            const allRawTrades = context.rawTrades;
            const initialCapital = Number(config.initialCapital) || 100000;
            const compounding = config.compounding !== false;
            const slippage = Number(config.slippage) || 0;
            const commissionType = config.commissionType || 'none';
            const commissionValue = Number(config.commissionValue) || 0;

            // Helper to ensure timestamps are in milliseconds
            const normalizeMs = (t) => {
                const n = Number(t);
                if (!n || isNaN(n)) return 0;
                return n < 1e12 ? n * 1000 : n;
            };

            // Determine the true temporal bounds of the chart candles & executed trades:
            let earliestDataMs = context.firstBarTime ? normalizeMs(context.firstBarTime) : 0;
            let latestDataMs = context.lastBarTime ? normalizeMs(context.lastBarTime) : 0;

            if (allRawTrades.length > 0) {
                const firstTradeTime = normalizeMs(allRawTrades[0].time);
                const lastTradeTime = normalizeMs(allRawTrades[allRawTrades.length - 1].time);
                if (!earliestDataMs || (firstTradeTime > 0 && firstTradeTime < earliestDataMs)) {
                    earliestDataMs = firstTradeTime;
                }
                if (!latestDataMs || (lastTradeTime > 0 && lastTradeTime > latestDataMs)) {
                    latestDataMs = lastTradeTime;
                }
            }

            if (!latestDataMs) latestDataMs = Date.now();
            if (!earliestDataMs) earliestDataMs = latestDataMs;

            let filterStartMs = 0;
            let filterEndMs = Infinity;
            const isLiveEnd = config.isLiveEnd !== false;

            if (config.rangePreset === 'custom' && config.startDate) {
                const parsedStart = new Date(config.startDate).getTime();
                if (!isNaN(parsedStart) && parsedStart > 0) filterStartMs = parsedStart;
            } else if (config.rangePreset === '1Y') {
                filterStartMs = latestDataMs - (365 * 24 * 3600 * 1000);
            } else if (config.rangePreset === '6M') {
                filterStartMs = latestDataMs - (182 * 24 * 3600 * 1000);
            } else if (config.rangePreset === '3M') {
                filterStartMs = latestDataMs - (91 * 24 * 3600 * 1000);
            } else if (config.rangePreset === '1M') {
                filterStartMs = latestDataMs - (30 * 24 * 3600 * 1000);
            } else {
                // 'default' (Max / 40k bars) covers entire available data
                filterStartMs = 0;
            }

            if (!isLiveEnd && config.endDate) {
                const parsedEnd = new Date(config.endDate).getTime();
                if (!isNaN(parsedEnd) && parsedEnd > 0) {
                    filterEndMs = parsedEnd < 1e12 ? parsedEnd * 1000 : parsedEnd;
                    if (typeof config.endDate === 'string' && config.endDate.length === 10) {
                        filterEndMs += (24 * 3600 * 1000) - 1;
                    }
                }
            } else {
                filterEndMs = Infinity;
            }

            // Filter raw trades strictly within the configured date range
            const rawTrades = allRawTrades.filter(t => {
                const tTime = normalizeMs(t.time);
                return tTime >= filterStartMs && (isLiveEnd || tTime <= filterEndMs);
            });

            // Effective actual dates of backtested candles/trades:
            const effectiveStartMs = (filterStartMs > 0 && filterStartMs > earliestDataMs) 
                ? filterStartMs 
                : (earliestDataMs > 0 ? earliestDataMs : (rawTrades.length > 0 ? normalizeMs(rawTrades[0].time) : latestDataMs));

            const effectiveEndMs = (!isLiveEnd && filterEndMs < latestDataMs)
                ? filterEndMs
                : latestDataMs;

            let currentEquity = initialCapital;
            let peakEquity = initialCapital;
            let maxDrawdownAbs = 0;
            let maxDrawdownPct = 0;

            const allowConcurrentChains = !!(context.config && context.config.allowConcurrentChains);

            // Group trades into Trade Chains
            // A chain can have multiple entries (averaging) and partial/full exits
            const openChains = new Map(); // chainId -> chainObject
            const closedChains = [];
            const executedTrades = []; // Flat list with calculated individual PnL
            let activeSequentialChainId = null;
            let chainCounter = 1;

            const equitySeries = [{
                time: rawTrades.length > 0 ? rawTrades[0].time - 60000 : Date.now(),
                equity: initialCapital,
                drawdown: 0,
                drawdownPct: 0
            }];

            let tradeCounter = 1;

            for (const trade of rawTrades) {
                let targetChainId = trade.chainId;
                const isExitOrder = !!trade.isEnd || trade.action === 'CLOSE' || (trade.tag && (trade.tag.toLowerCase().includes('exit') || trade.tag.toLowerCase().includes('close')));

                if (!allowConcurrentChains) {
                    // Sequential Mode: Only one trade chain can be active at a time.
                    // Subsequent trade chains cannot start until the active chain is fully closed.
                    if (activeSequentialChainId !== null) {
                        const activeChain = openChains.get(activeSequentialChainId);
                        if (!activeChain || activeChain.status === 'CLOSED' || activeChain.openQty <= 0) {
                            activeSequentialChainId = null;
                        } else {
                            // An active chain is open with openQty > 0.
                            const isExitAction = (activeChain.direction === 'LONG' && (trade.action === 'SELL' || trade.action === 'CLOSE')) ||
                                                 (activeChain.direction === 'SHORT' && (trade.action === 'BUY' || trade.action === 'CLOSE')) ||
                                                 trade.isEnd;

                            if (trade.chainId === activeSequentialChainId) {
                                // Explicitly targets the active chain
                                targetChainId = activeSequentialChainId;
                            } else if (isExitAction && (trade.chainId === '1' || trade.isEnd || !openChains.has(trade.chainId))) {
                                // Exit action with generic or unmatched ID: route exit to active chain
                                targetChainId = activeSequentialChainId;
                            } else {
                                // New trade chain entry or trade for a different chain while active chain is open:
                                // In Sequential Mode, IGNORE / SUPPRESS this trade so chains never overlap.
                                continue;
                            }
                        }
                    }

                    if (activeSequentialChainId === null) {
                        // No active chain is open.
                        // If this trade is an exit order without an open position, ignore it (e.g. manual exit already closed it).
                        if (isExitOrder) {
                            continue;
                        }
                    }
                } else {
                    // Concurrent / Overlapping Mode:
                    // If an exit arrives for a chainId that isn't open, ignore it!
                    if (!openChains.has(targetChainId) && isExitOrder) {
                        continue;
                    }
                }

                let chain = openChains.get(targetChainId);

                if (!chain) {
                    // If this is an exit order when no chain exists, DO NOT create a phantom chain
                    if (isExitOrder) continue;

                    // New Trade Chain begins with an entry order (BUY or SELL)
                    chain = {
                        chainNumber: chainCounter++,
                        chainId: targetChainId,
                        direction: trade.action === 'BUY' ? 'LONG' : 'SHORT',
                        startTime: trade.time,
                        startBar: trade.barIndex,
                        endTime: null,
                        endBar: null,
                        entries: [],
                        exits: [],
                        openQty: 0,
                        avgEntryPrice: 0,
                        grossPnL: 0,
                        netPnL: 0,
                        totalCommission: 0,
                        status: 'OPEN',
                        legs: []
                    };
                    openChains.set(targetChainId, chain);
                    if (!allowConcurrentChains) {
                        activeSequentialChainId = targetChainId;
                    }
                }

                // Resolve action: if trade.action === 'CLOSE', resolve to opposite of direction
                const resolvedAction = trade.action === 'CLOSE'
                    ? (chain.direction === 'LONG' ? 'SELL' : 'BUY')
                    : trade.action;

                // Compute slippage-adjusted execution price
                let effectivePrice = trade.price;
                if (slippage > 0) {
                    effectivePrice = resolvedAction === 'BUY' ? trade.price + slippage : trade.price - slippage;
                }

                const isEntryAction = (chain.direction === 'LONG' && resolvedAction === 'BUY') ||
                                     (chain.direction === 'SHORT' && resolvedAction === 'SELL');

                const isExitAction = (chain.direction === 'LONG' && resolvedAction === 'SELL') ||
                                    (chain.direction === 'SHORT' && resolvedAction === 'BUY');

                // Determine quantity to trade:
                let tradeQty = Number(trade.qty) > 0 ? Number(trade.qty) : (isExitAction ? chain.openQty : 1);
                if (isExitAction && (trade.isEnd || trade.action === 'CLOSE' || tradeQty >= chain.openQty)) {
                    // Full close: close all remaining open quantity in the chain
                    tradeQty = chain.openQty;
                }

                // If exit quantity is 0 (already flat), skip
                if (isExitAction && tradeQty <= 0) {
                    continue;
                }

                // Compute commission for this trade leg
                let tradeCommission = 0;
                if (commissionType === 'fixed') {
                    tradeCommission = commissionValue;
                } else if (commissionType === 'percent') {
                    tradeCommission = (effectivePrice * tradeQty * commissionValue) / 100;
                }

                const leg = {
                    tradeNumber: tradeCounter++,
                    chainId: targetChainId,
                    action: resolvedAction,
                    time: trade.time,
                    barIndex: trade.barIndex,
                    price: effectivePrice,
                    rawPrice: trade.price,
                    qty: tradeQty,
                    commission: tradeCommission,
                    tag: trade.tag,
                    pnl: 0,
                    cumulativeEquity: currentEquity
                };

                chain.legs.push(leg);
                chain.totalCommission += tradeCommission;

                if (isEntryAction) {
                    // Scale in / Add to position
                    const priorQty = chain.openQty;
                    const priorCost = priorQty * chain.avgEntryPrice;
                    const addCost = tradeQty * effectivePrice;
                    chain.openQty = priorQty + tradeQty;
                    chain.avgEntryPrice = (priorCost + addCost) / chain.openQty;
                    chain.entries.push({ price: effectivePrice, qty: tradeQty, time: trade.time });
                } else if (isExitAction) {
                    // Exit action (reducing position)
                    const exitQty = Math.min(tradeQty, chain.openQty);
                    let legPnL = 0;
                    if (chain.direction === 'LONG') {
                        legPnL = (effectivePrice - chain.avgEntryPrice) * exitQty;
                    } else {
                        legPnL = (chain.avgEntryPrice - effectivePrice) * exitQty;
                    }

                    legPnL -= tradeCommission;
                    leg.pnl = legPnL;
                    chain.grossPnL += legPnL + tradeCommission;
                    chain.netPnL += legPnL;
                    chain.openQty -= exitQty;
                    chain.exits.push({ price: effectivePrice, qty: exitQty, time: trade.time });

                    // Update equity
                    currentEquity += legPnL;
                    leg.cumulativeEquity = currentEquity;
                }

                executedTrades.push(leg);

                // Check if Chain Ends:
                // Rule 1: Net open quantity must be 0 (every buy has had a sell, or short has had a buy).
                // Rule 2: At least one entry AND at least one exit must exist.
                // Rule 3: If openQty > 0, IT IS NOT AN END (chain remains OPEN until open positions are closed).
                const isFullyClosed = (chain.openQty === 0 && chain.entries.length > 0 && chain.exits.length > 0);

                if (isFullyClosed) {
                    chain.status = 'CLOSED';
                    chain.endTime = trade.time;
                    chain.endBar = trade.barIndex;
                    chain.bars = Math.max(1, chain.endBar - chain.startBar);
                    chain.returnPct = (chain.netPnL / (chain.avgEntryPrice * (chain.entries[0]?.qty || 1))) * 100;
                    
                    closedChains.push(chain);
                    openChains.delete(chain.chainId);

                    if (!allowConcurrentChains) {
                        activeSequentialChainId = null;
                    }

                    // Track High Water Mark & Drawdown
                    if (currentEquity > peakEquity) {
                        peakEquity = currentEquity;
                    }
                    const dd = peakEquity - currentEquity;
                    const ddPct = (dd / peakEquity) * 100;
                    if (dd > maxDrawdownAbs) maxDrawdownAbs = dd;
                    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

                    equitySeries.push({
                        time: trade.time,
                        equity: currentEquity,
                        drawdown: dd,
                        drawdownPct: ddPct,
                        chainId: chain.chainId
                    });
                }
            }

            // For any open chains (still open at the end of the data/chart),
            // calculate mark-to-market unrealized PnL using the latest available candle close
            const latestClose = context.currentBar ? Number(context.currentBar.close) : (rawTrades.length > 0 ? rawTrades[rawTrades.length - 1].price : 0);
            let totalUnrealizedPnL = 0;
            openChains.forEach(c => {
                c.status = 'OPEN';
                c.endBar = context.barIndex;
                c.bars = Math.max(1, (context.barIndex || 0) - c.startBar);
                if (latestClose > 0 && c.avgEntryPrice > 0 && c.openQty > 0) {
                    if (c.direction === 'LONG') {
                        c.unrealizedPnL = (latestClose - c.avgEntryPrice) * c.openQty;
                    } else {
                        c.unrealizedPnL = (c.avgEntryPrice - latestClose) * c.openQty;
                    }
                    c.unrealizedReturnPct = (c.unrealizedPnL / (c.avgEntryPrice * c.openQty)) * 100;
                    totalUnrealizedPnL += c.unrealizedPnL;
                } else {
                    c.unrealizedPnL = 0;
                    c.unrealizedReturnPct = 0;
                }
            });

            // Calculate overall performance summary statistics
            const totalChains = closedChains.length;
            const winningChains = closedChains.filter(c => c.netPnL > 0);
            const losingChains = closedChains.filter(c => c.netPnL < 0);
            const breakEvenChains = closedChains.filter(c => c.netPnL === 0);

            let grossProfit = 0;
            let grossLoss = 0;
            closedChains.forEach(c => {
                if (c.netPnL > 0) grossProfit += c.netPnL;
                else grossLoss += Math.abs(c.netPnL);
            });

            const netProfit = currentEquity - initialCapital;
            const netProfitPct = (netProfit / initialCapital) * 100;
            const winRate = totalChains > 0 ? (winningChains.length / totalChains) * 100 : 0;
            const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 999.99 : 0);

            // Win / Loss streaks
            let currentWinStreak = 0, maxWinStreak = 0;
            let currentLossStreak = 0, maxLossStreak = 0;
            closedChains.forEach(c => {
                if (c.netPnL > 0) {
                    currentWinStreak++;
                    currentLossStreak = 0;
                    if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
                } else if (c.netPnL < 0) {
                    currentLossStreak++;
                    currentWinStreak = 0;
                    if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
                }
            });

            // Long vs Short breakdowns
            const longChains = closedChains.filter(c => c.direction === 'LONG');
            const shortChains = closedChains.filter(c => c.direction === 'SHORT');
            const longNetProfit = longChains.reduce((acc, c) => acc + c.netPnL, 0);
            const shortNetProfit = shortChains.reduce((acc, c) => acc + c.netPnL, 0);

            const avgTradePnL = totalChains > 0 ? netProfit / totalChains : 0;
            const avgWinPnL = winningChains.length > 0 ? grossProfit / winningChains.length : 0;
            const avgLossPnL = losingChains.length > 0 ? grossLoss / losingChains.length : 0;
            const winLossRatio = avgLossPnL > 0 ? (avgWinPnL / avgLossPnL) : 0;

            const largestWin = winningChains.length > 0 ? Math.max(...winningChains.map(c => c.netPnL)) : 0;
            const largestLoss = losingChains.length > 0 ? Math.min(...losingChains.map(c => c.netPnL)) : 0;

            const avgBarsInTrade = totalChains > 0 ? closedChains.reduce((a, c) => a + (c.bars || 1), 0) / totalChains : 0;

            // Sharpe & Sortino approximations
            let sharpeRatio = 0;
            let sortinoRatio = 0;
            if (closedChains.length >= 2) {
                const returns = closedChains.map(c => c.returnPct);
                const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
                const variance = returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / (returns.length - 1);
                const stdDev = Math.sqrt(variance);
                if (stdDev > 0) sharpeRatio = (avgReturn / stdDev) * Math.sqrt(252);

                const downsideReturns = returns.filter(r => r < 0);
                if (downsideReturns.length > 0) {
                    const downVariance = downsideReturns.reduce((a, b) => a + Math.pow(b, 2), 0) / downsideReturns.length;
                    const downStdDev = Math.sqrt(downVariance);
                    if (downStdDev > 0) sortinoRatio = (avgReturn / downStdDev) * Math.sqrt(252);
                }
            }

            const startDateFormatted = effectiveStartMs > 0 
                ? new Date(effectiveStartMs).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) 
                : 'Max Data';
            const endDateFormatted = isLiveEnd 
                ? `${new Date(effectiveEndMs).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} (Live 🟢)` 
                : new Date(effectiveEndMs).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            const startDateStr = effectiveStartMs > 0 ? new Date(effectiveStartMs).toISOString().split('T')[0] : '';
            const endDateStr = effectiveEndMs > 0 ? new Date(effectiveEndMs).toISOString().split('T')[0] : '';

            const results = {
                strategyName: context.strategyName,
                config,
                dateRange: {
                    startMs: effectiveStartMs,
                    endMs: effectiveEndMs,
                    isLiveEnd,
                    preset: config.rangePreset || 'default',
                    startDateStr,
                    endDateStr,
                    startDateFormatted,
                    endDateFormatted,
                    totalTradesInRange: rawTrades.length,
                    totalTradesAllTime: allRawTrades.length,
                    totalChainsInRange: totalChains,
                    totalOpenChains: openChains.size
                },
                summary: {
                    initialCapital,
                    endingEquity: currentEquity,
                    allowConcurrentChains,
                    netProfit,
                    netProfitPct,
                    grossProfit,
                    grossLoss,
                    profitFactor,
                    winRate,
                    totalChains,
                    totalOpenChains: openChains.size,
                    unrealizedPnL: totalUnrealizedPnL,
                    markToMarketEquity: currentEquity + totalUnrealizedPnL,
                    winningChains: winningChains.length,
                    losingChains: losingChains.length,
                    breakEvenChains: breakEvenChains.length,
                    totalTrades: executedTrades.length,
                    maxDrawdownAbs,
                    maxDrawdownPct,
                    avgTradePnL,
                    avgWinPnL,
                    avgLossPnL,
                    winLossRatio,
                    largestWin,
                    largestLoss,
                    maxWinStreak,
                    maxLossStreak,
                    avgBarsInTrade: Math.round(avgBarsInTrade),
                    sharpeRatio: Number(sharpeRatio.toFixed(2)),
                    sortinoRatio: Number(sortinoRatio.toFixed(2)),
                    longChainsCount: longChains.length,
                    shortChainsCount: shortChains.length,
                    longNetProfit,
                    shortNetProfit
                },
                equitySeries,
                closedChains,
                openChains: Array.from(openChains.values()),
                executedTrades
            };

            this.resultsByStrategy.set(context.strategyName, results);

            // If this is the active strategy or no strategy is active, update chart & UI
            if (!this.activeStrategyName || this.activeStrategyName === context.strategyName || !this.instances.has(this.activeStrategyName)) {
                this.activeStrategyName = context.strategyName;
                this.lastResults = results;
                this.renderTradeShapesOnChart(executedTrades);
                window.dispatchEvent(new CustomEvent('strategy_performance_updated', { detail: results }));
                try {
                    localStorage.setItem('tv_active_strategy', context.strategyName);
                } catch (_) {}
            }

            this.emitStrategyListUpdate();
            return results;
        },

        _activeShapeIds: [],

        clearTradeShapesOnChart() {
            if (!window.tvWidget) return;
            try {
                const chart = window.tvWidget.activeChart();
                if (!chart) return;
                for (const id of this._activeShapeIds) {
                    try {
                        chart.removeEntity(id, { disableUndo: true });
                    } catch (_) {}
                }
            } catch (_) {}
            this._activeShapeIds = [];
        },

        hasPineShapePlot(type) {
            try {
                const context = this.instances.get(this.activeStrategyName);
                if (context && context.indicatorMeta) {
                    const meta = context.indicatorMeta;
                    const plots = meta.plots || [];
                    const styles = (meta.defaults && meta.defaults.styles) || meta.styles || {};
                    for (const p of plots) {
                        if (p.type === 'shapes') {
                            const s = styles[p.id];
                            const plottype = s && s.plottype;
                            const loc = s && s.location;
                            const idLower = (p.id || '').toLowerCase();
                            if (type === 'buy') {
                                if (idLower.includes('buy') || plottype === 'shape_label_up' || loc === 'BelowBar') {
                                    return true;
                                }
                            } else if (type === 'sell') {
                                if (idLower.includes('sell') || plottype === 'shape_label_down' || loc === 'AboveBar') {
                                    return true;
                                }
                            }
                        }
                    }
                    return false;
                }
            } catch (_) {}
            return false;
        },

        renderTradeShapesOnChart(executedTrades) {
            this.clearTradeShapesOnChart();
            if (!executedTrades || executedTrades.length === 0) return;

            const drawShapes = () => {
                if (!window.tvWidget) return;
                try {
                    const chart = window.tvWidget.activeChart();
                    if (!chart || typeof chart.createShape !== 'function') return;

                    let priceScale = null;
                    let firstValue = null;
                    let mainSeries = null;
                    let chartData = null;
                    let timeScale = null;

                    try {
                        const model = typeof chart.chartModel === 'function' ? chart.chartModel() : null;
                        if (model) {
                            mainSeries = typeof model.mainSeries === 'function' ? model.mainSeries() : null;
                            timeScale = typeof model.timeScale === 'function' ? model.timeScale() : null;
                            if (mainSeries) {
                                priceScale = typeof mainSeries.priceScale === 'function' ? mainSeries.priceScale() : null;
                                firstValue = typeof mainSeries.firstValue === 'function' ? mainSeries.firstValue() : null;
                                chartData = typeof mainSeries.data === 'function' ? mainSeries.data() : null;
                            }
                        }
                    } catch (e) {
                        console.warn("[StrategyEngine] Failed to acquire mainSeries / priceScale:", e);
                    }

                    // Group trades by bar timestamp
                    const tradesByTime = new Map();
                    executedTrades.forEach(trade => {
                        const timeSec = trade.time > 1e11 ? Math.floor(trade.time / 1000) : Number(trade.time);
                        if (!timeSec || isNaN(timeSec)) return;
                        if (!tradesByTime.has(timeSec)) tradesByTime.set(timeSec, []);
                        tradesByTime.get(timeSec).push(trade);
                    });

                    tradesByTime.forEach((tradesOnBar, timeSec) => {
                        // Resolve exact bar high and low from TradingView's mainSeries data cache if available
                        let barHigh = NaN;
                        let barLow = NaN;

                        if (timeScale && chartData) {
                            try {
                                const barIdx = timeScale.timePointToIndex(timeSec);
                                if (barIdx !== null && typeof chartData.valueAt === 'function') {
                                    const barArr = chartData.valueAt(barIdx);
                                    if (barArr && barArr.length >= 5) {
                                        // TradingView bar format: [index, open, high, low, close, volume]
                                        barHigh = Number(barArr[2]);
                                        barLow = Number(barArr[3]);
                                    }
                                }
                            } catch (_) {}
                        }

                        // Color Scheme: Blue for Buy, Fuchsia for Sell, Black for Text Labels
                        const BUY_COLOR = '#2962FF';
                        const SELL_COLOR = '#FF00FF';
                        const LABEL_COLOR = '#000000';

                        // 1. Draw execution fill arrows (arrow_left) directly at the exact @price on the candle.
                        // Points left into the candle (◀), matching native TradingView order fill arrows.
                        // If multiple trades on this bar share the same price, only 1 arrow is drawn.
                        // If they differ, separate arrows point to each distinct price.
                        const distinctPrices = Array.from(new Set(tradesOnBar.map(t => Number(t.price)).filter(p => isFinite(p) && p > 0)));
                        distinctPrices.forEach(execPrice => {
                            const matchingTrade = [...tradesOnBar].reverse().find(t => Number(t.price) === execPrice) || tradesOnBar[0];
                            const isBuy = matchingTrade.action === 'BUY';
                            const arrowColor = isBuy ? BUY_COLOR : SELL_COLOR;

                            chart.createShape({ time: timeSec, price: execPrice }, {
                                shape: 'arrow_left',
                                lock: true,
                                disableSelection: true,
                                disableSave: true,
                                disableUndo: true,
                                zOrder: 'top',
                                overrides: {
                                    color: arrowColor,
                                    arrowColor: arrowColor
                                }
                            }).then(id => {
                                if (id) {
                                    this._activeShapeIds.push(id);
                                    try {
                                        const shapeApi = chart.getShapeById(id);
                                        if (shapeApi && typeof shapeApi.bringToFront === 'function') {
                                            shapeApi.bringToFront();
                                        }
                                    } catch (_) {}
                                }
                            }).catch(() => {});
                        });

                        // 2. Draw directional trade label arrows outside the candle:
                        // Blue arrow_up below candle low pointing UP at wick
                        // Fuchsia arrow_down above candle high pointing DOWN at wick
                        // If multiple trades exist on the same candle, show all labels on ONE arrow.
                        const sellTrades = tradesOnBar.filter(t => t.action === 'SELL' || t.action === 'CLOSE');
                        const buyTrades = tradesOnBar.filter(t => t.action === 'BUY');

                        // Sell Direction Arrow (arrow_down, Fuchsia #FF00FF, Black text, Negative Qty)
                        if (sellTrades.length > 0) {
                            const lines = sellTrades.map(trade => {
                                const p = Number(trade.price);
                                const priceFormatted = p % 1 === 0 ? p : p.toFixed(2);
                                const rawQty = Math.abs(Number(trade.qty) || 1);
                                return `S: ${trade.chainId} @ ${priceFormatted} Q: -${rawQty}`;
                            });
                            const labelText = lines.length > 1 ? lines.reverse().join('\n') : lines[0];

                            const highs = sellTrades.map(t => Number(t.candleHigh !== undefined ? t.candleHigh : t.price)).filter(isFinite);
                            const high = isFinite(barHigh) ? barHigh : (highs.length > 0 ? Math.max(...highs) : 0);

                            chart.createShape({ time: timeSec, price: high }, {
                                shape: 'arrow_down',
                                text: labelText,
                                lock: true,
                                disableSelection: true,
                                disableSave: true,
                                disableUndo: true,
                                zOrder: 'top',
                                overrides: {
                                    color: LABEL_COLOR,
                                    arrowColor: SELL_COLOR,
                                    fontsize: 11,
                                    bold: true
                                }
                            }).then(id => {
                                if (id) {
                                    this._activeShapeIds.push(id);
                                    try {
                                        const shapeApi = chart.getShapeById(id);
                                        if (shapeApi && typeof shapeApi.bringToFront === 'function') {
                                            shapeApi.bringToFront();
                                        }
                                    } catch (_) {}
                                }
                            }).catch(() => {});
                        }

                        // Buy Direction Arrow (arrow_up, Blue #2962FF, Black text, Positive Qty)
                        if (buyTrades.length > 0) {
                            const lines = buyTrades.map(trade => {
                                const p = Number(trade.price);
                                const priceFormatted = p % 1 === 0 ? p : p.toFixed(2);
                                const rawQty = Math.abs(Number(trade.qty) || 1);
                                return `B: ${trade.chainId} @ ${priceFormatted} Q: ${rawQty}`;
                            });
                            const labelText = lines.join('\n');

                            const lows = buyTrades.map(t => Number(t.candleLow !== undefined ? t.candleLow : t.price)).filter(isFinite);
                            const low = isFinite(barLow) ? barLow : (lows.length > 0 ? Math.min(...lows) : 0);

                            chart.createShape({ time: timeSec, price: low }, {
                                shape: 'arrow_up',
                                text: labelText,
                                lock: true,
                                disableSelection: true,
                                disableSave: true,
                                disableUndo: true,
                                zOrder: 'top',
                                overrides: {
                                    color: LABEL_COLOR,
                                    arrowColor: BUY_COLOR,
                                    fontsize: 11,
                                    bold: true
                                }
                            }).then(id => {
                                if (id) {
                                    this._activeShapeIds.push(id);
                                    try {
                                        const shapeApi = chart.getShapeById(id);
                                        if (shapeApi && typeof shapeApi.bringToFront === 'function') {
                                            shapeApi.bringToFront();
                                        }
                                    } catch (_) {}
                                }
                            }).catch(() => {});
                        }
                    });
                } catch (e) {
                    console.warn("[StrategyEngine] Failed to render trade shapes:", e);
                }
            };

            try {
                const chart = window.tvWidget && window.tvWidget.activeChart();
                if (chart && chart.createShape) {
                    drawShapes();
                } else {
                    setTimeout(drawShapes, 400);
                }
            } catch (_) {
                setTimeout(drawShapes, 400);
            }
        },

        /**
         * Allows manually exiting an open trade chain at current market price (live or backtest)
         */
        manualExit(strategyName, chainId) {
            const name = strategyName || this.activeStrategyName;
            const ctx = this.getContext(name);
            if (!ctx) return false;
            const results = this.resultsByStrategy.get(name);
            const openChains = results && results.openChains ? results.openChains : [];
            const targetChain = chainId !== undefined 
                ? openChains.find(c => String(c.chainId) === String(chainId)) 
                : openChains[0];
            if (!targetChain) return false;

            const lastBar = ctx.currentBar || {};
            const exitPrice = Number(lastBar.close) || targetChain.avgEntryPrice;
            const exitAction = targetChain.direction === 'LONG' ? 'SELL' : 'BUY';

            ctx.rawTrades.push({
                barIndex: ctx.barIndex,
                time: lastBar.time ? (Number(lastBar.time) < 1e12 ? Number(lastBar.time) * 1000 : Number(lastBar.time)) : Date.now(),
                chainId: String(targetChain.chainId),
                action: exitAction,
                price: exitPrice,
                candleHigh: lastBar.high || exitPrice,
                candleLow: lastBar.low || exitPrice,
                candleClose: exitPrice,
                candleOpen: lastBar.open || exitPrice,
                qty: targetChain.openQty,
                isEnd: true,
                isManual: true,
                tag: 'Manual User Exit'
            });

            this.calculateAndEmit(ctx);
            return true;
        },

        clearAll() {
            this.instances.clear();
            this.resultsByStrategy.clear();
            this.activeStrategyName = null;
            this.lastResults = null;
            this.clearTradeShapesOnChart();
            this.emitStrategyListUpdate();
        }
    };

    window.StrategyEngine = StrategyEngine;

})(window);
