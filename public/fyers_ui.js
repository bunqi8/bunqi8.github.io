// Fyers Multi-Account Broker & Token Manager UI Integration for TradingView

class FyersUI {
    constructor() {
        this.btnId = 'btn-fyers-broker';
        this.modalId = 'broker-manager-modal';
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

        return `Broker: Fyers\nUser: ${active.displayName || 'User'}\nID: ${active.fyId || 'N/A'}\nStatus: ${statusStr}\nAPI Token: ${apiExpFormatted}\nRefresh Token: ${refreshExpFormatted}`;
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

        let contentHtml = '';
        if (this.viewMode === 'list') {
            contentHtml = this.getListViewHtml(theme, accounts, activeAccount);
        } else {
            contentHtml = this.getFormViewHtml(theme, accounts);
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
                    padding: 16px 20px; 
                    border-bottom: 1px solid ${theme.border};
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
                                Fyers API v3 & WebUI Token Authentication
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

                <!-- Body (Scrollable) -->
                <div style="padding: 20px; overflow-y: auto; flex: 1;">
                    ${contentHtml}
                </div>
            </div>
        `;

        // Wire event handlers
        const btnClose = document.getElementById('bm-btn-close');
        if (btnClose) btnClose.onclick = () => modal.style.display = 'none';

        if (this.viewMode === 'list') {
            this.bindListViewEvents(modal);
        } else {
            this.bindFormViewEvents(modal);
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
                const refExpStr = acc.refreshExpiresAt ? window.FyersAPI.formatExpiry(acc.refreshExpiresAt) : (acc.webuiRefreshToken ? 'Configured' : null);

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

                    <!-- Tokens Info Table (Strictly Masked & Write-Only) -->
                    <div style="
                        background: ${theme.bg}; 
                        border: 1px solid ${theme.border}; 
                        border-radius: 6px; 
                        padding: 10px 12px; 
                        font-size: 12px;
                    ">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                            <span style="color: ${theme.textMuted}; font-weight: 500;">API Access Token:</span>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-family: monospace; letter-spacing: 2px; color: ${theme.textMuted}; font-size: 11px;">••••••••••••••••••••••••</span>
                                <span style="
                                    font-size: 11px; 
                                    padding: 1px 6px; 
                                    border-radius: 3px; 
                                    background: ${isApiExp ? 'rgba(242,54,69,0.1)' : 'rgba(8,153,129,0.1)'}; 
                                    color: ${isApiExp ? theme.error : theme.success}; 
                                    font-weight: 600;
                                ">${apiExpStr}</span>
                            </div>
                        </div>

                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                            <span style="color: ${theme.textMuted}; font-weight: 500;">WebUI Refresh Token:</span>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                ${refExpStr ? `
                                    <span style="font-family: monospace; letter-spacing: 2px; color: ${theme.textMuted}; font-size: 11px;">••••••••••••••••••••••••</span>
                                    <span style="
                                        font-size: 11px; 
                                        padding: 1px 6px; 
                                        border-radius: 3px; 
                                        background: ${isRefExp ? 'rgba(242,54,69,0.1)' : 'rgba(8,153,129,0.1)'}; 
                                        color: ${isRefExp ? theme.error : theme.success}; 
                                        font-weight: 600;
                                    ">${refExpStr}</span>
                                ` : `
                                    <span style="font-size: 11px; color: ${theme.textMuted}; font-style: italic;">Not provided (Manual renewal)</span>
                                `}
                            </div>
                        </div>

                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: ${theme.textMuted}; font-weight: 500;">WebUI Access Token:</span>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-family: monospace; letter-spacing: 2px; color: ${theme.textMuted}; font-size: 11px;">••••••••••••••••••••••••</span>
                                <span style="font-size: 11px; color: ${theme.textMuted};">
                                    ${acc.webuiAccessToken ? 'Stored' : 'Not provided'}
                                </span>
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
                    <strong>Write-Only Security:</strong> For your protection, once tokens are saved they are strictly masked and cannot be viewed in plaintext. To update tokens, use the "Replace Tokens" option.
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
                        ? 'Enter new token strings to replace. Any field left blank preserves the currently saved token.' 
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
                        <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 5px;">
                            API Access Token ${!isReplace ? `<span style="color: ${theme.error};">*</span>` : '<span style="font-weight: 400; color:' + theme.textMuted + ';">(optional replacement)</span>'}
                        </label>
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
                        <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 5px;">
                            WebUI Refresh Token <span style="font-weight: 400; color: ${theme.textMuted};">(Highly recommended, optional)</span>
                        </label>
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
                        <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 5px;">
                            WebUI Access Token <span style="font-weight: 400; color: ${theme.textMuted};">(optional)</span>
                        </label>
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

        // Valid tokens found
        const displayName = check.displayName || 'Fyers User';
        const fyId = check.fyId || 'N/A';
        const initials = check.initials || 'FY';
        const apiExpStr = check.apiExpiresAt ? window.FyersAPI.formatExpiry(check.apiExpiresAt) : (isReplace && existing ? window.FyersAPI.formatExpiry(existing.apiExpiresAt) : 'Kept current');
        
        let refExpStr = null;
        if (check.refreshExpiresAt) {
            refExpStr = window.FyersAPI.formatExpiry(check.refreshExpiresAt);
        } else if (isReplace && existing && existing.refreshExpiresAt) {
            refExpStr = window.FyersAPI.formatExpiry(existing.refreshExpiresAt);
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
                </div>
            </div>
        `;
    }
}

window.FyersUI = new FyersUI();
