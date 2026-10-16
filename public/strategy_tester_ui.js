/**
 * StrategyTesterUI - Resizable & Detachable Bottom Panel for Strategy Backtesting
 * Features:
 * - Bottom dock with drag resizer
 * - Detach into floating draggable popup / snap back to dock
 * - Tabs: Overview (with SVG Equity Curve), Performance Summary, Trade Chains Inspector, List of Trades, Settings
 * - Click-to-candle chart navigation
 * - Real-time updates via 'strategy_performance_updated' event
 */

(function (window) {
    'use strict';

    class StrategyTesterUI {
        constructor() {
            this.container = null;
            this.activeTab = 'overview';
            this.isDetached = false;
            this.isCollapsed = false;
            this.currentData = null;
            this.height = 320;
            this.minHeight = 160;
            this.maxHeight = window.innerHeight * 0.85;

            this.init();
        }

        init() {
            this.injectStyles();
            this.buildDOM();
            this.bindEvents();
            this.bindDragResizer();
        }

        injectStyles() {
            const style = document.createElement('style');
            style.id = 'strategy-tester-styles';
            style.textContent = `
                #strategy-tester-panel {
                    position: fixed;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    height: 320px;
                    background: #ffffff;
                    border-top: 1px solid #e0e3eb;
                    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.08);
                    z-index: 9999;
                    display: none;
                    flex-direction: column;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    box-sizing: border-box;
                    transition: height 0.05s ease;
                }

                #strategy-tester-panel.detached {
                    left: 50% !important;
                    top: 50% !important;
                    bottom: auto !important;
                    right: auto !important;
                    transform: translate(-50%, -50%);
                    width: 860px;
                    height: 520px;
                    max-width: 95vw;
                    max-height: 90vh;
                    border: 1px solid #d1d4dc;
                    border-radius: 10px;
                    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.22);
                    resize: both;
                    overflow: hidden;
                }

                #strategy-tester-panel.collapsed {
                    height: 42px !important;
                    overflow: hidden;
                }

                .st-resizer {
                    height: 5px;
                    background: transparent;
                    cursor: ns-resize;
                    width: 100%;
                    position: absolute;
                    top: 0;
                    left: 0;
                    z-index: 10;
                    transition: background 0.2s;
                }
                .st-resizer:hover {
                    background: #2962FF;
                }
                #strategy-tester-panel.detached .st-resizer {
                    display: none;
                }

                .st-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0 16px;
                    height: 42px;
                    background: #f8fafe;
                    border-bottom: 1px solid #e0e3eb;
                    user-select: none;
                    flex-shrink: 0;
                }

                .st-title-area {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .st-title {
                    font-size: 13px;
                    font-weight: 700;
                    color: #131722;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .st-badge {
                    font-size: 10px;
                    font-weight: 700;
                    text-transform: uppercase;
                    background: #e8f0fe;
                    color: #2962FF;
                    padding: 2px 6px;
                    border-radius: 4px;
                    letter-spacing: 0.3px;
                }

                .st-tabs {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    margin-left: 16px;
                }

                .st-tab {
                    padding: 6px 12px;
                    font-size: 12px;
                    font-weight: 600;
                    color: #787b86;
                    cursor: pointer;
                    border-radius: 6px;
                    transition: all 0.15s ease;
                }
                .st-tab:hover {
                    background: #eef2fa;
                    color: #131722;
                }
                .st-tab.active {
                    background: #ffffff;
                    color: #2962FF;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
                }

                .st-actions {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .st-icon-btn {
                    width: 26px;
                    height: 26px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 4px;
                    cursor: pointer;
                    color: #787b86;
                    transition: all 0.15s ease;
                }
                .st-icon-btn:hover {
                    background: #e0e3eb;
                    color: #131722;
                }

                .st-body {
                    flex: 1;
                    overflow: auto;
                    padding: 16px;
                    background: #ffffff;
                    box-sizing: border-box;
                }

                /* Metric Cards */
                .st-metrics-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
                    gap: 12px;
                    margin-bottom: 16px;
                }

                .st-metric-card {
                    background: #f8fafe;
                    border: 1px solid #e0e3eb;
                    border-radius: 8px;
                    padding: 12px 14px;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .st-metric-label {
                    font-size: 11px;
                    font-weight: 600;
                    color: #787b86;
                    text-transform: uppercase;
                    letter-spacing: 0.3px;
                }

                .st-metric-value {
                    font-size: 17px;
                    font-weight: 700;
                    color: #131722;
                }

                .st-metric-value.profit { color: #089981; }
                .st-metric-value.loss { color: #f23645; }

                /* Tables */
                .st-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 12px;
                    text-align: left;
                }

                .st-table th {
                    background: #f8fafe;
                    color: #787b86;
                    font-weight: 600;
                    padding: 8px 12px;
                    border-bottom: 1px solid #e0e3eb;
                    position: sticky;
                    top: 0;
                    z-index: 2;
                }

                .st-table td {
                    padding: 8px 12px;
                    border-bottom: 1px solid #f0f3fa;
                    color: #131722;
                }

                .st-table tr:hover {
                    background: #f8fafe;
                    cursor: pointer;
                }

                .st-chain-row {
                    font-weight: 600;
                }

                .st-leg-subtable {
                    background: #fafbfc;
                    padding: 8px 16px;
                    border-left: 3px solid #2962FF;
                    margin: 4px 0 8px 20px;
                    border-radius: 4px;
                }

                /* Equity Curve */
                .st-equity-container {
                    background: #ffffff;
                    border: 1px solid #e0e3eb;
                    border-radius: 8px;
                    padding: 12px;
                    margin-top: 8px;
                }

                .st-chart-svg {
                    width: 100%;
                    height: 140px;
                    overflow: visible;
                }

                /* Launcher Pill */
                #st-launcher-pill {
                    position: fixed;
                    bottom: 14px;
                    right: 18px;
                    background: #131722;
                    color: #ffffff;
                    border-radius: 20px;
                    padding: 8px 14px;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    display: none;
                    align-items: center;
                    gap: 8px;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
                    z-index: 9998;
                    transition: transform 0.15s ease, background 0.15s ease;
                }
                #st-launcher-pill:hover {
                    background: #2962FF;
                    transform: translateY(-2px);
                }
            `;
            document.head.appendChild(style);
        }

        buildDOM() {
            // Main Panel
            const panel = document.createElement('div');
            panel.id = 'strategy-tester-panel';
            panel.innerHTML = `
                <div class="st-resizer" id="st-drag-resizer"></div>
                <div class="st-header" id="st-header">
                    <div class="st-title-area">
                        <div class="st-title">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2962FF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                            <span id="st-strategy-name">Strategy Tester</span>
                            <span class="st-badge">Strategy</span>
                        </div>
                        <div class="st-tabs">
                            <div class="st-tab active" data-tab="overview">Overview</div>
                            <div class="st-tab" data-tab="performance">Performance Summary</div>
                            <div class="st-tab" data-tab="chains">Trade Chains</div>
                            <div class="st-tab" data-tab="trades">List of Trades</div>
                            <div class="st-tab" data-tab="settings">Settings</div>
                        </div>
                    </div>
                    <div class="st-actions">
                        <div class="st-icon-btn" id="st-btn-detach" title="Detach / Dock">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                        </div>
                        <div class="st-icon-btn" id="st-btn-collapse" title="Collapse / Expand">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        </div>
                        <div class="st-icon-btn" id="st-btn-close" title="Close Panel">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </div>
                    </div>
                </div>
                <div class="st-body" id="st-body">
                    <div id="st-content-loading" style="text-align:center; padding:40px; color:#787b86;">Waiting for strategy calculation...</div>
                </div>
            `;
            document.body.appendChild(panel);
            this.container = panel;

            // Launcher Pill
            const pill = document.createElement('div');
            pill.id = 'st-launcher-pill';
            pill.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                <span>Strategy Tester</span>
                <span id="st-pill-pnl" style="font-weight:700; color:#089981;"></span>
            `;
            pill.onclick = () => this.show();
            document.body.appendChild(pill);
            this.launcherPill = pill;
        }

        bindEvents() {
            // Listen for Strategy Engine calculations
            window.addEventListener('strategy_performance_updated', (e) => {
                this.updateData(e.detail);
            });

            // Tab switching
            this.container.querySelectorAll('.st-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    this.container.querySelectorAll('.st-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    this.activeTab = tab.getAttribute('data-tab');
                    this.renderActiveTab();
                });
            });

            // Detach / Dock
            document.getElementById('st-btn-detach').onclick = () => {
                this.isDetached = !this.isDetached;
                if (this.isDetached) {
                    this.container.classList.add('detached');
                    this.container.style.height = '520px';
                } else {
                    this.container.classList.remove('detached');
                    this.container.style.height = `${this.height}px`;
                    this.container.style.top = '';
                    this.container.style.left = '0';
                    this.container.style.transform = '';
                }
            };

            // Collapse / Expand
            document.getElementById('st-btn-collapse').onclick = () => {
                this.isCollapsed = !this.isCollapsed;
                if (this.isCollapsed) {
                    this.container.classList.add('collapsed');
                } else {
                    this.container.classList.remove('collapsed');
                }
            };

            // Close
            document.getElementById('st-btn-close').onclick = () => {
                this.hide();
            };
        }

        bindDragResizer() {
            const resizer = document.getElementById('st-drag-resizer');
            let isDragging = false;
            let startY, startHeight;

            resizer.addEventListener('mousedown', (e) => {
                if (this.isDetached) return;
                isDragging = true;
                startY = e.clientY;
                startHeight = this.container.offsetHeight;
                document.body.style.cursor = 'ns-resize';
                document.body.style.userSelect = 'none';
            });

            window.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                const delta = startY - e.clientY;
                let newHeight = startHeight + delta;
                if (newHeight >= this.minHeight && newHeight <= this.maxHeight) {
                    this.height = newHeight;
                    this.container.style.height = `${newHeight}px`;
                }
            });

            window.addEventListener('mouseup', () => {
                if (isDragging) {
                    isDragging = false;
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                }
            });
        }

        show() {
            this.container.style.display = 'flex';
            this.launcherPill.style.display = 'none';
            if (this.currentData) this.renderActiveTab();
        }

        hide() {
            this.container.style.display = 'none';
            if (this.currentData) {
                this.launcherPill.style.display = 'flex';
                const pnl = this.currentData.summary.netProfit;
                const pillPnl = document.getElementById('st-pill-pnl');
                pillPnl.textContent = `${pnl >= 0 ? '+' : ''}₹${pnl.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
                pillPnl.style.color = pnl >= 0 ? '#089981' : '#f23645';
            }
        }

        updateData(data) {
            this.currentData = data;
            document.getElementById('st-strategy-name').textContent = data.strategyName || 'Strategy Tester';
            this.show();
            this.renderActiveTab();
        }

        renderActiveTab() {
            if (!this.currentData) return;
            const body = document.getElementById('st-body');

            switch (this.activeTab) {
                case 'overview':
                    this.renderOverview(body);
                    break;
                case 'performance':
                    this.renderPerformance(body);
                    break;
                case 'chains':
                    this.renderTradeChains(body);
                    break;
                case 'trades':
                    this.renderTradesList(body);
                    break;
                case 'settings':
                    this.renderSettings(body);
                    break;
            }
        }

        renderOverview(body) {
            const s = this.currentData.summary;
            const isProfit = s.netProfit >= 0;

            body.innerHTML = `
                <div class="st-metrics-grid">
                    <div class="st-metric-card">
                        <div class="st-metric-label">Net Profit</div>
                        <div class="st-metric-value ${isProfit ? 'profit' : 'loss'}">
                            ${isProfit ? '+' : ''}₹${s.netProfit.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                            <span style="font-size:12px; font-weight:600;">(${s.netProfitPct.toFixed(2)}%)</span>
                        </div>
                    </div>
                    <div class="st-metric-card">
                        <div class="st-metric-label">Profit Factor</div>
                        <div class="st-metric-value">${s.profitFactor.toFixed(2)}</div>
                    </div>
                    <div class="st-metric-card">
                        <div class="st-metric-label">Win Rate</div>
                        <div class="st-metric-value">${s.winRate.toFixed(1)}% <span style="font-size:11px; font-weight:500; color:#787b86;">(${s.winningChains}/${s.totalChains})</span></div>
                    </div>
                    <div class="st-metric-card">
                        <div class="st-metric-label">Total Trade Chains</div>
                        <div class="st-metric-value">${s.totalChains}</div>
                    </div>
                    <div class="st-metric-card">
                        <div class="st-metric-label">Max Drawdown</div>
                        <div class="st-metric-value loss">₹${s.maxDrawdownAbs.toLocaleString('en-IN', { maximumFractionDigits: 2 })} <span style="font-size:12px;">(${s.maxDrawdownPct.toFixed(2)}%)</span></div>
                    </div>
                    <div class="st-metric-card">
                        <div class="st-metric-label">Sharpe Ratio</div>
                        <div class="st-metric-value">${s.sharpeRatio}</div>
                    </div>
                </div>

                <div class="st-equity-container">
                    <div style="font-size:12px; font-weight:700; color:#131722; margin-bottom:8px; display:flex; justify-content:space-between;">
                        <span>Equity Curve</span>
                        <span style="color:#787b86; font-weight:500;">Ending: ₹${s.endingEquity.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                    </div>
                    <div id="st-equity-chart">${this.renderEquitySVG(this.currentData.equitySeries)}</div>
                </div>
            `;
        }

        renderEquitySVG(series) {
            if (!series || series.length < 2) {
                return '<div style="color:#787b86; font-size:12px; padding:20px; text-align:center;">Not enough trades to plot equity curve</div>';
            }

            const width = 800;
            const height = 130;
            const padding = { top: 10, right: 20, bottom: 20, left: 50 };

            const values = series.map(d => d.equity);
            const min = Math.min(...values) * 0.98;
            const max = Math.max(...values) * 1.02;

            const getX = (i) => padding.left + (i / (series.length - 1)) * (width - padding.left - padding.right);
            const getY = (val) => padding.top + (1 - (val - min) / (max - min || 1)) * (height - padding.top - padding.bottom);

            let pathD = `M ${getX(0)} ${getY(values[0])}`;
            for (let i = 1; i < values.length; i++) {
                pathD += ` L ${getX(i)} ${getY(values[i])}`;
            }

            const areaD = `${pathD} L ${getX(values.length - 1)} ${height - padding.bottom} L ${getX(0)} ${height - padding.bottom} Z`;

            return `
                <svg class="st-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
                    <defs>
                        <linearGradient id="stEquityGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="#2962FF" stop-opacity="0.25"/>
                            <stop offset="100%" stop-color="#2962FF" stop-opacity="0.0"/>
                        </linearGradient>
                    </defs>
                    <line x1="${padding.left}" y1="${getY(series[0].equity)}" x2="${width - padding.right}" y2="${getY(series[0].equity)}" stroke="#e0e3eb" stroke-dasharray="4" />
                    <path d="${areaD}" fill="url(#stEquityGrad)" />
                    <path d="${pathD}" fill="none" stroke="#2962FF" stroke-width="2" />
                </svg>
            `;
        }

        renderPerformance(body) {
            const s = this.currentData.summary;

            body.innerHTML = `
                <table class="st-table">
                    <thead>
                        <tr>
                            <th>Performance Metric</th>
                            <th>All Trade Chains</th>
                            <th>Long Chains</th>
                            <th>Short Chains</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td>Net Profit</td><td class="${s.netProfit >= 0 ? 'profit' : 'loss'}">₹${s.netProfit.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td><td>₹${s.longNetProfit.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td><td>₹${s.shortNetProfit.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td></tr>
                        <tr><td>Gross Profit</td><td class="profit">₹${s.grossProfit.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td><td>-</td><td>-</td></tr>
                        <tr><td>Gross Loss</td><td class="loss">₹${s.grossLoss.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td><td>-</td><td>-</td></tr>
                        <tr><td>Profit Factor</td><td>${s.profitFactor.toFixed(2)}</td><td>-</td><td>-</td></tr>
                        <tr><td>Total Chains</td><td>${s.totalChains}</td><td>${s.longChainsCount}</td><td>${s.shortChainsCount}</td></tr>
                        <tr><td>Win Rate</td><td>${s.winRate.toFixed(1)}%</td><td>-</td><td>-</td></tr>
                        <tr><td>Average Trade PnL</td><td class="${s.avgTradePnL >= 0 ? 'profit' : 'loss'}">₹${s.avgTradePnL.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td><td>-</td><td>-</td></tr>
                        <tr><td>Avg Winning Trade</td><td class="profit">₹${s.avgWinPnL.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td><td>-</td><td>-</td></tr>
                        <tr><td>Avg Losing Trade</td><td class="loss">₹${s.avgLossPnL.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td><td>-</td><td>-</td></tr>
                        <tr><td>Win / Loss Ratio</td><td>${s.winLossRatio.toFixed(2)}</td><td>-</td><td>-</td></tr>
                        <tr><td>Largest Winning Chain</td><td class="profit">₹${s.largestWin.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td><td>-</td><td>-</td></tr>
                        <tr><td>Largest Losing Chain</td><td class="loss">₹${s.largestLoss.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td><td>-</td><td>-</td></tr>
                        <tr><td>Max Consecutive Wins</td><td>${s.maxWinStreak}</td><td>-</td><td>-</td></tr>
                        <tr><td>Max Consecutive Losses</td><td>${s.maxLossStreak}</td><td>-</td><td>-</td></tr>
                        <tr><td>Average Bars in Trade</td><td>${s.avgBarsInTrade} bars</td><td>-</td><td>-</td></tr>
                        <tr><td>Sharpe Ratio / Sortino</td><td>${s.sharpeRatio} / ${s.sortinoRatio}</td><td>-</td><td>-</td></tr>
                    </tbody>
                </table>
            `;
        }

        renderTradeChains(body) {
            const chains = this.currentData.closedChains || [];
            if (chains.length === 0) {
                body.innerHTML = '<div style="color:#787b86; text-align:center; padding:40px;">No trade chains closed yet.</div>';
                return;
            }

            let html = `
                <table class="st-table">
                    <thead>
                        <tr>
                            <th>Chain ID</th>
                            <th>Direction</th>
                            <th>Start Date</th>
                            <th>End Date</th>
                            <th>Bars</th>
                            <th>Entries / Exits</th>
                            <th>Net Profit (₹)</th>
                            <th>Return %</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            chains.forEach((c, idx) => {
                const isProf = c.netPnL >= 0;
                const startDateStr = new Date(c.startTime).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
                const endDateStr = c.endTime ? new Date(c.endTime).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : 'Open';

                html += `
                    <tr class="st-chain-row" onclick="window.StrategyTesterUI.toggleChainLegs(${idx})">
                        <td><strong>${c.chainId}</strong></td>
                        <td style="color:${c.direction === 'LONG' ? '#089981' : '#f23645'}">${c.direction}</td>
                        <td>${startDateStr}</td>
                        <td>${endDateStr}</td>
                        <td>${c.bars || 1}</td>
                        <td>${c.entries.length} / ${c.exits.length}</td>
                        <td class="${isProf ? 'profit' : 'loss'}">${isProf ? '+' : ''}₹${c.netPnL.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                        <td class="${isProf ? 'profit' : 'loss'}">${c.returnPct.toFixed(2)}%</td>
                        <td><span class="st-badge">${c.status}</span></td>
                    </tr>
                    <tr id="st-chain-legs-${idx}" style="display:none;">
                        <td colspan="9">
                            <div class="st-leg-subtable">
                                <div style="font-weight:700; margin-bottom:4px; font-size:11px; color:#787b86;">INDIVIDUAL TRADE LEGS IN CHAIN ${c.chainId}</div>
                                <table style="width:100%; font-size:11px;">
                                    <thead><tr><th>#</th><th>Action</th><th>Date & Time</th><th>Price</th><th>Qty</th><th>PnL (₹)</th></tr></thead>
                                    <tbody>
                                        ${c.legs.map(l => `
                                            <tr onclick="window.StrategyTesterUI.jumpToCandle(${l.time})">
                                                <td>${l.tradeNumber}</td>
                                                <td style="color:${l.action === 'BUY' ? '#089981' : '#f23645'}">${l.action}</td>
                                                <td>${new Date(l.time).toLocaleString('en-IN')}</td>
                                                <td>${l.price.toFixed(2)}</td>
                                                <td>${l.qty}</td>
                                                <td class="${l.pnl >= 0 ? 'profit' : 'loss'}">${l.pnl !== 0 ? (l.pnl > 0 ? '+' : '') + '₹' + l.pnl.toFixed(2) : '-'}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </td>
                    </tr>
                `;
            });

            html += `</tbody></table>`;
            body.innerHTML = html;
        }

        renderTradesList(body) {
            const trades = this.currentData.executedTrades || [];
            if (trades.length === 0) {
                body.innerHTML = '<div style="color:#787b86; text-align:center; padding:40px;">No trades executed yet.</div>';
                return;
            }

            let html = `
                <table class="st-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Chain ID</th>
                            <th>Type</th>
                            <th>Date & Time</th>
                            <th>Price</th>
                            <th>Quantity</th>
                            <th>Trade PnL (₹)</th>
                            <th>Cumulative Equity (₹)</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            trades.forEach(t => {
                const isProf = t.pnl >= 0;
                const dt = new Date(t.time).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
                html += `
                    <tr onclick="window.StrategyTesterUI.jumpToCandle(${t.time})" title="Click to jump to candle on chart">
                        <td>${t.tradeNumber}</td>
                        <td><strong>${t.chainId}</strong></td>
                        <td style="color:${t.action === 'BUY' ? '#089981' : '#f23645'}">${t.action}</td>
                        <td>${dt}</td>
                        <td>${t.price.toFixed(2)}</td>
                        <td>${t.qty}</td>
                        <td class="${isProf ? 'profit' : 'loss'}">${t.pnl !== 0 ? (isProf ? '+' : '') + '₹' + t.pnl.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '-'}</td>
                        <td style="font-weight:600;">₹${t.cumulativeEquity.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    </tr>
                `;
            });

            html += `</tbody></table>`;
            body.innerHTML = html;
        }

        renderSettings(body) {
            const cfg = this.currentData.config || {};

            body.innerHTML = `
                <div style="max-width:540px; display:flex; flex-direction:column; gap:16px;">
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <label style="font-size:12px; font-weight:600; color:#131722;">Initial Capital (₹)</label>
                        <input type="number" id="st-set-capital" value="${cfg.initialCapital || 100000}" style="padding:8px 12px; border:1px solid #e0e3eb; border-radius:6px; font-size:14px;" />
                    </div>

                    <div style="display:flex; align-items:center; gap:8px;">
                        <input type="checkbox" id="st-set-compounding" ${cfg.compounding !== false ? 'checked' : ''} style="width:16px; height:16px;" />
                        <label for="st-set-compounding" style="font-size:13px; font-weight:600; color:#131722; cursor:pointer;">Compounding Capital (Reinvest chain profits)</label>
                    </div>

                    <div style="display:flex; gap:12px;">
                        <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
                            <label style="font-size:12px; font-weight:600; color:#131722;">Commission Type</label>
                            <select id="st-set-comm-type" style="padding:8px; border:1px solid #e0e3eb; border-radius:6px; font-size:13px;">
                                <option value="none" ${cfg.commissionType === 'none' ? 'selected' : ''}>None</option>
                                <option value="fixed" ${cfg.commissionType === 'fixed' ? 'selected' : ''}>Fixed ₹ per trade</option>
                                <option value="percent" ${cfg.commissionType === 'percent' ? 'selected' : ''}>Percentage % of value</option>
                            </select>
                        </div>
                        <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
                            <label style="font-size:12px; font-weight:600; color:#131722;">Commission Value</label>
                            <input type="number" step="0.01" id="st-set-comm-val" value="${cfg.commissionValue || 0}" style="padding:8px 12px; border:1px solid #e0e3eb; border-radius:6px; font-size:14px;" />
                        </div>
                    </div>

                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <label style="font-size:12px; font-weight:600; color:#131722;">Slippage (Points per trade)</label>
                        <input type="number" step="0.05" id="st-set-slippage" value="${cfg.slippage || 0}" style="padding:8px 12px; border:1px solid #e0e3eb; border-radius:6px; font-size:14px;" />
                    </div>

                    <button id="st-btn-save-settings" style="padding:10px 16px; background:#2962FF; color:#fff; border:none; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer; margin-top:8px;">
                        Recalculate & Apply
                    </button>
                </div>
            `;

            document.getElementById('st-btn-save-settings').onclick = () => {
                const capital = parseFloat(document.getElementById('st-set-capital').value) || 100000;
                const compounding = document.getElementById('st-set-compounding').checked;
                const commType = document.getElementById('st-set-comm-type').value;
                const commVal = parseFloat(document.getElementById('st-set-comm-val').value) || 0;
                const slippage = parseFloat(document.getElementById('st-set-slippage').value) || 0;

                const ctx = window.StrategyEngine.getContext(this.currentData.strategyName);
                if (ctx) {
                    ctx.config.initialCapital = capital;
                    ctx.config.compounding = compounding;
                    ctx.config.commissionType = commType;
                    ctx.config.commissionValue = commVal;
                    ctx.config.slippage = slippage;
                    window.StrategyEngine.calculateAndEmit(ctx);
                }
            };
        }

        toggleChainLegs(idx) {
            const el = document.getElementById(`st-chain-legs-${idx}`);
            if (el) {
                el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
            }
        }

        jumpToCandle(timeMs) {
            if (!window.tvWidget) return;
            try {
                const chart = window.tvWidget.activeChart();
                const timeSec = Math.floor(timeMs / 1000);
                const halfSpan = 3600 * 4; // 4 hours window
                chart.setVisibleRange({
                    from: timeSec - halfSpan,
                    to: timeSec + halfSpan
                }, () => {});
            } catch (e) {
                console.warn("Failed to jump to candle", e);
            }
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        window.StrategyTesterUI = new StrategyTesterUI();
    });

})(window);
