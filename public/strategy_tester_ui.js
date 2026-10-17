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

            // Date Range & Candle Highlight tracking
            this._highlightShapeIds = [];
            this.currentPreset = 'default';
            this.isDateManuallyEdited = false;
            this.isLoading = false;

            this.init();
        }

        init() {
            this.loadState();
            this.injectStyles();
            this.buildDOM();
            this.bindEvents();
            this.bindDragResizer();
            this.bindPopupMoverAndResizer();
            this.applyStateToDOM();
            this.startStrategyRemovalWatcher();
        }

        saveState() {
            try {
                const state = {
                    isDetached: this.isDetached,
                    isCollapsed: this.isCollapsed,
                    isFullscreen: this.isFullscreen,
                    activeTab: this.activeTab,
                    height: this.height,
                    popupWidth: this.popupWidth,
                    popupHeight: this.popupHeight,
                    popupTop: this.popupTop,
                    popupLeft: this.popupLeft,
                    currentPreset: this.currentPreset
                };
                localStorage.setItem('tv_strategy_tester_state', JSON.stringify(state));
            } catch (_) {}
        }

        loadState() {
            try {
                const saved = localStorage.getItem('tv_strategy_tester_state');
                if (!saved) return;
                const state = JSON.parse(saved);
                if (typeof state.isDetached === 'boolean') this.isDetached = state.isDetached;
                if (typeof state.isCollapsed === 'boolean') this.isCollapsed = state.isCollapsed;
                if (typeof state.isFullscreen === 'boolean') this.isFullscreen = state.isFullscreen;
                if (state.activeTab) this.activeTab = state.activeTab;
                if (Number(state.height) >= 140) this.height = Number(state.height);
                if (Number(state.popupWidth) >= 260) this.popupWidth = Number(state.popupWidth);
                if (Number(state.popupHeight) >= 160) this.popupHeight = Number(state.popupHeight);
                if (state.popupTop !== null && state.popupTop !== undefined && !isNaN(state.popupTop)) {
                    this.popupTop = Math.max(10, Math.min(window.innerHeight - 80, Number(state.popupTop)));
                }
                if (state.popupLeft !== null && state.popupLeft !== undefined && !isNaN(state.popupLeft)) {
                    this.popupLeft = Math.max(10, Math.min(window.innerWidth - 80, Number(state.popupLeft)));
                }
                if (state.currentPreset) this.currentPreset = state.currentPreset;
            } catch (_) {}
        }

        applyStateToDOM() {
            // 1. Detached popup vs docked bottom panel
            if (this.isDetached) {
                this.container.classList.add('detached');
                const isMobile = window.innerWidth <= 768;
                const width = this.popupWidth || (isMobile ? Math.min(window.innerWidth - 20, 360) : Math.min(880, window.innerWidth * 0.92));
                const height = this.popupHeight || (isMobile ? Math.min(window.innerHeight - 80, 420) : Math.min(540, window.innerHeight * 0.85));
                const top = this.popupTop !== null ? this.popupTop : (isMobile ? 30 : Math.max(20, Math.floor((window.innerHeight - height) / 2)));
                const left = this.popupLeft !== null ? this.popupLeft : (isMobile ? Math.max(10, Math.floor((window.innerWidth - width) / 2)) : Math.max(20, Math.floor((window.innerWidth - width) / 2)));

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
                this.container.style.height = `${this.height || 320}px`;
                this.container.style.top = '';
                this.container.style.left = '0';
                this.container.style.right = '0';
                this.container.style.bottom = '0';
                this.container.style.transform = '';
            }

            // 2. Fullscreen mode
            if (this.isFullscreen) {
                this.container.classList.add('fullscreen');
            } else {
                this.container.classList.remove('fullscreen');
            }

            // 3. Collapsed mode
            if (this.isCollapsed && !this.isFullscreen) {
                this.container.classList.add('collapsed');
            } else {
                this.container.classList.remove('collapsed');
            }

            // 4. Active tab
            if (this.activeTab) {
                this.container.querySelectorAll('.st-tab').forEach(t => {
                    if (t.getAttribute('data-tab') === this.activeTab) {
                        t.classList.add('active');
                    } else {
                        t.classList.remove('active');
                    }
                });
            }

            // 5. Preset button
            if (this.currentPreset) {
                this.setPresetActive(this.currentPreset);
            }

            this.updateHeaderActionButtons();
            this.updateChartLayout();
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
                    -webkit-touch-callout: none !important;
                    touch-action: none !important;
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
                    min-width: 260px;
                    min-height: 180px;
                    max-width: 98vw;
                    max-height: 98vh;
                    overflow: hidden;
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
                    min-height: 42px !important;
                    max-height: 42px !important;
                    overflow: hidden !important;
                    resize: none !important;
                }
                #strategy-tester-panel.collapsed #st-range-bar,
                #strategy-tester-panel.collapsed #st-loading-bar-container,
                #strategy-tester-panel.collapsed #st-body,
                #strategy-tester-panel.collapsed #st-popup-resizer,
                #strategy-tester-panel.collapsed #st-btn-close {
                    display: none !important;
                }
                #strategy-tester-panel.collapsed .st-header,
                #strategy-tester-panel.collapsed .st-title-area {
                    cursor: pointer !important;
                }

                /* Fullscreen mode hides collapse/minimize button */
                #strategy-tester-panel.fullscreen #st-btn-collapse {
                    display: none !important;
                }

                /* Drag Resizer Bar (Docked mode) */
                .st-resizer {
                    height: 8px;
                    background: transparent;
                    cursor: ns-resize;
                    width: 100%;
                    position: absolute;
                    top: -4px;
                    left: 0;
                    z-index: 35;
                    transition: background 0.15s ease;
                    touch-action: none !important;
                    user-select: none !important;
                    -webkit-user-select: none !important;
                    -webkit-touch-callout: none !important;
                }
                .st-resizer::before {
                    content: '';
                    position: absolute;
                    top: -10px;
                    bottom: -10px;
                    left: 0;
                    right: 0;
                    touch-action: none;
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
                    right: 0;
                    bottom: 0;
                    width: 24px;
                    height: 24px;
                    cursor: nwse-resize;
                    z-index: 50;
                    background: linear-gradient(135deg, transparent 0%, transparent 45%, #94a3b8 45%, #94a3b8 60%, transparent 60%, transparent 75%, #64748b 75%, #64748b 100%);
                    opacity: 0.7;
                    transition: opacity 0.2s;
                    touch-action: none !important;
                    user-select: none !important;
                    -webkit-user-select: none !important;
                    -webkit-touch-callout: none !important;
                }
                .st-popup-resizer::before {
                    content: '';
                    position: absolute;
                    top: -12px;
                    left: -12px;
                    right: 0;
                    bottom: 0;
                    touch-action: none;
                }
                .st-popup-resizer:hover, .st-popup-resizer.active {
                    opacity: 1;
                }
                #strategy-tester-panel.detached:not(.fullscreen) .st-popup-resizer {
                    display: block !important;
                }

                /* Header */
                .st-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0 10px 0 14px;
                    height: 42px;
                    background: #f8fafc;
                    border-bottom: 1px solid #e2e8f0;
                    user-select: none;
                    -webkit-user-select: none;
                    flex-shrink: 0;
                    box-sizing: border-box;
                    touch-action: none;
                    gap: 8px;
                    overflow: hidden;
                    position: relative;
                }
                #strategy-tester-panel.detached:not(.fullscreen) .st-header {
                    cursor: move;
                }

                .st-title-area {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    min-width: 0;
                    flex: 1 1 auto;
                    overflow: hidden;
                }

                .st-title {
                    font-size: 13px;
                    font-weight: 700;
                    color: #0f172a;
                    display: flex;
                    align-items: center;
                    gap: 7px;
                    white-space: nowrap;
                    flex-shrink: 0;
                    max-width: 240px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                #st-strategy-name {
                    overflow: hidden;
                    text-overflow: ellipsis;
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
                    flex-shrink: 0;
                }

                /* Tabs Navigation */
                .st-tabs {
                    display: flex;
                    align-items: center;
                    gap: 3px;
                    margin-left: 8px;
                    overflow-x: auto;
                    overflow-y: hidden;
                    white-space: nowrap;
                    min-width: 0;
                    flex: 1 1 auto;
                    scrollbar-width: none;
                    -ms-overflow-style: none;
                    -webkit-overflow-scrolling: touch;
                }
                .st-tabs::-webkit-scrollbar {
                    display: none;
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
                    flex-shrink: 0;
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
                    gap: 4px;
                    cursor: default;
                    flex-shrink: 0 !important;
                    margin-left: auto;
                    z-index: 10;
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
                    flex-shrink: 0;
                }
                .st-icon-btn:hover {
                    background: #e2e8f0;
                    color: #0f172a;
                }

                /* Date Range Control Bar */
                .st-range-bar {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                    padding: 6px 14px;
                    background: #f8fafc;
                    border-bottom: 1px solid #e2e8f0;
                    font-size: 11px;
                    flex-shrink: 0;
                    box-sizing: border-box;
                    overflow-x: auto;
                }
                .st-range-left {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex-shrink: 0;
                }
                .st-range-label {
                    font-weight: 700;
                    color: #475569;
                    text-transform: uppercase;
                    font-size: 10px;
                    letter-spacing: 0.4px;
                }
                .st-range-presets {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .st-range-btn {
                    background: #ffffff;
                    border: 1px solid #cbd5e1;
                    color: #475569;
                    font-size: 11px;
                    font-weight: 600;
                    padding: 3px 8px;
                    border-radius: 4px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    white-space: nowrap;
                }
                .st-range-btn:hover {
                    background: #e2e8f0;
                    color: #0f172a;
                }
                .st-range-btn.active {
                    background: #2563eb;
                    color: #ffffff;
                    border-color: #2563eb;
                    box-shadow: 0 1px 3px rgba(37, 99, 235, 0.25);
                }
                .st-range-right {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex-shrink: 0;
                }
                .st-range-inputs {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .st-date-input {
                    background: #ffffff;
                    border: 1px solid #cbd5e1;
                    border-radius: 4px;
                    padding: 3px 6px;
                    font-size: 11px;
                    color: #0f172a;
                    outline: none;
                    font-family: inherit;
                    transition: border-color 0.15s ease;
                }
                .st-date-input:focus {
                    border-color: #2563eb;
                }
                .st-date-input:disabled {
                    background: #f1f5f9;
                    color: #94a3b8;
                    cursor: not-allowed;
                }
                .st-range-live-toggle {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    cursor: pointer;
                    font-weight: 600;
                    color: #0f172a;
                    user-select: none;
                    white-space: nowrap;
                }
                .st-range-live-toggle input {
                    cursor: pointer;
                    accent-color: #089981;
                }
                .st-range-apply-btn {
                    background: #2563eb;
                    color: #ffffff;
                    border: none;
                    border-radius: 4px;
                    padding: 3px 10px;
                    font-size: 11px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    white-space: nowrap;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                }
                .st-range-apply-btn:hover:not(:disabled) {
                    background: #1d4ed8;
                }
                .st-range-apply-btn:disabled {
                    background: #94a3b8 !important;
                    cursor: wait !important;
                    opacity: 0.8 !important;
                }
                .st-range-status {
                    font-size: 11px;
                    color: #64748b;
                    font-weight: 600;
                    white-space: nowrap;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                /* Range loading progress bar & spinner */
                .st-loading-bar-container {
                    height: 2px;
                    width: 100%;
                    overflow: hidden;
                    background: #e2e8f0;
                    position: relative;
                    z-index: 5;
                }
                .st-loading-bar-fill {
                    width: 40%;
                    height: 100%;
                    background: linear-gradient(90deg, #2563eb, #38bdf8, #2563eb);
                    animation: st-shimmer 1.1s infinite ease-in-out;
                }
                @keyframes st-shimmer {
                    0% { transform: translateX(-100%); }
                    50% { transform: translateX(60%); }
                    100% { transform: translateX(250%); }
                }
                @keyframes st-spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .st-btn-spinner {
                    display: inline-block;
                    width: 10px;
                    height: 10px;
                    border: 2px solid rgba(255,255,255,0.4);
                    border-top-color: #ffffff;
                    border-radius: 50%;
                    animation: st-spin 0.75s linear infinite;
                    vertical-align: middle;
                    margin-right: 5px;
                }
                .st-loading-spinner {
                    display: inline-block;
                    width: 11px;
                    height: 11px;
                    border: 2px solid rgba(37,99,235,0.25);
                    border-top-color: #2563eb;
                    border-radius: 50%;
                    animation: st-spin 0.75s linear infinite;
                    vertical-align: middle;
                    margin-right: 5px;
                }

                /* Panel Body Content */
                .st-body {
                    flex: 1;
                    overflow: auto;
                    padding: 14px 16px;
                    background: #ffffff;
                    box-sizing: border-box;
                    display: flex;
                    flex-direction: column;
                    min-height: 0;
                }

                .st-overview-tab {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    min-height: 0;
                    height: 100%;
                    box-sizing: border-box;
                }

                /* Metric Cards Grid */
                .st-metrics-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
                    gap: 10px;
                    margin-bottom: 12px;
                    flex-shrink: 0;
                }

                .st-metric-card {
                    background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
                    border: 1px solid #e2e8f0;
                    border-radius: 10px;
                    padding: 10px 12px;
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
                    font-size: 17px;
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
                    padding: 12px 14px;
                    margin-top: 0;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.02);
                    flex: 1;
                    min-height: 180px;
                    display: flex;
                    flex-direction: column;
                    box-sizing: border-box;
                    overflow: hidden;
                    position: relative;
                }

                .st-equity-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                    flex-shrink: 0;
                    font-size: 12px;
                    font-weight: 700;
                    color: #0f172a;
                }

                #st-equity-chart {
                    flex: 1;
                    width: 100%;
                    min-height: 140px;
                    position: relative;
                    overflow: hidden;
                }

                .st-equity-tooltip {
                    position: absolute;
                    background: rgba(15, 23, 42, 0.94);
                    color: #ffffff;
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    border-radius: 8px;
                    padding: 8px 12px;
                    font-size: 11px;
                    pointer-events: none;
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
                    z-index: 10;
                    display: none;
                    line-height: 1.4;
                    white-space: nowrap;
                    backdrop-filter: blur(4px);
                    transform: translate(-50%, 0);
                    margin-top: 0;
                    transition: opacity 0.1s ease;
                }

                /* Multi-strategy dropdown */
                .st-strategy-select {
                    font-size: 12px;
                    font-weight: 700;
                    color: #0f172a;
                    background: #ffffff;
                    border: 1px solid #cbd5e1;
                    border-radius: 6px;
                    padding: 3px 24px 3px 8px;
                    cursor: pointer;
                    outline: none;
                    max-width: 260px;
                    appearance: none;
                    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
                    background-repeat: no-repeat;
                    background-position: right 6px center;
                    transition: border-color 0.15s ease;
                }
                .st-strategy-select:hover {
                    border-color: #2563eb;
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

                /* Mobile & Small Screen Responsive Optimization */
                @media (max-width: 768px) {
                    #strategy-tester-panel.detached {
                        min-width: 260px !important;
                        min-height: 180px !important;
                        max-width: 98vw !important;
                        max-height: 95vh !important;
                        border-radius: 8px !important;
                        box-shadow: 0 10px 36px rgba(0, 0, 0, 0.3) !important;
                    }
                    .st-popup-resizer {
                        width: 28px !important;
                        height: 28px !important;
                        touch-action: none !important;
                    }
                    .st-resizer {
                        height: 10px !important;
                        top: -5px !important;
                        touch-action: none !important;
                    }
                    .st-header {
                        padding: 0 8px !important;
                        gap: 6px !important;
                    }
                    .st-title-area {
                        gap: 8px !important;
                        min-width: 0 !important;
                        flex: 1 !important;
                        overflow: hidden !important;
                    }
                    .st-title {
                        font-size: 12px !important;
                    }
                    .st-badge {
                        display: none !important;
                    }
                    .st-tabs {
                        margin-left: 4px !important;
                        overflow-x: auto !important;
                        white-space: nowrap !important;
                        -webkit-overflow-scrolling: touch !important;
                        scrollbar-width: none !important;
                    }
                    .st-tabs::-webkit-scrollbar {
                        display: none !important;
                    }
                    .st-tab {
                        padding: 4px 8px !important;
                        font-size: 11px !important;
                    }
                    .st-metrics-grid {
                        grid-template-columns: repeat(2, 1fr) !important;
                        gap: 6px !important;
                    }
                    .st-metric-card {
                        padding: 8px 10px !important;
                    }
                    .st-metric-label {
                        font-size: 9.5px !important;
                    }
                    .st-metric-value {
                        font-size: 14px !important;
                    }
                    .st-body {
                        padding: 10px 10px !important;
                        -webkit-overflow-scrolling: touch !important;
                    }
                    .st-table {
                        min-width: 520px !important;
                        white-space: nowrap !important;
                    }
                    .st-table th, .st-table td {
                        padding: 7px 9px !important;
                        font-size: 11px !important;
                    }
                    #st-launcher-pill {
                        bottom: 12px !important;
                        right: 12px !important;
                        padding: 6px 12px !important;
                        font-size: 11px !important;
                    }
                    .st-range-bar {
                        padding: 5px 8px !important;
                        gap: 6px !important;
                        flex-wrap: wrap !important;
                    }
                    .st-range-presets {
                        overflow-x: auto !important;
                        scrollbar-width: none !important;
                    }
                    .st-range-presets::-webkit-scrollbar {
                        display: none !important;
                    }
                    .st-range-btn {
                        padding: 2px 6px !important;
                        font-size: 10px !important;
                    }
                    .st-date-input {
                        padding: 2px 4px !important;
                        font-size: 10px !important;
                        max-width: 105px !important;
                    }
                    .st-range-status {
                        display: none !important;
                    }
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
                            <select id="st-strategy-select" class="st-strategy-select" style="display:none;" title="Select Active Strategy"></select>
                            <span class="st-badge" id="st-strategy-badge">Strategy</span>
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
                <div class="st-range-bar" id="st-range-bar">
                    <div class="st-range-left">
                        <span class="st-range-label">Range:</span>
                        <div class="st-range-presets" id="st-range-presets">
                            <button class="st-range-btn active" data-preset="default" title="Default: 40k bars or 1 year or max data">Max / 40k</button>
                            <button class="st-range-btn" data-preset="1Y" title="Last 1 Year">1Y</button>
                            <button class="st-range-btn" data-preset="6M" title="Last 6 Months">6M</button>
                            <button class="st-range-btn" data-preset="3M" title="Last 3 Months">3M</button>
                            <button class="st-range-btn" data-preset="1M" title="Last 1 Month">1M</button>
                            <button class="st-range-btn" data-preset="custom" title="Custom Date Range">Custom</button>
                        </div>
                    </div>
                    <div class="st-range-right">
                        <div class="st-range-inputs" id="st-range-inputs">
                            <input type="date" id="st-range-start-date" class="st-date-input" title="Start Date" />
                            <span style="color:#94a3b8; font-size:11px;">to</span>
                            <input type="date" id="st-range-end-date" class="st-date-input" title="End Date" disabled />
                            <label class="st-range-live-toggle" title="Keep updating live as new bars form">
                                <input type="checkbox" id="st-range-live-end" checked />
                                <span>Now (Live 🟢)</span>
                            </label>
                            <button id="st-btn-apply-range" class="st-range-apply-btn">Apply</button>
                        </div>
                        <div class="st-range-status" id="st-range-status-badge">
                            <span id="st-range-status-text">Range: Loading...</span>
                        </div>
                    </div>
                </div>
                <div class="st-loading-bar-container" id="st-loading-bar-container" style="display:none;">
                    <div class="st-loading-bar-fill"></div>
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

            // Listen for strategy list updates (multi-strategy additions / deletions / selection)
            window.addEventListener('strategy_list_updated', (e) => {
                this.syncStrategySelector(e.detail);
            });

            const selectEl = document.getElementById('st-strategy-select');
            if (selectEl) {
                selectEl.addEventListener('change', (e) => {
                    const val = e.target.value;
                    if (window.StrategyEngine) {
                        window.StrategyEngine.setActiveStrategy(val);
                    }
                });
            }

            // Tab switching & smooth scroll
            const tabsEl = this.container.querySelector('.st-tabs');
            if (tabsEl) {
                tabsEl.addEventListener('wheel', (e) => {
                    if (e.deltaY || e.deltaX) {
                        tabsEl.scrollLeft += (e.deltaY || e.deltaX);
                        e.preventDefault();
                    }
                }, { passive: false });
            }

            this.container.querySelectorAll('.st-tab').forEach(tab => {
                tab.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.container.querySelectorAll('.st-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    this.activeTab = tab.getAttribute('data-tab');
                    tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });

                    // When minimized in bottom panel, clicking any tab expands the panel for instant viewing
                    if (this.isCollapsed) {
                        this.isCollapsed = false;
                        this.container.classList.remove('collapsed');
                        this.updateHeaderActionButtons();
                        this.updateChartLayout();
                        setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
                    }

                    this.saveState();
                    this.renderActiveTab();
                });
            });

            // Expand when clicking header bar in collapsed state
            const header = document.getElementById('st-header');
            if (header) {
                header.addEventListener('click', (e) => {
                    if (e.target.closest('.st-actions') || e.target.closest('.st-tab') || e.target.closest('select') || e.target.closest('button') || e.target.closest('input')) return;
                    if (this.isCollapsed && !this.isDetached) {
                        this.isCollapsed = false;
                        this.container.classList.remove('collapsed');
                        this.updateHeaderActionButtons();
                        this.updateChartLayout();
                        this.saveState();
                        setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
                    }
                });
            }

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

            // Minimize / Collapse
            const collapseBtn = document.getElementById('st-btn-collapse');
            if (collapseBtn) {
                collapseBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (this.isFullscreen) return;

                    if (this.isDetached) {
                        // In popup mode: fully minimize into the launcher pill!
                        this.hide();
                    } else {
                        // In docked mode: collapse or expand the bottom bar
                        this.isCollapsed = !this.isCollapsed;
                        if (this.isCollapsed) {
                            this.container.classList.add('collapsed');
                        } else {
                            this.container.classList.remove('collapsed');
                        }
                        this.updateHeaderActionButtons();
                        this.updateChartLayout();
                        this.saveState();
                        setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
                    }
                };
            }

            // Range bar horizontal scroll via wheel
            const rangeBar = this.container.querySelector('.st-range-bar');
            if (rangeBar) {
                rangeBar.addEventListener('wheel', (e) => {
                    if (e.deltaY || e.deltaX) {
                        rangeBar.scrollLeft += (e.deltaY || e.deltaX);
                        e.preventDefault();
                    }
                }, { passive: false });
            }

            // Range presets
            const presetBtns = this.container.querySelectorAll('.st-range-btn');
            presetBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const preset = btn.getAttribute('data-preset');
                    this.applyDateRangePreset(preset);
                });
            });

            // Date inputs manual edit listeners (only switch to custom if user actually edited dates)
            const startDateInput = document.getElementById('st-range-start-date');
            const endDateInput = document.getElementById('st-range-end-date');
            const liveEndCb = document.getElementById('st-range-live-end');

            if (startDateInput) {
                const markCustom = () => {
                    this.isDateManuallyEdited = true;
                    this.setPresetActive('custom');
                    this.saveState();
                };
                startDateInput.addEventListener('input', markCustom);
                startDateInput.addEventListener('change', markCustom);
            }
            if (endDateInput) {
                const markCustom = () => {
                    this.isDateManuallyEdited = true;
                    this.setPresetActive('custom');
                    this.saveState();
                };
                endDateInput.addEventListener('input', markCustom);
                endDateInput.addEventListener('change', markCustom);
            }

            // Live end date toggle
            if (liveEndCb && endDateInput) {
                liveEndCb.addEventListener('change', (e) => {
                    const isLive = e.target.checked;
                    endDateInput.disabled = isLive;
                    if (!isLive && !endDateInput.value) {
                        endDateInput.value = new Date().toISOString().split('T')[0];
                    }
                });
            }

            // Apply range button (respects preset vs custom)
            const applyBtn = document.getElementById('st-btn-apply-range');
            if (applyBtn) {
                applyBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.applyRange();
                });
            }

            // Close button:
            // "closing the stretegy popup will just make it to a panel and mininmize it and will not close it fully"
            document.getElementById('st-btn-close').onclick = (e) => {
                e.stopPropagation();
                if (this.isDetached) {
                    // Dock to bottom panel
                    this.isDetached = false;
                    this.container.classList.remove('detached');
                    this.container.style.width = '';
                    this.container.style.height = `${this.height || 320}px`;
                    this.container.style.top = '';
                    this.container.style.left = '0';
                    this.container.style.right = '0';
                    this.container.style.bottom = '0';
                    this.container.style.transform = '';
                }
                if (this.isFullscreen) {
                    this.container.classList.remove('fullscreen');
                    this.isFullscreen = false;
                }
                // Minimize/collapse to bottom bar
                this.isCollapsed = true;
                this.container.classList.add('collapsed');
                this.updateHeaderActionButtons();
                this.updateChartLayout();
                this.saveState();
                setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
            };
        }

        updateChartLayout(overrideHeight = null) {
            const chartContainer = document.getElementById('tv_chart_container');
            if (!chartContainer) return;

            // In popup (detached) mode, or when hidden, or destroyed:
            // "while in popup mode do as doing now"
            if (this.isDetached || this.container.style.display === 'none') {
                chartContainer.style.bottom = '0px';
                chartContainer.style.height = '100%';
                return;
            }

            if (this.isFullscreen) {
                chartContainer.style.bottom = '0px';
                chartContainer.style.height = '0px';
                return;
            }

            if (this.isCollapsed) {
                chartContainer.style.bottom = '42px';
                chartContainer.style.height = 'calc(100% - 42px)';
                return;
            }

            // In docked panel mode: chart shrinks and fits the area left by the panel!
            const panelHeight = overrideHeight !== null ? overrideHeight : (this.height || 320);
            chartContainer.style.bottom = `${panelHeight}px`;
            chartContainer.style.height = `calc(100% - ${panelHeight}px)`;
        }

        toggleDetach() {
            this.isDetached = !this.isDetached;
            if (this.isFullscreen) {
                this.container.classList.remove('fullscreen');
                this.isFullscreen = false;
            }
            if (this.isCollapsed) {
                this.container.classList.remove('collapsed');
                this.isCollapsed = false;
            }

            if (this.isDetached) {
                this.container.classList.add('detached');
                const isMobile = window.innerWidth <= 768;
                const width = isMobile ? Math.min(window.innerWidth - 20, 360) : Math.min(880, window.innerWidth * 0.92);
                const height = isMobile ? Math.min(window.innerHeight - 80, 420) : Math.min(540, window.innerHeight * 0.85);
                const top = isMobile ? 30 : Math.max(20, Math.floor((window.innerHeight - height) / 2));
                const left = isMobile ? Math.max(10, Math.floor((window.innerWidth - width) / 2)) : Math.max(20, Math.floor((window.innerWidth - width) / 2));

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
            this.updateHeaderActionButtons();
            this.updateChartLayout();
            setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
        }

        toggleMaximize() {
            this.isFullscreen = !this.isFullscreen;
            if (this.isCollapsed) {
                this.container.classList.remove('collapsed');
                this.isCollapsed = false;
            }
            if (this.isFullscreen) {
                this.container.classList.add('fullscreen');
            } else {
                this.container.classList.remove('fullscreen');
                if (this.isDetached) {
                    this.container.style.width = `${this.popupWidth}px`;
                    this.container.style.height = `${this.popupHeight}px`;
                    this.container.style.top = `${this.popupTop}px`;
                    this.container.style.left = `${this.popupLeft}px`;
                    this.container.style.right = 'auto';
                    this.container.style.bottom = 'auto';
                } else {
                    this.container.style.height = `${this.height}px`;
                    this.container.style.width = '';
                    this.container.style.top = '';
                    this.container.style.left = '0';
                    this.container.style.right = '0';
                    this.container.style.bottom = '0';
                }
            }
            this.updateHeaderActionButtons();
            this.updateChartLayout();
            setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
        }

        updateHeaderActionButtons() {
            // 1. Maximize / Restore icon
            const maxBtn = document.getElementById('st-btn-maximize');
            if (maxBtn) {
                if (this.isFullscreen) {
                    maxBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
                    maxBtn.title = "Restore";
                } else {
                    maxBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`;
                    maxBtn.title = "Maximize";
                }
            }

            // 2. Minimize / Collapse button
            const colBtn = document.getElementById('st-btn-collapse');
            if (colBtn) {
                if (this.isFullscreen) {
                    // In fullscreen mode, minimize button serves no purpose
                    colBtn.style.display = 'none';
                } else if (this.isDetached) {
                    // In popup mode, minimize button fully minimizes to launcher pill
                    colBtn.style.display = 'flex';
                    colBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
                    colBtn.title = "Minimize to Floating Pill";
                } else {
                    // In docked mode, collapse or expand the bottom dock
                    colBtn.style.display = 'flex';
                    if (this.isCollapsed) {
                        colBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`;
                        colBtn.title = "Expand Panel";
                    } else {
                        colBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
                        colBtn.title = "Collapse to Bottom Bar";
                    }
                }
            }

            // 3. Close button
            const closeBtn = document.getElementById('st-btn-close');
            if (closeBtn) {
                if (this.isCollapsed && !this.isDetached) {
                    closeBtn.style.display = 'none';
                } else {
                    closeBtn.style.display = 'flex';
                }
                closeBtn.title = this.isDetached ? "Dock to Bottom Panel & Minimize" : "Collapse to Bottom Bar";
            }
        }

        updateMaximizeIcon() {
            this.updateHeaderActionButtons();
        }

        bindDragResizer() {
            const resizer = document.getElementById('st-drag-resizer');
            let isDragging = false;
            let startY, startHeight;

            const clearSelection = () => {
                if (window.getSelection) {
                    try { window.getSelection().removeAllRanges(); } catch (_) {}
                }
            };

            resizer.addEventListener('pointerdown', (e) => {
                if (this.isDetached || this.isCollapsed || this.isFullscreen) return;
                e.preventDefault();
                e.stopPropagation();
                clearSelection();

                try { resizer.setPointerCapture(e.pointerId); } catch (_) {}
                isDragging = true;
                startY = e.clientY;
                startHeight = this.container.offsetHeight;

                document.body.classList.add('st-resizing', 'st-resizing-ns');
                resizer.classList.add('active');

                // Temporarily disable iframe pointer events so touch/mouse doesn't get trapped in chart
                document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
            });

            resizer.addEventListener('pointermove', (e) => {
                if (!isDragging) return;
                e.preventDefault();
                clearSelection();

                const delta = startY - e.clientY;
                const minH = window.innerWidth <= 768 ? 120 : this.minHeight;
                const maxH = window.innerHeight * 0.90;
                let newHeight = startHeight + delta;
                if (newHeight >= minH && newHeight <= maxH) {
                    this.height = newHeight;
                    this.container.style.height = `${newHeight}px`;
                    this.updateChartLayout(newHeight);
                }
            });

            const stopDrag = (e) => {
                if (!isDragging) return;
                isDragging = false;
                if (e && e.pointerId) {
                    try { resizer.releasePointerCapture(e.pointerId); } catch (_) {}
                }
                document.body.classList.remove('st-resizing', 'st-resizing-ns');
                resizer.classList.remove('active');
                document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
                this.updateChartLayout();
                this.saveState();
                window.dispatchEvent(new Event('resize'));
            };

            resizer.addEventListener('pointerup', stopDrag);
            resizer.addEventListener('pointercancel', stopDrag);
            window.addEventListener('pointerup', stopDrag);
            window.addEventListener('pointercancel', stopDrag);
        }

        bindPopupMoverAndResizer() {
            const header = document.getElementById('st-header');
            const popupResizer = document.getElementById('st-popup-resizer');

            const clearSelection = () => {
                if (window.getSelection) {
                    try { window.getSelection().removeAllRanges(); } catch (_) {}
                }
            };

            // 1. Popup Drag to Move (Header)
            let isMoving = false;
            let moveStartX, moveStartY, panelStartX, panelStartY;

            header.addEventListener('pointerdown', (e) => {
                if (!this.isDetached || this.isFullscreen) return;
                // Ignore if clicked on buttons, tabs, inputs, or selects
                if (e.target.closest('.st-actions') || e.target.closest('.st-tabs') || e.target.closest('input') || e.target.closest('button') || e.target.closest('select')) {
                    return;
                }

                e.preventDefault();
                e.stopPropagation();
                clearSelection();

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
                clearSelection();

                const deltaX = e.clientX - moveStartX;
                const deltaY = e.clientY - moveStartY;

                const maxX = Math.max(0, window.innerWidth - this.container.offsetWidth - 4);
                const maxY = Math.max(0, window.innerHeight - this.container.offsetHeight - 4);

                const newLeft = Math.max(4, Math.min(maxX, panelStartX + deltaX));
                const newTop = Math.max(4, Math.min(maxY, panelStartY + deltaY));

                this.popupLeft = newLeft;
                this.popupTop = newTop;
                this.container.style.left = `${newLeft}px`;
                this.container.style.top = `${newTop}px`;
            });

            const stopMove = (e) => {
                if (!isMoving) return;
                isMoving = false;
                if (e && e.pointerId) {
                    try { header.releasePointerCapture(e.pointerId); } catch (_) {}
                }
                document.body.classList.remove('st-resizing', 'st-moving-popup');
                document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
                this.saveState();
            };

            header.addEventListener('pointerup', stopMove);
            header.addEventListener('pointercancel', stopMove);
            window.addEventListener('pointerup', stopMove);
            window.addEventListener('pointercancel', stopMove);

            // 2. Popup Corner Resizer
            let isCornerResizing = false;
            let resizeStartX, resizeStartY, startW, startH;

            popupResizer.addEventListener('pointerdown', (e) => {
                if (!this.isDetached || this.isFullscreen) return;
                e.preventDefault();
                e.stopPropagation();
                clearSelection();

                try { popupResizer.setPointerCapture(e.pointerId); } catch (_) {}
                isCornerResizing = true;
                resizeStartX = e.clientX;
                resizeStartY = e.clientY;
                startW = this.container.offsetWidth;
                startH = this.container.offsetHeight;

                document.body.classList.add('st-resizing', 'st-resizing-nwse');
                popupResizer.classList.add('active');
                document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
            });

            popupResizer.addEventListener('pointermove', (e) => {
                if (!isCornerResizing) return;
                e.preventDefault();
                clearSelection();

                const deltaX = e.clientX - resizeStartX;
                const deltaY = e.clientY - resizeStartY;

                const minW = window.innerWidth <= 768 ? 260 : 380;
                const minH = window.innerWidth <= 768 ? 160 : 200;
                const maxW = Math.max(minW, window.innerWidth - this.container.offsetLeft - 4);
                const maxH = Math.max(minH, window.innerHeight - this.container.offsetTop - 4);

                const newW = Math.max(minW, Math.min(maxW, startW + deltaX));
                const newH = Math.max(minH, Math.min(maxH, startH + deltaY));

                this.popupWidth = newW;
                this.popupHeight = newH;
                this.container.style.width = `${newW}px`;
                this.container.style.height = `${newH}px`;
            });

            const stopCornerResize = (e) => {
                if (!isCornerResizing) return;
                isCornerResizing = false;
                if (e && e.pointerId) {
                    try { popupResizer.releasePointerCapture(e.pointerId); } catch (_) {}
                }
                document.body.classList.remove('st-resizing', 'st-resizing-nwse');
                popupResizer.classList.remove('active');
                document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
                this.saveState();
            };

            popupResizer.addEventListener('pointerup', stopCornerResize);
            popupResizer.addEventListener('pointercancel', stopCornerResize);
            window.addEventListener('pointerup', stopCornerResize);
            window.addEventListener('pointercancel', stopCornerResize);
        }

        startStrategyRemovalWatcher() {
            this._chartReadyConfirmed = false;
            this._emptyStudiesCount = 0;

            const enableWatcher = () => {
                setTimeout(() => {
                    this._chartReadyConfirmed = true;
                }, 3500);
            };

            if (window.tvWidget && typeof window.tvWidget.chartReady === 'function') {
                window.tvWidget.chartReady().then(enableWatcher);
            } else {
                setTimeout(enableWatcher, 6000);
            }

            // Heartbeat check every 800ms to verify if the strategy is still loaded on the chart
            setInterval(() => {
                this.checkStrategyPresence();
            }, 800);
        }

        syncStrategySelector(detail) {
            const selectEl = document.getElementById('st-strategy-select');
            const nameEl = document.getElementById('st-strategy-name');
            const badgeEl = document.getElementById('st-strategy-badge');
            if (!selectEl || !nameEl) return;

            const strats = (detail && detail.strategies) || (window.StrategyEngine ? window.StrategyEngine.getActiveStrategyNames() : []);
            const active = (detail && detail.activeStrategy) || (window.StrategyEngine ? window.StrategyEngine.activeStrategyName : '');

            if (strats.length > 1) {
                nameEl.style.display = 'none';
                selectEl.style.display = 'inline-block';
                selectEl.innerHTML = strats.map(s => `<option value="${s}" ${s === active ? 'selected' : ''}>${s}</option>`).join('');
                if (badgeEl) badgeEl.textContent = `Active (${strats.length})`;
            } else {
                selectEl.style.display = 'none';
                nameEl.style.display = 'inline';
                nameEl.textContent = active || (strats[0] || 'Strategy Tester');
                if (badgeEl) badgeEl.textContent = 'Strategy';
            }
        }

        checkStrategyPresence() {
            // Guard: don't perform destructive removal during boot / reload phase
            if (!this._chartReadyConfirmed) return;
            if (!window.tvWidget) return;
            try {
                const chart = window.tvWidget.activeChart();
                if (!chart) return;
                const studies = chart.getAllStudies() || [];

                if (!window.StrategyEngine) return;
                const instances = window.StrategyEngine.instances;
                if (!instances || instances.size === 0) {
                    if (this.currentData || this.container.style.display !== 'none' || this.launcherPill.style.display !== 'none') {
                        this.destroyAll();
                    }
                    return;
                }

                // If studies array is empty, it could be a transient reload or resolution change
                if (studies.length === 0 && instances.size > 0) {
                    this._emptyStudiesCount = (this._emptyStudiesCount || 0) + 1;
                    if (this._emptyStudiesCount < 4) {
                        return;
                    }
                } else {
                    this._emptyStudiesCount = 0;
                }

                // Check which strategies are still present on the chart
                const removed = [];
                for (const stratName of instances.keys()) {
                    const stratLower = stratName.trim().toLowerCase();
                    const exists = studies.some(s => {
                        const sName = (s.name || '').trim().toLowerCase();
                        const sDesc = (s.description || '').trim().toLowerCase();
                        return sName === stratLower || sName.includes(stratLower) || stratLower.includes(sName) ||
                               sDesc === stratLower || sDesc.includes(stratLower);
                    });
                    if (!exists) {
                        removed.push(stratName);
                    }
                }

                if (removed.length > 0) {
                    for (const r of removed) {
                        instances.delete(r);
                        if (window.StrategyEngine.resultsByStrategy) {
                            window.StrategyEngine.resultsByStrategy.delete(r);
                        }
                    }

                    if (instances.size === 0) {
                        localStorage.removeItem('tv_active_strategy');
                        this.destroyAll();
                        return;
                    }

                    // If the active strategy was removed, switch to another existing strategy
                    if (removed.includes(window.StrategyEngine.activeStrategyName)) {
                        const nextStrat = instances.keys().next().value;
                        if (nextStrat) {
                            window.StrategyEngine.setActiveStrategy(nextStrat);
                            localStorage.setItem('tv_active_strategy', nextStrat);
                        } else {
                            localStorage.removeItem('tv_active_strategy');
                        }
                    } else {
                        window.StrategyEngine.emitStrategyListUpdate();
                    }
                }
            } catch (_) {}
        }

        destroyAll() {
            if (this._chartResizeObserver) {
                this._chartResizeObserver.disconnect();
                this._chartResizeObserver = null;
            }
            this.clearHighlightCandleOnChart();
            this.container.style.display = 'none';
            this.launcherPill.style.display = 'none';
            this.currentData = null;
            this.updateChartLayout();
            setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
            if (window.StrategyEngine) {
                window.StrategyEngine.clearTradeShapesOnChart();
                window.StrategyEngine.activeStrategyName = null;
                window.StrategyEngine.lastResults = null;
                window.StrategyEngine.emitStrategyListUpdate();
            }
        }

        show() {
            this.container.style.display = 'flex';
            this.launcherPill.style.display = 'none';
            this.updateHeaderActionButtons();
            this.updateChartLayout();
            setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
            if (this.currentData) this.renderActiveTab();
        }

        hide() {
            this.container.style.display = 'none';
            this.launcherPill.style.display = 'flex';
            this.updateChartLayout();
            setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
            if (this.currentData && this.currentData.summary) {
                const pnl = this.currentData.summary.netProfit;
                const pillPnl = document.getElementById('st-pill-pnl');
                if (pillPnl) {
                    pillPnl.textContent = this.formatCurrency(pnl, true);
                    pillPnl.style.color = pnl >= 0 ? '#10b981' : '#f43f5e';
                }
            }
        }

        close() {
            this.container.style.display = 'none';
            this.launcherPill.style.display = 'none';
            this.updateChartLayout();
            setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
        }

        updateData(data) {
            this.currentData = data;
            const nameEl = document.getElementById('st-strategy-name');
            if (nameEl) {
                nameEl.textContent = data.strategyName || 'Strategy Tester';
                nameEl.title = data.strategyName || 'Strategy Tester';
            }
            this.syncStrategySelector({
                strategies: window.StrategyEngine ? window.StrategyEngine.getActiveStrategyNames() : [data.strategyName],
                activeStrategy: data.strategyName
            });

            // Update Date Range Status Badge & Inputs
            if (data.dateRange) {
                const dr = data.dateRange;
                const statusEl = document.getElementById('st-range-status-text');
                if (statusEl && !this.isLoading) {
                    statusEl.innerHTML = `<strong>${dr.startDateFormatted}</strong> to <strong>${dr.endDateFormatted}</strong> &bull; <span style="color:#089981; font-weight:700;">${dr.totalTradesInRange} trades</span>`;
                }

                const startInput = document.getElementById('st-range-start-date');
                const endInput = document.getElementById('st-range-end-date');
                const liveCb = document.getElementById('st-range-live-end');

                if (dr.preset && dr.preset !== 'custom' && !this.isDateManuallyEdited) {
                    this.setPresetActive(dr.preset);
                }

                if (startInput && document.activeElement !== startInput) {
                    if (this.currentPreset === 'default') {
                        startInput.value = '';
                        startInput.placeholder = dr.startDateFormatted || 'Max / 40k bars';
                    } else if (dr.startDateStr && dr.startDateStr !== 'Max') {
                        startInput.value = dr.startDateStr;
                    }
                }
                if (endInput && document.activeElement !== endInput && dr.endDateStr && dr.endDateStr !== 'Live') {
                    endInput.value = dr.endDateStr;
                }
                if (liveCb && dr.isLiveEnd !== undefined) {
                    liveCb.checked = dr.isLiveEnd;
                    if (endInput) endInput.disabled = dr.isLiveEnd;
                }
            }

            // If the user previously minimized to the launcher pill, keep it minimized to pill and update PnL; otherwise if not closed, show panel
            if (this.launcherPill.style.display === 'flex' && this.container.style.display === 'none') {
                const pnl = data.summary.netProfit;
                const pillPnl = document.getElementById('st-pill-pnl');
                if (pillPnl) {
                    pillPnl.textContent = this.formatCurrency(pnl, true);
                    pillPnl.style.color = pnl >= 0 ? '#10b981' : '#f43f5e';
                }
            } else if (this.launcherPill.style.display !== 'none' || this.container.style.display !== 'none') {
                this.show();
            }
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
                <div class="st-overview-tab">
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
                        <div class="st-equity-header">
                            <span>Equity Curve (Compounding Capital)</span>
                            <span style="color:#64748b; font-weight:600; font-size:12px;">Ending Equity: <strong style="color:${isProfit ? '#089981' : '#f23645'};">${this.formatCurrency(s.endingEquity)}</strong></span>
                        </div>
                        <div id="st-equity-chart">
                            <canvas id="st-equity-canvas"></canvas>
                            <div class="st-equity-tooltip" id="st-equity-tooltip"></div>
                        </div>
                    </div>
                </div>
            `;

            const chartContainer = document.getElementById('st-equity-chart');
            if (chartContainer) {
                this.initEquityChart(chartContainer, this.currentData.equitySeries, s.initialCapital);
            }
        }

        formatCurrencyCompact(num) {
            if (num === null || num === undefined || isNaN(num)) return '₹0';
            const val = Math.round(Number(num));
            return `₹${val.toLocaleString('en-IN')}`;
        }

        initEquityChart(chartContainer, series, initialCapital = 100000) {
            if (this._chartResizeObserver) {
                this._chartResizeObserver.disconnect();
                this._chartResizeObserver = null;
            }

            if (!series || series.length < 2) {
                chartContainer.innerHTML = '<div style="color:#64748b; font-size:12px; padding:40px; text-align:center;">Not enough trades executed to plot equity curve.</div>';
                return;
            }

            const canvas = chartContainer.querySelector('#st-equity-canvas');
            const tooltip = chartContainer.querySelector('#st-equity-tooltip');
            if (!canvas || !tooltip) return;

            let hoveredIndex = null;

            const drawChart = () => {
                const rect = chartContainer.getBoundingClientRect();
                const width = Math.max(200, Math.floor(rect.width || chartContainer.clientWidth || 800));
                const height = Math.max(120, Math.floor(rect.height || chartContainer.clientHeight || 200));
                const dpr = window.devicePixelRatio || 1;

                canvas.width = Math.floor(width * dpr);
                canvas.height = Math.floor(height * dpr);
                canvas.style.width = `${width}px`;
                canvas.style.height = `${height}px`;

                const ctx = canvas.getContext('2d');
                ctx.resetTransform && ctx.resetTransform();
                ctx.scale(dpr, dpr);

                const padLeft = 82;
                const padRight = 20;
                const padTop = 16;
                const padBottom = 26;
                const plotW = Math.max(10, width - padLeft - padRight);
                const plotH = Math.max(10, height - padTop - padBottom);

                const values = series.map(d => d.equity);
                let min = Math.min(...values, initialCapital);
                let max = Math.max(...values, initialCapital);
                let range = max - min;
                if (range <= 0) range = initialCapital * 0.02;

                const plotMin = min - range * 0.08;
                const plotMax = max + range * 0.08;
                const plotRange = plotMax - plotMin;

                const getX = (i) => padLeft + (i / Math.max(1, series.length - 1)) * plotW;
                const getY = (val) => padTop + (1 - (val - plotMin) / plotRange) * plotH;

                ctx.clearRect(0, 0, width, height);

                // Gridlines & Y-Axis Labels
                const gridSteps = 4;
                const baselineY = getY(initialCapital);

                ctx.lineWidth = 1;
                ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                ctx.textAlign = 'right';

                for (let g = 0; g <= gridSteps; g++) {
                    const gridVal = plotMin + (g / gridSteps) * plotRange;
                    const gridY = getY(gridVal);

                    // Dashed grid line
                    ctx.strokeStyle = '#f1f5f9';
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(padLeft, Math.round(gridY));
                    ctx.lineTo(width - padRight, Math.round(gridY));
                    ctx.stroke();

                    // Y-axis label (only if not overlapping the baseline label)
                    if (Math.abs(gridY - baselineY) > 16) {
                        ctx.fillStyle = '#94a3b8';
                        ctx.setLineDash([]);
                        ctx.fillText(this.formatCurrencyCompact(gridVal), padLeft - 8, gridY + 3.5);
                    }
                }

                // Reference Baseline (Initial Capital)
                ctx.strokeStyle = '#cbd5e1';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([5, 4]);
                ctx.beginPath();
                ctx.moveTo(padLeft, Math.round(baselineY));
                ctx.lineTo(width - padRight, Math.round(baselineY));
                ctx.stroke();

                ctx.fillStyle = '#64748b';
                ctx.font = '700 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                ctx.setLineDash([]);
                ctx.fillText(this.formatCurrencyCompact(initialCapital), padLeft - 8, baselineY + 3.5);

                // Gradient Area under curve
                const isProfit = series[series.length - 1].equity >= initialCapital;
                const strokeColor = isProfit ? '#089981' : '#f23645';

                const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
                grad.addColorStop(0, isProfit ? 'rgba(8, 153, 129, 0.22)' : 'rgba(242, 54, 69, 0.22)');
                grad.addColorStop(1, isProfit ? 'rgba(8, 153, 129, 0.0)' : 'rgba(242, 54, 69, 0.0)');

                ctx.beginPath();
                ctx.moveTo(getX(0), getY(values[0]));
                for (let i = 1; i < values.length; i++) {
                    ctx.lineTo(getX(i), getY(values[i]));
                }
                ctx.lineTo(getX(values.length - 1), padTop + plotH);
                ctx.lineTo(getX(0), padTop + plotH);
                ctx.closePath();
                ctx.fillStyle = grad;
                ctx.fill();

                // Equity Line
                ctx.beginPath();
                ctx.moveTo(getX(0), getY(values[0]));
                for (let i = 1; i < values.length; i++) {
                    ctx.lineTo(getX(i), getY(values[i]));
                }
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = 2.2;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.stroke();

                // X-axis Timeline Labels at bottom
                ctx.fillStyle = '#94a3b8';
                ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

                ctx.textAlign = 'left';
                const startDt = new Date(series[0].time).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
                ctx.fillText(startDt, padLeft, height - 6);

                ctx.textAlign = 'right';
                const endDt = new Date(series[series.length - 1].time).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
                ctx.fillText(endDt, width - padRight, height - 6);

                if (series.length >= 4) {
                    ctx.textAlign = 'center';
                    const midIdx = Math.floor(series.length / 2);
                    const midDt = new Date(series[midIdx].time).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
                    ctx.fillText(midDt, (padLeft + width - padRight) / 2, height - 6);
                }

                // Interactive Crosshair & Point Highlight
                if (hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < series.length) {
                    const hX = getX(hoveredIndex);
                    const hY = getY(values[hoveredIndex]);

                    // Vertical guide
                    ctx.strokeStyle = 'rgba(100, 116, 139, 0.45)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    ctx.moveTo(hX, padTop);
                    ctx.lineTo(hX, padTop + plotH);
                    ctx.stroke();

                    // Glow outer circle
                    ctx.setLineDash([]);
                    ctx.fillStyle = isProfit ? 'rgba(8, 153, 129, 0.25)' : 'rgba(242, 54, 69, 0.25)';
                    ctx.beginPath();
                    ctx.arc(hX, hY, 7, 0, Math.PI * 2);
                    ctx.fill();

                    // Core point circle
                    ctx.fillStyle = strokeColor;
                    ctx.beginPath();
                    ctx.arc(hX, hY, 4, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.fillStyle = '#ffffff';
                    ctx.beginPath();
                    ctx.arc(hX, hY, 2, 0, Math.PI * 2);
                    ctx.fill();
                }
            };

            // Pointer events for interactive hover
            canvas.onpointermove = (e) => {
                const rect = canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const width = rect.width;
                const padLeft = 82;
                const padRight = 20;
                const plotW = width - padLeft - padRight;

                if (mouseX < padLeft || mouseX > width - padRight) {
                    hoveredIndex = null;
                    tooltip.style.display = 'none';
                    drawChart();
                    return;
                }

                const ratio = (mouseX - padLeft) / plotW;
                hoveredIndex = Math.min(series.length - 1, Math.max(0, Math.round(ratio * (series.length - 1))));
                const pt = series[hoveredIndex];

                drawChart();

                const pnl = pt.equity - initialCapital;
                const pnlPct = (pnl / initialCapital) * 100;
                const dateStr = new Date(pt.time).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });

                tooltip.innerHTML = `
                    <div style="font-weight:700; color:#cbd5e1; margin-bottom:3px; font-size:10px;">${pt.chainId ? `Trade Chain #${pt.chainId}` : `Step #${hoveredIndex}`} &bull; ${dateStr}</div>
                    <div style="font-size:13px; font-weight:700; color:#ffffff;">${this.formatCurrency(pt.equity)}</div>
                    <div style="color:${pnl >= 0 ? '#34d399' : '#f87171'}; font-weight:600; font-size:11px;">
                        PnL: ${pnl >= 0 ? '+' : ''}${this.formatCurrency(pnl)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)
                    </div>
                    ${pt.drawdown ? `<div style="color:#94a3b8; font-size:10px;">Drawdown: ${this.formatCurrency(pt.drawdown)} (${pt.drawdownPct.toFixed(2)}%)</div>` : ''}
                `;

                const ptX = padLeft + (hoveredIndex / Math.max(1, series.length - 1)) * plotW;
                tooltip.style.display = 'block';
                tooltip.style.left = `${Math.min(width - 100, Math.max(100, ptX))}px`;
                tooltip.style.top = `24px`;
            };

            canvas.onpointerleave = () => {
                hoveredIndex = null;
                tooltip.style.display = 'none';
                drawChart();
            };

            // ResizeObserver to automatically resize and redraw on any dimension change
            this._chartResizeObserver = new ResizeObserver(() => {
                drawChart();
            });
            this._chartResizeObserver.observe(chartContainer);

            // Initial render
            drawChart();
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
                const entryPrice = (c.entries && c.entries[0]) ? c.entries[0].price : 0;

                html += `
                    <tr class="st-chain-row" onclick="window.StrategyTesterUI.toggleChainLegsAndJump(${idx}, ${c.startTime}, '${c.direction}', ${entryPrice}, '${c.chainId}')" style="cursor:pointer;" title="Click to inspect legs & view candle on chart">
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
                                            <tr onclick="window.StrategyTesterUI.jumpToCandle(${l.time}, { label: '${l.action} #${l.tradeNumber} (Chain #${c.chainId}) @ ${l.price.toFixed(2)}', price: ${l.price}, action: '${l.action}' })" style="cursor:pointer;" title="Jump to candle on chart">
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
                    <tr onclick="window.StrategyTesterUI.jumpToCandle(${t.time}, { label: '${t.action} #${t.tradeNumber} (Chain #${t.chainId}) @ ${t.price.toFixed(2)}', price: ${t.price}, action: '${t.action}' })" style="cursor:pointer;" title="Click to jump to candle on chart">
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
                <div style="max-width:540px; display:flex; flex-direction:column; gap:16px; padding-bottom:32px;">
                    <div style="display:flex; flex-direction:column; gap:6px; border-bottom:1px solid #f1f5f9; padding-bottom:14px;">
                        <label style="font-size:12px; font-weight:700; color:#0f172a;">Backtest Date Range</label>
                        <div style="display:flex; gap:12px; align-items:center;">
                            <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
                                <label style="font-size:11px; font-weight:600; color:#64748b;">Start Date</label>
                                <input type="date" id="st-set-start-date" value="${cfg.startDate || ''}" style="padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px;" />
                            </div>
                            <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
                                <label style="font-size:11px; font-weight:600; color:#64748b;">End Date</label>
                                <input type="date" id="st-set-end-date" value="${cfg.endDate || ''}" ${cfg.isLiveEnd !== false ? 'disabled' : ''} style="padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px;" />
                            </div>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
                            <input type="checkbox" id="st-set-live-end" ${cfg.isLiveEnd !== false ? 'checked' : ''} style="width:16px; height:16px; cursor:pointer;" />
                            <label for="st-set-live-end" style="font-size:12px; font-weight:600; color:#0f172a; cursor:pointer;">Live / Updating (End date = Now, keeps updating with live candles)</label>
                        </div>
                    </div>

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

            const setLiveEndCb = document.getElementById('st-set-live-end');
            const setEndDateInput = document.getElementById('st-set-end-date');
            if (setLiveEndCb && setEndDateInput) {
                setLiveEndCb.addEventListener('change', (e) => {
                    setEndDateInput.disabled = e.target.checked;
                    if (!e.target.checked && !setEndDateInput.value) {
                        setEndDateInput.value = new Date().toISOString().split('T')[0];
                    }
                });
            }

            document.getElementById('st-btn-save-settings').onclick = () => {
                const capital = parseFloat(document.getElementById('st-set-capital').value) || 100000;
                const compounding = document.getElementById('st-set-compounding').checked;
                const commType = document.getElementById('st-set-comm-type').value;
                const commVal = parseFloat(document.getElementById('st-set-comm-val').value) || 0;
                const slippage = parseFloat(document.getElementById('st-set-slippage').value) || 0;

                const startDate = document.getElementById('st-set-start-date').value;
                const isLiveEnd = document.getElementById('st-set-live-end').checked;
                const endDate = isLiveEnd ? null : document.getElementById('st-set-end-date').value;

                const stratName = (this.currentData && this.currentData.strategyName) || (window.StrategyEngine && window.StrategyEngine.activeStrategyName);
                const ctx = window.StrategyEngine && window.StrategyEngine.getContext(stratName);
                if (ctx) {
                    ctx.config.initialCapital = capital;
                    ctx.config.compounding = compounding;
                    ctx.config.commissionType = commType;
                    ctx.config.commissionValue = commVal;
                    ctx.config.slippage = slippage;
                    ctx.config.startDate = startDate || null;
                    ctx.config.endDate = endDate || null;
                    ctx.config.isLiveEnd = isLiveEnd;

                    const startMs = startDate ? new Date(startDate).getTime() : 0;
                    const endMs = (!isLiveEnd && endDate) ? (new Date(endDate).getTime() + (86400 * 1000 - 1)) : Infinity;
                    this.loadHistoricalRangeAndSync(startMs, endMs, isLiveEnd, 'custom');
                }
            };
        }

        setPresetActive(preset) {
            this.currentPreset = preset;
            const presetBtns = this.container.querySelectorAll('.st-range-btn');
            presetBtns.forEach(btn => {
                if (btn.getAttribute('data-preset') === preset) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }

        applyDateRangePreset(preset) {
            this.isDateManuallyEdited = false;
            this.setPresetActive(preset);

            if (preset === 'custom') {
                const startInput = document.getElementById('st-range-start-date');
                if (startInput) startInput.focus();
                return;
            }

            let startMs = 0;
            const now = Date.now();
            if (preset === '1Y') {
                startMs = now - (365 * 86400 * 1000);
            } else if (preset === '6M') {
                startMs = now - (182 * 86400 * 1000);
            } else if (preset === '3M') {
                startMs = now - (91 * 86400 * 1000);
            } else if (preset === '1M') {
                startMs = now - (30 * 86400 * 1000);
            } else {
                // 'default' (Max / 40k)
                startMs = 0;
            }

            const startInput = document.getElementById('st-range-start-date');
            const endInput = document.getElementById('st-range-end-date');
            const liveCb = document.getElementById('st-range-live-end');

            if (startInput) {
                if (startMs > 0) {
                    startInput.value = new Date(startMs).toISOString().split('T')[0];
                } else {
                    startInput.value = '';
                    startInput.placeholder = 'Max / 40k bars';
                }
            }
            if (liveCb) {
                liveCb.checked = true;
            }
            if (endInput) {
                endInput.disabled = true;
                endInput.value = '';
            }

            this.loadHistoricalRangeAndSync(startMs, Infinity, true, preset);
        }

        applyRange() {
            const startInput = document.getElementById('st-range-start-date');
            const endInput = document.getElementById('st-range-end-date');
            const liveCb = document.getElementById('st-range-live-end');

            const sVal = startInput ? startInput.value.trim() : '';
            const eVal = endInput ? endInput.value.trim() : '';
            const isLive = liveCb ? liveCb.checked : true;

            // If user has 'default' (Max / 40k) active and didn't manually edit the text:
            if (this.currentPreset === 'default' && (!sVal || !this.isDateManuallyEdited)) {
                this.applyDateRangePreset('default');
                return;
            }

            // If user did not manually edit dates and a preset (e.g. '1Y', '6M', '3M', '1M') is selected:
            if (!this.isDateManuallyEdited && this.currentPreset && this.currentPreset !== 'custom') {
                this.applyDateRangePreset(this.currentPreset);
                return;
            }

            // If start date is blank and live is checked, apply default (Max / 40k):
            if (!sVal && isLive) {
                this.applyDateRangePreset('default');
                return;
            }

            let startMs = sVal ? new Date(sVal).getTime() : 0;
            let endMs = (!isLive && eVal) ? (new Date(eVal).getTime() + (86400 * 1000 - 1)) : Infinity;

            this.isDateManuallyEdited = true;
            this.setPresetActive('custom');
            this.saveState();
            this.loadHistoricalRangeAndSync(startMs, endMs, isLive, 'custom');
        }

        applyCustomDateRange() {
            this.applyRange();
        }

        setLoadingState(isLoading, message = 'Fetching historical data & calculating...') {
            this.isLoading = isLoading;
            const applyBtn = document.getElementById('st-btn-apply-range');
            const statusEl = document.getElementById('st-range-status-text');
            const loadingBar = document.getElementById('st-loading-bar-container');
            const body = document.getElementById('st-body');

            if (isLoading) {
                if (applyBtn) {
                    applyBtn.disabled = true;
                    applyBtn.innerHTML = `<span class="st-btn-spinner"></span> Loading...`;
                }
                if (statusEl) {
                    statusEl.innerHTML = `<span class="st-loading-spinner"></span> <strong>${message}</strong>`;
                }
                if (loadingBar) {
                    loadingBar.style.display = 'block';
                }
                if (body) {
                    body.style.opacity = '0.65';
                    body.style.pointerEvents = 'none';
                    body.style.transition = 'opacity 0.2s ease';
                }
            } else {
                if (applyBtn) {
                    applyBtn.disabled = false;
                    applyBtn.innerHTML = `Apply`;
                }
                if (loadingBar) {
                    loadingBar.style.display = 'none';
                }
                if (body) {
                    body.style.opacity = '1';
                    body.style.pointerEvents = 'auto';
                }
            }
        }

        loadHistoricalRangeAndSync(startMs, endMs, isLiveEnd = true, preset = null) {
            const stratName = (this.currentData && this.currentData.strategyName) || (window.StrategyEngine && window.StrategyEngine.activeStrategyName);
            const ctx = window.StrategyEngine && window.StrategyEngine.getContext(stratName);
            if (!ctx) return;

            ctx.config.startDate = startMs > 0 ? new Date(startMs).toISOString().split('T')[0] : (preset === 'default' ? null : 'max');
            ctx.config.endDate = isLiveEnd ? null : (endMs && endMs < Infinity ? new Date(endMs).toISOString().split('T')[0] : null);
            ctx.config.isLiveEnd = isLiveEnd;
            ctx.config.rangePreset = preset;

            const loadingMsg = preset === 'default' 
                ? 'Step 1/3: Requesting up to 40,000 historical bars...' 
                : 'Step 1/3: Requesting historical bars for selected range...';
            this.setLoadingState(true, loadingMsg);

            // Recalculate immediate available trades
            try {
                window.StrategyEngine.calculateAndEmit(ctx);
            } catch (e) {
                console.warn("[StrategyTesterUI] calculateAndEmit initial notice:", e);
            }

            // If chart widget is present, scroll back to startMs to trigger historical bar loading
            if (window.tvWidget) {
                try {
                    const chart = window.tvWidget.activeChart();
                    if (chart) {
                        // 1. Remember the exact current chart state / viewport
                        let savedViewport = null;
                        try {
                            if (typeof chart.getVisibleRange === 'function') {
                                const vr = chart.getVisibleRange();
                                if (vr && typeof vr.from === 'number' && typeof vr.to === 'number' && vr.from < vr.to) {
                                    savedViewport = { from: vr.from, to: vr.to };
                                }
                            }
                        } catch (_) {}

                        let currentRes = '1D';
                        try {
                            currentRes = chart.resolution();
                        } catch (_) {}
                        const resSec = window.StrategyEngine ? window.StrategyEngine.getResolutionInSeconds(currentRes) : 3600;

                        const nowSec = Math.floor(Date.now() / 1000);
                        let startSec = startMs > 0 ? Math.floor(startMs / 1000) : 0;
                        if (!startSec || startSec <= 0) {
                            const fortyKBarsAgo = nowSec - (40000 * resSec);
                            const oneYearAgo = nowSec - (365 * 86400);
                            startSec = Math.min(oneYearAgo, fortyKBarsAgo);
                        }

                        // IMPORTANT: In TradingView's setVisibleRange, if 'to' is also in the distant past before any loaded bars,
                        // TradingView's internal indexOfTime(to) returns -1 or null, which causes `h > l` check to fail with:
                        // "Uncaught (in promise) Error: Invalid visible range".
                        // To trigger historical bar paging safely, targetTo must be the known current loaded bar time
                        // (savedViewport.to or nowSec), and targetFrom is startSec (clamped so targetFrom < targetTo).
                        const targetTo = (savedViewport && savedViewport.to > startSec) ? savedViewport.to : nowSec;
                        const targetFrom = Math.min(startSec, targetTo - (resSec * 20));

                        let restored = false;
                        const restoreViewportAndFinalize = () => {
                            if (restored) return;
                            restored = true;
                            try {
                                const statusEl = document.getElementById('st-range-status-text');
                                if (statusEl) {
                                    statusEl.innerHTML = `<span class="st-loading-spinner"></span> <strong>Step 3/3: Finalizing trades & restoring viewport...</strong>`;
                                }
                                window.StrategyEngine.calculateAndEmit(ctx);

                                // Restore the user's viewport exactly like it was before
                                if (savedViewport && typeof chart.setVisibleRange === 'function') {
                                    const p = chart.setVisibleRange(savedViewport, () => {});
                                    if (p && typeof p.catch === 'function') {
                                        p.catch(() => {});
                                    }
                                }
                            } catch (e) {
                                console.warn("[StrategyTesterUI] Failed to restore viewport:", e);
                            } finally {
                                setTimeout(() => this.setLoadingState(false), 250);
                            }
                        };

                        // Update loading message while bars load
                        setTimeout(() => {
                            if (this.isLoading && !restored) {
                                const statusEl = document.getElementById('st-range-status-text');
                                if (statusEl) {
                                    statusEl.innerHTML = `<span class="st-loading-spinner"></span> <strong>Step 2/3: Calculating strategy logic & trade chains...</strong>`;
                                }
                            }
                        }, 500);

                        // 2. Request range from TradingView to page back history
                        try {
                            const p = chart.setVisibleRange({
                                from: targetFrom,
                                to: targetTo
                            }, () => {
                                // 3. After TradingView fetches bars & PineJS processes them, recalculate & restore viewport
                                setTimeout(restoreViewportAndFinalize, 800);
                            });

                            if (p && typeof p.then === 'function') {
                                p.then(() => {
                                    setTimeout(restoreViewportAndFinalize, 800);
                                }).catch(err => {
                                    console.warn("[StrategyTesterUI] chart.setVisibleRange notice:", err && err.message ? err.message : err);
                                    // Even if rejected due to missing bars in datafeed, still finalize gracefully
                                    restoreViewportAndFinalize();
                                });
                            }
                        } catch (err) {
                            console.warn("[StrategyTesterUI] chart.setVisibleRange sync error:", err);
                            restoreViewportAndFinalize();
                        }

                        // Safety fallback timer in case callbacks are delayed or throttled
                        setTimeout(restoreViewportAndFinalize, 2000);
                        return;
                    }
                } catch (e) {
                    console.warn("[StrategyTesterUI] Failed to scroll chart for historical range:", e);
                }
            }

            // Fallback if no chart widget
            setTimeout(() => {
                try {
                    window.StrategyEngine.calculateAndEmit(ctx);
                } catch (_) {}
                this.setLoadingState(false);
            }, 300);
        }

        clearHighlightCandleOnChart() {
            if (!this._highlightShapeIds || this._highlightShapeIds.length === 0) return;
            try {
                const chart = window.tvWidget && window.tvWidget.activeChart && window.tvWidget.activeChart();
                if (chart && typeof chart.removeEntity === 'function') {
                    for (const id of this._highlightShapeIds) {
                        try {
                            chart.removeEntity(id, { disableUndo: true });
                        } catch (_) {}
                    }
                }
            } catch (_) {}
            this._highlightShapeIds = [];
        }

        highlightCandleOnChart(timeSec, options = {}) {
            this.clearHighlightCandleOnChart();
            if (!window.tvWidget) return;

            try {
                const chart = window.tvWidget.activeChart();
                if (!chart || typeof chart.createShape !== 'function') return;

                const action = (options.action || '').toUpperCase();
                const color = action === 'BUY' ? '#089981' : (action === 'SELL' ? '#f23645' : '#2563eb');
                const price = Number(options.price) || null;
                const labelText = options.label || (action ? `${action} Candle` : 'Selected Candle');

                // 1. Draw dashed vertical line through entire height of the candle
                chart.createShape({ time: timeSec }, {
                    shape: 'vertical_line',
                    lock: true,
                    disableSelection: false,
                    disableSave: true,
                    disableUndo: true,
                    overrides: {
                        linecolor: color,
                        linewidth: 2,
                        linestyle: 1
                    }
                }).then(id => {
                    if (id) this._highlightShapeIds.push(id);
                }).catch(() => {});

                // 2. If price is given, draw a target balloon or arrow pointing right at the execution price
                if (price !== null && !isNaN(price)) {
                    chart.createShape({ time: timeSec, price: price }, {
                        shape: 'balloon',
                        text: `🎯 ${labelText}`,
                        lock: true,
                        disableSelection: true,
                        disableSave: true,
                        disableUndo: true,
                        overrides: {
                            backgroundColor: color,
                            borderColor: color,
                            textColor: '#ffffff',
                            fontsize: 11,
                            bold: true
                        }
                    }).then(id => {
                        if (id) this._highlightShapeIds.push(id);
                    }).catch(() => {
                        // Fallback to arrow if balloon is not supported in this bundle
                        chart.createShape({ time: timeSec, price: price }, {
                            shape: action === 'BUY' ? 'arrow_up' : 'arrow_down',
                            text: labelText,
                            lock: true,
                            disableSelection: true,
                            disableSave: true,
                            disableUndo: true,
                            overrides: {
                                color: color,
                                arrowColor: color,
                                fontsize: 11,
                                bold: true
                            }
                        }).then(fbId => {
                            if (fbId) this._highlightShapeIds.push(fbId);
                        }).catch(() => {});
                    });
                }
            } catch (e) {
                console.warn("[StrategyTesterUI] Failed to highlight candle on chart:", e);
            }
        }

        jumpToCandle(timeMs, options = {}) {
            if (!window.tvWidget) return;
            try {
                const chart = window.tvWidget.activeChart();
                if (!chart) return;
                const timeSec = timeMs > 1e11 ? Math.floor(timeMs / 1000) : timeMs;

                let resSec = 3600;
                try {
                    const currentRes = chart.resolution();
                    resSec = window.StrategyEngine ? window.StrategyEngine.getResolutionInSeconds(currentRes) : 3600;
                } catch (_) {}

                const halfSpan = Math.max(resSec * 40, 3600 * 2);
                try {
                    const p = chart.setVisibleRange({
                        from: timeSec - halfSpan,
                        to: timeSec + halfSpan
                    }, () => {
                        this.highlightCandleOnChart(timeSec, options);
                    });
                    if (p && typeof p.catch === 'function') {
                        p.catch(err => {
                            console.warn("[StrategyTesterUI] jumpToCandle setVisibleRange notice:", err && err.message ? err.message : err);
                            this.highlightCandleOnChart(timeSec, options);
                        });
                    }
                } catch (_) {
                    this.highlightCandleOnChart(timeSec, options);
                }

                // Also draw immediately
                this.highlightCandleOnChart(timeSec, options);
            } catch (e) {
                console.warn("[StrategyTesterUI] Failed to jump to candle:", e);
            }
        }

        toggleChainLegsAndJump(idx, startTime, direction, entryPrice, chainId) {
            this.toggleChainLegs(idx);
            if (startTime) {
                this.jumpToCandle(startTime, {
                    label: `Chain #${chainId} (${direction}) Entry`,
                    action: direction === 'LONG' ? 'BUY' : 'SELL',
                    price: entryPrice
                });
            }
        }

        toggleChainLegs(idx) {
            const el = document.getElementById(`st-chain-legs-${idx}`);
            if (el) {
                el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
            }
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        window.StrategyTesterUI = new StrategyTesterUI();
    });

})(window);
