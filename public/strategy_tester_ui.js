/**
 * StrategyTesterUI - Resizable & Detachable Strategy Backtesting Panel
 * Features:
 * - Smooth bottom drag resizer with pointer capture (no text selection / slipping)
 * - Detachable floating popup window with draggable header & corner resize handle
 * - Fullscreen / Maximize toggle in popup and docked modes
 * - Complete automatic cleanup (hides panel & launcher pill, clears chart markers) on strategy removal
 * - Modern, clean, crisp TradingView-themed UI with clean currency formatting (-₹74.80)
 * - Beautiful SVG Equity Curve with gradient fill & baseline
 * - Interactive trade list with click-to-candle chart navigation
 */

(function (window) {
    'use strict';

    class StrategyTesterUI {
        constructor() {
            this.container = null;
            this.launcherPill = null;
            this.activeTab = 'overview';
            this.isDetached = false;
            this.isCollapsed = false;
            this.isFullscreen = false;
            this.currentData = null;
            this.height = 320;
            this.minHeight = 160;
            this.maxHeight = window.innerHeight * 0.88;

            // Saved popup bounds for restore
            this.popupWidth = 880;
            this.popupHeight = 540;
            this.popupTop = null;
            this.popupLeft = null;

            this.init();
        }

        init() {
            this.injectStyles();
            this.buildDOM();
            this.bindEvents();
            this.bindDragResizer();
            this.bindPopupMoverAndResizer();
            this.startStrategyRemovalWatcher();
        }

        formatCurrency(num, showPlus = false) {
            if (num === null || num === undefined || isNaN(num)) return '₹0.00';
            const val = Number(num);
            const isNeg = val < 0;
            const absStr = Math.abs(val).toLocaleString('en-IN', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
            if (isNeg) return `-₹${absStr}`;
            if (showPlus && val > 0) return `+₹${absStr}`;
            return `₹${absStr}`;
        }

        injectStyles() {
            const style = document.createElement('style');
            style.id = 'strategy-tester-styles';
            style.textContent = `
                /* Strategy Tester Panel */
                #strategy-tester-panel {
                    position: fixed;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    height: 320px;
                    background: #ffffff;
                    border-top: 1px solid #e0e3eb;
                    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.08);
                    z-index: 9999;
                    display: none;
                    flex-direction: column;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    box-sizing: border-box;
                    color: #131722;
                }

                /* Resizing states */
                body.st-resizing, body.st-resizing * {
                    user-select: none !important;
                    -webkit-user-select: none !important;
                }
                body.st-resizing-ns {
                    cursor: ns-resize !important;
                }
                body.st-resizing-nwse {
                    cursor: nwse-resize !important;
                }
                body.st-moving-popup {
                    cursor: move !important;
                }

                /* Detached Popup Mode */
                #strategy-tester-panel.detached {
                    position: fixed !important;
                    bottom: auto !important;
                    right: auto !important;
                    border: 1px solid #d1d4dc;
                    border-radius: 10px;
                    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.22);
                    min-width: 480px;
                    min-height: 260px;
                    max-width: 98vw;
                    max-height: 98vh;
                    overflow: hidden;
                    resize: both;
                }

                /* Fullscreen / Maximized Mode */
                #strategy-tester-panel.fullscreen {
                    top: 0 !important;
                    left: 0 !important;
                    right: 0 !important;
                    bottom: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    max-width: 100vw !important;
                    max-height: 100vh !important;
                    border-radius: 0 !important;
                    border: none !important;
                    z-index: 10000 !important;
                    resize: none !important;
                }

                /* Collapsed Bottom Dock */
                #strategy-tester-panel.collapsed {
                    height: 42px !important;
                    overflow: hidden;
                    resize: none !important;
                }

                /* Drag Resizer Bar (Docked mode) */
                .st-resizer {
                    height: 6px;
                    background: transparent;
                    cursor: ns-resize;
                    width: 100%;
                    position: absolute;
                    top: 0;
                    left: 0;
                    z-index: 25;
                    transition: background 0.15s ease;
                }
                .st-resizer:hover, .st-resizer.active {
                    background: #2962FF;
                }
                #strategy-tester-panel.detached .st-resizer,
                #strategy-tester-panel.fullscreen .st-resizer {
                    display: none !important;
                }

                /* Popup Corner Resizer Grip */
                .st-popup-resizer {
                    display: none;
                    position: absolute;
                    right: 2px;
                    bottom: 2px;
                    width: 16px;
                    height: 16px;
                    cursor: nwse-resize;
                    z-index: 30;
                    background: linear-gradient(135deg, transparent 0%, transparent 50%, #94a3b8 50%, #94a3b8 100%);
                    opacity: 0.6;
                    transition: opacity 0.2s;
                }
                .st-popup-resizer:hover {
                    opacity: 1;
                }
                #strategy-tester-panel.detached:not(.fullscreen) .st-popup-resizer {
                    display: block;
                }

                /* Header */
                .st-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0 14px;
                    height: 42px;
                    background: #f8fafc;
                    border-bottom: 1px solid #e2e8f0;
                    user-select: none;
                    flex-shrink: 0;
                    box-sizing: border-box;
                }
                #strategy-tester-panel.detached:not(.fullscreen) .st-header {
                    cursor: move;
                }

                .st-title-area {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    cursor: default;
                }

                .st-title {
                    font-size: 13px;
                    font-weight: 700;
                    color: #0f172a;
                    display: flex;
                    align-items: center;
                    gap: 7px;
                    white-space: nowrap;
                }

                .st-badge {
                    font-size: 10px;
                    font-weight: 700;
                    text-transform: uppercase;
                    background: #eff6ff;
                    color: #2563eb;
                    padding: 2px 7px;
                    border-radius: 4px;
                    letter-spacing: 0.3px;
                    border: 1px solid #dbeafe;
                }

                /* Tabs Navigation */
                .st-tabs {
                    display: flex;
                    align-items: center;
                    gap: 3px;
                    margin-left: 14px;
                    cursor: default;
                }

                .st-tab {
                    padding: 5px 11px;
                    font-size: 12px;
                    font-weight: 600;
                    color: #64748b;
                    cursor: pointer;
                    border-radius: 6px;
                    transition: all 0.15s ease;
                    white-space: nowrap;
                }
                .st-tab:hover {
                    background: #e2e8f0;
                    color: #0f172a;
                }
                .st-tab.active {
                    background: #ffffff;
                    color: #2563eb;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
                    border: 1px solid #e2e8f0;
                }

                /* Action Buttons */
                .st-actions {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    cursor: default;
                }

                .st-icon-btn {
                    width: 28px;
                    height: 28px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 6px;
                    cursor: pointer;
                    color: #64748b;
                    transition: all 0.15s ease;
                }
                .st-icon-btn:hover {
                    background: #e2e8f0;
                    color: #0f172a;
                }

                /* Panel Body Content */
                .st-body {
                    flex: 1;
                    overflow: auto;
                    padding: 16px;
                    background: #ffffff;
                    box-sizing: border-box;
                }

                /* Metric Cards Grid */
                .st-metrics-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
                    gap: 12px;
                    margin-bottom: 16px;
                }

                .st-metric-card {
                    background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
                    border: 1px solid #e2e8f0;
                    border-radius: 10px;
                    padding: 12px 14px;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.02);
                }

                .st-metric-label {
                    font-size: 11px;
                    font-weight: 600;
                    color: #64748b;
                    text-transform: uppercase;
                    letter-spacing: 0.4px;
                }

                .st-metric-value {
                    font-size: 18px;
                    font-weight: 700;
                    color: #0f172a;
                    display: flex;
                    align-items: baseline;
                    gap: 6px;
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
                    background: #f8fafc;
                    color: #64748b;
                    font-weight: 600;
                    padding: 9px 12px;
                    border-bottom: 1px solid #e2e8f0;
                    position: sticky;
                    top: 0;
                    z-index: 2;
                    text-transform: uppercase;
                    font-size: 11px;
                    letter-spacing: 0.3px;
                }

                .st-table td {
                    padding: 9px 12px;
                    border-bottom: 1px solid #f1f5f9;
                    color: #0f172a;
                }

                .st-table tr:hover td {
                    background: #f8fafc;
                }

                .st-tag-long {
                    background: rgba(8, 153, 129, 0.12);
                    color: #089981;
                    padding: 2px 7px;
                    border-radius: 4px;
                    font-weight: 700;
                    font-size: 10px;
                }

                .st-tag-short {
                    background: rgba(242, 54, 69, 0.12);
                    color: #f23645;
                    padding: 2px 7px;
                    border-radius: 4px;
                    font-weight: 700;
                    font-size: 10px;
                }

                .st-leg-subtable {
                    background: #f8fafc;
                    padding: 10px 16px;
                    border-left: 3px solid #2563eb;
                    margin: 6px 0 10px 24px;
                    border-radius: 6px;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.04);
                }

                /* Equity Curve */
                .st-equity-container {
                    background: #ffffff;
                    border: 1px solid #e2e8f0;
                    border-radius: 10px;
                    padding: 14px;
                    margin-top: 12px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.02);
                }

                .st-chart-svg {
                    width: 100%;
                    height: 150px;
                    overflow: visible;
                }

                /* Floating Launcher Pill */
                #st-launcher-pill {
                    position: fixed;
                    bottom: 16px;
                    right: 20px;
                    background: #0f172a;
                    color: #ffffff;
                    border-radius: 30px;
                    padding: 8px 16px;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    display: none;
                    align-items: center;
                    gap: 9px;
                    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
                    z-index: 9998;
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    transition: transform 0.15s ease, background 0.15s ease;
                }
                #st-launcher-pill:hover {
                    background: #2563eb;
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
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
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
                            <svg id="st-icon-detach" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                        </div>
                        <div class="st-icon-btn" id="st-btn-maximize" title="Maximize / Restore">
                            <svg id="st-icon-maximize" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
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
                    <div id="st-content-loading" style="text-align:center; padding:40px; color:#64748b;">Waiting for strategy calculation...</div>
                </div>
                <div class="st-popup-resizer" id="st-popup-resizer" title="Drag to resize"></div>
            `;
            document.body.appendChild(panel);
            this.container = panel;

            // Launcher Pill
            const pill = document.createElement('div');
            pill.id = 'st-launcher-pill';
            pill.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                <span>Strategy Tester</span>
                <span id="st-pill-pnl" style="font-weight:700;"></span>
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
                tab.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.container.querySelectorAll('.st-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    this.activeTab = tab.getAttribute('data-tab');
                    this.renderActiveTab();
                });
            });

            // Detach / Dock
            document.getElementById('st-btn-detach').onclick = (e) => {
                e.stopPropagation();
                this.toggleDetach();
            };

            // Maximize / Restore
            document.getElementById('st-btn-maximize').onclick = (e) => {
                e.stopPropagation();
                this.toggleMaximize();
            };

            // Collapse / Expand
            document.getElementById('st-btn-collapse').onclick = (e) => {
                e.stopPropagation();
                this.isCollapsed = !this.isCollapsed;
                if (this.isCollapsed) {
                    this.container.classList.add('collapsed');
                } else {
                    this.container.classList.remove('collapsed');
                }
            };

            // Close (minimizes to launcher pill)
            document.getElementById('st-btn-close').onclick = (e) => {
                e.stopPropagation();
                this.hide();
            };
        }

        toggleDetach() {
            this.isDetached = !this.isDetached;
            if (this.isFullscreen) {
                this.container.classList.remove('fullscreen');
                this.isFullscreen = false;
                this.updateMaximizeIcon();
            }

            if (this.isDetached) {
                this.container.classList.add('detached');
                // Calculate centered position
                const width = Math.min(880, window.innerWidth * 0.92);
                const height = Math.min(540, window.innerHeight * 0.85);
                const top = Math.max(20, Math.floor((window.innerHeight - height) / 2));
                const left = Math.max(20, Math.floor((window.innerWidth - width) / 2));

                this.popupWidth = width;
                this.popupHeight = height;
                this.popupTop = top;
                this.popupLeft = left;

                this.container.style.width = `${width}px`;
                this.container.style.height = `${height}px`;
                this.container.style.top = `${top}px`;
                this.container.style.left = `${left}px`;
                this.container.style.right = 'auto';
                this.container.style.bottom = 'auto';
                this.container.style.transform = 'none';
            } else {
                this.container.classList.remove('detached');
                this.container.style.width = '';
                this.container.style.height = `${this.height}px`;
                this.container.style.top = '';
                this.container.style.left = '0';
                this.container.style.right = '0';
                this.container.style.bottom = '0';
                this.container.style.transform = '';
            }
        }

        toggleMaximize() {
            this.isFullscreen = !this.isFullscreen;
            if (this.isFullscreen) {
                this.container.classList.add('fullscreen');
            } else {
                this.container.classList.remove('fullscreen');
                if (this.isDetached) {
                    this.container.style.width = `${this.popupWidth}px`;
                    this.container.style.height = `${this.popupHeight}px`;
                    this.container.style.top = `${this.popupTop}px`;
                    this.container.style.left = `${this.popupLeft}px`;
                } else {
                    this.container.style.height = `${this.height}px`;
                }
            }
            this.updateMaximizeIcon();
        }

        updateMaximizeIcon() {
            const btn = document.getElementById('st-btn-maximize');
            if (!btn) return;
            if (this.isFullscreen) {
                btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
                btn.title = "Restore";
            } else {
                btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`;
                btn.title = "Maximize";
            }
        }

        bindDragResizer() {
            const resizer = document.getElementById('st-drag-resizer');
            let isDragging = false;
            let startY, startHeight;

            resizer.addEventListener('pointerdown', (e) => {
                if (this.isDetached || this.isCollapsed || this.isFullscreen) return;
                e.preventDefault();
                e.stopPropagation();

                try { resizer.setPointerCapture(e.pointerId); } catch (_) {}
                isDragging = true;
                startY = e.clientY;
                startHeight = this.container.offsetHeight;

                document.body.classList.add('st-resizing', 'st-resizing-ns');
                resizer.classList.add('active');

                // Temporarily disable iframe pointer events so mouse doesn't get trapped in chart
                document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
            });

            resizer.addEventListener('pointermove', (e) => {
                if (!isDragging) return;
                e.preventDefault();
                const delta = startY - e.clientY;
                let newHeight = startHeight + delta;
                if (newHeight >= this.minHeight && newHeight <= this.maxHeight) {
                    this.height = newHeight;
                    this.container.style.height = `${newHeight}px`;
                }
            });

            const stopDrag = (e) => {
                if (!isDragging) return;
                isDragging = false;
                try { resizer.releasePointerCapture(e.pointerId); } catch (_) {}
                document.body.classList.remove('st-resizing', 'st-resizing-ns');
                resizer.classList.remove('active');
                document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
            };

            resizer.addEventListener('pointerup', stopDrag);
            resizer.addEventListener('pointercancel', stopDrag);
        }

        bindPopupMoverAndResizer() {
            const header = document.getElementById('st-header');
            const popupResizer = document.getElementById('st-popup-resizer');

            // 1. Popup Drag to Move (Header)
            let isMoving = false;
            let moveStartX, moveStartY, panelStartX, panelStartY;

            header.addEventListener('pointerdown', (e) => {
                if (!this.isDetached || this.isFullscreen) return;
                // Ignore if clicked on buttons or tabs
                if (e.target.closest('.st-actions') || e.target.closest('.st-tab') || e.target.closest('input') || e.target.closest('button')) {
                    return;
                }

                e.preventDefault();
                e.stopPropagation();

                try { header.setPointerCapture(e.pointerId); } catch (_) {}
                isMoving = true;
                moveStartX = e.clientX;
                moveStartY = e.clientY;
                panelStartX = this.container.offsetLeft;
                panelStartY = this.container.offsetTop;

                document.body.classList.add('st-resizing', 'st-moving-popup');
                document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
            });

            header.addEventListener('pointermove', (e) => {
                if (!isMoving) return;
                e.preventDefault();
                const deltaX = e.clientX - moveStartX;
                const deltaY = e.clientY - moveStartY;

                const maxX = window.innerWidth - this.container.offsetWidth - 10;
                const maxY = window.innerHeight - this.container.offsetHeight - 10;

                const newLeft = Math.max(10, Math.min(maxX, panelStartX + deltaX));
                const newTop = Math.max(10, Math.min(maxY, panelStartY + deltaY));

                this.popupLeft = newLeft;
                this.popupTop = newTop;
                this.container.style.left = `${newLeft}px`;
                this.container.style.top = `${newTop}px`;
            });

            const stopMove = (e) => {
                if (!isMoving) return;
                isMoving = false;
                try { header.releasePointerCapture(e.pointerId); } catch (_) {}
                document.body.classList.remove('st-resizing', 'st-moving-popup');
                document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
            };

            header.addEventListener('pointerup', stopMove);
            header.addEventListener('pointercancel', stopMove);

            // 2. Popup Corner Resizer
            let isCornerResizing = false;
            let resizeStartX, resizeStartY, startW, startH;

            popupResizer.addEventListener('pointerdown', (e) => {
                if (!this.isDetached || this.isFullscreen) return;
                e.preventDefault();
                e.stopPropagation();

                try { popupResizer.setPointerCapture(e.pointerId); } catch (_) {}
                isCornerResizing = true;
                resizeStartX = e.clientX;
                resizeStartY = e.clientY;
                startW = this.container.offsetWidth;
                startH = this.container.offsetHeight;

                document.body.classList.add('st-resizing', 'st-resizing-nwse');
                document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
            });

            popupResizer.addEventListener('pointermove', (e) => {
                if (!isCornerResizing) return;
                e.preventDefault();
                const deltaX = e.clientX - resizeStartX;
                const deltaY = e.clientY - resizeStartY;

                const newW = Math.max(480, Math.min(window.innerWidth - this.container.offsetLeft - 10, startW + deltaX));
                const newH = Math.max(260, Math.min(window.innerHeight - this.container.offsetTop - 10, startH + deltaY));

                this.popupWidth = newW;
                this.popupHeight = newH;
                this.container.style.width = `${newW}px`;
                this.container.style.height = `${newH}px`;
            });

            const stopCornerResize = (e) => {
                if (!isCornerResizing) return;
                isCornerResizing = false;
                try { popupResizer.releasePointerCapture(e.pointerId); } catch (_) {}
                document.body.classList.remove('st-resizing', 'st-resizing-nwse');
                document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
            };

            popupResizer.addEventListener('pointerup', stopCornerResize);
            popupResizer.addEventListener('pointercancel', stopCornerResize);
        }

        startStrategyRemovalWatcher() {
            // Heartbeat check every 800ms to verify if the strategy is still loaded on the chart
            setInterval(() => {
                this.checkStrategyPresence();
            }, 800);
        }

        checkStrategyPresence() {
            if (!window.tvWidget) return;
            try {
                const chart = window.tvWidget.activeChart();
                if (!chart) return;
                const studies = chart.getAllStudies() || [];

                const activeName = (window.StrategyEngine && window.StrategyEngine.activeStrategyName) || '';
                if (!activeName) {
                    if (this.currentData || this.container.style.display !== 'none' || this.launcherPill.style.display !== 'none') {
                        this.destroyAll();
                    }
                    return;
                }

                const actLower = activeName.toLowerCase();
                const hasMatchingStudy = studies.some(s => {
                    const sName = (s.name || '').toLowerCase();
                    return sName.includes(actLower) || actLower.includes(sName);
                });

                if (!hasMatchingStudy) {
                    this.destroyAll();
                }
            } catch (_) {}
        }

        destroyAll() {
            this.container.style.display = 'none';
            this.launcherPill.style.display = 'none';
            this.currentData = null;
            if (window.StrategyEngine) {
                window.StrategyEngine.clearTradeShapesOnChart();
                window.StrategyEngine.activeStrategyName = null;
                window.StrategyEngine.lastResults = null;
            }
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
                pillPnl.textContent = this.formatCurrency(pnl, true);
                pillPnl.style.color = pnl >= 0 ? '#10b981' : '#f43f5e';
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
                            ${this.formatCurrency(s.netProfit, true)}
                            <span style="font-size:12px; font-weight:600; opacity:0.85;">(${s.netProfitPct >= 0 ? '+' : ''}${s.netProfitPct.toFixed(2)}%)</span>
                        </div>
                    </div>
                    <div class="st-metric-card">
                        <div class="st-metric-label">Profit Factor</div>
                        <div class="st-metric-value">${s.profitFactor.toFixed(2)}</div>
                    </div>
                    <div class="st-metric-card">
                        <div class="st-metric-label">Win Rate</div>
                        <div class="st-metric-value">${s.winRate.toFixed(1)}% <span style="font-size:11px; font-weight:500; color:#64748b;">(${s.winningChains}/${s.totalChains})</span></div>
                    </div>
                    <div class="st-metric-card">
                        <div class="st-metric-label">Total Trade Chains</div>
                        <div class="st-metric-value">${s.totalChains}</div>
                    </div>
                    <div class="st-metric-card">
                        <div class="st-metric-label">Max Drawdown</div>
                        <div class="st-metric-value loss">${this.formatCurrency(s.maxDrawdownAbs)} <span style="font-size:12px; font-weight:600;">(${s.maxDrawdownPct.toFixed(2)}%)</span></div>
                    </div>
                    <div class="st-metric-card">
                        <div class="st-metric-label">Sharpe Ratio</div>
                        <div class="st-metric-value">${s.sharpeRatio}</div>
                    </div>
                </div>

                <div class="st-equity-container">
                    <div style="font-size:12px; font-weight:700; color:#0f172a; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
                        <span>Equity Curve (Compounding Capital)</span>
                        <span style="color:#64748b; font-weight:600; font-size:12px;">Ending Equity: <strong style="color:${isProfit ? '#089981' : '#f23645'};">${this.formatCurrency(s.endingEquity)}</strong></span>
                    </div>
                    <div id="st-equity-chart">${this.renderEquitySVG(this.currentData.equitySeries, s.initialCapital)}</div>
                </div>
            `;
        }

        renderEquitySVG(series, initialCapital = 100000) {
            if (!series || series.length < 2) {
                return '<div style="color:#64748b; font-size:12px; padding:30px; text-align:center;">Not enough trades executed to plot equity curve.</div>';
            }

            const width = 860;
            const height = 150;
            const padding = { top: 15, right: 30, bottom: 25, left: 60 };

            const values = series.map(d => d.equity);
            let min = Math.min(...values, initialCapital);
            let max = Math.max(...values, initialCapital);
            const range = max - min || 1;
            min -= range * 0.05;
            max += range * 0.05;

            const getX = (i) => padding.left + (i / (series.length - 1)) * (width - padding.left - padding.right);
            const getY = (val) => padding.top + (1 - (val - min) / (max - min)) * (height - padding.top - padding.bottom);

            let pathD = `M ${getX(0).toFixed(1)} ${getY(values[0]).toFixed(1)}`;
            for (let i = 1; i < values.length; i++) {
                pathD += ` L ${getX(i).toFixed(1)} ${getY(values[i]).toFixed(1)}`;
            }

            const bottomY = height - padding.bottom;
            const areaD = `${pathD} L ${getX(values.length - 1).toFixed(1)} ${bottomY} L ${getX(0).toFixed(1)} ${bottomY} Z`;

            const baselineY = getY(initialCapital);
            const isProfit = series[series.length - 1].equity >= initialCapital;
            const strokeColor = isProfit ? '#2563eb' : '#f43f5e';
            const gradId = isProfit ? 'stEquityGradBlue' : 'stEquityGradRed';

            return `
                <svg class="st-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
                    <defs>
                        <linearGradient id="stEquityGradBlue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="#2563eb" stop-opacity="0.22"/>
                            <stop offset="100%" stop-color="#2563eb" stop-opacity="0.0"/>
                        </linearGradient>
                        <linearGradient id="stEquityGradRed" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="#f43f5e" stop-opacity="0.22"/>
                            <stop offset="100%" stop-color="#f43f5e" stop-opacity="0.0"/>
                        </linearGradient>
                    </defs>
                    <!-- Baseline at Initial Capital -->
                    <line x1="${padding.left}" y1="${baselineY.toFixed(1)}" x2="${width - padding.right}" y2="${baselineY.toFixed(1)}" stroke="#cbd5e1" stroke-dasharray="4" stroke-width="1.5" />
                    <!-- Area & Curve -->
                    <path d="${areaD}" fill="url(#${gradId})" />
                    <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                    <!-- Labels -->
                    <text x="${padding.left - 8}" y="${getY(max).toFixed(1) + 4}" font-size="10" font-weight="600" fill="#94a3b8" text-anchor="end">₹${Math.round(max).toLocaleString('en-IN')}</text>
                    <text x="${padding.left - 8}" y="${baselineY.toFixed(1) + 4}" font-size="10" font-weight="600" fill="#64748b" text-anchor="end">₹${Math.round(initialCapital).toLocaleString('en-IN')}</text>
                    <text x="${padding.left - 8}" y="${getY(min).toFixed(1) + 4}" font-size="10" font-weight="600" fill="#94a3b8" text-anchor="end">₹${Math.round(min).toLocaleString('en-IN')}</text>
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
                        <tr><td>Net Profit</td><td class="${s.netProfit >= 0 ? 'profit' : 'loss'}"><strong>${this.formatCurrency(s.netProfit, true)}</strong></td><td>${this.formatCurrency(s.longNetProfit, true)}</td><td>${this.formatCurrency(s.shortNetProfit, true)}</td></tr>
                        <tr><td>Gross Profit</td><td class="profit">${this.formatCurrency(s.grossProfit, true)}</td><td>-</td><td>-</td></tr>
                        <tr><td>Gross Loss</td><td class="loss">${this.formatCurrency(s.grossLoss)}</td><td>-</td><td>-</td></tr>
                        <tr><td>Profit Factor</td><td><strong>${s.profitFactor.toFixed(2)}</strong></td><td>-</td><td>-</td></tr>
                        <tr><td>Total Chains</td><td>${s.totalChains}</td><td>${s.longChainsCount}</td><td>${s.shortChainsCount}</td></tr>
                        <tr><td>Win Rate</td><td><strong>${s.winRate.toFixed(1)}%</strong></td><td>-</td><td>-</td></tr>
                        <tr><td>Average Trade PnL</td><td class="${s.avgTradePnL >= 0 ? 'profit' : 'loss'}">${this.formatCurrency(s.avgTradePnL, true)}</td><td>-</td><td>-</td></tr>
                        <tr><td>Avg Winning Trade</td><td class="profit">${this.formatCurrency(s.avgWinPnL, true)}</td><td>-</td><td>-</td></tr>
                        <tr><td>Avg Losing Trade</td><td class="loss">${this.formatCurrency(s.avgLossPnL)}</td><td>-</td><td>-</td></tr>
                        <tr><td>Win / Loss Ratio</td><td>${s.winLossRatio.toFixed(2)}</td><td>-</td><td>-</td></tr>
                        <tr><td>Largest Winning Chain</td><td class="profit">${this.formatCurrency(s.largestWin, true)}</td><td>-</td><td>-</td></tr>
                        <tr><td>Largest Losing Chain</td><td class="loss">${this.formatCurrency(s.largestLoss)}</td><td>-</td><td>-</td></tr>
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
                body.innerHTML = '<div style="color:#64748b; text-align:center; padding:40px;">No trade chains closed yet.</div>';
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
                            <th>Net Profit</th>
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
                const dirBadge = c.direction === 'LONG' ? '<span class="st-tag-long">LONG</span>' : '<span class="st-tag-short">SHORT</span>';

                html += `
                    <tr class="st-chain-row" onclick="window.StrategyTesterUI.toggleChainLegs(${idx})" style="cursor:pointer;" title="Click to inspect legs">
                        <td><strong>${c.chainId}</strong></td>
                        <td>${dirBadge}</td>
                        <td>${startDateStr}</td>
                        <td>${endDateStr}</td>
                        <td>${c.bars || 1}</td>
                        <td>${c.entries.length} / ${c.exits.length}</td>
                        <td class="${isProf ? 'profit' : 'loss'}"><strong>${this.formatCurrency(c.netPnL, true)}</strong></td>
                        <td class="${isProf ? 'profit' : 'loss'}">${c.returnPct >= 0 ? '+' : ''}${c.returnPct.toFixed(2)}%</td>
                        <td><span class="st-badge">${c.status}</span></td>
                    </tr>
                    <tr id="st-chain-legs-${idx}" style="display:none;">
                        <td colspan="9">
                            <div class="st-leg-subtable">
                                <div style="font-weight:700; margin-bottom:6px; font-size:11px; color:#64748b;">INDIVIDUAL TRADE LEGS IN CHAIN ${c.chainId} (Click row to jump on chart)</div>
                                <table style="width:100%; font-size:11px;">
                                    <thead><tr><th>#</th><th>Action</th><th>Date & Time</th><th>Price</th><th>Qty</th><th>PnL</th></tr></thead>
                                    <tbody>
                                        ${c.legs.map(l => `
                                            <tr onclick="window.StrategyTesterUI.jumpToCandle(${l.time})" style="cursor:pointer;" title="Jump to candle">
                                                <td>${l.tradeNumber}</td>
                                                <td><span class="${l.action === 'BUY' ? 'st-tag-long' : 'st-tag-short'}">${l.action}</span></td>
                                                <td>${new Date(l.time).toLocaleString('en-IN')}</td>
                                                <td>${l.price.toFixed(2)}</td>
                                                <td>${l.qty}</td>
                                                <td class="${l.pnl >= 0 ? 'profit' : 'loss'}">${l.pnl !== 0 ? this.formatCurrency(l.pnl, true) : '-'}</td>
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
                body.innerHTML = '<div style="color:#64748b; text-align:center; padding:40px;">No trades executed yet.</div>';
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
                            <th>Trade PnL</th>
                            <th>Cumulative Equity</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            trades.forEach(t => {
                const isProf = t.pnl >= 0;
                const dt = new Date(t.time).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
                const typeBadge = t.action === 'BUY' ? '<span class="st-tag-long">BUY</span>' : '<span class="st-tag-short">SELL</span>';

                html += `
                    <tr onclick="window.StrategyTesterUI.jumpToCandle(${t.time})" style="cursor:pointer;" title="Click to jump to candle on chart">
                        <td>${t.tradeNumber}</td>
                        <td><strong>${t.chainId}</strong></td>
                        <td>${typeBadge}</td>
                        <td>${dt}</td>
                        <td>${t.price.toFixed(2)}</td>
                        <td>${t.qty}</td>
                        <td class="${isProf ? 'profit' : 'loss'}">${t.pnl !== 0 ? this.formatCurrency(t.pnl, true) : '-'}</td>
                        <td style="font-weight:600;">${this.formatCurrency(t.cumulativeEquity)}</td>
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
                    <div style="display:flex; flex-direction:column; gap:5px;">
                        <label style="font-size:12px; font-weight:600; color:#0f172a;">Initial Capital (₹)</label>
                        <input type="number" id="st-set-capital" value="${cfg.initialCapital || 100000}" style="padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:14px;" />
                    </div>

                    <div style="display:flex; align-items:center; gap:8px;">
                        <input type="checkbox" id="st-set-compounding" ${cfg.compounding !== false ? 'checked' : ''} style="width:16px; height:16px; cursor:pointer;" />
                        <label for="st-set-compounding" style="font-size:13px; font-weight:600; color:#0f172a; cursor:pointer;">Compounding Capital (Reinvest trade chain profits)</label>
                    </div>

                    <div style="display:flex; gap:12px;">
                        <div style="flex:1; display:flex; flex-direction:column; gap:5px;">
                            <label style="font-size:12px; font-weight:600; color:#0f172a;">Commission Type</label>
                            <select id="st-set-comm-type" style="padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px;">
                                <option value="none" ${cfg.commissionType === 'none' ? 'selected' : ''}>None</option>
                                <option value="fixed" ${cfg.commissionType === 'fixed' ? 'selected' : ''}>Fixed ₹ per order</option>
                                <option value="percent" ${cfg.commissionType === 'percent' ? 'selected' : ''}>Percentage % of turnover</option>
                            </select>
                        </div>
                        <div style="flex:1; display:flex; flex-direction:column; gap:5px;">
                            <label style="font-size:12px; font-weight:600; color:#0f172a;">Commission Value</label>
                            <input type="number" step="0.01" id="st-set-comm-val" value="${cfg.commissionValue || 0}" style="padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:14px;" />
                        </div>
                    </div>

                    <div style="display:flex; flex-direction:column; gap:5px;">
                        <label style="font-size:12px; font-weight:600; color:#0f172a;">Slippage (Points per order)</label>
                        <input type="number" step="0.05" id="st-set-slippage" value="${cfg.slippage || 0}" style="padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:14px;" />
                    </div>

                    <button id="st-btn-save-settings" style="padding:10px 18px; background:#2563eb; color:#ffffff; border:none; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer; margin-top:8px; transition:background 0.15s ease;">
                        Apply & Recalculate
                    </button>
                </div>
            `;

            document.getElementById('st-btn-save-settings').onclick = () => {
                const capital = parseFloat(document.getElementById('st-set-capital').value) || 100000;
                const compounding = document.getElementById('st-set-compounding').checked;
                const commType = document.getElementById('st-set-comm-type').value;
                const commVal = parseFloat(document.getElementById('st-set-comm-val').value) || 0;
                const slippage = parseFloat(document.getElementById('st-set-slippage').value) || 0;

                const ctx = window.StrategyEngine && window.StrategyEngine.getContext(this.currentData.strategyName);
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
                const timeSec = timeMs > 1e11 ? Math.floor(timeMs / 1000) : timeMs;
                const halfSpan = 3600 * 4; // 4 hours window around candle
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
