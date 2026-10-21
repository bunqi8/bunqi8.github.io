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
            this.viewMode = 'list'; // 'list' or 'add'
            this.cachedIframeDoc = null;
            this.init();
        }

        init() {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.mount());
            } else {
                this.mount();
            }

            // Listen to account updates from MT5API
            if (window.MT5API) {
                window.MT5API.onAccountUpdate(() => this.updateButtonState());
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

            if (mt5Wrapper && fyersWrapper && fyersWrapper.parentNode) {
                if (fyersWrapper.nextElementSibling !== mt5Wrapper) {
                    fyersWrapper.parentNode.insertBefore(mt5Wrapper, fyersWrapper.nextSibling);
                }
            } else if (mt5Wrapper && symbolSearch && symbolSearch.parentNode) {
                if (symbolSearch.previousElementSibling !== mt5Wrapper) {
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

            if (acc) {
                dotColor = isConn ? '#089981' : '#ff9800';
                avatarBg = isConn ? 'linear-gradient(135deg, #089981, #00796b)' : 'linear-gradient(135deg, #ff9800, #e65100)';
                label = (acc.nickname || 'MT').slice(0, 2).toUpperCase();
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

            const tooltipText = this.getTooltipText();
            btn.setAttribute('title', tooltipText);
        }

        openModal() {
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
                    width: 660px;
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

            const cards = accounts.map(acc => {
                const isActive = activeAcc && activeAcc.id === acc.id;
                const isChecked = window.MT5API && window.MT5API.multiAccountSelection.has(acc.id);
                return `
                    <div style="
                        background: ${theme.cardBg};
                        border: 1px solid ${isActive ? 'rgba(41,98,255,0.6)' : theme.border};
                        border-radius: 8px;
                        padding: 14px;
                        margin-bottom: 10px;
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                    ">
                        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" class="mt5-check-multi" data-id="${acc.id}" ${isChecked ? 'checked' : ''} title="Select for Multi-Account Simultaneous Copying" style="cursor: pointer; width: 16px; height: 16px; accent-color: ${theme.primary};">
                                <div>
                                    <div style="font-weight: 700; font-size: 13.5px; color: ${theme.text}; display: flex; align-items: center; gap: 6px;">
                                        <span>${acc.nickname}</span>
                                        ${isActive ? `<span style="font-size: 9.5px; padding: 1px 6px; border-radius: 10px; background: ${theme.primary}; color: #fff; font-weight: 700;">ACTIVE FEED</span>` : ''}
                                    </div>
                                    <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 2px;">
                                        Login: <strong>${acc.login}</strong> • Server: <strong>${acc.server}</strong>
                                    </div>
                                </div>
                            </div>
                            <div style="display: flex; gap: 6px;">
                                ${!isActive ? `<button class="mt5-btn-set-active" data-id="${acc.id}" style="background: rgba(41,98,255,0.1); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.3); padding: 4px 9px; border-radius: 5px; font-size: 11px; font-weight: 600; cursor: pointer;">Show Chart Feed</button>` : ''}
                                <button class="mt5-btn-delete-acc" data-id="${acc.id}" style="background: transparent; color: ${theme.error}; border: 1px solid rgba(242,54,69,0.3); padding: 4px 8px; border-radius: 5px; font-size: 11px; cursor: pointer;">✕</button>
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
                                <strong style="color: ${acc.is_connected ? theme.success : theme.warning}; font-size: 12px;">
                                    ${acc.is_connected ? '🟢 Online' : '⚪ Standby'}
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
            const endpoint = window.MT5API ? window.MT5API.endpoint : 'http://localhost:8000';
            const apiKey = window.MT5API ? window.MT5API.apiKey : 'mt5_secret_key_2026';
            const isConn = window.MT5API ? window.MT5API.isConnected : false;
            const ping = window.MT5API ? window.MT5API.pingMs : 0;

            return `
                <div style="display: flex; flex-direction: column; gap: 14px;">
                    <!-- Status Card -->
                    <div style="background: ${theme.cardBg}; border: 1px solid ${isConn ? 'rgba(8,153,129,0.3)' : theme.border}; border-radius: 8px; padding: 14px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <span style="width: 32px; height: 32px; border-radius: 8px; background: ${isConn ? theme.success : theme.warning}; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px;">⚡</span>
                                <div>
                                    <strong style="font-size: 13.5px; color: ${theme.text};">MT5 Cloud Bridge Connection</strong>
                                    <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 2px;">
                                        ${isConn ? `🟢 Connected (Ping: ${ping}ms)` : '⚠️ Not Connected — verify Bridge URL and API Key below'}
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

        bindEvents(modal) {
            const btnClose = modal.querySelector('#mt5-modal-btn-close');
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

            // Switch active account
            modal.querySelectorAll('.mt5-btn-set-active').forEach(b => {
                b.onclick = async (e) => {
                    const id = e.target.getAttribute('data-id');
                    if (id && window.MT5API) {
                        await window.MT5API.setActiveAccount(id);
                        this.renderModal();
                    }
                };
            });

            // Delete account
            modal.querySelectorAll('.mt5-btn-delete-acc').forEach(b => {
                b.onclick = async (e) => {
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
    }

    // Export singleton
    window.MT5UI = new MT5UI();

})(window);
