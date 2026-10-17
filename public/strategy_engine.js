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
            this.config = {
                initialCapital: 100000,
                compounding: true,
                commissionType: 'none', // 'none' | 'fixed' | 'percent'
                commissionValue: 0,
                slippage: 0, // points
                allowConcurrentChains: false,
                ...config
            };
            this.reset();
        }

        reset() {
            this.rawTrades = [];
            this.barIndex = 0;
            this.pendingPlotBuy = NaN;
            this.pendingPlotBuyText = '';
            this.pendingPlotSell = NaN;
            this.pendingPlotSellText = '';
            this.isCalculationDone = false;
            this.debounceTimer = null;
        }

        init(userConfig = {}) {
            this.config = { ...this.config, ...userConfig };
            this.reset();
        }

        // Called on each bar before user logic
        onBarStart(barIndex, barData) {
            this.barIndex = barIndex;
            this.currentBar = barData; // { time, open, high, low, close, volume }
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

            const trade = {
                barIndex: this.barIndex,
                time: bar.time || Date.now(),
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

            const trade = {
                barIndex: this.barIndex,
                time: bar.time || Date.now(),
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
         * Explicitly closes a trade chain
         */
        close(order = {}) {
            return this.sell({ ...order, isEnd: true });
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
            const rawTrades = context.rawTrades;
            const initialCapital = Number(config.initialCapital) || 100000;
            const compounding = config.compounding !== false;
            const slippage = Number(config.slippage) || 0;
            const commissionType = config.commissionType || 'none';
            const commissionValue = Number(config.commissionValue) || 0;

            let currentEquity = initialCapital;
            let peakEquity = initialCapital;
            let maxDrawdownAbs = 0;
            let maxDrawdownPct = 0;

            // Group trades into Trade Chains
            // A chain can have multiple entries (averaging) and partial/full exits
            const openChains = new Map(); // chainId -> chainObject
            const closedChains = [];
            const executedTrades = []; // Flat list with calculated individual PnL

            const equitySeries = [{
                time: rawTrades.length > 0 ? rawTrades[0].time - 60000 : Date.now(),
                equity: initialCapital,
                drawdown: 0,
                drawdownPct: 0
            }];

            let tradeCounter = 1;

            for (const trade of rawTrades) {
                const chainId = trade.chainId;
                let chain = openChains.get(chainId);

                // Compute slippage-adjusted execution price
                let effectivePrice = trade.price;
                if (slippage > 0) {
                    effectivePrice = trade.action === 'BUY' ? trade.price + slippage : trade.price - slippage;
                }

                // Compute commission for this trade leg
                let tradeCommission = 0;
                if (commissionType === 'fixed') {
                    tradeCommission = commissionValue;
                } else if (commissionType === 'percent') {
                    tradeCommission = (effectivePrice * trade.qty * commissionValue) / 100;
                }

                if (!chain) {
                    // New Trade Chain begins
                    chain = {
                        chainId,
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
                    openChains.set(chainId, chain);
                }

                const leg = {
                    tradeNumber: tradeCounter++,
                    chainId,
                    action: trade.action,
                    time: trade.time,
                    barIndex: trade.barIndex,
                    price: effectivePrice,
                    rawPrice: trade.price,
                    qty: trade.qty,
                    commission: tradeCommission,
                    tag: trade.tag,
                    pnl: 0,
                    cumulativeEquity: currentEquity
                };

                chain.legs.push(leg);
                chain.totalCommission += tradeCommission;

                const isEntryAction = (chain.direction === 'LONG' && trade.action === 'BUY') ||
                                     (chain.direction === 'SHORT' && trade.action === 'SELL');

                if (isEntryAction) {
                    // Scale in / Add to position
                    const priorQty = chain.openQty;
                    const priorCost = priorQty * chain.avgEntryPrice;
                    const addCost = trade.qty * effectivePrice;
                    chain.openQty = priorQty + trade.qty;
                    chain.avgEntryPrice = (priorCost + addCost) / chain.openQty;
                    chain.entries.push({ price: effectivePrice, qty: trade.qty, time: trade.time });
                } else {
                    // Exit action (reducing position)
                    const exitQty = Math.min(trade.qty, chain.openQty);
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

                // Check if Chain Ends: net quantity is 0 or explicit isEnd flag
                if (chain.openQty <= 0 || trade.isEnd) {
                    chain.status = 'CLOSED';
                    chain.endTime = trade.time;
                    chain.endBar = trade.barIndex;
                    chain.bars = Math.max(1, chain.endBar - chain.startBar);
                    chain.returnPct = (chain.netPnL / (chain.avgEntryPrice * (chain.entries[0]?.qty || 1))) * 100;
                    
                    closedChains.push(chain);
                    openChains.delete(chainId);

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
                        chainId
                    });
                }
            }

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

            const results = {
                strategyName: context.strategyName,
                config,
                summary: {
                    initialCapital,
                    endingEquity: currentEquity,
                    netProfit,
                    netProfitPct,
                    grossProfit,
                    grossLoss,
                    profitFactor,
                    winRate,
                    totalChains,
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
            return true;
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

                    const hasBuyLabel = this.hasPineShapePlot('buy');
                    const hasSellLabel = this.hasPineShapePlot('sell');

                    // Group trades by bar timestamp to support clean vertical stacking on identical bars
                    const tradesByTime = new Map();
                    executedTrades.forEach(trade => {
                        const timeSec = trade.time > 1e11 ? Math.floor(trade.time / 1000) : Number(trade.time);
                        if (!timeSec || isNaN(timeSec)) return;
                        if (!tradesByTime.has(timeSec)) tradesByTime.set(timeSec, []);
                        tradesByTime.get(timeSec).push(trade);
                    });

                    tradesByTime.forEach((tradesOnBar, timeSec) => {
                        // Resolve exact bar high and low from TradingView's mainSeries data cache
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

                        tradesOnBar.forEach((trade, tradeIdx) => {
                            const isBuy = trade.action === 'BUY';
                            const execPrice = Number(trade.price);
                            if (!execPrice || isNaN(execPrice)) return;

                            const high = isFinite(barHigh) ? barHigh : Number(trade.candleHigh !== undefined ? trade.candleHigh : execPrice);
                            const low = isFinite(barLow) ? barLow : Number(trade.candleLow !== undefined ? trade.candleLow : execPrice);

                            let shapePrice;
                            const canUseCoordinates = priceScale && firstValue !== null && 
                                                      typeof priceScale.priceToCoordinate === 'function' && 
                                                      typeof priceScale.coordinateToPrice === 'function';

                            if (canUseCoordinates) {
                                const stackPixelOffset = tradeIdx * 24;

                                if (isBuy) {
                                    // In screen coordinates: Y=0 is top, moving DOWN is increasing Y.
                                    // If PineJS Buy label exists below bar (~24px pill), place arrow tip below it (~30px).
                                    // If no Buy label exists, place arrow tip right below low wick (~6px).
                                    const lowY = priceScale.priceToCoordinate(low, firstValue);
                                    const targetY = lowY + (hasBuyLabel ? 30 : 6) + stackPixelOffset;
                                    shapePrice = priceScale.coordinateToPrice(targetY, firstValue);
                                } else {
                                    // In screen coordinates: moving UP is decreasing Y.
                                    // If PineJS Sell label exists above bar (~24px pill), place arrow tip above it (~30px).
                                    // If no Sell label exists, place arrow tip right above high wick (-6px).
                                    const highY = priceScale.priceToCoordinate(high, firstValue);
                                    const targetY = highY - (hasSellLabel ? 30 : 6) - stackPixelOffset;
                                    shapePrice = priceScale.coordinateToPrice(targetY, firstValue);
                                }
                            }

                            // High-precision fallback if priceScale coordinates are temporarily unavailable
                            if (!isFinite(shapePrice) || isNaN(shapePrice)) {
                                const candleRange = Math.max(high - low, Math.max(execPrice * 0.0005, 1));
                                const baseOffset = (isBuy ? hasBuyLabel : hasSellLabel) ? candleRange * 0.75 : candleRange * 0.25;
                                const stackOffset = tradeIdx * candleRange * 0.5;
                                shapePrice = isBuy ? (low - (baseOffset + stackOffset)) : (high + (baseOffset + stackOffset));
                            }

                            const priceFormatted = execPrice % 1 === 0 ? execPrice : execPrice.toFixed(2);
                            const labelText = `${isBuy ? 'B' : 'S'}: ${trade.chainId} @ ${priceFormatted} Q: ${trade.qty || 1}`;

                            chart.createShape({ time: timeSec, price: shapePrice }, {
                                shape: isBuy ? 'arrow_up' : 'arrow_down',
                                text: labelText,
                                lock: true,
                                disableSelection: true,
                                disableSave: true,
                                disableUndo: true,
                                overrides: {
                                    color: isBuy ? '#089981' : '#f23645',
                                    arrowColor: isBuy ? '#089981' : '#f23645',
                                    fontsize: 11,
                                    bold: true
                                }
                            }).then(id => {
                                if (id) this._activeShapeIds.push(id);
                            }).catch(() => {});
                        });
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
