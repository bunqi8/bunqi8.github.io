/**
 * MetaTrader 5 (MT5) Fleet Manager UI for TradingView
 * Renders dedicated topbar indicator pill and multi-account prop firm fleet modal.
 * Fully isolated from Fyers integration.
 */

(function(window) {
    'use strict';

    // Curated Benchmark US Equities, Benchmark ETFs, and Mega-Caps (~500 High-Volume Symbols)
    const MAJOR_US_SET = new Set([
        // Top Benchmark ETFs
        "SPY", "QQQ", "DIA", "IWM", "VOO", "VTI", "VEA", "VWO", "EEM", "EFA", 
        "XLK", "XLF", "XLE", "XLI", "XLV", "XLP", "XLY", "XLU", "XLB", "XLC", 
        "SMH", "SOXX", "ARKK", "TQQQ", "SQQQ", "TLT", "IEF", "HYG", "LQD", 
        "GLD", "SLV", "USO", "UNG", "UVXY", "VIXY", "BITO",

        // Mega-Cap & Large-Cap Tech
        "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA", "AVGO", "ORCL", 
        "ADBE", "CRM", "AMD", "CSCO", "INTC", "QCOM", "TXN", "AMAT", "INTU", "IBM", 
        "NOW", "MU", "PANW", "AMGN", "LRCX", "ADI", "KLAC", "SNPS", "CDNS", "NXPI", 
        "MRVL", "FTNT", "ABNB", "CRWD", "PLTR", "COIN", "UBER", "DASH", "SHOP", "SQ", 
        "PYPL", "HOOD", "RIVN", "LCID", "NIO", "BABA", "JD", "PDD", "TSM", "ASML", 
        "ARM", "BIDU", "NET", "DDOG", "ZS", "MDB", "TEAM", "HUBS", "DOCU", "OKTA", 
        "TWLO", "RBLX", "U", "SMCI", "DELL", "HPE", "WDC", "STX",

        // Financials & Payments
        "JPM", "BAC", "WFC", "C", "MS", "GS", "BLK", "SCHW", "AXP", "V", "MA", 
        "ICE", "CME", "SPGI", "MCO", "MMC", "AON", "PGR", "TRV", "ALL", "CB", "MET", "PRU", "AFL",

        // Healthcare & Pharma
        "LLY", "UNH", "JNJ", "ABBV", "MRK", "TMO", "ABT", "PFE", "DHR", "BMY", 
        "ISRG", "GILD", "VRTX", "REGN", "MDT", "ELV", "CI", "CVS", "SYK", "BDX", 
        "BSX", "ZTS", "EW", "HCA", "MCK", "COR", "CAH", "MRNA", "BNTX",

        // Consumer & Retail
        "WMT", "COST", "HD", "PG", "KO", "PEP", "MCD", "NKE", "SBUX", "TGT", 
        "LOW", "TJX", "BKNG", "MAR", "HLT", "CMG", "YUM", "CL", "KMB", "MO", "PM", "STZ", "EL", "DECK", "LULU",

        // Industrials & Aerospace
        "GE", "CAT", "UNP", "HON", "RTX", "BA", "LMT", "DE", "UPS", "FDX", 
        "NSC", "CSX", "ETN", "ITW", "PH", "GD", "NOC", "TDG", "CMI", "PCAR", "EMR", "ROP", "JCI", "TT",

        // Energy & Utilities
        "XOM", "CVX", "COP", "SLB", "EOG", "MPC", "PSX", "VLO", "OXY", "WMB", 
        "KMI", "HES", "BKR", "HAL", "NEE", "DUK", "SO", "AEP", "SRE", "D", "EXC", "XEL", "CEG", "VST", "NRG",

        // Basic Materials & Real Estate
        "LIN", "APD", "SHW", "ECL", "FCX", "NEM", "NUE", "DOW", "CTVA", 
        "PLD", "AMT", "EQIX", "CCI", "PSA", "O", "SPG", "WELL", "DLR", "WY",

        // Popular / High-Volume Trading Names
        "GME", "AMC", "SOFI", "MARA", "RIOT", "CLSK", "MSTR", "DJT", "SOUN", "IONQ", "RGTI", "QS", "NKLA"
    ]);

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
            this.editingEndpointId = null; // Endpoint currently open in edit mode
            this.showAddBridgeForm = false; // Toggle collapsible add bridge server drawer
            this.accumulatedOcrText = ''; // Cumulative OCR / paste text buffer

            // Universe Mode: 'MAJOR' (~666 liquid universe) or 'ALL' (12,197)
            this.tickerUniverseMode = 'MAJOR';

            // Real-time live ping listener from bridge sockets
            if (window.MT5API && typeof window.MT5API.onPing === 'function') {
                window.MT5API.onPing((epId, pingMs) => {
                    this.updateLivePingBadge(epId, pingMs);
                });
            }

            // Full account details state & history
            this.detailsAccountId = null;
            this.detailsData = null;
            this.detailsLoading = false;
            this.detailsSyncing = false;
            this.detailsProgress = null;
            this.detailsSubTab = 'tickers'; // 'overview', 'tickers', 'positions', 'history'
            this.tickerSearchQuery = '';
            this.tickerCategoryFilter = 'managed';
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
            // Ensure inputs inside modals and floating UI are cleanly isolated from parent hotkeys
            document.addEventListener('keydown', (e) => {
                const tag = e.target ? e.target.tagName : '';
                if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && e.target.closest('#mt5-fleet-modal')) {
                    e.stopPropagation();
                }
            });

            if (!document.getElementById('mt5-spin-style')) {
                const style = document.createElement('style');
                style.id = 'mt5-spin-style';
                style.textContent = `
                    @keyframes mt5spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                    @keyframes mt5pulse {
                        0% { transform: scale(0.92); opacity: 0.75; }
                        50% { transform: scale(1.18); opacity: 1; }
                        100% { transform: scale(0.92); opacity: 0.75; }
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
                        if (this.viewMode === 'details') {
                            this.updateLiveDetailsFinancials();
                        } else if (this.viewMode === 'list') {
                            const modal = document.getElementById(this.modalId);
                            const renderedCards = modal ? modal.querySelectorAll('.mt5-account-card') : [];
                            const accounts = (window.MT5API && window.MT5API.accounts) ? window.MT5API.accounts : [];
                            const uniqueAccountsCount = new Set(accounts.map(a => `${String(a.login || '').trim()}::${String(a.server || '').trim().toLowerCase()}`)).size;
                            const hasEmptyPlaceholder = modal ? Boolean(modal.querySelector('.mt5-modal-body div[style*="dashed"]')) : false;
                            // If account count changed, or if placeholder was showing and accounts arrived, do a full re-render
                            if (renderedCards.length !== uniqueAccountsCount || (hasEmptyPlaceholder && accounts.length > 0)) {
                                this.renderModal();
                            } else {
                                this.updateFleetCardsInPlace();
                            }
                        } else if (this.viewMode === 'details') {
                            this.updateLiveDetailsFinancials();
                        } else if (this.viewMode === 'bridges' || this.viewMode === 'routing') {
                            this.renderModal();
                        }
                    }
                });

                // Listen to real-time WebSocket positions streaming
                window.MT5API.onPositionUpdate((positions) => {
                    this.handleLivePositionUpdate(positions);
                });

                // Listen to real-time order & position notifications
                if (typeof window.MT5API.onNotification === 'function') {
                    window.MT5API.onNotification((notif) => {
                        this.showNotification(notif);
                    });
                }
            }

            // Listen to real-time Hugging Face archival status pushed over WebSocket
            window.addEventListener('mt5_hf_status_update', (e) => {
                const data = e.detail;
                if (!data || !data.status) return;
                const s = data.status;
                const modal = document.getElementById(this.modalId);
                if (!modal || modal.style.display === 'none') return;

                modal.querySelectorAll('.mt5-hf-status-tag, #mt5-hf-status-tag').forEach(tag => {
                    tag.style.color = s.is_syncing ? '#ff9800' : '#089981';
                    tag.textContent = s.is_syncing ? '🔄 ACTIVE INCEPTION SYNC:' : '🟢 ARCHIVAL IDLE:';
                });
                modal.querySelectorAll('.mt5-hf-status-desc, #mt5-hf-status-desc').forEach(desc => {
                    desc.textContent = s.is_syncing 
                        ? `${s.current_symbol || 'Symbol'} (${s.current_server || 'Server'}, ${s.current_chunk || 'chunk'})` 
                        : 'Fleet automatically rotates across all symbols from inception';
                });
                modal.querySelectorAll('.mt5-hf-queue-count, #mt5-hf-queue-count').forEach(q => {
                    q.textContent = `${s.completed_symbols || 0} / ${s.total_symbols || 0} Tickers`;
                });
                modal.querySelectorAll('.mt5-hf-chunks-count, #mt5-hf-chunks-count').forEach(c => {
                    c.textContent = `${s.completed_chunks || 0}`;
                });
                modal.querySelectorAll('.mt5-hf-uploaded-mb, #mt5-hf-uploaded-mb').forEach(mb => {
                    mb.textContent = `${((s.total_bytes_uploaded || 0) / (1024 * 1024)).toFixed(1)} MB`;
                });

                // Update live archival stream card in Tickers tab if visible
                const liveStatusEl = modal.querySelector('#mt5-live-archival-status');
                const liveSubEl = modal.querySelector('#mt5-live-archival-sub');
                const pulseDot = modal.querySelector('#mt5-hf-live-pulse-dot');
                const liveSyncedCount = modal.querySelector('#mt5-live-synced-count');
                const liveUploadedMb = modal.querySelector('#mt5-live-uploaded-mb');

                if (liveStatusEl) {
                    if (s.is_syncing) {
                        liveStatusEl.innerHTML = `<span style="display:inline-block;animation:mt5spin 1.2s linear infinite;">🔄</span> Syncing ${s.current_symbol || ''} (${s.current_server || 'Server'}, ${s.current_chunk || '1m'})`;
                        liveStatusEl.style.color = '#2196f3';
                        if (liveSubEl) liveSubEl.textContent = 'Live streaming chunks to Hugging Face · Deduplication SHA-256 active';
                        if (pulseDot) {
                            pulseDot.style.background = '#ff9800';
                            pulseDot.style.boxShadow = '0 0 8px #ff9800';
                            pulseDot.style.animation = 'mt5pulse 1.2s ease-in-out infinite';
                        }
                    } else {
                        liveStatusEl.textContent = `🟢 Archival Idle · All Managed Verified`;
                        liveStatusEl.style.color = '#4caf50';
                        if (liveSubEl) liveSubEl.textContent = 'Fleet autonomously updates 1m & 1D datasets from inception → present';
                        if (pulseDot) {
                            pulseDot.style.background = '#089981';
                            pulseDot.style.boxShadow = '0 0 8px #089981';
                            pulseDot.style.animation = 'none';
                        }
                    }
                }
                if (liveSyncedCount) {
                    liveSyncedCount.textContent = `${s.completed_symbols || 0} / ${s.total_symbols || 146}`;
                }
                if (liveUploadedMb) {
                    liveUploadedMb.textContent = `${((s.total_bytes_uploaded || 0) / (1024 * 1024)).toFixed(1)} MB`;
                }

                // If on tickers tab, refresh row sync badges in-place for active syncing symbol and previously syncing symbol
                if (this.viewMode === 'details' && this.detailsSubTab === 'tickers') {
                    const server = (this.detailsData && this.detailsData.account ? this.detailsData.account.server : '');
                    const theme = this.getTheme();
                    if (s.current_symbol) {
                        const activeRow = modal.querySelector(`.mt5-ticker-row[data-symbol="${s.current_symbol}"], .mt5-ticker-row[data-canon="${s.current_symbol}"]`);
                        if (activeRow) {
                            const container = activeRow.querySelector('.mt5-hf-badge-container');
                            if (container) {
                                container.outerHTML = this.renderHfBadgeHtml(server, s.current_symbol, theme);
                            }
                        }
                    }
                    if (this._lastSyncingSymbol && this._lastSyncingSymbol !== s.current_symbol) {
                        const prevRow = modal.querySelector(`.mt5-ticker-row[data-symbol="${this._lastSyncingSymbol}"], .mt5-ticker-row[data-canon="${this._lastSyncingSymbol}"]`);
                        if (prevRow) {
                            const container = prevRow.querySelector('.mt5-hf-badge-container');
                            if (container) {
                                container.outerHTML = this.renderHfBadgeHtml(server, this._lastSyncingSymbol, theme);
                            }
                        }
                    }
                    this._lastSyncingSymbol = s.current_symbol;
                }
            });

            // Listen to background-loaded manifests to update date ranges in-place
            window.addEventListener('mt5_manifest_loaded', (e) => {
                const detail = e.detail;
                if (!detail || !detail.symbol) return;
                const modal = document.getElementById(this.modalId);
                if (!modal || modal.style.display === 'none') return;
                const row = modal.querySelector(`.mt5-ticker-row[data-symbol="${detail.symbol}"]`);
                if (row) {
                    const server = detail.server || (this.detailsData && this.detailsData.account ? this.detailsData.account.server : '');
                    const container = row.querySelector('.mt5-hf-badge-container');
                    if (container) {
                        container.outerHTML = this.renderHfBadgeHtml(server, detail.symbol, this.getTheme());
                    }
                }
            });
        }

        mount() {
            this.injectButton();
            // Retry injection if TradingView chart iframe loads dynamically
            setInterval(() => this.injectButton(), 2000);
        }

        getTheme() {
            let isDark = false;
            try {
                if (window.tvWidget && typeof window.tvWidget.getTheme === 'function') {
                    isDark = window.tvWidget.getTheme().toLowerCase() === 'dark';
                }
            } catch (_) {}
            if (!isDark) {
                isDark = document.body.classList.contains('theme-dark') || 
                         document.documentElement.getAttribute('data-theme') === 'dark' ||
                         document.documentElement.classList.contains('theme-dark');
            }

            if (isDark) {
                // Official TradingView Dark Theme
                return {
                    isDark: true,
                    bg: '#1e222d',
                    cardBg: '#131722',
                    cardSurface: '#2a2e39',
                    border: '#2a2e39',
                    borderSubtle: '#1e222d',
                    text: '#d1d4dc',
                    textMuted: '#787b86',
                    textDim: '#5d606b',
                    primary: '#2962ff',
                    primarySoft: 'rgba(41, 98, 255, 0.12)',
                    primaryBorder: 'rgba(41, 98, 255, 0.3)',
                    success: '#089981',
                    successSoft: 'rgba(8, 153, 129, 0.12)',
                    successBorder: 'rgba(8, 153, 129, 0.3)',
                    error: '#f23645',
                    errorSoft: 'rgba(242, 54, 69, 0.12)',
                    errorBorder: 'rgba(242, 54, 69, 0.3)',
                    warning: '#ff9800',
                    warningSoft: 'rgba(255, 152, 0, 0.12)',
                    warningBorder: 'rgba(255, 152, 0, 0.3)',
                    inputBg: '#131722',
                    inputBorder: '#363c4e',
                    inputText: '#d1d4dc',
                    pillBg: '#2a2e39',
                    pillText: '#787b86',
                    pillBorder: '#363c4e',
                    rowBg: '#131722',
                    rowHover: '#2a2e39',
                    rowBorder: '#2a2e39',
                    shadow: '0 16px 45px rgba(0,0,0,0.5)',
                };
            }

            // Official TradingView Light Theme (Signature TV Palette matching chart)
            return {
                isDark: false,
                bg: '#ffffff',
                cardBg: '#f8f9fd',
                cardSurface: '#ffffff',
                border: '#e0e3eb',
                borderSubtle: '#f0f3fa',
                text: '#131722',
                textMuted: '#787b86',
                textDim: '#b2b5be',
                primary: '#2962ff',
                primarySoft: 'rgba(41, 98, 255, 0.08)',
                primaryBorder: 'rgba(41, 98, 255, 0.25)',
                success: '#089981',
                successSoft: 'rgba(8, 153, 129, 0.1)',
                successBorder: 'rgba(8, 153, 129, 0.25)',
                error: '#f23645',
                errorSoft: 'rgba(242, 54, 69, 0.1)',
                errorBorder: 'rgba(242, 54, 69, 0.25)',
                warning: '#ff9800',
                warningSoft: 'rgba(255, 152, 0, 0.1)',
                warningBorder: 'rgba(255, 152, 0, 0.25)',
                inputBg: '#ffffff',
                inputBorder: '#d1d4dc',
                inputText: '#131722',
                pillBg: '#f0f3fa',
                pillText: '#787b86',
                pillBorder: '#e0e3eb',
                rowBg: '#ffffff',
                rowHover: '#f0f3fa',
                rowBorder: '#e0e3eb',
                shadow: '0 16px 45px rgba(0,0,0,0.18)',
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
            const siblings = accounts.filter(a => String(a.login) === String(acc.login) && (a.server || '').toLowerCase() === (acc.server || '').toLowerCase());
            const bestBal = Math.max(...siblings.map(s => Number(s.balance || 0)), Number(acc.balance || 0));
            const bestEq = Math.max(...siblings.map(s => Number(s.equity || 0)), Number(acc.equity || 0));
            const displayBal = bestBal > 0 ? bestBal : acc.balance;
            const displayEq = bestEq > 0 ? bestEq : acc.equity;
            const balanceStr = displayBal != null ? `$${Number(displayBal).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : 'N/A';
            const equityStr = displayEq != null ? `$${Number(displayEq).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : 'N/A';
            const epName = acc.endpointName ? `Host Bridge: ${acc.endpointName}\n` : '';
            const endpoints = window.MT5API.getEndpoints ? window.MT5API.getEndpoints().filter(e => e.enabled) : [];
            const onlineCount = endpoints.filter(e => e.status === 'online').length;
            const bridgeMeshStr = endpoints.length > 1 ? `Bridges: ${onlineCount}/${endpoints.length} Online\n` : '';
            let feedStr = '';
            if (window.MT5ParquetIndex && window.MT5ParquetIndex.lastFeedEvent) {
                const ev = window.MT5ParquetIndex.lastFeedEvent;
                if (ev.source === 'parquet') {
                    feedStr = `\nFeed: ⚡ 0ms Parquet (${ev.parquetBars} bars cached)`;
                } else if (ev.source === 'stitched') {
                    feedStr = `\nFeed: ⚡ Parquet (${ev.parquetBars} bars) + 🔴 Live Tail (${ev.liveBars} bars)`;
                } else if (ev.source === 'live') {
                    feedStr = `\nFeed: 🔴 Live MT5 Bridge (${ev.totalBars} bars)`;
                }
            }
            if (window.MT5ParquetIndex && window.MT5ParquetIndex.bridgeStatus && window.MT5ParquetIndex.bridgeStatus.is_syncing) {
                const s = window.MT5ParquetIndex.bridgeStatus;
                feedStr += `\n📦 HF Syncing: ${s.current_symbol || ''} (${s.current_chunk || ''})`;
            }
            return `Broker: MetaTrader 5\nAccount: ${acc.nickname || 'Default'} (#${acc.login || 'N/A'})\n${epName}${bridgeMeshStr}Server: ${acc.server || 'N/A'}\nStatus: ${isConn ? 'Connected' : 'Connecting...'}\nBalance: ${balanceStr}\nEquity: ${equityStr}\nFleet: ${accounts.length} Accounts Active${feedStr}\nClick to manage MT5 fleet`;
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

        updateLivePingBadge(epId, pingMs) {
            const modal = document.getElementById(this.modalId);
            if (modal) {
                const badge = modal.querySelector(`.mt5-ping-badge[data-id="${epId}"]`);
                if (badge) {
                    badge.innerText = `🟢 Online (${pingMs}ms)`;
                    badge.style.color = '#089981';
                    badge.style.background = 'rgba(8,153,129,0.12)';
                    badge.style.border = '1px solid rgba(8,153,129,0.25)';
                    badge.style.padding = '1px 6px';
                }
            }
            const activeEp = window.MT5API ? window.MT5API.getActiveEndpoint() : null;
            if (activeEp && activeEp.id === epId) {
                this.updateButtonState();
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

        isLocalVmBridge(ep) {
            if (window.MT5API && typeof window.MT5API.isLocalVmBridge === 'function') {
                return window.MT5API.isLocalVmBridge(ep);
            }
            if (!ep) return false;
            const name = (ep.name || '').toLowerCase();
            const url = (ep.url || '').toLowerCase();
            const isVmKeyword = name.includes('local') || name.includes('vmware') || 
                                name.includes('desktop') || name.includes('lan') || 
                                name.includes('home') || name.includes('workstation');
            const hasVmNotCloud = name.includes('vm') && !name.includes('cloud') && !name.includes('oracle') && !name.includes('aws') && !name.includes('vps');
            const isPrivateIp = url.includes('127.0.0.1') || url.includes('localhost') ||
                                url.includes('192.168.') || url.includes('10.') ||
                                /172\.(1[6-9]|2[0-9]|3[0-1])\./.test(url);
            return Boolean(isVmKeyword || hasVmNotCloud || isPrivateIp);
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

            // Background status sync for Parquet engine
            if (window.MT5ParquetIndex && typeof window.MT5ParquetIndex.pollBridgeStatus === 'function') {
                window.MT5ParquetIndex.pollBridgeStatus().then(() => {
                    if (this.isOpen && this.activeTab === 'parquet') this.renderModal();
                }).catch(() => {});
            }

            // Auto-heal on open: if any bridge is offline/unknown or 0 accounts, proactively trigger auto-discovery and account sync!
            if (window.MT5API) {
                const endpoints = window.MT5API.getEndpoints() || [];
                const hasOffline = endpoints.some(e => e.enabled && (e.status === 'offline' || e.status === 'unknown'));
                const hasNoAccounts = (window.MT5API.accounts || []).length === 0;

                if (hasOffline || hasNoAccounts) {
                    window.MT5API.syncAllEndpointsFromGist(false).then(() => {
                        return window.MT5API.syncAccounts(true);
                    }).then(() => {
                        if (this.isOpen) this.renderModal();
                    }).catch(() => {});
                }
            }
        }

        closeModal() {
            this.isOpen = false;
            this.accumulatedOcrText = '';
            const modal = document.getElementById(this.modalId);
            if (modal) modal.style.display = 'none';
        }

        renderModal() {
            const modal = document.getElementById(this.modalId);
            if (!modal) return;

            // Preserve active scroll positions across modal re-renders
            const scrollMap = new Map();
            const modalBody = modal.querySelector('.mt5-modal-body');
            if (modalBody && modalBody.scrollTop > 0) scrollMap.set('modal-body', modalBody.scrollTop);
            modal.querySelectorAll('#mt5-history-items-container, #mt5-ticker-items-container, #mt5-positions-items-container').forEach(el => {
                if (el.id && el.scrollTop > 0) scrollMap.set(el.id, el.scrollTop);
                const sub = el.querySelector('div[style*="overflow"]');
                if (sub && sub.scrollTop > 0) scrollMap.set(el.id + '-inner', sub.scrollTop);
            });

            const theme = this.getTheme();
            const accounts = window.MT5API ? window.MT5API.accounts : [];
            const activeAcc = window.MT5API ? window.MT5API.getActiveAccount() : null;
            const endpoints = window.MT5API ? window.MT5API.getEndpoints() : [];
            const isConn = window.MT5API ? window.MT5API.isConnected : false;
            const discoveryAuthors = (window.MT5ParquetIndex && typeof window.MT5ParquetIndex.getDiscoveryAuthors === 'function') 
                ? window.MT5ParquetIndex.getDiscoveryAuthors() 
                : [];

            modal.innerHTML = `
                <style>
                    #mt5-fleet-modal,
                    #mt5-fleet-modal *,
                    #mt5-fleet-modal *::before,
                    #mt5-fleet-modal *::after {
                        box-sizing: border-box !important;
                    }
                    #mt5-fleet-modal input,
                    #mt5-fleet-modal select,
                    #mt5-fleet-modal button {
                        box-sizing: border-box !important;
                    }
                    #mt5-fleet-modal *::-webkit-scrollbar {
                        width: 6px;
                        height: 6px;
                    }
                    #mt5-fleet-modal *::-webkit-scrollbar-track {
                        background: transparent;
                    }
                    #mt5-fleet-modal *::-webkit-scrollbar-thumb {
                        background: rgba(120, 120, 120, 0.35);
                        border-radius: 4px;
                    }
                    #mt5-fleet-modal *::-webkit-scrollbar-thumb:hover {
                        background: rgba(59, 130, 246, 0.7);
                    }
                    #mt5-fleet-modal * {
                        scrollbar-width: thin;
                        scrollbar-color: rgba(120, 120, 120, 0.35) transparent;
                    }
                    .mt5-ghost-btn {
                        background: ${theme.pillBg} !important;
                        color: ${theme.text} !important;
                        border: 1px solid ${theme.border} !important;
                        transition: all 0.12s ease !important;
                    }
                    .mt5-ghost-btn:hover {
                        background: ${theme.rowHover} !important;
                        color: ${theme.primary} !important;
                        border-color: ${theme.primaryBorder} !important;
                    }
                    .mt5-btn-chart-symbol {
                        background: ${theme.primarySoft} !important;
                        color: ${theme.primary} !important;
                        border: 1px solid ${theme.primaryBorder} !important;
                        transition: all 0.12s ease !important;
                    }
                    .mt5-btn-chart-symbol:hover {
                        background: ${theme.primary} !important;
                        color: #ffffff !important;
                        border-color: ${theme.primary} !important;
                    }
                    .mt5-ticker-row {
                        transition: background 0.12s ease !important;
                    }
                    .mt5-ticker-row:hover {
                        background: ${theme.rowHover} !important;
                    }
                    .mt5-cat-pill {
                        transition: all 0.12s ease !important;
                    }
                    .mt5-cat-pill:hover:not([style*="rgb(41, 98, 255)"]):not([style*="#2962ff"]) {
                        background: ${theme.rowHover} !important;
                        color: ${theme.text} !important;
                    }
                </style>
                <div style="
                    background: ${theme.bg};
                    color: ${theme.text};
                    border: 1px solid ${theme.border};
                    border-radius: 8px;
                    width: 820px;
                    max-width: 96vw;
                    max-height: 88vh;
                    display: flex;
                    flex-direction: column;
                    box-shadow: ${theme.shadow};
                    overflow: hidden;
                    font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif;
                ">
                    <!-- Modal Header (Unified Streamlined Bar) -->
                    <div style="
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        padding: 7px 12px;
                        background: ${theme.cardBg};
                        border-bottom: 1px solid ${theme.border};
                        flex-wrap: wrap;
                        gap: 6px;
                    ">
                        <!-- Left Brand & Live Status -->
                        <div style="display: flex; align-items: center; gap: 7px; min-width: 0;">
                            <span style="
                                width: 22px; height: 22px; border-radius: 5px;
                                background: linear-gradient(135deg, #2962ff 0%, #089981 100%);
                                color: #fff; display: flex; align-items: center; justify-content: center;
                                font-weight: bold; font-size: 11px; flex-shrink: 0;
                            ">⚡</span>
                            <strong style="font-size: 13px; font-weight: 700; white-space: nowrap;">
                                MT5 Fleet Terminal
                            </strong>
                            <span style="
                                font-size: 9.5px; padding: 1px 6px; border-radius: 4px; font-weight: 600;
                                background: ${isConn ? 'rgba(8,153,129,0.12)' : 'rgba(255,152,0,0.12)'};
                                color: ${isConn ? theme.success : theme.warning};
                                border: 1px solid ${isConn ? 'rgba(8,153,129,0.25)' : 'rgba(255,152,0,0.25)'};
                                display: inline-flex; align-items: center; gap: 3px;
                            ">
                                ${isConn ? '🟢 Live' : '⚪ Standby'}
                            </span>
                        </div>

                        <!-- Center Compact Segment Navigation -->
                        <div style="
                            display: inline-flex; align-items: center;
                            background: ${theme.isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.06)'};
                            padding: 2px; border-radius: 5px; border: 1px solid ${theme.border};
                        ">
                            <button id="mt5-tab-fleet" type="button" style="
                                background: ${this.activeTab === 'fleet' ? theme.primary : 'transparent'};
                                color: ${this.activeTab === 'fleet' ? '#fff' : theme.textMuted};
                                border: none; border-radius: 3px;
                                padding: 3px 11px; font-size: 11px; font-weight: 600; cursor: pointer;
                                display: inline-flex; align-items: center; gap: 4px; transition: all 0.12s ease;
                            ">
                                <span>💼</span> Accounts (${accounts.length})
                            </button>
                            <button id="mt5-tab-settings" type="button" style="
                                background: ${this.activeTab === 'settings' ? theme.primary : 'transparent'};
                                color: ${this.activeTab === 'settings' ? '#fff' : theme.textMuted};
                                border: none; border-radius: 3px;
                                padding: 3px 11px; font-size: 11px; font-weight: 600; cursor: pointer;
                                display: inline-flex; align-items: center; gap: 4px; transition: all 0.12s ease;
                            ">
                                <span>⚙️</span> Bridges (${endpoints.length})
                                <span style="width: 5px; height: 5px; border-radius: 50%; background: ${isConn ? '#00e676' : '#ffa500'}; display: inline-block;"></span>
                            </button>
                            <button id="mt5-tab-parquet" type="button" style="
                                background: ${this.activeTab === 'parquet' ? theme.primary : 'transparent'};
                                color: ${this.activeTab === 'parquet' ? '#fff' : theme.textMuted};
                                border: none; border-radius: 3px;
                                padding: 3px 11px; font-size: 11px; font-weight: 600; cursor: pointer;
                                display: inline-flex; align-items: center; gap: 4px; transition: all 0.12s ease;
                            ">
                                <span>🤗</span> Parquet Data (${discoveryAuthors.length + 1})
                            </button>
                        </div>

                        <!-- Right Close Button -->
                        <button id="mt5-modal-btn-close" style="
                            background: transparent; border: none; color: ${theme.textMuted};
                            font-size: 16px; cursor: pointer; padding: 2px 6px; border-radius: 4px; line-height: 1;
                        " title="Close (Esc)">✕</button>
                    </div>

                    <!-- Modal Body (Compact High-Density View) -->
                    <div class="mt5-modal-body" style="padding: 10px 12px; overflow-y: auto; overflow-x: hidden; flex: 1; box-sizing: border-box; width: 100%;">
                        ${this.activeTab === 'fleet' ? this.getFleetHtml(theme, accounts, activeAcc) : (this.activeTab === 'parquet' ? this.getParquetHtml(theme) : this.getSettingsHtml(theme))}
                    </div>
                </div>
            `;

            this.bindEvents(modal);

            // Restore scroll positions smoothly
            if (scrollMap.has('modal-body')) {
                const newBody = modal.querySelector('.mt5-modal-body');
                if (newBody) newBody.scrollTop = scrollMap.get('modal-body');
            }
            scrollMap.forEach((top, key) => {
                if (key.endsWith('-inner')) {
                    const parentId = key.replace('-inner', '');
                    const parent = modal.querySelector(`#${parentId}`);
                    if (parent) {
                        const sub = parent.querySelector('div[style*="overflow"]');
                        if (sub) sub.scrollTop = top;
                    }
                } else if (key !== 'modal-body') {
                    const el = modal.querySelector(`#${key}`);
                    if (el) el.scrollTop = top;
                }
            });
        }

        getFleetHtml(theme, accounts, activeAcc) {
            if (this.viewMode === 'delete_select') {
                return this.getDeleteBridgeSelectorHtml(theme);
            }
            if (this.viewMode === 'routing') {
                return this.getBridgeRoutingHtml(theme);
            }
            if (this.viewMode === 'details') {
                return this.getAccountDetailsHtml(theme, accounts, activeAcc);
            }
            if (this.viewMode === 'add') {
                const endpoints = window.MT5API ? window.MT5API.getEndpoints().filter(e => e.enabled) : [];
                const localVmEndpoints = endpoints.filter(ep => this.isLocalVmBridge(ep));
                const defaultTargetIds = this.preselectedBridgeId
                    ? [this.preselectedBridgeId]
                    : (localVmEndpoints.length > 0 
                        ? localVmEndpoints.map(ep => ep.id) 
                        : [window.MT5API?.activeEndpointId || endpoints[0]?.id]);
                this.preselectedBridgeId = null;

                return `
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 4px; border-bottom: 1px solid ${theme.border};">
                            <strong style="font-size: 12.5px; color: ${theme.text};">Connect New MT5 Account</strong>
                            <button id="mt5-btn-cancel-add" type="button" style="background: transparent; border: none; color: ${theme.primary}; font-size: 11px; cursor: pointer; font-weight: 600;">← Back to Fleet</button>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            <!-- Target Bridge Server Selection -->
                            <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 8px 10px; box-sizing: border-box;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; flex-wrap: wrap; gap: 4px;">
                                    <label style="font-size: 11px; font-weight: 700; color: ${theme.text};">
                                        🔗 Target Bridge Server(s) *
                                    </label>
                                    <span style="font-size: 9.5px; color: ${theme.textMuted};">Select bridge hosts where this account should connect</span>
                                </div>
                                ${endpoints.length === 0 ? `
                                    <div style="padding: 6px 10px; border-radius: 4px; background: rgba(242,54,69,0.1); border: 1px solid rgba(242,54,69,0.25); color: ${theme.error}; font-size: 11px;">
                                        ⚠️ No active bridge servers configured. Please add a bridge in Cloud Bridge Settings first.
                                    </div>
                                ` : `
                                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 6px;" id="mt5-target-bridges-list">
                                        ${endpoints.map((ep) => {
                                            const isOnline = ep.status === 'online';
                                            const isLocal = this.isLocalVmBridge(ep);
                                            const icon = isLocal ? '💻' : (ep.name.toLowerCase().includes('oracle') ? '☁️' : '⚡');
                                            const isChecked = defaultTargetIds.includes(ep.id);

                                            return `
                                                <label style="display: flex; align-items: center; justify-content: space-between; padding: 5px 8px; border-radius: 4px; background: ${theme.inputBg}; border: 1px solid ${isChecked ? 'rgba(41,98,255,0.4)' : theme.border}; cursor: pointer;">
                                                    <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                                                        <input type="checkbox" class="mt5-check-target-bridge" value="${ep.id}" ${isChecked ? 'checked' : ''} style="width: 13px; height: 13px; accent-color: ${theme.primary}; cursor: pointer; flex-shrink: 0;">
                                                        <span style="font-size: 13px; flex-shrink: 0;">${icon}</span>
                                                        <strong style="font-size: 11px; color: ${theme.text}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${ep.name}</strong>
                                                    </div>
                                                    <span style="font-size: 9px; font-weight: 600; padding: 1px 5px; border-radius: 3px; background: ${isOnline ? 'rgba(8,153,129,0.12)' : (ep.status === 'unauthorized' ? 'rgba(255,152,0,0.15)' : 'rgba(242,54,69,0.12)')}; color: ${isOnline ? theme.success : (ep.status === 'unauthorized' ? '#ff9800' : theme.error)};">
                                                        ${isOnline ? '🟢 Online' : (ep.status === 'unauthorized' ? '🔑 401 Key Invalid' : '🔴 Offline')}
                                                    </span>
                                                </label>
                                            `;
                                        }).join('')}
                                    </div>
                                `}
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%;">
                                <div>
                                    <label style="display: block; font-size: 10.5px; font-weight: 600; margin-bottom: 3px;">Account Nickname *</label>
                                    <input type="text" id="mt5-in-nickname" placeholder="e.g. The5ers High Stakes" style="width: 100%; box-sizing: border-box; padding: 5px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 11px;">
                                </div>
                                <div>
                                    <label style="display: block; font-size: 10.5px; font-weight: 600; margin-bottom: 3px;">Broker MT5 Server *</label>
                                    <input type="text" id="mt5-in-server" placeholder="e.g. TheFivePercenters-Live" style="width: 100%; box-sizing: border-box; padding: 5px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 11px;">
                                </div>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; width: 100%;">
                                <div>
                                    <label style="display: block; font-size: 10.5px; font-weight: 600; margin-bottom: 3px;">Login ID *</label>
                                    <input type="number" id="mt5-in-login" placeholder="1058492" style="width: 100%; box-sizing: border-box; padding: 5px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 11px;">
                                </div>
                                <div>
                                    <label style="display: block; font-size: 10.5px; font-weight: 600; margin-bottom: 3px;">Password *</label>
                                    <input type="password" id="mt5-in-password" placeholder="Password" style="width: 100%; box-sizing: border-box; padding: 5px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 11px;">
                                </div>
                                <div>
                                    <label style="display: block; font-size: 10.5px; font-weight: 600; margin-bottom: 3px;">Lot Multiplier</label>
                                    <input type="number" step="0.1" id="mt5-in-mult" value="1.0" placeholder="1.0" style="width: 100%; box-sizing: border-box; padding: 5px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 11px;">
                                </div>
                                <div>
                                    <label style="display: block; font-size: 10.5px; font-weight: 600; margin-bottom: 3px;">Risk Sizing %</label>
                                    <input type="number" step="0.1" id="mt5-in-risk" value="1.0" placeholder="1.0" style="width: 100%; box-sizing: border-box; padding: 5px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 11px;">
                                </div>
                            </div>
                            <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px;">
                                <button id="mt5-btn-save-acc" type="button" style="background: ${theme.primary}; color: #fff; border: none; padding: 6px 14px; border-radius: 4px; font-weight: 600; font-size: 11px; cursor: pointer;">
                                    Connect & Save Account
                                </button>
                            </div>

                            <!-- Dedicated Real-Time Provisioning & Connection Card -->
                            <div id="mt5-add-progress-box" style="display: none; margin-top: 6px; background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 12px; box-sizing: border-box;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <span id="mt5-add-progress-spinner" style="display: inline-block; width: 14px; height: 14px; border: 2px solid ${theme.primary}; border-top-color: transparent; border-radius: 50%; animation: mt5spin 0.8s linear infinite;"></span>
                                        <strong style="font-size: 11.5px; color: ${theme.text};" id="mt5-add-progress-title">Connecting to Bridge Host...</strong>
                                    </div>
                                    <span id="mt5-add-progress-timer" style="font-family: monospace; font-size: 10.5px; font-weight: 700; color: ${theme.primary}; background: rgba(41,98,255,0.1); padding: 2px 7px; border-radius: 4px; border: 1px solid rgba(41,98,255,0.2);">⏱️ 00:00s</span>
                                </div>
                                <div style="width: 100%; height: 5px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; margin-bottom: 10px;">
                                    <div id="mt5-add-progress-bar" style="height: 100%; width: 10%; background: linear-gradient(90deg, #2962ff, #00b0ff); transition: width 0.35s ease; border-radius: 3px;"></div>
                                </div>
                                <div id="mt5-add-steps-list" style="display: flex; flex-direction: column; gap: 6px; font-size: 11px;">
                                    <div id="mt5-add-step-1" style="display: flex; align-items: center; gap: 8px; color: ${theme.textMuted}; transition: color 0.2s;">
                                        <span class="step-icon">🔒</span> <span class="step-label">Encrypt credentials with E2E AES-256-GCM</span>
                                    </div>
                                    <div id="mt5-add-step-2" style="display: flex; align-items: center; gap: 8px; color: ${theme.textMuted}; transition: color 0.2s;">
                                        <span class="step-icon">📡</span> <span class="step-label">Dispatch account payload to target bridge host(s)</span>
                                    </div>
                                    <div id="mt5-add-step-3" style="display: flex; align-items: center; gap: 8px; color: ${theme.textMuted}; transition: color 0.2s;">
                                        <span class="step-icon">📂</span> <span class="step-label">Provision isolated 1:1 MT5 instance directory</span>
                                    </div>
                                    <div id="mt5-add-step-4" style="display: flex; align-items: center; gap: 8px; color: ${theme.textMuted}; transition: color 0.2s;">
                                        <span class="step-icon">🚀</span> <span class="step-label">Launch MT5 terminal & establish broker handshake</span>
                                    </div>
                                    <div id="mt5-add-step-5" style="display: flex; align-items: center; gap: 8px; color: ${theme.textMuted}; transition: color 0.2s;">
                                        <span class="step-icon">💾</span> <span class="step-label">Sync catalog & store in secure client vault</span>
                                    </div>
                                </div>
                                <div id="mt5-add-error-container" style="display: none; margin-top: 10px;"></div>
                            </div>
                        </div>
                    </div>
                `;
            }

            const vault = window.MT5API ? window.MT5API.getClientVault() : [];
            const allEndpoints = window.MT5API ? window.MT5API.getEndpoints() : [];

            // Group all accounts by physical login::server
            const accountsByPhysicalKey = new Map();
            accounts.forEach(acc => {
                const key = `${String(acc.login || '').trim()}::${String(acc.server || '').trim().toLowerCase()}`;
                if (!accountsByPhysicalKey.has(key)) {
                    accountsByPhysicalKey.set(key, []);
                }
                accountsByPhysicalKey.get(key).push(acc);
            });

            // Build unified deduplicated accounts selecting the healthiest representative with real broker metrics
            const dedupedAccounts = Array.from(accountsByPhysicalKey.entries()).map(([key, instances]) => {
                const connectedInstances = instances.filter(i => i.is_connected);
                const instancesWithBal = instances.filter(i => Number(i.balance || 0) > 0);
                const activeInstance = activeAcc ? instances.find(i => i.id === activeAcc.id) : null;

                // Representative instance: prefer active account, or connected instance with balance > 0, then any with balance > 0, then connected, then first
                const primary = activeInstance || 
                                connectedInstances.find(i => Number(i.balance || 0) > 0) ||
                                instancesWithBal[0] ||
                                connectedInstances[0] ||
                                instances[0];

                const bestBal = Math.max(...instances.map(i => Number(i.balance || 0)));
                const bestEq = Math.max(...instances.map(i => Number(i.equity || 0)));
                const anyConnected = instances.some(i => i.is_connected);

                const targetLogin = String(primary.login).trim();
                const isMatch = (s1, s2) => window.MT5API?.isServerMatch ? window.MT5API.isServerMatch(s1, s2) : String(s1 || '').trim().toLowerCase() === String(s2 || '').trim().toLowerCase();
                const vaultEntry = vault.find(v => String(v.login).trim() === targetLogin && isMatch(v.server, primary.server));

                // If the account is connected on the broker, any previous local vault rejection is stale
                if (anyConnected && vaultEntry && vaultEntry.verification_failed) {
                    vaultEntry.verification_failed = false;
                    vaultEntry.last_error = null;
                    vaultEntry.is_verified = true;
                    try {
                        localStorage.setItem('mt5_client_vault', JSON.stringify(vault));
                    } catch (_) {}
                }

                const hasLocalVault = Boolean(vaultEntry && vaultEntry.password);
                const isVaultRejected = !anyConnected && (Boolean(vaultEntry && vaultEntry.verification_failed) || Boolean(primary.is_verification_failed));
                const isVaultVerified = Boolean(vaultEntry && vaultEntry.is_verified !== false && !vaultEntry.staged_offline && !isVaultRejected);
                const isVaultStaged = Boolean(vaultEntry && (vaultEntry.staged_offline || vaultEntry.is_verified === false) && !isVaultRejected);
                const hasBridgeDpapi = Boolean(
                    primary.has_dpapi ||
                    primary.auth_mode === 'dpapi_vaulted' ||
                    instances.some(i => i.has_dpapi || i.auth_mode === 'dpapi_vaulted')
                );
                const hasBridgeNative = Boolean(
                    primary.has_native_vault ||
                    primary.auth_mode === 'mt5_native_vault' ||
                    instances.some(i => i.has_native_vault || i.auth_mode === 'mt5_native_vault')
                );
                const hasBridgeVault = Boolean(hasBridgeDpapi || (hasBridgeNative && anyConnected));
                const survivesReboot = Boolean(hasBridgeDpapi || (hasBridgeNative && anyConnected));
                const isVerified = Boolean(anyConnected);

                let vaultMode = 'session_only';
                let vaultLabel = 'Session Only';
                if (isVaultRejected) {
                    vaultMode = 'local_rejected';
                    vaultLabel = '❌ Pwd Rejected by Broker';
                } else if (hasLocalVault && hasBridgeVault) {
                    if (isVaultStaged) {
                        vaultMode = 'dual_vaulted_staged';
                        vaultLabel = '🔒 Dual (⚠️ Local Staged)';
                    } else {
                        vaultMode = 'dual_vaulted';
                        vaultLabel = isVerified ? '🔒 Dual Vaulted ✓' : '🔒 Dual Vaulted';
                    }
                } else if (!hasLocalVault && hasBridgeDpapi) {
                    vaultMode = 'bridge_secured';
                    vaultLabel = isVerified ? '☁️ Bridge Secured ✓' : '☁️ Bridge Secured';
                } else if (!hasLocalVault && hasBridgeNative && anyConnected) {
                    vaultMode = 'mt5_native_vault';
                    vaultLabel = '🖥️ MT5 Saved ✓';
                } else if (hasLocalVault && !hasBridgeVault) {
                    if (isVaultStaged) {
                        vaultMode = 'local_staged_offline';
                        vaultLabel = '⚠️ Staged Offline (Unverified)';
                    } else {
                        vaultMode = 'local_vaulted';
                        vaultLabel = isVerified ? '💻 Local Vaulted ✓' : '💻 Local Vaulted';
                    }
                } else if (!anyConnected && !hasLocalVault && !hasBridgeDpapi) {
                    vaultMode = 'awaiting_credentials';
                    vaultLabel = '🔑 Needs Password';
                } else {
                    vaultMode = 'session_only';
                    vaultLabel = isVerified ? '⚠️ Volatile Session ✓' : '⚠️ Session Only';
                }

                return {
                    ...primary,
                    balance: bestBal > 0 ? bestBal : primary.balance,
                    equity: bestEq > 0 ? bestEq : primary.equity,
                    is_connected: anyConnected,
                    is_verified: isVerified,
                    has_local_vault: hasLocalVault,
                    is_local_vault_verified: isVaultVerified,
                    is_staged_offline: isVaultStaged,
                    is_verification_failed: isVaultRejected,
                    last_error: isVaultRejected ? (vaultEntry?.last_error || primary.last_error || 'Broker rejected credentials') : primary.last_error,
                    has_bridge_vault: hasBridgeVault,
                    has_password: Boolean(hasLocalVault || hasBridgeVault),
                    vault_mode: vaultMode,
                    vault_label: vaultLabel,
                    auth_mode: vaultMode,
                    auth_label: vaultLabel
                };
            });

            const totalBalance = dedupedAccounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
            const totalEquity = dedupedAccounts.reduce((sum, a) => sum + (Number(a.equity) || 0), 0);
            const floatingTotal = totalEquity - totalBalance;
            const selectedCount = dedupedAccounts.filter(a => window.MT5API && window.MT5API.multiAccountSelection.has(a.id) && !window.MT5API.isAccountPaused(a.id)).length;

            const cards = dedupedAccounts.map(acc => {
                const isActive = activeAcc && activeAcc.id === acc.id;
                const isPaused = window.MT5API ? window.MT5API.isAccountPaused(acc.id) : false;
                const isChecked = window.MT5API && window.MT5API.multiAccountSelection.has(acc.id) && !isPaused;

                let cardBorder = isActive ? 'rgba(41,98,255,0.5)' : (isPaused ? 'rgba(255,165,0,0.3)' : theme.border);
                const hostEp = allEndpoints.find(e => e.id === acc.endpointId) || { name: acc.endpointName, url: acc.endpointUrl };
                const isLocalHost = this.isLocalVmBridge(hostEp);
                const epIcon = isLocalHost ? '💻' : ((acc.endpointName || '').toLowerCase().includes('oracle') ? '☁️' : '⚡');

                const activeInstances = accounts.filter(a => String(a.login) === String(acc.login) && (a.server || '').toLowerCase() === (acc.server || '').toLowerCase());
                const activeEpIds = new Set(activeInstances.map(a => a.endpointId));

                // Bridge routing badges for this account: union of active instances and client vault configuration
                const vaultEntry = vault.find(v => String(v.login) === String(acc.login) && (v.server || '').toLowerCase() === (acc.server || '').toLowerCase());
                const combinedEpIds = new Set([
                    ...activeEpIds,
                    ...(vaultEntry && Array.isArray(vaultEntry.targetEndpoints) && vaultEntry.targetEndpoints.length > 0
                        ? vaultEntry.targetEndpoints
                        : (vaultEntry && vaultEntry.endpointId ? [vaultEntry.endpointId] : []))
                ]);
                const allowedEpIds = Array.from(combinedEpIds.size > 0 ? combinedEpIds : [acc.endpointId]);

                const routedEp = window.MT5API?.getEndpointForAccount(acc.id) || hostEp;
                const isMultiHost = activeInstances.length > 1;
                const multiHostBadge = isMultiHost ? `
                    <span style="font-size: 8.5px; padding: 1px 5px; border-radius: 3px; background: rgba(147, 51, 234, 0.12); color: #a855f7; border: 1px solid rgba(147, 51, 234, 0.3); font-weight: 700; display: inline-flex; align-items: center; gap: 2px;" title="Redundant Multi-Bridge HA: Hosted across ${activeInstances.length} bridge servers with automatic transparent failover">
                        🛡️ Multi-Bridge HA (${activeInstances.length} Hosts)
                    </span>
                ` : '';

                const allowedBridgeBadges = allowedEpIds.map(epId => {
                    const ep = allEndpoints.find(e => e.id === epId);
                    if (!ep) return '';
                    const isConn = activeEpIds.has(ep.id);
                    const isOnline = ep.status === 'online';
                    const isLocal = this.isLocalVmBridge(ep);
                    const bIcon = isLocal ? '💻' : (ep.name.toLowerCase().includes('oracle') ? '☁️' : '⚡');
                    const isRouted = routedEp && routedEp.id === ep.id;

                    const badgeColor = isConn && isOnline ? theme.success : (isOnline ? theme.primary : theme.error);
                    const badgeBg = isRouted ? (theme.isDark ? 'rgba(41,98,255,0.22)' : 'rgba(41,98,255,0.12)') : (isConn && isOnline ? theme.successSoft : (isOnline ? theme.primarySoft : theme.errorSoft));
                    const badgeBorder = isRouted ? theme.primary : (isConn && isOnline ? theme.successBorder : (isOnline ? theme.primaryBorder : theme.errorBorder));

                    return `<span style="font-size: 9.5px; padding: 1px 5px; border-radius: 3px; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; font-weight: 600; display: inline-flex; align-items: center; gap: 3px; ${isRouted ? 'box-shadow: 0 0 4px rgba(41,98,255,0.3);' : ''}" title="${ep.name}: ${isRouted ? '⚡ Active Execution Route • ' : ''}${isConn && isOnline ? 'Connected' : (isOnline ? 'Standby' : 'Offline')}">
                        ${isRouted ? '⚡' : bIcon} ${ep.name} (${isConn && isOnline ? '🟢' : (isOnline ? '⚪' : '🔴')})
                    </span>`;
                }).filter(Boolean).join('');

                const hostBridgeNames = activeInstances.map(i => i.endpointName || 'Bridge').filter(Boolean).join(', ');
                const pnl = (Number(acc.equity || 0) - Number(acc.balance || 0));

                return `
                    <div class="mt5-account-card" data-id="${acc.id}" data-login="${acc.login}" style="
                        background: ${theme.cardBg};
                        border: 1px solid ${cardBorder};
                        border-radius: 6px;
                        padding: 6px 10px;
                        display: flex;
                        flex-direction: column;
                        gap: 4px;
                        opacity: ${isPaused ? '0.85' : '1'};
                        transition: border 0.15s ease;
                    ">
                        <!-- Row 1: Checkbox, Identity & Action Buttons -->
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap;">
                            <div style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 240px;">
                                <input type="checkbox" class="mt5-check-multi" data-id="${acc.id}" data-login="${acc.login}" ${isChecked ? 'checked' : ''} ${isPaused ? 'disabled' : ''} title="${isPaused ? 'Account paused' : 'Select for multi-copying'}" style="cursor: ${isPaused ? 'not-allowed' : 'pointer'}; width: 14px; height: 14px; accent-color: ${theme.primary}; flex-shrink: 0;">
                                <span class="mt5-card-status-dot" data-id="${acc.id}" data-login="${acc.login}" style="font-size: 10px;" title="${isPaused ? 'Paused' : (acc.is_connected ? 'Connected' : (acc.is_verification_failed ? 'Verification Failed' : 'Needs Password / Connecting'))}">${isPaused ? '⚪' : (acc.is_connected ? '🟢' : (acc.is_verification_failed ? '🔴' : '🟡'))}</span>
                                <span class="mt5-link-details" data-id="${acc.id}" data-login="${acc.login}" style="cursor: pointer; font-weight: 700; font-size: 12px; color: ${theme.text}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="Click for full details">${acc.nickname}</span>
                                ${isActive ? `<span style="font-size: 8.5px; padding: 1px 5px; border-radius: 3px; background: ${theme.primary}; color: #fff; font-weight: 700;">FEED</span>` : ''}
                                ${isPaused ? `<span style="font-size: 8.5px; padding: 1px 5px; border-radius: 3px; background: ${theme.warningSoft}; color: ${theme.warning}; font-weight: 700;">PAUSED</span>` : ''}
                                ${multiHostBadge}
                                ${(() => {
                                    if (!acc.is_connected && (acc.vault_mode === 'local_rejected' || acc.is_verification_failed)) {
                                        return `<span style="font-size: 8.5px; padding: 1px 6px; border-radius: 3px; background: rgba(244, 67, 54, 0.15); color: #f44336; border: 1px solid rgba(244, 67, 54, 0.4); font-weight: 700; display: inline-flex; align-items: center; gap: 2px;" title="${acc.last_error || 'Broker rejected staged password. Click Details to update.'}">❌ Pwd Rejected by Broker</span>`;
                                    } else if (acc.vault_mode === 'awaiting_credentials' || (!acc.is_connected && !acc.has_dpapi && !acc.has_local_vault)) {
                                        return `<span style="font-size: 8.5px; padding: 1px 6px; border-radius: 3px; background: rgba(255, 152, 0, 0.15); color: #ff9800; border: 1px solid rgba(255, 152, 0, 0.4); font-weight: 700; display: inline-flex; align-items: center; gap: 2px;" title="Awaiting Password: No valid password stored. Click Details to enter password and connect.">🔑 Needs Password</span>`;
                                    } else if (acc.vault_mode === 'dual_vaulted_staged') {
                                        return `<span style="font-size: 8.5px; padding: 1px 6px; border-radius: 3px; background: rgba(255, 152, 0, 0.12); color: #ff9800; border: 1px solid rgba(255, 152, 0, 0.3); font-weight: 700; display: inline-flex; align-items: center; gap: 2px;" title="Dual Vault: Bridge secured, but local vault password is staged offline and awaiting broker verification.">🔒 Dual (⚠️ Local Staged)</span>`;
                                    } else if (acc.vault_mode === 'dual_vaulted') {
                                        return `<span style="font-size: 8.5px; padding: 1px 6px; border-radius: 3px; background: rgba(8, 153, 129, 0.12); color: #089981; border: 1px solid rgba(8, 153, 129, 0.3); font-weight: 700; display: inline-flex; align-items: center; gap: 2px;" title="Dual Vaulted: Credentials saved on bridge (${acc.has_dpapi ? 'DPAPI' : 'MT5 Native'}, survives reboot) & backed up in browser vault.${acc.is_verified ? ' Live broker handshake verified.' : ' Awaiting broker handshake.'}">🔒 Dual Vaulted ${acc.is_verified ? '✓' : ''}</span>`;
                                    } else if (acc.vault_mode === 'bridge_secured') {
                                        return `<span style="font-size: 8.5px; padding: 1px 6px; border-radius: 3px; background: rgba(0, 188, 212, 0.12); color: #00bcd4; border: 1px solid rgba(0, 188, 212, 0.3); font-weight: 700; display: inline-flex; align-items: center; gap: 2px;" title="Bridge Secured: Hardware DPAPI encrypted in accounts.json on server (survives reboot). Not backed up in browser vault.${acc.is_verified ? ' Live broker handshake verified.' : ' Awaiting broker handshake.'}">☁️ Bridge Secured ${acc.is_verified ? '✓' : ''}</span>`;
                                    } else if (acc.vault_mode === 'mt5_native_vault') {
                                        return `<span style="font-size: 8.5px; padding: 1px 6px; border-radius: 3px; background: rgba(0, 188, 212, 0.12); color: #00bcd4; border: 1px solid rgba(0, 188, 212, 0.3); font-weight: 700; display: inline-flex; align-items: center; gap: 2px;" title="MT5 Native Vault: Password stored in MT5 terminal's encrypted vault (accounts.dat) on server (survives reboot). Not backed up in browser vault.${acc.is_verified ? ' Live broker handshake verified.' : ' Awaiting broker handshake.'}">🖥️ MT5 Saved ${acc.is_verified ? '✓' : ''}</span>`;
                                    } else if (acc.vault_mode === 'local_staged_offline') {
                                        return `<span style="font-size: 8.5px; padding: 1px 6px; border-radius: 3px; background: rgba(255, 152, 0, 0.12); color: #ff9800; border: 1px solid rgba(255, 152, 0, 0.3); font-weight: 700; display: inline-flex; align-items: center; gap: 2px;" title="Staged Offline: Saved in encrypted browser vault without bridge verification. Will auto-verify with broker once bridge connects.">⚠️ Staged Offline (Unverified)</span>`;
                                    } else if (acc.vault_mode === 'local_vaulted') {
                                        return `<span style="font-size: 8.5px; padding: 1px 6px; border-radius: 3px; background: rgba(41, 98, 255, 0.12); color: #2962ff; border: 1px solid rgba(41, 98, 255, 0.3); font-weight: 700; display: inline-flex; align-items: center; gap: 2px;" title="Local Vaulted: Saved in browser vault. Running as live session on bridge.${acc.is_verified ? ' Live broker handshake verified.' : ' Awaiting broker handshake.'}">💻 Local Vaulted ${acc.is_verified ? '✓' : ''}</span>`;
                                    } else {
                                        return `<span style="font-size: 8.5px; padding: 1px 6px; border-radius: 3px; background: rgba(255, 152, 0, 0.12); color: #ff9800; border: 1px solid rgba(255, 152, 0, 0.3); font-weight: 700; display: inline-flex; align-items: center; gap: 2px;" title="Volatile Session: No password stored on bridge disk or browser vault. Will lose connection on terminal restart or server reboot.">⚠️ Session Only</span>`;
                                    }
                                })()}
                                <span style="font-size: 10px; color: ${theme.textMuted}; font-family: monospace;">#${acc.login} • ${acc.server}</span>
                            </div>

                            <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap; flex-shrink: 0;">
                                ${!isActive ? `<button class="mt5-btn-set-active" data-id="${acc.id}" style="background: ${theme.primarySoft}; color: ${theme.primary}; border: 1px solid ${theme.primaryBorder}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;" title="Show this account on chart">⚡ Feed</button>` : ''}
                                <button class="mt5-btn-config-bridges mt5-ghost-btn" data-login="${acc.login}" data-server="${acc.server}" data-id="${acc.id}" style="padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;" title="Configure bridges">🔗 Bridges (${allowedEpIds.length})</button>
                                ${isPaused
                                    ? `<button class="mt5-btn-resume-acc" data-id="${acc.id}" style="background: ${theme.successSoft}; color: ${theme.success}; border: 1px solid ${theme.successBorder}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;">▶️ Resume</button>`
                                    : `<button class="mt5-btn-pause-acc" data-id="${acc.id}" style="background: ${theme.warningSoft}; color: ${theme.warning}; border: 1px solid ${theme.warningBorder}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;">⏸️ Pause</button>`
                                }
                                <button class="mt5-btn-view-details mt5-ghost-btn" data-id="${acc.id}" style="padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;" title="View financial details">📋 Details</button>
                                <button class="mt5-btn-delete-acc" data-id="${acc.id}" style="background: transparent; color: ${theme.error}; border: 1px solid ${theme.errorBorder}; padding: 2px 5px; border-radius: 4px; font-size: 10px; cursor: pointer;" title="Delete account across all bridges">✕</button>
                            </div>
                        </div>

                        <!-- Row 2: Financial Stats & Allowed Routing (Inline Dense) -->
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 10.5px; padding-top: 3px; border-top: 1px solid rgba(120,120,120,0.1);">
                            <div style="display: flex; align-items: center; gap: 8px; font-family: monospace;">
                                <span>Bal: <strong class="mt5-card-bal" data-id="${acc.id}" data-login="${acc.login}" style="color: ${theme.text};">$${Number(acc.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong></span>
                                <span>Eq: <strong class="mt5-card-eq" data-id="${acc.id}" data-login="${acc.login}" style="color: ${pnl >= 0 ? theme.success : theme.error};">$${Number(acc.equity || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong></span>
                                <span class="mt5-card-pnl" data-id="${acc.id}" data-login="${acc.login}" style="color: ${pnl >= 0 ? theme.success : theme.error}; font-weight: 600;">
                                    ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}
                                </span>
                                <span style="color: ${theme.textMuted}; font-size: 9.5px;">Route: <strong style="color: ${theme.primary};">⚡ ${routedEp?.name || acc.endpointName || 'Bridge'}</strong></span>
                            </div>

                            <div style="display: flex; align-items: center; gap: 3px; font-size: 9.5px;">
                                ${allowedBridgeBadges || `<span style="color: ${theme.textMuted};">${acc.endpointName || 'Bridge Server'}</span>`}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <!-- Compact Summary & Control Bar -->
                    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin-bottom: 2px;">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <strong style="font-size: 12px; color: ${theme.text};">Fleet Accounts (${dedupedAccounts.length})</strong>
                            <span style="font-size: 10.5px; color: ${theme.textMuted}; font-family: monospace;">
                                Bal: <strong id="mt5-fleet-total-bal" style="color: ${theme.text};">$${totalBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong> • 
                                Eq: <strong id="mt5-fleet-total-eq" style="color: ${totalEquity >= totalBalance ? theme.success : theme.error};">$${totalEquity.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong>
                                <span id="mt5-fleet-total-pnl-wrap" style="${Math.abs(floatingTotal) >= 0.01 ? '' : 'display:none;'}"> • <span id="mt5-fleet-total-pnl" style="color: ${floatingTotal >= 0 ? theme.success : theme.error}; font-weight: 700;">${floatingTotal >= 0 ? '+' : ''}$${floatingTotal.toFixed(2)}</span></span>
                            </span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <button id="mt5-btn-fleet-sync" type="button" style="background: ${theme.inputBg}; color: ${theme.primary}; border: 1px solid ${theme.border}; padding: 3px 8px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" title="Refresh & sync all bridges and accounts immediately">
                                <span>🔄</span> Sync Fleet
                            </button>
                            <button id="mt5-btn-toggle-select-all" type="button" style="background: ${theme.inputBg}; color: ${theme.text}; border: 1px solid ${theme.border}; padding: 3px 8px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer;" title="Toggle multi-account copy selection">
                                ☑️ Multi-Select (${selectedCount})
                            </button>
                            <button id="mt5-btn-add-account-view" type="button" style="background: ${theme.primary}; color: #fff; border: none; padding: 3px 9px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;">
                                <span>➕</span> Add Account
                            </button>
                        </div>
                    </div>

                    ${accounts.length === 0 ? `
                        <div style="text-align: center; padding: 24px; background: ${theme.cardBg}; border: 1px dashed ${theme.border}; border-radius: 6px;">
                            <div style="font-size: 20px; margin-bottom: 4px;">💼</div>
                            <div style="font-weight: 600; font-size: 12px; color: ${theme.text};">No MT5 Accounts Added Yet</div>
                            <div style="font-size: 10.5px; color: ${theme.textMuted}; margin-top: 2px;">Connect your broker or prop firm account to start.</div>
                        </div>
                    ` : cards}
                </div>
            `;
        }

        morphGistId(id) {
            if (!id || typeof id !== 'string') return '';
            const clean = id.trim();
            if (clean.length <= 8) return '••••' + clean.slice(-4);
            return clean.slice(0, 4) + '••••••••••••' + clean.slice(-4);
        }

        parseBridgeCredentialsText(rawText) {
            if (!rawText || typeof rawText !== 'string') return {};
            let text = rawText.trim()
                .replace(/https?\s*:\s*\/\s*\//gi, (m) => m.toLowerCase().startsWith('https') ? 'https://' : 'http://')
                .replace(/(https?:\/\/)\s+/gi, '$1')
                .replace(/(\w+)\s*\.\s*(trycloudflare|com|net|io|org|app)\b/gi, '$1.$2')
                .replace(/\s*\/\s*(gw_[a-f0-9_]+)/gi, '/$1')
                .replace(/\b(gw_)\s*([a-f0-9_]+)\b/gi, '$1$2');
            const extracted = {};

            // 1. JSON parse attempt
            if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
                try {
                    const parsed = JSON.parse(text);
                    if (parsed && typeof parsed === 'object') {
                        if (parsed.url || parsed.endpoint) extracted.url = String(parsed.url || parsed.endpoint).trim();
                        if (parsed.apiKey || parsed.api_key || parsed.key || parsed.secret) {
                            extracted.apiKey = String(parsed.apiKey || parsed.api_key || parsed.key || parsed.secret).trim();
                        }
                        if (parsed.shieldToken || parsed.shield_token || parsed.shield) {
                            extracted.shieldToken = String(parsed.shieldToken || parsed.shield_token || parsed.shield).trim();
                        }
                        if (parsed.gistId || parsed.gist_id) extracted.gistId = String(parsed.gistId || parsed.gist_id).trim();
                        if (parsed.gistToken || parsed.gist_token || parsed.token) {
                            extracted.gistToken = String(parsed.gistToken || parsed.gist_token || parsed.token).trim();
                        }
                        if (parsed.name) extracted.name = String(parsed.name).trim();
                        return extracted;
                    }
                } catch (_) {}
            }

            // 2. URL parsing (labeled or standalone)
            const labeledUrlMatch = text.match(/(?:ZERO-TRUST CLOAKED ENDPOINT URL|Cloaked Endpoint URL|Endpoint URL|Cloudflare Secure Tunnel URL|URL)[^\n:]*:\s*([^\s\n]+)/i);
            if (labeledUrlMatch && labeledUrlMatch[1].startsWith('http')) {
                extracted.url = labeledUrlMatch[1].trim().replace(/\/+$/, '');
            } else {
                const anyUrlMatch = text.match(/https?:\/\/[a-zA-Z0-9-._]+(?:\.[a-zA-Z0-9-._]+)*(?::\d+)?(?:\/[a-zA-Z0-9_.-]+)*/i);
                if (anyUrlMatch) {
                    extracted.url = anyUrlMatch[0].trim().replace(/\/+$/, '');
                }
            }

            // 3. Shield Token (explicit or standalone)
            const labeledShieldMatch = text.match(/(?:Zero-Trust Shield Gateway Token|Shield Gateway Token|Shield Token|Shield)[^\n:]*:\s*([a-zA-Z0-9_-]+)/i);
            if (labeledShieldMatch && labeledShieldMatch[1]) {
                extracted.shieldToken = labeledShieldMatch[1].trim();
            } else {
                const standaloneShieldMatch = text.match(/\b(gw_[a-zA-Z0-9_-]{16,64})\b/i);
                if (standaloneShieldMatch) {
                    extracted.shieldToken = standaloneShieldMatch[1].trim();
                } else if (extracted.url) {
                    try {
                        const parsedUrl = new URL(extracted.url);
                        const pathPart = parsedUrl.pathname.replace(/^\/+|\/+$/g, '');
                        if (pathPart && !pathPart.includes('/')) {
                            extracted.shieldToken = pathPart;
                        }
                    } catch (_) {}
                }
            }

            // Cross-reference & heal Cloaked URL using Base Cloudflare Tunnel URL and Shield Token
            const baseTunnelMatch = text.match(/(?:Base Cloudflare Tunnel URL|Base Tunnel URL)[^\n:]*:\s*(https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com)/i);
            if (baseTunnelMatch && extracted.shieldToken) {
                extracted.url = `${baseTunnelMatch[1].trim()}/${extracted.shieldToken}`;
            } else if (extracted.url && extracted.shieldToken) {
                try {
                    const parsed = new URL(extracted.url);
                    if (parsed.pathname.startsWith('/gw_') && parsed.pathname.substring(1) !== extracted.shieldToken) {
                        extracted.url = `${parsed.origin}/${extracted.shieldToken}`;
                    }
                } catch (_) {}
            }

            // 4. Bridge API Key
            const labeledKeyMatch = text.match(/(?:Bridge API Key|API Key|Bearer API Secret Key|Secret)[^\n:]*:\s*([a-zA-Z0-9_-]+)/i);
            if (labeledKeyMatch && labeledKeyMatch[1]) {
                const candKey = labeledKeyMatch[1].trim();
                if (candKey !== extracted.shieldToken && candKey !== extracted.gistId) {
                    extracted.apiKey = candKey;
                }
            } else {
                const standaloneKeyMatch = text.match(/\b(mor[a-zA-Z0-9_-]{20,}|mt5_secret_[a-zA-Z0-9_-]+)\b/);
                if (standaloneKeyMatch) {
                    extracted.apiKey = standaloneKeyMatch[1].trim();
                }
            }

            // 5. Gist ID (32 hex characters with OCR typo healing)
            const healHex = (str) => {
                if (!str) return '';
                return str.replace(/[^a-zA-Z0-9]/g, '')
                          .replace(/o/gi, '0')
                          .replace(/[lI|]/g, '1')
                          .replace(/s/gi, '5')
                          .replace(/z/gi, '2')
                          .toLowerCase();
            };

            const labeledGistMatch = text.match(/(?:Private GitHub Gist Rendezvous ID|Gist Rendezvous ID|Gist ID|Gist|Rendezvous)[^\n:]*:\s*([a-zA-Z0-9\s_.-]{20,50})/i);
            if (labeledGistMatch && labeledGistMatch[1]) {
                const candGist = healHex(labeledGistMatch[1]);
                const hex32 = candGist.match(/[a-f0-9]{32}/);
                if (hex32) {
                    extracted.gistId = hex32[0];
                }
            }
            if (!extracted.gistId) {
                // Check lines after any mention of "Gist" or "Rendezvous"
                const lines = text.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    const lineLower = lines[i].toLowerCase();
                    if (lineLower.includes('gist') || lineLower.includes('rendezvous')) {
                        for (let j = i; j <= Math.min(i + 3, lines.length - 1); j++) {
                            const healedLine = healHex(lines[j]);
                            const hexMatch = healedLine.match(/[a-f0-9]{32}/);
                            const shieldClean = (extracted.shieldToken || '').replace(/^gw_/, '').toLowerCase();
                            if (hexMatch && hexMatch[0] !== shieldClean && hexMatch[0] !== (extracted.apiKey || '').toLowerCase()) {
                                extracted.gistId = hexMatch[0];
                                break;
                            }
                        }
                        if (extracted.gistId) break;
                    }
                }
            }
            if (!extracted.gistId) {
                const standaloneGistMatches = text.match(/\b([a-f0-9]{32})\b/gi);
                if (standaloneGistMatches) {
                    for (const m of standaloneGistMatches) {
                        const cand = m.toLowerCase();
                        const shieldClean = (extracted.shieldToken || '').replace(/^gw_/, '').toLowerCase();
                        if (cand !== shieldClean && cand !== (extracted.apiKey || '').toLowerCase()) {
                            extracted.gistId = cand;
                            break;
                        }
                    }
                }
            }

            // 6. GitHub PAT Token (ghp_... or github_pat_...)
            const patMatch = text.match(/\b(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82})\b/);
            if (patMatch) {
                extracted.gistToken = patMatch[1].trim();
            }

            // 7. Server / Host Name
            const labeledNameMatch = text.match(/(?:Server \/ Fleet Bridge Name|Fleet Bridge Name|Server Name|Bridge Name)[^\n:]*:\s*([^\n\r]+)/i);
            if (labeledNameMatch && labeledNameMatch[1]) {
                const candName = labeledNameMatch[1].trim();
                if (candName && !candName.toLowerCase().includes('not configured')) {
                    extracted.name = candName;
                }
            }
            if (!extracted.name) {
                if (text.includes('Oracle') || (extracted.url && extracted.url.includes('trycloudflare'))) {
                    extracted.name = 'Oracle Cloud VPS';
                } else if (text.includes('VMware') || (extracted.url && extracted.url.includes('192.168'))) {
                    extracted.name = 'VMware VM';
                }
            }

            return extracted;
        }

        applySmartExtractedFields(modal, extracted) {
            if (!modal || !extracted || Object.keys(extracted).length === 0) return [];
            const updatedFields = [];

            const highlightField = (elem) => {
                if (!elem) return;
                elem.style.transition = 'box-shadow 0.3s, border-color 0.3s';
                elem.style.borderColor = '#00c853';
                elem.style.boxShadow = '0 0 8px rgba(0, 200, 83, 0.4)';
                setTimeout(() => {
                    elem.style.borderColor = '';
                    elem.style.boxShadow = '';
                }, 1800);
            };

            if (extracted.url) {
                const inUrl = modal.querySelector('#mt5-in-new-url');
                if (inUrl) {
                    inUrl.value = extracted.url;
                    highlightField(inUrl);
                    updatedFields.push('Endpoint URL');
                }
            }

            if (extracted.apiKey) {
                const inKey = modal.querySelector('#mt5-in-new-key');
                if (inKey) {
                    inKey.value = extracted.apiKey;
                    highlightField(inKey);
                    updatedFields.push('API Key');
                }
            }

            if (extracted.shieldToken) {
                const inShield = modal.querySelector('#mt5-in-new-shield-token');
                if (inShield) {
                    inShield.value = extracted.shieldToken;
                    highlightField(inShield);
                    updatedFields.push('Shield Token');
                }
            }

            if (extracted.gistId) {
                const inGist = modal.querySelector('#mt5-in-new-gist-id');
                if (inGist) {
                    inGist.value = extracted.gistId;
                    highlightField(inGist);
                    updatedFields.push('Gist ID');
                }
            }

            if (extracted.gistToken) {
                const inToken = modal.querySelector('#mt5-in-new-gist-token');
                if (inToken) {
                    inToken.value = extracted.gistToken;
                    highlightField(inToken);
                    updatedFields.push('GitHub PAT');
                }
            }

            if (extracted.name) {
                const inName = modal.querySelector('#mt5-in-new-name');
                if (inName && (!inName.value || inName.value.startsWith('Bridge Server') || inName.value.startsWith('Cloud Bridge'))) {
                    inName.value = extracted.name;
                    highlightField(inName);
                }
            }

            // Also synchronize directly into active/saved endpoint in window.MT5API in real time
            if (window.MT5API && Array.isArray(window.MT5API.endpoints) && window.MT5API.endpoints.length > 0) {
                let targetEp = null;
                if (this.editingEndpointId) {
                    targetEp = window.MT5API.endpoints.find(e => e.id === this.editingEndpointId);
                }
                if (!targetEp && extracted.gistId) {
                    targetEp = window.MT5API.endpoints.find(e => e.gistId && e.gistId === extracted.gistId);
                }
                if (!targetEp && extracted.name) {
                    targetEp = window.MT5API.endpoints.find(e => (e.name || '').toLowerCase() === (extracted.name || '').toLowerCase());
                }
                if (!targetEp && window.MT5API.endpoints.length === 1) {
                    targetEp = window.MT5API.endpoints[0];
                }

                if (targetEp) {
                    let epUpdated = false;
                    if (extracted.url && targetEp.url !== extracted.url) {
                        targetEp.url = extracted.url;
                        epUpdated = true;
                    }
                    if (extracted.apiKey && targetEp.apiKey !== extracted.apiKey) {
                        targetEp.apiKey = extracted.apiKey;
                        epUpdated = true;
                    }
                    if (extracted.shieldToken && targetEp.shieldToken !== extracted.shieldToken) {
                        targetEp.shieldToken = extracted.shieldToken;
                        epUpdated = true;
                    }
                    if (extracted.gistId && targetEp.gistId !== extracted.gistId) {
                        targetEp.gistId = extracted.gistId;
                        epUpdated = true;
                    }
                    if (extracted.gistToken && targetEp.gistToken !== extracted.gistToken) {
                        targetEp.gistToken = extracted.gistToken;
                        epUpdated = true;
                    }
                    if (epUpdated) {
                        window.MT5API.saveConfig();
                        window.MT5API.testSingleEndpoint(targetEp.id).then(() => {
                            if (this.isOpen) this.renderModal();
                        });
                    }
                }
            }

            return updatedFields;
        }

        async decodeQrFromImage(imageFileOrBlob) {
            // 1. Try native Web Platform BarcodeDetector first
            if ('BarcodeDetector' in window) {
                try {
                    const imgBitmap = await createImageBitmap(imageFileOrBlob);
                    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
                    const barcodes = await detector.detect(imgBitmap);
                    if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                        return barcodes[0].rawValue;
                    }
                } catch (e) {
                    console.warn('[SmartPaste] BarcodeDetector scan failed:', e);
                }
            }

            // 2. Fallback to jsQR from CDN if native BarcodeDetector not available
            try {
                if (!window.jsQR) {
                    const savedDefine = window.define;
                    try {
                        window.define = undefined;
                        await new Promise((resolve, reject) => {
                            const s = document.createElement('script');
                            s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
                            s.onload = resolve;
                            s.onerror = () => reject(new Error('Failed to load jsQR'));
                            document.head.appendChild(s);
                        });
                    } finally {
                        window.define = savedDefine;
                    }
                }

                if (window.jsQR) {
                    const imgBitmap = await createImageBitmap(imageFileOrBlob);
                    const canvas = document.createElement('canvas');
                    canvas.width = imgBitmap.width;
                    canvas.height = imgBitmap.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(imgBitmap, 0, 0);
                    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const code = window.jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'attemptBoth' });
                    if (code && code.data) {
                        return code.data;
                    }
                }
            } catch (e) {
                console.warn('[SmartPaste] jsQR scan failed:', e);
            }
            return null;
        }

        async promptAndUnlockQR(modal, qrBlob) {
            return new Promise((resolve) => {
                const existing = document.getElementById('mt5-qr-unlock-overlay');
                if (existing) existing.remove();

                const theme = this.getTheme();
                const overlay = document.createElement('div');
                overlay.id = 'mt5-qr-unlock-overlay';
                overlay.style.position = 'fixed';
                overlay.style.top = '0';
                overlay.style.left = '0';
                overlay.style.width = '100vw';
                overlay.style.height = '100vh';
                overlay.style.background = 'rgba(0, 0, 0, 0.75)';
                overlay.style.backdropFilter = 'blur(6px)';
                overlay.style.webkitBackdropFilter = 'blur(6px)';
                overlay.style.display = 'flex';
                overlay.style.alignItems = 'center';
                overlay.style.justifyContent = 'center';
                overlay.style.zIndex = '2000000'; // Higher than main modal (999999)

                const isDark = theme.isDark !== false;
                const modalBg = theme.cardBg || (isDark ? '#131722' : '#ffffff');
                const borderColor = theme.border || (isDark ? '#2a2e39' : '#e0e3eb');
                const textColor = theme.text || (isDark ? '#d1d4dc' : '#131722');
                const textMutedColor = theme.textMuted || '#787b86';
                const inputBgColor = theme.inputBg || (isDark ? '#1e222d' : '#f8f9fd');
                const inputBorderColor = theme.inputBorder || (isDark ? '#363c4e' : '#d1d4dc');
                const primaryColor = theme.primary || '#2962ff';

                overlay.innerHTML = `
                    <div style="
                        background: ${modalBg};
                        border: 1px solid ${borderColor};
                        border-radius: 10px;
                        width: 92%;
                        max-width: 440px;
                        padding: 22px 24px;
                        box-shadow: 0 24px 60px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06);
                        font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif;
                        color: ${textColor};
                        box-sizing: border-box;
                        animation: mt5FadeInScale 0.18s cubic-bezier(0.16, 1, 0.3, 1);
                    ">
                        <style>
                            @keyframes mt5FadeInScale {
                                from { opacity: 0; transform: scale(0.96); }
                                to { opacity: 1; transform: scale(1); }
                            }
                            #mt5-qr-input-passphrase:focus {
                                border-color: ${primaryColor} !important;
                                box-shadow: 0 0 0 2px rgba(41, 98, 255, 0.25) !important;
                            }
                            #mt5-qr-btn-close:hover {
                                background: rgba(120, 123, 134, 0.18) !important;
                                color: ${textColor} !important;
                            }
                            #mt5-qr-btn-submit:hover:not(:disabled) {
                                background: #1e53e5 !important;
                            }
                            #mt5-qr-btn-cancel:hover {
                                background: rgba(120, 123, 134, 0.1) !important;
                            }
                        </style>

                        <!-- Modal Header -->
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <div style="
                                    width: 32px;
                                    height: 32px;
                                    border-radius: 8px;
                                    background: rgba(41, 98, 255, 0.15);
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    font-size: 16px;
                                    flex-shrink: 0;
                                ">🔐</div>
                                <div>
                                    <div style="font-size: 14.5px; font-weight: 700; color: ${textColor}; letter-spacing: 0.2px; line-height: 1.2;">
                                        Unlock Encrypted Bridge QR
                                    </div>
                                    <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                                        <span style="
                                            font-size: 9.5px;
                                            font-weight: 600;
                                            color: #2962ff;
                                            background: rgba(41, 98, 255, 0.12);
                                            padding: 1px 6px;
                                            border-radius: 3px;
                                            border: 1px solid rgba(41, 98, 255, 0.25);
                                            letter-spacing: 0.3px;
                                        ">AES-256-GCM VAULT</span>
                                    </div>
                                </div>
                            </div>
                            <button id="mt5-qr-btn-close" type="button" style="
                                background: transparent;
                                border: none;
                                color: ${textMutedColor};
                                cursor: pointer;
                                font-size: 14px;
                                width: 28px;
                                height: 28px;
                                border-radius: 6px;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                transition: all 0.15s ease;
                            " title="Close">✕</button>
                        </div>

                        <!-- Info Description -->
                        <div style="
                            font-size: 11.5px;
                            color: ${textMutedColor};
                            margin-bottom: 16px;
                            line-height: 1.5;
                            background: rgba(120, 123, 134, 0.08);
                            padding: 9px 12px;
                            border-radius: 6px;
                            border: 1px solid rgba(120, 123, 134, 0.14);
                        ">
                            This QR code is end-to-end encrypted. Enter the <strong>2-Word Passphrase</strong> shown in <code style="
                                font-size: 11px;
                                font-family: monospace;
                                background: rgba(120,123,134,0.18);
                                padding: 2px 5px;
                                border-radius: 4px;
                                color: ${textColor};
                                font-weight: 600;
                            ">BRIDGE_INFO.txt</code> on your Desktop to decrypt and auto-connect.
                        </div>

                        <!-- Passphrase Input -->
                        <div style="margin-bottom: 16px;">
                            <label style="
                                display: block;
                                font-size: 10.5px;
                                font-weight: 600;
                                margin-bottom: 6px;
                                color: ${theme.textDim || textMutedColor};
                                text-transform: uppercase;
                                letter-spacing: 0.5px;
                            ">2-Word Passphrase</label>
                            <div style="position: relative; display: flex; align-items: center;">
                                <input id="mt5-qr-input-passphrase" type="text" placeholder="e.g. shadow-dragon" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" style="
                                    width: 100%;
                                    height: 38px;
                                    background: ${inputBgColor};
                                    border: 1px solid ${inputBorderColor};
                                    border-radius: 6px;
                                    color: ${textColor};
                                    padding: 0 12px;
                                    font-size: 13px;
                                    font-weight: 600;
                                    letter-spacing: 0.5px;
                                    box-sizing: border-box;
                                    outline: none;
                                    transition: border-color 0.15s ease, box-shadow 0.15s ease;
                                " />
                            </div>
                        </div>

                        <!-- Status Alert Container -->
                        <div id="mt5-qr-unlock-status" style="
                            display: none;
                            font-size: 11.5px;
                            margin-bottom: 16px;
                            padding: 8px 12px;
                            border-radius: 6px;
                            line-height: 1.4;
                            box-sizing: border-box;
                        "></div>

                        <!-- Actions -->
                        <div style="display: flex; justify-content: flex-end; gap: 10px; align-items: center;">
                            <button id="mt5-qr-btn-cancel" type="button" style="
                                background: transparent;
                                border: 1px solid ${borderColor};
                                color: ${textMutedColor};
                                padding: 7px 16px;
                                border-radius: 6px;
                                font-size: 11.5px;
                                font-weight: 600;
                                cursor: pointer;
                                transition: all 0.15s ease;
                            ">Cancel</button>
                            <button id="mt5-qr-btn-submit" type="button" style="
                                background: ${primaryColor};
                                border: none;
                                color: #ffffff;
                                font-weight: 700;
                                padding: 7px 18px;
                                border-radius: 6px;
                                font-size: 11.5px;
                                cursor: pointer;
                                display: inline-flex;
                                align-items: center;
                                gap: 6px;
                                box-shadow: 0 2px 8px rgba(41, 98, 255, 0.35);
                                transition: all 0.15s ease;
                            ">
                                <span>🔓</span> Unlock & Auto-Connect
                            </button>
                        </div>
                    </div>
                `;

                document.body.appendChild(overlay);

                const inp = overlay.querySelector('#mt5-qr-input-passphrase');
                const btnSubmit = overlay.querySelector('#mt5-qr-btn-submit');
                const btnCancel = overlay.querySelector('#mt5-qr-btn-cancel');
                const btnClose = overlay.querySelector('#mt5-qr-btn-close');
                const statusDiv = overlay.querySelector('#mt5-qr-unlock-status');

                setTimeout(() => { if (inp) inp.focus(); }, 60);

                const closeOverlay = () => {
                    overlay.remove();
                    resolve(false);
                };

                btnCancel.onclick = closeOverlay;
                btnClose.onclick = closeOverlay;
                overlay.onclick = (e) => {
                    if (e.target === overlay) closeOverlay();
                };

                const doUnlock = async () => {
                    const pass = inp ? inp.value.trim() : '';
                    if (!pass) {
                        inp.style.borderColor = '#f23645';
                        inp.focus();
                        return;
                    }

                    btnSubmit.disabled = true;
                    btnSubmit.style.opacity = '0.7';
                    btnSubmit.innerHTML = '<span>⏳</span> Decrypting Vault...';
                    if (statusDiv) statusDiv.style.display = 'none';

                    try {
                        const res = await window.MT5API.decryptQRVault(qrBlob, pass);
                        if (res.success) {
                            if (statusDiv) {
                                statusDiv.style.display = 'block';
                                statusDiv.style.background = 'rgba(8, 153, 129, 0.14)';
                                statusDiv.style.border = '1px solid rgba(8, 153, 129, 0.35)';
                                statusDiv.style.color = '#089981';
                                statusDiv.innerHTML = '✓ Decrypted successfully! Auto-connecting...';
                            }

                            // Populate modal fields with the 3 credentials from QR
                            const inUrl = modal.querySelector('#mt5-in-new-url');
                            const inShield = modal.querySelector('#mt5-in-new-shield-token');
                            const inGistId = modal.querySelector('#mt5-in-new-gist-id');
                            const inGistToken = modal.querySelector('#mt5-in-new-gist-token');
                            const inKey = modal.querySelector('#mt5-in-new-key');

                            // Wipe any stale URL so the system strictly discovers the fresh URL from GitHub Gist
                            if (inUrl) inUrl.value = '';
                            if (inShield) inShield.value = '';
                            if (inGistId && res.gistId) inGistId.value = res.gistId;
                            if (inGistToken && res.pat) inGistToken.value = res.pat;
                            if (inKey && res.apiKey) inKey.value = res.apiKey;

                            // If an existing bridge card is currently open in inline edit mode, update its credentials too
                            if (this.editingEndpointId) {
                                const editCard = modal.querySelector(`.mt5-endpoint-card[data-id="${this.editingEndpointId}"]`);
                                if (editCard) {
                                    const editKey = editCard.querySelector('.mt5-in-edit-key');
                                    if (editKey && res.apiKey) editKey.value = res.apiKey;
                                    const editGistId = editCard.querySelector('.mt5-in-edit-gist-id');
                                    if (editGistId && res.gistId) editGistId.value = res.gistId;
                                    const editGistToken = editCard.querySelector('.mt5-in-edit-gist-token');
                                    if (editGistToken && res.pat) editGistToken.value = res.pat;
                                    const editUrl = editCard.querySelector('.mt5-in-edit-url');
                                    if (editUrl) editUrl.value = '';
                                }
                            }

                            // Automatically synchronize credentials into saved bridge endpoint in MT5API config
                            if (window.MT5API && Array.isArray(window.MT5API.endpoints)) {
                                let targetEp = null;
                                if (this.editingEndpointId) {
                                    targetEp = window.MT5API.endpoints.find(e => e.id === this.editingEndpointId);
                                }
                                if (!targetEp && res.gistId) {
                                    targetEp = window.MT5API.endpoints.find(e => e.gistId && e.gistId === res.gistId);
                                }
                                if (!targetEp && window.MT5API.endpoints.length === 1) {
                                    targetEp = window.MT5API.endpoints[0];
                                }

                                if (targetEp) {
                                    targetEp.apiKey = res.apiKey;
                                    if (res.pat) targetEp.gistToken = res.pat;
                                    if (res.gistId) targetEp.gistId = res.gistId;
                                    targetEp.status = 'unknown';
                                    window.MT5API.saveConfig();
                                    console.log(`[SmartPaste] Synchronized 3 QR credentials into saved bridge '${targetEp.name}'. Discovering fresh endpoint from GitHub Gist...`);
                                }
                            }

                            // Highlight inputs
                            [inGistId, inGistToken, inKey].forEach(el => {
                                if (el) {
                                    el.style.borderColor = '#00c853';
                                    el.style.boxShadow = '0 0 8px rgba(0,200,83,0.4)';
                                    setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 3000);
                                }
                            });

                            const pasteBadge = modal.querySelector('#mt5-paste-badge');
                            const pasteHint = modal.querySelector('#mt5-paste-hint');
                            if (pasteBadge) {
                                pasteBadge.innerText = '✓ 2-Word QR Decrypted (3 Fields)';
                                pasteBadge.style.display = 'inline-block';
                                pasteBadge.style.background = 'rgba(0,200,83,0.15)';
                                pasteBadge.style.color = '#00c853';
                                pasteBadge.style.borderColor = 'rgba(0,200,83,0.35)';
                            }
                            if (pasteHint) {
                                pasteHint.innerHTML = `<span style="color: #2962ff; font-weight: 600;">🔒 3 Credentials Decrypted! Fetching endpoint & shield from GitHub Gist...</span>`;
                            }

                            setTimeout(() => {
                                overlay.remove();
                                resolve(true);

                                // Auto trigger fresh Gist sync to strictly fetch endpoint URL and shield from GitHub
                                const btnFetchFreshGist = modal.querySelector('#mt5-btn-fetch-fresh-gist');
                                if (btnFetchFreshGist) {
                                    btnFetchFreshGist.click();
                                }
                            }, 350);
                        } else {
                            if (statusDiv) {
                                statusDiv.style.display = 'block';
                                statusDiv.style.background = 'rgba(242,54,69,0.12)';
                                statusDiv.style.color = '#f23645';
                                statusDiv.innerHTML = `⚠️ ${res.error || 'Failed to decrypt QR code.'}`;
                            }
                            inp.style.borderColor = '#f23645';
                            btnSubmit.disabled = false;
                            btnSubmit.innerHTML = '<span>🔓</span> Unlock & Auto-Connect';
                        }
                    } catch (err) {
                        if (statusDiv) {
                            statusDiv.style.display = 'block';
                            statusDiv.style.background = 'rgba(242,54,69,0.12)';
                            statusDiv.style.color = '#f23645';
                            statusDiv.innerHTML = `⚠️ Decryption error: ${err.message}`;
                        }
                        btnSubmit.disabled = false;
                        btnSubmit.innerHTML = '<span>🔓</span> Unlock & Auto-Connect';
                    }
                };

                btnSubmit.onclick = doUnlock;
                inp.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        doUnlock();
                    }
                };
            });
        }

        async ocrImageBlob(imageBlob, onProgress) {
            // 1. Try native Web Platform TextDetector first if available
            if ('TextDetector' in window) {
                try {
                    const detector = new window.TextDetector();
                    const imgBitmap = await createImageBitmap(imageBlob);
                    const detections = await detector.detect(imgBitmap);
                    if (detections && detections.length > 0) {
                        return detections.map(d => d.rawValue).join('\n');
                    }
                } catch (_) {}
            }

            // 2. Load Tesseract.js dynamically on demand from CDN if not already loaded (isolating from Monaco AMD loader)
            if (!window.Tesseract) {
                if (onProgress) onProgress('Loading Optical Character Recognition (OCR)...');
                const savedDefine = window.define;
                try {
                    window.define = undefined; // Temporarily isolate from Monaco's AMD define
                    await new Promise((resolve, reject) => {
                        const s = document.createElement('script');
                        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
                        s.onload = resolve;
                        s.onerror = () => reject(new Error('Failed to load OCR engine'));
                        document.head.appendChild(s);
                    });
                } finally {
                    window.define = savedDefine; // Restore Monaco AMD loader
                }
            }

            if (window.Tesseract) {
                if (onProgress) onProgress('Preparing image for OCR...');
                // Clean & upscale image via canvas to strip PNG iCCP chunks and sharpen OCR
                let processedBlob = imageBlob;
                try {
                    const imgBitmap = await createImageBitmap(imageBlob);
                    const canvas = document.createElement('canvas');
                    const scale = imgBitmap.width < 1200 ? 2 : 1;
                    canvas.width = imgBitmap.width * scale;
                    canvas.height = imgBitmap.height * scale;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(imgBitmap, 0, 0, canvas.width, canvas.height);
                    processedBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95)) || imageBlob;
                } catch (_) {
                    processedBlob = imageBlob;
                }

                if (onProgress) onProgress('Reading text from screenshot (OCR)...');
                const result = await window.Tesseract.recognize(processedBlob, 'eng', {
                    logger: m => {
                        if (m && m.status === 'recognizing text' && onProgress) {
                            const pct = Math.round((m.progress || 0) * 100);
                            onProgress(`Reading text from screenshot (${pct}%)...`);
                        }
                    }
                });
                return result && result.data ? (result.data.text || '') : '';
            }
            return '';
        }

        async wipeClipboardSafely() {
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText('');
                    return true;
                }
            } catch (_) {}
            return false;
        }

        getParquetHtml(theme) {
            let hfAuthor = 'bnq-ii';
            if (window.MT5ParquetIndex && window.MT5ParquetIndex.author && window.MT5ParquetIndex.author !== 'deep776') {
                hfAuthor = window.MT5ParquetIndex.author;
            } else if (window.HF_AUTHOR && window.HF_AUTHOR !== 'deep776') {
                hfAuthor = window.HF_AUTHOR;
            }
            const discoveryAuthors = (window.MT5ParquetIndex && typeof window.MT5ParquetIndex.getDiscoveryAuthors === 'function') ? window.MT5ParquetIndex.getDiscoveryAuthors() : [];
            const hfStatus = (window.MT5ParquetIndex && window.MT5ParquetIndex.bridgeStatus) || {};

            return `
                <div style="display: flex; flex-direction: column; gap: 9px; box-sizing: border-box; width: 100%;">
                    <!-- Top Summary Card: Live Inception & Background Archival -->
                    <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                            <div style="display: flex; align-items: center; gap: 7px;">
                                <span style="font-size: 16px;">🤗</span>
                                <strong style="font-size: 12px; color: ${theme.text}; letter-spacing: 0.2px;">HUGGING FACE PARQUET ARCHIVAL ENGINE</strong>
                                <span style="font-size: 9px; padding: 2px 7px; border-radius: 3px; background: rgba(8,153,129,0.12); color: #089981; border: 1px solid rgba(8,153,129,0.25); font-weight: 700;">Zero-Cloud 0ms DuckDB Ready</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <button id="mt5-btn-sync-current-symbol" type="button" style="background: rgba(41,98,255,0.08); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.25); height: 24px; padding: 0 9px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;" title="Prioritize active chart symbol for immediate Parquet archival">
                                    <span>⚡</span> Archive Chart Symbol
                                </button>
                                <button id="mt5-btn-refresh-hf-status" type="button" style="background: ${theme.inputBg}; color: ${theme.text}; border: 1px solid ${theme.border}; height: 24px; padding: 0 9px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                                    <span>🔄</span> Refresh Status
                                </button>
                            </div>
                        </div>

                        <!-- Live Status Banner -->
                        <div style="background: rgba(0,0,0,0.15); border: 1px solid ${theme.border}; border-radius: 4px; padding: 6px 10px; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 10.5px; font-family: monospace;">
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #00e676; box-shadow: 0 0 6px #00e676;" title="WebSocket Stream Connected"></span>
                                <span id="mt5-hf-status-tag" class="mt5-hf-status-tag" style="color: ${hfStatus.is_syncing ? '#ff9800' : '#089981'}; font-weight: 700;">
                                    ${hfStatus.is_syncing ? '🔄 ACTIVE INCEPTION SYNC:' : '🟢 ARCHIVAL IDLE:'}
                                </span>
                                <span id="mt5-hf-status-desc" class="mt5-hf-status-desc" style="color: ${theme.text}; font-weight: 600;">
                                    ${hfStatus.is_syncing ? `${hfStatus.current_symbol || 'Symbol'} (${hfStatus.current_server || 'Server'}, ${hfStatus.current_chunk || 'chunk'})` : 'Fleet automatically rotates across all symbols from inception'}
                                </span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 12px; color: ${theme.textMuted}; font-size: 10px; flex-wrap: wrap;">
                                <span>📊 Inception Queue: <strong id="mt5-hf-queue-count" class="mt5-hf-queue-count" style="color:${theme.text};">${hfStatus.completed_symbols || 0} / ${hfStatus.total_symbols || 0} Tickers</strong></span>
                                <span>📦 Chunks: <strong id="mt5-hf-chunks-count" class="mt5-hf-chunks-count" style="color:${theme.text};">${hfStatus.completed_chunks || 0}</strong></span>
                                <span>💾 Uploaded: <strong id="mt5-hf-uploaded-mb" class="mt5-hf-uploaded-mb" style="color:${theme.text};">${((hfStatus.total_bytes_uploaded || 0) / (1024*1024)).toFixed(1)} MB</strong></span>
                                <span title="Ephemeral local files wiped immediately on upload" style="color: #089981; font-weight: 700;">✓ 0 MB VPS Retention</span>
                            </div>
                        </div>
                    </div>

                    <!-- Discovery Namespaces Card -->
                    <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                            <div>
                                <strong style="font-size: 11.5px; color: ${theme.text};">Data Discovery Namespaces (Community & Public Datasets)</strong>
                                <div style="font-size: 10px; color: ${theme.textMuted}; margin-top: 2px;">
                                    Add Hugging Face usernames/organizations to discover and backfill Parquet historical candles from other public datasets (e.g. <code>trader-name</code>).
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <input type="text" id="mt5-in-discovery-username" placeholder="Add HF Username (e.g. trader-data)" style="width: 210px; height: 25px; padding: 2px 10px; font-size: 10.5px; font-family: monospace; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; box-sizing: border-box;">
                                <button id="mt5-btn-add-discovery-username" type="button" style="background: ${theme.primary}; color: #fff; border: none; height: 25px; padding: 0 11px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer;">➕ Add Namespace</button>
                            </div>
                        </div>

                        <!-- Active Discovery List Chips -->
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding-top: 4px;" id="mt5-discovery-authors-list">
                            <span style="font-size: 10px; padding: 3px 8px; border-radius: 4px; background: rgba(41,98,255,0.15); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.3); font-weight: 700; font-family: monospace; display: inline-flex; align-items: center; gap: 4px;">
                                👑 ${hfAuthor} (Primary Publisher)
                            </span>
                            ${discoveryAuthors.map(author => `
                                <span style="font-size: 10px; padding: 3px 8px; border-radius: 4px; background: ${theme.inputBg}; color: ${theme.text}; border: 1px solid ${theme.border}; font-family: monospace; display: inline-flex; align-items: center; gap: 6px;">
                                    👥 ${author}
                                    <button type="button" class="mt5-btn-remove-discovery-author" data-author="${author}" style="background: transparent; border: none; color: ${theme.error}; cursor: pointer; font-size: 11px; font-weight: 700; padding: 0; line-height: 1;" title="Remove this discovery namespace">✕</button>
                                </span>
                            `).join('')}
                            ${discoveryAuthors.length === 0 ? `<span style="font-size: 10px; color: ${theme.textMuted}; font-style: italic;">No secondary accounts added yet. Add public/community usernames above to discover more Parquet data without passwords.</span>` : ''}
                        </div>
                    </div>

                    <!-- Publisher & Write Token Card -->
                    <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
                        <div>
                            <strong style="font-size: 11px; color: ${theme.text};">Hugging Face Write Token (VPS Publisher)</strong>
                            <div style="font-size: 10px; color: ${theme.textMuted}; margin-top: 1px;">
                                Allows your Cloud Bridge VPS to push newly archived candles to your public dataset repository (<code>${hfAuthor}</code>).
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                            <input type="password" id="mt5-in-hf-write-token" autocomplete="new-password" placeholder="Paste HF Token (hf_...)" style="width: 200px; height: 25px; padding: 2px 10px; font-size: 10.5px; font-family: monospace; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; box-sizing: border-box;">
                            <button id="mt5-btn-save-hf-token" type="button" style="background: ${theme.primary}; color: #fff; border: none; height: 25px; padding: 0 11px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer;">Save Token</button>
                        </div>
                    </div>

                    <!-- Browser Storage & 1-Week Expiration Manager -->
                    <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
                            <div>
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span style="font-size: 14px;">🧹</span>
                                    <strong style="font-size: 11.5px; color: ${theme.text};">Browser Parquet Cache & 1-Week Inactivity Expiration</strong>
                                    <span style="font-size: 9px; padding: 2px 6px; border-radius: 3px; background: rgba(8,153,129,0.12); color: #089981; border: 1px solid rgba(8,153,129,0.25); font-weight: 700;">7-Day Auto-Purge Active</span>
                                </div>
                                <div style="font-size: 10px; color: ${theme.textMuted}; margin-top: 2px;">
                                    To keep your browser lightweight and fast (identical to Fyers), cached Parquet files for any <code>Server + Ticker</code> combo that has not been opened in the webpage within 1 week (7 days) are automatically deleted.
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <button id="mt5-btn-clean-expired-parquet" type="button" style="background: rgba(8,153,129,0.1); color: #089981; border: 1px solid rgba(8,153,129,0.3); height: 25px; padding: 0 10px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer;" title="Manually purge files not opened in the last 7 days">
                                    🧹 Purge Expired (> 7 Days)
                                </button>
                                <button id="mt5-btn-clear-all-parquet" type="button" style="background: rgba(242,54,69,0.08); color: ${theme.error}; border: 1px solid ${theme.errorBorder}; height: 25px; padding: 0 10px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer;" title="Clear all downloaded Parquet files from browser storage">
                                    🗑️ Clear All Parquet Cache
                                </button>
                            </div>
                        </div>

                        <!-- Dynamic Storage Stats Bar -->
                        <div id="mt5-parquet-storage-status" style="background: rgba(0,0,0,0.12); border: 1px solid ${theme.border}; border-radius: 4px; padding: 6px 10px; display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 10.5px; font-family: monospace;">
                            <span id="mt5-parquet-storage-text" style="color: ${theme.text}; font-weight: 600;">
                                📊 Calculating IndexedDB Parquet cache size...
                            </span>
                            <span style="color: #089981; font-weight: 600;">
                                ✓ Self-Healing LRU Purge Enabled
                            </span>
                        </div>
                    </div>
                </div>
            `;
        }

        getSettingsHtml(theme) {
            const endpoints = window.MT5API ? window.MT5API.getEndpoints() : [];
            const activeEp = window.MT5API ? window.MT5API.getActiveEndpoint() : null;
            const activeEpId = activeEp ? activeEp.id : null;
            const enabledEndpoints = endpoints.filter(e => e.enabled);
            const onlineEndpoints = endpoints.filter(e => e.enabled && e.status === 'online');
            const hasMasterToken = window.MT5API ? window.MT5API.hasMasterGistToken() : false;
            const hfAuthor = (window.MT5ParquetIndex && window.MT5ParquetIndex.author && window.MT5ParquetIndex.author !== 'deep776') || (window.HF_AUTHOR && window.HF_AUTHOR !== 'deep776') || 'bnq-ii';
            const discoveryAuthors = (window.MT5ParquetIndex && typeof window.MT5ParquetIndex.getDiscoveryAuthors === 'function') ? window.MT5ParquetIndex.getDiscoveryAuthors() : [];
            const hfStatus = (window.MT5ParquetIndex && window.MT5ParquetIndex.bridgeStatus) || {};

            const cards = endpoints.map((ep) => {
                const isPrimary = ep.id === activeEpId;
                const isOnline = ep.status === 'online';
                const isOffline = ep.status === 'offline';
                const isEnabled = ep.enabled !== false;
                const bridgeToken = ep.gistToken || '';
                const effectiveToken = window.MT5API ? window.MT5API.getEndpointGistToken(ep.id) : bridgeToken;
                const hasGist = Boolean(ep.gistId && effectiveToken);

                let statusBadge = '';
                if (!isEnabled) {
                    statusBadge = `<span class="mt5-ping-badge" data-id="${ep.id}" style="font-size: 9.5px; padding: 1px 6px; border-radius: 3px; background: rgba(120,123,134,0.12); color: #787b86; border: 1px solid rgba(120,123,134,0.25); font-weight: 600;">⏸️ Off</span>`;
                } else if (ep.status === 'unauthorized') {
                    statusBadge = `<span class="mt5-ping-badge" data-id="${ep.id}" style="font-size: 9.5px; padding: 1px 6px; border-radius: 3px; background: rgba(255,152,0,0.15); color: #ff9800; border: 1px solid rgba(255,152,0,0.4); font-weight: 600;" title="${ep.error || '401 Unauthorized: Invalid API Key. Click Edit to update key.'}">🔑 401 Key Invalid</span>`;
                } else if (isOnline) {
                    statusBadge = `<span class="mt5-ping-badge" data-id="${ep.id}" style="font-size: 9.5px; padding: 1px 6px; border-radius: 3px; background: rgba(8,153,129,0.12); color: #089981; border: 1px solid rgba(8,153,129,0.25); font-weight: 600;">🟢 Online (${ep.ping || 0}ms)</span>`;
                } else if (isOffline) {
                    statusBadge = `<span class="mt5-ping-badge" data-id="${ep.id}" style="font-size: 9.5px; padding: 1px 6px; border-radius: 3px; background: rgba(242,54,69,0.12); color: #f23645; border: 1px solid rgba(242,54,69,0.25); font-weight: 600;" title="${ep.error || 'Connection failed'}">🔴 Offline</span>`;
                } else {
                    statusBadge = `<span class="mt5-ping-badge" data-id="${ep.id}" style="font-size: 9.5px; padding: 1px 6px; border-radius: 3px; background: rgba(255,152,0,0.12); color: #ff9800; border: 1px solid rgba(255,152,0,0.25); font-weight: 600;">⚪ Standby</span>`;
                }

                const icon = ep.name.toLowerCase().includes('oracle') ? '☁️' : (ep.name.toLowerCase().includes('vmware') ? '💻' : '⚡');
                const hostedAccs = (window.MT5API && window.MT5API.accounts) ? window.MT5API.accounts.filter(a => a.endpointId === ep.id) : [];
                const isEditing = this.editingEndpointId === ep.id;

                return `
                    <div class="mt5-endpoint-card" data-id="${ep.id}" style="
                        background: ${theme.cardBg};
                        border: 1px solid ${isPrimary ? 'rgba(41,98,255,0.6)' : (isEditing ? 'rgba(41,98,255,0.4)' : theme.border)};
                        border-radius: 6px;
                        padding: 6px 10px;
                        display: flex;
                        flex-direction: column;
                        gap: 4px;
                        box-sizing: border-box;
                        width: 100%;
                        opacity: ${isEnabled ? '1' : '0.75'};
                    ">
                        <!-- Top Line: Identity & Quick Actions -->
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                            <div style="display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden;">
                                <span style="font-size: 13px; flex-shrink: 0;">${icon}</span>
                                <span style="font-weight: 700; font-size: 12px; color: ${theme.text}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${ep.name}</span>
                                ${isPrimary ? `<span style="font-size: 9px; padding: 1px 5px; border-radius: 3px; background: ${theme.primary}; color: #fff; font-weight: 700; flex-shrink: 0;">PRIMARY</span>` : ''}
                                ${statusBadge}
                                ${hostedAccs.length === 0 ? `
                                    <span style="font-size: 9.5px; padding: 1px 6px; border-radius: 3px; background: rgba(255,152,0,0.12); color: #ff9800; border: 1px solid rgba(255,152,0,0.25); font-weight: 600;">Standby • 0 Acc</span>
                                ` : `
                                    <span style="font-size: 10px; color: ${theme.textMuted}; font-family: monospace; flex-shrink: 0;">👥 ${hostedAccs.length} acc</span>
                                `}
                            </div>

                            <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0;">
                                ${hostedAccs.length === 0 ? `
                                    <button type="button" class="mt5-btn-deploy-to-bridge" data-id="${ep.id}" style="background: rgba(41,98,255,0.12); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.3); height: 21px; padding: 0 6px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;" title="Deploy or connect an MT5 account to this bridge">➕ Deploy Acc</button>
                                ` : ''}
                                <button type="button" class="mt5-btn-ping-endpoint" data-id="${ep.id}" style="background: rgba(41,98,255,0.08); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.25); height: 21px; padding: 0 6px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;" title="Ping this server">🔄 Ping</button>
                                ${hasGist ? `<button type="button" class="mt5-btn-sync-single-gist" data-id="${ep.id}" style="background: rgba(41,98,255,0.12); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.3); height: 21px; padding: 0 6px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;" title="Sync latest rotated URL from this bridge's Gist">⚡ Sync</button>` : ''}
                                <button type="button" class="mt5-btn-edit-endpoint" data-id="${ep.id}" style="background: ${isEditing ? 'rgba(41,98,255,0.2)' : 'rgba(41,98,255,0.08)'}; color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.3); height: 21px; padding: 0 6px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;" title="Edit Bridge Server URL, API Key, and Gist Settings">${isEditing ? '✕ Close' : '✏️ Edit'}</button>
                                ${!isPrimary ? `<button type="button" class="mt5-btn-set-primary-endpoint" data-id="${ep.id}" style="background: rgba(41,98,255,0.08); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.25); height: 21px; padding: 0 6px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;" title="Set as primary default bridge">★ Primary</button>` : ''}
                                <button type="button" class="mt5-btn-toggle-endpoint" data-id="${ep.id}" style="background: ${isEnabled ? 'rgba(255,165,0,0.1)' : 'rgba(0,200,83,0.1)'}; color: ${isEnabled ? '#ffa500' : theme.success}; border: 1px solid ${isEnabled ? 'rgba(255,165,0,0.3)' : 'rgba(0,200,83,0.3)'}; height: 21px; padding: 0 6px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;" title="${isEnabled ? 'Disable polling this endpoint' : 'Enable polling this endpoint'}">${isEnabled ? '⏸️' : '▶️'}</button>
                                ${endpoints.length > 1 ? `<button type="button" class="mt5-btn-delete-endpoint" data-id="${ep.id}" style="background: transparent; color: ${theme.error}; border: 1px solid rgba(242,54,69,0.3); height: 21px; padding: 0 6px; border-radius: 4px; font-size: 10px; cursor: pointer;" title="Remove this endpoint">✕</button>` : ''}
                            </div>
                        </div>

                        <!-- Bottom Line: Endpoint URL & Sync Origin -->
                        <div style="display: flex; align-items: center; gap: 8px; font-family: monospace; font-size: 10.5px; color: ${theme.textMuted}; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">
                            <span style="color: ${theme.text}; font-weight: 600; overflow: hidden; text-overflow: ellipsis;">${ep.url}</span>
                            ${(ep.shieldToken || (ep.url && ep.url.replace(/^https?:\/\/[^\/]+/, '').length > 1)) ? `
                                <span style="color: #00c853; font-weight: 600; flex-shrink: 0;" title="Origin Zero-Trust Shield & Path Cloaking Active">
                                    • 🛡️ Cloaked
                                </span>
                            ` : ''}
                            ${ep.gistId ? `
                                <span style="color:${theme.primary}; font-weight: 600; flex-shrink: 0;" title="Auto-Discovery Gist configured">
                                    • 🔄 Gist: ${this.morphGistId(ep.gistId)} ${bridgeToken ? '(Custom PAT)' : (hasMasterToken ? '(Master PAT)' : '(No PAT)')}
                                </span>
                            ` : `<span style="color: ${theme.textMuted}; flex-shrink: 0;">• Direct / Static</span>`}
                            <span style="color: ${theme.textMuted}; flex-shrink: 0;">• Key: ${ep.apiKey ? '••••' : 'None'}</span>
                        </div>

                        ${hostedAccs.length > 0 ? `
                            <div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 3px; padding-top: 3px; border-top: 1px solid rgba(120,120,120,0.08);">
                                <span style="font-size: 9.5px; color: ${theme.textMuted}; font-weight: 600;">Hosted:</span>
                                ${hostedAccs.map(a => `
                                    <span style="font-size: 9px; padding: 1px 5px; border-radius: 3px; background: rgba(120,123,134,0.1); color: ${theme.text}; border: 1px solid rgba(120,123,134,0.2); font-family: monospace;">
                                        #${a.login} (${a.nickname || a.broker_name || 'MT5'})
                                    </span>
                                `).join('')}
                            </div>
                        ` : `
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 3px; padding: 3px 7px; border-radius: 4px; background: rgba(255,152,0,0.06); border: 1px dashed rgba(255,152,0,0.25);">
                                <span style="font-size: 9.5px; color: ${theme.warning}; font-weight: 500;">Standby Gateway • 0 Accounts Configured</span>
                                <button type="button" class="mt5-btn-deploy-to-bridge" data-id="${ep.id}" style="background: ${theme.primary}; color: #fff; border: none; height: 19px; padding: 0 7px; border-radius: 3px; font-size: 9.5px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 2px;">➕ Deploy Account</button>
                            </div>
                        `}

                        ${isEditing ? `
                            <div class="mt5-ep-edit-container" data-id="${ep.id}" style="margin-top: 6px; padding-top: 8px; border-top: 1px dashed ${theme.border}; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; width: 100%;">
                                <div style="display: flex; align-items: center; justify-content: space-between;">
                                    <span style="font-size: 11px; font-weight: 700; color: ${theme.primary}; letter-spacing: 0.2px;">✏️ EDIT BRIDGE CONNECTION & AUTO-DISCOVERY</span>
                                    <span style="font-size: 9.5px; color: ${theme.textMuted};">Credentials stored encrypted in browser localStorage</span>
                                </div>

                                <!-- Row 1: Bridge Name, Endpoint URL, API Key -->
                                <div style="display: grid; grid-template-columns: 1.2fr 2fr 1fr; gap: 8px; width: 100%; box-sizing: border-box; align-items: start;">
                                    <div style="min-width: 0;">
                                        <div style="height: 18px; display: flex; align-items: center; margin-bottom: 3px;">
                                            <label style="font-size: 10.5px; font-weight: 600; color: ${theme.text};">Bridge Name *</label>
                                        </div>
                                        <input type="text" class="mt5-in-edit-name" value="${ep.name || ''}" placeholder="e.g. VMware VM, Oracle VPS" style="width: 100%; height: 28px; box-sizing: border-box; padding: 4px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 11px;">
                                    </div>
                                    <div style="min-width: 0;">
                                        <div style="height: 18px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                                            <label style="font-size: 10.5px; font-weight: 600; color: ${theme.text};">Endpoint URL *</label>
                                            <button type="button" class="mt5-btn-edit-sync-gist" data-id="${ep.id}" style="background: transparent; border: none; color: ${theme.primary}; font-size: 10px; font-weight: 600; cursor: pointer; text-decoration: underline; padding: 0; line-height: 1;" title="Fetch latest rotated URL from this server's Gist">⚡ Fetch from Gist</button>
                                        </div>
                                        <input type="text" class="mt5-in-edit-url" value="${ep.url || ''}" placeholder="https://...trycloudflare.com or https://IP:PORT" style="width: 100%; height: 28px; box-sizing: border-box; padding: 4px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 11px; font-family: monospace;">
                                    </div>
                                    <div style="min-width: 0;">
                                        <div style="height: 18px; display: flex; align-items: center; margin-bottom: 3px;">
                                            <label style="font-size: 10.5px; font-weight: 600; color: ${theme.text};">API Key (Password)</label>
                                        </div>
                                        <div style="position: relative; display: flex; align-items: center; width: 100%; height: 28px;">
                                            <input type="password" class="mt5-in-edit-key" value="${ep.apiKey || ''}" placeholder="Secret Key" style="width: 100%; height: 28px; box-sizing: border-box; padding: 4px 28px 4px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 11px; font-family: monospace;">
                                            <button type="button" class="mt5-btn-toggle-key-eye" style="position: absolute; right: 4px; height: 20px; width: 20px; background: transparent; border: none; cursor: pointer; font-size: 11px; opacity: 0.7; display: flex; align-items: center; justify-content: center;" title="Show/Hide">👁️</button>
                                        </div>
                                    </div>
                                </div>
                                <!-- Verification Status: Bridge Server -->
                                <div class="mt5-edit-verify-status-bridge" data-id="${ep.id}" style="display: none; margin-top: -2px; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 500; line-height: 1.35; box-sizing: border-box;"></div>

                                <!-- Row 2: Morphed Gist ID, Masked GitHub PAT Token -->
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; box-sizing: border-box; align-items: start;">
                                    <div style="min-width: 0;">
                                        <div style="height: 18px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px;">
                                            <label style="font-size: 10.5px; font-weight: 600; color: ${theme.text};">Auto-Discovery Gist ID (from server BRIDGE_INFO.txt)</label>
                                            <span style="font-size: 9px; color: ${theme.textMuted}; font-family: monospace;">Morphed for security</span>
                                        </div>
                                        <div style="position: relative; display: flex; align-items: center; width: 100%; height: 28px;">
                                            <input type="text" class="mt5-in-edit-gist-id" data-raw="${ep.gistId || ''}" value="${this.morphGistId(ep.gistId)}" placeholder="Paste 32-char Gist ID generated by this server" style="width: 100%; height: 28px; box-sizing: border-box; padding: 4px 28px 4px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 10.5px; font-family: monospace;">
                                            <button type="button" class="mt5-btn-toggle-gist-morph" data-id="${ep.id}" style="position: absolute; right: 4px; height: 20px; width: 20px; background: transparent; border: none; cursor: pointer; font-size: 11px; opacity: 0.7; display: flex; align-items: center; justify-content: center;" title="Reveal / Morph Gist ID">👁️</button>
                                        </div>
                                    </div>
                                    <div style="min-width: 0;">
                                        <div style="height: 18px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px;">
                                            <label style="font-size: 10.5px; font-weight: 600; color: ${theme.text};">GitHub PAT Token (Encrypted locally)</label>
                                            ${bridgeToken ? `<span style="font-size: 9px; color: ${theme.primary}; font-weight: 600;">Custom Token Set</span>` : (hasMasterToken ? `<span style="font-size: 9px; color: ${theme.success}; font-weight: 600;">✓ Inheriting Master PAT</span>` : `<span style="font-size: 9px; color: ${theme.textMuted};">Optional if Master PAT set</span>`)}
                                        </div>
                                        <div style="position: relative; display: flex; align-items: center; width: 100%; height: 28px;">
                                            <input type="password" class="mt5-in-edit-gist-token" value="" autocomplete="new-password" placeholder="${bridgeToken ? '•••••••••••••••• (Configured — leave blank to keep)' : (hasMasterToken ? 'Inherited from Master Token (leave blank)' : 'ghp_... (or set Master Token above)')}" style="width: 100%; height: 28px; box-sizing: border-box; padding: 4px 28px 4px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 10.5px; font-family: monospace;">
                                            <button type="button" class="mt5-btn-toggle-key-eye" style="position: absolute; right: 4px; height: 20px; width: 20px; background: transparent; border: none; cursor: pointer; font-size: 11px; opacity: 0.7; display: flex; align-items: center; justify-content: center;" title="Show/Hide typed characters">👁️</button>
                                        </div>
                                    </div>
                                </div>
                                <!-- Verification Status: Gist Discovery -->
                                <div class="mt5-edit-verify-status-gist" data-id="${ep.id}" style="display: none; margin-top: -2px; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 500; line-height: 1.35; box-sizing: border-box;"></div>

                                <!-- Row 3: Origin Zero-Trust Shield Token -->
                                <div style="background: rgba(41,98,255,0.03); border: 1px dashed rgba(41,98,255,0.25); border-radius: 5px; padding: 6px 8px; display: flex; flex-direction: column; gap: 3px; box-sizing: border-box;">
                                    <div style="display: flex; align-items: center; justify-content: space-between;">
                                        <label style="font-size: 10.5px; font-weight: 600; color: ${theme.primary}; display: flex; align-items: center; gap: 4px;">
                                            <span>🛡️</span> Origin Zero-Trust Shield Token (Optional Path Cloak)
                                        </label>
                                        <span style="font-size: 9px; color: ${theme.textMuted};">Auto-detected if included in URL path</span>
                                    </div>
                                    <div style="position: relative; display: flex; align-items: center; width: 100%; height: 28px;">
                                        <input type="password" class="mt5-in-edit-shield-token" value="${ep.shieldToken || ''}" placeholder="e.g. gw_EXAMPLE... (public scanners without this get blank 404)" style="width: 100%; height: 28px; box-sizing: border-box; padding: 4px 28px 4px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 10.5px; font-family: monospace;">
                                        <button type="button" class="mt5-btn-toggle-key-eye" style="position: absolute; right: 4px; height: 20px; width: 20px; background: transparent; border: none; cursor: pointer; font-size: 11px; opacity: 0.7; display: flex; align-items: center; justify-content: center;" title="Show/Hide">👁️</button>
                                    </div>
                                </div>

                                <!-- Row 4: Action Buttons -->
                                <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap;">
                                    <div class="mt5-edit-verify-summary" data-id="${ep.id}" style="display: none; font-size: 10.5px; font-weight: 600; padding: 2px 7px; border-radius: 3px;"></div>
                                    <div style="display: flex; gap: 6px; align-items: center; margin-left: auto;">
                                        <button type="button" class="mt5-btn-cancel-edit-ep" data-id="${ep.id}" style="background: transparent; color: ${theme.textMuted}; border: 1px solid ${theme.border}; padding: 4px 10px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer;">Cancel</button>
                                        <button type="button" class="mt5-btn-verify-edit-ep" data-id="${ep.id}" style="background: rgba(41,98,255,0.1); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.35); padding: 4px 10px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" title="Test and verify without saving">
                                            <span>🔍</span> Verify
                                        </button>
                                        <button type="button" class="mt5-btn-save-edit-ep" data-id="${ep.id}" style="background: ${theme.primary}; color: #fff; border: none; padding: 4px 12px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;">💾 Save & Test</button>
                                    </div>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                `;
            }).join('');

            return `
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <!-- Sleek 1-line Top Control Bar -->
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 2px 2px;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 11px; font-weight: 700; color: ${theme.text}; letter-spacing: 0.2px;">CONFIGURED BRIDGES (${endpoints.length})</span>
                            <span style="font-size: 10px; color: ${onlineEndpoints.length > 0 ? theme.success : theme.error}; font-family: monospace; font-weight: 600;">• ${onlineEndpoints.length}/${enabledEndpoints.length} ONLINE</span>
                        </div>
                        <div style="display: flex; gap: 5px; align-items: center;">
                            <button id="mt5-btn-sync-all-gists" type="button" style="background: rgba(41,98,255,0.08); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.25); height: 23px; padding: 0 8px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;" title="Sync all bridges with configured Auto-Discovery Gists">
                                <span>⚡</span> Sync Gists
                            </button>
                            <button id="mt5-btn-test-conn" type="button" style="background: ${theme.inputBg}; color: ${theme.text}; border: 1px solid ${theme.border}; height: 23px; padding: 0 8px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;" title="Test and ping all endpoints">
                                <span>🔄</span> Ping All
                            </button>
                            <button id="mt5-btn-toggle-add-bridge" type="button" style="background: ${this.showAddBridgeForm ? 'rgba(255,165,0,0.15)' : theme.primary}; color: ${this.showAddBridgeForm ? '#ffa500' : '#fff'}; border: 1px solid ${this.showAddBridgeForm ? 'rgba(255,165,0,0.3)' : 'transparent'}; height: 23px; padding: 0 9px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                                <span>${this.showAddBridgeForm ? '✕' : '➕'}</span> ${this.showAddBridgeForm ? 'Close' : 'Add Bridge'}
                            </button>
                        </div>
                    </div>

                    <!-- Global Master GitHub Gist Token Bar -->
                    <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 6px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; box-sizing: border-box;">
                        <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                            <span style="font-size: 13px; flex-shrink: 0;">🔑</span>
                            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                <strong style="font-size: 11px; color: ${theme.text};">Global Master GitHub Gist Token:</strong>
                                ${hasMasterToken ? `
                                    <span style="font-size: 9px; padding: 1px 6px; border-radius: 3px; background: rgba(8,153,129,0.12); color: ${theme.success}; border: 1px solid rgba(8,153,129,0.25); font-weight: 600;">✓ Active (Shared across all bridges)</span>
                                ` : `
                                    <span style="font-size: 9px; padding: 1px 6px; border-radius: 3px; background: rgba(255,152,0,0.12); color: ${theme.warning}; border: 1px solid rgba(255,152,0,0.25); font-weight: 600;">Not Set (Paste once to share across all bridges)</span>
                                `}
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px; flex-shrink: 0;">
                            <div style="position: relative; display: flex; align-items: center; height: 24px;">
                                <input type="password" id="mt5-in-master-gist-token" autocomplete="new-password" value="" placeholder="${hasMasterToken ? '•••••••••••••••• (Active)' : 'Paste ghp_... token'}" style="width: 175px; height: 24px; padding: 2px 24px 2px 8px; font-size: 10.5px; font-family: monospace; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; box-sizing: border-box;">
                                <button type="button" class="mt5-btn-toggle-key-eye" style="position: absolute; right: 3px; background: transparent; border: none; cursor: pointer; font-size: 10px; opacity: 0.7; height: 20px; width: 20px; display: flex; align-items: center; justify-content: center;" title="Show/Hide typed characters">👁️</button>
                            </div>
                            <button id="mt5-btn-save-master-token" type="button" style="background: ${theme.primary}; color: #fff; border: none; height: 24px; padding: 0 9px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer;">Save PAT</button>
                            ${hasMasterToken ? `
                                <button id="mt5-btn-clear-master-token" type="button" style="background: transparent; color: ${theme.error}; border: 1px solid ${theme.errorBorder}; height: 24px; padding: 0 6px; border-radius: 4px; font-size: 10px; cursor: pointer;" title="Clear Master Token">✕ Clear</button>
                            ` : ''}
                        </div>
                    </div>

                    <!-- Hugging Face Parquet Archival & Multi-Account Data Explorer -->
                    <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 7px; box-sizing: border-box;">
                        <!-- Header & Action Buttons -->
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <span style="font-size: 14px;">🤗</span>
                                <strong style="font-size: 11px; color: ${theme.text}; letter-spacing: 0.2px;">HUGGING FACE PARQUET ARCHIVAL & DATA EXPLORER</strong>
                                <span style="font-size: 9px; padding: 1px 6px; border-radius: 3px; background: rgba(8,153,129,0.12); color: #089981; border: 1px solid rgba(8,153,129,0.25); font-weight: 600;">0ms DuckDB Offline Ready</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 5px;">
                                <button id="mt5-btn-sync-current-symbol" type="button" style="background: rgba(41,98,255,0.08); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.25); height: 23px; padding: 0 8px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;" title="Prioritize active chart symbol for immediate Parquet archival">
                                    <span>⚡</span> Archive Chart Symbol
                                </button>
                                <button id="mt5-btn-refresh-hf-status" type="button" style="background: ${theme.inputBg}; color: ${theme.text}; border: 1px solid ${theme.border}; height: 23px; padding: 0 8px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                                    <span>🔄</span> Refresh Status
                                </button>
                            </div>
                        </div>

                        <!-- Live Status & Progress Strip -->
                        <div style="background: rgba(0,0,0,0.12); border: 1px solid ${theme.border}; border-radius: 4px; padding: 5px 8px; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 10px; font-family: monospace;">
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #00e676; box-shadow: 0 0 6px #00e676;" title="WebSocket Stream Connected"></span>
                                <span class="mt5-hf-status-tag" style="color: ${hfStatus.is_syncing ? '#ff9800' : '#089981'}; font-weight: 700;">
                                    ${hfStatus.is_syncing ? '🔄 SYNCING IN BACKGROUND:' : '🟢 ARCHIVAL IDLE:'}
                                </span>
                                <span class="mt5-hf-status-desc" style="color: ${theme.text}; font-weight: 600;">
                                    ${hfStatus.is_syncing ? `${hfStatus.current_symbol || 'Symbol'} (${hfStatus.current_chunk || 'chunk'})` : 'Active chart symbols sync autonomously to HF'}
                                </span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 10px; color: ${theme.textMuted}; font-size: 9.5px; flex-wrap: wrap;">
                                <span>📊 Inception Queue: <strong class="mt5-hf-queue-count" style="color:${theme.text};">${hfStatus.completed_symbols || 0} / ${hfStatus.total_symbols || 0} Tickers</strong></span>
                                <span>📦 Chunks: <strong class="mt5-hf-chunks-count" style="color:${theme.text};">${hfStatus.completed_chunks || 0}</strong></span>
                                <span>💾 Uploaded: <strong class="mt5-hf-uploaded-mb" style="color:${theme.text};">${((hfStatus.total_bytes_uploaded || 0) / (1024*1024)).toFixed(1)} MB</strong></span>
                                <span title="Local temporary files and terminal .hcc cache are purged immediately after push" style="color: #089981; font-weight: 600;">✓ 0 MB VPS Retention</span>
                            </div>
                        </div>

                        <!-- Publisher & Token -->
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; border-top: 1px solid ${theme.border}; padding-top: 5px;">
                            <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                                <span style="font-size: 10.5px; font-weight: 700; color: ${theme.text};">Active Publisher:</span>
                                <span style="font-size: 10.5px; font-family: monospace; font-weight: 700; color: ${theme.primary}; background: rgba(41,98,255,0.1); padding: 1px 6px; border-radius: 3px;">
                                    ${hfAuthor}
                                </span>
                                <span style="font-size: 9px; color: ${theme.textMuted};">(${hfAuthor}/MT5_{Server}_{Ticker})</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 5px; flex-shrink: 0;">
                                <input type="password" id="mt5-in-hf-write-token" autocomplete="new-password" placeholder="Update HF Write Token (hf_...)" style="width: 180px; height: 23px; padding: 2px 8px; font-size: 10px; font-family: monospace; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; box-sizing: border-box;">
                                <button id="mt5-btn-save-hf-token" type="button" style="background: ${theme.primary}; color: #fff; border: none; height: 23px; padding: 0 9px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;">Save Token</button>
                            </div>
                        </div>

                        <!-- Multi-Account Discovery (Community / Secondary Accounts) -->
                        <div style="display: flex; flex-direction: column; gap: 4px; border-top: 1px solid ${theme.border}; padding-top: 5px;">
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span style="font-size: 10.5px; font-weight: 700; color: ${theme.text};">Data Discovery Namespaces:</span>
                                    <span style="font-size: 9px; color: ${theme.textMuted};">Searches repositories across all accounts in priority order</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 5px;">
                                    <input type="text" id="mt5-in-discovery-username" placeholder="Add HF Username (e.g. trader-data)" style="width: 170px; height: 22px; padding: 2px 8px; font-size: 10px; font-family: monospace; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; box-sizing: border-box;">
                                    <button id="mt5-btn-add-discovery-username" type="button" style="background: rgba(41,98,255,0.12); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.3); height: 22px; padding: 0 8px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;">➕ Add</button>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;" id="mt5-discovery-authors-list">
                                <span style="font-size: 9px; padding: 1px 6px; border-radius: 3px; background: rgba(41,98,255,0.15); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.3); font-weight: 700; font-family: monospace;">
                                    ${hfAuthor} (Primary)
                                </span>
                                ${discoveryAuthors.map(author => `
                                    <span style="font-size: 9px; padding: 1px 6px; border-radius: 3px; background: ${theme.inputBg}; color: ${theme.text}; border: 1px solid ${theme.border}; font-family: monospace; display: inline-flex; align-items: center; gap: 4px;">
                                        ${author}
                                        <button type="button" class="mt5-btn-remove-discovery-author" data-author="${author}" style="background: transparent; border: none; color: ${theme.error}; cursor: pointer; font-size: 9px; padding: 0; line-height: 1;" title="Remove this discovery namespace">✕</button>
                                    </span>
                                `).join('')}
                                ${discoveryAuthors.length === 0 ? `<span style="font-size: 9px; color: ${theme.textMuted}; font-style: italic;">No secondary accounts added yet. Add public/community usernames above to discover more Parquet data.</span>` : ''}
                            </div>
                        </div>
                    </div>

                    <!-- Bridge Endpoints List -->
                    <div style="display: flex; flex-direction: column; gap: 5px;">
                        ${endpoints.length === 0 ? `
                        <div style="text-align: center; padding: 20px; background: ${theme.cardBg}; border: 1px dashed ${theme.border}; border-radius: 6px;">
                            <div style="font-size: 18px; margin-bottom: 2px;">🌐</div>
                            <div style="font-weight: 600; font-size: 12px; color: ${theme.text};">No Bridge Endpoints Configured Yet</div>
                            <div style="font-size: 10.5px; color: ${theme.textMuted}; margin-top: 2px;">Click "Add Bridge" above to connect your MT5 Bridge Server.</div>
                        </div>
                        ` : cards}
                    </div>

                    <!-- Add Bridge Endpoint Form (Collapsible) -->
                    ${(this.showAddBridgeForm || endpoints.length === 0) ? `
                    <div style="background: ${theme.cardBg}; border: 1px solid rgba(41,98,255,0.4); border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; width: 100%;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <strong style="font-size: 11px; font-weight: 700; color: ${theme.primary}; letter-spacing: 0.2px;">➕ CONNECT NEW BRIDGE SERVER</strong>
                            <button id="mt5-btn-cancel-add-bridge" type="button" style="background: transparent; border: none; color: ${theme.textMuted}; font-size: 11px; cursor: pointer;">✕</button>
                        </div>

                        <!-- Smart Paste / Burn Drop Zone -->
                        <div id="mt5-smart-paste-box" tabindex="0" style="
                            background: rgba(41,98,255,0.04);
                            border: 1px dashed rgba(41,98,255,0.35);
                            border-radius: 6px;
                            padding: 6px 10px;
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            gap: 10px;
                            box-sizing: border-box;
                            cursor: pointer;
                            transition: all 0.2s;
                        " title="Click or focus here, then press Ctrl+V to paste BRIDGE_INFO text or drop BRIDGE_QR.png">
                            <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                                <span style="font-size: 16px; flex-shrink: 0;">📋</span>
                                <div style="min-width: 0;">
                                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                        <span style="font-size: 11px; font-weight: 700; color: ${theme.primary};">Instant Setup (2-Word QR Code or OCR)</span>
                                        <span id="mt5-paste-badge" style="display: none; font-size: 9px; padding: 1px 6px; border-radius: 3px; background: rgba(8,153,129,0.15); color: #089981; border: 1px solid rgba(8,153,129,0.3); font-weight: 600;">✓ Extracted</span>
                                    </div>
                                    <div style="font-size: 9.5px; color: ${theme.textMuted}; line-height: 1.3; margin-top: 1px;" id="mt5-paste-hint">
                                        Press <strong>Ctrl+V</strong> anywhere, drop <strong>BRIDGE_QR.png</strong>, or paste text. Decrypts with 2-word passphrase.
                                    </div>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                                <input type="file" id="mt5-file-qr-input" accept="image/*" style="display: none;" />
                                <button type="button" id="mt5-btn-scan-qr" style="
                                    background: rgba(0,200,83,0.12);
                                    color: #00c853;
                                    border: 1px solid rgba(0,200,83,0.35);
                                    height: 24px;
                                    padding: 0 9px;
                                    border-radius: 4px;
                                    font-size: 10px;
                                    font-weight: 600;
                                    cursor: pointer;
                                    white-space: nowrap;
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 4px;
                                " title="Upload BRIDGE_QR.png for 100% typo-proof instant setup">
                                    <span>📷</span> Upload QR
                                </button>
                                <button type="button" id="mt5-btn-smart-paste" style="
                                    background: rgba(41,98,255,0.1);
                                    color: ${theme.primary};
                                    border: 1px solid rgba(41,98,255,0.3);
                                    height: 24px;
                                    padding: 0 9px;
                                    border-radius: 4px;
                                    font-size: 10px;
                                    font-weight: 600;
                                    cursor: pointer;
                                    white-space: nowrap;
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 4px;
                                ">
                                    <span>⚡</span> Paste (OCR)
                                </button>
                            </div>
                        </div>

                        <!-- Cumulative Extracted Text / OCR Buffer -->
                        <div id="mt5-ocr-preview-container" style="
                            display: ${this.accumulatedOcrText ? 'flex' : 'none'};
                            flex-direction: column;
                            gap: 4px;
                            background: rgba(41,98,255,0.03);
                            border: 1px dashed rgba(41,98,255,0.3);
                            border-radius: 5px;
                            padding: 6px 8px;
                            box-sizing: border-box;
                        ">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 10px; font-weight: 700; color: ${theme.primary}; display: flex; align-items: center; gap: 4px;">
                                    <span>📝</span> Extracted Text Buffer (Retained across pastes)
                                </span>
                                <div style="display: flex; align-items: center; gap: 5px;">
                                    <button type="button" id="mt5-btn-copy-ocr-buffer" style="background: transparent; border: 1px solid ${theme.border}; color: ${theme.text}; font-size: 9.5px; padding: 1px 6px; border-radius: 3px; cursor: pointer;">📋 Copy All</button>
                                    <button type="button" id="mt5-btn-clear-ocr-buffer" style="background: transparent; border: 1px solid rgba(242,54,69,0.3); color: ${theme.error}; font-size: 9.5px; padding: 1px 6px; border-radius: 3px; cursor: pointer;">✕ Clear Buffer</button>
                                </div>
                            </div>
                            <textarea id="mt5-txt-ocr-buffer" placeholder="Pasted or OCR-extracted text will appear here..." style="
                                width: 100%;
                                height: 75px;
                                box-sizing: border-box;
                                padding: 4px 6px;
                                background: ${theme.inputBg};
                                color: ${theme.inputText};
                                border: 1px solid ${theme.inputBorder};
                                border-radius: 4px;
                                font-size: 10px;
                                font-family: monospace;
                                resize: vertical;
                                line-height: 1.35;
                            ">${this.accumulatedOcrText || ''}</textarea>
                            <div style="font-size: 9px; color: ${theme.textMuted}; display: flex; justify-content: space-between;">
                                <span>Copy or edit any values manually if needed.</span>
                                <span>Retained across multiple pastes until cleared.</span>
                            </div>
                        </div>
                        <!-- Row 1: Server Name, Bridge Endpoint URL, API Key -->
                        <div style="display: grid; grid-template-columns: 1.2fr 2fr 1fr; gap: 8px; width: 100%; box-sizing: border-box; align-items: start;">
                            <div style="min-width: 0;">
                                <div style="height: 18px; display: flex; align-items: center; margin-bottom: 3px;">
                                    <label style="font-size: 10.5px; font-weight: 600; color: ${theme.text};">Server Name *</label>
                                </div>
                                <input type="text" id="mt5-in-new-name" placeholder="e.g. Cloud Bridge, Local VM" style="width: 100%; height: 28px; box-sizing: border-box; padding: 4px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 11px;">
                            </div>
                            <div style="min-width: 0;">
                                <div style="height: 18px; display: flex; align-items: center; margin-bottom: 3px;">
                                    <label style="font-size: 10.5px; font-weight: 600; color: ${theme.text};">Bridge Endpoint URL *</label>
                                </div>
                                <input type="text" id="mt5-in-new-url" placeholder="https://...trycloudflare.com or https://IP:PORT" style="width: 100%; height: 28px; box-sizing: border-box; padding: 4px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 11px; font-family: monospace;">
                            </div>
                            <div style="min-width: 0;">
                                <div style="height: 18px; display: flex; align-items: center; margin-bottom: 3px;">
                                    <label style="font-size: 10.5px; font-weight: 600; color: ${theme.text};">API Key (Password)</label>
                                </div>
                                <div style="position: relative; display: flex; align-items: center; width: 100%; height: 28px;">
                                    <input type="password" id="mt5-in-new-key" value="CHANGE_THIS_BRIDGE_API_KEY" placeholder="API Key" style="width: 100%; height: 28px; box-sizing: border-box; padding: 4px 28px 4px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 11px; font-family: monospace;">
                                    <button type="button" class="mt5-btn-toggle-key-eye" style="position: absolute; right: 4px; height: 20px; width: 20px; background: transparent; border: none; cursor: pointer; font-size: 11px; opacity: 0.7; display: flex; align-items: center; justify-content: center;" title="Show/Hide">👁️</button>
                                </div>
                            </div>
                        </div>
                        <!-- Verification Status: Bridge Server -->
                        <div id="mt5-verify-status-bridge" style="display: none; margin-top: -2px; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 500; line-height: 1.35; box-sizing: border-box;"></div>

                        <!-- Row 2: Gist ID, GitHub PAT Token -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; box-sizing: border-box; align-items: start;">
                            <div style="min-width: 0;">
                                <div style="height: 18px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px;">
                                    <label style="font-size: 10.5px; font-weight: 600; color: ${theme.text};">Auto-Discovery Gist ID (from server BRIDGE_INFO.txt)</label>
                                    <button type="button" id="mt5-btn-fetch-fresh-gist" style="background: rgba(41,98,255,0.12); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.3); border-radius: 3px; font-size: 9.5px; font-weight: 600; padding: 1px 6px; cursor: pointer; display: flex; align-items: center; gap: 3px;" title="Fetch fresh rotating Cloudflare URL from private Gist"><span>🔄</span> Fetch Fresh from Gist</button>
                                </div>
                                <input type="text" id="mt5-in-new-gist-id" placeholder="Optional: 32-char Gist ID generated on server" style="width: 100%; height: 28px; box-sizing: border-box; padding: 4px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 10.5px; font-family: monospace;">
                            </div>
                            <div style="min-width: 0;">
                                <div style="height: 18px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px;">
                                    <label style="font-size: 10.5px; font-weight: 600; color: ${theme.text};">GitHub PAT Token (Encrypted locally)</label>
                                    ${hasMasterToken ? `<span style="font-size: 9px; color: ${theme.success}; font-weight: 600;">✓ Master PAT Active (Leave blank)</span>` : `<span style="font-size: 9px; color: ${theme.textMuted};">Optional if Master PAT set</span>`}
                                </div>
                                <div style="position: relative; display: flex; align-items: center; width: 100%; height: 28px;">
                                    <input type="password" id="mt5-in-new-gist-token" autocomplete="new-password" value="" placeholder="${hasMasterToken ? 'Inherited from Master Token (leave blank)' : 'ghp_... (or configure Master Token above)'}" style="width: 100%; height: 28px; box-sizing: border-box; padding: 4px 28px 4px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 10.5px; font-family: monospace;">
                                    <button type="button" class="mt5-btn-toggle-key-eye" style="position: absolute; right: 4px; height: 20px; width: 20px; background: transparent; border: none; cursor: pointer; font-size: 11px; opacity: 0.7; display: flex; align-items: center; justify-content: center;" title="Show/Hide">👁️</button>
                                </div>
                            </div>
                        </div>
                        <!-- Verification Status: Gist Discovery -->
                        <div id="mt5-verify-status-gist" style="display: none; margin-top: -2px; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 500; line-height: 1.35; box-sizing: border-box;"></div>

                        <!-- Row 3: Origin Zero-Trust Shield Token (Method 2) -->
                        <div style="background: rgba(41,98,255,0.03); border: 1px dashed rgba(41,98,255,0.25); border-radius: 5px; padding: 6px 8px; display: flex; flex-direction: column; gap: 3px; box-sizing: border-box;">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <label style="font-size: 10.5px; font-weight: 600; color: ${theme.primary}; display: flex; align-items: center; gap: 4px;">
                                    <span>🛡️</span> Origin Zero-Trust Shield Token (Optional Path Cloak)
                                </label>
                                <span style="font-size: 9px; color: ${theme.textMuted};">Auto-detected if included in URL path (e.g. /gw_xxx)</span>
                            </div>
                            <div style="position: relative; display: flex; align-items: center; width: 100%; height: 28px;">
                                <input type="password" id="mt5-in-new-shield-token" value="" placeholder="e.g. gw_7f9a2b8e (public scanners without this get blank 404)" style="width: 100%; height: 28px; box-sizing: border-box; padding: 4px 28px 4px 8px; background: ${theme.inputBg}; color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 4px; font-size: 10.5px; font-family: monospace;">
                                <button type="button" class="mt5-btn-toggle-key-eye" style="position: absolute; right: 4px; height: 20px; width: 20px; background: transparent; border: none; cursor: pointer; font-size: 11px; opacity: 0.7; display: flex; align-items: center; justify-content: center;" title="Show/Hide">👁️</button>
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap;">
                            <div id="mt5-verify-summary-badge" style="display: none; font-size: 10.5px; font-weight: 600; padding: 2px 7px; border-radius: 3px;"></div>
                            <div style="display: flex; gap: 6px; align-items: center; margin-left: auto;">
                                <button id="mt5-btn-cancel-add-bridge" type="button" style="background: transparent; color: ${theme.textMuted}; border: 1px solid ${theme.border}; padding: 4px 10px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer;">Cancel</button>
                                <button id="mt5-btn-verify-add-bridge" type="button" style="background: rgba(41,98,255,0.1); color: ${theme.primary}; border: 1px solid rgba(41,98,255,0.35); padding: 4px 11px; border-radius: 4px; font-weight: 600; font-size: 10.5px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" title="Test and verify credentials without adding">
                                    <span>🔍</span> Verify Credentials
                                </button>
                                <button id="mt5-btn-add-endpoint" type="button" style="background: ${theme.primary}; color: #fff; border: none; padding: 4px 12px; border-radius: 4px; font-weight: 600; font-size: 10.5px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                                    <span>➕</span> Add Bridge Server
                                </button>
                            </div>
                        </div>
                    </div>
                    ` : ''}
                </div>
            `;
        }

        openBridgeRouting(accountId) {
            let acc = window.MT5API ? window.MT5API.accounts.find(a => String(a.id) === String(accountId)) : null;
            if (!acc && window.MT5API) {
                acc = window.MT5API.getActiveAccount();
            }
            if (!acc) return;
            this.routingAccount = acc;
            this.viewMode = 'routing';
            this.renderModal();
        }

        getDeleteBridgeSelectorHtml(theme) {
            const acc = this.deleteTargetAccount;
            const login = acc ? acc.login : '';
            const server = acc ? acc.server : '';
            const nick = acc ? acc.nickname : '';
            const endpoints = this.deleteTargetEndpoints || [];

            return `
                <div style="display: flex; flex-direction: column; gap: 12px; padding: 4px 0;">
                    <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid ${theme.border};">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 16px;">🗑️</span>
                            <div>
                                <strong style="font-size: 13px; color: ${theme.error};">Wipe & Delete Account #${login}</strong>
                                <div style="font-size: 11px; color: ${theme.textMuted};">${nick} • ${server}</div>
                            </div>
                        </div>
                        <button id="mt5-btn-cancel-delete-select" type="button" style="background: transparent; border: none; color: ${theme.textMuted}; font-size: 11px; cursor: pointer; font-weight: 600;">✕ Cancel</button>
                    </div>

                    <div style="background: ${theme.errorSoft}; border: 1px solid ${theme.errorBorder}; border-radius: 6px; padding: 10px 12px; font-size: 11.5px; color: ${theme.error}; line-height: 1.4;">
                        ⚠️ <strong>Multi-Bridge Account Detected</strong><br>
                        This account is currently active across <strong>${endpoints.length} connected bridges</strong>.
                        Select which bridge instance(s) to terminate and wipe clean from disk:
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 8px; margin: 4px 0;">
                        ${endpoints.map(ep => `
                            <label style="display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer; padding: 8px 12px; background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px;">
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <input type="checkbox" class="mt5-delete-bridge-sel" value="${ep.id}" checked style="cursor: pointer; width: 16px; height: 16px; accent-color: ${theme.error};">
                                    <div>
                                        <strong style="color: ${theme.text}; font-size: 12px;">${ep.name}</strong>
                                        <span style="display: block; font-size: 10.5px; color: ${theme.textMuted}; font-family: monospace;">${ep.url}</span>
                                    </div>
                                </div>
                                <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(239,68,68,0.1); color: ${theme.error}; font-weight: 600;">Will Wipe Clean</span>
                            </label>
                        `).join('')}
                    </div>

                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; padding-top: 10px; border-top: 1px solid ${theme.border};">
                        <button id="mt5-btn-cancel-delete-view" type="button" style="background: ${theme.cardBg}; color: ${theme.text}; border: 1px solid ${theme.border}; padding: 6px 12px; border-radius: 5px; font-size: 11.5px; font-weight: 600; cursor: pointer;">
                            Cancel
                        </button>
                        <div style="display: flex; gap: 8px;">
                            <button id="mt5-btn-wipe-selected-bridges" type="button" style="background: ${theme.error}; color: #fff; border: none; padding: 6px 14px; border-radius: 5px; font-size: 11.5px; font-weight: 700; cursor: pointer;">
                                Wipe Selected Bridge(s)
                            </button>
                            <button id="mt5-btn-wipe-all-bridges" type="button" style="background: #991b1b; color: #fff; border: 1px solid #ef4444; padding: 6px 14px; border-radius: 5px; font-size: 11.5px; font-weight: 700; cursor: pointer;" title="Terminates and completely wipes instances from ALL bridges">
                                💥 Wipe from ALL Bridges
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }

        getBridgeRoutingHtml(theme) {
            const acc = this.routingAccount || (window.MT5API ? window.MT5API.getActiveAccount() : null);
            if (!acc) {
                this.viewMode = 'list';
                return this.getFleetHtml(theme, window.MT5API?.accounts || [], window.MT5API?.getActiveAccount());
            }

            const endpoints = window.MT5API ? window.MT5API.getEndpoints().filter(e => e.enabled !== false) : [];
            const vault = window.MT5API ? window.MT5API.getClientVault() : [];
            const accLogin = String(acc.login || '').trim();
            const accServer = (acc.server || '').trim().toLowerCase();
            const accId = String(acc.id || '').trim();

            const vaultEntry = vault.find(v => {
                if (!v) return false;
                if (accId && String(v.id || '').trim() === accId) return true;
                const vLogin = String(v.login || '').trim();
                const vServer = (v.server || '').trim().toLowerCase();
                if (accLogin && vLogin === accLogin) {
                    if (!accServer || !vServer) return true;
                    if (accServer === vServer || accServer.includes(vServer) || vServer.includes(accServer)) return true;
                }
                return false;
            });

            // Get current active instances for this account
            const instances = (window.MT5API?.accounts || []).filter(a => {
                const aLogin = String(a.login || '').trim();
                const aServer = (a.server || '').trim().toLowerCase();
                return aLogin === accLogin && (aServer === accServer || aServer.includes(accServer) || accServer.includes(aServer));
            });
            const connectedEndpointIds = new Set(instances.map(a => a.endpointId));

            // Get allowed endpoint IDs from vault (or fallback to connected instances or acc.endpointId)
            let allowedEndpointIds = new Set();
            if (vaultEntry && Array.isArray(vaultEntry.targetEndpoints) && vaultEntry.targetEndpoints.length > 0) {
                vaultEntry.targetEndpoints.forEach(id => allowedEndpointIds.add(id));
            } else if (vaultEntry && vaultEntry.endpointId) {
                allowedEndpointIds.add(vaultEntry.endpointId);
            }
            connectedEndpointIds.forEach(id => allowedEndpointIds.add(id));
            if (acc.endpointId) allowedEndpointIds.add(acc.endpointId);

            const hasStoredPassword = Boolean(vaultEntry && vaultEntry.password);

            return `
                <div style="display: flex; flex-direction: column; gap: 14px;">
                    <!-- Top Navigation Bar -->
                    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <button id="mt5-btn-back-from-routing" type="button" style="
                                background: ${theme.cardBg}; border: 1px solid ${theme.border}; color: ${theme.text};
                                padding: 5px 11px; border-radius: 6px; font-size: 11.5px; font-weight: 600; cursor: pointer;
                                display: inline-flex; align-items: center; gap: 4px;
                            ">
                                <span>←</span> Back to Fleet
                            </button>
                            <strong style="font-size: 14px; color: ${theme.text};">Bridge Routing & Permissions</strong>
                        </div>
                        <div style="font-size: 11px; color: ${theme.textMuted}; font-family: monospace;">
                            Login: <strong>${acc.login}</strong> • Server: <strong>${acc.server}</strong>
                        </div>
                    </div>

                    <!-- Target Account Summary Card -->
                    <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 8px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
                        <div>
                            <div style="font-weight: 700; font-size: 13.5px; color: ${theme.text};">${acc.nickname || acc.login}</div>
                            <div style="font-size: 11px; color: ${theme.textMuted}; margin-top: 2px;">
                                Broker: <strong>${acc.broker_name || acc.server}</strong> • Server: <strong>${acc.server}</strong>
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 10.5px; padding: 3px 8px; border-radius: 6px; background: rgba(8,153,129,0.12); color: #089981; border: 1px solid rgba(8,153,129,0.3); font-weight: 600;">
                                🟢 Active on Connected Bridge
                            </span>
                        </div>
                    </div>

                    <!-- Zero-Credential & RAM Security Notice -->
                    <div style="background: rgba(41,98,255,0.06); border: 1px solid rgba(41,98,255,0.2); border-radius: 8px; padding: 12px 14px; font-size: 11.5px; color: ${theme.text}; line-height: 1.5;">
                        <div style="font-weight: 700; color: ${theme.primary}; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                            <span>🛡️</span> Zero-Credential RAM Security Policy
                        </div>
                        Only bridge servers checked below are authorized to receive credentials for this account.
                        When saved, credentials from your browser vault are deployed directly into volatile memory (RAM + DPAPI).
                        Unchecked bridges immediately have this account deleted and flushed from runtime memory.
                    </div>

                    <!-- Configured Bridge List -->
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <label style="font-size: 12px; font-weight: 700; color: ${theme.text};">
                                Authorized Bridge Servers (${endpoints.length} available):
                            </label>
                            <span style="font-size: 10.5px; color: ${theme.textMuted};">Check bridges to authorize; uncheck to revoke</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 8px;" id="mt5-routing-bridges-list">
                            ${endpoints.map(ep => {
                                const isChecked = allowedEndpointIds.has(ep.id);
                                const isConnected = connectedEndpointIds.has(ep.id);
                                const isOnline = ep.status === 'online';
                                const isLocal = this.isLocalVmBridge(ep);
                                const icon = isLocal ? '💻' : (ep.name.toLowerCase().includes('oracle') ? '☁️' : '⚡');

                                return `
                                    <label style="
                                        display: flex; align-items: center; justify-content: space-between;
                                        padding: 10px 14px; border-radius: 8px; background: ${theme.cardBg};
                                        border: 1px solid ${isChecked ? 'rgba(41,98,255,0.45)' : theme.border};
                                        cursor: pointer; transition: all 0.15s ease;
                                    ">
                                        <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
                                            <input type="checkbox" class="mt5-check-routing-bridge" value="${ep.id}" data-connected="${isConnected ? 'true' : 'false'}" ${isChecked ? 'checked' : ''} style="width: 17px; height: 17px; accent-color: ${theme.primary}; cursor: pointer; flex-shrink: 0;">
                                            <span style="font-size: 20px; flex-shrink: 0;">${icon}</span>
                                            <div style="min-width: 0;">
                                                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                                    <strong style="font-size: 13px; color: ${theme.text};">${ep.name}</strong>
                                                    ${isLocal
                                                        ? `<span style="font-size: 9.5px; padding: 1px 6px; border-radius: 4px; background: rgba(0,200,83,0.15); color: #089981; font-weight: 700; border: 1px solid rgba(0,200,83,0.3);">💻 Local VM</span>`
                                                        : `<span style="font-size: 9.5px; padding: 1px 6px; border-radius: 4px; background: rgba(41,98,255,0.12); color: #2962ff; font-weight: 600; border: 1px solid rgba(41,98,255,0.25);">☁️ Cloud VPS</span>`}
                                                    ${isConnected
                                                        ? `<span style="font-size: 9.5px; padding: 1px 6px; border-radius: 4px; background: rgba(8,153,129,0.12); color: #089981; font-weight: 700; border: 1px solid rgba(8,153,129,0.3);">🟢 Currently Connected</span>`
                                                        : ''}
                                                </div>
                                                <div style="font-size: 11px; color: ${theme.textMuted}; font-family: monospace; margin-top: 2px;">
                                                    ${ep.url}
                                                </div>
                                            </div>
                                        </div>
                                        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                                            <span style="font-size: 10.5px; font-weight: 600; padding: 2px 7px; border-radius: 4px; background: ${isOnline ? 'rgba(8,153,129,0.15)' : 'rgba(242,54,69,0.15)'}; color: ${isOnline ? theme.success : theme.error};">
                                                ${isOnline ? '🟢 Online (' + (ep.ping || 0) + 'ms)' : '🔴 Offline'}
                                            </span>
                                        </div>
                                    </label>
                                `;
                            }).join('')}
                        </div>
                    </div>

                    <!-- Dynamic Password & Status Area (No prompt when already connected!) -->
                    <div id="mt5-routing-status-banner" style="background: rgba(8,153,129,0.08); border: 1px solid rgba(8,153,129,0.25); border-radius: 8px; padding: 10px 14px; font-size: 11.5px; color: ${theme.text}; display: flex; align-items: center; gap: 8px;">
                        <span>🟢</span>
                        <span id="mt5-routing-status-banner-text">Account is already authenticated on its host bridge(s). No password re-entry needed.</span>
                    </div>

                    <div id="mt5-routing-password-box" style="display: none; background: rgba(41,98,255,0.08); border: 1px solid rgba(41,98,255,0.3); border-radius: 8px; padding: 12px; flex-direction: column; gap: 6px;">
                        <label style="font-size: 11.5px; font-weight: 700; color: ${theme.primary};">
                            🔑 Enter Password to Deploy to New Bridge Server:
                        </label>
                        <input type="password" id="mt5-in-routing-password" placeholder="MT5 Trading Password" style="
                            width: 100%; box-sizing: border-box; padding: 8px 12px; background: ${theme.inputBg};
                            color: ${theme.inputText}; border: 1px solid ${theme.inputBorder}; border-radius: 6px; font-size: 12.5px;
                        ">
                        <span style="font-size: 10.5px; color: ${theme.textMuted};">Password will be stored in your private browser vault and sent over encrypted TLS only to newly authorized bridges.</span>
                    </div>

                    <!-- Action buttons -->
                    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-top: 6px;">
                        <span style="font-size: 11px; color: ${theme.textMuted};">
                            Changes take effect immediately on bridge daemons.
                        </span>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <button id="mt5-btn-cancel-routing" type="button" style="
                                background: transparent; border: 1px solid ${theme.border}; color: ${theme.textMuted};
                                padding: 8px 16px; border-radius: 6px; font-size: 12.5px; font-weight: 600; cursor: pointer;
                            ">Cancel</button>
                            <button id="mt5-btn-save-bridge-routing" type="button" style="
                                background: ${theme.primary}; color: #fff; border: none;
                                padding: 8px 18px; border-radius: 6px; font-size: 12.5px; font-weight: 600; cursor: pointer;
                                display: inline-flex; align-items: center; gap: 6px;
                            ">
                                <span>💾</span> Save Bridge Routing
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }

        isMajorSymbol(s, server = '') {
            if (!s) return false;
            const sym = s.name || s.symbol || s;
            if (window.MT5API && typeof window.MT5API.isManagedSymbol === 'function') {
                return window.MT5API.isManagedSymbol(sym);
            }
            return false;
        }

        async openAccountDetails(accountId, forceRefresh = false) {
            this.viewMode = 'details';
            this.detailsAccountId = accountId;
            this.tickerSearchQuery = '';
            this.tickerCategoryFilter = 'managed';
            this.tickerSyncFilter = 'ALL';
            this.tickerUniverseMode = 'MAJOR';
            this.tickerVisibleCount = 100;
            if (window.MT5API && typeof window.MT5API.fetchHFUniverse === 'function') {
                window.MT5API.fetchHFUniverse().catch(() => {});
            }
            this.historySearchQuery = '';
            this.historyTypeFilter = 'ALL';
            this.historyOutcomeFilter = 'ALL';
            this.historyDateFilter = 'ALL';
            this.historySortField = 'time';
            this.historySortDir = 'desc';

            if (forceRefresh) {
                this._accountDetailsCache.delete(accountId);
                const cleanId = String(accountId).replace(/^mt5_/, '');
                this._accountDetailsCache.delete(cleanId);
                this._accountDetailsCache.delete(`mt5_${cleanId}`);
            } else if (this._accountDetailsCache.has(accountId)) {
                const cachedData = this._accountDetailsCache.get(accountId);
                if (cachedData && cachedData.symbols && cachedData.symbols.length > 2) {
                    this.detailsData = cachedData;
                    this.detailsLoading = false;
                    this.detailsSyncing = false;
                    this.renderModal();
                    return;
                }
            }

            // Cleanly resolve the target account without accidental fallback to active account
            let existingAcc = null;
            if (window.MT5API && Array.isArray(window.MT5API.accounts)) {
                const cleanId = String(accountId).replace(/^mt5_/, '').trim();
                existingAcc = window.MT5API.accounts.find(a => 
                    String(a.id) === String(accountId) || 
                    String(a.login).trim() === cleanId || 
                    String(a.id).replace(/^mt5_/, '').trim() === cleanId ||
                    (a.nickname && a.nickname.trim().toLowerCase() === String(accountId).trim().toLowerCase())
                );
            }
            if (!existingAcc && window.MT5API) {
                existingAcc = window.MT5API.getActiveAccount();
            }

            const targetAccountId = existingAcc ? existingAcc.id : accountId;
            this.detailsAccountId = targetAccountId;

            let cachedSymbols = [];
            if (window.MT5API && window.MT5API._accountSymbolsCache) {
                cachedSymbols = window.MT5API._accountSymbolsCache.get(targetAccountId) ||
                                (existingAcc ? window.MT5API._accountSymbolsCache.get(String(existingAcc.login)) : null) ||
                                window.MT5API._accountSymbolsCache.get(accountId) || [];
            }
            let storedHistory = window.MT5API ? window.MT5API.getStoredTradeHistory(targetAccountId) : [];

            if (cachedSymbols.length <= 2) {
                cachedSymbols = [];
                try {
                    const keysToCheck = [
                        `mt5_symbols_${targetAccountId}`,
                        existingAcc ? `mt5_symbols_${existingAcc.login}` : null,
                        `mt5_symbols_${accountId}`
                    ].filter(Boolean);
                    for (const k of keysToCheck) {
                        const localSyms = localStorage.getItem(k);
                        if (localSyms) {
                            const parsed = JSON.parse(localSyms);
                            if (Array.isArray(parsed) && parsed.length > 2) {
                                cachedSymbols = parsed;
                                if (window.MT5API && window.MT5API._accountSymbolsCache) {
                                    window.MT5API._accountSymbolsCache.set(targetAccountId, cachedSymbols);
                                }
                                break;
                            }
                        }
                    }
                } catch (_) {}
            }
            if (storedHistory.length === 0) {
                try {
                    const localHist = localStorage.getItem(`mt5_history_cache_${targetAccountId}`) || (existingAcc ? localStorage.getItem(`mt5_history_cache_${existingAcc.login}`) : null);
                    if (localHist) storedHistory = JSON.parse(localHist);
                } catch (_) {}
            }

            // Initial positions: read from existingAcc.positions, or find in MT5API accounts
            let initialPositions = (existingAcc && Array.isArray(existingAcc.positions)) ? existingAcc.positions : [];
            const cleanLogin = existingAcc ? String(existingAcc.login).trim() : String(targetAccountId).replace(/^mt5_/, '');
            if (initialPositions.length === 0 && window.MT5API && Array.isArray(window.MT5API.accounts)) {
                const foundAcc = window.MT5API.accounts.find(a => String(a.id) === String(targetAccountId) || String(a.login) === cleanLogin || String(a.id).replace(/^mt5_/, '') === cleanLogin);
                if (foundAcc && Array.isArray(foundAcc.positions) && foundAcc.positions.length > 0) {
                    initialPositions = foundAcc.positions;
                }
            }
            if (initialPositions.length === 0 && window.MT5API && Array.isArray(window.MT5API.positions)) {
                const filtered = window.MT5API.positions.filter(p => {
                    const pAid = String(p.account_id || '').trim();
                    return pAid === String(targetAccountId) || pAid === cleanLogin || pAid.replace(/^mt5_/, '') === cleanLogin;
                });
                if (filtered.length > 0) initialPositions = filtered;
            }

            const initialCategories = {};
            cachedSymbols.forEach(s => {
                const cat = s.category || s.type || 'Other';
                if (!initialCategories[cat]) initialCategories[cat] = 0;
                initialCategories[cat]++;
            });

            this.detailsData = {
                account: existingAcc,
                symbols: cachedSymbols,
                positions: initialPositions,
                history: storedHistory,
                categories: initialCategories,
                lastTradeFormatted: (storedHistory && storedHistory.length > 0) ? new Date(storedHistory[0].time).toLocaleString() : (existingAcc && existingAcc.created_at ? `Account added: ${new Date(existingAcc.created_at * 1000).toLocaleDateString()}` : 'Ready'),
                totalSymbols: cachedSymbols.length,
                fetchedAt: Date.now()
            };

            const hasInstantCache = cachedSymbols.length > 2;
            this.detailsLoading = false;
            this.detailsSyncing = !hasInstantCache;
            this.detailsProgress = hasInstantCache ? null : { step: 1, title: 'Connecting to MT5 Profile...', detail: `Checking account specs for #${existingAcc ? existingAcc.login : accountId}`, pct: 25 };
            
            // Preload Hugging Face datasets in background across Bridge & Community authors
            if (window.MT5ParquetIndex && typeof window.MT5ParquetIndex.preloadAllAuthorDatasets === 'function') {
                window.MT5ParquetIndex.preloadAllAuthorDatasets().then(() => {
                    if (this.isOpen && this.viewMode === 'details' && this.detailsSubTab === 'tickers') {
                        const curModal = document.getElementById(this.modalId);
                        const srv = this.detailsData && this.detailsData.account ? this.detailsData.account.server : '';
                        if (curModal) this.updateTickerListView(curModal, this.getTheme(), srv);
                    }
                }).catch(() => {});
            }

            // Render modal in 0ms!
            this.renderModal();

            // Immediately fetch active positions asynchronously so the badge is guaranteed up-to-date in <50ms without waiting for full sync
            if (window.MT5API) {
                window.MT5API.fetchPositions(targetAccountId).then(pos => {
                    if (Array.isArray(pos)) {
                        if (this.detailsData && String(this.detailsAccountId) === String(targetAccountId)) {
                            this.detailsData.positions = pos;
                        }
                        this.handleLivePositionUpdate(pos);
                    }
                }).catch(() => {});
            }

            const onProgress = (step, title, detail, pct) => {
                this.detailsProgress = { step, title, detail, pct };
                this.updateDetailsSyncProgress(title, detail, pct);
            };

            try {
                if (window.MT5API) {
                    const data = await window.MT5API.fetchAccountFullDetails(targetAccountId, onProgress);
                    if (data) {
                        this.detailsData = data;
                        if (data.account && data.account.id) {
                            this.detailsAccountId = data.account.id;
                        }
                        this._accountDetailsCache.set(this.detailsAccountId, data);
                        if (data.positions) {
                            this.handleLivePositionUpdate(data.positions);
                        }
                    }
                }
            } catch (err) {
                console.error('[MT5UI] Failed to fetch account details:', err);
            } finally {
                this.detailsSyncing = false;
                this.detailsProgress = null;
                const modal = document.getElementById(this.modalId);
                if (modal) {
                    const syncBox = modal.querySelector('#mt5-details-sync-progress-box');
                    if (syncBox) syncBox.remove();
                    this.updateLiveDetailsFinancials();
                    const theme = this.getTheme();
                    const srv = this.detailsData && this.detailsData.account ? this.detailsData.account.server : '';
                    if (this.detailsSubTab === 'tickers') this.updateTickerListView(modal, theme, srv);
                    if (this.detailsSubTab === 'history') this.updateHistoryListView(modal, theme);
                    if (this.detailsSubTab === 'positions') this.updatePositionsListView(modal, theme, srv);
                    const tabTickers = modal.querySelector('.mt5-subtab-btn[data-subtab="tickers"]');
                    if (tabTickers && this.detailsData && this.detailsData.symbols) {
                        tabTickers.innerHTML = `<span>📈</span> Market Watch & Tickers (${this.detailsData.symbols.length})`;
                    }
                    const tabPos = modal.querySelector('#mt5-tab-positions-count');
                    if (tabPos) {
                        const posCount = (this.detailsData && Array.isArray(this.detailsData.positions)) ? this.detailsData.positions.length : 0;
                        tabPos.textContent = `💼 Active Positions (${posCount})`;
                    }
                    if (this.detailsData && this.detailsData.account) {
                        const nickEl = modal.querySelector('#mt5-details-account-nickname');
                        if (nickEl && this.detailsData.account.nickname) nickEl.textContent = this.detailsData.account.nickname;
                        const loginEl = modal.querySelector('#mt5-details-account-login');
                        if (loginEl && this.detailsData.account.login) loginEl.textContent = `#${this.detailsData.account.login}`;
                    }
                }
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

            let targetAcc = null;
            if (brokerServer && window.MT5API && window.MT5API.accounts) {
                targetAcc = window.MT5API.accounts.find(a => 
                    a.server === brokerServer || 
                    String(a.id) === String(brokerServer) || 
                    (a.nickname && a.nickname.toLowerCase() === String(brokerServer).toLowerCase()) ||
                    (window.MT5API.getCleanBrokerExchange(a) === String(brokerServer).toUpperCase())
                );
            }
            if (!targetAcc && window.MT5API) {
                targetAcc = window.MT5API.getActiveAccount();
            }

            // Sync active account if loading for a specific broker account
            if (targetAcc && window.MT5API && String(targetAcc.id) !== String(window.MT5API.activeAccountId)) {
                await window.MT5API.setActiveAccount(targetAcc.id);
            }

            const brokerExchange = window.MT5API ? window.MT5API.getCleanBrokerExchange(targetAcc) : 'MT5';
            const cleanSym = String(symbol || '').split(':').pop().trim();
            const targetSymbol = brokerExchange ? `${brokerExchange}:${cleanSym}` : cleanSym;

            console.log(`[MT5UI] Loading symbol on chart: ${targetSymbol}`);

            // Background archival priority trigger for on-demand tickers (chart renders live without waiting)
            if (window.MT5API && typeof window.MT5API.triggerHFSync === 'function') {
                const srv = targetAcc ? targetAcc.server : (brokerServer || '');
                window.MT5API.triggerHFSync(cleanSym, srv).catch(() => {});
            }

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
                    chart.setSymbol(targetSymbol, () => {
                        if (typeof chart.resetData === 'function') {
                            try { chart.resetData(); } catch (_) {}
                        }
                    });
                    setTimeout(() => {
                        if (typeof chart.resetData === 'function') {
                            try { chart.resetData(); } catch (_) {}
                        }
                    }, 150);
                } else if (typeof chart.resetData === 'function') {
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

            // 1. Text Search (symbol, ticket, comment, or deposit)
            if (this.historySearchQuery) {
                const q = this.historySearchQuery.toUpperCase().trim();
                list = list.filter(h => {
                    const isDep = (h.type === 'BALANCE' || h.type === 'CREDIT' || !h.symbol || h.symbol === 'BALANCE');
                    const symMatch = h.symbol && h.symbol.toUpperCase().includes(q);
                    const ticketMatch = String(h.ticket).includes(q) || String(h.order).includes(q);
                    const commentMatch = h.comment && h.comment.toUpperCase().includes(q);
                    const depMatch = isDep && 'DEPOSIT BALANCE INITIAL FUNDING'.includes(q);
                    return symMatch || ticketMatch || commentMatch || depMatch;
                });
            }

            // 2. Type Filter (ALL/CLOSED, TRADES, BUY, SELL, DEPOSIT, ALL_LOGS)
            const typeFilter = this.historyTypeFilter || 'ALL';
            const hasOuts = list.some(h => h.entry === 'OUT');
            if (typeFilter === 'ALL' || typeFilter === 'CLOSED') {
                // By default: Show closed completed trades (entry === 'OUT') so each trade appears cleanly ONCE without duplication!
                if (hasOuts) {
                    list = list.filter(h => h.entry === 'OUT');
                } else {
                    list = list.filter(h => h.type === 'BUY' || h.type === 'SELL');
                }
            } else if (typeFilter === 'TRADES') {
                list = list.filter(h => h.type === 'BUY' || h.type === 'SELL');
            } else if (typeFilter === 'BUY') {
                list = list.filter(h => h.type === 'BUY' && (!hasOuts || h.entry === 'OUT'));
            } else if (typeFilter === 'SELL') {
                list = list.filter(h => h.type === 'SELL' && (!hasOuts || h.entry === 'OUT'));
            } else if (typeFilter === 'DEPOSIT') {
                list = list.filter(h => h.type === 'BALANCE' || h.type === 'CREDIT' || !h.symbol || h.symbol === 'BALANCE');
            } else if (typeFilter === 'ALL_LOGS') {
                // Keep raw full deal transactions
            }

            // 3. Outcome Filter (ALL, WIN, LOSS) - strictly market trades, NOT balance deposits!
            if (this.historyOutcomeFilter === 'WIN') {
                list = list.filter(h => (h.type === 'BUY' || h.type === 'SELL') && Number(h.profit || 0) > 0);
            } else if (this.historyOutcomeFilter === 'LOSS') {
                list = list.filter(h => (h.type === 'BUY' || h.type === 'SELL') && Number(h.profit || 0) < 0);
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
            const rows = list.map(h => {
                const isDeposit = (h.type === 'BALANCE' || h.type === 'CREDIT' || !h.symbol || h.symbol === 'BALANCE');
                return [
                    h.ticket,
                    h.order,
                    isDeposit ? 'Account Deposit' : h.symbol,
                    isDeposit ? 'DEPOSIT' : h.type,
                    isDeposit ? '0' : h.volume,
                    isDeposit ? '0' : h.price,
                    h.profit,
                    h.swap || 0,
                    h.commission || 0,
                    h.time_formatted || (h.time ? new Date(h.time).toISOString() : ''),
                    `"${(h.comment || '').replace(/"/g, '""')}"`
                ];
            });
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
                const isDaemonV1 = window.MT5API && window.MT5API._historyEndpointSupported === false;
                return `
                    <div style="text-align: center; padding: 36px 20px; background: ${theme.cardBg}; border: 1px dashed ${theme.border}; border-radius: 8px;">
                        <div style="font-size: 26px; margin-bottom: 6px;">📜</div>
                        <div style="font-weight: 700; font-size: 13.5px; color: ${theme.text};">No Closed Trades Recorded Yet</div>
                        <div style="font-size: 11.5px; color: ${theme.textMuted}; margin-top: 6px; max-width: 440px; margin-left: auto; margin-right: auto; line-height: 1.4;">
                            ${isDaemonV1 
                                ? 'Trades executed or closed through TradingView will record here automatically.<br>To synchronize historical closed deals directly from your MT5 terminal database, restart <strong style="color: ' + theme.text + ';">Start_MT5_Bridge.bat</strong> on your Windows desktop.' 
                                : 'No closed deals match the active filters. Try resetting search or time period filters.'}
                        </div>
                    </div>
                `;
            }

            const arrow = (col) => {
                if (this.historySortField !== col) return '<span style="opacity:0.3; margin-left:3px;">⇅</span>';
                return this.historySortDir === 'asc' ? '<span style="color:#2962ff; margin-left:3px;">▲</span>' : '<span style="color:#2962ff; margin-left:3px;">▼</span>';
            };

            return `
                <div style="overflow-x: auto; overflow-y: auto; border: 1px solid ${theme.border}; border-radius: 8px; max-height: min(380px, 48vh);">
                    <table style="width: 100%; border-collapse: collapse; font-size: 11.5px; text-align: left;">
                        <thead>
                            <tr style="background: ${theme.cardBg}; border-bottom: 1px solid ${theme.border}; color: ${theme.textMuted}; position: sticky; top: 0; z-index: 2;">
                                <th class="mt5-sort-header" data-sort="ticket" style="padding: 8px 10px; cursor: pointer; user-select: none;">Ticket ${arrow('ticket')}</th>
                                <th class="mt5-sort-header" data-sort="symbol" style="padding: 8px 10px; cursor: pointer; user-select: none;">Symbol ${arrow('symbol')}</th>
                                <th class="mt5-sort-header" data-sort="type" style="padding: 8px 10px; cursor: pointer; user-select: none;">Type ${arrow('type')}</th>
                                <th class="mt5-sort-header" data-sort="volume" style="padding: 8px 10px; cursor: pointer; user-select: none;">Lots ${arrow('volume')}</th>
                                <th style="padding: 8px 10px;">Price</th>
                                <th class="mt5-sort-header" data-sort="profit" style="padding: 8px 10px; text-align: right; cursor: pointer; user-select: none;">P&L ($) ${arrow('profit')}</th>
                                <th class="mt5-sort-header" data-sort="time" style="padding: 8px 10px; cursor: pointer; user-select: none;">Close Time ${arrow('time')}</th>
                                <th style="padding: 8px 10px; text-align: center;">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${list.map(h => {
                                const isDeposit = (h.type === 'BALANCE' || h.type === 'CREDIT' || !h.symbol || h.symbol === 'BALANCE');
                                const isBuy = String(h.type).toUpperCase() === 'BUY';
                                const profit = Number(h.profit || 0);
                                const timeStr = h.time_formatted || (h.time ? new Date(h.time).toLocaleString() : 'N/A');

                                if (isDeposit) {
                                    return `
                                        <tr style="border-bottom: 1px solid ${theme.border}; background: rgba(41, 98, 255, 0.04);">
                                            <td style="padding: 7px 10px; font-family: monospace; color: ${theme.textMuted};">#${h.ticket}</td>
                                            <td style="padding: 7px 10px; font-weight: 600; color: ${theme.primary}; font-family: monospace;">Account Deposit</td>
                                            <td style="padding: 7px 10px;"><span style="background: rgba(41,98,255,0.15); color: ${theme.primary}; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 10px;">DEPOSIT</span></td>
                                            <td style="padding: 7px 10px; color: ${theme.textMuted};">—</td>
                                            <td style="padding: 7px 10px; color: ${theme.textMuted};">—</td>
                                            <td style="padding: 7px 10px; text-align: right; font-weight: 700; color: ${theme.primary}; font-family: monospace;">+$${profit.toFixed(2)}</td>
                                            <td style="padding: 7px 10px; color: ${theme.textMuted}; white-space: nowrap;">${timeStr}</td>
                                            <td style="padding: 7px 10px; text-align: center; color: ${theme.textMuted};">—</td>
                                        </tr>
                                    `;
                                }

                                const profitColor = profit >= 0 ? theme.success : theme.error;
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

        updateFleetCardsInPlace() {
            const modal = document.getElementById(this.modalId);
            if (!modal || this.viewMode !== 'list') return;
            const accounts = window.MT5API ? window.MT5API.accounts : [];
            const theme = this.getTheme();

            // Group all accounts by physical login::server
            const accountsByPhysicalKey = new Map();
            accounts.forEach(acc => {
                const key = `${String(acc.login || '').trim()}::${String(acc.server || '').trim().toLowerCase()}`;
                if (!accountsByPhysicalKey.has(key)) {
                    accountsByPhysicalKey.set(key, []);
                }
                accountsByPhysicalKey.get(key).push(acc);
            });

            let grandTotalBal = 0;
            let grandTotalEq = 0;

            accountsByPhysicalKey.forEach((instances) => {
                const bestBal = Math.max(...instances.map(i => Number(i.balance || 0)));
                const bestEq = Math.max(...instances.map(i => Number(i.equity || 0)));
                const anyConnected = instances.some(i => i.is_connected);
                const primary = instances.find(i => Number(i.balance || 0) > 0) || instances[0];
                const accId = primary ? String(primary.id) : '';
                const accLogin = primary ? String(primary.login || '').trim() : '';

                const balVal = bestBal > 0 ? bestBal : (primary ? Number(primary.balance || 0) : 0);
                const eqVal = bestEq > 0 ? bestEq : (primary ? Number(primary.equity || 0) : 0);
                const pnl = eqVal - balVal;

                grandTotalBal += balVal;
                grandTotalEq += eqVal;

                // Match element by data-id OR data-login
                const qBal = accLogin ? `.mt5-card-bal[data-login="${accLogin}"], .mt5-card-bal[data-id="${accId}"]` : `.mt5-card-bal[data-id="${accId}"]`;
                const qEq = accLogin ? `.mt5-card-eq[data-login="${accLogin}"], .mt5-card-eq[data-id="${accId}"]` : `.mt5-card-eq[data-id="${accId}"]`;
                const qPnl = accLogin ? `.mt5-card-pnl[data-login="${accLogin}"], .mt5-card-pnl[data-id="${accId}"]` : `.mt5-card-pnl[data-id="${accId}"]`;
                const qDot = accLogin ? `.mt5-card-status-dot[data-login="${accLogin}"], .mt5-card-status-dot[data-id="${accId}"]` : `.mt5-card-status-dot[data-id="${accId}"]`;

                modal.querySelectorAll(qBal).forEach(el => {
                    el.textContent = `$${balVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                });
                modal.querySelectorAll(qEq).forEach(el => {
                    el.textContent = `$${eqVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                    el.style.color = pnl >= 0 ? theme.success : theme.error;
                });
                modal.querySelectorAll(qPnl).forEach(el => {
                    el.textContent = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
                    el.style.color = pnl >= 0 ? theme.success : theme.error;
                });
                modal.querySelectorAll(qDot).forEach(el => {
                    const isPaused = window.MT5API ? window.MT5API.isAccountPaused(accId) : false;
                    el.textContent = isPaused ? '⚪' : (anyConnected ? '🟢' : '🟡');
                });
            });

            // Update top aggregate summary bar
            const totalBalEl = modal.querySelector('#mt5-fleet-total-bal');
            const totalEqEl = modal.querySelector('#mt5-fleet-total-eq');
            const totalPnlWrap = modal.querySelector('#mt5-fleet-total-pnl-wrap');
            const totalPnlEl = modal.querySelector('#mt5-fleet-total-pnl');

            const floatingGrand = grandTotalEq - grandTotalBal;

            if (totalBalEl) totalBalEl.textContent = `$${grandTotalBal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            if (totalEqEl) {
                totalEqEl.textContent = `$${grandTotalEq.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                totalEqEl.style.color = grandTotalEq >= grandTotalBal ? theme.success : theme.error;
            }
            if (totalPnlEl && totalPnlWrap) {
                if (Math.abs(floatingGrand) >= 0.01) {
                    totalPnlWrap.style.display = 'inline';
                    totalPnlEl.textContent = `${floatingGrand >= 0 ? '+' : ''}$${floatingGrand.toFixed(2)}`;
                    totalPnlEl.style.color = floatingGrand >= 0 ? theme.success : theme.error;
                } else {
                    totalPnlWrap.style.display = 'none';
                }
            }
        }

        updateLiveDetailsFinancials() {
            const modal = document.getElementById(this.modalId);
            if (!modal || this.viewMode !== 'details' || !this.detailsAccountId) return;
            const allAccounts = window.MT5API ? window.MT5API.accounts : [];
            const acc = allAccounts.find(a => String(a.id) === String(this.detailsAccountId));
            if (!acc) return;

            const siblings = allAccounts.filter(a => String(a.login) === String(acc.login) && (a.server || '').toLowerCase() === (acc.server || '').toLowerCase());
            const bestBal = Math.max(...siblings.map(s => Number(s.balance || 0)), Number(acc.balance || 0));
            const bestEq = Math.max(...siblings.map(s => Number(s.equity || 0)), Number(acc.equity || 0));
            const bal = bestBal > 0 ? bestBal : Number(acc.balance || 0);
            const eq = bestEq > 0 ? bestEq : Number(acc.equity || bal);

            const balEl = modal.querySelector('#mt5-cockpit-balance');
            const eqEl = modal.querySelector('#mt5-cockpit-equity');
            const freeEl = modal.querySelector('#mt5-cockpit-free-margin');
            const usedEl = modal.querySelector('#mt5-cockpit-used-margin');
            const barEl = modal.querySelector('#mt5-cockpit-margin-bar');

            const pnl = eq - bal;
            const pnlPct = bal > 0 ? ((pnl / bal) * 100).toFixed(2) : '0.00';
            const margin = Number(acc.margin || 0);
            const freeMargin = Number(acc.margin_free || (bal - margin));
            const marginUsedPct = bal > 0 ? Math.min(100, Math.max(0, (margin / bal) * 100)).toFixed(1) : '0.0';
            const freeMarginPct = Math.max(0, 100 - Number(marginUsedPct));

            if (balEl) balEl.innerHTML = `$${bal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} <span style="font-size: 10px; color: ${this.getTheme().textMuted}; font-weight: 400; margin-left: 2px;">${acc.currency || 'USD'}</span>`;
            if (eqEl) {
                eqEl.innerHTML = `$${eq.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} <span style="font-size: 10px; font-weight: 600; margin-left: 3px;">(${pnl >= 0 ? '+' : ''}${pnlPct}%)</span>`;
                eqEl.style.color = pnl >= 0 ? this.getTheme().success : this.getTheme().error;
            }
            if (freeEl) freeEl.textContent = `$${freeMargin.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            if (usedEl) usedEl.textContent = `Used: $${margin.toFixed(2)} (${marginUsedPct}%)`;
            if (barEl) barEl.style.width = `${freeMarginPct}%`;
        }

        handleLivePositionUpdate(positions) {
            if (!Array.isArray(positions)) return;

            // 1. Map open position profits directly to each account in MT5API in real time
            if (window.MT5API && Array.isArray(window.MT5API.accounts)) {
                const hasAccountTags = positions.some(p => p && p.account_id);
                window.MT5API.accounts.forEach(acc => {
                    const accId = String(acc.id || '').trim();
                    const accLogin = String(acc.login || '').trim();
                    const cleanId = accId.replace(/^mt5_/, '');

                    const accPos = positions.filter(p => {
                        const pAid = String(p.account_id || '').trim();
                        return pAid === accId || pAid === accLogin || pAid.replace(/^mt5_/, '') === accLogin || pAid === cleanId;
                    });

                    if (accPos.length > 0) {
                        acc.positions = accPos;
                        const openProfit = accPos.reduce((sum, p) => sum + (Number(p.profit) || 0), 0);
                        acc.equity = Number(acc.balance || 0) + openProfit;
                    } else if (hasAccountTags) {
                        // Full fleet snapshot with account tags received, and this account has no positions
                        acc.positions = [];
                    }
                });
            }

            // 2. If list view is active, update fleet cards in real-time over WebSocket!
            if (this.isOpen && this.viewMode === 'list') {
                this.updateFleetCardsInPlace();
            }

            // 3. If details view is active, update cockpit financials in real-time over WebSocket!
            if (this.isOpen && this.viewMode === 'details') {
                this.updateLiveDetailsFinancials();
            }

            this.updateButtonState();

            const modal = document.getElementById(this.modalId);
            if (!modal) return;

            let relevantPositions = positions;
            if (this.viewMode === 'details' && this.detailsAccountId) {
                const targetId = String(this.detailsAccountId).trim();
                const cleanId = targetId.replace(/^mt5_/, '');

                const targetAcc = (window.MT5API && Array.isArray(window.MT5API.accounts)) 
                    ? window.MT5API.accounts.find(a => String(a.id) === targetId || String(a.login) === cleanId || String(a.id).replace(/^mt5_/, '') === cleanId || String(a.login) === targetId)
                    : null;

                const targetLogin = targetAcc ? String(targetAcc.login || '').trim() : (this.detailsData && this.detailsData.account ? String(this.detailsData.account.login || '').trim() : '');
                const targetAccId = targetAcc ? String(targetAcc.id || '').trim() : (this.detailsData && this.detailsData.account ? String(this.detailsData.account.id || '').trim() : '');

                // Filter positions tagged for this account
                const matchingInPayload = relevantPositions.filter(p => {
                    const pAid = String(p.account_id || '').trim();
                    if (!pAid) return true; // untagged payload from direct account fetch
                    return pAid === targetId || 
                           pAid === cleanId || 
                           pAid.replace(/^mt5_/, '') === cleanId ||
                           (targetLogin && (pAid === targetLogin || pAid.replace(/^mt5_/, '') === targetLogin)) ||
                           (targetAccId && (pAid === targetAccId || pAid.replace(/^mt5_/, '') === targetAccId));
                });

                if (matchingInPayload.length > 0) {
                    relevantPositions = matchingInPayload;
                } else if (targetAcc && Array.isArray(targetAcc.positions) && targetAcc.positions.length > 0) {
                    relevantPositions = targetAcc.positions;
                } else if (this.detailsData && Array.isArray(this.detailsData.positions) && this.detailsData.positions.length > 0) {
                    // Retain already-loaded positions: never wipe with an empty array from a different account!
                    relevantPositions = this.detailsData.positions;
                } else if (relevantPositions.length > 0 && relevantPositions.every(p => {
                    const pAid = String(p.account_id || '').trim();
                    return pAid && pAid !== targetId && pAid !== cleanId && pAid !== targetLogin && pAid !== targetAccId;
                })) {
                    // The payload strictly belongs to other accounts, preserve whatever detailsData has
                    relevantPositions = (this.detailsData && Array.isArray(this.detailsData.positions)) ? this.detailsData.positions : [];
                } else {
                    relevantPositions = [];
                }

                if (this.detailsData) {
                    this.detailsData.positions = relevantPositions;
                    if (targetAcc && relevantPositions.length > 0) targetAcc.positions = relevantPositions;
                }
            }

            const count = (relevantPositions && Array.isArray(relevantPositions)) ? relevantPositions.length : 0;

            // Update badge on Active Positions tab
            const posBadge = modal.querySelector('#mt5-tab-positions-count');
            if (posBadge) {
                posBadge.textContent = `💼 Active Positions (${count})`;
            }

            // If user is currently looking at Active Positions tab, update table live without rebuilding whole modal
            if (this.viewMode === 'details' && this.detailsSubTab === 'positions') {
                const container = modal.querySelector('#mt5-positions-items-container');
                if (container && this.detailsData) {
                    this.detailsData.positions = relevantPositions;
                    const theme = this.getTheme();
                    const srv = this.detailsData.account ? this.detailsData.account.server : '';
                    
                    // Preserve scroll position
                    const innerBox = container.querySelector('div[style*="overflow"]');
                    const prevScroll = innerBox ? innerBox.scrollTop : 0;
                    this.updatePositionsListView(modal, theme, srv);
                    const newInnerBox = container.querySelector('div[style*="overflow"]');
                    if (newInnerBox) newInnerBox.scrollTop = prevScroll;
                }
            }
        }

        showNotification(notif) {
            if (!notif) return;

            // Debounce / deduplicate toasts: suppress identical notifications for the same ticket within 15 seconds
            if (!this._recentToastDedup) this._recentToastDedup = new Map();
            const toastKey = `${notif.type}_${notif.ticket}_${notif.action}`;
            const now = Date.now();
            if (this._recentToastDedup.has(toastKey) && (now - this._recentToastDedup.get(toastKey) < 15000)) {
                return;
            }
            this._recentToastDedup.set(toastKey, now);

            let container = document.getElementById('mt5-notifications-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'mt5-notifications-container';
                container.style.cssText = `
                    position: fixed;
                    top: 65px;
                    right: 20px;
                    z-index: 9999999;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    max-width: 380px;
                    pointer-events: none;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                `;
                document.body.appendChild(container);
            }

            // Cap visible toast stack to max 3 notifications (auto-remove oldest)
            while (container.children.length >= 3) {
                const oldest = container.firstChild;
                if (oldest) oldest.remove();
            }

            const toast = document.createElement('div');
            toast.style.cssText = `
                pointer-events: auto;
                background: rgba(30, 34, 45, 0.96);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 8px;
                padding: 10px 14px;
                color: #ffffff;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
                display: flex;
                flex-direction: column;
                gap: 5px;
                font-size: 12px;
                transform: translateX(40px);
                opacity: 0;
                transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
            `;

            let icon = '🔔';
            let borderColor = '#2962ff';
            let titleColor = '#2962ff';
            const action = notif.action || 'Trade Update';
            const type = notif.type || 'info';
            const symbol = notif.symbol || '';
            const side = notif.side || '';
            const lots = notif.lots || 0;
            const price = notif.price || 0;
            const profit = notif.profit;
            const accountName = notif.accountName || '';

            if (type === 'opened') {
                const isBuy = String(side).toUpperCase() === 'BUY';
                icon = isBuy ? '🟢' : '🔴';
                borderColor = isBuy ? '#089981' : '#f23645';
                titleColor = borderColor;
            } else if (type === 'closed') {
                const isWin = Number(profit || 0) >= 0;
                icon = isWin ? '🎉' : '📉';
                borderColor = isWin ? '#089981' : '#f23645';
                titleColor = borderColor;
            } else if (type === 'modified') {
                icon = '⚙️';
                borderColor = '#ff9800';
                titleColor = '#ff9800';
            }

            toast.style.borderLeft = `4px solid ${borderColor}`;

            let detailHtml = '';
            if (type === 'opened') {
                detailHtml = `<strong style="color: ${titleColor};">${side} ${lots} ${symbol}</strong> @ <span>${price}</span>`;
            } else if (type === 'closed') {
                const profitNum = Number(profit || 0);
                const pColor = profitNum >= 0 ? '#089981' : '#f23645';
                detailHtml = `<span>${side} ${lots} ${symbol}</span> • PnL: <strong style="color: ${pColor};">${profitNum >= 0 ? '+' : ''}$${profitNum.toFixed(2)}</strong>`;
            } else if (type === 'modified') {
                detailHtml = `<span>${symbol}</span> • SL: ${notif.newSl || 'None'} | TP: ${notif.newTp || 'None'}`;
            }

            toast.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span>${icon}</span>
                        <strong style="font-size: 11.5px; color: ${titleColor}; text-transform: uppercase;">${action}</strong>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        ${accountName ? `<span style="font-size: 9.5px; background: rgba(255,255,255,0.08); padding: 1px 6px; border-radius: 4px; color: #787b86;">${accountName}</span>` : ''}
                        <button class="mt5-toast-close" style="background: none; border: none; color: #787b86; cursor: pointer; font-size: 13px; line-height: 1; padding: 0;">✕</button>
                    </div>
                </div>
                <div style="font-size: 12px; color: #d1d4dc; margin-top: 1px;">
                    ${detailHtml}
                </div>
            `;

            const closeBtn = toast.querySelector('.mt5-toast-close');
            let isRemoved = false;
            const dismiss = () => {
                if (isRemoved) return;
                isRemoved = true;
                toast.style.transform = 'translateX(40px)';
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 250);
            };
            if (closeBtn) closeBtn.onclick = dismiss;

            container.appendChild(toast);
            requestAnimationFrame(() => {
                toast.style.transform = 'translateX(0)';
                toast.style.opacity = '1';
            });

            setTimeout(dismiss, 5000);
        }

        getPositionsTableHtml(positions, theme, server) {
            if (!positions || positions.length === 0) {
                return `
                    <div style="text-align: center; padding: 36px 20px; background: ${theme.cardBg}; border: 1px dashed ${theme.border}; border-radius: 8px;">
                        <div style="font-size: 26px; margin-bottom: 6px;">💼</div>
                        <div style="font-weight: 700; font-size: 13.5px; color: ${theme.text};">Live MT5 Stream Connected</div>
                        <div style="font-size: 11.5px; color: ${theme.textMuted}; margin-top: 4px; max-width: 420px; margin-left: auto; margin-right: auto; line-height: 1.4;">
                            There are no active open positions on this account right now.<br>New trades opened via TradingView or your MT5 terminal will track here in real time.
                        </div>
                        <div style="margin-top: 14px; display: flex; justify-content: center; gap: 8px;">
                            <button class="mt5-subtab-btn" data-subtab="tickers" style="
                                background: ${theme.primary};
                                color: #fff;
                                border: none;
                                padding: 6px 14px;
                                border-radius: 6px;
                                font-size: 11.5px;
                                font-weight: 600;
                                cursor: pointer;
                                display: inline-flex;
                                align-items: center;
                                gap: 6px;
                            "><span>📈</span> Explore Market Watch</button>
                            <button class="mt5-subtab-btn" data-subtab="history" style="
                                background: rgba(41,98,255,0.1);
                                color: ${theme.primary};
                                border: 1px solid rgba(41,98,255,0.25);
                                padding: 6px 14px;
                                border-radius: 6px;
                                font-size: 11.5px;
                                font-weight: 600;
                                cursor: pointer;
                                display: inline-flex;
                                align-items: center;
                                gap: 6px;
                            "><span>📜</span> View Order History</button>
                        </div>
                    </div>
                `;
            }

            return `
                <div style="overflow-x: auto; overflow-y: auto; border: 1px solid ${theme.border}; border-radius: 8px; max-height: min(380px, 48vh);">
                    <table style="width: 100%; border-collapse: collapse; font-size: 11.5px; text-align: left;">
                        <thead>
                            <tr style="background: ${theme.cardBg}; border-bottom: 1px solid ${theme.border}; color: ${theme.textMuted}; position: sticky; top: 0; z-index: 2;">
                                <th style="padding: 7px 10px;">Ticket</th>
                                <th style="padding: 7px 10px;">Symbol</th>
                                <th style="padding: 7px 10px;">Type</th>
                                <th style="padding: 7px 10px;">Lots</th>
                                <th style="padding: 7px 10px;">Open Price</th>
                                <th style="padding: 7px 10px;">Current</th>
                                <th style="padding: 7px 10px;">SL / TP</th>
                                <th style="padding: 7px 10px; text-align: right;">Floating P&L ($)</th>
                                <th style="padding: 7px 10px; text-align: center;">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${positions.map(p => {
                                const isBuy = (p.type === 0 || String(p.type).toUpperCase() === 'BUY');
                                const typeColor = isBuy ? theme.success : theme.error;
                                const profit = Number(p.profit || 0);
                                const profitColor = profit >= 0 ? theme.success : theme.error;
                                const lots = p.lots != null ? p.lots : (p.volume != null ? p.volume : '-');
                                const openPrice = p.open_price != null ? p.open_price : (p.price_open != null ? p.price_open : '-');
                                const currentPrice = p.current_price != null ? p.current_price : (p.price_current != null ? p.price_current : '-');
                                return `
                                    <tr style="border-bottom: 1px solid ${theme.border};">
                                        <td style="padding: 7px 10px; font-family: monospace; color: ${theme.textMuted};">#${p.ticket}</td>
                                        <td style="padding: 7px 10px; font-weight: 700; color: ${theme.text}; font-family: monospace;">${p.symbol}</td>
                                        <td style="padding: 7px 10px; font-weight: 700; color: ${typeColor};">${isBuy ? 'BUY' : 'SELL'}</td>
                                        <td style="padding: 7px 10px;">${lots}</td>
                                        <td style="padding: 7px 10px;">${openPrice}</td>
                                        <td style="padding: 7px 10px;">${currentPrice}</td>
                                        <td style="padding: 7px 10px; color: ${theme.textMuted};">${p.sl || '0'} / ${p.tp || '0'}</td>
                                        <td style="padding: 7px 10px; text-align: right; font-weight: 700; color: ${profitColor}; font-family: monospace;">${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}</td>
                                        <td style="padding: 7px 10px; text-align: center; white-space: nowrap;">
                                            <button class="mt5-btn-chart-symbol" data-symbol="${p.symbol}" data-server="${server || ''}" style="
                                                padding: 2px 7px;
                                                border-radius: 4px;
                                                font-size: 10px;
                                                font-weight: 600;
                                                cursor: pointer;
                                            ">📈 Chart</button>
                                            <button class="mt5-btn-close-pos" data-ticket="${p.ticket}" data-account="${p.account_id || ''}" style="
                                                padding: 2px 7px;
                                                border-radius: 4px;
                                                font-size: 10px;
                                                font-weight: 600;
                                                cursor: pointer;
                                                background: ${theme.errorSoft};
                                                color: ${theme.error};
                                                border: 1px solid ${theme.errorBorder};
                                                margin-left: 4px;
                                            ">✖ Close</button>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        renderHfBadgeHtml(server, symbol, theme) {
            const hfStatus = (window.MT5ParquetIndex && typeof window.MT5ParquetIndex.getTickerStatusSync === 'function')
                ? window.MT5ParquetIndex.getTickerStatusSync(server, symbol, true)
                : { isAvailable: false, isSyncing: false, isQueued: false, matchingAuthors: [], primaryAuthor: 'bnq-ii', repoName: `MT5_${server || 'Server'}_${symbol}`, displayRange: 'Inception → Present', startDate: 'Inception', endDate: 'Present', totalChunks: 0, totalBars: 0 };

            let hfBadgeHtml = '';
            if (hfStatus.isSyncing) {
                hfBadgeHtml = `
                    <div style="display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;">
                        <span class="mt5-hf-syncing-pill" style="
                            display: inline-flex;
                            align-items: center;
                            gap: 4px;
                            padding: 2px 7px;
                            border-radius: 4px;
                            font-size: 9.5px;
                            font-weight: 700;
                            background: rgba(33, 150, 243, 0.16);
                            color: #2196f3;
                            border: 1px solid rgba(33, 150, 243, 0.45);
                            white-space: nowrap;
                        " title="Bridge is actively archiving ${symbol} to Hugging Face (@${hfStatus.primaryAuthor})&#10;Currently archiving: ${hfStatus.currentChunk || '1m'}">
                            <span style="display: inline-block; animation: mt5spin 1.2s linear infinite;">🔄</span>
                            <span>Syncing ${hfStatus.currentChunk || '1m'}...</span>
                        </span>
                    </div>
                `;
            } else if (hfStatus.isQueued) {
                hfBadgeHtml = `
                    <div style="display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;">
                        <span style="
                            display: inline-flex;
                            align-items: center;
                            gap: 3px;
                            padding: 2px 6px;
                            border-radius: 4px;
                            font-size: 9px;
                            font-weight: 600;
                            background: rgba(255, 152, 0, 0.15);
                            color: #ff9800;
                            border: 1px solid rgba(255, 152, 0, 0.4);
                            white-space: nowrap;
                        " title="In Bridge priority queue - next in line for Parquet archival!">
                            <span>⏳</span>
                            <span>Queued</span>
                        </span>
                    </div>
                `;
            } else if (hfStatus.isAvailable) {
                const matching = hfStatus.matchingAuthors || [];
                const primaryUrl = matching[0]?.url || `https://huggingface.co/datasets/${hfStatus.primaryAuthor}/${hfStatus.repoName}`;
                const fallbackAuthors = matching.length > 1 ? `Fallback Authors: ${matching.slice(1).map(m => m.author).join(', ')}&#10;` : '';

                const tooltipText = `Hugging Face Parquet Archival&#10;✓ Synced to Bridge: @${hfStatus.primaryAuthor}&#10;${fallbackAuthors}• Inception Date: ${hfStatus.startDate}&#10;• Present Date: ${hfStatus.endDate}&#10;• Archived Chunks: ${hfStatus.totalChunks}&#10;• Total Archived Bars: ${hfStatus.totalBars.toLocaleString()}&#10;Click to open Hugging Face dataset in new tab ↗`;

                const multiCount = matching.length > 1 ? `<span style="font-size: 8.5px; opacity: 0.85; margin-left: 2px;">(+${matching.length - 1})</span>` : '';

                hfBadgeHtml = `
                    <div style="display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; flex-wrap: wrap;">
                        <a href="${primaryUrl}" target="_blank" rel="noopener noreferrer" class="mt5-hf-pill" style="
                            display: inline-flex;
                            align-items: center;
                            gap: 3px;
                            padding: 1.5px 6px;
                            border-radius: 3px;
                            font-size: 9.5px;
                            font-weight: 600;
                            text-decoration: none;
                            background: rgba(255, 172, 51, 0.12);
                            color: #ff9800;
                            border: 1px solid rgba(255, 172, 51, 0.35);
                            white-space: nowrap;
                            transition: all 0.12s ease;
                        " title="${tooltipText}">
                            <span>🤗</span>
                            <span>${matching[0]?.author || hfStatus.primaryAuthor}</span>
                            ${multiCount}
                            <span style="font-size: 8.5px; opacity: 0.85;">↗</span>
                        </a>
                        <span class="mt5-date-range-badge" style="
                            font-size: 9px;
                            padding: 1.5px 6px;
                            border-radius: 3px;
                            background: rgba(76, 175, 80, 0.12);
                            color: #4caf50;
                            border: 1px solid rgba(76, 175, 80, 0.3);
                            font-family: monospace;
                            font-weight: 600;
                            white-space: nowrap;
                        " title="${tooltipText}">
                            ${hfStatus.displayRange}
                        </span>
                        ${matching.length > 1 ? matching.slice(1).map(m => `
                            <a href="${m.url}" target="_blank" rel="noopener noreferrer" style="
                                display: inline-flex;
                                align-items: center;
                                padding: 1.5px 5px;
                                border-radius: 3px;
                                font-size: 9px;
                                font-weight: 500;
                                text-decoration: none;
                                background: ${theme.pillBg};
                                color: ${theme.textMuted};
                                border: 1px solid ${theme.border};
                                white-space: nowrap;
                                transition: all 0.12s ease;
                            " title="Open fallback repository under '${m.author}' in new tab ↗">
                                <span>${m.author} ↗</span>
                            </a>
                        `).join('') : ''}
                    </div>
                `;
            } else {
                const fallbackTooltip = `Hugging Face Archival&#10;⚡ On-Demand Archival&#10;Click to prioritize background extraction & upload from inception to present`;
                hfBadgeHtml = `
                    <button type="button" class="mt5-btn-prioritize-hf" data-symbol="${symbol}" data-server="${server || ''}" style="
                        display: inline-flex;
                        align-items: center;
                        gap: 4px;
                        padding: 2px 7px;
                        border-radius: 4px;
                        font-size: 9.5px;
                        font-weight: 600;
                        background: rgba(255, 152, 0, 0.08);
                        color: #ff9800;
                        border: 1px dashed rgba(255, 152, 0, 0.45);
                        cursor: pointer;
                        white-space: nowrap;
                        transition: all 0.12s ease;
                    " title="${fallbackTooltip}">
                        <span>⚡</span>
                        <span>On-Demand (Sync)</span>
                    </button>
                `;
            }

            return `<div class="mt5-hf-badge-container" data-symbol="${symbol}" data-server="${server || ''}" style="display:inline-flex; align-items:center;">${hfBadgeHtml}</div>`;
        }

        getTickerListHtml(symbols, theme, server, totalMatching = null) {
            if (!symbols || symbols.length === 0) {
                return `
                    <div style="text-align: center; padding: 32px 16px; color: ${theme.textMuted}; font-size: 12.5px;">
                        No symbols match the current search or category filter.
                    </div>
                `;
            }

            const allAvailableTfs = ['5m', '15m', '30m', '1h', '4h'];

            const rowsHtml = symbols.map(s => {
                const symName = s.name || s.symbol;
                const canon = window.MT5API ? window.MT5API.canonicalizeSymbol(symName) : symName;
                const isManaged = window.MT5API ? window.MT5API.isManagedSymbol(symName) : false;
                const managedCat = window.MT5API ? window.MT5API.getTickerCategory(symName) : 'other';
                const catLabel = isManaged ? (managedCat.charAt(0).toUpperCase() + managedCat.slice(1)) : (s.category || s.type || 'Catalog');
                const timeframes = window.MT5API ? window.MT5API.getTickerTimeframes(symName) : ['1m', '1D'];
                const desc = (s.description && s.description !== symName) ? s.description : '';

                // Timeframe Selector Chips (for managed symbols)
                const tfPills = isManaged ? `
                    <div class="mt5-tf-selector" style="display: inline-flex; align-items: center; gap: 3px;">
                        <span style="font-size: 9px; padding: 1.5px 5px; border-radius: 3px; background: rgba(76, 175, 80, 0.15); color: #4caf50; border: 1px solid rgba(76, 175, 80, 0.35); font-weight: 700;" title="Default locked timeframe">1m ✓</span>
                        <span style="font-size: 9px; padding: 1.5px 5px; border-radius: 3px; background: rgba(76, 175, 80, 0.15); color: #4caf50; border: 1px solid rgba(76, 175, 80, 0.35); font-weight: 700;" title="Default locked timeframe">1D ✓</span>
                        ${allAvailableTfs.map(tf => {
                            const isSelected = timeframes.includes(tf);
                            return `
                                <button type="button" class="mt5-btn-toggle-tf" data-symbol="${canon}" data-tf="${tf}" style="
                                    font-size: 9px;
                                    padding: 1.5px 5px;
                                    border-radius: 3px;
                                    border: 1px solid ${isSelected ? theme.primary : theme.border};
                                    background: ${isSelected ? (theme.isDark ? 'rgba(41,98,255,0.25)' : 'rgba(41,98,255,0.12)') : 'transparent'};
                                    color: ${isSelected ? theme.primary : theme.textMuted};
                                    font-weight: ${isSelected ? '700' : '500'};
                                    cursor: pointer;
                                    transition: all 0.12s ease;
                                " title="${isSelected ? `Click to remove ${tf} timeframe` : `Click to enable ${tf} timeframe & backfill`}">
                                    ${isSelected ? `${tf} ✓` : `+${tf}`}
                                </button>
                            `;
                        }).join('')}
                    </div>
                ` : '';

                return `
                    <div class="mt5-ticker-row" data-symbol="${symName}" data-canon="${canon}" data-server="${server || ''}" style="
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        padding: 6px 12px;
                        background: ${theme.rowBg};
                        border: 1px solid ${theme.border};
                        border-radius: 5px;
                        margin-bottom: 4px;
                        gap: 8px;
                    ">
                        <!-- Left: Symbol, Category & HF Badge -->
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; flex-wrap: wrap;">
                            <strong style="font-size: 12.5px; color: ${theme.text}; font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif; letter-spacing: 0.1px;">${symName}</strong>
                            <span style="font-size: 9px; padding: 1px 6px; border-radius: 3px; background: ${isManaged ? (theme.isDark ? 'rgba(41,98,255,0.2)' : 'rgba(41,98,255,0.1)') : theme.pillBg}; color: ${isManaged ? theme.primary : theme.textMuted}; border: 1px solid ${isManaged ? theme.primaryBorder : theme.border}; font-weight: 700; white-space: nowrap;">
                                ${isManaged ? `⭐ ${catLabel}` : catLabel}
                            </span>
                            ${this.renderHfBadgeHtml(server, symName, theme)}
                            ${desc ? `<span style="font-size: 10.5px; color: ${theme.textMuted}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;">${desc}</span>` : ''}
                        </div>

                        <!-- Center: Configurable Timeframes (for managed tickers) -->
                        ${tfPills ? `
                            <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                                ${tfPills}
                            </div>
                        ` : ''}

                        <!-- Right: Actions (Chart, Remove / Delete HF, or Add to Managed) -->
                        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                            <button class="mt5-btn-chart-symbol" data-symbol="${symName}" data-server="${server || ''}" style="
                                padding: 3px 8px;
                                border-radius: 4px;
                                font-size: 10.5px;
                                font-weight: 600;
                                cursor: pointer;
                                display: inline-flex;
                                align-items: center;
                                gap: 3px;
                                background: ${theme.primary};
                                color: #ffffff;
                                border: none;
                            " title="Open ${symName} on TradingView Chart">
                                <span>📈</span> Chart
                            </button>
                            ${isManaged ? `
                                <button type="button" class="mt5-btn-remove-managed" data-symbol="${canon}" style="
                                    padding: 3px 6px;
                                    border-radius: 4px;
                                    font-size: 10px;
                                    font-weight: 600;
                                    cursor: pointer;
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 3px;
                                    background: transparent;
                                    color: #f44336;
                                    border: 1px solid rgba(244, 67, 54, 0.3);
                                " title="Remove ${canon} from managed universe and permanently delete its Hugging Face repository">
                                    <span>🗑️</span> Remove
                                </button>
                            ` : `
                                <button type="button" class="mt5-btn-promote-managed" data-symbol="${canon}" style="
                                    padding: 3px 6px;
                                    border-radius: 4px;
                                    font-size: 10px;
                                    font-weight: 600;
                                    cursor: pointer;
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 3px;
                                    background: transparent;
                                    color: #089981;
                                    border: 1px solid rgba(8, 153, 129, 0.35);
                                " title="Promote ${canon} to Managed Universe (Sync to Hugging Face)">
                                    <span>＋</span> Manage
                                </button>
                            `}
                        </div>
                    </div>
                `;
            }).join('');

            const total = totalMatching !== null ? totalMatching : symbols.length;
            let paginationHtml = '';
            if (total > symbols.length) {
                paginationHtml = `
                    <div id="mt5-ticker-pagination-bar" style="
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        padding: 12px 10px;
                        margin-top: 6px;
                        background: ${theme.cardBg};
                        border: 1px dashed ${theme.border};
                        border-radius: 6px;
                        gap: 6px;
                    ">
                        <div style="font-size: 11px; color: ${theme.textMuted}; font-weight: 500;">
                            Showing <strong style="color: ${theme.text};">${symbols.length.toLocaleString()}</strong> of <strong style="color: ${theme.primary};">${total.toLocaleString()}</strong> symbols
                        </div>
                        <button id="mt5-btn-load-more-tickers" type="button" style="
                            background: ${theme.primary};
                            color: #ffffff;
                            border: none;
                            padding: 6px 16px;
                            border-radius: 5px;
                            font-size: 11px;
                            font-weight: 600;
                            cursor: pointer;
                            display: inline-flex;
                            align-items: center;
                            gap: 6px;
                            transition: opacity 0.15s ease;
                        ">
                            <span>⬇️</span> Load Next 100 Symbols
                        </button>
                    </div>
                `;
            }

            return rowsHtml + paginationHtml;
        }

        updateTickerListView(modal, theme, server) {
            const container = modal.querySelector('#mt5-ticker-items-container');
            if (!container || !this.detailsData) return;

            const allSymbols = this.detailsData.symbols || [];
            const u = window.MT5API ? (window.MT5API._hfUniverse || window.MT5API.getDefaultUniverse()) : { categories: {} };
            const uCats = u.categories || {};
            const activeCat = this.tickerCategoryFilter || 'managed';

            let symbols = [];
            if (activeCat === 'managed') {
                symbols = allSymbols.filter(s => window.MT5API ? window.MT5API.isManagedSymbol(s.name) : true);
                const seenCanons = new Set(symbols.map(s => window.MT5API ? window.MT5API.canonicalizeSymbol(s.name) : s.name));
                for (const catKey in uCats) {
                    for (const sym of uCats[catKey]) {
                        const canon = window.MT5API ? window.MT5API.canonicalizeSymbol(sym) : sym;
                        if (!seenCanons.has(canon)) {
                            symbols.push({ name: sym, symbol: sym, category: catKey, isVirtual: true });
                            seenCanons.add(canon);
                        }
                    }
                }
            } else if (['forex', 'nasdaq', 'crypto', 'commodity', 'index'].includes(activeCat)) {
                const catList = uCats[activeCat] || [];
                const catCanons = new Set(catList.map(s => window.MT5API ? window.MT5API.canonicalizeSymbol(s) : s));
                symbols = allSymbols.filter(s => {
                    const c = window.MT5API ? window.MT5API.canonicalizeSymbol(s.name) : s.name;
                    return catCanons.has(c);
                });
                const seenCanons = new Set(symbols.map(s => window.MT5API ? window.MT5API.canonicalizeSymbol(s.name) : s.name));
                for (const sym of catList) {
                    const canon = window.MT5API ? window.MT5API.canonicalizeSymbol(sym) : sym;
                    if (!seenCanons.has(canon)) {
                        symbols.push({ name: sym, symbol: sym, category: activeCat, isVirtual: true });
                        seenCanons.add(canon);
                    }
                }
            } else {
                symbols = allSymbols;
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

            this._lastFilteredSymbolsCount = symbols.length;
            const visibleCount = this.tickerVisibleCount || 100;
            const pageSymbols = symbols.slice(0, visibleCount);

            container.innerHTML = this.getTickerListHtml(pageSymbols, theme, server, symbols.length);

            // Scalable Event Delegation on container (binds once)
            if (!container._hasDelegatedEvents) {
                container._hasDelegatedEvents = true;

                container.addEventListener('click', async (e) => {
                    // 1. Chart Symbol
                    const chartBtn = e.target.closest('.mt5-btn-chart-symbol');
                    if (chartBtn) {
                        const sym = chartBtn.getAttribute('data-symbol');
                        const srv = chartBtn.getAttribute('data-server');
                        this.loadSymbolOnChart(sym, srv);
                        return;
                    }

                    // 2. Toggle Timeframe Chip
                    const tfBtn = e.target.closest('.mt5-btn-toggle-tf');
                    if (tfBtn) {
                        const sym = tfBtn.getAttribute('data-symbol');
                        const tf = tfBtn.getAttribute('data-tf');
                        if (window.MT5API && typeof window.MT5API.getTickerTimeframes === 'function') {
                            const curTfs = window.MT5API.getTickerTimeframes(sym);
                            let newTfs;
                            if (curTfs.includes(tf)) {
                                newTfs = curTfs.filter(t => t !== tf);
                            } else {
                                newTfs = [...curTfs, tf];
                            }
                            tfBtn.innerHTML = '<span>⏳</span>';
                            await window.MT5API.setHFUniverseTimeframes(sym, newTfs);
                            this.updateTickerListView(modal, theme, server);
                        }
                        return;
                    }

                    // 3. Remove from Managed & Delete HF Repo
                    const removeBtn = e.target.closest('.mt5-btn-remove-managed');
                    if (removeBtn) {
                        const sym = removeBtn.getAttribute('data-symbol');
                        if (confirm(`Remove ${sym} from managed universe and permanently delete its Hugging Face repository?`)) {
                            removeBtn.innerHTML = '<span>⏳</span> Deleting...';
                            removeBtn.disabled = true;
                            if (window.MT5API && typeof window.MT5API.removeHFUniverseTicker === 'function') {
                                await window.MT5API.removeHFUniverseTicker(sym, true);
                                this.renderModal();
                            }
                        }
                        return;
                    }

                    // 4. Promote / Add to Managed
                    const promoteBtn = e.target.closest('.mt5-btn-promote-managed');
                    if (promoteBtn) {
                        const sym = promoteBtn.getAttribute('data-symbol');
                        const cat = prompt(`Add ${sym} to which managed category? (forex, nasdaq, crypto, commodity, index)`, 'nasdaq');
                        if (cat && window.MT5API && typeof window.MT5API.addHFUniverseTicker === 'function') {
                            promoteBtn.innerHTML = '<span>⏳</span> Adding...';
                            promoteBtn.disabled = true;
                            const res = await window.MT5API.addHFUniverseTicker(cat, sym);
                            if (res && res.error) {
                                alert(res.error);
                            }
                            this.renderModal();
                        }
                        return;
                    }

                    // 5. Load More Pagination
                    const loadMoreBtn = e.target.closest('#mt5-btn-load-more-tickers');
                    if (loadMoreBtn) {
                        this.tickerVisibleCount = (this.tickerVisibleCount || 100) + 100;
                        this.updateTickerListView(modal, theme, server);
                        return;
                    }
                });

                // Infinite Scroll
                container.addEventListener('scroll', () => {
                    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 250) {
                        const total = this._lastFilteredSymbolsCount || 0;
                        const cur = this.tickerVisibleCount || 100;
                        if (cur < total) {
                            this.tickerVisibleCount = cur + 100;
                            this.updateTickerListView(modal, theme, server);
                        }
                    }
                }, { passive: true });
            }

            // Update Category Tabs active styles
            modal.querySelectorAll('.mt5-cat-tab-btn').forEach(tab => {
                const cat = tab.getAttribute('data-cat');
                const isAct = (cat === activeCat);
                tab.style.background = isAct ? theme.primary : theme.pillBg;
                tab.style.color = isAct ? '#ffffff' : theme.textMuted;
                tab.style.borderColor = isAct ? theme.primary : theme.border;
            });
        }

        updatePositionsListView(modal, theme, server) {
            const container = modal.querySelector('#mt5-positions-items-container');
            if (!container || !this.detailsData) return;
            const positions = this.detailsData.positions || [];
            container.innerHTML = this.getPositionsTableHtml(positions, theme, server);

            const posBadge = modal.querySelector('#mt5-tab-positions-count');
            if (posBadge) {
                posBadge.textContent = `💼 Active Positions (${positions.length})`;
            }

            // Re-bind chart buttons inside the updated positions list
            container.querySelectorAll('.mt5-btn-chart-symbol').forEach(btn => {
                btn.onclick = (e) => {
                    const sym = e.currentTarget.getAttribute('data-symbol');
                    const srv = e.currentTarget.getAttribute('data-server');
                    if (sym) this.loadSymbolOnChart(sym, srv);
                };
            });

            // Re-bind close position buttons inside the updated positions list
            container.querySelectorAll('.mt5-btn-close-pos').forEach(btn => {
                btn.onclick = async (e) => {
                    const ticket = e.currentTarget.getAttribute('data-ticket');
                    const aid = e.currentTarget.getAttribute('data-account') || this.detailsAccountId;
                    if (!ticket) return;
                    if (confirm(`Close active position #${ticket}?`)) {
                        btn.disabled = true;
                        btn.textContent = 'Closing...';
                        try {
                            if (window.MT5API && typeof window.MT5API.closePosition === 'function') {
                                const res = await window.MT5API.closePosition({ ticket: Number(ticket), accountId: aid });
                                if (res && res.success) {
                                    if (typeof window.MT5API.fetchPositions === 'function') {
                                        const newPos = await window.MT5API.fetchPositions(aid);
                                        this.handleLivePositionUpdate(newPos);
                                    }
                                } else {
                                    alert(`Failed to close position #${ticket}: ${res ? res.error : 'Unknown error'}`);
                                }
                            }
                        } catch (err) {
                            alert(`Error closing position: ${err.message}`);
                        } finally {
                            btn.disabled = false;
                            btn.textContent = '✖ Close';
                        }
                    }
                };
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
            const isActive = activeAcc && activeAcc.id === acc.id;
            const isPaused = window.MT5API ? window.MT5API.isAccountPaused(acc.id) : false;

            const allEndpoints = window.MT5API ? window.MT5API.getEndpoints() : [];
            const vault = window.MT5API ? window.MT5API.getClientVault() : [];
            const targetLogin = String(acc.login).trim();
            const isMatch = (s1, s2) => window.MT5API?.isServerMatch ? window.MT5API.isServerMatch(s1, s2) : String(s1 || '').trim().toLowerCase() === String(s2 || '').trim().toLowerCase();
            const vaultEntry = vault.find(v => String(v.login).trim() === targetLogin && isMatch(v.server, acc.server));
            const activeInstances = (window.MT5API?.accounts || []).filter(a => String(a.login).trim() === targetLogin && isMatch(a.server, acc.server));
            const allInstancesWithAcc = [acc, ...activeInstances];
            const anyLiveConnected = Boolean(acc.is_connected || allInstancesWithAcc.some(i => i.is_connected));

            if (anyLiveConnected && vaultEntry && vaultEntry.verification_failed) {
                vaultEntry.verification_failed = false;
                vaultEntry.last_error = null;
                vaultEntry.is_verified = true;
                try {
                    localStorage.setItem('mt5_client_vault', JSON.stringify(vault));
                } catch (_) {}
            }

            const isVaultRejected = !anyLiveConnected && (Boolean(vaultEntry && vaultEntry.verification_failed) || Boolean(acc.is_verification_failed));
            const hasLocalVault = Boolean(vaultEntry && vaultEntry.password);
            const isVaultVerified = Boolean(vaultEntry && vaultEntry.is_verified !== false && !vaultEntry.staged_offline && !isVaultRejected);
            const isVaultStaged = Boolean(vaultEntry && (vaultEntry.staged_offline || vaultEntry.is_verified === false) && !isVaultRejected);
            const hasBridgeDpapi = Boolean(allInstancesWithAcc.some(i => i.has_dpapi) || acc.has_dpapi);
            const hasBridgeNative = Boolean(
                acc.has_native_vault ||
                acc.auth_mode === 'mt5_native_vault' ||
                allInstancesWithAcc.some(i => i.has_native_vault || i.auth_mode === 'mt5_native_vault' || i.has_password)
            );
            const hasBridgeVault = Boolean(hasBridgeDpapi || hasBridgeNative);
            const survivesReboot = Boolean(hasBridgeDpapi || hasBridgeNative);
            const isVerified = Boolean(allInstancesWithAcc.some(i => i.is_verified) || acc.is_verified);

            let vaultMode = 'session_only';
            let vaultLabel = isVerified ? '⚠️ Volatile Session ✓' : '⚠️ Session Only';
            let vaultColor = '#ff9800';

            if (isVaultRejected) {
                vaultMode = 'local_rejected';
                vaultLabel = '❌ Pwd Rejected by Broker';
                vaultColor = '#ef4444';
            } else if (hasLocalVault && hasBridgeVault) {
                if (isVaultStaged) {
                    vaultMode = 'dual_vaulted_staged';
                    vaultLabel = '🔒 Dual (⚠️ Local Staged)';
                    vaultColor = '#ff9800';
                } else {
                    vaultMode = 'dual_vaulted';
                    vaultLabel = isVerified ? '🔒 Dual Vaulted ✓' : '🔒 Dual Vaulted';
                    vaultColor = '#089981';
                }
            } else if (!hasLocalVault && hasBridgeDpapi) {
                vaultMode = 'bridge_secured';
                vaultLabel = isVerified ? '☁️ Bridge Secured ✓' : '☁️ Bridge Secured';
                vaultColor = '#00bcd4';
            } else if (!hasLocalVault && hasBridgeNative) {
                vaultMode = 'mt5_native_vault';
                vaultLabel = isVerified ? '🖥️ MT5 Saved ✓' : '🖥️ MT5 Saved';
                vaultColor = '#00bcd4';
            } else if (hasLocalVault && !hasBridgeVault) {
                if (isVaultStaged) {
                    vaultMode = 'local_staged_offline';
                    vaultLabel = '⚠️ Staged Offline (Unverified)';
                    vaultColor = '#ff9800';
                } else {
                    vaultMode = 'local_vaulted';
                    vaultLabel = isVerified ? '💻 Local Vaulted ✓' : '💻 Local Vaulted';
                    vaultColor = '#2962ff';
                }
            }

            const isPasswordSaved = Boolean(hasLocalVault || hasBridgeVault);

            const maxBal = Math.max(...allInstancesWithAcc.map(a => Number(a.balance || 0)));
            const maxEq = Math.max(...allInstancesWithAcc.map(a => Number(a.equity || 0)));
            const bal = maxBal > 0 ? maxBal : (acc.balance != null ? Number(acc.balance) : 0);
            const eq = maxEq > 0 ? maxEq : (acc.equity != null ? Number(acc.equity) : 0);
            const maxFreeMargin = Math.max(...allInstancesWithAcc.map(a => Number(a.free_margin || 0)));
            const freeMargin = maxFreeMargin > 0 ? maxFreeMargin : (acc.free_margin != null ? Number(acc.free_margin) : 0);
            const margin = acc.margin != null ? Number(acc.margin) : 0;
            const marginLvl = acc.margin_level != null ? Number(acc.margin_level) : null;
            const pnl = eq - bal;
            const pnlPct = bal > 0 ? ((pnl / bal) * 100).toFixed(2) : '0.00';

            const marginUsedPct = (margin + freeMargin) > 0 ? Math.min(100, Math.round((margin / (margin + freeMargin)) * 100)) : 0;
            const freeMarginPct = 100 - marginUsedPct;

            const categoryList = Object.keys(categories);

            // Universe filtering ('MAJOR' ~666 vs 'ALL' 12,197)
            const u = window.MT5API ? (window.MT5API._hfUniverse || window.MT5API.getDefaultUniverse()) : { categories: {} };
            const uCats = u.categories || {};
            const forexCount = (uCats.forex || []).length;
            const nasdaqCount = (uCats.nasdaq || []).length;
            const cryptoCount = (uCats.crypto || []).length;
            const commodityCount = (uCats.commodity || []).length;
            const indexCount = (uCats.index || []).length;
            const totalManagedCount = forexCount + nasdaqCount + cryptoCount + commodityCount + indexCount;

            const activeCat = this.tickerCategoryFilter || 'managed';

            // Filter symbols for tickers tab view
            let filteredSymbols = [];
            if (activeCat === 'managed') {
                filteredSymbols = symbols.filter(s => window.MT5API ? window.MT5API.isManagedSymbol(s.name) : true);
                const seenCanons = new Set(filteredSymbols.map(s => window.MT5API ? window.MT5API.canonicalizeSymbol(s.name) : s.name));
                for (const catKey in uCats) {
                    for (const sym of uCats[catKey]) {
                        const canon = window.MT5API ? window.MT5API.canonicalizeSymbol(sym) : sym;
                        if (!seenCanons.has(canon)) {
                            filteredSymbols.push({ name: sym, symbol: sym, category: catKey, isVirtual: true });
                            seenCanons.add(canon);
                        }
                    }
                }
            } else if (['forex', 'nasdaq', 'crypto', 'commodity', 'index'].includes(activeCat)) {
                const catList = uCats[activeCat] || [];
                const catCanons = new Set(catList.map(s => window.MT5API ? window.MT5API.canonicalizeSymbol(s) : s));
                filteredSymbols = symbols.filter(s => {
                    const c = window.MT5API ? window.MT5API.canonicalizeSymbol(s.name) : s.name;
                    return catCanons.has(c);
                });
                const seenCanons = new Set(filteredSymbols.map(s => window.MT5API ? window.MT5API.canonicalizeSymbol(s.name) : s.name));
                for (const sym of catList) {
                    const canon = window.MT5API ? window.MT5API.canonicalizeSymbol(sym) : sym;
                    if (!seenCanons.has(canon)) {
                        filteredSymbols.push({ name: sym, symbol: sym, category: activeCat, isVirtual: true });
                        seenCanons.add(canon);
                    }
                }
            } else {
                filteredSymbols = symbols;
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

            // Sync metrics for Managed Universe
            const syncedMajorCount = (symbols.filter(s => {
                if (!window.MT5API || !window.MT5API.isManagedSymbol(s.name)) return false;
                const st = window.MT5ParquetIndex ? window.MT5ParquetIndex.getTickerStatusSync(acc.server, s.name, false) : null;
                return st && st.isAvailable;
            })).length;

            const bridgeStatus = window.MT5ParquetIndex ? window.MT5ParquetIndex.bridgeStatus : null;
            const fleetCoreTotal = (bridgeStatus && bridgeStatus.core_symbols) ? bridgeStatus.core_symbols : (bridgeStatus ? bridgeStatus.total_symbols : null);
            const fleetCompleted = bridgeStatus ? (bridgeStatus.completed_symbols || 0) : 0;
            const fleetPct = fleetCoreTotal ? Math.round((fleetCompleted / fleetCoreTotal) * 100) : 0;

            // History metrics - strictly separate real closed market trades from capital deposits
            const hasOutDeals = history.some(h => h.entry === 'OUT');
            const tradeDeals = history.filter(h => (h.type === 'BUY' || h.type === 'SELL') && (!hasOutDeals || h.entry === 'OUT'));
            const depositDeals = history.filter(h => h.type === 'BALANCE' || h.type === 'CREDIT' || !h.symbol || h.symbol === 'BALANCE');
            const initialDeposit = depositDeals.reduce((sum, h) => sum + Number(h.profit || 0), 0);

            const closedWins = tradeDeals.filter(h => Number(h.profit || 0) > 0);
            const closedLosses = tradeDeals.filter(h => Number(h.profit || 0) < 0);
            const totalTradeCount = closedWins.length + closedLosses.length;
            const winRate = totalTradeCount > 0 ? ((closedWins.length / totalTradeCount) * 100).toFixed(1) : '0.0';
            const netTradeProfit = tradeDeals.reduce((sum, h) => sum + Number(h.profit || 0), 0);
            const grossProfit = closedWins.reduce((sum, h) => sum + Number(h.profit || 0), 0);
            const grossLoss = Math.abs(closedLosses.reduce((sum, h) => sum + Number(h.profit || 0), 0));
            const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? '∞' : '0.00');

            const activeEpIds = new Set(activeInstances.map(a => a.endpointId));

            const combinedEpIds = new Set([
                ...activeEpIds,
                ...(vaultEntry && Array.isArray(vaultEntry.targetEndpoints) && vaultEntry.targetEndpoints.length > 0
                    ? vaultEntry.targetEndpoints
                    : (vaultEntry && vaultEntry.endpointId ? [vaultEntry.endpointId] : []))
            ]);
            const allowedEpIds = Array.from(combinedEpIds.size > 0 ? combinedEpIds : [acc.endpointId]);
            const routedEp = window.MT5API?.getEndpointForAccount(acc.id);

            const detailsBridgeBadges = allowedEpIds.map(epId => {
                const ep = allEndpoints.find(e => e.id === epId);
                if (!ep) return '';
                const isConn = activeEpIds.has(ep.id);
                const isOnline = ep.status === 'online';
                const isLocal = this.isLocalVmBridge(ep);
                const bIcon = isLocal ? '💻' : (ep.name.toLowerCase().includes('oracle') ? '☁️' : '⚡');
                const isRouted = routedEp && routedEp.id === ep.id;

                const badgeColor = isConn && isOnline ? theme.success : (isOnline ? theme.primary : theme.error);
                const badgeBg = isRouted ? (theme.isDark ? 'rgba(41,98,255,0.22)' : 'rgba(41,98,255,0.12)') : (isConn && isOnline ? theme.successSoft : (isOnline ? theme.primarySoft : theme.errorSoft));
                const badgeBorder = isRouted ? theme.primary : (isConn && isOnline ? theme.successBorder : (isOnline ? theme.primaryBorder : theme.errorBorder));
                const statusText = isRouted ? '⚡ Active Route' : (isConn && isOnline ? '🟢 Connected' : (isOnline ? '⚪ Ready' : '🔴 Offline'));

                return `<span style="font-size: 9.5px; padding: 2px 6px; border-radius: 4px; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; ${isRouted ? 'box-shadow: 0 0 4px rgba(41,98,255,0.3);' : ''}">
                    ${isRouted ? '⚡' : bIcon} ${ep.name} (${statusText})
                </span>`;
            }).filter(Boolean).join('') || `<span style="font-size: 10px; color: ${theme.textMuted};">${acc.endpointName || 'Bridge Server'}</span>`;

            return `
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <!-- Top Navigation Bar -->
                    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <button id="mt5-btn-back-fleet" type="button" class="mt5-ghost-btn" style="
                                padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer;
                                display: inline-flex; align-items: center; gap: 4px;
                            ">
                                <span>←</span> Fleet
                            </button>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <strong id="mt5-details-account-nickname" style="font-size: 13.5px; font-weight: 700; color: ${theme.text};">${acc.nickname}</strong>
                                <span style="font-size: 9.5px; padding: 2px 6px; border-radius: 4px; background: rgba(255, 255, 255, 0.05); color: ${theme.textMuted}; font-weight: 600; border: 1px solid rgba(255, 255, 255, 0.08);">
                                    ${acc.broker_name || (acc.server.includes('FivePercent') ? 'The5ers' : acc.server)}
                                </span>
                                ${isActive ? `<span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: ${theme.primarySoft}; color: ${theme.primary}; border: 1px solid ${theme.primaryBorder}; font-weight: 700;">ACTIVE FEED</span>` : ''}
                                ${isPaused ? `<span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: ${theme.warningSoft}; color: ${theme.warning}; border: 1px solid ${theme.warningBorder}; font-weight: 700;">PAUSED</span>` : ''}
                            </div>
                        </div>

                        <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
                            <button class="mt5-btn-config-bridges mt5-ghost-btn" data-login="${acc.login}" data-server="${acc.server}" data-id="${acc.id}" style="
                                padding: 4px 9px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer;
                                display: inline-flex; align-items: center; gap: 4px;
                            " title="Configure which bridges this account is allowed to connect to">
                                <span>🔗</span> Allowed Bridges (${allowedEpIds.length})
                            </button>
                            ${!isActive ? `<button class="mt5-btn-set-active" data-id="${acc.id}" style="background: ${theme.primarySoft}; color: #60a5fa; border: 1px solid ${theme.primaryBorder}; padding: 4px 9px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer;">Show Chart Feed</button>` : ''}
                            <button id="mt5-btn-refresh-details" class="mt5-ghost-btn" data-id="${acc.id}" style="
                                padding: 4px 8px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer;
                                display: inline-flex; align-items: center; gap: 4px;
                            " title="Refresh live financials and tickers">
                                <span>🔄</span> Refresh
                            </button>
                        </div>
                    </div>

                    <!-- Sleek Executive Financial Cockpit -->
                    <div style="
                        background: ${theme.cardBg};
                        border: 1px solid ${theme.border};
                        border-radius: 6px;
                        padding: 10px 14px;
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                    ">
                        <!-- Row 1: Real-time Balance, Equity, and Margin Meter -->
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; align-items: center;">
                            <div>
                                <span style="font-size: 10px; color: ${theme.textMuted}; font-weight: 500;">Account Balance</span>
                                <div id="mt5-cockpit-balance" style="font-size: 15px; font-weight: 700; color: ${theme.text}; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, sans-serif; letter-spacing: -0.2px; margin-top: 2px;">
                                    $${bal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                    <span style="font-size: 9.5px; color: ${theme.textDim}; font-weight: 500; margin-left: 2px;">${acc.currency || 'USD'}</span>
                                </div>
                            </div>

                            <div>
                                <span style="font-size: 10px; color: ${theme.textMuted}; font-weight: 500;">Equity (Floating PnL)</span>
                                <div id="mt5-cockpit-equity" style="font-size: 15px; font-weight: 700; color: ${pnl >= 0 ? theme.success : theme.error}; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, sans-serif; letter-spacing: -0.2px; margin-top: 2px;">
                                    $${eq.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                    <span style="font-size: 10px; font-weight: 600; margin-left: 3px; opacity: 0.9;">(${pnl >= 0 ? '+' : ''}${pnlPct}%)</span>
                                </div>
                            </div>

                            <div>
                                <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 3px;">
                                    <span style="color: ${theme.textMuted};">Free Margin:</span>
                                    <strong id="mt5-cockpit-free-margin" style="color: ${theme.text}; font-family: monospace;">$${freeMargin.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong>
                                </div>
                                <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden;" title="Margin used: ${marginUsedPct}%">
                                    <div id="mt5-cockpit-margin-bar" style="width: ${freeMarginPct}%; height: 100%; background: ${theme.success}; border-radius: 2px;"></div>
                                </div>
                                <div id="mt5-cockpit-used-margin" style="font-size: 9px; color: ${theme.textDim}; margin-top: 2px;">
                                    Used: $${margin.toFixed(2)} (${marginUsedPct}%)
                                </div>
                            </div>

                            <div>
                                <span style="font-size: 10px; color: ${theme.textMuted}; font-weight: 500;">Leverage & Sizing</span>
                                <div style="font-size: 12.5px; font-weight: 700; color: ${theme.text}; margin-top: 2px;">
                                    1:${acc.leverage || 100}
                                    <span style="font-size: 10px; color: ${theme.textMuted}; font-weight: 500; margin-left: 3px;">(${acc.lot_multiplier || 1.0}x mult / ${acc.risk_percent || 1.0}% risk)</span>
                                </div>
                            </div>
                        </div>

                        <!-- Row 2: Parameter Chips -->
                        <div style="display: flex; flex-wrap: wrap; gap: 8px; padding-top: 6px; border-top: 1px solid ${theme.border}; font-size: 10.5px; color: ${theme.textMuted};">
                            <span>Server: <strong style="color: ${theme.text};">${acc.server}</strong></span>
                            <span>•</span>
                            <span>Login: <strong id="mt5-details-account-login" style="color: ${theme.text}; font-family: monospace;">#${acc.login}</strong></span>
                            <span>•</span>
                            <span>Ping: <strong style="color: ${theme.text};">${acc.ping_ms || (window.MT5API ? window.MT5API.pingMs : 0)}ms</strong></span>
                            <span>•</span>
                            <span>Status: <strong style="color: ${isPaused ? theme.warning : theme.success};">${isPaused ? 'Standby (Paused)' : 'Online'}</strong></span>
                            <span>•</span>
                            <span>Auth: <strong style="color: ${vaultColor}; font-weight: 700;">${vaultLabel}</strong></span>
                            <span>•</span>
                            <span>Added: <strong style="color: ${theme.text};">${acc.created_at ? new Date(acc.created_at * 1000).toLocaleDateString() : 'Active'}</strong></span>
                        </div>
                    </div>

                    <!-- Credential Security & Broker Handshake Card -->
                    <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 9px 12px; display: flex; flex-direction: column; gap: 8px;">
                        <!-- Title & Action Bar -->
                        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
                            <div style="display: flex; align-items: center; gap: 7px;">
                                <span style="font-size: 11px; font-weight: 700; color: ${theme.text};">🔐 Credential Security & Broker Handshake</span>
                                <span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: ${vaultColor}1a; color: ${vaultColor}; border: 1px solid ${vaultColor}4d; font-weight: 700;">
                                    ${vaultLabel}
                                </span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 5px;">
                                ${!hasLocalVault ? `
                                    <button class="mt5-btn-save-to-browser-vault mt5-ghost-btn" data-login="${acc.login}" data-server="${acc.server}" style="
                                        padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer; color: ${theme.primary}; border: 1px solid ${theme.primaryBorder};
                                    " title="Save password in browser client vault">
                                        📥 Back Up to Browser Vault
                                    </button>
                                ` : (isVaultRejected ? `
                                    <button class="mt5-btn-save-to-browser-vault mt5-ghost-btn" data-login="${acc.login}" data-server="${acc.server}" style="
                                        padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer; color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.08);
                                    " title="Broker rejected staged password. Click to re-enter valid credentials.">
                                        🔄 Fix Rejected Password
                                    </button>
                                ` : (isVaultStaged ? `
                                    <button class="mt5-btn-save-to-browser-vault mt5-ghost-btn" data-login="${acc.login}" data-server="${acc.server}" style="
                                        padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer; color: #ff9800; border: 1px solid rgba(255,152,0,0.4);
                                    " title="Password was staged offline. Click to test with broker or re-enter password.">
                                        ⚠️ Re-verify Local Password
                                    </button>
                                ` : `
                                    <button class="mt5-btn-save-to-browser-vault mt5-ghost-btn" data-login="${acc.login}" data-server="${acc.server}" style="
                                        padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer; color: ${theme.textMuted}; border: 1px solid ${theme.border};
                                    " title="Update password saved in browser client vault">
                                        ✏️ Update Local Vault
                                    </button>
                                `))}
                                ${(!hasBridgeVault && hasLocalVault && !isVaultRejected) ? `
                                    <button class="mt5-btn-verify-heal-dpapi" data-login="${acc.login}" data-server="${acc.server}" style="
                                        padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer; background: #2962ff; color: #fff; border: none;
                                    " title="Test credentials with broker and vault in Bridge DPAPI">
                                        ⚡ Auto-Heal to Bridge DPAPI
                                    </button>
                                ` : ''}
                                <button id="mt5-btn-toggle-update-pwd" class="mt5-ghost-btn" style="
                                    padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;
                                ">
                                    🔑 Update Broker Password
                                </button>
                            </div>
                        </div>

                        <!-- Diagnostic Badges -->
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px; font-size: 10px; padding: 5px 0; border-top: 1px solid ${theme.border};">
                            <div style="display: flex; align-items: center; gap: 5px;">
                                <span>Bridge Storage:</span>
                                ${hasBridgeDpapi ? `
                                    <strong style="color: #089981;">☁️ Hardware DPAPI (accounts.json)</strong>
                                ` : (hasBridgeNative && anyConnected ? `
                                    <strong style="color: #00bcd4;">🖥️ MT5 Native Vault (accounts.dat)</strong>
                                ` : `
                                    <strong style="color: #ff9800;">⚠️ Volatile Session (No Disk Password)</strong>
                                `)}
                            </div>
                            <div style="display: flex; align-items: center; gap: 5px;">
                                <span>Reboot Survival:</span>
                                ${survivesReboot ? `
                                    <strong style="color: #089981;">🟢 Survives Reboot (Auto-Login Ready)</strong>
                                ` : `
                                    <strong style="color: #ef4444;">🔴 Lost on Reboot (Needs Login)</strong>
                                `}
                            </div>
                            <div style="display: flex; align-items: center; gap: 5px;">
                                <span>Browser Vault:</span>
                                ${hasLocalVault ? (
                                    isVaultRejected ? `
                                        <strong style="color: #ef4444;" title="${acc.last_error || 'Broker rejected credentials.'}">💻 Encrypted Vault (❌ Password Rejected)</strong>
                                    ` : (isVaultStaged ? `
                                        <strong style="color: #ff9800;" title="Password staged offline in browser. Awaiting bridge connection for broker verification.">💻 Encrypted Vault (⚠️ Staged Offline)</strong>
                                    ` : `
                                        <strong style="color: #089981;" title="Password broker verified and secured in AES-256-GCM vault.">💻 Encrypted Vault (✓ Broker Verified)</strong>
                                    `)
                                ) : `
                                    <strong style="color: ${theme.textMuted};">❌ Not in Browser Vault</strong>
                                `}
                            </div>
                            <div style="display: flex; align-items: center; gap: 5px;">
                                <span>Broker Handshake:</span>
                                ${isVerified ? `
                                    <strong style="color: #089981;">🟢 Live Verified (#${acc.login} @ ${acc.server})</strong>
                                ` : (isVaultRejected ? `
                                    <strong style="color: #ef4444;" title="${acc.last_error || 'Broker rejected credentials.'}">🔴 Rejected by Broker (${acc.last_error || 'Invalid Credentials'})</strong>
                                ` : (isVaultStaged ? `
                                    <strong style="color: #ff9800;">🟡 Staged Offline (Awaiting Bridge)</strong>
                                ` : `
                                    <strong style="color: #ff9800;">🟡 Awaiting Credentials / Offline</strong>
                                `))}
                            </div>
                        </div>

                        <!-- Collapsible Update Password Form (auto-expanded if rejected or awaiting credentials) -->
                        <div id="mt5-update-pwd-container" style="display: ${(isVaultRejected || (!acc.is_connected && !acc.has_dpapi)) ? 'block' : 'none'}; padding-top: 8px; border-top: 1px dashed ${theme.border};">
                            <div style="font-size: 10px; color: ${isVaultRejected ? '#ef4444' : theme.textMuted}; margin-bottom: 6px; font-weight: ${(isVaultRejected || (!acc.is_connected && !acc.has_dpapi)) ? '600' : 'normal'};">
                                ${(isVaultRejected || (!acc.is_connected && !acc.has_dpapi)) ? (isVaultRejected ? `⚠️ Staged password was rejected by broker (${acc.last_error || 'Invalid credentials'}). Enter the correct password below to verify & save:` : `⚠️ Account #${acc.login} is awaiting password to log into ${acc.server}. Enter password below to verify with broker & save:`) : 'Broker Verification Gate: Tests credentials with broker first. If verified, updates Bridge DPAPI and Browser Vault. If rejected, preserves existing working credentials.'}
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                <div style="position: relative; display: flex; align-items: center; flex: 1; min-width: 170px;">
                                    <input id="mt5-input-update-pwd" type="password" placeholder="Enter broker password..." style="
                                        width: 100%; padding: 5px 30px 5px 8px; border-radius: 4px; font-size: 11px;
                                        background: ${theme.inputBg}; color: ${theme.text}; border: 1px solid ${theme.border};
                                    " />
                                    <button id="mt5-btn-toggle-pwd-visibility" type="button" style="
                                        position: absolute; right: 6px; background: transparent; border: none; cursor: pointer; font-size: 11px; color: ${theme.textMuted};
                                    " title="Toggle visibility">👁️</button>
                                </div>
                                <button id="mt5-btn-submit-verify-pwd" data-login="${acc.login}" data-server="${acc.server}" type="button" style="
                                    background: ${theme.primary}; color: #fff; border: none; padding: 5px 12px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;
                                ">
                                    <span>🔒</span> Verify with Broker & Save
                                </button>
                            </div>
                            <div id="mt5-update-pwd-feedback" style="display: none; font-size: 10px; margin-top: 6px;"></div>
                        </div>
                    </div>

                    <!-- Bridge Routing & Permissions Row -->
                    <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 7px 12px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0;">
                            <span style="font-size: 10.5px; font-weight: 600; color: ${theme.textMuted};">🔗 Bridge Routing:</span>
                            ${activeInstances.length > 1 ? `
                                <span style="font-size: 9.5px; padding: 2px 6px; border-radius: 4px; background: rgba(147, 51, 234, 0.12); color: #a855f7; border: 1px solid rgba(147, 51, 234, 0.3); font-weight: 700;" title="High-Availability: Redundant instances active across ${activeInstances.length} bridge servers">
                                    🛡️ Multi-Bridge HA (${activeInstances.length} Hosts)
                                </span>
                            ` : ''}
                            ${detailsBridgeBadges}
                        </div>
                        <button class="mt5-btn-config-bridges mt5-ghost-btn" data-login="${acc.login}" data-server="${acc.server}" data-id="${acc.id}" style="
                            padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;
                            display: inline-flex; align-items: center; gap: 4px;
                        ">
                            <span>⚙️</span> Edit Allowed Bridges
                        </button>
                    </div>

                    ${this.detailsSyncing ? `
                        <div id="mt5-details-sync-progress-box" style="
                            background: ${theme.primarySoft};
                            border: 1px solid ${theme.primaryBorder};
                            border-radius: 5px;
                            padding: 6px 10px;
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            gap: 8px;
                        ">
                            <div style="display: flex; align-items: center; gap: 7px;">
                                <span class="mt5-pulse-spin" style="display:inline-block; width:10px; height:10px; border:2px solid ${theme.primary}; border-top-color:transparent; border-radius:50%; animation:mt5spin 0.8s linear infinite;"></span>
                                <span style="color: ${theme.primary}; font-size: 11px; font-weight: 600;" id="mt5-details-sync-title">${this.detailsProgress ? this.detailsProgress.title : 'Syncing Live MT5 Specs...'}</span>
                                <span style="color: ${theme.textMuted}; font-size: 10.5px;" id="mt5-details-sync-detail">(${this.detailsProgress ? this.detailsProgress.detail : 'Loading'})</span>
                            </div>
                            <span style="font-size: 10.5px; font-weight: 700; color: ${theme.primary};" id="mt5-details-sync-pct">${this.detailsProgress ? this.detailsProgress.pct : 25}%</span>
                        </div>
                    ` : ''}

                    <!-- Action Workspace Navigation Tabs -->
                    <div style="display: flex; gap: 6px; border-bottom: 1px solid ${theme.border}; margin-top: 2px;">
                        <button class="mt5-subtab-btn" data-subtab="tickers" style="
                            background: transparent;
                            border: none;
                            border-bottom: 2px solid ${this.detailsSubTab === 'tickers' ? theme.primary : 'transparent'};
                            color: ${this.detailsSubTab === 'tickers' ? (theme.isDark ? '#ffffff' : theme.primary) : theme.textMuted};
                            padding: 6px 12px;
                            font-size: 11.5px;
                            font-weight: 600;
                            cursor: pointer;
                            display: inline-flex;
                            align-items: center;
                            gap: 5px;
                            white-space: nowrap;
                            transition: all 0.12s ease;
                        ">
                            <span id="mt5-tab-tickers-count"><span>📈</span> Market Watch & Tickers (${symbols.length})</span>
                        </button>
                        <button class="mt5-subtab-btn" data-subtab="positions" style="
                            background: transparent;
                            border: none;
                            border-bottom: 2px solid ${this.detailsSubTab === 'positions' ? theme.primary : 'transparent'};
                            color: ${this.detailsSubTab === 'positions' ? (theme.isDark ? '#ffffff' : theme.primary) : theme.textMuted};
                            padding: 6px 12px;
                            font-size: 11.5px;
                            font-weight: 600;
                            cursor: pointer;
                            display: inline-flex;
                            align-items: center;
                            gap: 5px;
                            white-space: nowrap;
                            transition: all 0.12s ease;
                        ">
                            <span id="mt5-tab-positions-count">💼 Active Positions (${positions.length})</span>
                        </button>
                        <button class="mt5-subtab-btn" data-subtab="history" style="
                            background: transparent;
                            border: none;
                            border-bottom: 2px solid ${this.detailsSubTab === 'history' ? theme.primary : 'transparent'};
                            color: ${this.detailsSubTab === 'history' ? (theme.isDark ? '#ffffff' : theme.primary) : theme.textMuted};
                            padding: 6px 12px;
                            font-size: 11.5px;
                            font-weight: 600;
                            cursor: pointer;
                            display: inline-flex;
                            align-items: center;
                            gap: 5px;
                            white-space: nowrap;
                            transition: all 0.12s ease;
                        ">
                            <span>📜</span> Order History (${tradeDeals.length})
                        </button>
                    </div>

                    <!-- Tab 1: Market Watch & Tickers -->
                    ${this.detailsSubTab === 'tickers' ? `
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            <!-- 1. Pinned Top Live Archival Stream Card -->
                            <div class="mt5-hf-live-stream-card" style="
                                display: flex;
                                align-items: center;
                                justify-content: space-between;
                                padding: 8px 12px;
                                background: ${theme.isDark ? 'linear-gradient(135deg, rgba(33,150,243,0.08) 0%, rgba(255,152,0,0.08) 100%)' : 'linear-gradient(135deg, rgba(33,150,243,0.05) 0%, rgba(255,152,0,0.05) 100%)'};
                                border: 1px solid ${theme.isDark ? 'rgba(33,150,243,0.3)' : 'rgba(33,150,243,0.25)'};
                                border-radius: 6px;
                                gap: 12px;
                                flex-wrap: wrap;
                            ">
                                <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
                                    <div id="mt5-hf-live-pulse-dot" style="
                                        width: 10px;
                                        height: 10px;
                                        border-radius: 50%;
                                        background: ${bridgeStatus && bridgeStatus.is_syncing ? '#ff9800' : '#089981'};
                                        box-shadow: 0 0 8px ${bridgeStatus && bridgeStatus.is_syncing ? '#ff9800' : '#089981'};
                                        flex-shrink: 0;
                                        ${bridgeStatus && bridgeStatus.is_syncing ? 'animation: mt5pulse 1.2s ease-in-out infinite;' : ''}
                                    "></div>
                                    <div style="display: flex; flex-direction: column; min-width: 0;">
                                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                            <span style="font-weight: 700; color: #ff9800; font-size: 11px;">🤗 Hugging Face Archival (@${(window.MT5ParquetIndex && window.MT5ParquetIndex.author) || 'bnq-ii'}):</span>
                                            <span id="mt5-live-archival-status" style="font-size: 11px; font-weight: 700; color: ${theme.text};">
                                                ${bridgeStatus && bridgeStatus.is_syncing 
                                                    ? `🔄 Syncing ${bridgeStatus.current_symbol || ''} (${bridgeStatus.current_server || 'Server'}, ${bridgeStatus.current_chunk || '1m'})` 
                                                    : `🟢 Archival Idle · All ${totalManagedCount} Managed Verified`}
                                            </span>
                                        </div>
                                        <div id="mt5-live-archival-sub" style="font-size: 10px; color: ${theme.textMuted}; margin-top: 1px;">
                                            ${bridgeStatus && bridgeStatus.is_syncing 
                                                ? `Live streaming chunks to Hugging Face · Deduplication SHA-256 active` 
                                                : `Fleet autonomously updates 1m & 1D datasets from inception → present`}
                                        </div>
                                    </div>
                                </div>
                                <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
                                    <div style="font-size: 10.5px; color: ${theme.textMuted}; text-align: right; line-height: 1.3;">
                                        <div>Managed Synced: <strong id="mt5-live-synced-count" style="color: #089981;">${syncedMajorCount} / ${totalManagedCount}</strong></div>
                                        <div>Uploaded: <strong id="mt5-live-uploaded-mb" style="color: ${theme.primary};">${((bridgeStatus?.total_bytes_uploaded || 0) / (1024 * 1024)).toFixed(1)} MB</strong></div>
                                    </div>
                                    <button id="mt5-btn-clean-unmanaged" type="button" class="mt5-ghost-btn" style="
                                        padding: 4px 8px;
                                        border-radius: 4px;
                                        font-size: 10px;
                                        font-weight: 600;
                                        cursor: pointer;
                                        display: inline-flex;
                                        align-items: center;
                                        gap: 4px;
                                        background: ${theme.pillBg};
                                        color: ${theme.textMuted};
                                        border: 1px solid ${theme.border};
                                    " title="Purge all legacy repos on Hugging Face that are not in the managed universe">
                                        <span>🧹</span> Clean Stray Repos
                                    </button>
                                </div>
                            </div>

                            <!-- 2. Category Switcher Tabs (Max 50 per category) -->
                            <div class="mt5-category-tabs-bar" style="display: flex; gap: 4px; overflow-x: auto; padding-bottom: 2px;">
                                <button type="button" class="mt5-cat-tab-btn" data-cat="managed" style="
                                    background: ${activeCat === 'managed' ? theme.primary : theme.pillBg};
                                    color: ${activeCat === 'managed' ? '#ffffff' : theme.textMuted};
                                    border: 1px solid ${activeCat === 'managed' ? theme.primary : theme.border};
                                    padding: 3px 10px;
                                    border-radius: 4px;
                                    font-size: 10px;
                                    font-weight: 700;
                                    cursor: pointer;
                                    white-space: nowrap;
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 4px;
                                    transition: all 0.12s ease;
                                ">
                                    <span>⭐</span> All Managed (${totalManagedCount})
                                </button>
                                <button type="button" class="mt5-cat-tab-btn" data-cat="forex" style="
                                    background: ${activeCat === 'forex' ? theme.primary : theme.pillBg};
                                    color: ${activeCat === 'forex' ? '#ffffff' : theme.textMuted};
                                    border: 1px solid ${activeCat === 'forex' ? theme.primary : theme.border};
                                    padding: 3px 10px;
                                    border-radius: 4px;
                                    font-size: 10px;
                                    font-weight: 700;
                                    cursor: pointer;
                                    white-space: nowrap;
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 4px;
                                    transition: all 0.12s ease;
                                ">
                                    <span>💱</span> Forex (${forexCount}/50)
                                </button>
                                <button type="button" class="mt5-cat-tab-btn" data-cat="nasdaq" style="
                                    background: ${activeCat === 'nasdaq' ? theme.primary : theme.pillBg};
                                    color: ${activeCat === 'nasdaq' ? '#ffffff' : theme.textMuted};
                                    border: 1px solid ${activeCat === 'nasdaq' ? theme.primary : theme.border};
                                    padding: 3px 10px;
                                    border-radius: 4px;
                                    font-size: 10px;
                                    font-weight: 700;
                                    cursor: pointer;
                                    white-space: nowrap;
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 4px;
                                    transition: all 0.12s ease;
                                ">
                                    <span>📈</span> Nasdaq (${nasdaqCount}/50)
                                </button>
                                <button type="button" class="mt5-cat-tab-btn" data-cat="crypto" style="
                                    background: ${activeCat === 'crypto' ? theme.primary : theme.pillBg};
                                    color: ${activeCat === 'crypto' ? '#ffffff' : theme.textMuted};
                                    border: 1px solid ${activeCat === 'crypto' ? theme.primary : theme.border};
                                    padding: 3px 10px;
                                    border-radius: 4px;
                                    font-size: 10px;
                                    font-weight: 700;
                                    cursor: pointer;
                                    white-space: nowrap;
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 4px;
                                    transition: all 0.12s ease;
                                ">
                                    <span>⚡</span> Crypto (${cryptoCount}/50)
                                </button>
                                <button type="button" class="mt5-cat-tab-btn" data-cat="commodity" style="
                                    background: ${activeCat === 'commodity' ? theme.primary : theme.pillBg};
                                    color: ${activeCat === 'commodity' ? '#ffffff' : theme.textMuted};
                                    border: 1px solid ${activeCat === 'commodity' ? theme.primary : theme.border};
                                    padding: 3px 10px;
                                    border-radius: 4px;
                                    font-size: 10px;
                                    font-weight: 700;
                                    cursor: pointer;
                                    white-space: nowrap;
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 4px;
                                    transition: all 0.12s ease;
                                ">
                                    <span>🥇</span> Commodities (${commodityCount}/50)
                                </button>
                                <button type="button" class="mt5-cat-tab-btn" data-cat="index" style="
                                    background: ${activeCat === 'index' ? theme.primary : theme.pillBg};
                                    color: ${activeCat === 'index' ? '#ffffff' : theme.textMuted};
                                    border: 1px solid ${activeCat === 'index' ? theme.primary : theme.border};
                                    padding: 3px 10px;
                                    border-radius: 4px;
                                    font-size: 10px;
                                    font-weight: 700;
                                    cursor: pointer;
                                    white-space: nowrap;
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 4px;
                                    transition: all 0.12s ease;
                                ">
                                    <span>📊</span> Indices (${indexCount}/50)
                                </button>
                                <button type="button" class="mt5-cat-tab-btn" data-cat="catalog" style="
                                    background: ${activeCat === 'catalog' ? theme.primary : theme.pillBg};
                                    color: ${activeCat === 'catalog' ? '#ffffff' : theme.textMuted};
                                    border: 1px solid ${activeCat === 'catalog' ? theme.primary : theme.border};
                                    padding: 3px 10px;
                                    border-radius: 4px;
                                    font-size: 10px;
                                    font-weight: 700;
                                    cursor: pointer;
                                    white-space: nowrap;
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 4px;
                                    transition: all 0.12s ease;
                                ">
                                    <span>🌐</span> All Broker Catalog (${symbols.length.toLocaleString()})
                                </button>
                            </div>

                            <!-- 3. Search & Quick Add Bar -->
                            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                                <div style="position: relative; flex: 1; min-width: 180px;">
                                    <input type="text" id="mt5-ticker-search-in" value="${this.tickerSearchQuery || ''}" placeholder="Search in ${activeCat === 'managed' ? 'all managed tickers' : (activeCat === 'catalog' ? 'all broker symbols' : activeCat)}..." style="
                                        width: 100%;
                                        padding: 6px 10px 6px 28px;
                                        background: ${theme.inputBg};
                                        color: ${theme.inputText};
                                        border: 1px solid ${theme.inputBorder};
                                        border-radius: 5px;
                                        font-size: 11.5px;
                                        box-sizing: border-box;
                                        pointer-events: auto;
                                        user-select: text;
                                    ">
                                    <span style="position: absolute; left: 9px; top: 50%; transform: translateY(-50%); color: ${theme.textDim}; font-size: 11px;">🔍</span>
                                </div>
                                ${['forex', 'nasdaq', 'crypto', 'commodity', 'index'].includes(activeCat) ? (() => {
                                    const catList = uCats[activeCat] || [];
                                    const isFull = catList.length >= 50;
                                    return `
                                        <div style="display: flex; gap: 4px; align-items: center;">
                                            <input type="text" id="mt5-ticker-add-in" placeholder="Symbol (e.g. TSLA)" style="
                                                width: 110px;
                                                padding: 5px 8px;
                                                background: ${theme.inputBg};
                                                color: ${theme.inputText};
                                                border: 1px solid ${theme.inputBorder};
                                                border-radius: 5px;
                                                font-size: 11px;
                                                text-transform: uppercase;
                                            ">
                                            <button id="mt5-btn-add-ticker" type="button" data-cat="${activeCat}" ${isFull ? 'disabled' : ''} style="
                                                background: ${isFull ? theme.pillBg : theme.primary};
                                                color: ${isFull ? theme.textMuted : '#ffffff'};
                                                border: 1px solid ${isFull ? theme.border : theme.primary};
                                                padding: 5px 10px;
                                                border-radius: 5px;
                                                font-size: 11px;
                                                font-weight: 600;
                                                cursor: ${isFull ? 'not-allowed' : 'pointer'};
                                                white-space: nowrap;
                                                display: inline-flex;
                                                align-items: center;
                                                gap: 4px;
                                            ">
                                                <span>＋</span> ${isFull ? 'Full (50/50)' : `Add to ${activeCat.charAt(0).toUpperCase() + activeCat.slice(1)} (${catList.length}/50)`}
                                            </button>
                                        </div>
                                    `;
                                })() : ''}
                            </div>

                            <!-- 4. Scrollable Symbols Container -->
                            <div id="mt5-ticker-items-container" style="
                                max-height: 400px;
                                overflow-y: auto;
                                padding-right: 4px;
                                display: flex;
                                flex-direction: column;
                            ">
                                ${(() => {
                                    const visibleCount = this.tickerVisibleCount || 100;
                                    const pageSymbols = filteredSymbols.slice(0, visibleCount);
                                    return this.getTickerListHtml(pageSymbols, theme, acc.server, filteredSymbols.length);
                                })()}
                            </div>
                        </div>
                    ` : ''}

                    <!-- Tab 2: Active Positions -->
                    ${this.detailsSubTab === 'positions' ? `
                        <div id="mt5-positions-items-container" style="display: flex; flex-direction: column; gap: 10px;">
                            ${this.getPositionsTableHtml(positions, theme, acc.server)}
                        </div>
                    ` : ''}

                    <!-- Tab 3: Order History -->
                    ${this.detailsSubTab === 'history' ? `
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            <!-- Mini Performance KPI Cards (True Market Performance, Separate from Deposit) -->
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 6px;">
                                <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 7px 10px;">
                                    <div style="font-size: 10px; color: ${theme.textMuted};">Closed Trades</div>
                                    <div style="font-size: 13.5px; font-weight: 700; color: ${theme.text};">${totalTradeCount} Trades</div>
                                    ${depositDeals.length > 0 ? `<div style="font-size: 9px; color: ${theme.primary}; margin-top: 1px;">+$${initialDeposit.toFixed(0)} deposit</div>` : ''}
                                </div>
                                <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 7px 10px;">
                                    <div style="font-size: 10px; color: ${theme.textMuted};">Trading P&L</div>
                                    <div style="font-size: 13.5px; font-weight: 700; color: ${netTradeProfit >= 0 ? theme.success : theme.error};">${netTradeProfit >= 0 ? '+' : ''}$${netTradeProfit.toFixed(2)}</div>
                                </div>
                                <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 7px 10px;">
                                    <div style="font-size: 10px; color: ${theme.textMuted};">Win Rate</div>
                                    <div style="font-size: 13.5px; font-weight: 700; color: ${Number(winRate) >= 50 ? theme.success : theme.text};">${winRate}%</div>
                                </div>
                                <div style="background: ${theme.cardBg}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 7px 10px;">
                                    <div style="font-size: 10px; color: ${theme.textMuted};">Profit Factor</div>
                                    <div style="font-size: 13.5px; font-weight: 700; color: ${theme.primary};">${profitFactor}</div>
                                </div>
                            </div>

                            <!-- Filter & Controls Toolbar -->
                            <div style="display: flex; flex-direction: column; gap: 6px;">
                                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                                    <div style="position: relative; flex: 1; min-width: 170px;">
                                        <input type="text" id="mt5-history-search-in" value="${this.historySearchQuery}" placeholder="Filter by symbol, ticket, or notes..." style="
                                            width: 100%;
                                            padding: 6px 10px 6px 28px;
                                            background: ${theme.inputBg};
                                            color: ${theme.inputText};
                                            border: 1px solid ${theme.inputBorder};
                                            border-radius: 6px;
                                            font-size: 11.5px;
                                            box-sizing: border-box;
                                            pointer-events: auto;
                                            user-select: text;
                                        ">
                                        <span style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: ${theme.textMuted}; font-size: 11px;">🔍</span>
                                    </div>
                                    <button id="mt5-btn-export-csv" type="button" style="
                                        background: ${theme.cardBg};
                                        border: 1px solid ${theme.border};
                                        color: ${theme.text};
                                        padding: 5px 10px;
                                        border-radius: 6px;
                                        font-size: 11px;
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
                                <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; justify-content: space-between;">
                                    <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap;">
                                        <span style="font-size: 10.5px; color: ${theme.textMuted};">Filter:</span>
                                        ${[
                                            { id: 'ALL', label: 'Closed Trades' },
                                            { id: 'TRADES', label: 'All Trades' },
                                            { id: 'BUY', label: 'Buys' },
                                            { id: 'SELL', label: 'Sells' },
                                            { id: 'DEPOSIT', label: 'Deposits' },
                                            { id: 'ALL_LOGS', label: 'Raw Logs' }
                                        ].map(t => `
                                            <button class="mt5-hist-type-btn" data-type="${t.id}" style="
                                                background: ${this.historyTypeFilter === t.id ? theme.primary : 'transparent'};
                                                color: ${this.historyTypeFilter === t.id ? '#fff' : theme.textMuted};
                                                border: 1px solid ${this.historyTypeFilter === t.id ? theme.primary : theme.border};
                                                padding: 2px 7px;
                                                border-radius: 10px;
                                                font-size: 10px;
                                                font-weight: 600;
                                                cursor: pointer;
                                            ">${t.label}</button>
                                        `).join('')}

                                        <span style="font-size: 10.5px; color: ${theme.textMuted}; margin-left: 4px;">Outcome:</span>
                                        ${[
                                            { id: 'ALL', label: 'All' },
                                            { id: 'WIN', label: 'Wins' },
                                            { id: 'LOSS', label: 'Losses' }
                                        ].map(o => `
                                            <button class="mt5-hist-outcome-btn" data-outcome="${o.id}" style="
                                                background: ${this.historyOutcomeFilter === o.id ? theme.primary : 'transparent'};
                                                color: ${this.historyOutcomeFilter === o.id ? '#fff' : theme.textMuted};
                                                border: 1px solid ${this.historyOutcomeFilter === o.id ? theme.primary : theme.border};
                                                padding: 2px 7px;
                                                border-radius: 10px;
                                                font-size: 10px;
                                                font-weight: 600;
                                                cursor: pointer;
                                            ">${o.label}</button>
                                        `).join('')}
                                    </div>

                                    <div style="display: flex; gap: 4px; align-items: center;">
                                        <span style="font-size: 10.5px; color: ${theme.textMuted};">Period:</span>
                                        <select id="mt5-hist-date-select" style="
                                            background: ${theme.inputBg};
                                            color: ${theme.inputText};
                                            border: 1px solid ${theme.inputBorder};
                                            border-radius: 4px;
                                            padding: 2px 5px;
                                            font-size: 10.5px;
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
                btnRefreshDetails.onclick = async (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    if (id) {
                        btnRefreshDetails.innerHTML = '<span>🔄</span> Syncing...';
                        if (window.MT5API && typeof window.MT5API.syncAccounts === 'function') {
                            try {
                                await window.MT5API.syncAccounts(true);
                            } catch (_) {}
                        }
                        await this.openAccountDetails(id, true);
                    }
                };
            }

            // Subtab navigation in Details view
            modal.querySelectorAll('.mt5-subtab-btn').forEach(b => {
                b.onclick = (e) => {
                    const subtab = e.currentTarget.getAttribute('data-subtab');
                    if (subtab) {
                        this.detailsSubTab = subtab;
                        this.renderModal();
                        if (subtab === 'positions' && this.detailsAccountId && window.MT5API) {
                            window.MT5API.fetchPositions(this.detailsAccountId).then(pos => {
                                if (Array.isArray(pos)) {
                                    this.handleLivePositionUpdate(pos);
                                }
                            }).catch(() => {});
                        }
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

            // Category Tabs Bar (Tickers tab) -> filter category
            modal.querySelectorAll('.mt5-cat-tab-btn').forEach(tab => {
                tab.onclick = (e) => {
                    const cat = e.currentTarget.getAttribute('data-cat') || 'managed';
                    this.tickerCategoryFilter = cat;
                    this.tickerVisibleCount = 100;
                    this.renderModal();
                };
            });

            // Quick Add Ticker Button (Tickers tab)
            const addBtn = modal.querySelector('#mt5-btn-add-ticker');
            const addIn = modal.querySelector('#mt5-ticker-add-in');
            if (addBtn && addIn) {
                const handleAdd = async () => {
                    const sym = addIn.value.trim().toUpperCase();
                    const cat = addBtn.getAttribute('data-cat') || 'nasdaq';
                    if (!sym) return;
                    addBtn.innerHTML = '<span>⏳</span> Adding...';
                    addBtn.disabled = true;
                    if (window.MT5API && typeof window.MT5API.addHFUniverseTicker === 'function') {
                        const res = await window.MT5API.addHFUniverseTicker(cat, sym);
                        if (res && res.error) {
                            alert(res.error);
                        }
                    }
                    this.renderModal();
                };
                addBtn.onclick = handleAdd;
                addIn.onkeydown = (e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') handleAdd();
                };
                addIn.onkeyup = (e) => e.stopPropagation();
            }

            // Clean Unmanaged Stray Repos Button
            const cleanBtn = modal.querySelector('#mt5-btn-clean-unmanaged');
            if (cleanBtn) {
                cleanBtn.onclick = async () => {
                    if (confirm('Purge all legacy repositories on Hugging Face that are NOT in the curated managed universe?')) {
                        cleanBtn.innerHTML = '<span>🧹</span> Cleaning...';
                        cleanBtn.disabled = true;
                        if (window.MT5API && typeof window.MT5API.cleanUnmanagedHFRepos === 'function') {
                            const res = await window.MT5API.cleanUnmanagedHFRepos();
                            alert(`Cleaned ${(res && res.deleted_repos ? res.deleted_repos.length : 0)} stray repos from Hugging Face!`);
                        }
                        this.renderModal();
                    }
                };
            }

            // Search input (Tickers tab) -> instant live filter with smooth typing & debounce
            const searchIn = modal.querySelector('#mt5-ticker-search-in');
            if (searchIn) {
                ['keydown', 'keyup'].forEach(evt => {
                    searchIn.addEventListener(evt, (e) => {
                        e.stopPropagation();
                    });
                });
                searchIn.oninput = (e) => {
                    this.tickerSearchQuery = e.target.value;
                    this.tickerVisibleCount = 100;
                    if (this._tickerSearchTimeout) clearTimeout(this._tickerSearchTimeout);
                    this._tickerSearchTimeout = setTimeout(() => {
                        const server = this.detailsData && this.detailsData.account ? this.detailsData.account.server : '';
                        this.updateTickerListView(modal, this.getTheme(), server);
                    }, 80);
                };
            }

            // Search input (Order History tab) -> filter with keyboard isolation
            const histSearchIn = modal.querySelector('#mt5-history-search-in');
            if (histSearchIn) {
                ['keydown', 'keyup'].forEach(evt => {
                    histSearchIn.addEventListener(evt, (e) => {
                        e.stopPropagation();
                    });
                });
                histSearchIn.oninput = (e) => {
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

            // Close Active Position (from positions tab)
            modal.querySelectorAll('.mt5-btn-close-pos').forEach(btn => {
                btn.onclick = async (e) => {
                    const ticket = e.currentTarget.getAttribute('data-ticket');
                    const aid = e.currentTarget.getAttribute('data-account') || this.detailsAccountId;
                    if (!ticket) return;
                    if (confirm(`Close active position #${ticket}?`)) {
                        btn.disabled = true;
                        btn.textContent = 'Closing...';
                        try {
                            if (window.MT5API && typeof window.MT5API.closePosition === 'function') {
                                const res = await window.MT5API.closePosition({ ticket: Number(ticket), accountId: aid });
                                if (res && res.success) {
                                    if (typeof window.MT5API.fetchPositions === 'function') {
                                        const newPos = await window.MT5API.fetchPositions(aid);
                                        this.handleLivePositionUpdate(newPos);
                                    }
                                } else {
                                    alert(`Failed to close position #${ticket}: ${res ? res.error : 'Unknown error'}`);
                                }
                            }
                        } catch (err) {
                            alert(`Error closing position: ${err.message}`);
                        } finally {
                            btn.disabled = false;
                            btn.textContent = '✖ Close';
                        }
                    }
                };
            });
            // Toggle Update Broker Password form
            const btnTogglePwd = modal.querySelector('#mt5-btn-toggle-update-pwd');
            const pwdContainer = modal.querySelector('#mt5-update-pwd-container');
            if (btnTogglePwd && pwdContainer) {
                btnTogglePwd.onclick = () => {
                    const isHidden = pwdContainer.style.display === 'none' || !pwdContainer.style.display;
                    pwdContainer.style.display = isHidden ? 'block' : 'none';
                    btnTogglePwd.textContent = isHidden ? '✖ Cancel Update' : '🔑 Update Broker Password';
                };
            }

            // Toggle Password Visibility
            const btnToggleVis = modal.querySelector('#mt5-btn-toggle-pwd-visibility');
            const inPwd = modal.querySelector('#mt5-input-update-pwd');
            if (btnToggleVis && inPwd) {
                btnToggleVis.onclick = () => {
                    inPwd.type = inPwd.type === 'password' ? 'text' : 'password';
                    btnToggleVis.textContent = inPwd.type === 'password' ? '👁️' : '🔒';
                };
            }

            // Submit Password Broker Verification Gate
            const btnSubmitPwd = modal.querySelector('#mt5-btn-submit-verify-pwd');
            const feedbackEl = modal.querySelector('#mt5-update-pwd-feedback');
            if (btnSubmitPwd && inPwd) {
                btnSubmitPwd.onclick = async () => {
                    const login = btnSubmitPwd.getAttribute('data-login');
                    const server = btnSubmitPwd.getAttribute('data-server');
                    const newPass = inPwd.value.trim();

                    if (!newPass) {
                        if (feedbackEl) {
                            feedbackEl.style.display = 'block';
                            feedbackEl.style.color = '#ef4444';
                            feedbackEl.textContent = 'Please enter a password to verify.';
                        }
                        return;
                    }

                    btnSubmitPwd.disabled = true;
                    btnSubmitPwd.innerHTML = '<span>🔄</span> Probing Broker...';
                    if (feedbackEl) {
                        feedbackEl.style.display = 'block';
                        feedbackEl.style.color = '#60a5fa';
                        feedbackEl.textContent = `Connecting to broker for #${login} @ ${server}...`;
                    }

                    try {
                        const res = await window.MT5API.verifyAndSaveLocalPassword(login, server, newPass);
                        if (res && res.success) {
                            if (res.verified) {
                                if (feedbackEl) {
                                    feedbackEl.style.color = '#10b981';
                                    feedbackEl.textContent = '✓ Broker verified! Password permanently saved to Bridge DPAPI and Local Vault.';
                                }
                                this.showFloatingSwitchToast('Password Verified', `Account #${login} secured with broker & saved to Bridge DPAPI`, 100, true);
                            } else if (res.staged_offline) {
                                if (feedbackEl) {
                                    feedbackEl.style.color = '#ff9800';
                                    feedbackEl.textContent = '⚠️ Bridge offline. Password staged offline in Browser Vault. Will auto-verify once bridge connects.';
                                }
                                this.showFloatingSwitchToast('Staged Offline', `Account #${login} staged in Browser Vault (awaiting bridge connection)`, 100, true);
                            }
                            setTimeout(() => {
                                if (this.detailsAccountId) this.openAccountDetails(this.detailsAccountId, true);
                            }, 800);
                        } else {
                            if (feedbackEl) {
                                feedbackEl.style.color = '#ef4444';
                                feedbackEl.textContent = `❌ ${res?.error || 'Broker rejected credentials. Working session preserved.'}`;
                            }
                            btnSubmitPwd.disabled = false;
                            btnSubmitPwd.innerHTML = '<span>🔒</span> Verify with Broker & Save';
                        }
                    } catch (err) {
                        if (feedbackEl) {
                            feedbackEl.style.color = '#ef4444';
                            feedbackEl.textContent = `Error: ${err.message}`;
                        }
                        btnSubmitPwd.disabled = false;
                        btnSubmitPwd.innerHTML = '<span>🔒</span> Verify with Broker & Save';
                    }
                };
            }

            // Back Up to Browser Client Vault / Update Local Password
            modal.querySelectorAll('.mt5-btn-save-to-browser-vault').forEach(btn => {
                btn.onclick = async (e) => {
                    const login = e.currentTarget.getAttribute('data-login');
                    const server = e.currentTarget.getAttribute('data-server');
                    const pass = prompt(`Enter password for Account #${login} on '${server}' to save in Browser Vault:`);
                    if (!pass || !pass.trim()) return;

                    const cleanPass = pass.trim();
                    const origBtnText = btn.innerHTML;
                    btn.disabled = true;
                    btn.innerHTML = '<span>🔄</span> Verifying...';

                    try {
                        const res = await window.MT5API.verifyAndSaveLocalPassword(login, server, cleanPass);
                        if (res && res.success) {
                            if (res.verified) {
                                this.showFloatingSwitchToast('Broker Verified & Saved', `Account #${login} verified with broker & secured in Browser Vault + Bridge DPAPI!`, 100, true);
                            } else if (res.staged_offline) {
                                this.showFloatingSwitchToast('Staged Offline', `Account #${login} saved to Browser Vault (Unverified). Will verify once bridge connects.`, 100, true);
                            }
                            if (this.detailsAccountId) this.openAccountDetails(this.detailsAccountId, true);
                        } else {
                            alert(`❌ Broker Rejected Password:\n\n${res?.error || 'Invalid credentials'}\n\nPassword was NOT saved to Local Vault or Bridge.`);
                            btn.disabled = false;
                            btn.innerHTML = origBtnText;
                        }
                    } catch (err) {
                        alert(`❌ Verification Error: ${err.message}`);
                        btn.disabled = false;
                        btn.innerHTML = origBtnText;
                    }
                };
            });

            // Auto-Heal to Bridge DPAPI (from Local Vault)
            modal.querySelectorAll('.mt5-btn-verify-heal-dpapi').forEach(btn => {
                btn.onclick = async (e) => {
                    const login = e.currentTarget.getAttribute('data-login');
                    const server = e.currentTarget.getAttribute('data-server');
                    btn.disabled = true;
                    btn.innerHTML = '<span>🔄</span> Verifying...';

                    let pass = await window.MT5API.getAccountPasswordFromVault(login, server);
                    if (!pass) {
                        pass = prompt(`Enter password for Account #${login} to verify with broker:`);
                    }

                    if (!pass || !pass.trim()) {
                        btn.disabled = false;
                        btn.innerHTML = '⚡ Auto-Heal to Bridge DPAPI';
                        return;
                    }

                    try {
                        const res = await window.MT5API.verifyAndSaveLocalPassword(login, server, pass.trim());
                        if (res && res.verified) {
                            this.showFloatingSwitchToast('Auto-Heal Success', `Account #${login} verified with broker & vaulted in Bridge DPAPI!`, 100, true);
                            setTimeout(() => {
                                if (this.detailsAccountId) this.openAccountDetails(this.detailsAccountId, true);
                            }, 500);
                        } else {
                            alert(`❌ Broker Rejected Password:\n\n${res?.error || 'Invalid credentials'}`);
                            btn.disabled = false;
                            btn.innerHTML = '⚡ Auto-Heal to Bridge DPAPI';
                        }
                    } catch (err) {
                        alert(`Auto-heal failed: ${err.message}`);
                        btn.disabled = false;
                        btn.innerHTML = '⚡ Auto-Heal to Bridge DPAPI';
                    }
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

            const tabParquet = modal.querySelector('#mt5-tab-parquet');
            if (tabParquet) tabParquet.onclick = async () => {
                this.activeTab = 'parquet';
                if (window.MT5ParquetIndex && typeof window.MT5ParquetIndex.pollBridgeStatus === 'function') {
                    await window.MT5ParquetIndex.pollBridgeStatus();
                }
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
                
                // Collect all selected target bridge IDs
                const checkedBoxes = modal.querySelectorAll('.mt5-check-target-bridge:checked');
                const selectedBridgeIds = Array.from(checkedBoxes).map(cb => cb.value);

                if (!nickname || !server || !login || !password) {
                    alert('Please fill in all required fields (Nickname, Server, Login, Password).');
                    return;
                }

                if (selectedBridgeIds.length === 0) {
                    alert('Please select at least one Bridge Server to host and receive this account.');
                    return;
                }

                const theme = this.getTheme();
                const progressBox = modal.querySelector('#mt5-add-progress-box');
                const progressBar = modal.querySelector('#mt5-add-progress-bar');
                const titleEl = modal.querySelector('#mt5-add-progress-title');
                const timerEl = modal.querySelector('#mt5-add-progress-timer');
                const errorBox = modal.querySelector('#mt5-add-error-container');
                const btnCancelAdd = modal.querySelector('#mt5-btn-cancel-add');

                // Disable inputs & lock form during deployment
                const formInputs = modal.querySelectorAll('#mt5-in-nickname, #mt5-in-server, #mt5-in-login, #mt5-in-password, #mt5-in-mult, #mt5-in-risk, .mt5-check-target-bridge');
                formInputs.forEach(el => el.disabled = true);
                btnSaveAcc.style.display = 'none';
                if (btnCancelAdd) btnCancelAdd.style.display = 'none';

                if (progressBox) progressBox.style.display = 'block';
                if (errorBox) {
                    errorBox.style.display = 'none';
                    errorBox.innerHTML = '';
                }
                if (progressBar) {
                    progressBar.style.width = '12%';
                    progressBar.style.background = 'linear-gradient(90deg, #2962ff, #00b0ff)';
                }
                if (titleEl) {
                    titleEl.innerText = `Connecting Account #${login} to Bridge(s)...`;
                    titleEl.style.color = theme.text;
                }
                const spinner = modal.querySelector('#mt5-add-progress-spinner');
                if (spinner) spinner.style.display = 'inline-block';

                // Real-time elapsed stopwatch timer
                let elapsedSec = 0;
                const timerInterval = setInterval(() => {
                    elapsedSec++;
                    const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
                    const ss = String(elapsedSec % 60).padStart(2, '0');
                    if (timerEl) timerEl.innerText = `⏱️ ${mm}:${ss}s`;
                }, 1000);

                const updateStepUI = (stepNum, status, labelOverride = '') => {
                    const row = modal.querySelector(`#mt5-add-step-${stepNum}`);
                    if (!row) return;
                    const iconEl = row.querySelector('.step-icon');
                    const labelEl = row.querySelector('.step-label');
                    if (labelOverride && labelEl) labelEl.innerText = labelOverride;

                    if (status === 'active') {
                        row.style.color = theme.primary;
                        row.style.fontWeight = '600';
                        if (iconEl) iconEl.innerHTML = `<span style="display: inline-block; width: 12px; height: 12px; border: 2px solid ${theme.primary}; border-top-color: transparent; border-radius: 50%; animation: mt5spin 0.8s linear infinite; vertical-align: middle;"></span>`;
                    } else if (status === 'done') {
                        row.style.color = theme.success;
                        row.style.fontWeight = '600';
                        if (iconEl) iconEl.innerHTML = `<span style="color: ${theme.success}; font-weight: 700; font-size: 13px;">✓</span>`;
                    } else if (status === 'error') {
                        row.style.color = theme.error;
                        row.style.fontWeight = '600';
                        if (iconEl) iconEl.innerHTML = `<span style="color: ${theme.error}; font-weight: 700; font-size: 13px;">✗</span>`;
                    }
                };

                updateStepUI(1, 'active');

                const res = await window.MT5API.addAccount({
                    nickname, server, login, password,
                    lot_multiplier: multiplier,
                    risk_percent: risk
                }, selectedBridgeIds, (p) => {
                    if (p.pct && progressBar) progressBar.style.width = `${Math.min(100, Math.max(10, p.pct))}%`;
                    if (p.step) {
                        for (let s = 1; s < p.step; s++) updateStepUI(s, 'done');
                        updateStepUI(p.step, 'active', p.text);
                    }
                });

                clearInterval(timerInterval);

                if (res.success) {
                    for (let s = 1; s <= 5; s++) updateStepUI(s, 'done');
                    if (progressBar) {
                        progressBar.style.width = '100%';
                        progressBar.style.background = '#089981';
                    }
                    if (titleEl) {
                        titleEl.innerHTML = `✓ Account #${login} Connected & Initialized!`;
                        titleEl.style.color = theme.success;
                    }
                    if (spinner) spinner.style.display = 'none';

                    setTimeout(() => {
                        this.viewMode = 'list';
                        this.renderModal();
                    }, 800);
                } else {
                    for (let s = 1; s <= 5; s++) {
                        const row = modal.querySelector(`#mt5-add-step-${s}`);
                        if (row && row.querySelector('.step-icon')?.innerHTML.includes('mt5spin')) {
                            updateStepUI(s, 'error');
                        }
                    }
                    if (titleEl) {
                        titleEl.innerText = `Failed to Connect Account #${login}`;
                        titleEl.style.color = theme.error;
                    }
                    if (spinner) spinner.style.display = 'none';

                    if (errorBox) {
                        errorBox.style.display = 'block';
                        errorBox.innerHTML = `
                            <div style="background: rgba(242,54,69,0.12); border: 1px solid rgba(242,54,69,0.3); border-radius: 4px; padding: 8px 10px; color: ${theme.error}; font-size: 11px; margin-bottom: 8px; line-height: 1.4;">
                                <strong>⚠️ Connection Unsuccessful:</strong><br>
                                <span style="font-size: 10.5px; word-break: break-all;">${res.error || 'Server rejected connection or broker timed out.'}</span>
                            </div>
                            <div style="display: flex; justify-content: flex-end; gap: 6px;">
                                <button id="mt5-btn-retry-add" type="button" style="background: ${theme.primary}; color: #fff; border: none; padding: 5px 14px; border-radius: 4px; font-weight: 600; font-size: 11px; cursor: pointer;">
                                    ← Edit Credentials & Try Again
                                </button>
                            </div>
                        `;
                        const btnRetry = errorBox.querySelector('#mt5-btn-retry-add');
                        if (btnRetry) btnRetry.onclick = () => {
                            // Re-enable form fields for editing
                            formInputs.forEach(el => el.disabled = false);
                            btnSaveAcc.style.display = 'inline-block';
                            btnSaveAcc.disabled = false;
                            btnSaveAcc.innerText = 'Connect & Save Account';
                            if (btnCancelAdd) btnCancelAdd.style.display = 'inline-block';
                            if (progressBox) progressBox.style.display = 'none';
                        };
                    }
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

            // Switch active account (0ms Instant Switch)
            modal.querySelectorAll('.mt5-btn-set-active').forEach(b => {
                b.onclick = async (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    if (id && window.MT5API) {
                        const targetAcc = window.MT5API.accounts.find(a => String(a.id) === String(id));
                        const accName = targetAcc ? targetAcc.nickname : id;

                        // 0ms instant switch!
                        await window.MT5API.setActiveAccount(id);
                        this.updateButtonState();
                        this.renderModal();
                        this.showFloatingSwitchToast('⚡ Feed Switched', `Active chart feed switched to ${accName} (0ms)!`, 100, true);
                    }
                };
            });

            // Delete account (with Multi-Bridge Wipe Selector)
            modal.querySelectorAll('.mt5-btn-delete-acc').forEach(b => {
                b.onclick = async (e) => {
                    if (this.switchingAccountId) return;
                    const id = e.target.getAttribute('data-id');
                    if (!id || !window.MT5API) return;

                    const targetAcc = (window.MT5API.accounts || []).find(a => String(a.id) === String(id) || String(a.login) === String(id));
                    const targetLogin = targetAcc ? String(targetAcc.login || '').trim() : '';
                    const targetServer = targetAcc ? (targetAcc.server || '').trim().toLowerCase() : '';
                    const accNick = targetAcc ? targetAcc.nickname : (targetLogin ? `MT5 #${targetLogin}` : id);

                    const matchingAccs = (window.MT5API.accounts || []).filter(a => {
                        if (String(a.id) === String(id) || String(a.login) === String(id)) return true;
                        if (targetLogin && String(a.login || '').trim() === targetLogin) {
                            if (!targetServer || !a.server || (a.server || '').trim().toLowerCase() === targetServer) return true;
                        }
                        return false;
                    });

                    const hostingEndpoints = [];
                    for (const m of matchingAccs) {
                        const ep = (window.MT5API.endpoints || []).find(e => e.id === m.endpointId || e.url === m.endpointUrl);
                        if (ep && !hostingEndpoints.some(e => e.id === ep.id)) {
                            hostingEndpoints.push(ep);
                        }
                    }

                    if (hostingEndpoints.length > 1) {
                        // Multi-bridge account: open bridge selection view
                        this.deleteTargetAccount = targetAcc;
                        this.deleteTargetEndpoints = hostingEndpoints;
                        this.viewMode = 'delete_select';
                        this.renderModal();
                    } else {
                        const epName = hostingEndpoints[0]?.name || 'Bridge Server';
                        if (confirm(`Wipe clean MT5 instance and permanently delete Account #${targetLogin || id} (${accNick}) from ${epName}?`)) {
                            await window.MT5API.deleteAccount(id);
                            this.renderModal();
                        }
                    }
                };
            });

            // Multi-bridge delete view button handlers
            const btnCancelDel1 = modal.querySelector('#mt5-btn-cancel-delete-select');
            if (btnCancelDel1) btnCancelDel1.onclick = () => { this.viewMode = 'list'; this.renderModal(); };
            const btnCancelDel2 = modal.querySelector('#mt5-btn-cancel-delete-view');
            if (btnCancelDel2) btnCancelDel2.onclick = () => { this.viewMode = 'list'; this.renderModal(); };

            const btnWipeSelected = modal.querySelector('#mt5-btn-wipe-selected-bridges');
            if (btnWipeSelected) {
                btnWipeSelected.onclick = async () => {
                    const checked = Array.from(modal.querySelectorAll('.mt5-delete-bridge-sel:checked')).map(cb => cb.value);
                    if (checked.length === 0) {
                        alert('Please select at least one bridge server to delete from.');
                        return;
                    }
                    btnWipeSelected.disabled = true;
                    btnWipeSelected.innerText = 'Wiping...';
                    await window.MT5API.deleteAccount(this.deleteTargetAccount.id, checked);
                    this.viewMode = 'list';
                    this.renderModal();
                };
            }

            const btnWipeAll = modal.querySelector('#mt5-btn-wipe-all-bridges');
            if (btnWipeAll) {
                btnWipeAll.onclick = async () => {
                    if (!confirm(`Are you sure you want to permanently wipe clean all MT5 instances for Account #${this.deleteTargetAccount?.login} across ALL bridge servers?`)) {
                        return;
                    }
                    btnWipeAll.disabled = true;
                    btnWipeAll.innerText = 'Wiping All...';
                    await window.MT5API.deleteAccount(this.deleteTargetAccount.id, null);
                    this.viewMode = 'list';
                    this.renderModal();
                };
            }

            // Multi-account copy check toggles (synchronize physical accounts across all bridges)
            modal.querySelectorAll('.mt5-check-multi').forEach(c => {
                c.onchange = (e) => {
                    const id = e.target.getAttribute('data-id');
                    if (!window.MT5API) return;
                    const targetAcc = (window.MT5API.accounts || []).find(a => String(a.id) === String(id));
                    const targetLogin = targetAcc ? String(targetAcc.login || '').trim() : '';
                    const siblings = targetLogin ? (window.MT5API.accounts || []).filter(a => String(a.login || '').trim() === targetLogin) : [];
                    const idsToUpdate = new Set([id, ...(targetLogin ? [targetLogin] : []), ...siblings.map(a => String(a.id))]);

                    if (e.target.checked) {
                        idsToUpdate.forEach(i => window.MT5API.multiAccountSelection.add(i));
                    } else {
                        idsToUpdate.forEach(i => window.MT5API.multiAccountSelection.delete(i));
                    }
                    window.MT5API.saveConfig();
                };
            });

            // Sync Fleet (Accounts tab summary bar)
            const btnFleetSync = modal.querySelector('#mt5-btn-fleet-sync');
            if (btnFleetSync && window.MT5API) {
                btnFleetSync.onclick = async () => {
                    btnFleetSync.innerHTML = '<span>⏳</span> Syncing...';
                    btnFleetSync.disabled = true;
                    try {
                        await window.MT5API.syncAllEndpointsFromGist(false);
                        await window.MT5API.syncAccounts(true);
                    } catch (_) {}
                    btnFleetSync.innerHTML = '<span>🔄</span> Sync Fleet';
                    btnFleetSync.disabled = false;
                    this.renderModal();
                };
            }

            // Toggle select all unpaused accounts (deduplicated by physical login::server)
            const btnToggleSelectAll = modal.querySelector('#mt5-btn-toggle-select-all');
            if (btnToggleSelectAll && window.MT5API) {
                btnToggleSelectAll.onclick = () => {
                    const accounts = window.MT5API.accounts || [];
                    const uniqueAccountsMap = new Map();
                    accounts.forEach(acc => {
                        const key = `${String(acc.login || '').trim()}::${String(acc.server || '').trim().toLowerCase()}`;
                        if (!uniqueAccountsMap.has(key)) uniqueAccountsMap.set(key, acc);
                    });
                    const deduped = Array.from(uniqueAccountsMap.values());
                    const unpaused = deduped.filter(a => !window.MT5API.isAccountPaused(a.id));
                    const allSelected = unpaused.length > 0 && unpaused.every(a => window.MT5API.multiAccountSelection.has(a.id));

                    if (allSelected) {
                        unpaused.forEach(a => {
                            const siblings = accounts.filter(s => String(s.login) === String(a.login));
                            siblings.forEach(s => window.MT5API.multiAccountSelection.delete(String(s.id)));
                            window.MT5API.multiAccountSelection.delete(String(a.id));
                            if (a.login) window.MT5API.multiAccountSelection.delete(String(a.login));
                        });
                    } else {
                        unpaused.forEach(a => {
                            const siblings = accounts.filter(s => String(s.login) === String(a.login));
                            siblings.forEach(s => window.MT5API.multiAccountSelection.add(String(s.id)));
                            window.MT5API.multiAccountSelection.add(String(a.id));
                            if (a.login) window.MT5API.multiAccountSelection.add(String(a.login));
                        });
                    }
                    window.MT5API.saveConfig();
                    this.renderModal();
                };
            }

            // Deploy account to standby bridge gateway
            modal.querySelectorAll('.mt5-btn-deploy-to-bridge').forEach(btn => {
                btn.onclick = () => {
                    const epId = btn.getAttribute('data-id');
                    this.preselectedBridgeId = epId;
                    this.activeTab = 'fleet';
                    this.viewMode = 'add';
                    this.renderModal();
                };
            });

            // Open Bridge Routing view for an account
            modal.querySelectorAll('.mt5-btn-config-bridges').forEach(b => {
                b.onclick = (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    const login = e.currentTarget.getAttribute('data-login');
                    const server = e.currentTarget.getAttribute('data-server');
                    let targetAcc = window.MT5API ? window.MT5API.accounts.find(a => String(a.id) === String(id)) : null;
                    if (!targetAcc && window.MT5API) {
                        targetAcc = window.MT5API.accounts.find(a => String(a.login) === String(login) && a.server === server);
                    }
                    if (!targetAcc) {
                        const vault = window.MT5API ? window.MT5API.getClientVault() : [];
                        targetAcc = vault.find(v => String(v.login) === String(login) && v.server === server);
                    }
                    if (targetAcc) {
                        this.routingAccount = targetAcc;
                        this.viewMode = 'routing';
                        this.renderModal();
                    }
                };
            });

            // Back from Bridge Routing
            const btnBackRouting = modal.querySelector('#mt5-btn-back-from-routing');
            if (btnBackRouting) {
                btnBackRouting.onclick = () => {
                    this.viewMode = 'list';
                    this.renderModal();
                };
            }

            const btnCancelRouting = modal.querySelector('#mt5-btn-cancel-routing');
            if (btnCancelRouting) {
                btnCancelRouting.onclick = () => {
                    this.viewMode = 'list';
                    this.renderModal();
                };
            }

            // Dynamically show password box ONLY if user checks a bridge that is NOT currently connected
            const updateRoutingPasswordPrompt = async () => {
                const checkedBoxes = modal.querySelectorAll('.mt5-check-routing-bridge:checked');
                const selectedUnconnected = Array.from(checkedBoxes).some(cb => cb.getAttribute('data-connected') !== 'true');
                const pwdBox = modal.querySelector('#mt5-routing-password-box');
                const statusBanner = modal.querySelector('#mt5-routing-status-banner');
                const bannerText = modal.querySelector('#mt5-routing-status-banner-text');

                const vault = window.MT5API ? window.MT5API.getClientVault() : [];
                const acc = this.routingAccount;
                const accLogin = String(acc?.login || '').trim();
                const accServer = (acc?.server || '').trim().toLowerCase();
                const vEntry = vault.find(v => String(v.login || '').trim() === accLogin && (v.server || '').trim().toLowerCase().includes(accServer));
                const hasVaultPwd = Boolean(vEntry && vEntry.password);

                if (!selectedUnconnected) {
                    if (pwdBox) pwdBox.style.display = 'none';
                    if (statusBanner) statusBanner.style.display = 'flex';
                    if (bannerText) bannerText.innerText = 'Account is already authenticated on its host bridge(s). No password re-entry needed.';
                    return;
                }

                if (hasVaultPwd) {
                    if (pwdBox) pwdBox.style.display = 'none';
                    if (statusBanner) statusBanner.style.display = 'flex';
                    if (bannerText) bannerText.innerText = '🔒 Account credentials saved in encrypted browser vault. Password will deploy automatically.';
                    return;
                }

                // No password in vault -> prompt user
                if (pwdBox) pwdBox.style.display = 'flex';
                if (statusBanner) statusBanner.style.display = 'none';
            };
            modal.querySelectorAll('.mt5-check-routing-bridge').forEach(cb => {
                cb.onchange = updateRoutingPasswordPrompt;
            });

            // Save Bridge Routing
            const btnSaveRouting = modal.querySelector('#mt5-btn-save-bridge-routing');
            if (btnSaveRouting) {
                btnSaveRouting.onclick = async () => {
                    if (!this.routingAccount) return;
                    const checkedBoxes = modal.querySelectorAll('.mt5-check-routing-bridge:checked');
                    const selectedBridgeIds = Array.from(checkedBoxes).map(cb => cb.value);

                    if (selectedBridgeIds.length === 0) {
                        if (!confirm('No bridge servers selected. This will disconnect and remove this account from all bridge servers. Proceed?')) {
                            return;
                        }
                    }

                    const pwdInput = modal.querySelector('#mt5-in-routing-password');
                    const manualPassword = pwdInput ? pwdInput.value.trim() : '';

                    btnSaveRouting.disabled = true;
                    btnSaveRouting.innerText = 'Saving Bridge Routing...';

                    const res = await window.MT5API.updateAccountBridgeRouting(
                        this.routingAccount.login,
                        this.routingAccount.server,
                        selectedBridgeIds,
                        manualPassword
                    );

                    if (res && res.success) {
                        this.viewMode = 'list';
                        this.renderModal();
                        const syncNote = res.syncedFromBridge ? ` (Synced from ${res.syncedFromBridge})` : '';
                        this.showFloatingSwitchToast('🔗 Bridge Routing Updated', `Allowed bridges updated for ${this.routingAccount.nickname || this.routingAccount.login}${syncNote}!`, 100, true);
                    } else {
                        btnSaveRouting.disabled = false;
                        btnSaveRouting.innerText = 'Save Bridge Routing';
                        alert(`Failed to update bridge routing: ${(res && (res.error || (res.errors && res.errors.join('; ')))) || 'Unknown error'}`);
                    }
                };
            }

            // Toggle Add Bridge Form
            const btnToggleAddBridge = modal.querySelector('#mt5-btn-toggle-add-bridge');
            if (btnToggleAddBridge) {
                btnToggleAddBridge.onclick = () => {
                    this.showAddBridgeForm = !this.showAddBridgeForm;
                    this.renderModal();
                };
            }
            const btnCancelAddBridge = modal.querySelector('#mt5-btn-cancel-add-bridge');
            if (btnCancelAddBridge) {
                btnCancelAddBridge.onclick = () => {
                    this.showAddBridgeForm = false;
                    this.accumulatedOcrText = '';
                    this.renderModal();
                };
            }

            // Smart Paste & Clipboard Burn Handler
            const smartPasteBox = modal.querySelector('#mt5-smart-paste-box');
            const btnSmartPaste = modal.querySelector('#mt5-btn-smart-paste');

            const handleSmartPasteData = async (text, imageBlob) => {
                let extracted = {};
                let extractedText = '';
                const pasteBadge = modal.querySelector('#mt5-paste-badge');
                const pasteHint = modal.querySelector('#mt5-paste-hint');

                if (imageBlob) {
                    if (pasteHint) {
                        pasteHint.innerHTML = `<span style="color: #2962ff;">🔄 Analyzing image...</span>`;
                    }
                    extractedText = await this.decodeQrFromImage(imageBlob);
                    if (extractedText && extractedText.startsWith('qr:v1:')) {
                        if (pasteHint) {
                            pasteHint.innerHTML = `<span style="color: #00c853;">🔑 Encrypted 2-Word QR detected! Opening unlock prompt...</span>`;
                        }
                        await this.promptAndUnlockQR(modal, extractedText);
                        await this.wipeClipboardSafely();
                        return;
                    }

                    if (!extractedText) {
                        try {
                            extractedText = await this.ocrImageBlob(imageBlob, (statusMsg) => {
                                if (pasteHint) {
                                    pasteHint.innerHTML = `<span style="color: #2962ff;">🔍 ${statusMsg}</span>`;
                                }
                            });
                        } catch (ocrErr) {
                            console.warn('[SmartPaste] OCR recognition error:', ocrErr);
                        }
                    }

                    if (extractedText && extractedText.trim()) {
                        extracted = this.parseBridgeCredentialsText(extractedText);
                    } else {
                        if (pasteHint) {
                            pasteHint.innerHTML = `<span style="color: #ffa500;">⚠️ Could not detect clear text or QR in screenshot. Please copy text directly from BRIDGE_INFO.txt.</span>`;
                        }
                        return;
                    }
                } else if (text) {
                    // Check if pasted raw text is a qr:v1: string
                    if (typeof text === 'string' && text.trim().startsWith('qr:v1:')) {
                        await this.promptAndUnlockQR(modal, text.trim());
                        await this.wipeClipboardSafely();
                        return;
                    }
                    extracted = this.parseBridgeCredentialsText(text);
                }

                // Append to cumulative OCR / Paste Text Buffer
                const rawSnippet = (text || extractedText || '').trim();
                if (rawSnippet) {
                    if (this.accumulatedOcrText) {
                        this.accumulatedOcrText += '\n\n--- [Paste ' + new Date().toLocaleTimeString() + '] ---\n' + rawSnippet;
                    } else {
                        this.accumulatedOcrText = rawSnippet;
                    }
                    const ocrContainer = modal.querySelector('#mt5-ocr-preview-container');
                    const ocrTextarea = modal.querySelector('#mt5-txt-ocr-buffer');
                    if (ocrContainer) ocrContainer.style.display = 'flex';
                    if (ocrTextarea) {
                        ocrTextarea.value = this.accumulatedOcrText;
                        ocrTextarea.scrollTop = ocrTextarea.scrollHeight;
                    }
                }

                const updatedFields = this.applySmartExtractedFields(modal, extracted);
                if (updatedFields.length > 0) {
                    await this.wipeClipboardSafely();
                    if (pasteBadge) {
                        pasteBadge.innerText = `✓ Extracted: ${updatedFields.join(', ')}`;
                        pasteBadge.style.display = 'inline-block';
                    }
                    if (pasteHint) {
                        pasteHint.innerHTML = `<span style="color: #00c853; font-weight: 600;">🔒 Clipboard wiped clean!</span> (${updatedFields.length} field${updatedFields.length > 1 ? 's' : ''} updated)`;
                    }
                } else {
                    if (pasteHint) {
                        pasteHint.innerHTML = `<span style="color: #ffa500;">⚠️ Could not auto-detect fields. Check extracted text in buffer below to copy manually.</span>`;
                    }
                }
            };

            // Upload QR Code Button & File Picker
            const btnScanQr = modal.querySelector('#mt5-btn-scan-qr');
            const fileQrInput = modal.querySelector('#mt5-file-qr-input');
            if (btnScanQr && fileQrInput) {
                btnScanQr.onclick = () => fileQrInput.click();
                fileQrInput.onchange = async (e) => {
                    const file = e.target.files && e.target.files[0];
                    if (file) {
                        await handleSmartPasteData(null, file);
                    }
                    fileQrInput.value = '';
                };
            }

            if (smartPasteBox) {
                // Focus styling
                smartPasteBox.addEventListener('focus', () => {
                    smartPasteBox.style.borderColor = '#2962ff';
                    smartPasteBox.style.background = 'rgba(41,98,255,0.08)';
                });
                smartPasteBox.addEventListener('blur', () => {
                    smartPasteBox.style.borderColor = 'rgba(41,98,255,0.35)';
                    smartPasteBox.style.background = 'rgba(41,98,255,0.04)';
                });

                // Drag & Drop BRIDGE_QR.png or screenshots onto the Smart Box
                smartPasteBox.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    smartPasteBox.style.borderColor = '#00c853';
                    smartPasteBox.style.background = 'rgba(0,200,83,0.08)';
                });
                smartPasteBox.addEventListener('dragleave', () => {
                    smartPasteBox.style.borderColor = 'rgba(41,98,255,0.35)';
                    smartPasteBox.style.background = 'rgba(41,98,255,0.04)';
                });
                smartPasteBox.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    smartPasteBox.style.borderColor = 'rgba(41,98,255,0.35)';
                    smartPasteBox.style.background = 'rgba(41,98,255,0.04)';
                    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        await handleSmartPasteData(null, e.dataTransfer.files[0]);
                    }
                });
            }

            // Universal modal paste listener (Ctrl+V anywhere in modal)
            const onModalPaste = async (e) => {
                if (!modal.querySelector('#mt5-in-new-url')) return;

                const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
                const isFormInput = activeTag === 'input' || activeTag === 'textarea';
                if (isFormInput && document.activeElement !== smartPasteBox) {
                    const raw = e.clipboardData ? e.clipboardData.getData('text') : '';
                    if (raw && (raw.includes('BRIDGE_INFO') || raw.includes('trycloudflare') || raw.includes('gw_') || raw.includes('API Key'))) {
                        e.preventDefault();
                        await handleSmartPasteData(raw, null);
                        return;
                    }
                    setTimeout(() => {
                        const val = document.activeElement ? (document.activeElement.value || '') : '';
                        if (val && val.includes('/gw_')) {
                            const extracted = this.parseBridgeCredentialsText(val);
                            this.applySmartExtractedFields(modal, extracted);
                            this.wipeClipboardSafely();
                        }
                    }, 50);
                    return;
                }

                if (e.clipboardData) {
                    const items = e.clipboardData.items;
                    let imgFile = null;
                    if (items) {
                        for (let i = 0; i < items.length; i++) {
                            if (items[i].type.indexOf('image') !== -1) {
                                imgFile = items[i].getAsFile();
                                break;
                            }
                        }
                    }
                    if (imgFile) {
                        e.preventDefault();
                        await handleSmartPasteData(null, imgFile);
                        return;
                    }
                    const text = e.clipboardData.getData('text');
                    if (text) {
                        e.preventDefault();
                        await handleSmartPasteData(text, null);
                    }
                }
            };
            modal.addEventListener('paste', onModalPaste);

            if (btnSmartPaste) {
                btnSmartPaste.onclick = async () => {
                    try {
                        let text = '';
                        let imageBlob = null;
                        if (navigator.clipboard && navigator.clipboard.read) {
                            try {
                                const clipboardItems = await navigator.clipboard.read();
                                for (const item of clipboardItems) {
                                    for (const type of item.types) {
                                        if (type.startsWith('image/')) {
                                            imageBlob = await item.getType(type);
                                            break;
                                        }
                                    }
                                    if (imageBlob) break;
                                }
                            } catch (_) {}
                        }
                        if (!imageBlob && navigator.clipboard && navigator.clipboard.readText) {
                            text = await navigator.clipboard.readText();
                        }
                        if (text || imageBlob) {
                            await handleSmartPasteData(text, imageBlob);
                        } else {
                            alert('Clipboard is empty or browser blocked read access. Press Ctrl+V directly to paste!');
                        }
                    } catch (err) {
                        console.warn('[SmartPaste] Button read failed:', err);
                        alert('Browser requires manual paste: Click the box and press Ctrl+V!');
                    }
                };
            }

            // Extracted OCR / Paste Text Buffer Controls
            const btnClearOcr = modal.querySelector('#mt5-btn-clear-ocr-buffer');
            if (btnClearOcr) {
                btnClearOcr.onclick = () => {
                    this.accumulatedOcrText = '';
                    const ocrContainer = modal.querySelector('#mt5-ocr-preview-container');
                    const ocrTextarea = modal.querySelector('#mt5-txt-ocr-buffer');
                    if (ocrTextarea) ocrTextarea.value = '';
                    if (ocrContainer) ocrContainer.style.display = 'none';
                };
            }

            const btnCopyOcr = modal.querySelector('#mt5-btn-copy-ocr-buffer');
            if (btnCopyOcr) {
                btnCopyOcr.onclick = async () => {
                    const ocrTextarea = modal.querySelector('#mt5-txt-ocr-buffer');
                    const val = ocrTextarea ? ocrTextarea.value : (this.accumulatedOcrText || '');
                    if (val) {
                        try {
                            await navigator.clipboard.writeText(val);
                            btnCopyOcr.innerText = '✓ Copied';
                            setTimeout(() => { btnCopyOcr.innerText = '📋 Copy All'; }, 1500);
                        } catch (_) {}
                    }
                };
            }

            const ocrTextarea = modal.querySelector('#mt5-txt-ocr-buffer');
            if (ocrTextarea) {
                ocrTextarea.oninput = () => {
                    this.accumulatedOcrText = ocrTextarea.value;
                };
            }

            // Fetch Fresh from Gist Button
            const btnFetchFreshGist = modal.querySelector('#mt5-btn-fetch-fresh-gist');
            if (btnFetchFreshGist) {
                btnFetchFreshGist.onclick = async () => {
                    const inUrl = modal.querySelector('#mt5-in-new-url');
                    const inKey = modal.querySelector('#mt5-in-new-key');
                    const inShield = modal.querySelector('#mt5-in-new-shield-token');
                    const inName = modal.querySelector('#mt5-in-new-name');
                    const inGistId = modal.querySelector('#mt5-in-new-gist-id');
                    const inGistToken = modal.querySelector('#mt5-in-new-gist-token');
                    const statusGist = modal.querySelector('#mt5-verify-status-gist');

                    const gistId = inGistId ? inGistId.value.trim() : '';
                    const gistToken = inGistToken ? inGistToken.value.trim() : '';
                    const apiKey = inKey ? inKey.value.trim() : '';

                    if (!gistId) {
                        alert('Please enter your 32-character Gist ID from BRIDGE_INFO.txt first.');
                        if (inGistId) inGistId.focus();
                        return;
                    }

                    btnFetchFreshGist.disabled = true;
                    btnFetchFreshGist.innerHTML = '<span>⏳</span> Fetching...';
                    if (statusGist) {
                        statusGist.style.display = 'block';
                        statusGist.style.background = 'rgba(41,98,255,0.08)';
                        statusGist.style.border = '1px solid rgba(41,98,255,0.3)';
                        statusGist.style.color = '#2962ff';
                        statusGist.innerHTML = '<span>🔄</span> Querying private GitHub Gist vault for fresh endpoint URL...';
                    }

                    try {
                        const res = await window.MT5API.testGistAccess({ gistId, gistToken, apiKey });
                        if (res.success && res.decryptedUrl) {
                            if (inUrl) {
                                inUrl.value = res.decryptedUrl;
                                inUrl.style.borderColor = '#00c853';
                                inUrl.style.boxShadow = '0 0 8px rgba(0,200,83,0.4)';
                                setTimeout(() => { inUrl.style.borderColor = ''; inUrl.style.boxShadow = ''; }, 2500);
                            }
                            if (inShield && res.shieldToken) {
                                inShield.value = res.shieldToken;
                                inShield.style.borderColor = '#00c853';
                                inShield.style.boxShadow = '0 0 8px rgba(0,200,83,0.4)';
                                setTimeout(() => { inShield.style.borderColor = ''; inShield.style.boxShadow = ''; }, 2500);
                            }
                            if (inName && (!inName.value || inName.value === 'oracle_cloud') && res.bridgeName) {
                                inName.value = res.bridgeName;
                            }
                            if (inKey && res.autoHealedKey) {
                                inKey.value = res.autoHealedKey;
                                inKey.style.borderColor = '#00c853';
                                inKey.style.boxShadow = '0 0 8px rgba(0,200,83,0.4)';
                                setTimeout(() => { inKey.style.borderColor = ''; inKey.style.boxShadow = ''; }, 3000);
                            }
                            if (statusGist) {
                                statusGist.style.background = 'rgba(0,200,83,0.1)';
                                statusGist.style.border = '1px solid rgba(0,200,83,0.35)';
                                statusGist.style.color = '#00c853';
                                const dateBadge = res.shieldDate ? ` <span style="background: rgba(0,200,83,0.2); padding: 1px 6px; border-radius: 3px; font-size: 9.5px; font-weight: 700; margin-left: 4px;">📅 Daily Shield: ${res.shieldDate}</span>` : '';
                                const olderBadge = res.isOlder ? ` <span style="background: rgba(255,152,0,0.2); color: #ff9800; padding: 1px 5px; border-radius: 3px; font-size: 9px;">(Previous Day Token)</span>` : '';
                                const healedBadge = res.autoHealedKey ? ` <span style="background: rgba(0,200,83,0.25); padding: 1px 6px; border-radius: 3px; font-size: 9.5px; font-weight: 700;">✓ API Key Auto-Corrected from OCR</span>` : '';
                                statusGist.innerHTML = `<span>🟢</span> <strong>Gist Vault Decrypted (PBKDF2/AES-GCM):</strong>${dateBadge}${olderBadge}${healedBadge}<br><code style="font-size: 10px;">${res.decryptedUrl}</code><br><span style="font-size: 9.5px; opacity: 0.9;">Auto-populated Endpoint URL & Shield Token. Verifying connection...</span>`;
                            }
                            // Auto-trigger verify
                            const btnVerify = modal.querySelector('#mt5-btn-verify-add-bridge');
                            if (btnVerify) {
                                setTimeout(() => btnVerify.click(), 150);
                            }

                            // If this bridge was already registered, update its URL & shieldToken in storage immediately
                            if (window.MT5API && Array.isArray(window.MT5API.endpoints)) {
                                let matchingEp = window.MT5API.endpoints.find(e => (gistId && e.gistId === gistId) || (apiKey && e.apiKey === apiKey));
                                if (!matchingEp && window.MT5API.endpoints.length === 1) {
                                    matchingEp = window.MT5API.endpoints[0];
                                }
                                if (matchingEp && res.decryptedUrl) {
                                    matchingEp.url = res.decryptedUrl;
                                    if (res.shieldToken) matchingEp.shieldToken = res.shieldToken;
                                    if (apiKey) matchingEp.apiKey = apiKey;
                                    window.MT5API.saveConfig();
                                    window.MT5API.testSingleEndpoint(matchingEp.id).then(() => {
                                        this.renderModal();
                                    });
                                }
                            }
                        } else if (res.decryptError) {
                            if (statusGist) {
                                statusGist.style.background = 'rgba(242,54,69,0.1)';
                                statusGist.style.border = '1px solid rgba(242,54,69,0.35)';
                                statusGist.style.color = '#f23645';
                                statusGist.innerHTML = `<span>🔴</span> <strong>Gist Vault Decryption Failed:</strong> ${res.decryptError}<br><span style="font-size: 9.5px; opacity: 0.9;">The Gist vault is 100% encrypted with AES-256-GCM. Check your API Key (Password) for typos or copy it directly from BRIDGE_INFO.txt.</span>`;
                            }
                            if (inKey) {
                                inKey.style.borderColor = '#f23645';
                                inKey.style.boxShadow = '0 0 8px rgba(242,54,69,0.4)';
                                setTimeout(() => { inKey.style.borderColor = ''; inKey.style.boxShadow = ''; }, 3000);
                            }
                        } else {
                            if (statusGist) {
                                statusGist.style.background = 'rgba(242,54,69,0.1)';
                                statusGist.style.border = '1px solid rgba(242,54,69,0.35)';
                                statusGist.style.color = '#f23645';
                                statusGist.innerHTML = `<span>🔴</span> <strong>Gist Fetch Failed:</strong> ${res.error || 'No endpoint URL found in Gist.'}`;
                            }
                        }
                    } catch (err) {
                        if (statusGist) {
                            statusGist.style.background = 'rgba(242,54,69,0.1)';
                            statusGist.style.border = '1px solid rgba(242,54,69,0.35)';
                            statusGist.style.color = '#f23645';
                            statusGist.innerHTML = `<span>🔴</span> <strong>Error:</strong> ${err.message}`;
                        }
                    } finally {
                        btnFetchFreshGist.disabled = false;
                        btnFetchFreshGist.innerHTML = '<span>🔄</span> Fetch Fresh from Gist';
                    }
                };
            }

            // Verify Add Bridge Credentials Button (verify without adding)
            const btnVerifyAdd = modal.querySelector('#mt5-btn-verify-add-bridge');
            if (btnVerifyAdd) {
                btnVerifyAdd.onclick = async () => {
                    const inUrl = modal.querySelector('#mt5-in-new-url');
                    const inKey = modal.querySelector('#mt5-in-new-key');
                    const inShield = modal.querySelector('#mt5-in-new-shield-token');
                    const inGistId = modal.querySelector('#mt5-in-new-gist-id');
                    const inGistToken = modal.querySelector('#mt5-in-new-gist-token');

                    const statusBridge = modal.querySelector('#mt5-verify-status-bridge');
                    const statusGist = modal.querySelector('#mt5-verify-status-gist');
                    const summaryBadge = modal.querySelector('#mt5-verify-summary-badge');

                    const url = inUrl ? inUrl.value.trim() : '';
                    const apiKey = inKey ? inKey.value.trim() : '';
                    const shieldToken = inShield ? inShield.value.trim() : '';
                    const gistId = inGistId ? inGistId.value.trim() : '';
                    const gistToken = inGistToken ? inGistToken.value.trim() : '';

                    if (!url && !gistId) {
                        alert('Please enter an Endpoint URL or Gist ID to verify.');
                        return;
                    }

                    btnVerifyAdd.disabled = true;
                    btnVerifyAdd.innerHTML = '<span>⏳</span> Verifying...';

                    if (statusBridge) {
                        statusBridge.style.display = 'block';
                        statusBridge.style.background = 'rgba(41,98,255,0.08)';
                        statusBridge.style.border = '1px solid rgba(41,98,255,0.3)';
                        statusBridge.style.color = '#2962ff';
                        statusBridge.innerHTML = '<span>🔄</span> Testing bridge health & API key authentication...';
                    }
                    if (statusGist) {
                        statusGist.style.display = 'block';
                        statusGist.style.background = 'rgba(41,98,255,0.08)';
                        statusGist.style.border = '1px solid rgba(41,98,255,0.3)';
                        statusGist.style.color = '#2962ff';
                        statusGist.innerHTML = '<span>🔄</span> Checking GitHub Gist access & permissions...';
                    }
                    if (summaryBadge) {
                        summaryBadge.style.display = 'none';
                    }

                    try {
                        let [bridgeRes, gistRes] = await Promise.all([
                            url && window.MT5API ? window.MT5API.testEndpointDetails({ url, apiKey, shieldToken }) : Promise.resolve({ success: false, skipped: true }),
                            gistId && window.MT5API ? window.MT5API.testGistAccess({ gistId, gistToken, apiKey }) : Promise.resolve({ success: false, skipped: true })
                        ]);

                        // Auto-Heal: If gist decrypted with auto-healed key, or provided fresh url/shield token:
                        let effectiveKey = apiKey;
                        if (gistRes.autoHealedKey) {
                            effectiveKey = gistRes.autoHealedKey;
                            if (inKey) {
                                inKey.value = effectiveKey;
                                inKey.style.borderColor = '#00c853';
                                inKey.style.boxShadow = '0 0 8px rgba(0,200,83,0.4)';
                                setTimeout(() => { inKey.style.borderColor = ''; inKey.style.boxShadow = ''; }, 3000);
                            }
                        }
                        if (gistRes.decryptedUrl && inUrl && inUrl.value !== gistRes.decryptedUrl) {
                            inUrl.value = gistRes.decryptedUrl;
                        }
                        if (gistRes.shieldToken && inShield && inShield.value !== gistRes.shieldToken) {
                            inShield.value = gistRes.shieldToken;
                        }

                        // Auto-Heal & Re-test: If bridge test failed or was skipped or if key was auto-healed or gist provided fresh URL:
                        if ((!bridgeRes.success || gistRes.autoHealedKey || (gistRes.decryptedUrl && gistRes.decryptedUrl !== url)) && gistRes.decryptedUrl) {
                            try {
                                const healedRes = await window.MT5API.testEndpointDetails({
                                    url: gistRes.decryptedUrl,
                                    apiKey: effectiveKey,
                                    shieldToken: gistRes.shieldToken || shieldToken
                                });
                                bridgeRes = healedRes;
                                bridgeRes.healedFromGist = true;
                                if (inUrl) {
                                    inUrl.value = gistRes.decryptedUrl;
                                    inUrl.style.borderColor = '#00c853';
                                    inUrl.style.boxShadow = '0 0 8px rgba(0,200,83,0.4)';
                                    setTimeout(() => { inUrl.style.borderColor = ''; inUrl.style.boxShadow = ''; }, 2500);
                                }
                                if (inShield && gistRes.shieldToken) {
                                    inShield.value = gistRes.shieldToken;
                                    inShield.style.borderColor = '#00c853';
                                    inShield.style.boxShadow = '0 0 8px rgba(0,200,83,0.4)';
                                    setTimeout(() => { inShield.style.borderColor = ''; inShield.style.boxShadow = ''; }, 2500);
                                }
                            } catch (_) {}
                        }

                        // Render Bridge Status
                        if (statusBridge) {
                            if (!url && !bridgeRes.healedFromGist) {
                                statusBridge.style.background = 'rgba(120,123,134,0.08)';
                                statusBridge.style.border = '1px solid rgba(120,123,134,0.3)';
                                statusBridge.style.color = '#888';
                                statusBridge.innerHTML = '<span>⚪</span> <strong>Bridge Server:</strong> Endpoint URL not provided (skipped).';
                            } else if (bridgeRes.success) {
                                statusBridge.style.background = 'rgba(0,200,83,0.1)';
                                statusBridge.style.border = '1px solid rgba(0,200,83,0.35)';
                                statusBridge.style.color = '#00c853';
                                const accsText = bridgeRes.accountsCount !== undefined ? ` • <strong>${bridgeRes.accountsCount}</strong> MT5 account${bridgeRes.accountsCount === 1 ? '' : 's'} detected` : ' • API Key authenticated';
                                const healedText = bridgeRes.healedFromGist ? ' <span style="background: rgba(0,200,83,0.2); padding: 1px 4px; border-radius: 3px; font-size: 9px; margin-left: 4px;">✓ URL Auto-Healed from Gist Vault</span>' : '';
                                statusBridge.innerHTML = `<span>🟢</span> <strong>Bridge Online:</strong> Reachable in <strong>${bridgeRes.ping}ms</strong>${accsText}${healedText}.`;
                            } else if (bridgeRes.authFailed) {
                                statusBridge.style.background = 'rgba(242,54,69,0.1)';
                                statusBridge.style.border = '1px solid rgba(242,54,69,0.35)';
                                statusBridge.style.color = '#f23645';
                                statusBridge.innerHTML = `<span>🔴</span> <strong>Bridge Online (${bridgeRes.ping}ms)</strong>, but <strong>API Key Invalid</strong> (HTTP 401 Unauthorized).`;
                            } else {
                                statusBridge.style.background = 'rgba(242,54,69,0.1)';
                                statusBridge.style.border = '1px solid rgba(242,54,69,0.35)';
                                statusBridge.style.color = '#f23645';
                                statusBridge.innerHTML = `<span>🔴</span> <strong>Bridge Unreachable:</strong> ${bridgeRes.error || 'Connection failed'}`;
                            }
                        }

                        // Render Gist Status
                        if (statusGist) {
                            if (!gistId) {
                                statusGist.style.background = 'rgba(120,123,134,0.08)';
                                statusGist.style.border = '1px solid rgba(120,123,134,0.3)';
                                statusGist.style.color = '#888';
                                statusGist.innerHTML = '<span>⚪</span> <strong>Gist Auto-Discovery:</strong> Not configured (optional for static URLs).';
                            } else if (gistRes.success) {
                                statusGist.style.background = 'rgba(0,200,83,0.1)';
                                statusGist.style.border = '1px solid rgba(0,200,83,0.35)';
                                statusGist.style.color = '#00c853';
                                const tokenSource = gistRes.isUsingMaster ? 'Master PAT' : (gistRes.hasToken ? 'Custom PAT' : 'Public');
                                let decText = '';
                                if (gistRes.decryptedUrl) {
                                    const dateText = gistRes.shieldDate ? ` • Shield Date: ${gistRes.shieldDate}` : '';
                                    decText = ` • Encrypted Vault Decrypted ✓${dateText}`;
                                } else if (gistRes.decryptError) {
                                    decText = ` • <span style="color: #f23645; font-weight: 600;">Decryption Failed (Invalid API Key)</span>`;
                                } else if (gistRes.hasPayload) {
                                    decText = ' • Encrypted vault found (API key required)';
                                }
                                statusGist.innerHTML = `<span>🟢</span> <strong>Gist Verified:</strong> Accessible via ${tokenSource}${decText}.`;
                                if (gistRes.decryptError) {
                                    statusGist.innerHTML += `<div style="margin-top: 4px; font-size: 9.5px; color: #f23645;">⚠️ ${gistRes.decryptError}</div>`;
                                }
                            } else {
                                statusGist.style.background = 'rgba(242,54,69,0.1)';
                                statusGist.style.border = '1px solid rgba(242,54,69,0.35)';
                                statusGist.style.color = '#f23645';
                                statusGist.innerHTML = `<span>🔴</span> <strong>Gist Access Failed:</strong> ${gistRes.error || 'Failed to access Gist'}`;
                            }
                        }

                        // Render Summary Badge
                        if (summaryBadge) {
                            summaryBadge.style.display = 'inline-block';
                            if (bridgeRes.success && (!gistId || gistRes.success)) {
                                summaryBadge.style.background = 'rgba(0,200,83,0.12)';
                                summaryBadge.style.color = '#00c853';
                                const healedTag = gistRes.autoHealedKey ? ' (API Key Auto-Corrected from OCR)' : (bridgeRes.healedFromGist ? ' (URL Auto-Healed from Gist)' : '');
                                summaryBadge.innerHTML = `✓ All Verified & Ready to Add${healedTag}`;
                            } else if (bridgeRes.authFailed) {
                                summaryBadge.style.background = 'rgba(255,152,0,0.12)';
                                summaryBadge.style.color = '#ff9800';
                                summaryBadge.innerHTML = '⚠️ Bridge Online, but API Key Invalid';
                            } else if (bridgeRes.success && !gistRes.success) {
                                summaryBadge.style.background = 'rgba(255,152,0,0.12)';
                                summaryBadge.style.color = '#ff9800';
                                summaryBadge.innerHTML = '⚠️ Bridge Online, but Gist Failed';
                            } else if (!bridgeRes.success && gistRes.success && gistRes.decryptError) {
                                summaryBadge.style.background = 'rgba(255,152,0,0.12)';
                                summaryBadge.style.color = '#ff9800';
                                summaryBadge.innerHTML = '⚠️ Check API Key (Decryption Failed)';
                            } else if (!url && !bridgeRes.success) {
                                summaryBadge.style.background = 'rgba(255,152,0,0.12)';
                                summaryBadge.style.color = '#ff9800';
                                summaryBadge.innerHTML = '⚠️ Endpoint URL Empty or Unreachable';
                            } else {
                                summaryBadge.style.background = 'rgba(242,54,69,0.12)';
                                summaryBadge.style.color = '#f23645';
                                summaryBadge.innerHTML = '✕ Verification Failed';
                            }
                        }
                    } catch (err) {
                        if (summaryBadge) {
                            summaryBadge.style.display = 'inline-block';
                            summaryBadge.style.background = 'rgba(242,54,69,0.12)';
                            summaryBadge.style.color = '#f23645';
                            summaryBadge.innerHTML = '✕ Error: ' + err.message;
                        }
                    } finally {
                        btnVerifyAdd.disabled = false;
                        btnVerifyAdd.innerHTML = '<span>🔍</span> Verify Credentials';
                    }
                };
            }

            // Add Bridge Endpoint
            const btnAddEp = modal.querySelector('#mt5-btn-add-endpoint');
            if (btnAddEp) {
                btnAddEp.onclick = async () => {
                    const name = (modal.querySelector('#mt5-in-new-name').value || '').trim();
                    let url = (modal.querySelector('#mt5-in-new-url').value || '').trim();
                    const apiKey = (modal.querySelector('#mt5-in-new-key').value || 'CHANGE_THIS_BRIDGE_API_KEY').trim();
                    const shieldToken = (modal.querySelector('#mt5-in-new-shield-token')?.value || '').trim();
                    const gistId = (modal.querySelector('#mt5-in-new-gist-id')?.value || '').trim();
                    const gistToken = (modal.querySelector('#mt5-in-new-gist-token')?.value || '').trim();
                    const masterToken = window.MT5API ? window.MT5API.getMasterGistToken() : '';
                    const effectiveToken = gistToken || masterToken;

                    if (!url && (!gistId || !effectiveToken)) {
                        alert('Please enter a valid Endpoint URL or provide Gist ID (with individual or Master GitHub PAT configured).');
                        return;
                    }

                    if (window.MT5API) {
                        const res = window.MT5API.addEndpoint({
                            name: name || url || 'MT5 Bridge',
                            url: url || 'https://discovering-endpoint',
                            apiKey,
                            shieldToken,
                            gistId,
                            gistToken,
                            enabled: true
                        });
                        if (res.success) {
                            this.showAddBridgeForm = false;
                            this.accumulatedOcrText = '';
                            await this.wipeClipboardSafely();
                            if (gistId && effectiveToken) {
                                await window.MT5API.syncEndpointFromGist(res.endpoint.id, true);
                            }
                            await window.MT5API.testSingleEndpoint(res.endpoint.id);
                            this.renderModal();
                        } else {
                            alert(res.error || 'Failed to add endpoint');
                        }
                    }
                };
            }

            // Set Primary Endpoint
            modal.querySelectorAll('.mt5-btn-set-primary-endpoint').forEach(btn => {
                btn.onclick = (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    if (id && window.MT5API) {
                        window.MT5API.setActiveEndpoint(id);
                        this.renderModal();
                    }
                };
            });

            // Toggle Endpoint (Enable / Disable)
            modal.querySelectorAll('.mt5-btn-toggle-endpoint').forEach(btn => {
                btn.onclick = (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    if (id && window.MT5API) {
                        window.MT5API.toggleEndpoint(id);
                        this.renderModal();
                    }
                };
            });

            // Ping Single Endpoint
            modal.querySelectorAll('.mt5-btn-ping-endpoint').forEach(btn => {
                btn.onclick = async (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    btn.innerText = 'Pinging...';
                    if (id && window.MT5API) {
                        const res = await window.MT5API.testSingleEndpoint(id);
                        if (res.success) {
                            alert(`✓ Bridge Online! Ping latency: ${res.ping}ms`);
                        } else {
                            alert(`✕ Connection Failed: ${res.error}`);
                        }
                        this.renderModal();
                    }
                };
            });

            // Sync Single Endpoint from Gist
            modal.querySelectorAll('.mt5-btn-sync-single-gist').forEach(btn => {
                btn.onclick = async (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    if (!id || !window.MT5API) return;
                    btn.innerText = 'Syncing...';
                    btn.disabled = true;
                    const res = await window.MT5API.syncEndpointFromGist(id, true);
                    if (res.success) {
                        const testRes = await window.MT5API.testSingleEndpoint(id);
                        alert(`✓ Gist Sync Succeeded!\nEndpoint URL: ${window.MT5API.endpoints.find(x => x.id === id)?.url || ''}\nStatus: ${testRes.success ? `Online (${testRes.ping}ms ping)` : `Offline (${testRes.error})`}`);
                    } else {
                        alert(`✕ Gist Sync Failed: ${res.reason || res.error}`);
                    }
                    this.renderModal();
                };
            });

            // Delete Endpoint
            modal.querySelectorAll('.mt5-btn-delete-endpoint').forEach(btn => {
                btn.onclick = (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    if (id && window.MT5API) {
                        if (confirm('Are you sure you want to remove this bridge endpoint?')) {
                            window.MT5API.deleteEndpoint(id);
                            this.renderModal();
                        }
                    }
                };
            });

            // Toggle API Key / Token password visibility
            modal.querySelectorAll('.mt5-btn-toggle-key-eye').forEach(btn => {
                btn.onclick = (e) => {
                    const parent = e.currentTarget.parentElement;
                    const input = parent ? parent.querySelector('input') : null;
                    if (input) {
                        input.type = input.type === 'password' ? 'text' : 'password';
                        btn.innerText = input.type === 'password' ? '👁️' : '🔒';
                    }
                };
            });

            // Edit Endpoint (Toggle inline edit form)
            modal.querySelectorAll('.mt5-btn-edit-endpoint').forEach(btn => {
                btn.onclick = (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    this.editingEndpointId = (this.editingEndpointId === id) ? null : id;
                    this.renderModal();
                };
            });

            // Toggle Gist ID between morphed display and raw value
            modal.querySelectorAll('.mt5-btn-toggle-gist-morph').forEach(btn => {
                btn.onclick = (e) => {
                    const parent = e.currentTarget.parentElement;
                    const input = parent ? parent.querySelector('.mt5-in-edit-gist-id') : null;
                    if (input) {
                        const raw = input.getAttribute('data-raw') || '';
                        const morphed = this.morphGistId(raw);
                        if (input.value === morphed) {
                            input.value = raw;
                            btn.innerText = '🔒';
                            btn.title = 'Morph Gist ID for privacy';
                        } else {
                            input.value = morphed;
                            btn.innerText = '👁️';
                            btn.title = 'Reveal full Gist ID';
                        }
                    }
                };
            });

            // Save Global Master GitHub PAT
            const btnSaveMaster = modal.querySelector('#mt5-btn-save-master-token');
            if (btnSaveMaster && window.MT5API) {
                btnSaveMaster.onclick = async () => {
                    const inMaster = modal.querySelector('#mt5-in-master-gist-token');
                    const token = inMaster ? inMaster.value.trim() : '';
                    if (!token) {
                        alert('Please paste a valid GitHub PAT token (ghp_...).');
                        return;
                    }
                    btnSaveMaster.innerText = 'Saving...';
                    btnSaveMaster.disabled = true;
                    await window.MT5API.setMasterGistToken(token);
                    alert('✓ Global Master GitHub PAT saved encrypted in localStorage!\nAll bridges with Auto-Discovery Gists will now automatically share this token.');
                    this.renderModal();
                };
            }

            // Clear Global Master GitHub PAT
            const btnClearMaster = modal.querySelector('#mt5-btn-clear-master-token');
            if (btnClearMaster && window.MT5API) {
                btnClearMaster.onclick = async () => {
                    if (confirm('Clear Global Master GitHub Gist Token?')) {
                        await window.MT5API.clearMasterGistToken();
                        this.renderModal();
                    }
                };
            }

            // Save Hugging Face Write Token to Bridge
            const btnSaveHfToken = modal.querySelector('#mt5-btn-save-hf-token');
            if (btnSaveHfToken) {
                btnSaveHfToken.onclick = async () => {
                    const inToken = modal.querySelector('#mt5-in-hf-write-token');
                    const token = inToken ? inToken.value.trim() : '';
                    if (!token) {
                        alert('Please enter a valid Hugging Face Write Token (hf_...).');
                        return;
                    }
                    const ep = window.MT5API ? window.MT5API.getActiveEndpoint() : null;
                    if (!ep || !ep.url) {
                        alert('Please connect to an MT5 Bridge endpoint first to save your token.');
                        return;
                    }
                    btnSaveHfToken.innerText = 'Saving...';
                    btnSaveHfToken.disabled = true;
                    try {
                        const res = await fetch(`${ep.url}/api/hf/token`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-API-Key': ep.apiKey || '',
                                'X-Shield-Token': ep.shieldToken || ''
                            },
                            body: JSON.stringify({ token })
                        });
                        const data = await res.json();
                        if (data && data.success) {
                            if (data.author) {
                                window.HF_AUTHOR = data.author;
                                try { localStorage.setItem('hf_author', data.author); } catch(_) {}
                                if (window.MT5ParquetIndex) window.MT5ParquetIndex.setAuthor(data.author);
                            }
                            alert(`✓ Hugging Face Token saved on Bridge!\nAuthenticated Publisher: ${data.author || 'Active'}`);
                            this.renderModal();
                        } else {
                            alert(`✕ Failed to save HF token: ${data.error || 'Check credentials'}`);
                        }
                    } catch (err) {
                        alert(`✕ Network error saving HF token: ${err.message}`);
                    } finally {
                        btnSaveHfToken.innerText = 'Save Token';
                        btnSaveHfToken.disabled = false;
                    }
                };
            }

            // Add Community / Secondary Discovery Username
            const btnAddDiscovery = modal.querySelector('#mt5-btn-add-discovery-username');
            if (btnAddDiscovery) {
                btnAddDiscovery.onclick = () => {
                    const inUser = modal.querySelector('#mt5-in-discovery-username');
                    const username = inUser ? inUser.value.trim() : '';
                    if (!username) return;
                    if (window.MT5ParquetIndex) {
                        const added = window.MT5ParquetIndex.addDiscoveryAuthor(username);
                        if (added) {
                            this.renderModal();
                        } else {
                            alert(`Namespace "${username}" is already in your discovery list.`);
                        }
                    }
                };
            }

            // Remove Discovery Username
            modal.querySelectorAll('.mt5-btn-remove-discovery-author').forEach(btn => {
                btn.onclick = (e) => {
                    const author = e.currentTarget.getAttribute('data-author');
                    if (author && window.MT5ParquetIndex) {
                        window.MT5ParquetIndex.removeDiscoveryAuthor(author);
                        this.renderModal();
                    }
                };
            });

            // Trigger Archival for Active Chart Symbol
            const btnSyncCurrent = modal.querySelector('#mt5-btn-sync-current-symbol');
            if (btnSyncCurrent) {
                btnSyncCurrent.onclick = async () => {
                    const sym = (window.MT5API && window.MT5API.activeSymbol) || 'XAUUSD';
                    const activeAcc = window.MT5API ? window.MT5API.getActiveAccount() : null;
                    const server = activeAcc ? activeAcc.server : null;
                    if (window.MT5API && typeof window.MT5API.triggerHFSync === 'function') {
                        btnSyncCurrent.innerText = '⚡ Queuing...';
                        await window.MT5API.triggerHFSync(sym, server);
                        alert(`✓ Symbol "${sym}" prioritized for background Parquet archival!\nThe bridge will extract and upload to Hugging Face, then wipe temporary candles.`);
                        if (window.MT5ParquetIndex) await window.MT5ParquetIndex.pollBridgeStatus();
                        this.renderModal();
                    }
                };
            }

            // Refresh HF Status
            const btnRefreshHf = modal.querySelector('#mt5-btn-refresh-hf-status');
            if (btnRefreshHf) {
                btnRefreshHf.onclick = async () => {
                    btnRefreshHf.innerHTML = '<span>🔄</span> Checking...';
                    if (window.MT5ParquetIndex) {
                        await window.MT5ParquetIndex.pollBridgeStatus();
                    }
                    this.renderModal();
                };
            }

            // Parquet Storage Stats & Expiration Cleaners
            const updateStorageDisplay = async () => {
                const el = modal.querySelector('#mt5-parquet-storage-text');
                if (!el) return;
                try {
                    if (window.SyncManager && typeof window.SyncManager.getParquetStorageStats === 'function') {
                        const stats = await window.SyncManager.getParquetStorageStats();
                        el.innerHTML = `💾 Browser Storage: <strong>${stats.totalMb} MB</strong> (${stats.fileCount} Parquet chunks cached) • <em>${stats.expiredCount} expired (> 7 days)</em>`;
                    } else {
                        el.textContent = '💾 Browser Storage: Active (IndexedDB)';
                    }
                } catch (_) {
                    el.textContent = '💾 Browser Storage: Active';
                }
            };
            updateStorageDisplay();

            const btnCleanExpired = modal.querySelector('#mt5-btn-clean-expired-parquet');
            if (btnCleanExpired) {
                btnCleanExpired.onclick = async () => {
                    btnCleanExpired.textContent = '🧹 Cleaning...';
                    if (window.SyncManager && typeof window.SyncManager.clearExpiredParquetFiles === 'function') {
                        const count = await window.SyncManager.clearExpiredParquetFiles();
                        alert(`✓ Successfully purged ${count || 0} expired Parquet files older than 1 week (7 days).`);
                    }
                    await updateStorageDisplay();
                    btnCleanExpired.textContent = '🧹 Purge Expired (> 7 Days)';
                };
            }

            const btnClearAll = modal.querySelector('#mt5-btn-clear-all-parquet');
            if (btnClearAll) {
                btnClearAll.onclick = async () => {
                    if (confirm("Are you sure you want to clear all locally cached Parquet data from your browser? Data will re-download automatically when opening charts.")) {
                        btnClearAll.textContent = '🗑️ Clearing...';
                        if (window.SyncManager && typeof window.SyncManager.clearAllParquetFiles === 'function') {
                            await window.SyncManager.clearAllParquetFiles();
                        }
                        if (window.parquetCache) window.parquetCache = {};
                        await updateStorageDisplay();
                        btnClearAll.textContent = '🗑️ Clear All Parquet Cache';
                    }
                };
            }

            // Fetch from Gist inside Edit mode
            modal.querySelectorAll('.mt5-btn-edit-sync-gist').forEach(btn => {
                btn.onclick = async (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    const card = e.currentTarget.closest('.mt5-endpoint-card');
                    if (!id || !card || !window.MT5API) return;

                    const inGistId = card.querySelector('.mt5-in-edit-gist-id');
                    const inGistToken = card.querySelector('.mt5-in-edit-gist-token');
                    const inUrl = card.querySelector('.mt5-in-edit-url');
                    const inKey = card.querySelector('.mt5-in-edit-key');

                    const existingEp = window.MT5API.endpoints.find(x => x.id === id);
                    let gistId = inGistId ? inGistId.value.trim() : '';
                    if (gistId.includes('••••') || (existingEp && gistId === this.morphGistId(existingEp.gistId))) {
                        gistId = inGistId.getAttribute('data-raw') || (existingEp ? existingEp.gistId : '');
                    }

                    let gistToken = inGistToken ? inGistToken.value.trim() : '';
                    if (!gistToken && existingEp && existingEp.gistToken) {
                        gistToken = existingEp.gistToken;
                    }

                    const masterToken = window.MT5API.getMasterGistToken();
                    const effectiveToken = gistToken || masterToken;

                    if (!gistId || !effectiveToken) {
                        alert('Please fill the Auto-Discovery Gist ID and ensure either a Bridge PAT or Master PAT Token is configured.');
                        return;
                    }

                    const apiKey = inKey ? inKey.value.trim() : '';

                    // Save settings onto endpoint before calling sync
                    window.MT5API.updateEndpoint(id, { gistId, gistToken, apiKey });

                    btn.innerText = 'Fetching...';
                    btn.disabled = true;
                    const res = await window.MT5API.syncEndpointFromGist(id, true);
                    if (res.success && res.url) {
                        if (inUrl) inUrl.value = res.url;
                        alert(`✓ Discovered Rotated URL from Gist:\n${res.url}`);
                    } else {
                        alert(`✕ Failed to sync from Gist: ${res.reason || res.error || 'Check Gist ID and Token'}`);
                    }
                    btn.innerText = '⚡ Fetch from Gist';
                    btn.disabled = false;
                };
            });

            // Cancel Edit Endpoint
            modal.querySelectorAll('.mt5-btn-cancel-edit-ep').forEach(btn => {
                btn.onclick = () => {
                    this.editingEndpointId = null;
                    this.renderModal();
                };
            });

            // Verify Edit Endpoint (verify without saving)
            modal.querySelectorAll('.mt5-btn-verify-edit-ep').forEach(btn => {
                btn.onclick = async (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    const card = e.currentTarget.closest('.mt5-endpoint-card');
                    if (!id || !card || !window.MT5API) return;

                    const inUrl = card.querySelector('.mt5-in-edit-url');
                    const inKey = card.querySelector('.mt5-in-edit-key');
                    const inShield = card.querySelector('.mt5-in-edit-shield-token');
                    const inGistId = card.querySelector('.mt5-in-edit-gist-id');
                    const inGistToken = card.querySelector('.mt5-in-edit-gist-token');

                    const statusBridge = card.querySelector('.mt5-edit-verify-status-bridge');
                    const statusGist = card.querySelector('.mt5-edit-verify-status-gist');
                    const summaryBadge = card.querySelector('.mt5-edit-verify-summary');

                    const existingEp = (window.MT5API.endpoints || []).find(ep => ep.id === id);

                    const url = inUrl ? inUrl.value.trim() : '';
                    let apiKey = inKey ? inKey.value.trim() : '';
                    if (!apiKey && existingEp && existingEp.apiKey) apiKey = existingEp.apiKey;

                    let shieldToken = inShield ? inShield.value.trim() : '';
                    if (!shieldToken && existingEp && existingEp.shieldToken) shieldToken = existingEp.shieldToken;

                    let gistId = inGistId ? inGistId.value.trim() : '';
                    if (gistId.includes('••••') || (existingEp && gistId === this.morphGistId(existingEp.gistId))) {
                        gistId = inGistId.getAttribute('data-raw') || (existingEp ? existingEp.gistId : '');
                    }

                    let gistToken = inGistToken ? inGistToken.value.trim() : '';
                    if (!gistToken && existingEp && existingEp.gistToken) gistToken = existingEp.gistToken;

                    if (!url && !gistId) {
                        alert('Please enter an Endpoint URL or Gist ID to verify.');
                        return;
                    }

                    btn.disabled = true;
                    btn.innerHTML = '<span>⏳</span> Verifying...';

                    if (statusBridge) {
                        statusBridge.style.display = 'block';
                        statusBridge.style.background = 'rgba(41,98,255,0.08)';
                        statusBridge.style.border = '1px solid rgba(41,98,255,0.3)';
                        statusBridge.style.color = '#2962ff';
                        statusBridge.innerHTML = '<span>🔄</span> Testing bridge health & API key authentication...';
                    }
                    if (statusGist) {
                        statusGist.style.display = 'block';
                        statusGist.style.background = 'rgba(41,98,255,0.08)';
                        statusGist.style.border = '1px solid rgba(41,98,255,0.3)';
                        statusGist.style.color = '#2962ff';
                        statusGist.innerHTML = '<span>🔄</span> Checking GitHub Gist access...';
                    }

                    try {
                        let [bridgeRes, gistRes] = await Promise.all([
                            url && window.MT5API ? window.MT5API.testEndpointDetails({ url, apiKey, shieldToken }) : Promise.resolve({ success: false, skipped: true }),
                            gistId && window.MT5API ? window.MT5API.testGistAccess({ gistId, gistToken, apiKey }) : Promise.resolve({ success: false, skipped: true })
                        ]);

                        // Auto-Heal: If bridge test failed or key was auto-healed, test with fresh URL & key!
                        let effectiveKey = apiKey;
                        if (gistRes.autoHealedKey) {
                            effectiveKey = gistRes.autoHealedKey;
                            if (inKey) {
                                inKey.value = effectiveKey;
                                inKey.style.borderColor = '#00c853';
                                inKey.style.boxShadow = '0 0 8px rgba(0,200,83,0.4)';
                                setTimeout(() => { inKey.style.borderColor = ''; inKey.style.boxShadow = ''; }, 3000);
                            }
                        }
                        if ((!bridgeRes.success || gistRes.autoHealedKey) && gistRes.decrypted && gistRes.decryptedUrl) {
                            try {
                                const healedRes = await window.MT5API.testEndpointDetails({
                                    url: gistRes.decryptedUrl,
                                    apiKey: effectiveKey,
                                    shieldToken: gistRes.shieldToken || shieldToken
                                });
                                if (healedRes.success) {
                                    bridgeRes = healedRes;
                                    bridgeRes.healedFromGist = true;
                                    if (inUrl) {
                                        inUrl.value = gistRes.decryptedUrl;
                                        inUrl.style.borderColor = '#00c853';
                                        inUrl.style.boxShadow = '0 0 8px rgba(0,200,83,0.4)';
                                        setTimeout(() => { inUrl.style.borderColor = ''; inUrl.style.boxShadow = ''; }, 2000);
                                    }
                                    if (inShield && gistRes.shieldToken) {
                                        inShield.value = gistRes.shieldToken;
                                    }
                                }
                            } catch (_) {}
                        }

                        if (statusBridge) {
                            if (!url && !bridgeRes.healedFromGist) {
                                statusBridge.style.background = 'rgba(120,123,134,0.08)';
                                statusBridge.style.border = '1px solid rgba(120,123,134,0.3)';
                                statusBridge.style.color = '#888';
                                statusBridge.innerHTML = '<span>⚪</span> <strong>Bridge Server:</strong> Endpoint URL is empty.';
                            } else if (bridgeRes.success) {
                                statusBridge.style.background = 'rgba(0,200,83,0.1)';
                                statusBridge.style.border = '1px solid rgba(0,200,83,0.35)';
                                statusBridge.style.color = '#00c853';
                                const accsText = bridgeRes.accountsCount !== undefined ? ` • <strong>${bridgeRes.accountsCount}</strong> MT5 account${bridgeRes.accountsCount === 1 ? '' : 's'} detected` : ' • API Key authenticated';
                                const healedText = bridgeRes.healedFromGist ? ' <span style="background: rgba(0,200,83,0.2); padding: 1px 4px; border-radius: 3px; font-size: 9px; margin-left: 4px;">✓ URL Auto-Healed from Gist Vault</span>' : '';
                                statusBridge.innerHTML = `<span>🟢</span> <strong>Bridge Online:</strong> Reachable in <strong>${bridgeRes.ping}ms</strong>${accsText}${healedText}.`;
                            } else if (bridgeRes.authFailed) {
                                statusBridge.style.background = 'rgba(242,54,69,0.1)';
                                statusBridge.style.border = '1px solid rgba(242,54,69,0.35)';
                                statusBridge.style.color = '#f23645';
                                statusBridge.innerHTML = `<span>🔴</span> <strong>Bridge Online (${bridgeRes.ping}ms)</strong>, but <strong>API Key Invalid</strong> (HTTP 401 Unauthorized).`;
                            } else {
                                statusBridge.style.background = 'rgba(242,54,69,0.1)';
                                statusBridge.style.border = '1px solid rgba(242,54,69,0.35)';
                                statusBridge.style.color = '#f23645';
                                statusBridge.innerHTML = `<span>🔴</span> <strong>Bridge Unreachable:</strong> ${bridgeRes.error || 'Connection failed'}`;
                            }
                        }

                        if (statusGist) {
                            if (!gistId) {
                                statusGist.style.background = 'rgba(120,123,134,0.08)';
                                statusGist.style.border = '1px solid rgba(120,123,134,0.3)';
                                statusGist.style.color = '#888';
                                statusGist.innerHTML = '<span>⚪</span> <strong>Gist Auto-Discovery:</strong> Not configured.';
                            } else if (gistRes.success) {
                                statusGist.style.background = 'rgba(0,200,83,0.1)';
                                statusGist.style.border = '1px solid rgba(0,200,83,0.35)';
                                statusGist.style.color = '#00c853';
                                const tokenSource = gistRes.isUsingMaster ? 'Master PAT' : (gistRes.hasToken ? 'Custom PAT' : 'Public');
                                const decText = gistRes.decrypted ? ' • E2E payload decrypted ✓' : (gistRes.hasPayload ? ' • Bridge payload found' : '');
                                statusGist.innerHTML = `<span>🟢</span> <strong>Gist Verified:</strong> Accessible via ${tokenSource}${decText}.`;
                            } else {
                                statusGist.style.background = 'rgba(242,54,69,0.1)';
                                statusGist.style.border = '1px solid rgba(242,54,69,0.35)';
                                statusGist.style.color = '#f23645';
                                statusGist.innerHTML = `<span>🔴</span> <strong>Gist Access Failed:</strong> ${gistRes.error || 'Failed to access Gist'}`;
                            }
                        }

                        if (summaryBadge) {
                            summaryBadge.style.display = 'inline-block';
                            if (bridgeRes.success && (!gistId || gistRes.success)) {
                                summaryBadge.style.background = 'rgba(0,200,83,0.12)';
                                summaryBadge.style.color = '#00c853';
                                summaryBadge.innerHTML = '✓ Verified';
                            } else {
                                summaryBadge.style.background = 'rgba(242,54,69,0.12)';
                                summaryBadge.style.color = '#f23645';
                                summaryBadge.innerHTML = '✕ Failed';
                            }
                        }
                    } catch (err) {
                        if (summaryBadge) {
                            summaryBadge.style.display = 'inline-block';
                            summaryBadge.style.background = 'rgba(242,54,69,0.12)';
                            summaryBadge.style.color = '#f23645';
                            summaryBadge.innerHTML = '✕ ' + err.message;
                        }
                    } finally {
                        btn.disabled = false;
                        btn.innerHTML = '<span>🔍</span> Verify';
                    }
                };
            });

            // Save Edit Endpoint
            modal.querySelectorAll('.mt5-btn-save-edit-ep').forEach(btn => {
                btn.onclick = async (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    const card = e.currentTarget.closest('.mt5-endpoint-card');
                    if (!id || !card || !window.MT5API) return;

                    const inName = card.querySelector('.mt5-in-edit-name');
                    const inUrl = card.querySelector('.mt5-in-edit-url');
                    const inKey = card.querySelector('.mt5-in-edit-key');
                    const inShieldToken = card.querySelector('.mt5-in-edit-shield-token');
                    const inGistId = card.querySelector('.mt5-in-edit-gist-id');
                    const inGistToken = card.querySelector('.mt5-in-edit-gist-token');

                    const name = inName ? inName.value.trim() : '';
                    const url = inUrl ? inUrl.value.trim() : '';
                    const apiKey = inKey ? inKey.value.trim() : '';
                    
                    const existingEp = window.MT5API.endpoints.find(x => x.id === id);
                    let shieldToken = inShieldToken ? inShieldToken.value.trim() : '';
                    if (!shieldToken && existingEp && existingEp.shieldToken) {
                        shieldToken = existingEp.shieldToken;
                    }

                    let gistId = inGistId ? inGistId.value.trim() : '';
                    if (gistId.includes('••••') || (existingEp && gistId === this.morphGistId(existingEp.gistId))) {
                        gistId = inGistId.getAttribute('data-raw') || (existingEp ? existingEp.gistId : '');
                    }

                    // Token should never show: if left blank, keep existing token!
                    let gistToken = inGistToken ? inGistToken.value.trim() : '';
                    if (!gistToken && existingEp && existingEp.gistToken) {
                        gistToken = existingEp.gistToken;
                    }

                    if (!url) {
                        alert('Bridge Endpoint URL cannot be empty.');
                        return;
                    }

                    btn.innerText = 'Connecting...';
                    btn.disabled = true;

                    window.MT5API.updateEndpoint(id, { name, url, apiKey, shieldToken, gistId, gistToken });
                    const res = await window.MT5API.testSingleEndpoint(id);
                    this.editingEndpointId = null;
                    this.renderModal();

                    if (res.success) {
                        alert(`✓ Bridge Updated Successfully!\nServer is Online (${res.ping}ms ping)`);
                    } else {
                        alert(`⚠️ Bridge Updated, but connection failed: ${res.error}\nPlease double check the URL and API key.`);
                    }
                };
            });

            // Sync All Configured Gists
            const btnSyncAllGists = modal.querySelector('#mt5-btn-sync-all-gists');
            if (btnSyncAllGists) {
                btnSyncAllGists.onclick = async () => {
                    btnSyncAllGists.innerText = 'Syncing...';
                    btnSyncAllGists.disabled = true;
                    const res = await window.MT5API.syncAllEndpointsFromGist(true);
                    btnSyncAllGists.innerText = '⚡ Sync All Gists';
                    btnSyncAllGists.disabled = false;
                    this.renderModal();
                    if (res.total === 0) {
                        alert('No bridges currently have Auto-Discovery Gist configured.\nClick "✏️ Edit" on any bridge to enter its Gist ID and PAT.');
                    } else {
                        alert(`✓ Auto-Discovery Complete!\nChecked ${res.total} bridge(s) with Gists configured • ${res.updated} URL(s) updated.`);
                    }
                };
            }

            // Test All Connections
            const btnTestConn = modal.querySelector('#mt5-btn-test-conn');
            if (btnTestConn) {
                btnTestConn.onclick = async () => {
                    btnTestConn.innerText = 'Testing...';
                    const res = await window.MT5API.testConnection();
                    if (res.success) {
                        alert(`✓ Connected! ${res.online} / ${res.total} bridge servers are online.`);
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
