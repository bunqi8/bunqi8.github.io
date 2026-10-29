/**
 * MetaTrader 5 (MT5) Fleet Manager UI for TradingView
 * Renders dedicated topbar indicator pill and multi-account prop firm fleet modal.
 * Fully isolated from Fyers integration.
 */

(function(window) {
    'use strict';

    class MT5UI {
        constructor() {
            this.btnId = 'header-toolbar-mt5-broker-btn';
            this.wrapperId = 'header-toolbar-mt5-manager';
            this.modalId = 'mt5-fleet-manager-modal';
            this.activeTab = 'fleet'; // 'fleet' or 'settings'
            this.viewMode = 'list'; // 'list', 'add', or 'details'
            this.cachedIframeDoc = null;
            this.isOpen = false;
            this.switchingAccountId = null;
            this.switchProgress = null;

            // Full account details state & history
            this.detailsAccountId = null;
            this.detailsData = null;
            this.detailsLoading = false;
            this.detailsSyncing = false;
            this.detailsProgress = null;
            this.detailsSubTab = 'overview'; // 'overview', 'tickers', 'positions', 'history'
            this.tickerSearchQuery = '';
            this.tickerCategoryFilter = 'ALL';
            this.historySearchQuery = '';
            this.historyTypeFilter = 'ALL'; // 'ALL', 'BUY', 'SELL'
            this.historyOutcomeFilter = 'ALL'; // 'ALL', 'WIN', 'LOSS'
            this.historyDateFilter = 'ALL'; // 'ALL', 'TODAY', '7D', '30D'
            this.historySortField = 'time'; // 'time', 'profit', 'volume', 'symbol', 'ticket'
            this.historySortDir = 'desc'; // 'desc', 'asc'
            this._accountDetailsCache = new Map();

            this.init();
        }

        init() {
            // Isolate input fields from TradingView's global hotkey capture
            ['keydown', 'keyup', 'keypress'].forEach(evt => {
                window.addEventListener(evt, (e) => {
                    const tag = e.target ? e.target.tagName : '';
                    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
                        e.stopPropagation();
                        if (typeof e.stopImmediatePropagation === 'function') {
                            e.stopImmediatePropagation();
                        }
                    }
                }, true);
            });

            if (!document.getElementById('mt5-spin-style')) {
                const style = document.createElement('style');
                style.id = 'mt5-spin-style';
                style.textContent = `
                    @keyframes mt5spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `;
                document.head.appendChild(style);
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.mount());
            } else {
                this.mount();
            }

            // Listen to account updates from MT5API
            if (window.MT5API) {
                window.MT5API.onAccountUpdate(() => {
                    this.updateButtonState();
                    if (this.isOpen && !this.switchingAccountId) {
                        this.renderModal();
                    }
                });
            }
        }

        mount() {
            this.injectButton();
            // Retry injection if TradingView chart iframe loads dynamically
            setInterval(() => this.injectButton(), 2000);
        }

        getTheme() {
            const isDark = document.body.classList.contains('theme-dark') || 
                           window.matchMedia('(prefers-color-scheme: dark)').matches || true;
            return {
                isDark,
                bg: isDark ? '#1e222d' : '#ffffff',
                cardBg: isDark ? '#131722' : '#f0f3fa',
                border: isDark ? '#2a2e39' : '#e0e3eb',
                text: isDark ? '#d1d4dc' : '#131722',
                textMuted: isDark ? '#787b86' : '#5d606b',
                primary: '#2962ff',
                success: '#089981',
                error: '#f23645',
                warning: '#ff9800',
                inputBg: isDark ? '#1e222d' : '#ffffff',
                inputBorder: isDark ? '#363c4e' : '#d1d4dc',
                inputText: isDark ? '#d1d4dc' : '#131722',
            };
        }

        getTooltipText() {
            if (!window.MT5API) return 'Broker: MetaTrader 5\nStatus: Initializing...';
            const acc = window.MT5API.getActiveAccount();
            const isConn = window.MT5API.isConnected;
            const accounts = window.MT5API.accounts || [];
            if (!acc) {
                return `Broker: MetaTrader 5\nStatus: Disconnected\nAccounts Configured: ${accounts.length}\nClick to configure MT5 fleet`;
            }
            const balanceStr = acc.balance != null ? `$${Number(acc.balance).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : 'N/A';
            const equityStr = acc.equity != null ? `$${Number(acc.equity).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : 'N/A';
            return `Broker: MetaTrader 5\nAccount: ${acc.nickname || 'Default'} (#${acc.login || 'N/A'})\nServer: ${acc.server || 'N/A'}\nStatus: ${isConn ? 'Connected' : 'Connecting...'}\nBalance: ${balanceStr}\nEquity: ${equityStr}\nFleet: ${accounts.length} Accounts Active\nClick to manage MT5 fleet`;
        }

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
                this.ensureButtonPosition(targetDoc, targetEl);
                this.updateButtonState();
                return;
            }

            const fyersWrapper = targetDoc.getElementById('header-toolbar-broker-manager');
            const symbolSearch = targetDoc.getElementById('header-toolbar-symbol-search') || targetEl;

            const btnHtml = `
            <div class="group-MBOVGQRI" id="${this.wrapperId}" style="margin: 0 4px; display: inline-flex; align-items: center;">
                <button aria-label="MetaTrader 5 Fleet" data-role="button" tabindex="-1" type="button" 
                    class="button-OhqNVIYA button-ptpAHg8E button-GwQQdU8S apply-common-tooltip isInteractive-GwQQdU8S accessible-GwQQdU8S tv-broker-btn" 
                    id="${this.btnId}" style="padding: 0 4px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; height: 100%; border: none; background: transparent;">
                    <span role="img" class="icon-GwQQdU8S" aria-hidden="true" style="position: relative; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;">
                        <span class="tv-broker-avatar tv-mt5-avatar" style="
                            width: 22px; 
                            height: 22px; 
                            border-radius: 50%; 
                            background: #787b86; 
                            color: #ffffff; 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                            font-weight: 700; 
                            font-size: 10px; 
                            line-height: 22px; 
                            text-align: center; 
                            display: flex; 
                            align-items: center; 
                            justify-content: center; 
                            user-select: none;
                            letter-spacing: 0.3px;
                            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                        ">MT</span>
                        <span class="tv-broker-status-dot tv-mt5-status-dot" style="
                            position: absolute; 
                            bottom: 2px; 
                            right: 2px; 
                            width: 6.5px; 
                            height: 6.5px; 
                            border-radius: 50%; 
                            background: #787b86; 
                            box-shadow: 0 0 0 1.5px #ffffff;
                        "></span>
                    </span>
                </button>
            </div>
            `;

            // Place DIRECTLY next to Fyers button if available, or right before symbol search
            if (fyersWrapper && fyersWrapper.parentNode) {
                fyersWrapper.insertAdjacentHTML('afterend', btnHtml);
            } else if (symbolSearch && symbolSearch.parentNode) {
                symbolSearch.insertAdjacentHTML('beforebegin', btnHtml);
            } else if (targetEl && targetEl.parentNode) {
                targetEl.insertAdjacentHTML('beforebegin', btnHtml);
            } else {
                const firstGroup = targetDoc.querySelector('.group-wWM3zP_M') || targetDoc.querySelector('.group-MBOVGQRI');
                if (firstGroup && firstGroup.parentNode) {
                    firstGroup.insertAdjacentHTML('beforebegin', btnHtml);
                }
            }

            const btn = targetDoc.getElementById(this.btnId);
            if (btn) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openModal();
                });

                btn.addEventListener('mouseenter', () => {
                    const tooltipText = this.getTooltipText();
                    btn.setAttribute('title', tooltipText);
                    btn.setAttribute('data-tooltip', tooltipText);
                });

                btn.addEventListener('mouseleave', () => {
                    btn.removeAttribute('title');
                });
            }

            this.updateButtonState();
        }

        ensureButtonPosition(targetDoc, targetEl = null) {
            if (!targetDoc) return;
            const mt5Wrapper = targetDoc.getElementById(this.wrapperId);
            const fyersWrapper = targetDoc.getElementById('header-toolbar-broker-manager');
            const symbolSearch = targetDoc.getElementById('header-toolbar-symbol-search') || targetEl;

            if (mt5Wrapper && symbolSearch && symbolSearch.parentNode) {
                if (fyersWrapper && fyersWrapper.parentNode === symbolSearch.parentNode) {
                    if (fyersWrapper.nextElementSibling !== mt5Wrapper) {
                        fyersWrapper.parentNode.insertBefore(mt5Wrapper, fyersWrapper.nextSibling);
                    }
                } else if (symbolSearch.previousElementSibling !== mt5Wrapper) {
                    symbolSearch.parentNode.insertBefore(mt5Wrapper, symbolSearch);
                }
            }
        }

        updateButtonState() {
            const iframe = document.querySelector('#tv_chart_container iframe') || document.querySelector('iframe[id^="tradingview_"]');
            let targetDoc = document;
            if (iframe) {
                try {
                    targetDoc = iframe.contentDocument || iframe.contentWindow.document || document;
                } catch (_) {}
            }
            this.ensureButtonPosition(targetDoc);

            const btn = targetDoc.getElementById(this.btnId);
            if (!btn) return;

            const acc = window.MT5API ? window.MT5API.getActiveAccount() : null;
            const isConn = window.MT5API ? window.MT5API.isConnected : false;

            let dotColor = '#787b86';
            let avatarBg = '#787b86';
            let label = 'MT';

            if (this.switchingAccountId) {
                dotColor = '#2962ff';
                avatarBg = 'linear-gradient(135deg, #2962ff, #00b0ff)';
                label = '⚡';
            } else if (acc) {
                dotColor = isConn ? '#089981' : '#ff9800';
                avatarBg = isConn ? 'linear-gradient(135deg, #089981, #00796b)' : 'linear-gradient(135deg, #ff9800, #e65100)';
                const srv = (acc.server || '').toLowerCase();
                const nick = (acc.nickname || '').toLowerCase();
                if (srv.includes('fivepercent') || nick.includes('5er')) {
                    label = '5%';
                } else if (srv.includes('metaquotes') || nick.includes('demo')) {
                    label = 'MQ';
                } else if (srv.includes('ftmo')) {
                    label = 'FT';
                } else {
                    label = (acc.nickname || 'MT').slice(0, 2).toUpperCase();
                }
            }

            btn.innerHTML = `
            <span role="img" class="icon-GwQQdU8S" aria-hidden="true" style="position: relative; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;">
                <span class="tv-broker-avatar tv-mt5-avatar" style="
                    width: 22px; 
                    height: 22px; 
                    border-radius: 50%; 
                    background: ${avatarBg}; 
                    color: #ffffff; 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                    font-weight: 700; 
                    font-size: 10px; 
                    line-height: 22px; 
                    text-align: center; 
                    display: flex; 
                    align-items: center; 
                    justify-content: center; 
                    letter-spacing: 0.3px; 
                    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                    user-select: none;
                ">${label}</span>
                <span class="tv-broker-status-dot tv-mt5-status-dot" style="
                    position: absolute; 
                    bottom: 2px; 
                    right: 2px; 
                    width: 6.5px; 
                    height: 6.5px; 
                    border-radius: 50%; 
                    background: ${dotColor}; 
                    box-shadow: 0 0 0 1.5px #ffffff;
                "></span>
            </span>
            `;

            const tooltipText = this.switchingAccountId
                ? `Switching MT5 Account (${this.switchProgress ? this.switchProgress.pct : 15}%): ${this.switchProgress ? this.switchProgress.title : 'in progress...'}`
                : this.getTooltipText();
            btn.setAttribute('title', tooltipText);
        }

        openModal() {
            this.isOpen = true;
            let modal = document.getElementById(this.modalId);
            if (!modal) {
                modal = document.createElement('div');
                modal.id = this.modalId;
                modal.style.cssText = `
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0, 0, 0, 0.65);
                    backdrop-filter: blur(4px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 999999;
                    padding: 16px;
                `;
                modal.onclick = (e) => {
                    if (e.target === modal) this.closeModal();
                };
                document.body.appendChild(modal);
            }

            modal.style.display = 'flex';
            this.renderModal();
        }

        closeModal() {
            this.isOpen = false;
            const modal = document.getElementById(this.modalId);
            if (modal) modal.style.display = 'none';
        }

        renderModal() {
            const modal = document.getElementById(this.modalId);
            if (!modal) return;
            const theme = this.getTheme();
            const accounts = window.MT5API ? window.MT5API.accounts : [];
            const activeAcc = window.MT5API ? window.MT5API.getActiveAccount() : null;
            const isConn = window.MT5API ? window.MT5API.isConnected : false;

            modal.innerHTML = `
                <div style="
                    background: ${theme.bg};
                    color: ${theme.text};
                    border: 1px solid ${theme.border};
                    border-radius: 12px;
                    width: 700px;
                    max-width: 95vw;
                    max-height: 90vh;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 20px 45px rgba(0,0,0,0.45);
                    overflow: hidden;
                ">
                    <!-- Modal Header -->
                    <div style="
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        padding: 14px clamp(12px, 3vw, 20px);
                        background: ${theme.cardBg};
                        border-bottom: 1px solid ${theme.border};
                    ">
                        <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                            <span style="
                                width: 34px; height: 34px; border-radius: 8px;
                                background: linear-gradient(135deg, #2962ff 0%, #089981 100%);
                                color: #fff; display: flex; align-items: center; justify-content: center;
                                font-weight: bold; font-size: 16px; flex-shrink: 0;
                            ">⚡</span>
                            <div style="min-width: 0;">
                                <h3 style="margin: 0; font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    MetaTrader 5 Fleet Manager
                                </h3>
                                <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 2px;">
                                    24/7 Cloud Bridge & Multi-Account Execution
                                </div>
                            </div>
                        </div>
                        <button id="mt5-modal-btn-close" style="
                            background: transparent; border: none; color: ${theme.textMuted};
                            font-size: 20px; cursor: pointer; padding: 4px 8px; border-radius: 4px;
                        " title="Close">✕</button>
                    </div>

                    <!-- Navigation Tabs -->
                    <div style="
                        display: flex; gap: 6px; padding: 0 clamp(12px, 3vw, 20px);
                        border-bottom: 1px solid ${theme.border}; background: ${theme.cardBg};
                    ">
                        <button id="mt5-tab-fleet" type="button" style="
                            background: transparent; border: none;
                            border-bottom: 2px solid ${this.activeTab === 'fleet' ? theme.primary : 'transparent'};
                            color: ${this.activeTab === 'fleet' ? (theme.isDark ? '#fff' : '#131722') : theme.textMuted};
                            padding: 10px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
                            display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
                        ">
                            <span>💼</span> Prop Accounts Fleet (${accounts.length})
                        </button>
                        <button id="mt5-tab-settings" type="button" style="
                            background: transparent; border: none;
                            border-bottom: 2px solid ${this.activeTab === 'settings' ? theme.primary : 'transparent'};
                            color: ${this.activeTab === 'settings' ? (theme.isDark ? '#fff' : '#131722') : theme.textMuted};
                            padding: 10px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
                            display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
                        ">
                            <span>⚙️</span> Cloud Bridge Settings
                            <span style="width: 7px; height: 7px; border-radius: 50%; background: ${isConn ? theme.success : theme.warning}; display: inline-block;"></span>
                        </button>
                    </div>

                    <!-- Modal Body -->
                    <div style="padding: clamp(14px, 3vw, 20px); overflow-y: auto; flex: 1;">
                        ${this.activeTab === 'fleet' ? this.getFleetHtml(theme, accounts, activeAcc) : this.getSettingsHtml(theme)}
                    </div>
                </div>
            `;

            this.bindEvents(modal);
        }

        getFleetHtml(theme, accounts, activeAcc) {
            if (this.viewMode === 'details') {
                return this.getAccountDetailsHtml(theme, accounts, activeAcc);
            }
            if (this.viewMode === 'add') {
                return `
                    <div style="display: flex; flex-direction: column; gap: 14px;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <strong style="font-size: 14px; color: ${theme.text};">Connect New MT5 Account</strong>
                            <button id="mt5-btn-cancel-add" type="button" style="background: transparent; border: none; color: ${theme.primary}; font-size: 12px; cursor: pointer; font-weight: 600;">← Back to Fleet</button>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <div>
                                <label style="display: block; font-size: 11.5px; font-weight: 600; margin-bottom: 4px;">Account Nickname (e.g. The5ers $100K, Goat $50K) *</label>
                                <input type="text" id="mt5-in-nickname" placeholder="e.g. The5ers High Stakes" style="width: 100%; padding: 8px 12px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 6px; font-size: 12.5px;">
                            </div>
                            <div>
                                <label style="display: block; font-size: 11.5px; font-weight: 600; margin-bottom: 4px;">Broker MT5 Server Name *</label>
                                <input type="text" id="mt5-in-server" placeholder="e.g. TheFivePercenters-Live or GoatFundedTrader-Server" style="width: 100%; padding: 8px 12px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 6px; font-size: 12.5px;">
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px;">
                                <div>
                                    <label style="display: block; font-size: 11.5px; font-weight: 600; margin-bottom: 4px;">MT5 Login ID *</label>
                                    <input type="number" id="mt5-in-login" placeholder="e.g. 1058492" style="width: 100%; padding: 8px 12px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 6px; font-size: 12.5px;">
                                </div>
                                <div>
                                    <label style="display: block; font-size: 11.5px; font-weight: 600; margin-bottom: 4px;">MT5 Password *</label>
                                    <input type="password" id="mt5-in-password" placeholder="Trading password" style="width: 100%; padding: 8px 12px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 6px; font-size: 12.5px;">
                                </div>
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px;">
                                <div>
                                    <label style="display: block; font-size: 11.5px; font-weight: 600; margin-bottom: 4px;">Lot Scaling Multiplier</label>
                                    <input type="number" step="0.1" id="mt5-in-mult" value="1.0" placeholder="1.0" style="width: 100%; padding: 8px 12px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 6px; font-size: 12.5px;">
                                </div>
                                <div>
                                    <label style="display: block; font-size: 11.5px; font-weight: 600; margin-bottom: 4px;">Risk Sizing %</label>
                                    <input type="number" step="0.1" id="mt5-in-risk" value="1.0" placeholder="1.0" style="width: 100%; padding: 8px 12px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 6px; font-size: 12.5px;">
                                </div>
                            </div>
                            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;">
                                <button id="mt5-btn-save-acc" type="button" style="background: ${theme.primary}; color: #fff; border: none; padding: 9px 18px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer;">
                                    Connect & Save Account
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }

            const progressBanner = (this.switchingAccountId && this.switchProgress) ? `
                <div id="mt5-switch-progress-box" style="
                    background: ${theme.isDark ? 'rgba(41, 98, 255, 0.12)' : 'rgba(41, 98, 255, 0.08)'};
                    border: 1px solid rgba(41, 98, 255, 0.45);
                    border-radius: 8px;
                    padding: 12px 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
                ">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="mt5-pulse-spin" style="display:inline-block; width:13px; height:13px; border:2px solid #2962ff; border-top-color:transparent; border-radius:50%; animation:mt5spin 0.8s linear infinite;"></span>
                            <strong style="color: ${theme.primary}; font-size: 13px;" id="mt5-progress-title">${this.switchProgress.title}</strong>
                        </div>
                        <span style="font-size: 11.5px; font-weight: 700; color: ${theme.primary};" id="mt5-progress-pct">${this.switchProgress.pct}%</span>
                    </div>
                    <div style="width: 100%; height: 5px; background: rgba(0,0,0,0.15); border-radius: 4px; overflow: hidden;">
                        <div id="mt5-progress-bar" style="width: ${this.switchProgress.pct}%; height: 100%; background: linear-gradient(90deg, #2962ff, #00b0ff); border-radius: 4px; transition: width 0.3s ease;"></div>
                    </div>
                    <div style="font-size: 11.5px; color: ${theme.textMuted}; display: flex; align-items: center; justify-content: space-between;" id="mt5-progress-detail">
                        <span>${this.switchProgress.detail}</span>
                    </div>
                </div>
            ` : '';

            const cards = accounts.map(acc => {
                const isActive = activeAcc && activeAcc.id === acc.id;
                const isPaused = window.MT5API ? window.MT5API.isAccountPaused(acc.id) : false;
                const isChecked = window.MT5API && window.MT5API.multiAccountSelection.has(acc.id) && !isPaused;
                const isThisSwitching = (this.switchingAccountId === acc.id);
                const isAnySwitching = !!this.switchingAccountId;

                let cardBorder = isActive ? 'rgba(41,98,255,0.6)' : (isPaused ? 'rgba(255,165,0,0.35)' : theme.border);
                if (isThisSwitching) {
                    cardBorder = '#2962ff';
                }

                return `
                    <div style="
                        background: ${theme.cardBg};
                        border: 1px solid ${cardBorder};
                        border-radius: 8px;
                        padding: 14px;
                        margin-bottom: 10px;
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                        opacity: ${isPaused ? '0.85' : '1'};
                        transition: all 0.2s ease;
                        ${isThisSwitching ? 'box-shadow: 0 0 12px rgba(41, 98, 255, 0.25);' : ''}
                    ">
                        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" class="mt5-check-multi" data-id="${acc.id}" ${isChecked ? 'checked' : ''} ${isPaused || isAnySwitching ? 'disabled' : ''} title="${isPaused ? 'Account is paused in Standby mode. Click Resume to enable.' : 'Select for Multi-Account Simultaneous Copying'}" style="cursor: ${(isPaused || isAnySwitching) ? 'not-allowed' : 'pointer'}; width: 16px; height: 16px; accent-color: ${theme.primary};">
                                <div>
                                    <div style="font-weight: 700; font-size: 13.5px; color: ${theme.text}; display: flex; align-items: center; gap: 6px;">
                                        <span class="mt5-link-details" data-id="${acc.id}" style="cursor: pointer; text-decoration: underline; text-decoration-color: rgba(41,98,255,0.4); text-underline-offset: 2px;" title="Click to view full account details">${acc.nickname}</span>
                                        ${isActive ? `<span style="font-size: 9.5px; padding: 1px 6px; border-radius: 10px; background: ${theme.primary}; color: #fff; font-weight: 700;">ACTIVE FEED</span>` : ''}
                                        ${isPaused ? `<span style="font-size: 9.5px; padding: 1px 6px; border-radius: 10px; background: rgba(255,165,0,0.18); color: #ffa500; border: 1px solid rgba(255,165,0,0.4); font-weight: 700;">PAUSED</span>` : ''}
                                    </div>
                                    <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 2px;">
                                        Login: <strong>${acc.login}</strong> • Server: <strong>${acc.server}</strong>
                                    </div>
                                </div>
                            </div>
                            <div style="display: flex; gap: 6px; align-items: center;">
                                <button class="mt5-btn-view-details" data-id="${acc.id}" style="background: rgba(41,98,255,0.08); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.25); padding: 4px 9px; border-radius: 5px; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;" title="View full account details, financial metrics, and supported tickers">📋 Details</button>
                                ${isPaused
                                    ? `<button class="mt5-btn-resume-acc" data-id="${acc.id}" ${isAnySwitching ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : `style="background: rgba(0,200,83,0.12); color: ${theme.success}; border: 1px solid rgba(0,200,83,0.35); padding: 4px 9px; border-radius: 5px; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;"`} title="Resume account back to Online mode">▶️ Resume</button>`
                                    : `<button class="mt5-btn-pause-acc" data-id="${acc.id}" ${isAnySwitching ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : `style="background: rgba(255,165,0,0.12); color: #ffa500; border: 1px solid rgba(255,165,0,0.35); padding: 4px 9px; border-radius: 5px; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;"`} title="Pause account to put into Standby mode">⏸️ Pause</button>`
                                }
                                ${!isActive ? (
                                    isThisSwitching
                                        ? `<button class="mt5-btn-set-active" data-id="${acc.id}" disabled style="background: rgba(41,98,255,0.2); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.6); padding: 4px 9px; border-radius: 5px; font-size: 11px; font-weight: 700; cursor: wait; display: flex; align-items: center; gap: 4px;"><span class="mt5-pulse-spin" style="display:inline-block; width:10px; height:10px; border:2px solid #2962ff; border-top-color:transparent; border-radius:50%; animation:mt5spin 0.8s linear infinite;"></span> Switching... (${this.switchProgress ? this.switchProgress.pct : 15}%)</button>`
                                        : (isAnySwitching
                                            ? `<button class="mt5-btn-set-active" data-id="${acc.id}" disabled style="background: rgba(41,98,255,0.05); color: ${theme.textMuted}; border: 1px solid ${theme.border}; padding: 4px 9px; border-radius: 5px; font-size: 11px; opacity: 0.4; cursor: not-allowed;">Show Chart Feed</button>`
                                            : `<button class="mt5-btn-set-active" data-id="${acc.id}" style="background: rgba(41,98,255,0.1); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.3); padding: 4px 9px; border-radius: 5px; font-size: 11px; font-weight: 600; cursor: pointer;">Show Chart Feed</button>`
                                        )
                                ) : ''}
                                <button class="mt5-btn-delete-acc" data-id="${acc.id}" ${isAnySwitching ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : `style="background: transparent; color: ${theme.error}; border: 1px solid rgba(242,54,69,0.3); padding: 4px 8px; border-radius: 5px; font-size: 11px; cursor: pointer;"`} title="Disconnect / remove account">✕</button>
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; padding-top: 8px; border-top: 1px dashed ${theme.border}; font-size: 11.5px;">
                            <div>
                                <span style="color: ${theme.textMuted}; font-size: 10.5px;">Balance:</span><br>
                                <strong style="color: ${theme.text}; font-size: 12px;">$${Number(acc.balance || 0).toLocaleString()}</strong>
                            </div>
                            <div>
                                <span style="color: ${theme.textMuted}; font-size: 10.5px;">Equity:</span><br>
                                <strong style="color: ${theme.success}; font-size: 12px;">$${Number(acc.equity || 0).toLocaleString()}</strong>
                            </div>
                            <div>
                                <span style="color: ${theme.textMuted}; font-size: 10.5px;">Multiplier:</span><br>
                                <strong style="font-size: 12px;">${acc.lot_multiplier || 1.0}x</strong>
                            </div>
                            <div>
                                <span style="color: ${theme.textMuted}; font-size: 10.5px;">Connection:</span><br>
                                <strong style="color: ${isPaused ? '#ffa500' : theme.success}; font-size: 12px; display: inline-flex; align-items: center; gap: 4px;">
                                    ${isPaused ? '⚪ Standby (Paused)' : '🟢 Online'}
                                </strong>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div style="display: flex; flex-direction: column; gap: 14px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                        <div>
                            <strong style="font-size: 13.5px; color: ${theme.text};">Connected MT5 Fleets</strong>
                            <div style="font-size: 11px; color: ${theme.textMuted};">Check accounts to participate in 1-click multi-account parallel copying.</div>
                        </div>
                        <button id="mt5-btn-add-account-view" type="button" style="background: ${theme.primary}; color: #fff; border: none; padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;">
                            <span>➕</span> Add MT5 Account
                        </button>
                    </div>

                    ${progressBanner}

                    ${accounts.length === 0 ? `
                        <div style="text-align: center; padding: 30px; background: ${theme.cardBg}; border: 1px dashed ${theme.border}; border-radius: 8px;">
                            <div style="font-size: 24px; margin-bottom: 6px;">💼</div>
                            <div style="font-weight: 600; font-size: 13px; color: ${theme.text};">No MT5 Accounts Added Yet</div>
                            <div style="font-size: 11.5px; color: ${theme.textMuted}; margin-top: 4px;">Connect your The5ers, Goat Funded Trader, or broker account to start.</div>
                        </div>
                    ` : cards}
                </div>
            `;
        }

        getSettingsHtml(theme) {
            const endpoint = window.MT5API ? window.MT5API.endpoint : '';
            const apiKey = window.MT5API ? window.MT5API.apiKey : '';
            const isConn = window.MT5API ? window.MT5API.isConnected : false;
            const isConfigured = !!endpoint;
            const ping = window.MT5API ? window.MT5API.pingMs : 0;
            const statusMsg = isConn 
                ? `🟢 Connected (Ping: ${ping}ms)` 
                : (!isConfigured 
                    ? '⚙️ Bridge Not Configured — enter your Bridge URL below' 
                    : '⚠️ Not Connected — verify Bridge URL and API Key below');
            const iconBg = isConn 
                ? theme.success 
                : (!isConfigured ? (theme.isDark ? '#434651' : '#b2b5be') : theme.warning);

            return `
                <div style="display: flex; flex-direction: column; gap: 14px;">
                    <!-- Status Card -->
                    <div style="background: ${theme.cardBg}; border: 1px solid ${isConn ? 'rgba(8,153,129,0.3)' : theme.border}; border-radius: 8px; padding: 14px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <span style="width: 32px; height: 32px; border-radius: 8px; background: ${iconBg}; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px;">⚡</span>
                                <div>
                                    <strong style="font-size: 13.5px; color: ${theme.text};">MT5 Cloud Bridge Connection</strong>
                                    <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 2px;">
                                        ${statusMsg}
                                    </div>
                                </div>
                            </div>
                            <button id="mt5-btn-test-conn" type="button" style="background: ${theme.isDark ? '#2a2e39' : '#e0e3eb'}; color: ${theme.text}; border: 1px solid ${theme.border}; padding: 6px 12px; border-radius: 6px; font-size: 11.5px; font-weight: 600; cursor: pointer;">
                                🔄 Test Connection
                            </button>
                        </div>
                    </div>

                    <!-- Connection Inputs -->
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <div>
                            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Bridge Endpoint URL (Cloudflare Tunnel or Local IP) *</label>
                            <input type="text" id="mt5-in-endpoint" value="${endpoint}" placeholder="e.g. https://mt5.yourdomain.com or http://localhost:8000" style="width: 100%; padding: 9px 12px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 6px; font-size: 12.5px;">
                            <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 3px;">
                                Point this to your Oracle Cloud / VPS Cloudflare Tunnel address or local server.
                            </div>
                        </div>

                        <div>
                            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Bearer API Secret Key *</label>
                            <input type="password" id="mt5-in-apikey" value="${apiKey}" placeholder="Secret key configured on bridge server" style="width: 100%; padding: 9px 12px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 6px; font-size: 12.5px; font-family: monospace;">
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px;">
                            <button id="mt5-btn-save-settings" type="button" style="background: ${theme.primary}; color: #fff; border: none; padding: 9px 18px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer;">
                                💾 Save Bridge Settings
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }


        async openAccountDetails(accountId, forceRefresh = false) {
            this.viewMode = 'details';
            this.detailsAccountId = accountId;
            this.tickerSearchQuery = '';
            this.tickerCategoryFilter = 'ALL';
            this.historySearchQuery = '';
            this.historyTypeFilter = 'ALL';
            this.historyOutcomeFilter = 'ALL';
            this.historyDateFilter = 'ALL';
            this.historySortField = 'time';
            this.historySortDir = 'desc';

            if (!forceRefresh && this._accountDetailsCache.has(accountId)) {
                this.detailsData = this._accountDetailsCache.get(accountId);
                this.detailsLoading = false;
                this.detailsSyncing = false;
                this.renderModal();
                return;
            }

            // Immediately pre-populate with known account info so user NEVER sees a blank screen!
            const existingAcc = window.MT5API ? (window.MT5API.accounts.find(a => String(a.id) === String(accountId)) || window.MT5API.getActiveAccount()) : null;
            const cachedSymbols = (window.MT5API && window.MT5API._accountSymbolsCache) ? (window.MT5API._accountSymbolsCache.get(accountId) || []) : [];
            const storedHistory = window.MT5API ? window.MT5API.getStoredTradeHistory(accountId) : [];

            const initialCategories = {};
            cachedSymbols.forEach(s => {
                const cat = s.category || s.type || 'Other';
                if (!initialCategories[cat]) initialCategories[cat] = 0;
                initialCategories[cat]++;
            });

            this.detailsData = {
                account: existingAcc,
                symbols: cachedSymbols,
                positions: [],
                history: storedHistory,
                categories: initialCategories,
                lastTradeFormatted: (storedHistory && storedHistory.length > 0) ? new Date(storedHistory[0].time).toLocaleString() : (existingAcc && existingAcc.created_at ? `Account added: ${new Date(existingAcc.created_at * 1000).toLocaleDateString()}` : 'Syncing live...'),
                totalSymbols: cachedSymbols.length,
                fetchedAt: Date.now()
            };

            this.detailsLoading = false;
            this.detailsSyncing = true;
            this.detailsProgress = { step: 1, title: 'Connecting to MT5 Profile...', detail: `Checking account specs for #${existingAcc ? existingAcc.login : accountId}`, pct: 20 };
            this.renderModal();

            const onProgress = (step, title, detail, pct) => {
                this.detailsProgress = { step, title, detail, pct };
                this.updateDetailsSyncProgress(title, detail, pct);
            };

            try {
                if (window.MT5API) {
                    const data = await window.MT5API.fetchAccountFullDetails(accountId, onProgress);
                    if (data) {
                        this.detailsData = data;
                        this._accountDetailsCache.set(accountId, data);
                    }
                }
            } catch (err) {
                console.error('[MT5UI] Failed to fetch account details:', err);
            } finally {
                this.detailsSyncing = false;
                this.detailsProgress = null;
                this.renderModal();
            }
        }

        updateDetailsSyncProgress(title, detail, pct) {
            const modal = document.getElementById(this.modalId);
            if (!modal) return;
            const titleEl = modal.querySelector('#mt5-details-sync-title');
            const detailEl = modal.querySelector('#mt5-details-sync-detail');
            const barEl = modal.querySelector('#mt5-details-sync-bar');
            const pctEl = modal.querySelector('#mt5-details-sync-pct');
            if (titleEl) titleEl.innerText = title;
            if (detailEl) detailEl.innerText = detail;
            if (barEl) barEl.style.width = `${pct}%`;
            if (pctEl) pctEl.innerText = `${pct}%`;
        }

        async loadSymbolOnChart(symbol, brokerServer = null) {
            if (!window.tvWidget) {
                alert('Chart widget not yet initialized.');
                return;
            }
            const chart = window.tvWidget.activeChart ? window.tvWidget.activeChart() : window.tvWidget.chart();
            if (!chart) return;

            let brokerExchange = '';
            if (window.MT5API && typeof window.MT5API.getBrokerExchangeName === 'function') {
                brokerExchange = window.MT5API.getBrokerExchangeName(brokerServer);
            }
            const cleanSym = String(symbol || '').trim();
            const targetSymbol = brokerExchange ? `${brokerExchange}:${cleanSym}` : cleanSym;

            console.log(`[MT5UI] Loading symbol on chart: ${targetSymbol}`);

            // Clear caches for this symbol so fresh bars are requested
            if (window._barsCache) {
                for (const k in window._barsCache) {
                    if (k.toUpperCase().includes(cleanSym)) delete window._barsCache[k];
                }
            }
            if (window._tvLastBar) {
                for (const k in window._tvLastBar) {
                    if (k.toUpperCase().includes(cleanSym)) delete window._tvLastBar[k];
                }
            }
            if (window._symbolEarliestTime) delete window._symbolEarliestTime[cleanSym];
            if (window._symbolEarliestDate) delete window._symbolEarliestDate[cleanSym];

            if (window.tvWidget && typeof window.tvWidget.resetCache === 'function') {
                try { window.tvWidget.resetCache(); } catch (_) {}
            }

            try {
                if (typeof chart.setSymbol === 'function') {
                    await chart.setSymbol(targetSymbol);
                }
                if (typeof chart.resetData === 'function') {
                    chart.resetData();
                }
            } catch (e) {
                console.warn('[MT5UI] chart.setSymbol error:', e);
            }

            this.closeModal();
            this.showFloatingSwitchToast('Chart Loaded', `Opened ${targetSymbol} on chart`, 100, true);
        }


        getFilteredAndSortedHistory() {
            if (!this.detailsData || !this.detailsData.history) return [];
            let list = [...this.detailsData.history];

            // 1. Text Search (symbol, ticket, comment)
            if (this.historySearchQuery) {
                const q = this.historySearchQuery.toUpperCase().trim();
                list = list.filter(h => {
                    const symMatch = h.symbol && h.symbol.toUpperCase().includes(q);
                    const ticketMatch = String(h.ticket).includes(q) || String(h.order).includes(q);
                    const commentMatch = h.comment && h.comment.toUpperCase().includes(q);
                    return symMatch || ticketMatch || commentMatch;
                });
            }

            // 2. Type Filter (ALL, BUY, SELL)
            if (this.historyTypeFilter && this.historyTypeFilter !== 'ALL') {
                list = list.filter(h => String(h.type).toUpperCase() === this.historyTypeFilter);
            }

            // 3. Outcome Filter (ALL, WIN, LOSS)
            if (this.historyOutcomeFilter === 'WIN') {
                list = list.filter(h => Number(h.profit || 0) >= 0);
            } else if (this.historyOutcomeFilter === 'LOSS') {
                list = list.filter(h => Number(h.profit || 0) < 0);
            }

            // 4. Date Filter (ALL, TODAY, 7D, 30D)
            if (this.historyDateFilter && this.historyDateFilter !== 'ALL') {
                const now = Date.now();
                let cutoff = 0;
                if (this.historyDateFilter === 'TODAY') {
                    const startOfToday = new Date();
                    startOfToday.setHours(0, 0, 0, 0);
                    cutoff = startOfToday.getTime();
                } else if (this.historyDateFilter === '7D') {
                    cutoff = now - (7 * 24 * 60 * 60 * 1000);
                } else if (this.historyDateFilter === '30D') {
                    cutoff = now - (30 * 24 * 60 * 60 * 1000);
                }
                if (cutoff > 0) {
                    list = list.filter(h => Number(h.time || 0) >= cutoff);
                }
            }

            // 5. Sorting
            const field = this.historySortField || 'time';
            const isAsc = this.historySortDir === 'asc';
            list.sort((a, b) => {
                let vA, vB;
                if (field === 'time') {
                    vA = Number(a.time || 0);
                    vB = Number(b.time || 0);
                } else if (field === 'profit') {
                    vA = Number(a.profit || 0);
                    vB = Number(b.profit || 0);
                } else if (field === 'volume') {
                    vA = Number(a.volume || 0);
                    vB = Number(b.volume || 0);
                } else if (field === 'symbol') {
                    vA = String(a.symbol || '');
                    vB = String(b.symbol || '');
                    return isAsc ? vA.localeCompare(vB) : vB.localeCompare(vA);
                } else if (field === 'ticket') {
                    vA = Number(a.ticket || 0);
                    vB = Number(b.ticket || 0);
                } else {
                    vA = Number(a.time || 0);
                    vB = Number(b.time || 0);
                }
                return isAsc ? (vA - vB) : (vB - vA);
            });

            return list;
        }

        exportHistoryToCsv() {
            const list = this.getFilteredAndSortedHistory();
            if (!list || list.length === 0) {
                alert('No trades available to export.');
                return;
            }
            const acc = this.detailsData && this.detailsData.account ? this.detailsData.account : { login: 'account' };
            const headers = ['Ticket', 'Order', 'Symbol', 'Type', 'Volume', 'Price', 'Profit', 'Swap', 'Commission', 'Time', 'Comment'];
            const rows = list.map(h => [
                h.ticket,
                h.order,
                h.symbol,
                h.type,
                h.volume,
                h.price,
                h.profit,
                h.swap || 0,
                h.commission || 0,
                h.time_formatted || (h.time ? new Date(h.time).toISOString() : ''),
                `"${(h.comment || '').replace(/"/g, '""')}"`
            ]);
            const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement('a');
            link.setAttribute('href', encodedUri);
            link.setAttribute('download', `MT5_History_${acc.login}_${Date.now()}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        }

        getHistoryTableHtml(theme, server) {
            const list = this.getFilteredAndSortedHistory();
            if (list.length === 0) {
                return `
                    <div style="text-align: center; padding: 36px 20px; background: ${theme.cardBg}; border: 1px dashed ${theme.border}; border-radius: 8px;">
                        <div style="font-size: 26px; margin-bottom: 6px;">📜</div>
                        <div style="font-weight: 600; font-size: 13.5px; color: ${theme.text};">No Trades Found</div>
                        <div style="font-size: 11.5px; color: ${theme.textMuted}; margin-top: 4px;">No closed deals match the active filters. Try resetting search or time filters.</div>
                    </div>
                `;
            }

            const arrow = (col) => {
                if (this.historySortField !== col) return '<span style="opacity:0.3; margin-left:3px;">⇅</span>';
                return this.historySortDir === 'asc' ? '<span style="color:#2962ff; margin-left:3px;">▲</span>' : '<span style="color:#2962ff; margin-left:3px;">▼</span>';
            };

            return `
                <div style="overflow-x: auto; border: 1px solid ${theme.border}; border-radius: 8px; max-height: 380px;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 11.5px; text-align: left;">
                        <thead>
                            <tr style="background: ${theme.cardBg}; border-bottom: 1px solid ${theme.border}; color: ${theme.textMuted}; position: sticky; top: 0; z-index: 2;">
                                <th class="mt5-sort-header" data-sort="ticket" style="padding: 8px 10px; cursor: pointer; user-select: none;">Ticket ${arrow('ticket')}</th>
                                <th class="mt5-sort-header" data-sort="symbol" style="padding: 8px 10px; cursor: pointer; user-select: none;">Symbol ${arrow('symbol')}</th>
                                <th class="mt5-sort-header" data-sort="type" style="padding: 8px 10px; cursor: pointer; user-select: none;">Type ${arrow('type')}</th>
                                <th class="mt5-sort-header" data-sort="volume" style="padding: 8px 10px; cursor: pointer; user-select: none;">Lots ${arrow('volume')}</th>
                                <th style="padding: 8px 10px;">Price</th>
                                <th class="mt5-sort-header" data-sort="profit" style="padding: 8px 10px; text-align: right; cursor: pointer; user-select: none;">Profit ($) ${arrow('profit')}</th>
                                <th class="mt5-sort-header" data-sort="time" style="padding: 8px 10px; cursor: pointer; user-select: none;">Close Time ${arrow('time')}</th>
                                <th style="padding: 8px 10px; text-align: center;">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${list.map(h => {
                                const isBuy = String(h.type).toUpperCase() === 'BUY';
                                const profit = Number(h.profit || 0);
                                const profitColor = profit >= 0 ? theme.success : theme.error;
                                const timeStr = h.time_formatted || (h.time ? new Date(h.time).toLocaleString() : 'N/A');
                                return `
                                    <tr style="border-bottom: 1px solid ${theme.border};">
                                        <td style="padding: 7px 10px; font-family: monospace; color: ${theme.textMuted};">#${h.ticket}</td>
                                        <td style="padding: 7px 10px; font-weight: 700; color: ${theme.text}; font-family: monospace;">${h.symbol}</td>
                                        <td style="padding: 7px 10px; font-weight: 700; color: ${isBuy ? theme.success : theme.error};">${h.type}</td>
                                        <td style="padding: 7px 10px;">${h.volume}</td>
                                        <td style="padding: 7px 10px;">${h.price}</td>
                                        <td style="padding: 7px 10px; text-align: right; font-weight: 700; color: ${profitColor}; font-family: monospace;">${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}</td>
                                        <td style="padding: 7px 10px; color: ${theme.textMuted}; white-space: nowrap;">${timeStr}</td>
                                        <td style="padding: 7px 10px; text-align: center;">
                                            <button class="mt5-btn-chart-symbol" data-symbol="${h.symbol}" data-server="${server || ''}" style="
                                                background: rgba(41,98,255,0.12);
                                                color: ${theme.primary};
                                                border: 1px solid rgba(41,98,255,0.3);
                                                padding: 2px 7px;
                                                border-radius: 4px;
                                                font-size: 10px;
                                                cursor: pointer;
                                            ">📈</button>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        updateHistoryListView(modal, theme) {
            const container = modal.querySelector('#mt5-history-items-container');
            if (!container) return;
            const server = this.detailsData && this.detailsData.account ? this.detailsData.account.server : '';
            container.innerHTML = this.getHistoryTableHtml(theme, server);

            // Re-bind chart buttons
            container.querySelectorAll('.mt5-btn-chart-symbol').forEach(btn => {
                btn.onclick = (e) => {
                    const sym = e.currentTarget.getAttribute('data-symbol');
                    const srv = e.currentTarget.getAttribute('data-server');
                    this.loadSymbolOnChart(sym, srv);
                };
            });

            // Re-bind sort headers
            container.querySelectorAll('.mt5-sort-header').forEach(th => {
                th.onclick = (e) => {
                    const field = e.currentTarget.getAttribute('data-sort');
                    if (this.historySortField === field) {
                        this.historySortDir = this.historySortDir === 'desc' ? 'asc' : 'desc';
                    } else {
                        this.historySortField = field;
                        this.historySortDir = 'desc';
                    }
                    this.updateHistoryListView(modal, theme);
                };
            });
        }

        getTickerListHtml(symbols, theme, server) {
            if (!symbols || symbols.length === 0) {
                return `
                    <div style="text-align: center; padding: 32px 16px; color: ${theme.textMuted}; font-size: 12.5px;">
                        No symbols match the current search or category filter.
                    </div>
                `;
            }

            return symbols.map(s => {
                const cat = s.category || s.type || 'Other';
                const digits = s.digits != null ? s.digits : 2;
                const minLot = s.min_lot != null ? s.min_lot : 0.01;
                const maxLot = s.max_lot != null ? s.max_lot : 100.0;
                const stepLot = s.lot_step != null ? s.lot_step : 0.01;
                const desc = (s.description && s.description !== s.name) ? s.description : '';

                return `
                    <div style="
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        padding: 8px 12px;
                        background: ${theme.cardBg};
                        border: 1px solid ${theme.border};
                        border-radius: 6px;
                        margin-bottom: 6px;
                        gap: 10px;
                        transition: background 0.15s ease;
                    ">
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                            <strong style="font-size: 13px; color: ${theme.text}; font-family: monospace; letter-spacing: 0.3px;">${s.name}</strong>
                            <span style="font-size: 9.5px; padding: 1px 6px; border-radius: 4px; background: rgba(41,98,255,0.12); color: ${theme.primary}; font-weight: 600; white-space: nowrap;">${cat}</span>
                            ${desc ? `<span style="font-size: 11px; color: ${theme.textMuted}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${desc}</span>` : ''}
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px; flex-shrink: 0;">
                            <div style="font-size: 11px; color: ${theme.textMuted}; text-align: right; white-space: nowrap;">
                                <span>Lots: <strong>${minLot}</strong>-${maxLot}</span>
                                <span style="margin-left: 5px; opacity: 0.75;">(${digits} dec)</span>
                            </div>
                            <button class="mt5-btn-chart-symbol" data-symbol="${s.name}" data-server="${server || ''}" style="
                                background: rgba(41,98,255,0.12);
                                color: ${theme.primary};
                                border: 1px solid rgba(41,98,255,0.3);
                                padding: 4px 9px;
                                border-radius: 5px;
                                font-size: 11px;
                                font-weight: 600;
                                cursor: pointer;
                                display: inline-flex;
                                align-items: center;
                                gap: 4px;
                            " title="Open ${s.name} on TradingView Chart">
                                <span>📈</span> Chart
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        updateTickerListView(modal, theme, server) {
            const container = modal.querySelector('#mt5-ticker-items-container');
            if (!container || !this.detailsData) return;

            let symbols = this.detailsData.symbols || [];
            if (this.tickerCategoryFilter && this.tickerCategoryFilter !== 'ALL') {
                symbols = symbols.filter(s => (s.category || s.type || 'Other') === this.tickerCategoryFilter);
            }
            if (this.tickerSearchQuery) {
                const q = this.tickerSearchQuery.toUpperCase().trim();
                symbols = symbols.filter(s => {
                    const nameMatch = s.name && s.name.toUpperCase().includes(q);
                    const descMatch = s.description && s.description.toUpperCase().includes(q);
                    const catMatch = (s.category || s.type || '').toUpperCase().includes(q);
                    return nameMatch || descMatch || catMatch;
                });
            }

            container.innerHTML = this.getTickerListHtml(symbols, theme, server);

            // Re-bind chart buttons inside the updated ticker list
            container.querySelectorAll('.mt5-btn-chart-symbol').forEach(btn => {
                btn.onclick = (e) => {
                    const sym = e.currentTarget.getAttribute('data-symbol');
                    const srv = e.currentTarget.getAttribute('data-server');
                    this.loadSymbolOnChart(sym, srv);
                };
            });

            // Update category pills active state
            modal.querySelectorAll('.mt5-cat-pill').forEach(pill => {
                const cat = pill.getAttribute('data-cat');
                if (cat === this.tickerCategoryFilter) {
                    pill.style.background = theme.primary;
                    pill.style.color = '#ffffff';
                    pill.style.borderColor = theme.primary;
                } else {
                    pill.style.background = 'transparent';
                    pill.style.color = theme.textMuted;
                    pill.style.borderColor = theme.border;
                }
            });
        }

        getAccountDetailsHtml(theme, accounts, activeAcc) {
            if (!this.detailsData || !this.detailsData.account) {
                return `
                    <div style="display: flex; flex-direction: column; gap: 14px; padding: 20px;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <button id="mt5-btn-back-fleet" type="button" style="background: transparent; border: none; color: ${theme.primary}; font-size: 12.5px; cursor: pointer; font-weight: 600;">← Back to Fleet</button>
                        </div>
                        <div style="text-align: center; padding: 30px; background: ${theme.cardBg}; border: 1px dashed ${theme.border}; border-radius: 8px;">
                            <div style="font-size: 24px; margin-bottom: 6px;">⚠️</div>
                            <div style="font-weight: 600; font-size: 13px; color: ${theme.text};">Could not load account details</div>
                            <div style="font-size: 11.5px; color: ${theme.textMuted}; margin-top: 4px;">Make sure the bridge server is running and connected.</div>
                            <button id="mt5-btn-retry-details" style="margin-top: 12px; background: ${theme.primary}; color: #fff; border: none; padding: 6px 14px; border-radius: 6px; font-size: 12px; cursor: pointer;">Retry</button>
                        </div>
                    </div>
                `;
            }

            const acc = this.detailsData.account;
            const symbols = this.detailsData.symbols || [];
            const positions = this.detailsData.positions || [];
            const history = this.detailsData.history || [];
            const categories = this.detailsData.categories || {};
            const lastTradeFormatted = this.detailsData.lastTradeFormatted || 'No active trades';

            // Performance metrics from history
            const closedWins = history.filter(h => Number(h.profit || 0) > 0);
            const closedLosses = history.filter(h => Number(h.profit || 0) < 0);
            const totalClosed = closedWins.length + closedLosses.length;
            const winRate = totalClosed > 0 ? ((closedWins.length / totalClosed) * 100).toFixed(1) : '0.0';
            const netHistoryProfit = history.reduce((sum, h) => sum + Number(h.profit || 0), 0);
            const grossProfit = closedWins.reduce((sum, h) => sum + Number(h.profit || 0), 0);
            const grossLoss = Math.abs(closedLosses.reduce((sum, h) => sum + Number(h.profit || 0), 0));
            const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? '∞' : '0.00');
            const bestWin = closedWins.length > 0 ? Math.max(...closedWins.map(h => Number(h.profit || 0))).toFixed(2) : '0.00';
            const worstLoss = closedLosses.length > 0 ? Math.min(...closedLosses.map(h => Number(h.profit || 0))).toFixed(2) : '0.00';
            const isActive = activeAcc && activeAcc.id === acc.id;
            const isPaused = window.MT5API ? window.MT5API.isAccountPaused(acc.id) : false;

            const bal = acc.balance != null ? Number(acc.balance) : 0;
            const eq = acc.equity != null ? Number(acc.equity) : 0;
            const freeMargin = acc.free_margin != null ? Number(acc.free_margin) : 0;
            const margin = acc.margin != null ? Number(acc.margin) : 0;
            const marginLvl = acc.margin_level != null ? Number(acc.margin_level) : null;
            const pnl = eq - bal;

            const categoryList = Object.keys(categories);

            // Filter symbols for tickers tab view
            let filteredSymbols = symbols;
            if (this.tickerCategoryFilter && this.tickerCategoryFilter !== 'ALL') {
                filteredSymbols = filteredSymbols.filter(s => (s.category || s.type || 'Other') === this.tickerCategoryFilter);
            }
            if (this.tickerSearchQuery) {
                const q = this.tickerSearchQuery.toUpperCase().trim();
                filteredSymbols = filteredSymbols.filter(s => {
                    const nameMatch = s.name && s.name.toUpperCase().includes(q);
                    const descMatch = s.description && s.description.toUpperCase().includes(q);
                    const catMatch = (s.category || s.type || '').toUpperCase().includes(q);
                    return nameMatch || descMatch || catMatch;
                });
            }

            return `
                <div style="display: flex; flex-direction: column; gap: 14px;">
                    <!-- Top Breadcrumb & Controls -->
                    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <button id="mt5-btn-back-fleet" type="button" style="
                                background: ${theme.cardBg};
                                border: 1px solid ${theme.border};
                                color: ${theme.text};
                                padding: 6px 12px;
                                border-radius: 6px;
                                font-size: 12px;
                                font-weight: 600;
                                cursor: pointer;
                                display: inline-flex;
                                align-items: center;
                                gap: 5px;
                            ">
                                <span>←</span> Fleet
                            </button>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <strong style="font-size: 15px; color: ${theme.text};">${acc.nickname}</strong>
                                ${isActive ? `<span style="font-size: 9.5px; padding: 2px 7px; border-radius: 10px; background: ${theme.primary}; color: #fff; font-weight: 700;">ACTIVE FEED</span>` : ''}
                                ${isPaused ? `<span style="font-size: 9.5px; padding: 2px 7px; border-radius: 10px; background: rgba(255,165,0,0.18); color: #ffa500; border: 1px solid rgba(255,165,0,0.4); font-weight: 700;">PAUSED</span>` : ''}
                            </div>
                        </div>

                        <div style="display: flex; align-items: center; gap: 8px;">
                            ${!isActive ? `<button class="mt5-btn-set-active" data-id="${acc.id}" style="background: rgba(41,98,255,0.1); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.3); padding: 5px 11px; border-radius: 6px; font-size: 11.5px; font-weight: 600; cursor: pointer;">Show Chart Feed</button>` : ''}
                            <button id="mt5-btn-refresh-details" data-id="${acc.id}" style="
                                background: ${theme.cardBg};
                                border: 1px solid ${theme.border};
                                color: ${theme.textMuted};
                                padding: 5px 10px;
                                border-radius: 6px;
                                font-size: 11.5px;
                                font-weight: 600;
                                cursor: pointer;
                                display: inline-flex;
                                align-items: center;
                                gap: 4px;
                            " title="Refresh live financials and tickers">
                                <span>🔄</span> Refresh
                            </button>
                        </div>
                    </div>

                    ${this.detailsSyncing ? `
                        <div id="mt5-details-sync-progress-box" style="
                            background: ${theme.isDark ? 'rgba(41, 98, 255, 0.12)' : 'rgba(41, 98, 255, 0.08)'};
                            border: 1px solid rgba(41, 98, 255, 0.45);
                            border-radius: 8px;
                            padding: 10px 14px;
                            display: flex;
                            flex-direction: column;
                            gap: 6px;
                            box-shadow: 0 4px 16px rgba(0,0,0,0.12);
                        ">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span class="mt5-pulse-spin" style="display:inline-block; width:12px; height:12px; border:2px solid #2962ff; border-top-color:transparent; border-radius:50%; animation:mt5spin 0.8s linear infinite;"></span>
                                    <strong style="color: ${theme.primary}; font-size: 12.5px;" id="mt5-details-sync-title">${this.detailsProgress ? this.detailsProgress.title : 'Syncing Live MT5 Specs...'}</strong>
                                </div>
                                <span style="font-size: 11px; font-weight: 700; color: ${theme.primary};" id="mt5-details-sync-pct">${this.detailsProgress ? this.detailsProgress.pct : 25}%</span>
                            </div>
                            <div style="width: 100%; height: 4px; background: rgba(0,0,0,0.15); border-radius: 3px; overflow: hidden;">
                                <div id="mt5-details-sync-bar" style="width: ${this.detailsProgress ? this.detailsProgress.pct : 25}%; height: 100%; background: linear-gradient(90deg, #2962ff, #00b0ff); border-radius: 3px; transition: width 0.3s ease;"></div>
                            </div>
                            <div style="font-size: 11px; color: ${theme.textMuted};" id="mt5-details-sync-detail">
                                ${this.detailsProgress ? this.detailsProgress.detail : 'Fetching broker market watch & trade history...'}
                            </div>
                        </div>
                    ` : ''}

                    <!-- Subtabs Header -->
                    <div style="display: flex; gap: 6px; border-bottom: 1px solid ${theme.border}; margin-top: 4px; overflow-x: auto;">
                        <button class="mt5-subtab-btn" data-subtab="overview" style="
                            background: transparent;
                            border: none;
                            border-bottom: 2px solid ${this.detailsSubTab === 'overview' ? theme.primary : 'transparent'};
                            color: ${this.detailsSubTab === 'overview' ? (theme.isDark ? '#fff' : '#131722') : theme.textMuted};
                            padding: 8px 12px;
                            font-size: 12px;
                            font-weight: 600;
                            cursor: pointer;
                            display: inline-flex;
                            align-items: center;
                            gap: 5px;
                            white-space: nowrap;
                        ">
                            <span>📊</span> Overview & Financials
                        </button>
                        <button class="mt5-subtab-btn" data-subtab="tickers" style="
                            background: transparent;
                            border: none;
                            border-bottom: 2px solid ${this.detailsSubTab === 'tickers' ? theme.primary : 'transparent'};
                            color: ${this.detailsSubTab === 'tickers' ? (theme.isDark ? '#fff' : '#131722') : theme.textMuted};
                            padding: 8px 12px;
                            font-size: 12px;
                            font-weight: 600;
                            cursor: pointer;
                            display: inline-flex;
                            align-items: center;
                            gap: 5px;
                            white-space: nowrap;
                        ">
                            <span>📈</span> Supported Tickers (${symbols.length})
                        </button>
                        <button class="mt5-subtab-btn" data-subtab="positions" style="
                            background: transparent;
                            border: none;
                            border-bottom: 2px solid ${this.detailsSubTab === 'positions' ? theme.primary : 'transparent'};
                            color: ${this.detailsSubTab === 'positions' ? (theme.isDark ? '#fff' : '#131722') : theme.textMuted};
                            padding: 8px 12px;
                            font-size: 12px;
                            font-weight: 600;
                            cursor: pointer;
                            display: inline-flex;
                            align-items: center;
                            gap: 5px;
                            white-space: nowrap;
                        ">
                            <span>💼</span> Active Positions (${positions.length})
                        </button>
                        <button class="mt5-subtab-btn" data-subtab="history" style="
                            background: transparent;
                            border: none;
                            border-bottom: 2px solid ${this.detailsSubTab === 'history' ? theme.primary : 'transparent'};
                            color: ${this.detailsSubTab === 'history' ? (theme.isDark ? '#fff' : '#131722') : theme.textMuted};
                            padding: 8px 12px;
                            font-size: 12px;
                            font-weight: 600;
                            cursor: pointer;
                            display: inline-flex;
                            align-items: center;
                            gap: 5px;
                            white-space: nowrap;
                        ">
                            <span>📜</span> Order History (${history.length})
                        </button>
                    </div>

                    <!-- Subtab 1: Overview & Financials -->
                    ${this.detailsSubTab === 'overview' ? `
                        <div style="display: flex; flex-direction: column; gap: 14px;">
                            <!-- KPI Financial Cards Grid -->
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px;">
                                <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 8px; padding: 12px;">
                                    <div style="font-size: 11px; color: ${theme.textMuted}; margin-bottom: 4px;">Balance</div>
                                    <div style="font-size: 16px; font-weight: 700; color: ${theme.text};">$${bal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                                    <div style="font-size: 10px; color: ${theme.textMuted}; margin-top: 2px;">Currency: ${acc.currency || 'USD'}</div>
                                </div>
                                <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 8px; padding: 12px;">
                                    <div style="font-size: 11px; color: ${theme.textMuted}; margin-bottom: 4px;">Equity</div>
                                    <div style="font-size: 16px; font-weight: 700; color: ${pnl >= 0 ? theme.success : theme.error};">$${eq.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                                    <div style="font-size: 10px; color: ${pnl >= 0 ? theme.success : theme.error}; margin-top: 2px;">Floating: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</div>
                                </div>
                                <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 8px; padding: 12px;">
                                    <div style="font-size: 11px; color: ${theme.textMuted}; margin-bottom: 4px;">Free Margin</div>
                                    <div style="font-size: 16px; font-weight: 700; color: ${theme.text};">$${freeMargin.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                                    <div style="font-size: 10px; color: ${theme.textMuted}; margin-top: 2px;">Margin Used: $${margin.toFixed(2)}</div>
                                </div>
                                <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 8px; padding: 12px;">
                                    <div style="font-size: 11px; color: ${theme.textMuted}; margin-bottom: 4px;">Leverage & Margin</div>
                                    <div style="font-size: 16px; font-weight: 700; color: ${theme.primary};">1:${acc.leverage || 100}</div>
                                    <div style="font-size: 10px; color: ${theme.textMuted}; margin-top: 2px;">Level: ${marginLvl != null ? marginLvl.toFixed(1) + '%' : '100%'}</div>
                                </div>
                            </div>

                            <!-- Account Specifications Table -->
                            <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 8px; padding: 14px;">
                                <div style="font-weight: 700; font-size: 12.5px; color: ${theme.text}; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
                                    <span>⚙️ Account Specifications & Parameters</span>
                                    <span style="font-size: 11px; color: ${theme.textMuted}; font-weight: 400;">ID: ${acc.id}</span>
                                </div>
                                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; font-size: 12px;">
                                    <div style="display: flex; flex-direction: column; gap: 6px;">
                                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed ${theme.border}; padding-bottom: 4px;">
                                            <span style="color: ${theme.textMuted};">Broker / Firm:</span>
                                            <strong style="color: ${theme.text};">${acc.broker_name || (acc.server.includes('FivePercent') ? 'The5ers' : acc.server)}</strong>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed ${theme.border}; padding-bottom: 4px;">
                                            <span style="color: ${theme.textMuted};">Server Host:</span>
                                            <strong style="color: ${theme.text};">${acc.server}</strong>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed ${theme.border}; padding-bottom: 4px;">
                                            <span style="color: ${theme.textMuted};">MT5 Login ID:</span>
                                            <strong style="color: ${theme.text};">${acc.login}</strong>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed ${theme.border}; padding-bottom: 4px;">
                                            <span style="color: ${theme.textMuted};">Base Currency:</span>
                                            <strong style="color: ${theme.text};">${acc.currency || 'USD'}</strong>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; padding-bottom: 2px;">
                                            <span style="color: ${theme.textMuted};">Lot Multiplier:</span>
                                            <strong style="color: ${theme.text};">${acc.lot_multiplier || 1.0}x</strong>
                                        </div>
                                    </div>

                                    <div style="display: flex; flex-direction: column; gap: 6px;">
                                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed ${theme.border}; padding-bottom: 4px;">
                                            <span style="color: ${theme.textMuted};">Live Status:</span>
                                            <strong style="color: ${isPaused ? '#ffa500' : theme.success};">${isPaused ? '⚪ Standby (Paused)' : '🟢 Online (Synchronized)'}</strong>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed ${theme.border}; padding-bottom: 4px;">
                                            <span style="color: ${theme.textMuted};">Bridge Ping:</span>
                                            <strong style="color: ${theme.text};">${acc.ping_ms || (window.MT5API ? window.MT5API.pingMs : 0)} ms</strong>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed ${theme.border}; padding-bottom: 4px;">
                                            <span style="color: ${theme.textMuted};">Last Traded Date:</span>
                                            <strong style="color: ${theme.text};">${lastTradeFormatted}</strong>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed ${theme.border}; padding-bottom: 4px;">
                                            <span style="color: ${theme.textMuted};">Account Added:</span>
                                            <strong style="color: ${theme.text};">${acc.created_at ? new Date(acc.created_at * 1000).toLocaleDateString() : 'Active'}</strong>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; padding-bottom: 2px;">
                                            <span style="color: ${theme.textMuted};">Risk Sizing:</span>
                                            <strong style="color: ${theme.text};">${acc.risk_percent || 1.0}%</strong>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Supported Asset Categories (Clickable) -->
                            <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 8px; padding: 14px;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                                    <div style="font-weight: 700; font-size: 12.5px; color: ${theme.text};">Supported Ticker Categories (${symbols.length} total)</div>
                                    <div style="font-size: 11px; color: ${theme.textMuted};">Click a category to view tickers</div>
                                </div>
                                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                                    ${categoryList.map(cat => `
                                        <button class="mt5-category-chip" data-cat="${cat}" style="
                                            background: ${theme.isDark ? '#1e222d' : '#ffffff'};
                                            border: 1px solid ${theme.border};
                                            color: ${theme.text};
                                            padding: 6px 12px;
                                            border-radius: 6px;
                                            font-size: 11.5px;
                                            font-weight: 600;
                                            cursor: pointer;
                                            display: inline-flex;
                                            align-items: center;
                                            gap: 6px;
                                            transition: all 0.15s ease;
                                        ">
                                            <span>${cat}</span>
                                            <span style="background: rgba(41,98,255,0.15); color: ${theme.primary}; padding: 1px 6px; border-radius: 10px; font-size: 10px;">${categories[cat]}</span>
                                        </button>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    ` : ''}

                    <!-- Subtab 2: Supported Tickers -->
                    ${this.detailsSubTab === 'tickers' ? `
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <!-- Search & Category Filters -->
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <div style="position: relative;">
                                    <input type="text" id="mt5-ticker-search-in" value="${this.tickerSearchQuery}" placeholder="Search symbol or name (e.g. XAUUSD, EUR, US500, AAPL, BTC)..." style="
                                        width: 100%;
                                        padding: 8px 12px 8px 32px;
                                        background: ${theme.inputBg};
                                        color: ${theme.inputText};
                                        border: 1px solid ${theme.inputBorder};
                                        border-radius: 6px;
                                        font-size: 12.5px;
                                        box-sizing: border-box;
                                    ">
                                    <span style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: ${theme.textMuted}; font-size: 13px;">🔍</span>
                                </div>

                                <!-- Category Pills Filter -->
                                <div style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px;">
                                    <button class="mt5-cat-pill" data-cat="ALL" style="
                                        background: ${this.tickerCategoryFilter === 'ALL' ? theme.primary : 'transparent'};
                                        color: ${this.tickerCategoryFilter === 'ALL' ? '#ffffff' : theme.textMuted};
                                        border: 1px solid ${this.tickerCategoryFilter === 'ALL' ? theme.primary : theme.border};
                                        padding: 4px 10px;
                                        border-radius: 14px;
                                        font-size: 11px;
                                        font-weight: 600;
                                        cursor: pointer;
                                        white-space: nowrap;
                                    ">
                                        ALL (${symbols.length})
                                    </button>
                                    ${categoryList.map(cat => `
                                        <button class="mt5-cat-pill" data-cat="${cat}" style="
                                            background: ${this.tickerCategoryFilter === cat ? theme.primary : 'transparent'};
                                            color: ${this.tickerCategoryFilter === cat ? '#ffffff' : theme.textMuted};
                                            border: 1px solid ${this.tickerCategoryFilter === cat ? theme.primary : theme.border};
                                            padding: 4px 10px;
                                            border-radius: 14px;
                                            font-size: 11px;
                                            font-weight: 600;
                                            cursor: pointer;
                                            white-space: nowrap;
                                        ">
                                            ${cat} (${categories[cat]})
                                        </button>
                                    `).join('')}
                                </div>
                            </div>

                            <!-- Scrollable Symbols Container -->
                            <div id="mt5-ticker-items-container" style="
                                max-height: 400px;
                                overflow-y: auto;
                                padding-right: 4px;
                                display: flex;
                                flex-direction: column;
                            ">
                                ${this.getTickerListHtml(filteredSymbols, theme, acc.server)}
                            </div>
                        </div>
                    ` : ''}

                    <!-- Subtab 3: Active Positions -->
                    ${this.detailsSubTab === 'positions' ? `
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            ${positions.length === 0 ? `
                                <div style="text-align: center; padding: 40px 20px; background: ${theme.cardBg}; border: 1px dashed ${theme.border}; border-radius: 8px;">
                                    <div style="font-size: 26px; margin-bottom: 6px;">💼</div>
                                    <div style="font-weight: 600; font-size: 13.5px; color: ${theme.text};">No Open Positions</div>
                                    <div style="font-size: 11.5px; color: ${theme.textMuted}; margin-top: 4px;">There are no active open trades on this account right now.</div>
                                </div>
                            ` : `
                                <div style="overflow-x: auto; border: 1px solid ${theme.border}; border-radius: 8px;">
                                    <table style="width: 100%; border-collapse: collapse; font-size: 11.5px; text-align: left;">
                                        <thead>
                                            <tr style="background: ${theme.cardBg}; border-bottom: 1px solid ${theme.border}; color: ${theme.textMuted};">
                                                <th style="padding: 8px 10px;">Ticket</th>
                                                <th style="padding: 8px 10px;">Symbol</th>
                                                <th style="padding: 8px 10px;">Type</th>
                                                <th style="padding: 8px 10px;">Lots</th>
                                                <th style="padding: 8px 10px;">Open Price</th>
                                                <th style="padding: 8px 10px;">Current</th>
                                                <th style="padding: 8px 10px;">SL / TP</th>
                                                <th style="padding: 8px 10px; text-align: right;">Profit ($)</th>
                                                <th style="padding: 8px 10px; text-align: center;">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${positions.map(p => {
                                                const isBuy = (p.type === 0 || String(p.type).toUpperCase() === 'BUY');
                                                const typeColor = isBuy ? theme.success : theme.error;
                                                const profit = Number(p.profit || 0);
                                                const profitColor = profit >= 0 ? theme.success : theme.error;
                                                return `
                                                    <tr style="border-bottom: 1px solid ${theme.border};">
                                                        <td style="padding: 8px 10px; font-family: monospace; color: ${theme.textMuted};">#${p.ticket}</td>
                                                        <td style="padding: 8px 10px; font-weight: 700; color: ${theme.text}; font-family: monospace;">${p.symbol}</td>
                                                        <td style="padding: 8px 10px; font-weight: 700; color: ${typeColor};">${isBuy ? 'BUY' : 'SELL'}</td>
                                                        <td style="padding: 8px 10px;">${p.volume}</td>
                                                        <td style="padding: 8px 10px;">${p.price_open}</td>
                                                        <td style="padding: 8px 10px;">${p.price_current}</td>
                                                        <td style="padding: 8px 10px; color: ${theme.textMuted};">${p.sl || '0'} / ${p.tp || '0'}</td>
                                                        <td style="padding: 8px 10px; text-align: right; font-weight: 700; color: ${profitColor};">${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}</td>
                                                        <td style="padding: 8px 10px; text-align: center;">
                                                            <button class="mt5-btn-chart-symbol" data-symbol="${p.symbol}" data-server="${acc.server}" style="
                                                                background: rgba(41,98,255,0.12);
                                                                color: ${theme.primary};
                                                                border: 1px solid rgba(41,98,255,0.3);
                                                                padding: 3px 8px;
                                                                border-radius: 4px;
                                                                font-size: 10.5px;
                                                                cursor: pointer;
                                                            ">📈 Chart</button>
                                                        </td>
                                                    </tr>
                                                `;
                                            }).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            `}
                        </div>
                    ` : ''}

                    <!-- Subtab 4: Order History with Full Sorting & Filtering -->
                    ${this.detailsSubTab === 'history' ? `
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <!-- Mini Performance KPI Cards -->
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px;">
                                <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 8px 10px;">
                                    <div style="font-size: 10px; color: ${theme.textMuted};">Closed Trades</div>
                                    <div style="font-size: 14px; font-weight: 700; color: ${theme.text};">${history.length}</div>
                                </div>
                                <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 8px 10px;">
                                    <div style="font-size: 10px; color: ${theme.textMuted};">Net Profit</div>
                                    <div style="font-size: 14px; font-weight: 700; color: ${netHistoryProfit >= 0 ? theme.success : theme.error};">${netHistoryProfit >= 0 ? '+' : ''}$${netHistoryProfit.toFixed(2)}</div>
                                </div>
                                <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 8px 10px;">
                                    <div style="font-size: 10px; color: ${theme.textMuted};">Win Rate</div>
                                    <div style="font-size: 14px; font-weight: 700; color: ${Number(winRate) >= 50 ? theme.success : theme.text};">${winRate}%</div>
                                </div>
                                <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 8px 10px;">
                                    <div style="font-size: 10px; color: ${theme.textMuted};">Profit Factor</div>
                                    <div style="font-size: 14px; font-weight: 700; color: ${theme.primary};">${profitFactor}</div>
                                </div>
                                <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 8px 10px;">
                                    <div style="font-size: 10px; color: ${theme.textMuted};">Best / Worst</div>
                                    <div style="font-size: 11px; font-weight: 700; color: ${theme.text};">+$${bestWin} / -$${worstLoss}</div>
                                </div>
                            </div>

                            <!-- Filter & Controls Toolbar -->
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                    <div style="position: relative; flex: 1; min-width: 180px;">
                                        <input type="text" id="mt5-history-search-in" value="${this.historySearchQuery}" placeholder="Filter by symbol, ticket, or notes..." style="
                                            width: 100%;
                                            padding: 7px 10px 7px 28px;
                                            background: ${theme.inputBg};
                                            color: ${theme.inputText};
                                            border: 1px solid ${theme.inputBorder};
                                            border-radius: 6px;
                                            font-size: 12px;
                                            box-sizing: border-box;
                                            pointer-events: auto;
                                            user-select: text;
                                        ">
                                        <span style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: ${theme.textMuted}; font-size: 12px;">🔍</span>
                                    </div>
                                    <button id="mt5-btn-export-csv" type="button" style="
                                        background: ${theme.cardBg};
                                        border: 1px solid ${theme.border};
                                        color: ${theme.text};
                                        padding: 6px 12px;
                                        border-radius: 6px;
                                        font-size: 11.5px;
                                        font-weight: 600;
                                        cursor: pointer;
                                        display: inline-flex;
                                        align-items: center;
                                        gap: 4px;
                                        white-space: nowrap;
                                    " title="Export trade history to CSV spreadsheet">
                                        <span>📥</span> Export CSV
                                    </button>
                                </div>

                                <!-- Filter Buttons Row -->
                                <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: space-between;">
                                    <div style="display: flex; gap: 5px; align-items: center; flex-wrap: wrap;">
                                        <span style="font-size: 11px; color: ${theme.textMuted}; margin-right: 2px;">Type:</span>
                                        ${['ALL', 'BUY', 'SELL'].map(t => `
                                            <button class="mt5-hist-type-btn" data-type="${t}" style="
                                                background: ${this.historyTypeFilter === t ? theme.primary : 'transparent'};
                                                color: ${this.historyTypeFilter === t ? '#fff' : theme.textMuted};
                                                border: 1px solid ${this.historyTypeFilter === t ? theme.primary : theme.border};
                                                padding: 2px 8px;
                                                border-radius: 10px;
                                                font-size: 10.5px;
                                                font-weight: 600;
                                                cursor: pointer;
                                            ">${t}</button>
                                        `).join('')}

                                        <span style="font-size: 11px; color: ${theme.textMuted}; margin-left: 6px; margin-right: 2px;">Outcome:</span>
                                        ${[
                                            { id: 'ALL', label: 'All' },
                                            { id: 'WIN', label: 'Wins' },
                                            { id: 'LOSS', label: 'Losses' }
                                        ].map(o => `
                                            <button class="mt5-hist-outcome-btn" data-outcome="${o.id}" style="
                                                background: ${this.historyOutcomeFilter === o.id ? theme.primary : 'transparent'};
                                                color: ${this.historyOutcomeFilter === o.id ? '#fff' : theme.textMuted};
                                                border: 1px solid ${this.historyOutcomeFilter === o.id ? theme.primary : theme.border};
                                                padding: 2px 8px;
                                                border-radius: 10px;
                                                font-size: 10.5px;
                                                font-weight: 600;
                                                cursor: pointer;
                                            ">${o.label}</button>
                                        `).join('')}
                                    </div>

                                    <div style="display: flex; gap: 6px; align-items: center;">
                                        <span style="font-size: 11px; color: ${theme.textMuted};">Period:</span>
                                        <select id="mt5-hist-date-select" style="
                                            background: ${theme.inputBg};
                                            color: ${theme.inputText};
                                            border: 1px solid ${theme.inputBorder};
                                            border-radius: 5px;
                                            padding: 3px 6px;
                                            font-size: 11px;
                                            cursor: pointer;
                                        ">
                                            <option value="ALL" ${this.historyDateFilter === 'ALL' ? 'selected' : ''}>All Time</option>
                                            <option value="TODAY" ${this.historyDateFilter === 'TODAY' ? 'selected' : ''}>Today</option>
                                            <option value="7D" ${this.historyDateFilter === '7D' ? 'selected' : ''}>Last 7 Days</option>
                                            <option value="30D" ${this.historyDateFilter === '30D' ? 'selected' : ''}>Last 30 Days</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <!-- History Table Container -->
                            <div id="mt5-history-items-container">
                                ${this.getHistoryTableHtml(theme, acc.server)}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        bindEvents(modal) {
            const btnClose = modal.querySelector('#mt5-modal-btn-close');

            // View Account Details (from button or clicking nickname)
            modal.querySelectorAll('.mt5-btn-view-details, .mt5-link-details').forEach(el => {
                el.onclick = (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    if (id) this.openAccountDetails(id);
                };
            });

            // Back to Fleet from Details view
            const btnBackFleet = modal.querySelector('#mt5-btn-back-fleet');
            if (btnBackFleet) {
                btnBackFleet.onclick = () => {
                    this.viewMode = 'list';
                    this.renderModal();
                };
            }

            // Retry details fetch
            const btnRetryDetails = modal.querySelector('#mt5-btn-retry-details');
            if (btnRetryDetails) {
                btnRetryDetails.onclick = () => {
                    if (this.detailsAccountId) this.openAccountDetails(this.detailsAccountId, true);
                };
            }

            // Refresh Account Details
            const btnRefreshDetails = modal.querySelector('#mt5-btn-refresh-details');
            if (btnRefreshDetails) {
                btnRefreshDetails.onclick = (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    if (id) this.openAccountDetails(id, true);
                };
            }

            // Subtab navigation in Details view
            modal.querySelectorAll('.mt5-subtab-btn').forEach(b => {
                b.onclick = (e) => {
                    const subtab = e.currentTarget.getAttribute('data-subtab');
                    if (subtab) {
                        this.detailsSubTab = subtab;
                        this.renderModal();
                    }
                };
            });

            // Category Chips (Overview tab) -> jump to Tickers tab with category filter
            modal.querySelectorAll('.mt5-category-chip').forEach(chip => {
                chip.onclick = (e) => {
                    const cat = e.currentTarget.getAttribute('data-cat');
                    this.detailsSubTab = 'tickers';
                    this.tickerCategoryFilter = cat || 'ALL';
                    this.renderModal();
                };
            });

            // Category Pills (Tickers tab) -> filter tickers
            modal.querySelectorAll('.mt5-cat-pill').forEach(pill => {
                pill.onclick = (e) => {
                    const cat = e.currentTarget.getAttribute('data-cat') || 'ALL';
                    this.tickerCategoryFilter = cat;
                    const server = this.detailsData && this.detailsData.account ? this.detailsData.account.server : '';
                    this.updateTickerListView(modal, this.getTheme(), server);
                };
            });

            // Search input (Tickers tab) -> instant live filter with full keyboard isolation
            const searchIn = modal.querySelector('#mt5-ticker-search-in');
            if (searchIn) {
                ['keydown', 'keyup', 'keypress'].forEach(evt => {
                    searchIn.addEventListener(evt, (e) => {
                        e.stopPropagation();
                        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                    }, true);
                });
                searchIn.oninput = (e) => {
                    e.stopPropagation();
                    this.tickerSearchQuery = e.target.value;
                    const server = this.detailsData && this.detailsData.account ? this.detailsData.account.server : '';
                    this.updateTickerListView(modal, this.getTheme(), server);
                };
            }

            // Search input (Order History tab) -> filter with keyboard isolation
            const histSearchIn = modal.querySelector('#mt5-history-search-in');
            if (histSearchIn) {
                ['keydown', 'keyup', 'keypress'].forEach(evt => {
                    histSearchIn.addEventListener(evt, (e) => {
                        e.stopPropagation();
                        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                    }, true);
                });
                histSearchIn.oninput = (e) => {
                    e.stopPropagation();
                    this.historySearchQuery = e.target.value;
                    this.updateHistoryListView(modal, this.getTheme());
                };
            }

            // History Type Filter Buttons (ALL, BUY, SELL)
            modal.querySelectorAll('.mt5-hist-type-btn').forEach(btn => {
                btn.onclick = (e) => {
                    const t = e.currentTarget.getAttribute('data-type');
                    this.historyTypeFilter = t || 'ALL';
                    const theme = this.getTheme();
                    modal.querySelectorAll('.mt5-hist-type-btn').forEach(b => {
                        const active = b.getAttribute('data-type') === this.historyTypeFilter;
                        b.style.background = active ? theme.primary : 'transparent';
                        b.style.color = active ? '#fff' : theme.textMuted;
                        b.style.borderColor = active ? theme.primary : theme.border;
                    });
                    this.updateHistoryListView(modal, theme);
                };
            });

            // History Outcome Filter Buttons (ALL, WIN, LOSS)
            modal.querySelectorAll('.mt5-hist-outcome-btn').forEach(btn => {
                btn.onclick = (e) => {
                    const o = e.currentTarget.getAttribute('data-outcome');
                    this.historyOutcomeFilter = o || 'ALL';
                    const theme = this.getTheme();
                    modal.querySelectorAll('.mt5-hist-outcome-btn').forEach(b => {
                        const active = b.getAttribute('data-outcome') === this.historyOutcomeFilter;
                        b.style.background = active ? theme.primary : 'transparent';
                        b.style.color = active ? '#fff' : theme.textMuted;
                        b.style.borderColor = active ? theme.primary : theme.border;
                    });
                    this.updateHistoryListView(modal, theme);
                };
            });

            // History Date Period Select
            const dateSel = modal.querySelector('#mt5-hist-date-select');
            if (dateSel) {
                dateSel.onchange = (e) => {
                    this.historyDateFilter = e.target.value;
                    this.updateHistoryListView(modal, this.getTheme());
                };
            }

            // Export History to CSV
            const btnCsv = modal.querySelector('#mt5-btn-export-csv');
            if (btnCsv) {
                btnCsv.onclick = () => this.exportHistoryToCsv();
            }

            // Order History Sorting Headers
            modal.querySelectorAll('.mt5-sort-header').forEach(th => {
                th.onclick = (e) => {
                    const field = e.currentTarget.getAttribute('data-sort');
                    if (this.historySortField === field) {
                        this.historySortDir = this.historySortDir === 'desc' ? 'asc' : 'desc';
                    } else {
                        this.historySortField = field;
                        this.historySortDir = 'desc';
                    }
                    this.updateHistoryListView(modal, this.getTheme());
                };
            });

            // Load Symbol on Chart (from tickers or positions)
            modal.querySelectorAll('.mt5-btn-chart-symbol').forEach(btn => {
                btn.onclick = (e) => {
                    const sym = e.currentTarget.getAttribute('data-symbol');
                    const server = e.currentTarget.getAttribute('data-server');
                    this.loadSymbolOnChart(sym, server);
                };
            });
            if (btnClose) btnClose.onclick = () => this.closeModal();

            const tabFleet = modal.querySelector('#mt5-tab-fleet');
            if (tabFleet) tabFleet.onclick = () => {
                this.activeTab = 'fleet';
                this.viewMode = 'list';
                this.renderModal();
            };

            const tabSettings = modal.querySelector('#mt5-tab-settings');
            if (tabSettings) tabSettings.onclick = () => {
                this.activeTab = 'settings';
                this.renderModal();
            };

            const btnAddView = modal.querySelector('#mt5-btn-add-account-view');
            if (btnAddView) btnAddView.onclick = () => {
                this.viewMode = 'add';
                this.renderModal();
            };

            const btnCancelAdd = modal.querySelector('#mt5-btn-cancel-add');
            if (btnCancelAdd) btnCancelAdd.onclick = () => {
                this.viewMode = 'list';
                this.renderModal();
            };

            const btnSaveAcc = modal.querySelector('#mt5-btn-save-acc');
            if (btnSaveAcc) btnSaveAcc.onclick = async () => {
                const nickname = modal.querySelector('#mt5-in-nickname').value.trim();
                const server = modal.querySelector('#mt5-in-server').value.trim();
                const login = parseInt(modal.querySelector('#mt5-in-login').value.trim(), 10);
                const password = modal.querySelector('#mt5-in-password').value;
                const multiplier = parseFloat(modal.querySelector('#mt5-in-mult').value) || 1.0;
                const risk = parseFloat(modal.querySelector('#mt5-in-risk').value) || 1.0;

                if (!nickname || !server || !login || !password) {
                    alert('Please fill in all required fields (Nickname, Server, Login, Password).');
                    return;
                }

                btnSaveAcc.disabled = true;
                btnSaveAcc.innerText = 'Connecting...';
                const res = await window.MT5API.addAccount({
                    nickname, server, login, password,
                    lot_multiplier: multiplier,
                    risk_percent: risk
                });
                if (res.success) {
                    this.viewMode = 'list';
                    this.renderModal();
                } else {
                    btnSaveAcc.disabled = false;
                    btnSaveAcc.innerText = 'Connect & Save Account';
                    alert(`Failed to add account: ${res.error}`);
                }
            };

            // Toggle Pause / Resume account standby mode
            modal.querySelectorAll('.mt5-btn-pause-acc, .mt5-btn-resume-acc').forEach(b => {
                b.onclick = (e) => {
                    if (this.switchingAccountId) return;
                    const id = e.currentTarget.getAttribute('data-id');
                    if (id && window.MT5API) {
                        window.MT5API.toggleAccountPause(id);
                        this.renderModal();
                    }
                };
            });

            // Switch active account with live real-time progress updates
            modal.querySelectorAll('.mt5-btn-set-active').forEach(b => {
                b.onclick = async (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    if (id && window.MT5API && !this.switchingAccountId) {
                        this.switchingAccountId = id;
                        this.switchProgress = {
                            step: 1,
                            title: 'Initiating Switch...',
                            detail: 'Sending switch request to MT5 bridge...',
                            pct: 15
                        };
                        this.updateButtonState();
                        this.renderModal();

                        const onProgress = (step, title, detail, pct) => {
                            this.switchProgress = { step, title, detail, pct };
                            const isDone = (step === 5 || pct === 100);
                            const isErr = (step === 0);

                            // Update in-modal card if modal is open
                            const activeModal = document.getElementById(this.modalId);
                            if (activeModal) {
                                const titleEl = activeModal.querySelector('#mt5-progress-title');
                                const detailEl = activeModal.querySelector('#mt5-progress-detail');
                                const barEl = activeModal.querySelector('#mt5-progress-bar');
                                const pctEl = activeModal.querySelector('#mt5-progress-pct');
                                if (titleEl) titleEl.innerText = title;
                                if (detailEl) detailEl.innerHTML = `<span>${detail}</span>`;
                                if (barEl) barEl.style.width = `${pct}%`;
                                if (pctEl) pctEl.innerText = `${pct}%`;

                                const btnEl = activeModal.querySelector(`.mt5-btn-set-active[data-id="${id}"]`);
                                if (btnEl) {
                                    if (isDone) {
                                        btnEl.innerHTML = `✓ Switched!`;
                                        btnEl.style.background = 'rgba(0, 200, 83, 0.2)';
                                        btnEl.style.color = '#00c853';
                                        btnEl.style.borderColor = 'rgba(0, 200, 83, 0.5)';
                                    } else {
                                        btnEl.innerHTML = `<span class="mt5-pulse-spin" style="display:inline-block; width:10px; height:10px; border:2px solid #2962ff; border-top-color:transparent; border-radius:50%; animation:mt5spin 0.8s linear infinite; margin-right:4px;"></span> Switching... (${pct}%)`;
                                    }
                                }
                            }

                            // Also show floating toast on the chart in real-time
                            this.showFloatingSwitchToast(title, detail, pct, isDone, isErr);
                            this.updateButtonState();
                        };

                        try {
                            await window.MT5API.setActiveAccount(id, onProgress);
                            await new Promise(r => setTimeout(r, 700));
                        } finally {
                            this.switchingAccountId = null;
                            this.switchProgress = null;
                            this.updateButtonState();
                            this.renderModal();
                        }
                    }
                };
            });

            // Delete account
            modal.querySelectorAll('.mt5-btn-delete-acc').forEach(b => {
                b.onclick = async (e) => {
                    if (this.switchingAccountId) return;
                    const id = e.target.getAttribute('data-id');
                    if (id && confirm('Disconnect this MT5 account?')) {
                        await window.MT5API.deleteAccount(id);
                        this.renderModal();
                    }
                };
            });

            // Multi-account copy check toggles
            modal.querySelectorAll('.mt5-check-multi').forEach(c => {
                c.onchange = (e) => {
                    const id = e.target.getAttribute('data-id');
                    if (!window.MT5API) return;
                    if (e.target.checked) {
                        window.MT5API.multiAccountSelection.add(id);
                    } else {
                        window.MT5API.multiAccountSelection.delete(id);
                    }
                    window.MT5API.saveConfig();
                };
            });

            // Save Settings
            const btnSaveSettings = modal.querySelector('#mt5-btn-save-settings');
            if (btnSaveSettings) {
                btnSaveSettings.onclick = () => {
                    const endpoint = modal.querySelector('#mt5-in-endpoint').value;
                    const apiKey = modal.querySelector('#mt5-in-apikey').value;
                    if (window.MT5API) {
                        window.MT5API.setConnection(endpoint, apiKey);
                    }
                    alert('Bridge connection settings saved!');
                    this.renderModal();
                };
            }

            // Test Connection
            const btnTestConn = modal.querySelector('#mt5-btn-test-conn');
            if (btnTestConn) {
                btnTestConn.onclick = async () => {
                    btnTestConn.innerText = 'Pinging...';
                    const res = await window.MT5API.testConnection();
                    if (res.success) {
                        alert(`✓ Bridge Online! Ping latency: ${res.ping}ms`);
                    } else {
                        alert(`✕ Connection Failed: ${res.error}`);
                    }
                    this.renderModal();
                };
            }
        }

        showFloatingSwitchToast(title, detail, pct, isSuccess = false, isError = false) {
            let toast = document.getElementById('mt5-floating-switch-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'mt5-floating-switch-toast';
                toast.style.cssText = `
                    position: fixed;
                    top: 24px;
                    left: 50%;
                    transform: translateX(-50%) translateY(0);
                    background: rgba(15, 23, 42, 0.94);
                    color: #ffffff;
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    border: 1px solid rgba(41, 98, 255, 0.4);
                    border-radius: 10px;
                    padding: 11px 18px;
                    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255,255,255,0.06);
                    z-index: 999999;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    min-width: 320px;
                    max-width: 440px;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    pointer-events: auto;
                    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
                `;
                document.body.appendChild(toast);
            }

            const icon = isSuccess ? '✓' : (isError ? '✕' : '<span style="display:inline-block; width:12px; height:12px; border:2px solid #2962ff; border-top-color:transparent; border-radius:50%; animation:mt5spin 0.8s linear infinite;"></span>');
            const iconBg = isSuccess ? '#00c853' : (isError ? '#f23645' : '#2962ff');

            toast.style.borderColor = isSuccess ? 'rgba(0, 200, 83, 0.5)' : (isError ? 'rgba(242, 54, 69, 0.5)' : 'rgba(41, 98, 255, 0.4)');

            toast.innerHTML = `
                <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:50%; background:${iconBg}; color:#fff; font-size:11px; font-weight:700;">${icon}</span>
                        <strong style="font-size:12.5px; color:#ffffff;">${title}</strong>
                    </div>
                    <span style="font-size:11px; font-weight:700; color:rgba(255,255,255,0.7);">${pct}%</span>
                </div>
                <div style="font-size:11px; color:rgba(255,255,255,0.75); line-height:1.3;">
                    ${detail}
                </div>
                <div style="width:100%; height:3px; background:rgba(255,255,255,0.12); border-radius:2px; overflow:hidden; margin-top:2px;">
                    <div style="width:${pct}%; height:100%; background:${isSuccess ? '#00c853' : (isError ? '#f23645' : 'linear-gradient(90deg, #2962ff, #00b0ff)')}; border-radius:2px; transition:width 0.25s ease;"></div>
                </div>
            `;

            if (isSuccess || isError) {
                if (window._mt5ToastDismissTimeout) clearTimeout(window._mt5ToastDismissTimeout);
                window._mt5ToastDismissTimeout = setTimeout(() => {
                    const t = document.getElementById('mt5-floating-switch-toast');
                    if (t && t.parentNode) {
                        t.style.opacity = '0';
                        t.style.transform = 'translateX(-50%) translateY(-15px)';
                        setTimeout(() => t.remove(), 300);
                    }
                }, 3500);
            }
        }
    }

    // Export singleton
    window.MT5UI = new MT5UI();

})(window);
