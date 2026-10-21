// Fyers Multi-Account Broker & Token Manager UI Integration for TradingView

class FyersUI {
    constructor() {
        this.btnId = 'btn-fyers-broker';
        this.modalId = 'broker-manager-modal';
        this.activeTab = 'accounts'; // 'accounts' | 'engine'
        this.viewMode = 'list'; // 'list' | 'add' | 'replace'
        this.replaceAccountId = null;
        this.cachedIframeDoc = null;
        this._extractorOpen = false;
        this._e2eeReceiver = null;
        this.setupEventListeners();
    }

    getTheme() {
        const isDark = document.documentElement.classList.contains('theme-dark') || 
                       document.body.classList.contains('theme-dark') ||
                       (this.cachedIframeDoc && this.cachedIframeDoc.documentElement.classList.contains('theme-dark'));
        return {
            isDark,
            bg: isDark ? '#1e222d' : '#ffffff',
            cardBg: isDark ? '#131722' : '#f8f9fd',
            cardBorder: isDark ? '#2a2e39' : '#e0e3eb',
            text: isDark ? '#d1d4dc' : '#131722',
            textMuted: isDark ? '#868993' : '#787b86',
            border: isDark ? '#2a2e39' : '#e0e3eb',
            inputBg: isDark ? '#1e222d' : '#ffffff',
            inputText: isDark ? '#d1d4dc' : '#131722',
            inputBorder: isDark ? '#363a45' : '#d1d4dc',
            primary: '#2962FF',
            success: '#089981',
            error: '#f23645',
            warning: '#ff9800'
        };
    }

    injectButton(targetEl, iframeDoc) {
        if (!iframeDoc) return;
        this.cachedIframeDoc = iframeDoc;
        if (iframeDoc.getElementById(this.btnId)) {
            this.updateButtonState();
            return;
        }

        // Determine best placement in header toolbar (after dataset timing or option chain if present)
        const insertAnchor = iframeDoc.getElementById('header-toolbar-dataset-timing') || 
                             iframeDoc.getElementById('header-toolbar-option-chain') || 
                             targetEl;

        const btnHtml = `
        <div class="group-MBOVGQRI" id="header-toolbar-broker-manager" style="margin: 0 4px; display: inline-flex; align-items: center;">
            <button aria-label="Broker Account" data-role="button" tabindex="-1" type="button" 
                class="button-OhqNVIYA button-ptpAHg8E button-GwQQdU8S apply-common-tooltip isInteractive-GwQQdU8S accessible-GwQQdU8S tv-broker-btn" 
                id="${this.btnId}" style="padding: 0 4px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; height: 100%; border: none; background: transparent;">
                <span role="img" class="icon-GwQQdU8S" aria-hidden="true" style="position: relative; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;">
                    <span class="tv-broker-avatar" style="
                        width: 22px; 
                        height: 22px; 
                        border-radius: 50%; 
                        background: #787b86; 
                        color: #ffffff; 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                        font-weight: 700; 
                        font-size: 10.5px; 
                        line-height: 22px; 
                        text-align: center; 
                        display: flex; 
                        align-items: center; 
                        justify-content: center; 
                        user-select: none;
                    ">+</span>
                    <span class="tv-broker-status-dot" style="
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
        
        if (insertAnchor && insertAnchor.parentNode) {
            insertAnchor.insertAdjacentHTML('afterend', btnHtml);
        } else if (targetEl && targetEl.parentNode) {
            targetEl.insertAdjacentHTML('afterend', btnHtml);
        }

        const btn = iframeDoc.getElementById(this.btnId);
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showModal();
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

    getTooltipText() {
        if (!window.FyersAPI) return 'Broker Manager';
        const active = window.FyersAPI.getActiveAccount();
        if (!active) {
            return 'Broker: Disconnected\nClick to configure broker tokens';
        }
        const isApiExp = window.FyersAPI.isAccountExpired(active);
        const isRefExp = window.FyersAPI.isRefreshExpired(active);
        
        let statusStr = 'Active (Connected)';
        if (isApiExp) {
            statusStr = (!isRefExp && active.webuiRefreshToken) ? 'Access Token Expired (Refreshable)' : 'Token Expired';
        } else if (!window.FyersAPI.isConnected) {
            statusStr = 'Active (Offline/Standby)';
        }
        
        const apiExpFormatted = window.FyersAPI.formatExpiry(active.apiExpiresAt);
        const refreshExpFormatted = active.refreshExpiresAt ? window.FyersAPI.formatExpiry(active.refreshExpiresAt) : (active.webuiRefreshToken ? 'Configured' : 'Not provided');
        const webuiExpFormatted = active.webuiExpiresAt ? window.FyersAPI.formatExpiry(active.webuiExpiresAt) : (active.webuiAccessToken ? 'Configured' : 'Not provided');

        const engineCfg = window.FyersAPI.getEngineConfig ? window.FyersAPI.getEngineConfig() : null;
        let engineStatus = 'Not configured';
        if (window.FyersPrivateEngine) {
            engineStatus = `Ready (v${window.FyersPrivateEngine.version || '1.0.0'})`;
        } else if (engineCfg && engineCfg.githubPat) {
            engineStatus = 'PAT Configured (Ready to load)';
        }

        return `Broker: Fyers\nUser: ${active.displayName || 'User'}\nID: ${active.fyId || 'N/A'}\nStatus: ${statusStr}\nAPI Token: ${apiExpFormatted}\nRefresh Token: ${refreshExpFormatted}\nWebUI Token: ${webuiExpFormatted}\nPrivate Engine: ${engineStatus}`;
    }

    updateButtonState() {
        const iframe = document.querySelector('#tv_chart_container iframe') || document.querySelector('iframe[id^="tradingview_"]');
        if (!iframe) return;
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        this.cachedIframeDoc = iframeDoc;
        const btn = iframeDoc.getElementById(this.btnId);
        if (!btn) return;

        const active = window.FyersAPI ? window.FyersAPI.getActiveAccount() : null;

        if (active) {
            const isApiExp = window.FyersAPI.isAccountExpired(active);
            const isRefExp = window.FyersAPI.isRefreshExpired(active);
            
            let dotColor = '#089981'; // Green active
            let avatarBg = 'linear-gradient(135deg, #2962FF, #1546d4)';
            
            if (isApiExp) {
                if (!isRefExp && active.webuiRefreshToken) {
                    dotColor = '#ff9800'; // Amber: access expired but refresh token valid
                    avatarBg = 'linear-gradient(135deg, #e65100, #f57c00)';
                } else {
                    dotColor = '#f23645'; // Red: expired
                    avatarBg = 'linear-gradient(135deg, #787b86, #5d606b)';
                }
            }

            const initials = active.initials || window.FyersAPI.getInitials(active.displayName, active.fyId) || 'FY';
            
            btn.innerHTML = `
            <span role="img" class="icon-GwQQdU8S" aria-hidden="true" style="position: relative; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;">
                <span class="tv-broker-avatar" style="
                    width: 22px; 
                    height: 22px; 
                    border-radius: 50%; 
                    background: ${avatarBg}; 
                    color: #ffffff; 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                    font-weight: 700; 
                    font-size: 10.5px; 
                    line-height: 22px; 
                    text-align: center; 
                    display: flex; 
                    align-items: center; 
                    justify-content: center; 
                    letter-spacing: 0.5px; 
                    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                    user-select: none;
                ">${initials}</span>
                <span class="tv-broker-status-dot" style="
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
        } else {
            // No broker account configured
            btn.innerHTML = `
            <span role="img" class="icon-GwQQdU8S" aria-hidden="true" style="position: relative; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;">
                <span class="tv-broker-avatar" style="
                    width: 22px; 
                    height: 22px; 
                    border-radius: 50%; 
                    background: #787b86; 
                    color: #ffffff; 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                    font-weight: 600; 
                    font-size: 11px; 
                    line-height: 22px; 
                    text-align: center; 
                    display: flex; 
                    align-items: center; 
                    justify-content: center; 
                    user-select: none;
                ">+</span>
                <span class="tv-broker-status-dot" style="
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
            `;
        }
    }

    setupEventListeners() {
        window.addEventListener('fyers_connection_status', () => {
            this.updateButtonState();
            if (document.getElementById(this.modalId)) {
                this.renderModal();
            }
        });

        window.addEventListener('fyers_token_refreshed', () => {
            this.updateButtonState();
            if (document.getElementById(this.modalId)) {
                this.renderModal();
            }
        });

        window.addEventListener('fyers_accounts_migrated', () => {
            this.updateButtonState();
            if (document.getElementById(this.modalId)) {
                this.renderModal();
            }
        });

        // Periodic check every 30 seconds for token expiration
        setInterval(() => {
            this.updateButtonState();
        }, 30000);

        // Auto-validate active token profile on load
        setTimeout(() => {
            if (window.FyersAPI && window.FyersAPI.token && !window.FyersAPI.isAccountExpired(window.FyersAPI.getActiveAccount())) {
                window.FyersAPI.validateAndGetProfile().then(() => {
                    this.updateButtonState();
                }).catch(() => {});
            }
        }, 1500);
    }

    showModal() {
        let modal = document.getElementById(this.modalId);
        if (!modal) {
            modal = document.createElement('div');
            modal.id = this.modalId;
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.65);
                backdrop-filter: blur(3px);
                -webkit-backdrop-filter: blur(3px);
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            `;
            document.body.appendChild(modal);

            // Close on background backdrop click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    if (this._e2eeReceiver && typeof this._e2eeReceiver.stopListening === 'function') {
                        this._e2eeReceiver.stopListening();
                    }
                    this._e2eeReceiver = null;
                    modal.style.display = 'none';
                }
            });
        }

        this.viewMode = 'list';
        this.replaceAccountId = null;
        modal.style.display = 'flex';
        this.renderModal();
    }

    renderModal() {
        const modal = document.getElementById(this.modalId);
        if (!modal) return;
        const theme = this.getTheme();

        const accounts = window.FyersAPI ? window.FyersAPI.getAccounts() : [];
        const activeAccount = window.FyersAPI ? window.FyersAPI.getActiveAccount() : null;

        const engineCfg = window.FyersAPI ? window.FyersAPI.getEngineConfig() : null;
        let engineDotColor = '#787b86';
        if (window.FyersPrivateEngine && typeof window.FyersPrivateEngine.refreshToken === 'function') {
            engineDotColor = '#089981';
        } else if (engineCfg && engineCfg.githubPat) {
            engineDotColor = '#ff9800';
        }

        let contentHtml = '';
        if (this.activeTab === 'accounts') {
            if (this.viewMode === 'list') {
                contentHtml = this.getListViewHtml(theme, accounts, activeAccount);
            } else {
                contentHtml = this.getFormViewHtml(theme, accounts);
            }
        } else {
            contentHtml = this.getEngineViewHtml(theme);
        }

        modal.innerHTML = `
            <div style="
                background: ${theme.bg}; 
                color: ${theme.text}; 
                border: 1px solid ${theme.border};
                border-radius: 12px; 
                width: 640px; 
                max-width: 95vw; 
                max-height: 90vh; 
                display: flex; 
                flex-direction: column; 
                box-shadow: 0 20px 45px rgba(0,0,0,0.35); 
                box-sizing: border-box;
                overflow: hidden;
            ">
                <!-- Header -->
                <div style="
                    display: flex; 
                    align-items: center; 
                    justify-content: space-between; 
                    padding: 16px 20px 12px 20px; 
                    background: ${theme.cardBg};
                ">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="
                            width: 32px; 
                            height: 32px; 
                            border-radius: 8px; 
                            background: ${theme.primary}; 
                            color: #fff; 
                            display: flex; 
                            align-items: center; 
                            justify-content: center; 
                            font-weight: bold; 
                            font-size: 14px;
                        ">FY</span>
                        <div>
                            <h3 style="margin: 0; font-size: 16px; font-weight: 700;">Broker & Token Manager</h3>
                            <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 2px;">
                                Fyers API v3 & Private Closed-Source Authentication
                            </div>
                        </div>
                    </div>
                    <button id="bm-btn-close" style="
                        background: transparent; 
                        border: none; 
                        color: ${theme.textMuted}; 
                        font-size: 20px; 
                        cursor: pointer; 
                        line-height: 1; 
                        padding: 4px 8px; 
                        border-radius: 4px;
                    " title="Close">✕</button>
                </div>

                <!-- Tabs Navigation -->
                <div style="
                    display: flex; 
                    gap: 6px; 
                    padding: 0 20px; 
                    border-bottom: 1px solid ${theme.border}; 
                    background: ${theme.cardBg};
                ">
                    <button id="bm-tab-accounts" type="button" style="
                        background: transparent; 
                        border: none; 
                        border-bottom: 2px solid ${this.activeTab === 'accounts' ? theme.primary : 'transparent'}; 
                        color: ${this.activeTab === 'accounts' ? (theme.isDark ? '#ffffff' : '#131722') : theme.textMuted}; 
                        padding: 10px 14px; 
                        font-size: 13px; 
                        font-weight: 600; 
                        cursor: pointer;
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                        transition: all 0.2s;
                    ">
                        <span>👥</span> Broker Accounts
                        <span style="
                            background: ${this.activeTab === 'accounts' ? theme.primary : (theme.isDark ? '#2a2e39' : '#e0e3eb')};
                            color: ${this.activeTab === 'accounts' ? '#ffffff' : theme.textMuted};
                            font-size: 11px;
                            padding: 1px 6px;
                            border-radius: 10px;
                            font-weight: 700;
                        ">${accounts.length}</span>
                    </button>
                    <button id="bm-tab-engine" type="button" style="
                        background: transparent; 
                        border: none; 
                        border-bottom: 2px solid ${this.activeTab === 'engine' ? theme.primary : 'transparent'}; 
                        color: ${this.activeTab === 'engine' ? (theme.isDark ? '#ffffff' : '#131722') : theme.textMuted}; 
                        padding: 10px 14px; 
                        font-size: 13px; 
                        font-weight: 600; 
                        cursor: pointer;
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                        transition: all 0.2s;
                    ">
                        <span>⚡</span> Auto-Refresh & Engine
                        <span style="
                            width: 7.5px; 
                            height: 7.5px; 
                            border-radius: 50%; 
                            background: ${engineDotColor}; 
                            display: inline-block;
                        "></span>
                    </button>
                </div>

                <!-- Body (Scrollable) -->
                <div style="padding: 20px; overflow-y: auto; flex: 1;">
                    ${contentHtml}
                </div>
            </div>
        `;

        // Wire event handlers
        const btnClose = document.getElementById('bm-btn-close');
        if (btnClose) btnClose.onclick = () => {
            if (this._e2eeReceiver && typeof this._e2eeReceiver.stopListening === 'function') {
                this._e2eeReceiver.stopListening();
            }
            this._e2eeReceiver = null;
            modal.style.display = 'none';
        };

        const tabAccounts = modal.querySelector('#bm-tab-accounts');
        if (tabAccounts) {
            tabAccounts.onclick = (e) => {
                e.preventDefault();
                this.activeTab = 'accounts';
                this.renderModal();
            };
        }

        const tabEngine = modal.querySelector('#bm-tab-engine');
        if (tabEngine) {
            tabEngine.onclick = (e) => {
                e.preventDefault();
                this.activeTab = 'engine';
                this.renderModal();
            };
        }

        if (this.activeTab === 'accounts') {
            if (this.viewMode === 'list') {
                this.bindListViewEvents(modal);
            } else {
                this.bindFormViewEvents(modal);
            }
        } else {
            this.bindEngineViewEvents(modal);
        }
    }

    getListViewHtml(theme, accounts, activeAccount) {
        let cardsHtml = '';

        if (accounts.length === 0) {
            cardsHtml = `
            <div style="
                text-align: center; 
                padding: 40px 20px; 
                border: 2px dashed ${theme.border}; 
                border-radius: 12px; 
                margin-bottom: 16px;
                background: ${theme.isDark ? 'rgba(255,255,255,0.01)' : 'rgba(0,0,0,0.01)'};
            ">
                <div style="font-size: 34px; margin-bottom: 10px;">🔑</div>
                <div style="font-weight: 700; font-size: 15px; margin-bottom: 6px;">No Broker Accounts Added</div>
                <div style="font-size: 13px; color: ${theme.textMuted}; max-width: 440px; margin: 0 auto 20px; line-height: 1.5;">
                    Add your Fyers App ID and API Access Token to stream live quotes, depth, and option chains. WebUI Refresh Token is optional but enables automatic background renewal.
                </div>
                <button id="bm-btn-add-first" class="bm-btn-add-trigger" type="button" style="
                    background: ${theme.primary}; 
                    color: #fff; 
                    border: none; 
                    padding: 9px 18px; 
                    border-radius: 6px; 
                    font-weight: 600; 
                    font-size: 13.5px; 
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    box-shadow: 0 2px 8px rgba(41,98,255,0.25);
                ">+ Add Your First Account</button>
            </div>
            `;
        } else {
            cardsHtml = accounts.map(acc => {
                const isActive = activeAccount && activeAccount.id === acc.id;
                const isApiExp = window.FyersAPI.isAccountExpired(acc);
                const isRefExp = window.FyersAPI.isRefreshExpired(acc);
                
                const initials = acc.initials || window.FyersAPI.getInitials(acc.displayName, acc.fyId) || 'FY';
                
                let dotColor = '#089981';
                let statusBg = 'rgba(8, 153, 129, 0.12)';
                let statusColor = '#089981';

                if (isApiExp) {
                    if (!isRefExp && acc.webuiRefreshToken) {
                        dotColor = '#ff9800';
                        statusBg = 'rgba(255, 152, 0, 0.12)';
                        statusColor = '#ff9800';
                    } else {
                        dotColor = '#f23645';
                        statusBg = 'rgba(242, 54, 69, 0.12)';
                        statusColor = '#f23645';
                    }
                }

                const apiExpStr = window.FyersAPI.formatExpiry(acc.apiExpiresAt);
                const refExpStr = acc.refreshExpiresAt ? window.FyersAPI.formatExpiry(acc.refreshExpiresAt) : null;
                const webuiExpStr = acc.webuiExpiresAt ? window.FyersAPI.formatExpiry(acc.webuiExpiresAt) : null;
                const isWebuiExp = window.FyersAPI.isWebuiExpired ? window.FyersAPI.isWebuiExpired(acc) : false;
                const hasRenewalCreds = Boolean(acc.pin && acc.secretKey);

                return `
                <div style="
                    background: ${theme.cardBg}; 
                    border: 1px solid ${isActive ? 'rgba(41, 98, 255, 0.45)' : theme.cardBorder}; 
                    border-radius: 10px; 
                    padding: 16px; 
                    margin-bottom: 14px; 
                    position: relative;
                    box-shadow: ${isActive ? '0 4px 14px rgba(41, 98, 255, 0.08)' : '0 1px 3px rgba(0,0,0,0.04)'};
                ">
                    <!-- Top Row: Avatar, User Info & Single-Line Unified Action Bar -->
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px;">
                        <!-- Left: Avatar + Details -->
                        <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
                            <!-- Circular Avatar with Status Dot -->
                            <div style="position: relative; width: 36px; height: 36px; flex-shrink: 0;">
                                <div style="
                                    width: 36px; 
                                    height: 36px; 
                                    border-radius: 50%; 
                                    background: linear-gradient(135deg, ${theme.primary}, #1546d4); 
                                    color: #fff; 
                                    font-weight: 700; 
                                    font-size: 13px; 
                                    display: flex; 
                                    align-items: center; 
                                    justify-content: center;
                                    letter-spacing: 0.5px;
                                    box-shadow: 0 2px 5px rgba(41,98,255,0.25);
                                ">${initials}</div>
                                <span style="
                                    position: absolute; 
                                    bottom: -1px; 
                                    right: -1px; 
                                    width: 9px; 
                                    height: 9px; 
                                    border-radius: 50%; 
                                    background: ${dotColor}; 
                                    box-shadow: 0 0 0 2px ${theme.cardBg};
                                "></span>
                            </div>

                            <div style="min-width: 0;">
                                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                    <span style="font-weight: 700; font-size: 15px; color: ${theme.text};">${acc.displayName || 'Fyers User'}</span>
                                    <span style="
                                        font-size: 11px; 
                                        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; 
                                        background: rgba(41,98,255,0.08); 
                                        color: #2962FF; 
                                        padding: 2px 6px; 
                                        border-radius: 4px; 
                                        font-weight: 600;
                                        border: 1px solid rgba(41,98,255,0.2);
                                    ">${acc.fyId || 'N/A'}</span>
                                    ${isActive ? `
                                        <span style="
                                            display: inline-flex; 
                                            align-items: center; 
                                            gap: 4px; 
                                            font-size: 10.5px; 
                                            font-weight: 700; 
                                            padding: 2px 7px; 
                                            border-radius: 10px;
                                            background: rgba(8, 153, 129, 0.12); 
                                            color: #089981;
                                            border: 1px solid rgba(8, 153, 129, 0.25);
                                        ">ACTIVE</span>
                                    ` : ''}
                                </div>
                                <div style="font-size: 11.5px; color: ${theme.textMuted}; margin-top: 3px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                    <span>App ID: <strong style="font-family: ui-monospace, monospace; color: ${theme.text}; font-size: 11px; background: ${theme.isDark ? '#232733' : '#eaedf2'}; padding: 1px 5px; border-radius: 3px; font-weight: 500;">${acc.appId || 'N/A'}</strong></span>
                                    <span style="color: ${theme.border};">•</span>
                                    ${hasRenewalCreds ? `
                                        <span style="font-size: 11px; color: #089981; font-weight: 600; display: inline-flex; align-items: center; gap: 3px;">
                                            <span>🔒</span> Auto-Renew Ready (Encrypted)
                                        </span>
                                    ` : (acc.webuiRefreshToken ? `
                                        <span style="font-size: 11px; color: #ff9800; font-weight: 600; display: inline-flex; align-items: center; gap: 3px;">
                                            <span>⚡</span> Needs PIN & Secret
                                        </span>
                                    ` : `
                                        <span style="font-size: 11px; color: ${theme.textMuted};">Direct API Token</span>
                                    `)}
                                </div>
                            </div>
                        </div>

                        <!-- Right: Action Buttons (Strictly Single-Line, Unified 30px Height) -->
                        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                            ${acc.webuiRefreshToken ? `
                                <button class="bm-btn-refresh-token" data-id="${acc.id}" title="Refresh access token now using private engine" type="button" style="
                                    height: 30px; 
                                    padding: 0 12px; 
                                    background: rgba(41, 98, 255, 0.1); 
                                    color: #2962FF; 
                                    border: 1px solid rgba(41, 98, 255, 0.35); 
                                    border-radius: 6px; 
                                    font-size: 12px; 
                                    font-weight: 600; 
                                    cursor: pointer;
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 5px;
                                    white-space: nowrap;
                                    box-sizing: border-box;
                                ">
                                    <span style="font-size: 12px;">⚡</span> Refresh
                                </button>
                            ` : ''}
                            ${!isActive ? `
                                <button class="bm-btn-activate" data-id="${acc.id}" title="Set as primary active broker account" type="button" style="
                                    height: 30px; 
                                    padding: 0 10px; 
                                    background: transparent; 
                                    color: #2962FF; 
                                    border: 1px solid #2962FF; 
                                    border-radius: 6px; 
                                    font-size: 12px; 
                                    font-weight: 600; 
                                    cursor: pointer;
                                    display: inline-flex;
                                    align-items: center;
                                    white-space: nowrap;
                                    box-sizing: border-box;
                                ">Set Active</button>
                            ` : ''}
                            <button class="bm-btn-replace" data-id="${acc.id}" title="Edit or replace credentials for this account" type="button" style="
                                height: 30px; 
                                padding: 0 11px; 
                                background: ${theme.isDark ? '#262a35' : '#eaedf2'}; 
                                color: ${theme.text}; 
                                border: 1px solid ${theme.isDark ? '#363c4a' : '#d2d6df'}; 
                                border-radius: 6px; 
                                font-size: 12px; 
                                font-weight: 500; 
                                cursor: pointer;
                                display: inline-flex;
                                align-items: center;
                                gap: 5px;
                                white-space: nowrap;
                                box-sizing: border-box;
                            ">
                                <span style="font-size: 12px;">✏️</span> Edit
                            </button>
                            <button class="bm-btn-delete" data-id="${acc.id}" title="Delete Account" type="button" style="
                                width: 30px; 
                                height: 30px; 
                                padding: 0; 
                                background: transparent; 
                                color: #f23645; 
                                border: 1px solid rgba(242, 54, 69, 0.25); 
                                border-radius: 6px; 
                                font-size: 13px; 
                                cursor: pointer;
                                display: inline-flex;
                                align-items: center;
                                justify-content: center;
                                box-sizing: border-box;
                            ">🗑</button>
                        </div>
                    </div>

                    <!-- Token Credentials Panel (Sleek Modern Inset Card) -->
                    <div style="
                        background: ${theme.isDark ? '#141720' : '#ffffff'}; 
                        border: 1px solid ${theme.isDark ? '#242836' : '#e6e9ef'}; 
                        border-radius: 8px; 
                        overflow: hidden;
                        font-size: 12px;
                    ">
                        <!-- API Access Token Row -->
                        <div style="
                            display: flex; 
                            justify-content: space-between; 
                            align-items: center; 
                            padding: 8px 14px; 
                            border-bottom: 1px solid ${theme.isDark ? '#1e222e' : '#f0f2f6'};
                        ">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 13px;">🔑</span>
                                <span style="font-weight: 600; color: ${theme.text};">API Access Token</span>
                            </div>
                            <div>
                                ${acc.apiAccessToken ? `
                                    <span style="
                                        display: inline-flex; 
                                        align-items: center; 
                                        gap: 5px; 
                                        font-size: 11px; 
                                        padding: 3px 8px; 
                                        border-radius: 6px; 
                                        background: ${isApiExp ? 'rgba(242,54,69,0.08)' : 'rgba(8,153,129,0.08)'}; 
                                        color: ${isApiExp ? '#f23645' : '#089981'}; 
                                        font-weight: 500;
                                        border: 1px solid ${isApiExp ? 'rgba(242,54,69,0.22)' : 'rgba(8,153,129,0.22)'};
                                    ">
                                        <span style="width: 6px; height: 6px; border-radius: 50%; background: ${isApiExp ? '#f23645' : '#089981'};"></span>
                                        ${apiExpStr}
                                    </span>
                                ` : `
                                    <span style="font-size: 11px; color: ${theme.textMuted};">— Not configured</span>
                                `}
                            </div>
                        </div>

                        <!-- WebUI Refresh Token Row -->
                        <div style="
                            display: flex; 
                            justify-content: space-between; 
                            align-items: center; 
                            padding: 8px 14px; 
                            border-bottom: 1px solid ${theme.isDark ? '#1e222e' : '#f0f2f6'};
                        ">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 13px;">🔄</span>
                                <span style="font-weight: 600; color: ${theme.text};">WebUI Refresh Token</span>
                            </div>
                            <div>
                                ${acc.webuiRefreshToken ? `
                                    <span style="
                                        display: inline-flex; 
                                        align-items: center; 
                                        gap: 5px; 
                                        font-size: 11px; 
                                        padding: 3px 8px; 
                                        border-radius: 6px; 
                                        background: ${isRefExp ? 'rgba(242,54,69,0.08)' : 'rgba(8,153,129,0.08)'}; 
                                        color: ${isRefExp ? '#f23645' : '#089981'}; 
                                        font-weight: 500;
                                        border: 1px solid ${isRefExp ? 'rgba(242,54,69,0.22)' : 'rgba(8,153,129,0.22)'};
                                    ">
                                        <span style="width: 6px; height: 6px; border-radius: 50%; background: ${isRefExp ? '#f23645' : '#089981'};"></span>
                                        ${refExpStr || 'Configured'}
                                    </span>
                                ` : `
                                    <span style="font-size: 11px; color: ${theme.textMuted};">— Not provided (Manual renewal)</span>
                                `}
                            </div>
                        </div>

                        <!-- WebUI Access Token Row -->
                        <div style="
                            display: flex; 
                            justify-content: space-between; 
                            align-items: center; 
                            padding: 8px 14px;
                        ">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 13px;">🌐</span>
                                <span style="font-weight: 600; color: ${theme.text};">WebUI Access Token</span>
                            </div>
                            <div>
                                ${acc.webuiAccessToken ? `
                                    <span style="
                                        display: inline-flex; 
                                        align-items: center; 
                                        gap: 5px; 
                                        font-size: 11px; 
                                        padding: 3px 8px; 
                                        border-radius: 6px; 
                                        background: ${isWebuiExp ? 'rgba(242,54,69,0.08)' : 'rgba(8,153,129,0.08)'}; 
                                        color: ${isWebuiExp ? '#f23645' : '#089981'}; 
                                        font-weight: 500;
                                        border: 1px solid ${isWebuiExp ? 'rgba(242,54,69,0.22)' : 'rgba(8,153,129,0.22)'};
                                    ">
                                        <span style="width: 6px; height: 6px; border-radius: 50%; background: ${isWebuiExp ? '#f23645' : '#089981'};"></span>
                                        ${webuiExpStr || 'Configured (Active)'}
                                    </span>
                                ` : `
                                    <span style="font-size: 11px; color: ${theme.textMuted};">— Not provided</span>
                                `}
                            </div>
                        </div>
                    </div>
                </div>
                `;
            }).join('');
        }

        return `
            <!-- Top Controls Bar -->
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; gap: 8px; flex-wrap: wrap;">
                <span style="font-size: 13px; color: ${theme.textMuted}; font-weight: 500;">
                    ${accounts.length} Registered Account${accounts.length === 1 ? '' : 's'}
                </span>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <button id="bm-btn-open-extractor-direct" type="button" style="
                        background: rgba(41, 98, 255, 0.08); 
                        color: ${theme.primary}; 
                        border: 1px solid rgba(41, 98, 255, 0.25); 
                        padding: 7px 12px; 
                        border-radius: 6px; 
                        font-size: 12.5px; 
                        font-weight: 600; 
                        cursor: pointer; 
                        display: inline-flex; 
                        align-items: center; 
                        gap: 6px;
                    ">
                        <span>⚡</span> 1-Click Browser Import
                    </button>
                    <button id="bm-btn-add-account" class="bm-btn-add-trigger" type="button" style="
                        background: ${theme.primary}; 
                        color: #fff; 
                        border: none; 
                        padding: 7px 14px; 
                        border-radius: 6px; 
                        font-size: 13px; 
                        font-weight: 600; 
                        cursor: pointer; 
                        display: inline-flex; 
                        align-items: center; 
                        gap: 6px;
                        box-shadow: 0 2px 6px rgba(41,98,255,0.25);
                    ">
                        <span>+</span> Add Broker Account
                    </button>
                </div>
            </div>

            <!-- Accounts List -->
            <div>
                ${cardsHtml}
            </div>

            <!-- Privacy & Write-Only Notice Footer -->
            <div style="
                margin-top: 16px; 
                padding: 11px 14px; 
                background: ${theme.cardBg}; 
                border-radius: 8px; 
                border: 1px solid ${theme.border}; 
                font-size: 11.5px; 
                color: ${theme.textMuted}; 
                display: flex; 
                align-items: flex-start; 
                gap: 9px;
                line-height: 1.45;
            ">
                <span style="font-size: 14px; line-height: 1.2;">🔒</span>
                <div>
                    <strong style="color: ${theme.text};">Hardware-Grade Security:</strong> All tokens and credentials (API Access Token, WebUI Refresh Token, WebUI Access Token, PIN, and Secret Key) are encrypted client-side using <strong>AES-256 GCM</strong> before saving. No plaintext credentials exist in browser storage.
                </div>
            </div>
        `;
    }

    getFormViewHtml(theme, accounts) {
        const isReplace = this.viewMode === 'replace' && Boolean(this.replaceAccountId);
        const existing = isReplace ? accounts.find(a => a.id === this.replaceAccountId) : null;

        const title = isReplace 
            ? `Edit Account: ${existing ? existing.displayName : ''} (${existing ? existing.fyId : ''})` 
            : 'Add New Broker Account';

        const placeholderApi = isReplace 
            ? 'Leave blank to preserve current saved token, or paste new token string...' 
            : 'Paste full API Access Token (JWT string)...';

        const placeholderRefresh = isReplace 
            ? 'Leave blank to preserve current saved token, or paste new token string...' 
            : 'Optional WebUI Refresh Token (JWT string)...';

        const placeholderWebui = isReplace 
            ? 'Leave blank to preserve current saved token, or paste new token string...' 
            : 'Optional WebUI Access Token (JWT string)...';

        return `
            <div style="margin-bottom: 16px;">
                <button id="bm-btn-back" type="button" style="
                    background: transparent; 
                    border: none; 
                    color: ${theme.primary}; 
                    font-size: 13px; 
                    font-weight: 600; 
                    cursor: pointer; 
                    padding: 0; 
                    margin-bottom: 12px;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                ">← Back to Accounts</button>

                <h4 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 700; color: ${theme.text};">${title}</h4>
                <div style="font-size: 12px; color: ${theme.textMuted}; margin-bottom: 16px; line-height: 1.4;">
                    ${isReplace 
                        ? 'Update credentials below. Blank fields are 100% preserved and will not be overwritten or cleared.' 
                        : 'Configure your Fyers App ID and API Access Token. WebUI Refresh Token enables automatic background renewal.'}
                </div>

                <!-- 1-Click Browser Extractor Card -->
                <div style="
                    background: linear-gradient(135deg, rgba(41, 98, 255, 0.08) 0%, rgba(8, 153, 129, 0.08) 100%);
                    border: 1px solid rgba(41, 98, 255, 0.28);
                    border-radius: 8px;
                    padding: 12px 14px;
                    margin-bottom: 16px;
                ">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <div>
                            <div style="font-size: 13px; font-weight: 700; color: ${theme.text}; display: flex; align-items: center; gap: 6px;">
                                <span>⚡</span> Zero-Touch Browser Token Extractor
                                <span style="font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; background: rgba(8,153,129,0.15); color: #089981; border: 1px solid rgba(8,153,129,0.3);">
                                    RSA-2048 + Ephemeral Bridge
                                </span>
                            </div>
                            <div style="font-size: 11.5px; color: ${theme.textMuted}; margin-top: 3px; line-height: 1.35;">
                                Extract & sync tokens from an open <a href="https://trade.fyers.in" target="_blank" style="color: ${theme.primary}; text-decoration: none; font-weight: 600;">trade.fyers.in</a> tab with 0 manual copying.
                            </div>
                        </div>
                        <button id="bm-btn-toggle-extractor" type="button" style="
                            background: ${this._extractorOpen ? 'rgba(41, 98, 255, 0.15)' : theme.primary};
                            color: ${this._extractorOpen ? theme.primary : '#ffffff'};
                            border: 1px solid ${this._extractorOpen ? 'rgba(41, 98, 255, 0.35)' : 'transparent'};
                            padding: 6px 12px;
                            border-radius: 6px;
                            font-size: 12px;
                            font-weight: 600;
                            cursor: pointer;
                            display: inline-flex;
                            align-items: center;
                            gap: 5px;
                        ">
                            <span>${this._extractorOpen ? '▲ Hide Assistant' : '⚡ Open Zero-Touch Assistant'}</span>
                        </button>
                    </div>

                    <!-- Collapsible Extractor Panel -->
                    <div id="bm-extractor-panel" style="display: ${this._extractorOpen ? 'block' : 'none'}; margin-top: 12px; padding-top: 12px; border-top: 1px dashed rgba(41,98,255,0.25);">
                        <div style="display: flex; flex-direction: column; gap: 10px; font-size: 12px;">

                            <!-- Zero-Touch Channel Active Banner -->
                            <div id="bm-zero-touch-banner" style="
                                display: flex;
                                align-items: center;
                                justify-content: space-between;
                                background: ${theme.cardBg};
                                border: 1px solid ${theme.border};
                                border-radius: 6px;
                                padding: 8px 12px;
                                gap: 8px;
                                flex-wrap: wrap;
                            ">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #089981; box-shadow: 0 0 0 3px rgba(8,153,129,0.25);"></span>
                                    <span id="bm-listener-status-text" style="font-size: 11.5px; font-weight: 600; color: ${theme.text};">
                                        Zero-Touch Receiver Ready (RAM Keypair & Ephemeral Channel)
                                    </span>
                                </div>
                                <span style="font-size: 10.5px; color: ${theme.textMuted}; font-family: ui-monospace, monospace;">Self-Destruct on Ingestion</span>
                            </div>

                            <!-- 3 Easy Execution Methods -->
                            <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 12px;">
                                <div style="font-weight: 700; color: ${theme.text}; margin-bottom: 8px; font-size: 12.5px;">
                                    Step 1: Run on <a href="https://trade.fyers.in" target="_blank" style="color:${theme.primary}; text-decoration: underline;">trade.fyers.in</a> (Choose any method below):
                                </div>
                                
                                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-bottom: 10px;">
                                    <!-- Option A: Bookmarklet -->
                                    <div style="border: 1px solid rgba(41,98,255,0.25); background: rgba(41,98,255,0.04); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; justify-content: space-between;">
                                        <div>
                                            <div style="font-weight: 600; color: ${theme.primary}; margin-bottom: 4px; font-size: 12px; display: flex; align-items: center; gap: 4px;">
                                                <span>⭐</span> Option A: Bookmarklet
                                            </div>
                                            <div style="font-size: 11px; color: ${theme.textMuted}; margin-bottom: 8px; line-height: 1.35;">
                                                Drag to bookmarks bar. When viewing Fyers Web, click it once to sync!
                                            </div>
                                        </div>
                                        <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                                            <a id="bm-link-bookmarklet" href="#" draggable="true" title="Drag me to your Bookmarks Bar!" style="
                                                background: ${theme.primary};
                                                color: #fff;
                                                padding: 5px 8px;
                                                border-radius: 4px;
                                                font-size: 11px;
                                                font-weight: 600;
                                                text-decoration: none;
                                                cursor: grab;
                                                display: inline-flex;
                                                align-items: center;
                                                gap: 3px;
                                            ">
                                                <span>⭐</span> Drag: "Sync Tokens"
                                            </a>
                                            <button id="bm-btn-copy-bookmarklet" type="button" style="
                                                background: ${theme.cardBg};
                                                color: ${theme.text};
                                                border: 1px solid ${theme.border};
                                                padding: 5px 7px;
                                                border-radius: 4px;
                                                font-size: 11px;
                                                cursor: pointer;
                                            ">Copy</button>
                                        </div>
                                    </div>

                                    <!-- Option B: Console Snippet -->
                                    <div style="border: 1px solid ${theme.border}; background: rgba(0,0,0,0.02); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; justify-content: space-between;">
                                        <div>
                                            <div style="font-weight: 600; color: ${theme.text}; margin-bottom: 4px; font-size: 12px; display: flex; align-items: center; gap: 4px;">
                                                <span>💻</span> Option B: Console
                                            </div>
                                            <div style="font-size: 11px; color: ${theme.textMuted}; margin-bottom: 8px; line-height: 1.35;">
                                                Open Console (<kbd style="font-size: 10px; padding: 1px 3px; background:${theme.inputBg}; border:1px solid ${theme.border}; border-radius: 2px;">F12</kbd>) on trade.fyers.in, paste & hit Enter.
                                            </div>
                                        </div>
                                        <button id="bm-btn-copy-extractor-script" type="button" style="
                                            background: ${theme.cardBg};
                                            color: ${theme.text};
                                            border: 1px solid ${theme.border};
                                            padding: 5px 8px;
                                            border-radius: 4px;
                                            font-size: 11px;
                                            font-weight: 600;
                                            cursor: pointer;
                                            display: inline-flex;
                                            align-items: center;
                                            justify-content: center;
                                            gap: 4px;
                                            width: 100%;
                                            box-sizing: border-box;
                                        ">
                                            <span>📋</span> Copy Console Script
                                        </button>
                                    </div>

                                    <!-- Option C: Address Bar Quick Runner -->
                                    <div style="border: 1px solid rgba(8,153,129,0.3); background: rgba(8,153,129,0.04); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; justify-content: space-between;">
                                        <div>
                                            <div style="font-weight: 600; color: #089981; margin-bottom: 4px; font-size: 12px; display: flex; align-items: center; gap: 4px;">
                                                <span>🔗</span> Option C: Address Bar
                                            </div>
                                            <div style="font-size: 11px; color: ${theme.textMuted}; margin-bottom: 8px; line-height: 1.35;">
                                                Type <code style="color: #089981; font-weight: 700; background: rgba(8,153,129,0.1); padding: 1px 3px; border-radius: 3px;">j</code> in address bar on trade.fyers.in, paste & hit Enter!
                                            </div>
                                        </div>
                                        <button id="bm-btn-copy-addressbar" type="button" style="
                                            background: ${theme.cardBg};
                                            color: ${theme.text};
                                            border: 1px solid rgba(8,153,129,0.4);
                                            padding: 5px 8px;
                                            border-radius: 4px;
                                            font-size: 11px;
                                            font-weight: 600;
                                            cursor: pointer;
                                            display: inline-flex;
                                            align-items: center;
                                            justify-content: center;
                                            gap: 4px;
                                            width: 100%;
                                            box-sizing: border-box;
                                        ">
                                            <span>🔗</span> Copy Address Bar Script
                                        </button>
                                    </div>
                                </div>

                                <div style="font-size: 11px; color: ${theme.textMuted}; line-height: 1.4;">
                                    ⚡ <strong>Zero-Touch Privacy:</strong> The script silently encrypts your session cookies with ephemeral RSA-2048 + AES-256 and dispatches them directly to this tab. Once received, the temporary bridge is <strong>instantly self-destructed and purged</strong>.
                                </div>
                            </div>

                            <!-- Decryption Status Box -->
                            <div id="bm-extractor-status" style="display: none; padding: 9px 12px; border-radius: 6px; font-size: 11.5px; line-height: 1.4;"></div>

                            <!-- Optional Manual Fallback -->
                            <details style="margin-top: 2px;">
                                <summary style="font-size: 11.5px; font-weight: 600; color: ${theme.primary}; cursor: pointer; user-select: none;">
                                    ▶ Manual Copy/Paste Fallback (Optional)
                                </summary>
                                <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
                                    <div style="font-size: 11px; color: ${theme.textMuted};">
                                        If your browser blocks zero-touch network dispatch, paste the encrypted payload here:
                                    </div>
                                    <textarea id="bm-input-extractor-payload" rows="2" placeholder="Paste encrypted ciphertext blob here..." style="
                                        width: 100%;
                                        padding: 7px 10px;
                                        background: ${theme.inputBg};
                                        color: ${theme.inputText};
                                        border: 1px solid ${theme.inputBorder};
                                        border-radius: 6px;
                                        font-size: 11.5px;
                                        font-family: ui-monospace, monospace;
                                        box-sizing: border-box;
                                        resize: vertical;
                                        outline: none;
                                    "></textarea>
                                    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                                        <button id="bm-btn-decrypt-payload" type="button" style="
                                            background: ${theme.success};
                                            color: #fff;
                                            border: none;
                                            padding: 6px 12px;
                                            border-radius: 5px;
                                            font-size: 11.5px;
                                            font-weight: 600;
                                            cursor: pointer;
                                            display: inline-flex;
                                            align-items: center;
                                            gap: 5px;
                                        ">
                                            <span>📥</span> Decrypt & Auto-Fill
                                        </button>
                                        <button id="bm-btn-paste-clipboard" type="button" style="
                                            background: ${theme.cardBg};
                                            color: ${theme.text};
                                            border: 1px solid ${theme.border};
                                            padding: 6px 11px;
                                            border-radius: 5px;
                                            font-size: 11.5px;
                                            font-weight: 500;
                                            cursor: pointer;
                                            display: inline-flex;
                                            align-items: center;
                                            gap: 5px;
                                        ">
                                            <span>📋</span> Paste from Clipboard
                                        </button>
                                    </div>
                                </div>
                            </details>
                        </div>
                    </div>
                </div>

                <!-- Form Fields -->
                <div style="display: flex; flex-direction: column; gap: 14px;">
                    <!-- App ID -->
                    <div>
                        <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 5px; color: ${theme.text};">
                            App ID <span style="color: ${theme.error};">*</span>
                        </label>
                        <input type="text" id="bm-input-appid" value="${existing ? existing.appId : ''}" placeholder="e.g. XC12345-100" style="
                            width: 100%; 
                            padding: 9px 12px; 
                            background: ${theme.inputBg}; 
                            color: ${theme.inputText}; 
                            border: 1px solid ${theme.inputBorder}; 
                            border-radius: 6px; 
                            font-size: 13px; 
                            box-sizing: border-box;
                            outline: none;
                        ">
                        <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 3px;">
                            Your registered Fyers Client App ID (e.g. XC12345-100).
                        </div>
                    </div>

                    <!-- API Access Token -->
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <label style="font-size: 12px; font-weight: 600; color: ${theme.text};">
                                API Access Token ${!isReplace ? `<span style="color: ${theme.error};">*</span>` : '<span style="font-weight: 400; color:' + theme.textMuted + ';">(leave blank to keep current)</span>'}
                            </label>
                            ${isReplace && existing && existing.apiAccessToken ? `
                                <span style="font-size: 11px; font-weight: 600; color: ${window.FyersAPI.isAccountExpired(existing) ? theme.error : theme.success};">
                                    ${window.FyersAPI.isAccountExpired(existing) ? '🔴 Expired' : '🟢 Stored & Active'} (${window.FyersAPI.formatExpiry(existing.apiExpiresAt)})
                                </span>
                            ` : ''}
                        </div>
                        <textarea id="bm-input-api" rows="2" placeholder="${placeholderApi}" style="
                            width: 100%; 
                            padding: 8px 12px; 
                            background: ${theme.inputBg}; 
                            color: ${theme.inputText}; 
                            border: 1px solid ${theme.inputBorder}; 
                            border-radius: 6px; 
                            font-size: 12px; 
                            font-family: ui-monospace, monospace; 
                            resize: vertical; 
                            box-sizing: border-box;
                            outline: none;
                        "></textarea>
                        <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 3px;">
                            Used for market data streaming, historical bars, and depth feeds.
                        </div>
                    </div>

                    <!-- WebUI Refresh Token -->
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <label style="font-size: 12px; font-weight: 600; color: ${theme.text};">
                                WebUI Refresh Token <span style="font-weight: 400; color: ${theme.textMuted};">${isReplace ? '(leave blank to keep current)' : '(Highly recommended, optional)'}</span>
                            </label>
                            ${isReplace && existing && existing.webuiRefreshToken ? `
                                <span style="font-size: 11px; font-weight: 600; color: ${window.FyersAPI.isRefreshExpired(existing) ? theme.error : theme.success};">
                                    ${window.FyersAPI.isRefreshExpired(existing) ? '🔴 Expired' : '🟢 Stored & Active'} (${window.FyersAPI.formatExpiry(existing.refreshExpiresAt)})
                                </span>
                            ` : (isReplace ? `<span style="font-size: 11px; color: ${theme.textMuted};">Not configured</span>` : '')}
                        </div>
                        <textarea id="bm-input-refresh" rows="2" placeholder="${placeholderRefresh}" style="
                            width: 100%; 
                            padding: 8px 12px; 
                            background: ${theme.inputBg}; 
                            color: ${theme.inputText}; 
                            border: 1px solid ${theme.inputBorder}; 
                            border-radius: 6px; 
                            font-size: 12px; 
                            font-family: ui-monospace, monospace; 
                            resize: vertical; 
                            box-sizing: border-box;
                            outline: none;
                        "></textarea>
                        <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 3px;">
                            Allows generating new access tokens on the fly without logging in again.
                        </div>
                    </div>

                    <!-- WebUI Access Token -->
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <label style="font-size: 12px; font-weight: 600; color: ${theme.text};">
                                WebUI Access Token <span style="font-weight: 400; color: ${theme.textMuted};">(optional)</span>
                            </label>
                            ${isReplace && existing && existing.webuiAccessToken ? `
                                <span style="font-size: 11px; color: ${theme.primary}; font-weight: 600;">🔒 Currently Stored</span>
                            ` : (isReplace ? `<span style="font-size: 11px; color: ${theme.textMuted};">Not configured</span>` : '')}
                        </div>
                        <textarea id="bm-input-webui" rows="2" placeholder="${placeholderWebui}" style="
                            width: 100%; 
                            padding: 8px 12px; 
                            background: ${theme.inputBg}; 
                            color: ${theme.inputText}; 
                            border: 1px solid ${theme.inputBorder}; 
                            border-radius: 6px; 
                            font-size: 12px; 
                            font-family: ui-monospace, monospace; 
                            resize: vertical; 
                            box-sizing: border-box;
                            outline: none;
                        "></textarea>
                        <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 3px;">
                            Stored in standby for upcoming direct web UI integration endpoints.
                        </div>
                    </div>

                    <!-- Auto-Renewal Parameters (Client-Side Encrypted) -->
                    <div style="
                        background: ${theme.cardBg}; 
                        border: 1px solid ${theme.border}; 
                        border-radius: 8px; 
                        padding: 14px 16px; 
                        margin-top: 4px;
                    ">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 8px; flex-wrap: wrap;">
                            <span style="font-size: 12.5px; font-weight: 700; color: ${theme.text}; display: inline-flex; align-items: center; gap: 6px;">
                                <span>⚡</span> Auto-Renewal Parameters
                            </span>
                            <span style="
                                font-size: 10.5px; 
                                padding: 2px 8px; 
                                border-radius: 10px; 
                                font-weight: 600; 
                                background: rgba(8, 153, 129, 0.1); 
                                color: #089981; 
                                border: 1px solid rgba(8, 153, 129, 0.25);
                                display: inline-flex;
                                align-items: center;
                                gap: 4px;
                            ">
                                <span>🔒</span> AES-256 GCM Client-Side Encrypted
                            </span>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px;">
                            <!-- PIN -->
                            <div>
                                <label style="display: block; font-size: 11.5px; font-weight: 600; margin-bottom: 4px; color: ${theme.text};">
                                    Fyers 4-Digit PIN
                                </label>
                                <input type="password" id="bm-input-pin" maxlength="6" placeholder="${isReplace && existing && existing.pin ? '•••• (Saved - leave blank)' : '4-digit login PIN'}" style="
                                    width: 100%; 
                                    padding: 8px 10px; 
                                    background: ${theme.inputBg}; 
                                    color: ${theme.inputText}; 
                                    border: 1px solid ${theme.inputBorder}; 
                                    border-radius: 6px; 
                                    font-size: 12px; 
                                    box-sizing: border-box;
                                    outline: none;
                                ">
                            </div>

                            <!-- Secret Key -->
                            <div>
                                <label style="display: block; font-size: 11.5px; font-weight: 600; margin-bottom: 4px; color: ${theme.text};">
                                    App Secret Key
                                </label>
                                <input type="password" id="bm-input-secret" placeholder="${isReplace && existing && existing.secretKey ? '•••••••• (Saved - leave blank)' : 'API App Secret Key'}" style="
                                    width: 100%; 
                                    padding: 8px 10px; 
                                    background: ${theme.inputBg}; 
                                    color: ${theme.inputText}; 
                                    border: 1px solid ${theme.inputBorder}; 
                                    border-radius: 6px; 
                                    font-size: 12px; 
                                    box-sizing: border-box;
                                    outline: none;
                                ">
                            </div>
                        </div>

                        <!-- Redirect URI -->
                        <div>
                            <label style="display: block; font-size: 11.5px; font-weight: 600; margin-bottom: 4px; color: ${theme.text};">
                                App Redirect URI
                            </label>
                            <input type="text" id="bm-input-redirect" value="${(existing && existing.redirectUri) ? existing.redirectUri : 'https://trade.fyers.in/api-login/redirect-uri/index.html'}" placeholder="e.g. https://trade.fyers.in/api-login/redirect-uri/index.html" style="
                                width: 100%; 
                                padding: 8px 10px; 
                                background: ${theme.inputBg}; 
                                color: ${theme.inputText}; 
                                border: 1px solid ${theme.inputBorder}; 
                                border-radius: 6px; 
                                font-size: 12px; 
                                box-sizing: border-box;
                                outline: none;
                            ">
                        </div>
                        <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 6px; line-height: 1.45;">
                            Encrypted on your machine before saving to browser storage. Used exclusively by your private engine to auto-renew API tokens on expiration.
                        </div>
                    </div>
                </div>

                <!-- Live Token Inspector & Cross-Validation Container -->
                <div id="bm-live-inspector" style="margin-top: 16px;"></div>

                <!-- Error Box -->
                <div id="bm-form-error" style="
                    margin-top: 12px; 
                    padding: 10px 14px; 
                    background: rgba(242,54,69,0.08); 
                    border: 1px solid ${theme.error}; 
                    color: ${theme.error}; 
                    border-radius: 6px; 
                    font-size: 12px; 
                    display: none;
                    line-height: 1.45;
                "></div>

                <!-- Bottom Action Buttons -->
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
                    <button id="bm-btn-cancel-form" type="button" style="
                        background: ${theme.isDark ? '#262a35' : '#eaedf2'}; 
                        color: ${theme.text}; 
                        border: 1px solid ${theme.isDark ? '#363c4a' : '#d2d6df'}; 
                        padding: 8px 16px; 
                        border-radius: 6px; 
                        font-size: 13px; 
                        font-weight: 500; 
                        cursor: pointer;
                        box-sizing: border-box;
                    ">Cancel</button>
                    <button id="bm-btn-save-account" type="button" style="
                        background: ${theme.primary}; 
                        color: #fff; 
                        border: none; 
                        padding: 8px 20px; 
                        border-radius: 6px; 
                        font-size: 13px; 
                        font-weight: 600; 
                        cursor: pointer;
                        box-shadow: 0 2px 6px rgba(41,98,255,0.25);
                        box-sizing: border-box;
                    ">Save & Connect</button>
                </div>
            </div>
        `;
    }

    bindListViewEvents(modal) {
        modal.querySelectorAll('.bm-btn-refresh-token').forEach(btn => {
            btn.onclick = async (e) => {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                const id = btn.getAttribute('data-id');
                if (!id || !window.FyersAPI) return;

                const cfg = window.FyersAPI.getEngineConfig ? window.FyersAPI.getEngineConfig() : null;
                if (!cfg || !cfg.githubPat) {
                    if (window.FyersAPI.showToast) {
                        window.FyersAPI.showToast('Please configure your GitHub PAT in the Auto-Refresh & Engine tab first.', 'warning');
                    }
                    this.activeTab = 'engine';
                    this.renderModal();
                    return;
                }

                btn.innerHTML = '⏳ Refreshing...';
                btn.style.opacity = '0.7';
                btn.disabled = true;

                try {
                    await window.FyersAPI.refreshAccountToken(id, true);
                } finally {
                    this.renderModal();
                }
            };
        });

        modal.querySelectorAll('#bm-btn-add-account, #bm-btn-add-first, .bm-btn-add-trigger').forEach(btnAdd => {
            btnAdd.onclick = (e) => {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                this.viewMode = 'add';
                this.replaceAccountId = null;
                this._extractorOpen = false;
                this.renderModal();
            };
        });

        const btnOpenExtractorDirect = modal.querySelector('#bm-btn-open-extractor-direct');
        if (btnOpenExtractorDirect) {
            btnOpenExtractorDirect.onclick = (e) => {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                this.viewMode = 'add';
                this.replaceAccountId = null;
                this._extractorOpen = true;
                this.renderModal();
            };
        }

        modal.querySelectorAll('.bm-btn-activate').forEach(btn => {
            btn.onclick = (e) => {
                const id = e.target.getAttribute('data-id');
                if (window.FyersAPI && id) {
                    window.FyersAPI.setActiveAccount(id);
                    this.renderModal();
                }
            };
        });

        modal.querySelectorAll('.bm-btn-replace').forEach(btn => {
            btn.onclick = (e) => {
                const id = e.target.getAttribute('data-id');
                if (id) {
                    this.viewMode = 'replace';
                    this.replaceAccountId = id;
                    this.renderModal();
                }
            };
        });

        modal.querySelectorAll('.bm-btn-delete').forEach(btn => {
            btn.onclick = (e) => {
                const id = e.target.getAttribute('data-id');
                if (id && confirm('Are you sure you want to delete this broker account? This action cannot be undone.')) {
                    if (window.FyersAPI) {
                        window.FyersAPI.deleteAccount(id);
                        this.renderModal();
                    }
                }
            };
        });
    }

    bindFormViewEvents(modal) {
        const theme = this.getTheme();
        const btnBack = modal.querySelector('#bm-btn-back');
        const btnCancel = modal.querySelector('#bm-btn-cancel-form');
        const onCancel = (e) => {
            if (e) e.preventDefault();
            if (this._e2eeReceiver && typeof this._e2eeReceiver.stopListening === 'function') {
                this._e2eeReceiver.stopListening();
            }
            this.viewMode = 'list';
            this.replaceAccountId = null;
            this._extractorOpen = false;
            this._e2eeReceiver = null;
            this.renderModal();
        };
        if (btnBack) btnBack.onclick = onCancel;
        if (btnCancel) btnCancel.onclick = onCancel;

        const inputAppId = modal.querySelector('#bm-input-appid');
        const inputApi = modal.querySelector('#bm-input-api');
        const inputRefresh = modal.querySelector('#bm-input-refresh');
        const inputWebui = modal.querySelector('#bm-input-webui');
        const inputPin = modal.querySelector('#bm-input-pin');
        const inputSecret = modal.querySelector('#bm-input-secret');
        const inputRedirect = modal.querySelector('#bm-input-redirect');

        const runValidation = () => this.updateLiveInspector(modal);

        if (inputAppId) inputAppId.addEventListener('input', runValidation);
        if (inputApi) inputApi.addEventListener('input', runValidation);
        if (inputRefresh) inputRefresh.addEventListener('input', runValidation);
        if (inputWebui) inputWebui.addEventListener('input', runValidation);
        if (inputPin) inputPin.addEventListener('input', runValidation);
        if (inputSecret) inputSecret.addEventListener('input', runValidation);
        if (inputRedirect) inputRedirect.addEventListener('input', runValidation);

        // Initial run
        runValidation();

        const statusBox = modal.querySelector('#bm-extractor-status');
        const payloadInput = modal.querySelector('#bm-input-extractor-payload');

        // Helper: apply decrypted credentials to form
        const applyDecryptedResult = (res) => {
            if (!res || !res.success) return;
            if (inputRefresh) inputRefresh.value = res.webuiRefreshToken || '';
            if (inputWebui) inputWebui.value = res.webuiAccessToken || '';
            if (inputAppId && !inputAppId.value.trim() && res.fyersId) {
                inputAppId.value = `${res.fyersId}-100`;
            }
            runValidation();

            const userName = res.displayName ? `${res.displayName} (${res.fyersId})` : (res.fyersId || 'User');
            const refExp = res.refreshExpiresAt ? window.FyersAPI.formatExpiry(res.refreshExpiresAt) : 'Active';

            const statusText = modal.querySelector('#bm-listener-status-text');
            if (statusText) {
                statusText.innerHTML = `✓ <strong>Zero-Touch Sync Complete!</strong> Tokens ingested and channel destroyed.`;
            }

            if (statusBox) {
                statusBox.style.display = 'block';
                statusBox.style.background = 'rgba(8,153,129,0.12)';
                statusBox.style.color = '#089981';
                statusBox.style.border = '1px solid rgba(8,153,129,0.35)';
                statusBox.innerHTML = `
                    <div style="font-weight: 700; margin-bottom: 3px; display: flex; align-items: center; gap: 5px;">
                        <span>✓</span> Zero-Touch Sync Successful!
                    </div>
                    <div>Account: <strong>${userName}</strong> • WebUI Refresh Token valid ${refExp}.</div>
                    <div style="margin-top: 6px; font-size: 11px; color: ${theme.text};">
                        If you entered your PIN & Secret Key below, click <button id="bm-btn-generate-api-now" type="button" style="background: #2962FF; color: #fff; border: none; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer; margin-left: 2px;">⚡ Generate API Token Now</button> or click <strong>Save & Connect</strong>.
                    </div>
                `;

                const btnGenNow = statusBox.querySelector('#bm-btn-generate-api-now');
                if (btnGenNow) {
                    btnGenNow.onclick = async (ev) => {
                        if (ev) ev.preventDefault();
                        const pinVal = inputPin ? inputPin.value.trim() : '';
                        const secretVal = inputSecret ? inputSecret.value.trim() : '';
                        const appVal = inputAppId ? inputAppId.value.trim() : '';
                        if (!pinVal || !secretVal) {
                            alert("Please enter your 4-digit PIN and App Secret Key in the fields below first!");
                            return;
                        }
                        btnGenNow.innerText = 'Generating...';
                        btnGenNow.disabled = true;
                        const genRes = await window.FyersAPI.generateTokensDirect({
                            appId: appVal,
                            webuiRefreshToken: res.webuiRefreshToken,
                            webuiAccessToken: res.webuiAccessToken,
                            pin: pinVal,
                            secretKey: secretVal
                        });
                        if (genRes.success && genRes.apiAccessToken) {
                            if (inputApi) inputApi.value = genRes.apiAccessToken;
                            if (genRes.webuiRefreshToken && inputRefresh) inputRefresh.value = genRes.webuiRefreshToken;
                            if (genRes.webuiAccessToken && inputWebui) inputWebui.value = genRes.webuiAccessToken;
                            runValidation();
                            btnGenNow.innerText = '✓ API Token Generated!';
                            btnGenNow.style.background = '#089981';
                        } else {
                            btnGenNow.innerText = 'Generation Failed';
                            btnGenNow.disabled = false;
                            alert(`Failed to generate API token: ${genRes.error || 'Unknown error'}`);
                        }
                    };
                }
            }

            if (window.FyersAPI && window.FyersAPI.showToast) {
                window.FyersAPI.showToast(`⚡ Zero-touch tokens received for ${userName}! Form updated.`, 'success', 4000);
            }
        };

        // Helper: ensure private receiver session & webhook listener
        const ensureReceiverSession = async () => {
            if (!this._e2eeReceiver) {
                const statusText = modal.querySelector('#bm-listener-status-text');
                if (statusText) statusText.innerText = 'Creating ephemeral RAM keypair & channel...';
                this._e2eeReceiver = await window.FyersAPI.createE2EESession({ enableWebhook: true });
                
                const bookmarkletLink = modal.querySelector('#bm-link-bookmarklet');
                if (bookmarkletLink && typeof this._e2eeReceiver.generateBookmarklet === 'function') {
                    bookmarkletLink.href = this._e2eeReceiver.generateBookmarklet();
                }

                if (statusText) {
                    statusText.innerText = '🟢 Zero-Touch Bridge Active — Waiting for 1-click execution on trade.fyers.in...';
                }

                // Automatically listen
                if (typeof this._e2eeReceiver.startListening === 'function') {
                    this._e2eeReceiver.startListening((res) => {
                        applyDecryptedResult(res);
                    }, (err) => {
                        if (statusText) statusText.innerText = 'Zero-touch bridge idle (use manual paste below).';
                    });
                }
            }
            return this._e2eeReceiver;
        };

        const handleReceiverError = (err) => {
            const statusText = modal.querySelector('#bm-listener-status-text');
            if (statusText) {
                statusText.innerHTML = `⚠️ <strong>Private Broker Engine Required:</strong> ${err.message || err} <button id="bm-btn-force-reload-engine" type="button" style="margin-left: 8px; background: rgba(41,98,255,0.15); color: #2962FF; border: 1px solid rgba(41,98,255,0.3); padding: 2px 7px; border-radius: 4px; font-size: 10.5px; cursor: pointer; font-weight: 600;">🔄 Reload Engine</button>`;
                const btnReload = statusText.querySelector('#bm-btn-force-reload-engine');
                if (btnReload) {
                    btnReload.onclick = async (e) => {
                        if (e) e.preventDefault();
                        btnReload.innerText = '⏳ Reloading...';
                        btnReload.disabled = true;
                        try {
                            await window.FyersAPI.loadPrivateEngine(true);
                            this._e2eeReceiver = null;
                            await ensureReceiverSession();
                        } catch (reErr) {
                            btnReload.innerText = '🔄 Retry';
                            btnReload.disabled = false;
                            alert(`Reload failed: ${reErr.message || reErr}`);
                        }
                    };
                }
            }
        };

        if (this._extractorOpen) {
            ensureReceiverSession().catch((err) => {
                handleReceiverError(err);
            });
        }

        // 1-Click Browser Extractor Events
        const btnToggleExtractor = modal.querySelector('#bm-btn-toggle-extractor');
        const extractorPanel = modal.querySelector('#bm-extractor-panel');
        if (btnToggleExtractor && extractorPanel) {
            btnToggleExtractor.onclick = (e) => {
                if (e) e.preventDefault();
                this._extractorOpen = !this._extractorOpen;
                extractorPanel.style.display = this._extractorOpen ? 'block' : 'none';
                btnToggleExtractor.innerHTML = `<span>${this._extractorOpen ? '▲ Hide Assistant' : '⚡ Open Zero-Touch Assistant'}</span>`;
                btnToggleExtractor.style.background = this._extractorOpen ? 'rgba(41, 98, 255, 0.15)' : theme.primary;
                btnToggleExtractor.style.color = this._extractorOpen ? theme.primary : '#ffffff';
                btnToggleExtractor.style.border = `1px solid ${this._extractorOpen ? 'rgba(41, 98, 255, 0.35)' : 'transparent'}`;
                if (this._extractorOpen) {
                    ensureReceiverSession().catch((err) => {
                        handleReceiverError(err);
                    });
                } else if (this._e2eeReceiver && typeof this._e2eeReceiver.stopListening === 'function') {
                    this._e2eeReceiver.stopListening();
                }
            };
        }

        const btnCopyBookmarklet = modal.querySelector('#bm-btn-copy-bookmarklet');
        if (btnCopyBookmarklet) {
            btnCopyBookmarklet.onclick = async (e) => {
                if (e) e.preventDefault();
                try {
                    const receiver = await ensureReceiverSession();
                    if (receiver && typeof receiver.generateBookmarklet === 'function') {
                        const bmUrl = receiver.generateBookmarklet();
                        await navigator.clipboard.writeText(bmUrl);
                        btnCopyBookmarklet.innerText = '✓ Copied!';
                        setTimeout(() => { btnCopyBookmarklet.innerText = 'Copy'; }, 2500);
                        if (window.FyersAPI && window.FyersAPI.showToast) {
                            window.FyersAPI.showToast('⭐ Bookmarklet URL copied! Paste as a bookmark in your browser.', 'success', 3000);
                        }
                    }
                } catch (err) {
                    handleReceiverError(err);
                }
            };
        }

        const btnCopyScript = modal.querySelector('#bm-btn-copy-extractor-script');
        if (btnCopyScript) {
            btnCopyScript.onclick = async (e) => {
                if (e) e.preventDefault();
                btnCopyScript.innerHTML = '<span>⏳</span> Initializing Bridge...';
                btnCopyScript.disabled = true;
                try {
                    const receiver = await ensureReceiverSession();
                    const script = receiver.generateExtractorScript();
                    await navigator.clipboard.writeText(script);
                    btnCopyScript.innerHTML = '<span>✓</span> Script Copied!';
                    btnCopyScript.style.background = '#089981';
                    if (window.FyersAPI && window.FyersAPI.showToast) {
                        window.FyersAPI.showToast('📋 Extractor script copied! Paste it into Console on trade.fyers.in', 'success', 4000);
                    }
                    setTimeout(() => {
                        if (btnCopyScript) {
                            btnCopyScript.innerHTML = '<span>📋</span> Copy Console Script';
                            btnCopyScript.style.background = theme.cardBg;
                            btnCopyScript.disabled = false;
                        }
                    }, 3500);
                } catch (err) {
                    btnCopyScript.disabled = false;
                    btnCopyScript.innerHTML = '<span>📋</span> Copy Console Script';
                    handleReceiverError(err);
                }
            };
        }

        const btnCopyAddressBar = modal.querySelector('#bm-btn-copy-addressbar');
        if (btnCopyAddressBar) {
            btnCopyAddressBar.onclick = async (e) => {
                if (e) e.preventDefault();
                btnCopyAddressBar.innerHTML = '<span>⏳</span> Initializing...';
                btnCopyAddressBar.disabled = true;
                try {
                    const receiver = await ensureReceiverSession();
                    let script = '';
                    if (receiver && typeof receiver.generateBookmarklet === 'function') {
                        const bm = receiver.generateBookmarklet();
                        // Strip leading 'j' so it becomes 'avascript:...'
                        // Browsers strip 'javascript:' when pasted into the address bar.
                        // By copying 'avascript:...', user types 'j' in address bar first, then pastes, or pastes and types 'j' at the beginning!
                        script = bm.replace(/^javascript:/i, 'avascript:');
                    } else if (receiver && typeof receiver.generateExtractorScript === 'function') {
                        const raw = receiver.generateExtractorScript();
                        const min = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\s+/g, " ").trim();
                        script = 'avascript:' + encodeURIComponent(min);
                    }
                    if (!script) {
                        throw new Error("Could not generate address bar script.");
                    }
                    await navigator.clipboard.writeText(script);
                    btnCopyAddressBar.innerHTML = '<span>✓</span> Copied! Type "j" first';
                    btnCopyAddressBar.style.background = '#089981';
                    btnCopyAddressBar.style.color = '#ffffff';

                    if (window.FyersAPI && window.FyersAPI.showToast) {
                        window.FyersAPI.showToast('🔗 Copied! Go to trade.fyers.in address bar: Type "j" then paste & hit Enter.', 'success', 5000);
                    }

                    setTimeout(() => {
                        if (btnCopyAddressBar) {
                            btnCopyAddressBar.innerHTML = '<span>🔗</span> Copy Address Bar Script';
                            btnCopyAddressBar.style.background = theme.cardBg;
                            btnCopyAddressBar.style.color = theme.text;
                            btnCopyAddressBar.disabled = false;
                        }
                    }, 4000);
                } catch (err) {
                    btnCopyAddressBar.disabled = false;
                    btnCopyAddressBar.innerHTML = '<span>🔗</span> Copy Address Bar Script';
                    handleReceiverError(err);
                }
            };
        }

        const handleDecrypt = async (payloadStr) => {
            const raw = (payloadStr || (payloadInput ? payloadInput.value : '')).trim();
            if (!raw) {
                if (statusBox) {
                    statusBox.style.display = 'block';
                    statusBox.style.background = 'rgba(242,54,69,0.08)';
                    statusBox.style.color = '#f23645';
                    statusBox.style.border = '1px solid rgba(242,54,69,0.25)';
                    statusBox.innerHTML = '⚠️ Please paste the encrypted ciphertext blob first.';
                }
                return;
            }

            if (!this._e2eeReceiver) {
                if (statusBox) {
                    statusBox.style.display = 'block';
                    statusBox.style.background = 'rgba(242,54,69,0.08)';
                    statusBox.style.color = '#f23645';
                    statusBox.style.border = '1px solid rgba(242,54,69,0.25)';
                    statusBox.innerHTML = '⚠️ Session keypair expired or not found. Please click "Copy 1-Click Console Script" to generate a fresh keypair and run on Fyers Web.';
                }
                return;
            }

            try {
                if (statusBox) {
                    statusBox.style.display = 'block';
                    statusBox.style.background = 'rgba(41,98,255,0.08)';
                    statusBox.style.color = '#2962FF';
                    statusBox.style.border = '1px solid rgba(41,98,255,0.25)';
                    statusBox.innerHTML = '⏳ Decrypting session with RSA-2048 private key in RAM...';
                }

                const res = await this._e2eeReceiver.decrypt(raw);
                if (!res || !res.success) {
                    throw new Error("Decryption returned invalid or unverified result.");
                }

                applyDecryptedResult(res);
            } catch (err) {
                if (statusBox) {
                    statusBox.style.display = 'block';
                    statusBox.style.background = 'rgba(242,54,69,0.08)';
                    statusBox.style.color = '#f23645';
                    statusBox.style.border = '1px solid rgba(242,54,69,0.25)';
                    statusBox.innerHTML = `❌ Decryption failed: ${err.message || err}`;
                }
            }
        };

        const btnDecrypt = modal.querySelector('#bm-btn-decrypt-payload');
        if (btnDecrypt) {
            btnDecrypt.onclick = (e) => {
                if (e) e.preventDefault();
                handleDecrypt();
            };
        }

        const btnPasteClipboard = modal.querySelector('#bm-btn-paste-clipboard');
        if (btnPasteClipboard) {
            btnPasteClipboard.onclick = async (e) => {
                if (e) e.preventDefault();
                try {
                    const text = await navigator.clipboard.readText();
                    if (payloadInput) payloadInput.value = text;
                    await handleDecrypt(text);
                } catch (clipErr) {
                    alert(`Clipboard read failed: ${clipErr.message || clipErr}. Please paste manually into the text box.`);
                }
            };
        }

        const btnSave = modal.querySelector('#bm-btn-save-account');
        if (btnSave) {
            btnSave.onclick = async (e) => {
                if (e) e.preventDefault();
                const appId = inputAppId ? inputAppId.value.trim() : '';
                const apiAccessToken = inputApi ? inputApi.value.trim() : '';
                const webuiRefreshToken = inputRefresh ? inputRefresh.value.trim() : '';
                const webuiAccessToken = inputWebui ? inputWebui.value.trim() : '';
                const pin = inputPin ? inputPin.value.trim() : '';
                const secretKey = inputSecret ? inputSecret.value.trim() : '';
                const redirectUri = inputRedirect ? inputRedirect.value.trim() : '';
                const errorBox = modal.querySelector('#bm-form-error');

                // Warning check for replacing non-expired active tokens
                if (this.viewMode === 'replace' && this.replaceAccountId && window.FyersAPI) {
                    const existingAcc = window.FyersAPI.getAccounts().find(a => a.id === this.replaceAccountId);
                    if (existingAcc) {
                        const activeOverwrites = [];
                        if (apiAccessToken && existingAcc.apiAccessToken && !window.FyersAPI.isAccountExpired(existingAcc)) {
                            activeOverwrites.push(`• API Access Token (Valid until ${window.FyersAPI.formatExpiry(existingAcc.apiExpiresAt)})`);
                        }
                        if (webuiRefreshToken && existingAcc.webuiRefreshToken && !window.FyersAPI.isRefreshExpired(existingAcc)) {
                            activeOverwrites.push(`• WebUI Refresh Token (Valid until ${window.FyersAPI.formatExpiry(existingAcc.refreshExpiresAt)})`);
                        }

                        if (activeOverwrites.length > 0) {
                            const confirmed = confirm(
                                `⚠️ Caution: Replacing Active Token(s)\n\nThe following token(s) have NOT expired yet:\n\n${activeOverwrites.join('\n')}\n\nAre you sure you want to replace them? (Fields left blank will safely keep their existing tokens.)`
                            );
                            if (!confirmed) {
                                return;
                            }
                        }
                    }
                }

                btnSave.innerText = 'Verifying & Saving...';
                btnSave.disabled = true;

                try {
                    const res = await window.FyersAPI.saveAccount({
                        appId,
                        apiAccessToken,
                        webuiRefreshToken,
                        webuiAccessToken,
                        pin,
                        secretKey,
                        redirectUri,
                        id: this.replaceAccountId
                    });

                    if (!res || !res.success) {
                        if (errorBox) {
                            errorBox.innerText = (res && res.error) ? res.error : "Failed to save account credentials.";
                            errorBox.style.display = 'block';
                        }
                        btnSave.innerText = 'Save & Connect';
                        btnSave.disabled = false;
                        return;
                    }

                    if (res.noChanges && window.FyersAPI.showToast) {
                        window.FyersAPI.showToast('No changes detected. Existing credentials preserved.', 'info');
                    } else if (window.FyersAPI.showToast) {
                        window.FyersAPI.showToast('Broker credentials encrypted & saved successfully!', 'success');
                    }

                    // Test live profile verification in background
                    try {
                        await window.FyersAPI.validateAndGetProfile();
                    } catch (_) {}

                    this.viewMode = 'list';
                    this.replaceAccountId = null;
                    this.renderModal();
                } catch (err) {
                    console.error("[FyersUI] Save account error:", err);
                    if (errorBox) {
                        errorBox.innerText = `Error saving credentials: ${err.message || err}`;
                        errorBox.style.display = 'block';
                    }
                    btnSave.innerText = 'Save & Connect';
                    btnSave.disabled = false;
                }
            };
        }
    }

    updateLiveInspector(modal) {
        const inspector = modal.querySelector('#bm-live-inspector');
        if (!inspector) return;
        const theme = this.getTheme();

        const inputAppId = modal.querySelector('#bm-input-appid');
        const inputApi = modal.querySelector('#bm-input-api');
        const inputRefresh = modal.querySelector('#bm-input-refresh');
        const inputWebui = modal.querySelector('#bm-input-webui');

        const appId = inputAppId ? inputAppId.value.trim() : '';
        const apiToken = inputApi ? inputApi.value.trim() : '';
        const refreshToken = inputRefresh ? inputRefresh.value.trim() : '';
        const webuiToken = inputWebui ? inputWebui.value.trim() : '';

        const inputPin = modal.querySelector('#bm-input-pin');
        const inputSecret = modal.querySelector('#bm-input-secret');
        const inputRedirect = modal.querySelector('#bm-input-redirect');

        const pin = inputPin ? inputPin.value.trim() : '';
        const secretKey = inputSecret ? inputSecret.value.trim() : '';
        const redirectUri = inputRedirect ? inputRedirect.value.trim() : '';

        const isReplace = this.viewMode === 'replace' && Boolean(this.replaceAccountId);
        const existing = isReplace && window.FyersAPI ? window.FyersAPI.getAccounts().find(a => a.id === this.replaceAccountId) : null;

        // Validation check
        const check = window.FyersAPI.validateTokens({
            appId,
            apiAccessToken: apiToken,
            webuiRefreshToken: refreshToken,
            webuiAccessToken: webuiToken,
            pin,
            secretKey,
            redirectUri,
            isReplace,
            existingAccount: existing
        });

        if (!check.valid) {
            // In replace mode, if user simply hasn't changed anything yet, show friendly standby state!
            if (check.noChanges && isReplace && existing) {
                inspector.innerHTML = `
                    <div style="
                        background: ${theme.isDark ? 'rgba(41,98,255,0.06)' : 'rgba(41,98,255,0.04)'}; 
                        border: 1px solid rgba(41,98,255,0.22); 
                        border-radius: 8px; 
                        padding: 12px 14px; 
                        font-size: 12px; 
                        color: ${theme.text};
                    ">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 14px;">ℹ️</span>
                                <strong style="font-size: 12.5px;">Account Edit Mode (${existing.displayName || existing.fyId})</strong>
                            </div>
                            <span style="font-size: 11px; color: #2962FF; font-weight: 600;">🔒 Safe Write-Only</span>
                        </div>
                        <div style="font-size: 11.5px; color: ${theme.textMuted}; line-height: 1.5;">
                            Leave any field blank to safely preserve its existing credentials. Enter new values only for credentials you wish to update or replace.
                        </div>
                    </div>
                `;
                return;
            }

            inspector.innerHTML = `
                <div style="
                    background: rgba(242,54,69,0.08); 
                    border: 1px solid rgba(242,54,69,0.3); 
                    border-radius: 8px; 
                    padding: 12px 14px; 
                    font-size: 12px; 
                    color: ${theme.error};
                    line-height: 1.45;
                ">
                    <div style="font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                        <span>⚠️</span> <span>Verification Status</span>
                    </div>
                    <div>${check.error}</div>
                </div>
            `;
            return;
        }

        // Check if replacing active non-expired tokens
        const activeWarnings = [];
        if (isReplace && existing) {
            if (apiToken && existing.apiAccessToken && !window.FyersAPI.isAccountExpired(existing)) {
                activeWarnings.push(`Your current API Access Token is STILL VALID until ${window.FyersAPI.formatExpiry(existing.apiExpiresAt)}.`);
            }
            if (refreshToken && existing.webuiRefreshToken && !window.FyersAPI.isRefreshExpired(existing)) {
                activeWarnings.push(`Your current WebUI Refresh Token is STILL VALID until ${window.FyersAPI.formatExpiry(existing.refreshExpiresAt)}.`);
            }
        }

        // Valid tokens found
        const displayName = check.displayName || 'Fyers User';
        const fyId = check.fyId || 'N/A';
        const initials = check.initials || 'FY';
        
        let apiExpStr = 'Kept current';
        if (check.apiExpiresAt) {
            apiExpStr = window.FyersAPI.formatExpiry(check.apiExpiresAt);
        } else if (isReplace && existing && existing.apiExpiresAt) {
            apiExpStr = window.FyersAPI.formatExpiry(existing.apiExpiresAt) + ' (Kept current)';
        }
        
        let refExpStr = null;
        if (check.refreshExpiresAt) {
            refExpStr = window.FyersAPI.formatExpiry(check.refreshExpiresAt);
        } else if (isReplace && existing && existing.refreshExpiresAt) {
            refExpStr = window.FyersAPI.formatExpiry(existing.refreshExpiresAt) + ' (Kept current)';
        }

        let webuiExpStr = null;
        if (check.webuiExpiresAt) {
            webuiExpStr = window.FyersAPI.formatExpiry(check.webuiExpiresAt);
        } else if (isReplace && existing && existing.webuiExpiresAt) {
            webuiExpStr = window.FyersAPI.formatExpiry(existing.webuiExpiresAt) + ' (Kept current)';
        }

        const isCrossVerified = Boolean(refreshToken || (isReplace && existing && existing.webuiRefreshToken));

        const hasPin = Boolean((inputPin && inputPin.value.trim()) || (isReplace && existing && existing.pin));
        const hasSecret = Boolean((inputSecret && inputSecret.value.trim()) || (isReplace && existing && existing.secretKey));
        const autoRenewReady = Boolean(isCrossVerified && hasPin && hasSecret);

        inspector.innerHTML = `
            <div style="
                background: rgba(8,153,129,0.08); 
                border: 1px solid rgba(8,153,129,0.3); 
                border-radius: 8px; 
                padding: 12px 14px; 
                font-size: 12px; 
                color: ${theme.text};
            ">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="
                            width: 26px; 
                            height: 26px; 
                            border-radius: 50%; 
                            background: ${theme.success}; 
                            color: #fff; 
                            display: flex; 
                            align-items: center; 
                            justify-content: center; 
                            font-weight: bold; 
                            font-size: 11px;
                        ">${initials}</span>
                        <div>
                            <strong style="font-size: 13px;">${displayName}</strong>
                            <span style="
                                font-family: ui-monospace, monospace; 
                                font-size: 11px; 
                                background: rgba(8,153,129,0.15); 
                                color: ${theme.success}; 
                                padding: 2px 6px; 
                                border-radius: 4px; 
                                font-weight: 600; 
                                margin-left: 6px;
                            ">ID: ${fyId}</span>
                        </div>
                    </div>
                    <span style="color: ${theme.success}; font-weight: 700; font-size: 12px;">
                        ${isCrossVerified ? '✓ Cross-Verified' : '✓ Verified'}
                    </span>
                </div>
                <div style="font-size: 11.5px; color: ${theme.textMuted}; line-height: 1.55;">
                    • <strong>API Token Expiry:</strong> ${apiExpStr}<br>
                    • <strong>Refresh Token:</strong> ${refExpStr || 'Not provided (Manual renewal)'}<br>
                    • <strong>WebUI Access Token:</strong> ${webuiExpStr || 'Not provided (Standby)'}<br>
                    • <strong>Auto-Renew Engine:</strong> ${autoRenewReady ? `<span style="color: ${theme.success}; font-weight: 600;">✓ Ready (AES-256 Encrypted)</span>` : `<span style="color: ${theme.textMuted};">Enter PIN & Secret Key below for 1-click renewal</span>`}<br>
                    • ${isCrossVerified ? 'All tokens cross-verified to belong to client ID' : 'Verified to belong to client ID'} <code>${fyId}</code>.
                    ${isReplace && !refreshToken && existing && existing.webuiRefreshToken ? '<br>• <em>Existing WebUI Refresh Token will be preserved without changes.</em>' : ''}
                </div>
            </div>

            ${activeWarnings.length > 0 ? `
                <div style="
                    margin-top: 10px; 
                    padding: 10px 12px; 
                    background: rgba(255,152,0,0.1); 
                    border: 1px solid rgba(255,152,0,0.4); 
                    border-radius: 8px; 
                    font-size: 12px; 
                    color: ${theme.warning};
                ">
                    <div style="font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                        <span>⚠️</span> <span>Caution: Replacing Active Token(s)</span>
                    </div>
                    <div style="color: ${theme.text}; font-size: 11.5px; line-height: 1.5;">
                        ${activeWarnings.map(w => `• ${w}`).join('<br>')}
                    </div>
                </div>
            ` : ''}
        `;
    }

    getEngineViewHtml(theme) {
        const cfg = window.FyersAPI ? window.FyersAPI.getEngineConfig() : {
            repo: 'bunqi8/broker-private',
            filePath: 'fyers_auth.js',
            githubPat: '',
            autoRefresh: true,
            leadTimeMinutes: 10
        };

        const isEngineLoaded = Boolean(window.FyersPrivateEngine && typeof window.FyersPrivateEngine.refreshToken === 'function');
        const engineVer = isEngineLoaded ? (window.FyersPrivateEngine.version || '1.0.0') : null;
        const activeAcc = window.FyersAPI ? window.FyersAPI.getActiveAccount() : null;

        const isPatConfigured = Boolean(cfg.githubPat && cfg.githubPat.trim());

        return `
            <div style="display: flex; flex-direction: column; gap: 18px;">
                <!-- Engine Status Banner Card -->
                <div style="
                    background: ${theme.cardBg}; 
                    border: 1px solid ${isEngineLoaded ? 'rgba(8,153,129,0.3)' : (isPatConfigured ? 'rgba(255,152,0,0.3)' : theme.cardBorder)}; 
                    border-radius: 10px; 
                    padding: 16px;
                ">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 10px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="
                                width: 32px; 
                                height: 32px; 
                                border-radius: 8px; 
                                background: ${isEngineLoaded ? theme.success : (isPatConfigured ? theme.warning : '#787b86')}; 
                                color: #fff; 
                                display: flex; 
                                align-items: center; 
                                justify-content: center; 
                                font-weight: bold; 
                                font-size: 16px;
                            ">⚡</span>
                            <div>
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <strong style="font-size: 14px;">Private Refresh Engine</strong>
                                    <span style="
                                        font-size: 11px; 
                                        padding: 2px 8px; 
                                        border-radius: 12px; 
                                        font-weight: 700;
                                        background: ${isEngineLoaded ? 'rgba(8,153,129,0.15)' : (isPatConfigured ? 'rgba(255,152,0,0.15)' : 'rgba(120,123,134,0.15)')};
                                        color: ${isEngineLoaded ? theme.success : (isPatConfigured ? theme.warning : theme.textMuted)};
                                    ">
                                        ${isEngineLoaded ? `🟢 Loaded (v${engineVer})` : (isPatConfigured ? '🟡 Ready to Load' : '⚪ Setup Required')}
                                    </span>
                                </div>
                                <div style="font-size: 11.5px; color: ${theme.textMuted}; margin-top: 2px;">
                                    Keeps your proprietary refresh algorithms 100% private in your own repository.
                                </div>
                            </div>
                        </div>

                        <button id="bm-btn-test-engine" type="button" style="
                            background: ${theme.isDark ? '#2a2e39' : '#e0e3eb'}; 
                            color: ${theme.text}; 
                            border: 1px solid ${theme.border}; 
                            padding: 6px 12px; 
                            border-radius: 6px; 
                            font-size: 12px; 
                            font-weight: 600; 
                            cursor: pointer;
                            display: inline-flex;
                            align-items: center;
                            gap: 5px;
                        ">🔄 Reload Script</button>
                    </div>

                    <!-- Quick Metrics Grid -->
                    <div style="
                        display: grid; 
                        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); 
                        gap: 10px; 
                        padding-top: 10px; 
                        border-top: 1px solid ${theme.border}; 
                        font-size: 11.5px;
                    ">
                        <div>
                            <span style="color: ${theme.textMuted};">Auto-Refresh Scheduler:</span><br>
                            <strong style="color: ${cfg.autoRefresh ? theme.success : theme.textMuted}; font-size: 12px;">
                                ${cfg.autoRefresh ? '✓ Enabled (Every 60s)' : '✕ Disabled'}
                            </strong>
                        </div>
                        <div>
                            <span style="color: ${theme.textMuted};">Active Account:</span><br>
                            <strong style="font-size: 12px; color: ${activeAcc ? theme.text : theme.textMuted};">
                                ${activeAcc ? `${activeAcc.displayName} (${activeAcc.fyId})` : 'None'}
                            </strong>
                        </div>
                        <div>
                            <span style="color: ${theme.textMuted};">Refresh Readiness:</span><br>
                            <strong style="font-size: 12px; color: ${(activeAcc && activeAcc.webuiRefreshToken && !window.FyersAPI.isRefreshExpired(activeAcc)) ? theme.success : theme.warning};">
                                ${(activeAcc && activeAcc.webuiRefreshToken && !window.FyersAPI.isRefreshExpired(activeAcc)) ? '🟢 Refreshable' : (activeAcc ? '⚠️ Missing Refresh Token' : '—')}
                            </strong>
                        </div>
                    </div>
                </div>

                <!-- Engine Settings Form -->
                <div style="display: flex; flex-direction: column; gap: 14px;">
                    <!-- GitHub PAT -->
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <label style="font-size: 12px; font-weight: 600;">
                                GitHub Personal Access Token (PAT) <span style="color: ${theme.error};">*</span>
                            </label>
                            <span style="font-size: 11px; font-weight: 600; color: ${isPatConfigured ? theme.success : theme.warning};">
                                ${isPatConfigured ? '✓ Configured & Stored' : '⚠️ Not Configured'}
                            </span>
                        </div>
                        <div style="position: relative; display: flex; align-items: center;">
                            <input type="password" id="bm-input-engine-pat" placeholder="${isPatConfigured ? 'ghp_•••••••••••••••• (Saved - leave empty to keep)' : 'Paste GitHub PAT (ghp_... or github_pat_...)'}" style="
                                width: 100%; 
                                padding: 9px 38px 9px 12px; 
                                background: ${theme.inputBg}; 
                                color: ${theme.inputText}; 
                                border: 1px solid ${theme.inputBorder}; 
                                border-radius: 6px; 
                                font-size: 13px; 
                                font-family: monospace;
                                box-sizing: border-box;
                            ">
                            <button id="bm-btn-toggle-pat" type="button" title="Show/Hide PAT" style="
                                position: absolute; 
                                right: 8px; 
                                background: transparent; 
                                border: none; 
                                color: ${theme.textMuted}; 
                                cursor: pointer; 
                                font-size: 14px; 
                                padding: 4px;
                            ">👁️</button>
                        </div>
                        <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 4px; line-height: 1.4;">
                            ${isPatConfigured 
                                ? 'Leave blank to preserve current PAT. Enter a new token to replace.' 
                                : 'Create a classic or fine-grained GitHub PAT with <code>repo</code> (read repository contents) scope.'}
                        </div>
                    </div>

                    <!-- Repository & File Path 2-Column Grid -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div>
                            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 5px;">
                                GitHub Repository <span style="color: ${theme.error};">*</span>
                            </label>
                            <input type="text" id="bm-input-engine-repo" value="${cfg.repo || 'bunqi8/broker-private'}" placeholder="e.g. bunqi8/broker-private" style="
                                width: 100%; 
                                padding: 9px 12px; 
                                background: ${theme.inputBg}; 
                                color: ${theme.inputText}; 
                                border: 1px solid ${theme.inputBorder}; 
                                border-radius: 6px; 
                                font-size: 13px; 
                                box-sizing: border-box;
                            ">
                            <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 3px;">
                                Private repo owner/name.
                            </div>
                        </div>

                        <div>
                            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 5px;">
                                Script File Path <span style="color: ${theme.error};">*</span>
                            </label>
                            <input type="text" id="bm-input-engine-file" value="${cfg.filePath || 'fyers_auth.js'}" placeholder="e.g. fyers_auth.js" style="
                                width: 100%; 
                                padding: 9px 12px; 
                                background: ${theme.inputBg}; 
                                color: ${theme.inputText}; 
                                border: 1px solid ${theme.inputBorder}; 
                                border-radius: 6px; 
                                font-size: 13px; 
                                box-sizing: border-box;
                            ">
                            <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 3px;">
                                Default for Fyers: <code>fyers_auth.js</code>.
                            </div>
                        </div>
                    </div>

                    <!-- Auto-Refresh Toggle -->
                    <div style="
                        background: ${theme.cardBg}; 
                        border: 1px solid ${theme.border}; 
                        border-radius: 8px; 
                        padding: 12px 14px; 
                        display: flex; 
                        align-items: center; 
                        justify-content: space-between; 
                        gap: 12px;
                    ">
                        <div>
                            <div style="font-size: 13px; font-weight: 600; color: ${theme.text};">
                                Automatic Background Token Renewal
                            </div>
                            <div style="font-size: 11.5px; color: ${theme.textMuted}; margin-top: 2px;">
                                Periodically checks token expiration and seamlessly requests fresh token ~10 minutes before expiry.
                            </div>
                        </div>
                        <label style="position: relative; display: inline-flex; align-items: center; cursor: pointer;">
                            <input type="checkbox" id="bm-check-auto-refresh" ${cfg.autoRefresh !== false ? 'checked' : ''} style="
                                width: 18px; 
                                height: 18px; 
                                accent-color: ${theme.primary}; 
                                cursor: pointer;
                            ">
                        </label>
                    </div>
                </div>

                <!-- Action Buttons & Status Notification Container -->
                <div>
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 4px;">
                        <button id="bm-btn-manual-refresh" type="button" style="
                            background: rgba(41, 98, 255, 0.1); 
                            color: ${theme.primary}; 
                            border: 1px solid rgba(41, 98, 255, 0.35); 
                            padding: 9px 14px; 
                            border-radius: 6px; 
                            font-size: 13px; 
                            font-weight: 600; 
                            cursor: pointer;
                            display: inline-flex;
                            align-items: center;
                            gap: 6px;
                        ">⚡ Refresh Active Token Now</button>

                        <button id="bm-btn-save-engine" type="button" style="
                            background: ${theme.primary}; 
                            color: #ffffff; 
                            border: none; 
                            padding: 9px 18px; 
                            border-radius: 6px; 
                            font-size: 13px; 
                            font-weight: 600; 
                            cursor: pointer;
                        ">💾 Save Engine Settings</button>
                    </div>

                    <div id="bm-engine-status-msg" style="margin-top: 12px; display: none;"></div>
                </div>

                <!-- Collapsible Private Script Implementation Guide -->
                <details style="
                    background: ${theme.cardBg}; 
                    border: 1px solid ${theme.border}; 
                    border-radius: 8px; 
                    padding: 12px 14px; 
                    font-size: 12px;
                ">
                    <summary style="font-weight: 600; cursor: pointer; color: ${theme.text}; user-select: none;">
                        📖 Private Engine Script Contract (<code>fyers_auth.js</code> Template)
                    </summary>
                    <div style="margin-top: 10px; color: ${theme.textMuted}; line-height: 1.5;">
                        Save this file in your private repository <code>${cfg.repo || 'bunqi8/broker-private'}</code> at <code>${cfg.filePath || 'fyers_auth.js'}</code>:
                    </div>
                    <pre style="
                        margin-top: 8px; 
                        padding: 12px; 
                        background: ${theme.bg}; 
                        border: 1px solid ${theme.border}; 
                        border-radius: 6px; 
                        overflow-x: auto; 
                        font-family: monospace; 
                        font-size: 11px; 
                        color: ${theme.text};
                    "><code>// ${cfg.filePath || 'fyers_auth.js'} - Closed Source Engine
window.FyersPrivateEngine = {
    version: "1.0.0",
    broker: "fyers",

    /**
     * Called automatically by TradingView frontend.
     * @param {Object} params
     * @param {string} params.appId - Fyers App ID (e.g. XC12345-100)
     * @param {string} params.webuiRefreshToken - WebUI Refresh JWT token
     * @param {string} params.apiAccessToken - Existing API Access Token
     * @param {string} params.webuiAccessToken - Existing WebUI Access Token
     * @returns {Promise<{success: boolean, apiAccessToken?: string, webuiRefreshToken?: string, error?: string}>}
     */
    async refreshToken({ appId, webuiRefreshToken, apiAccessToken, webuiAccessToken }) {
        try {
            // Your proprietary refresh endpoint logic here:
            // e.g. const res = await fetch("https://api-t1.fyers.in/api/v3/validate-refresh-token", ...);
            
            return {
                success: true,
                apiAccessToken: "eyJhbGciOi...", // New API JWT
                webuiRefreshToken: webuiRefreshToken // New refresh token if rotated
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
};</code></pre>
                </details>
            </div>
        `;
    }

    bindEngineViewEvents(modal) {
        const inputPat = modal.querySelector('#bm-input-engine-pat');
        const inputRepo = modal.querySelector('#bm-input-engine-repo');
        const inputFile = modal.querySelector('#bm-input-engine-file');
        const checkAuto = modal.querySelector('#bm-check-auto-refresh');
        const btnTogglePat = modal.querySelector('#bm-btn-toggle-pat');
        const btnSave = modal.querySelector('#bm-btn-save-engine');
        const btnTest = modal.querySelector('#bm-btn-test-engine');
        const btnManual = modal.querySelector('#bm-btn-manual-refresh');
        const statusBox = modal.querySelector('#bm-engine-status-msg');

        if (btnTogglePat && inputPat) {
            btnTogglePat.onclick = () => {
                inputPat.type = inputPat.type === 'password' ? 'text' : 'password';
            };
        }

        const showStatus = (text, isSuccess) => {
            if (!statusBox) return;
            const theme = this.getTheme();
            statusBox.style.display = 'block';
            statusBox.style.padding = '10px 14px';
            statusBox.style.borderRadius = '6px';
            statusBox.style.fontSize = '12px';
            statusBox.style.lineHeight = '1.4';
            if (isSuccess) {
                statusBox.style.background = 'rgba(8,153,129,0.1)';
                statusBox.style.border = `1px solid ${theme.success}`;
                statusBox.style.color = theme.success;
                statusBox.innerHTML = `<strong>✓ Success:</strong> ${text}`;
            } else {
                statusBox.style.background = 'rgba(242,54,69,0.1)';
                statusBox.style.border = `1px solid ${theme.error}`;
                statusBox.style.color = theme.error;
                statusBox.innerHTML = `<strong>⚠️ Error:</strong> ${text}`;
            }
        };

        if (btnSave) {
            btnSave.onclick = (e) => {
                if (e) e.preventDefault();
                const githubPat = inputPat ? inputPat.value.trim() : '';
                const repo = inputRepo ? inputRepo.value.trim() : '';
                const filePath = inputFile ? inputFile.value.trim() : '';
                const autoRefresh = checkAuto ? checkAuto.checked : true;

                if (!repo) {
                    showStatus('Repository name cannot be empty (e.g. bunqi8/broker-private).', false);
                    return;
                }
                if (!filePath) {
                    showStatus('Script file path cannot be empty (e.g. fyers_auth.js).', false);
                    return;
                }

                if (window.FyersAPI) {
                    window.FyersAPI.saveEngineConfig({
                        githubPat,
                        repo,
                        filePath,
                        autoRefresh
                    });
                    if (window.FyersAPI.showToast) {
                        window.FyersAPI.showToast('Private engine settings saved!', 'success');
                    }
                }

                this.renderModal();
            };
        }

        if (btnTest) {
            btnTest.onclick = async (e) => {
                if (e) e.preventDefault();
                if (!window.FyersAPI) return;

                const githubPat = inputPat ? inputPat.value.trim() : '';
                const repo = inputRepo ? inputRepo.value.trim() : '';
                const filePath = inputFile ? inputFile.value.trim() : '';
                const autoRefresh = checkAuto ? checkAuto.checked : true;

                window.FyersAPI.saveEngineConfig({
                    githubPat,
                    repo,
                    filePath,
                    autoRefresh
                });

                btnTest.innerHTML = '⏳ Fetching...';
                btnTest.disabled = true;

                try {
                    const res = await window.FyersAPI.loadPrivateEngine(true);
                    if (res.success) {
                        showStatus(`Private engine connected and loaded successfully! Exposes version <strong>${res.version || '1.0.0'}</strong>.`, true);
                    } else {
                        showStatus(res.error, false);
                    }
                } finally {
                    btnTest.innerHTML = '🔄 Reload Script';
                    btnTest.disabled = false;
                }
            };
        }

        if (btnManual) {
            btnManual.onclick = async (e) => {
                if (e) e.preventDefault();
                if (!window.FyersAPI) return;

                const active = window.FyersAPI.getActiveAccount();
                if (!active) {
                    showStatus('No active broker account configured. Add an account first.', false);
                    return;
                }
                if (!active.webuiRefreshToken) {
                    showStatus(`Active account "${active.displayName}" does not have a WebUI Refresh Token configured. Add a refresh token in the Accounts tab to enable renewal.`, false);
                    return;
                }

                btnManual.innerHTML = '⏳ Refreshing...';
                btnManual.disabled = true;

                try {
                    const res = await window.FyersAPI.refreshAccountToken(active.id, true);
                    if (res.success) {
                        showStatus(`Active token refreshed successfully! Valid until ${window.FyersAPI.formatExpiry(res.account.apiExpiresAt)}.`, true);
                    } else {
                        showStatus(res.error, false);
                    }
                } finally {
                    btnManual.innerHTML = '⚡ Refresh Active Token Now';
                    btnManual.disabled = false;
                }
            };
        }
    }
}

window.FyersUI = new FyersUI();
