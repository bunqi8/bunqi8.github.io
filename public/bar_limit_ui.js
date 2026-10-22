/**
 * Historical Candle Buffer Limit Manager & UI Controller
 * Enforces a strict default 40,000 (40K) historical candle limit to prevent browser tab crashes,
 * excessive RAM consumption, and WebGL buffer exhaustion.
 * Provides user-configurable settings (5K, 10K, 20K, 40K, and Custom with strong warnings).
 */

(function(window) {
    'use strict';

    class BarLimitController {
        constructor() {
            this.storageKey = 'tv_chart_max_bars_limit';
            this.defaultLimit = 40000;
            this.btnId = 'header-toolbar-bar-limit';
            this.modalId = 'bar-limit-settings-modal';
            this.bannerId = 'bar-limit-warning-banner';
            this.lastWarningTs = 0;
            this._barCounts = {}; // cacheKey -> number of bars currently loaded
            this.cachedIframeDoc = null;

            this.init();
        }

        init() {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.mount());
            } else {
                this.mount();
            }
        }

        mount() {
            this.injectButton();
            // Periodic retry to ensure button stays mounted across iframe reloads
            setInterval(() => this.injectButton(), 2500);
        }

        getLimit() {
            try {
                const saved = localStorage.getItem(this.storageKey);
                if (saved) {
                    const parsed = parseInt(saved, 10);
                    if (!isNaN(parsed) && parsed >= 1000) {
                        return parsed;
                    }
                }
            } catch (_) {}
            return this.defaultLimit;
        }

        setLimit(newLimit, bypassWarning = false) {
            const num = parseInt(newLimit, 10);
            if (isNaN(num) || num < 1000) {
                alert('Please enter a valid candle limit of at least 1,000 bars.');
                return false;
            }

            if (num > 40000 && !bypassWarning) {
                const confirmed = confirm(
                    `⚠️ CRITICAL MEMORY WARNING:\n\n` +
                    `You are attempting to set the historical candle limit to ${num.toLocaleString()} bars (above the recommended 40,000 safety threshold).\n\n` +
                    `Loading this many bars can consume 2 to 4+ GB of browser RAM, trigger WebGL context loss, and crash your browser tab!\n\n` +
                    `Are you sure you want to proceed at your own risk?`
                );
                if (!confirmed) return false;
            }

            try {
                localStorage.setItem(this.storageKey, String(num));
            } catch (_) {}

            // Reset tracked bar counts
            this.resetCounts();

            // Update UI buttons and badges
            this.updateButtonLabel();

            // Reload chart data cleanly
            this.reloadChartData();
            return true;
        }

        formatLimitShort(limit) {
            if (limit >= 1000000) return (limit / 1000000).toFixed(1).replace('.0', '') + 'M';
            if (limit >= 1000) return Math.round(limit / 1000) + 'K';
            return String(limit);
        }

        resetCounts() {
            this._barCounts = {};
            if (window._symbolBarCount) window._symbolBarCount = {};
        }

        getBarCount(cacheKey) {
            return this._barCounts[cacheKey] || (window._symbolBarCount ? window._symbolBarCount[cacheKey] : 0) || 0;
        }

        setBarCount(cacheKey, count) {
            const limit = this.getLimit();
            const clamped = Math.min(count, limit);
            this._barCounts[cacheKey] = clamped;
            if (!window._symbolBarCount) window._symbolBarCount = {};
            window._symbolBarCount[cacheKey] = clamped;
        }

        incrementBarCount(cacheKey, delta) {
            const current = this.getBarCount(cacheKey);
            this.setBarCount(cacheKey, current + delta);
        }

        onLiveBarAdded(cacheKey) {
            // As new live candles are created, old candles roll off beyond the limit
            const limit = this.getLimit();
            const current = this.getBarCount(cacheKey);
            if (current >= limit) {
                this.setBarCount(cacheKey, limit);
            } else {
                this.setBarCount(cacheKey, current + 1);
            }
        }

        reloadChartData() {
            try {
                if (window.tvWidget) {
                    if (typeof window.tvWidget.resetCache === 'function') {
                        window.tvWidget.resetCache();
                    }
                    if (typeof window.tvWidget.activeChart === 'function') {
                        const chart = window.tvWidget.activeChart();
                        if (chart && typeof chart.resetData === 'function') {
                            chart.resetData();
                        }
                    }
                }
            } catch (e) {
                console.warn('[BarLimitManager] Chart reload warning:', e);
            }
        }

        // --- Alert / Strong Technical Warning Banner ---
        showLimitWarningBanner(limit) {
            const now = Date.now();
            if (now - this.lastWarningTs < 12000) return; // Debounce 12 seconds
            this.lastWarningTs = now;

            const existing = document.getElementById(this.bannerId);
            if (existing) existing.remove();

            const banner = document.createElement('div');
            banner.id = this.bannerId;
            banner.style.cssText = `
                position: fixed;
                top: 55px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 9999999;
                background: linear-gradient(135deg, rgba(26, 17, 16, 0.95), rgba(41, 24, 22, 0.95));
                color: #ffffff;
                border: 1px solid #f23645;
                box-shadow: 0 12px 36px rgba(0, 0, 0, 0.65), 0 0 20px rgba(242, 54, 69, 0.25);
                backdrop-filter: blur(12px);
                border-radius: 10px;
                padding: 14px 20px;
                display: flex;
                align-items: flex-start;
                gap: 14px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                max-width: 680px;
                width: calc(100% - 40px);
                animation: tvBarLimitFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            `;

            const limitStr = (limit || this.getLimit()).toLocaleString();
            banner.innerHTML = `
                <div style="font-size: 26px; line-height: 1; margin-top: 2px;">⚠️</div>
                <div style="flex: 1;">
                    <div style="font-size: 14px; font-weight: 700; color: #ff5252; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;">
                        <span>Historical Candle Buffer Limit Reached (${limitStr} Bars)</span>
                        <span style="font-size: 11px; background: rgba(242, 54, 69, 0.2); border: 1px solid rgba(242, 54, 69, 0.4); color: #ff8a80; padding: 2px 7px; border-radius: 4px; font-weight: 600;">Safety Guard Active</span>
                    </div>
                    <div style="font-size: 12.5px; line-height: 1.5; color: #e0e0e0; margin-bottom: 10px;">
                        Cannot load more historical data due to browser technical constraints. Loading additional candles beyond <strong>${limitStr}</strong> can cause severe memory overload (exceeding 2–4 GB RAM), WebGL buffer crash, or browser tab termination.
                        <div style="margin-top: 4px; color: #9e9e9e; font-size: 11.5px;">
                            • New live candles will continue to stream normally, automatically rolling off the oldest candles.<br>
                            • You can adjust this limit in settings if your PC has high RAM.
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button id="btn-bar-limit-keep" style="background: rgba(255, 255, 255, 0.12); border: 1px solid rgba(255, 255, 255, 0.2); color: #fff; padding: 6px 14px; font-size: 12px; font-weight: 600; border-radius: 6px; cursor: pointer; transition: background 0.15s;">
                            Keep Safe Limit (${limitStr})
                        </button>
                        <button id="btn-bar-limit-adjust" style="background: #2962ff; border: none; color: #fff; padding: 6px 14px; font-size: 12px; font-weight: 600; border-radius: 6px; cursor: pointer; transition: background 0.15s;">
                            Adjust Limit...
                        </button>
                    </div>
                </div>
                <button id="btn-bar-limit-close" style="background: transparent; border: none; color: #888; font-size: 18px; cursor: pointer; line-height: 1; padding: 0 4px;" title="Dismiss">&times;</button>
            `;

            // Add CSS animation if missing
            if (!document.getElementById('tv-bar-limit-styles')) {
                const styleEl = document.createElement('style');
                styleEl.id = 'tv-bar-limit-styles';
                styleEl.textContent = `
                    @keyframes tvBarLimitFadeIn {
                        from { opacity: 0; transform: translate(-50%, -15px); }
                        to { opacity: 1; transform: translate(-50%, 0); }
                    }
                    @keyframes tvBarLimitFadeOut {
                        from { opacity: 1; transform: translate(-50%, 0); }
                        to { opacity: 0; transform: translate(-50%, -15px); }
                    }
                `;
                document.head.appendChild(styleEl);
            }

            document.body.appendChild(banner);

            const dismiss = () => {
                banner.style.animation = 'tvBarLimitFadeOut 0.25s forwards';
                setTimeout(() => banner.remove(), 250);
            };

            const closeBtn = banner.querySelector('#btn-bar-limit-close');
            if (closeBtn) closeBtn.onclick = dismiss;

            const keepBtn = banner.querySelector('#btn-bar-limit-keep');
            if (keepBtn) keepBtn.onclick = dismiss;

            const adjustBtn = banner.querySelector('#btn-bar-limit-adjust');
            if (adjustBtn) adjustBtn.onclick = () => {
                dismiss();
                this.openSettingsModal();
            };

            // Auto-dismiss after 14 seconds
            setTimeout(() => {
                if (document.body.contains(banner)) dismiss();
            }, 14000);
        }

        // --- Settings Modal Dialog ---
        openSettingsModal() {
            const existing = document.getElementById(this.modalId);
            if (existing) existing.remove();

            const curLimit = this.getLimit();
            const overlay = document.createElement('div');
            overlay.id = this.modalId;
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.72);
                backdrop-filter: blur(8px);
                z-index: 99999999;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            `;

            overlay.innerHTML = `
                <div style="background: #1e222d; color: #d1d4dc; border: 1px solid #2a2e39; border-radius: 12px; width: 480px; max-width: calc(100vw - 32px); box-shadow: 0 20px 60px rgba(0,0,0,0.7); overflow: hidden;">
                    <!-- Header -->
                    <div style="padding: 16px 20px; border-bottom: 1px solid #2a2e39; display: flex; align-items: center; justify-content: space-between; background: #181b22;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-size: 20px;">📊</span>
                            <div>
                                <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #fff;">Historical Candle Buffer Limit</h3>
                                <p style="margin: 2px 0 0; font-size: 11px; color: #787b86;">Manage in-memory chart depth and prevent browser tab crash</p>
                            </div>
                        </div>
                        <button id="modal-close-x" style="background: transparent; border: none; color: #787b86; font-size: 20px; cursor: pointer; padding: 0 4px;">&times;</button>
                    </div>

                    <!-- Body -->
                    <div style="padding: 20px;">
                        <div style="margin-bottom: 16px;">
                            <label style="font-size: 12px; font-weight: 600; color: #9db2c6; display: block; margin-bottom: 6px;">Select Preset Limit:</label>
                            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">
                                <button type="button" class="preset-btn" data-val="5000" style="background: ${curLimit===5000?'#2962ff':'#2a2e39'}; color: #fff; border: 1px solid ${curLimit===5000?'#2962ff':'#363a45'}; padding: 8px 4px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; text-align: center;">5K<br><span style="font-size: 9.5px; opacity: 0.75; font-weight: 400;">Ultra Light</span></button>
                                <button type="button" class="preset-btn" data-val="10000" style="background: ${curLimit===10000?'#2962ff':'#2a2e39'}; color: #fff; border: 1px solid ${curLimit===10000?'#2962ff':'#363a45'}; padding: 8px 4px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; text-align: center;">10K<br><span style="font-size: 9.5px; opacity: 0.75; font-weight: 400;">Fast</span></button>
                                <button type="button" class="preset-btn" data-val="20000" style="background: ${curLimit===20000?'#2962ff':'#2a2e39'}; color: #fff; border: 1px solid ${curLimit===20000?'#2962ff':'#363a45'}; padding: 8px 4px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; text-align: center;">20K<br><span style="font-size: 9.5px; opacity: 0.75; font-weight: 400;">Balanced</span></button>
                                <button type="button" class="preset-btn" data-val="40000" style="background: ${curLimit===40000?'#2962ff':'#2a2e39'}; color: #fff; border: 1px solid ${curLimit===40000?'#2962ff':'#363a45'}; padding: 8px 4px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; text-align: center;">40K<br><span style="font-size: 9.5px; opacity: 0.75; font-weight: 400;">Default</span></button>
                            </div>
                        </div>

                        <div style="margin-bottom: 16px;">
                            <label for="custom-limit-input" style="font-size: 12px; font-weight: 600; color: #9db2c6; display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                                <span>Custom Candle Limit:</span>
                                <span style="font-size: 11px; color: #787b86;">Min: 1,000 | Default: 40,000</span>
                            </label>
                            <input id="custom-limit-input" type="number" min="1000" step="1000" value="${curLimit}" style="width: 100%; box-sizing: border-box; background: #131722; border: 1px solid #2a2e39; color: #fff; padding: 10px 12px; border-radius: 6px; font-size: 14px; font-family: monospace; outline: none;">
                        </div>

                        <!-- Dynamic Warning Box for values > 40K -->
                        <div id="beyond-40k-warning" style="display: ${curLimit > 40000 ? 'block' : 'none'}; background: rgba(242, 54, 69, 0.12); border: 1px solid #f23645; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                            <div style="font-size: 12px; font-weight: 700; color: #ff5252; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                                <span>🚨 CRITICAL HIGH-MEMORY WARNING</span>
                            </div>
                            <div style="font-size: 11.5px; line-height: 1.45; color: #ffcdd2;">
                                Values above <strong>40,000 candles</strong> place extreme strain on browser V8 heap and GPU WebGL context. It may freeze indicator calculations or trigger <strong>Error code: Out of Memory (OOM)</strong> tab crashes.
                            </div>
                            <label style="display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 11.5px; color: #fff; cursor: pointer;">
                                <input type="checkbox" id="accept-risk-checkbox" style="cursor: pointer; width: 15px; height: 15px;">
                                <span>I understand the technical risks and accept potential browser crashes.</span>
                            </label>
                        </div>

                        <!-- Technical Explanation Note -->
                        <div style="background: rgba(41, 98, 255, 0.08); border: 1px solid rgba(41, 98, 255, 0.2); border-radius: 6px; padding: 10px 12px; font-size: 11.5px; line-height: 1.45; color: #90caf9;">
                            💡 <strong>Why is 40K the recommended maximum?</strong><br>
                            Each candle carries 5 float values (OHLCV) plus indicator cache trees. 40,000 bars equate to ~200,000 data points per indicator, which is the optimal threshold for fluid 60 FPS panning without browser tab death.
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="padding: 14px 20px; border-top: 1px solid #2a2e39; display: flex; align-items: center; justify-content: flex-end; gap: 10px; background: #181b22;">
                        <button id="modal-btn-cancel" style="background: transparent; border: 1px solid #363a45; color: #d1d4dc; padding: 8px 16px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">Cancel</button>
                        <button id="modal-btn-apply" style="background: #2962ff; border: none; color: #fff; padding: 8px 18px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">Apply & Reload</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            const input = overlay.querySelector('#custom-limit-input');
            const warningBox = overlay.querySelector('#beyond-40k-warning');
            const riskCheckbox = overlay.querySelector('#accept-risk-checkbox');
            const presetBtns = overlay.querySelectorAll('.preset-btn');

            const checkWarningState = () => {
                const val = parseInt(input.value, 10) || 0;
                if (val > 40000) {
                    warningBox.style.display = 'block';
                } else {
                    warningBox.style.display = 'none';
                    if (riskCheckbox) riskCheckbox.checked = false;
                }
            };

            input.addEventListener('input', () => {
                const val = parseInt(input.value, 10);
                presetBtns.forEach(btn => {
                    const bVal = parseInt(btn.getAttribute('data-val'), 10);
                    if (bVal === val) {
                        btn.style.background = '#2962ff';
                        btn.style.borderColor = '#2962ff';
                    } else {
                        btn.style.background = '#2a2e39';
                        btn.style.borderColor = '#363a45';
                    }
                });
                checkWarningState();
            });

            presetBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const bVal = btn.getAttribute('data-val');
                    input.value = bVal;
                    presetBtns.forEach(b => {
                        b.style.background = '#2a2e39';
                        b.style.borderColor = '#363a45';
                    });
                    btn.style.background = '#2962ff';
                    btn.style.borderColor = '#2962ff';
                    checkWarningState();
                });
            });

            const close = () => overlay.remove();
            overlay.querySelector('#modal-close-x').onclick = close;
            overlay.querySelector('#modal-btn-cancel').onclick = close;

            overlay.querySelector('#modal-btn-apply').onclick = () => {
                const targetLimit = parseInt(input.value, 10);
                if (isNaN(targetLimit) || targetLimit < 1000) {
                    alert('Please enter a valid limit (minimum 1,000 candles).');
                    return;
                }

                if (targetLimit > 40000 && riskCheckbox && !riskCheckbox.checked) {
                    alert('Please confirm that you accept the risk of potential browser tab crashes by checking the box.');
                    return;
                }

                const success = this.setLimit(targetLimit, true);
                if (success) {
                    close();
                    // Show small confirmation toast
                    const toast = document.createElement('div');
                    toast.style.cssText = `
                        position: fixed;
                        bottom: 24px;
                        right: 24px;
                        background: #089981;
                        color: #fff;
                        padding: 10px 18px;
                        border-radius: 6px;
                        font-size: 13px;
                        font-weight: 600;
                        z-index: 99999999;
                        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    `;
                    toast.textContent = `✓ Historical bar limit updated to ${targetLimit.toLocaleString()} candles. Chart reloaded.`;
                    document.body.appendChild(toast);
                    setTimeout(() => toast.remove(), 4000);
                }
            };

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) close();
            });
        }

        // --- Toolbar Button Injection ---
        injectButton(targetEl = null, iframeDoc = null) {
            if (!iframeDoc) {
                const iframe = document.querySelector('#tv_chart_container iframe') || document.querySelector('iframe[id^="tradingview_"]');
                if (iframe) {
                    try {
                        iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    } catch (_) {}
                }
            }
            const targetDoc = iframeDoc || document;
            this.cachedIframeDoc = targetDoc;

            if (targetDoc.getElementById(this.btnId)) {
                this.updateButtonLabel();
                return;
            }

            const refTarget = targetEl || 
                              targetDoc.getElementById('header-toolbar-option-chain') ||
                              targetDoc.getElementById('header-toolbar-symbol-search') ||
                              targetDoc.querySelector('.group-wWM3zP_M') ||
                              targetDoc.querySelector('.group-MBOVGQRI');

            if (!refTarget || !refTarget.parentNode) return;

            const limitShort = this.formatLimitShort(this.getLimit());
            const btnContainer = targetDoc.createElement('div');
            btnContainer.id = this.btnId;
            btnContainer.className = 'group-MBOVGQRI';
            btnContainer.style.cssText = 'margin: 0 4px; display: inline-flex; align-items: center; vertical-align: middle;';

            btnContainer.innerHTML = `
                <button type="button" class="button-OhqNVIYA button-ptpAHg8E button-GwQQdU8S apply-common-tooltip isInteractive-GwQQdU8S accessible-GwQQdU8S"
                        style="display: flex; align-items: center; gap: 5px; height: 28px; padding: 0 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); cursor: pointer; color: #d1d4dc; font-size: 11.5px; font-weight: 600;"
                        title="Historical Candle Buffer Limit (Click to adjust)">
                    <span style="font-size: 13px; line-height: 1;">📊</span>
                    <span id="bar-limit-badge-text" style="color: #2962ff; font-weight: 700;">${limitShort}</span>
                    <span style="font-size: 10px; opacity: 0.65; color: #9db2c6;">Bars</span>
                </button>
            `;

            btnContainer.querySelector('button').onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openSettingsModal();
            };

            refTarget.parentNode.insertBefore(btnContainer, refTarget.nextSibling);
        }

        updateButtonLabel() {
            const doc = this.cachedIframeDoc || document;
            const badge = doc.getElementById('bar-limit-badge-text');
            if (badge) {
                badge.textContent = this.formatLimitShort(this.getLimit());
            }
        }
    }

    window.BarLimitController = BarLimitController;
    window.BarLimitManager = new BarLimitController();
    window.BarLimitUI = window.BarLimitManager;

})(window);
