// Fyers Multi-Account Broker & Token Manager UI Integration for TradingView

class FyersUI {
    constructor() {
        this.btnId = 'btn-fyers-broker';
        this.modalId = 'broker-manager-modal';
        this.activeTab = 'accounts'; // 'accounts' | 'engine'
        this.viewMode = 'list'; // 'list' | 'add' | 'replace'
        this.replaceAccountId = null;
        this.cachedIframeDoc = null;
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

        const engineCfg = window.FyersAPI.getEngineConfig ? window.FyersAPI.getEngineConfig() : null;
        let engineStatus = 'Not configured';
        if (window.FyersPrivateEngine) {
            engineStatus = `Ready (v${window.FyersPrivateEngine.version || '1.0.0'})`;
        } else if (engineCfg && engineCfg.githubPat) {
            engineStatus = 'PAT Configured (Ready to load)';
        }

        return `Broker: Fyers\nUser: ${active.displayName || 'User'}\nID: ${active.fyId || 'N/A'}\nStatus: ${statusStr}\nAPI Token: ${apiExpFormatted}\nRefresh Token: ${refreshExpFormatted}\nPrivate Engine: ${engineStatus}`;
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
        if (btnClose) btnClose.onclick = () => modal.style.display = 'none';

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
                padding: 36px 16px; 
                border: 2px dashed ${theme.border}; 
                border-radius: 10px; 
                margin-bottom: 16px;
            ">
                <div style="font-size: 32px; margin-bottom: 8px;">🔑</div>
                <div style="font-weight: 600; font-size: 15px; margin-bottom: 6px;">No Broker Accounts Added</div>
                <div style="font-size: 13px; color: ${theme.textMuted}; max-width: 420px; margin: 0 auto 18px; line-height: 1.4;">
                    Add your Fyers App ID and API Access Token to view live option chains and stream market data. WebUI Refresh Token is optional but highly recommended.
                </div>
                <button id="bm-btn-add-first" class="bm-btn-add-trigger" type="button" style="
                    background: ${theme.primary}; 
                    color: #fff; 
                    border: none; 
                    padding: 10px 20px; 
                    border-radius: 6px; 
                    font-weight: 600; 
                    font-size: 14px; 
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    box-shadow: 0 2px 6px rgba(41,98,255,0.3);
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

                return `
                <div style="
                    background: ${theme.cardBg}; 
                    border: 1px solid ${isActive ? theme.primary : theme.cardBorder}; 
                    border-radius: 10px; 
                    padding: 16px; 
                    margin-bottom: 14px; 
                    position: relative;
                    box-shadow: ${isActive ? '0 0 0 1px ' + theme.primary : 'none'};
                ">
                    <!-- Top Row: Avatar, Name, ID, Active Pill, Action Buttons -->
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <!-- Circular Avatar with Status Dot -->
                            <div style="position: relative; width: 34px; height: 34px; flex-shrink: 0;">
                                <div style="
                                    width: 34px; 
                                    height: 34px; 
                                    border-radius: 50%; 
                                    background: linear-gradient(135deg, ${theme.primary}, #1546d4); 
                                    color: #fff; 
                                    font-weight: bold; 
                                    font-size: 13px; 
                                    display: flex; 
                                    align-items: center; 
                                    justify-content: center;
                                ">${initials}</div>
                                <span style="
                                    position: absolute; 
                                    bottom: 0px; 
                                    right: 0px; 
                                    width: 9px; 
                                    height: 9px; 
                                    border-radius: 50%; 
                                    background: ${dotColor}; 
                                    box-shadow: 0 0 0 1.5px ${theme.cardBg};
                                "></span>
                            </div>

                            <div>
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-weight: 700; font-size: 15px;">${acc.displayName || 'Fyers User'}</span>
                                    <span style="
                                        font-size: 11px; 
                                        font-family: monospace; 
                                        background: ${statusBg}; 
                                        color: ${statusColor}; 
                                        padding: 2px 6px; 
                                        border-radius: 4px; 
                                        font-weight: 600;
                                    ">${acc.fyId || 'N/A'}</span>
                                    ${isActive ? `
                                        <span style="
                                            background: rgba(41, 98, 255, 0.15); 
                                            color: ${theme.primary}; 
                                            font-size: 11px; 
                                            font-weight: 700; 
                                            padding: 2px 7px; 
                                            border-radius: 12px;
                                        ">ACTIVE</span>
                                    ` : ''}
                                </div>
                                <div style="font-size: 12px; color: ${theme.textMuted}; margin-top: 2px;">
                                    App ID: <code style="font-family: monospace; font-size: 11px; background: rgba(0,0,0,0.05); padding: 1px 4px; border-radius: 3px;">${acc.appId || 'N/A'}</code>
                                </div>
                            </div>
                        </div>

                        <!-- Card Action Buttons -->
                        <div style="display: flex; align-items: center; gap: 8px;">
                            ${acc.webuiRefreshToken ? `
                                <button class="bm-btn-refresh-token" data-id="${acc.id}" title="Refresh access token now using private engine" style="
                                    background: rgba(41, 98, 255, 0.1); 
                                    color: ${theme.primary}; 
                                    border: 1px solid rgba(41, 98, 255, 0.35); 
                                    padding: 5px 10px; 
                                    border-radius: 5px; 
                                    font-size: 12px; 
                                    font-weight: 600; 
                                    cursor: pointer;
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 4px;
                                ">⚡ Refresh</button>
                            ` : ''}
                            ${!isActive ? `
                                <button class="bm-btn-activate" data-id="${acc.id}" style="
                                    background: transparent; 
                                    color: ${theme.primary}; 
                                    border: 1px solid ${theme.primary}; 
                                    padding: 5px 10px; 
                                    border-radius: 5px; 
                                    font-size: 12px; 
                                    font-weight: 600; 
                                    cursor: pointer;
                                ">Set Active</button>
                            ` : ''}
                            <button class="bm-btn-replace" data-id="${acc.id}" style="
                                background: ${theme.isDark ? '#2a2e39' : '#e0e3eb'}; 
                                color: ${theme.text}; 
                                border: none; 
                                padding: 5px 10px; 
                                border-radius: 5px; 
                                font-size: 12px; 
                                font-weight: 500; 
                                cursor: pointer;
                            ">🔄 Replace Tokens</button>
                            <button class="bm-btn-delete" data-id="${acc.id}" title="Delete Account" style="
                                background: transparent; 
                                color: ${theme.error}; 
                                border: 1px solid rgba(242,54,69,0.3); 
                                padding: 5px 8px; 
                                border-radius: 5px; 
                                font-size: 12px; 
                                cursor: pointer;
                            ">🗑</button>
                        </div>
                    </div>

                    <!-- Token Credentials Panel (Clean, Structured, No Long Dots) -->
                    <div style="
                        background: ${theme.bg}; 
                        border: 1px solid ${theme.border}; 
                        border-radius: 8px; 
                        overflow: hidden;
                        font-size: 12px;
                    ">
                        <!-- API Access Token Row -->
                        <div style="
                            display: flex; 
                            justify-content: space-between; 
                            align-items: center; 
                            padding: 9px 12px; 
                            border-bottom: 1px solid ${theme.border};
                        ">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 14px;">🔑</span>
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
                                        border-radius: 12px; 
                                        background: ${isApiExp ? 'rgba(242,54,69,0.1)' : 'rgba(8,153,129,0.1)'}; 
                                        color: ${isApiExp ? theme.error : theme.success}; 
                                        font-weight: 600;
                                        border: 1px solid ${isApiExp ? 'rgba(242,54,69,0.25)' : 'rgba(8,153,129,0.25)'};
                                    ">
                                        <span style="width: 6px; height: 6px; border-radius: 50%; background: ${isApiExp ? theme.error : theme.success};"></span>
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
                            padding: 9px 12px; 
                            border-bottom: 1px solid ${theme.border};
                        ">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 14px;">🔄</span>
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
                                        border-radius: 12px; 
                                        background: ${isRefExp ? 'rgba(242,54,69,0.1)' : 'rgba(8,153,129,0.1)'}; 
                                        color: ${isRefExp ? theme.error : theme.success}; 
                                        font-weight: 600;
                                        border: 1px solid ${isRefExp ? 'rgba(242,54,69,0.25)' : 'rgba(8,153,129,0.25)'};
                                    ">
                                        <span style="width: 6px; height: 6px; border-radius: 50%; background: ${isRefExp ? theme.error : theme.success};"></span>
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
                            padding: 9px 12px;
                        ">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 14px;">🌐</span>
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
                                        border-radius: 12px; 
                                        background: rgba(41,98,255,0.1); 
                                        color: ${theme.primary}; 
                                        font-weight: 600;
                                        border: 1px solid rgba(41,98,255,0.25);
                                    ">
                                        🔒 Stored (Standby)
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
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
                <span style="font-size: 13px; color: ${theme.textMuted}; font-weight: 500;">
                    ${accounts.length} Registered Account${accounts.length === 1 ? '' : 's'}
                </span>
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
                ">
                    <span>+</span> Add Broker Account
                </button>
            </div>

            <!-- Accounts List -->
            <div>
                ${cardsHtml}
            </div>

            <!-- Privacy & Write-Only Notice Footer -->
            <div style="
                margin-top: 16px; 
                padding: 10px 14px; 
                background: ${theme.cardBg}; 
                border-radius: 6px; 
                border: 1px solid ${theme.border}; 
                font-size: 11.5px; 
                color: ${theme.textMuted}; 
                display: flex; 
                align-items: flex-start; 
                gap: 8px;
            ">
                <span style="font-size: 14px;">🔒</span>
                <div>
                    <strong>Write-Only Security:</strong> Raw token strings are strictly write-only and never exposed in plaintext. When replacing tokens, blank fields safely preserve their existing saved tokens.
                </div>
            </div>
        `;
    }

    getFormViewHtml(theme, accounts) {
        const isReplace = this.viewMode === 'replace' && Boolean(this.replaceAccountId);
        const existing = isReplace ? accounts.find(a => a.id === this.replaceAccountId) : null;

        const title = isReplace 
            ? `Replace Tokens: ${existing ? existing.displayName : ''} (${existing ? existing.fyId : ''})` 
            : 'Add New Broker Account';

        const placeholderApi = isReplace 
            ? 'Leave empty to keep existing token, or paste full new token to replace' 
            : 'Paste full API Access Token (JWT string)...';

        const placeholderRefresh = isReplace 
            ? 'Leave empty to keep existing token, or paste full new token to replace' 
            : 'Optional WebUI Refresh Token (JWT string)...';

        const placeholderWebui = isReplace 
            ? 'Leave empty to keep existing token, or paste full new token to replace' 
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

                <h4 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 700;">${title}</h4>
                <div style="font-size: 12px; color: ${theme.textMuted}; margin-bottom: 16px;">
                    ${isReplace 
                        ? 'Enter new token strings to replace. Any field left blank is 100% preserved without deletion.' 
                        : 'Enter your App ID and API Access Token. WebUI Refresh Token is optional but recommended for automatic token renewal.'}
                </div>

                <!-- Form Fields -->
                <div style="display: flex; flex-direction: column; gap: 14px;">
                    <!-- App ID -->
                    <div>
                        <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 5px;">
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
                        ">
                        <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 3px;">
                            Your registered Fyers Client / App ID.
                        </div>
                    </div>

                    <!-- API Access Token -->
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <label style="font-size: 12px; font-weight: 600;">
                                API Access Token ${!isReplace ? `<span style="color: ${theme.error};">*</span>` : '<span style="font-weight: 400; color:' + theme.textMuted + ';">(leave blank to keep current)</span>'}
                            </label>
                            ${isReplace && existing && existing.apiAccessToken ? `
                                <span style="font-size: 11px; font-weight: 600; color: ${window.FyersAPI.isAccountExpired(existing) ? theme.error : theme.success};">
                                    ${window.FyersAPI.isAccountExpired(existing) ? '🔴 Expired' : '🟢 Currently Active'} (${window.FyersAPI.formatExpiry(existing.apiExpiresAt)})
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
                            font-family: monospace; 
                            resize: vertical; 
                            box-sizing: border-box;
                        "></textarea>
                        <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 3px;">
                            Used for all data feeds, historical quotes, and live order placement.
                        </div>
                    </div>

                    <!-- WebUI Refresh Token -->
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <label style="font-size: 12px; font-weight: 600;">
                                WebUI Refresh Token <span style="font-weight: 400; color: ${theme.textMuted};">${isReplace ? '(leave blank to keep current)' : '(Highly recommended, optional)'}</span>
                            </label>
                            ${isReplace && existing && existing.webuiRefreshToken ? `
                                <span style="font-size: 11px; font-weight: 600; color: ${window.FyersAPI.isRefreshExpired(existing) ? theme.error : theme.success};">
                                    ${window.FyersAPI.isRefreshExpired(existing) ? '🔴 Expired' : '🟢 Currently Active'} (${window.FyersAPI.formatExpiry(existing.refreshExpiresAt)})
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
                            font-family: monospace; 
                            resize: vertical; 
                            box-sizing: border-box;
                        "></textarea>
                        <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 3px;">
                            Recommended to obtain fresh access tokens on the fly. Can be left empty for testing or direct API workflows.
                        </div>
                    </div>

                    <!-- WebUI Access Token -->
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <label style="font-size: 12px; font-weight: 600;">
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
                            font-family: monospace; 
                            resize: vertical; 
                            box-sizing: border-box;
                        "></textarea>
                        <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 3px;">
                            Stored for upcoming webui endpoints.
                        </div>
                    </div>
                </div>

                <!-- Live Token Inspector & Cross-Validation Container -->
                <div id="bm-live-inspector" style="margin-top: 16px;"></div>

                <!-- Error Box -->
                <div id="bm-form-error" style="
                    margin-top: 12px; 
                    padding: 10px 12px; 
                    background: rgba(242,54,69,0.1); 
                    border: 1px solid ${theme.error}; 
                    color: ${theme.error}; 
                    border-radius: 6px; 
                    font-size: 12px; 
                    display: none;
                "></div>

                <!-- Bottom Action Buttons -->
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
                    <button id="bm-btn-cancel-form" type="button" style="
                        background: ${theme.isDark ? '#2a2e39' : '#e0e3eb'}; 
                        color: ${theme.text}; 
                        border: none; 
                        padding: 9px 16px; 
                        border-radius: 6px; 
                        font-size: 13px; 
                        font-weight: 600; 
                        cursor: pointer;
                    ">Cancel</button>
                    <button id="bm-btn-save-account" type="button" style="
                        background: ${theme.primary}; 
                        color: #fff; 
                        border: none; 
                        padding: 9px 18px; 
                        border-radius: 6px; 
                        font-size: 13px; 
                        font-weight: 600; 
                        cursor: pointer;
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
                this.renderModal();
            };
        });

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
        const btnBack = modal.querySelector('#bm-btn-back');
        const btnCancel = modal.querySelector('#bm-btn-cancel-form');
        const onCancel = (e) => {
            if (e) e.preventDefault();
            this.viewMode = 'list';
            this.replaceAccountId = null;
            this.renderModal();
        };
        if (btnBack) btnBack.onclick = onCancel;
        if (btnCancel) btnCancel.onclick = onCancel;

        const inputAppId = modal.querySelector('#bm-input-appid');
        const inputApi = modal.querySelector('#bm-input-api');
        const inputRefresh = modal.querySelector('#bm-input-refresh');
        const inputWebui = modal.querySelector('#bm-input-webui');

        const runValidation = () => this.updateLiveInspector(modal);

        if (inputAppId) inputAppId.addEventListener('input', runValidation);
        if (inputApi) inputApi.addEventListener('input', runValidation);
        if (inputRefresh) inputRefresh.addEventListener('input', runValidation);
        if (inputWebui) inputWebui.addEventListener('input', runValidation);

        // Initial run
        runValidation();

        const btnSave = modal.querySelector('#bm-btn-save-account');
        if (btnSave) {
            btnSave.onclick = async (e) => {
                if (e) e.preventDefault();
                const appId = inputAppId ? inputAppId.value.trim() : '';
                const apiAccessToken = inputApi ? inputApi.value.trim() : '';
                const webuiRefreshToken = inputRefresh ? inputRefresh.value.trim() : '';
                const webuiAccessToken = inputWebui ? inputWebui.value.trim() : '';
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

                const res = window.FyersAPI.saveAccount({
                    appId,
                    apiAccessToken,
                    webuiRefreshToken,
                    webuiAccessToken,
                    id: this.replaceAccountId
                });

                if (!res.success) {
                    if (errorBox) {
                        errorBox.innerText = res.error;
                        errorBox.style.display = 'block';
                    }
                    btnSave.innerText = 'Save & Connect';
                    btnSave.disabled = false;
                    return;
                }

                // Test live profile verification in background
                try {
                    await window.FyersAPI.validateAndGetProfile();
                } catch (_) {}

                this.viewMode = 'list';
                this.replaceAccountId = null;
                this.renderModal();
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

        const isReplace = this.viewMode === 'replace' && Boolean(this.replaceAccountId);
        const existing = isReplace && window.FyersAPI ? window.FyersAPI.getAccounts().find(a => a.id === this.replaceAccountId) : null;

        // Validation check
        const check = window.FyersAPI.validateTokens({
            appId,
            apiAccessToken: apiToken,
            webuiRefreshToken: refreshToken,
            webuiAccessToken: webuiToken,
            isReplace,
            existingAccount: existing
        });

        if (!check.valid) {
            inspector.innerHTML = `
                <div style="
                    background: rgba(242,54,69,0.08); 
                    border: 1px solid rgba(242,54,69,0.3); 
                    border-radius: 6px; 
                    padding: 10px 14px; 
                    font-size: 12px; 
                    color: ${theme.error};
                ">
                    <div style="font-weight: 600; margin-bottom: 4px;">⚠️ Verification Status</div>
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

        const isCrossVerified = Boolean(refreshToken || (isReplace && existing && existing.webuiRefreshToken));

        inspector.innerHTML = `
            <div style="
                background: rgba(8,153,129,0.08); 
                border: 1px solid rgba(8,153,129,0.3); 
                border-radius: 6px; 
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
                                font-family: monospace; 
                                font-size: 11px; 
                                background: rgba(8,153,129,0.15); 
                                color: ${theme.success}; 
                                padding: 2px 6px; 
                                border-radius: 3px; 
                                font-weight: 600; 
                                margin-left: 6px;
                            ">ID: ${fyId}</span>
                        </div>
                    </div>
                    <span style="color: ${theme.success}; font-weight: 700; font-size: 12px;">
                        ${isCrossVerified ? '✓ Cross-Verified' : '✓ Verified'}
                    </span>
                </div>
                <div style="font-size: 11.5px; color: ${theme.textMuted}; line-height: 1.5;">
                    • <strong>API Token Expiry:</strong> ${apiExpStr}<br>
                    • <strong>Refresh Token:</strong> ${refExpStr || 'Not provided (No auto-renew)'}<br>
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
                    border-radius: 6px; 
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
