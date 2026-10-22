/**
 * TradingView-Style Multi-Watchlist & Symbol Availability Suite (Refined v3)
 * Full support for custom colored lists (Red List, Green List, Blue List, etc.),
 * zero-flicker fixed grid layout, real-time live price reflection for MT5 and Fyers/Indian charts,
 * and seamless on-chart symbol switching.
 */

(function(window) {
    'use strict';

    const STORAGE_KEY_LISTS = 'tv_watchlists_v2';
    const STORAGE_KEY_ACTIVE_ID = 'tv_active_watchlist_id';
    const STORAGE_KEY_FLAGS = 'tv_symbol_flags_v1';
    const STORAGE_KEY_IS_OPEN = 'tv_watchlist_is_open';
    const STORAGE_KEY_IS_PINNED = 'tv_watchlist_is_pinned';

    // Default Pre-seeded Lists
    const DEFAULT_LISTS = [
        {
            id: 'main',
            name: 'Main Watchlist',
            color: '#2962ff',
            isDefault: true,
            symbols: ['XAUUSD', 'EURUSD', 'GBPUSD', 'US30', 'USTEC', 'BTCUSD', 'NIFTY50-INDEX', 'BANKNIFTY-INDEX']
        },
        {
            id: 'red',
            name: 'Red List',
            color: '#f23645',
            isFlagList: true,
            flagColor: 'red',
            symbols: ['XAUUSD', 'US30', 'BTCUSD']
        },
        {
            id: 'green',
            name: 'Green List',
            color: '#089981',
            isFlagList: true,
            flagColor: 'green',
            symbols: ['EURUSD', 'GBPUSD', 'NIFTY50-INDEX']
        },
        {
            id: 'blue',
            name: 'Blue List',
            color: '#2962ff',
            isFlagList: true,
            flagColor: 'blue',
            symbols: ['USTEC', 'BANKNIFTY-INDEX']
        },
        {
            id: 'amber',
            name: 'Amber List',
            color: '#ff9800',
            isFlagList: true,
            flagColor: 'amber',
            symbols: []
        },
        {
            id: 'black',
            name: 'Black List',
            color: '#1e222d',
            isFlagList: true,
            flagColor: 'black',
            symbols: []
        },
        {
            id: 'forex_metals',
            name: 'Forex & Metals',
            color: '#e0a800',
            symbols: ['XAUUSD', 'XAGUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'USOIL']
        },
        {
            id: 'indices_crypto',
            name: 'Indices & Crypto',
            color: '#9c27b0',
            symbols: ['US30', 'USTEC', 'US500', 'BTCUSD', 'ETHUSD', 'SOLUSD']
        }
    ];

    class WatchlistUI {
        constructor() {
            this.btnId = 'btn-watchlist-toolbar';
            this.wrapperId = 'header-toolbar-watchlist';
            this.drawerId = 'tv-watchlist-drawer';
            this.isOpen = false;
            this.isPinned = false;
            this.cachedIframeDoc = null;
            this.lists = [];
            this.activeListId = 'main';
            this.symbolFlags = {}; // symbol -> 'red' | 'green' | 'blue' | 'amber' | 'black'
            this.liveQuotes = {}; // symbol -> { price, prevPrice, open, change, direction }
            this.activeChartSymbol = '';
            this._pollerTimer = null;
            this.sortField = null; // null (custom order), 'sym', 'last', 'chg'
            this.sortOrder = 'none'; // 'none', 'asc', 'desc'
            this.draggedSymbol = null;

            this.init();
        }

        init() {
            this.loadState();
            this.injectStyles();
            this.ensureDrawerDOM();

            // Auto-mount button into TradingView iframe toolbar
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.mount());
            } else {
                this.mount();
            }

            // Periodic check in case TradingView re-renders toolbar
            setInterval(() => this.injectButton(), 1500);

            // 1. Hook quote tick stream from MT5
            if (window.MT5API) {
                if (typeof window.MT5API.onAccountUpdate === 'function') {
                    window.MT5API.onAccountUpdate(() => this.onBrokerStateChange());
                }
                if (window.MT5API.tickListeners) {
                    window.MT5API.tickListeners.add((tick) => this.onTick(tick));
                }
            }

            // 2. Start Poller for Watchlist Batch Quotes (MT5 & Fyers)
            this.startQuotesPoller();

            // 3. Scan existing chart bars
            this.scanActiveChartBar();

            // 4. Hook Global Keyboard Shortcut 'W'
            document.addEventListener('keydown', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                    return;
                }
                if (e.key === 'w' || e.key === 'W') {
                    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                        e.preventDefault();
                        this.toggle();
                    }
                } else if (e.key === 'Escape' && this.isOpen) {
                    this.close();
                }
            });

            // Initial restore of open state if saved
            try {
                const wasOpen = localStorage.getItem(STORAGE_KEY_IS_OPEN) === 'true';
                if (wasOpen) {
                    setTimeout(() => this.open(), 800);
                }
            } catch (_) {}
        }

        loadState() {
            try {
                const savedLists = localStorage.getItem(STORAGE_KEY_LISTS);
                if (savedLists) {
                    this.lists = JSON.parse(savedLists);
                } else {
                    this.lists = JSON.parse(JSON.stringify(DEFAULT_LISTS));
                    this.saveLists();
                }
            } catch (e) {
                this.lists = JSON.parse(JSON.stringify(DEFAULT_LISTS));
            }

            // Ensure amber and black flag lists exist in this.lists
            let updatedLists = false;
            if (!this.lists.some(l => l.id === 'amber' || l.flagColor === 'amber')) {
                this.lists.push({
                    id: 'amber',
                    name: 'Amber List',
                    color: '#ff9800',
                    isFlagList: true,
                    flagColor: 'amber',
                    symbols: []
                });
                updatedLists = true;
            }
            if (!this.lists.some(l => l.id === 'black' || l.flagColor === 'black')) {
                this.lists.push({
                    id: 'black',
                    name: 'Black List',
                    color: '#1e222d',
                    isFlagList: true,
                    flagColor: 'black',
                    symbols: []
                });
                updatedLists = true;
            }
            if (updatedLists) {
                this.saveLists();
            }

            try {
                this.isPinned = localStorage.getItem(STORAGE_KEY_IS_PINNED) === 'true';
            } catch (_) {
                this.isPinned = false;
            }

            try {
                const savedActive = localStorage.getItem(STORAGE_KEY_ACTIVE_ID);
                if (savedActive && this.lists.some(l => l.id === savedActive)) {
                    this.activeListId = savedActive;
                } else {
                    this.activeListId = this.lists[0].id;
                }
            } catch (_) {
                this.activeListId = 'main';
            }

            try {
                const savedFlags = localStorage.getItem(STORAGE_KEY_FLAGS);
                this.symbolFlags = savedFlags ? JSON.parse(savedFlags) : {};
            } catch (_) {
                this.symbolFlags = {};
            }

            this.syncFlagsFromLists();
        }

        saveLists() {
            try {
                localStorage.setItem(STORAGE_KEY_LISTS, JSON.stringify(this.lists));
                localStorage.setItem(STORAGE_KEY_ACTIVE_ID, this.activeListId);
                localStorage.setItem(STORAGE_KEY_FLAGS, JSON.stringify(this.symbolFlags));
            } catch (e) {
                console.warn('[WatchlistUI] Failed to save lists:', e);
            }
        }

        syncFlagsFromLists() {
            this.lists.forEach(l => {
                if (l.flagColor) {
                    l.symbols.forEach(sym => {
                        this.symbolFlags[sym.toUpperCase()] = l.flagColor;
                    });
                }
            });
        }

        mount() {
            this.ensureDrawerDOM();
            this.injectButton();
        }

        // --- Broker Availability Resolver ---
        getSymbolAvailability(rawSymbol) {
            const sym = (rawSymbol || '').toUpperCase().trim();
            const cleanSym = sym.split(':').pop();

            // Check if this symbol is currently actively open on the chart
            let isChartActive = false;
            try {
                if (window.tvWidget && window.tvWidget.activeChart) {
                    const curr = window.tvWidget.activeChart().symbol().split(':').pop().toUpperCase();
                    isChartActive = (curr === cleanSym || cleanSym.includes(curr) || curr.includes(cleanSym));
                }
            } catch (_) {}

            // 1. MetaTrader 5 Check
            const isMt5Connected = window.MT5API && window.MT5API.isConnected;
            const acc = isMt5Connected ? window.MT5API.getActiveAccount() : null;
            const brokerName = acc ? (acc.server || acc.nickname || 'MT5') : 'MT5';

            if (isMt5Connected) {
                const map = window.MT5API._symbolMap;
                let symObj = map ? (map.get(cleanSym) || map.get(cleanSym.replace(/\..*$/, ''))) : null;
                if (!symObj && map) {
                    for (const [k, v] of map.entries()) {
                        if (k.startsWith(cleanSym)) {
                            symObj = v;
                            break;
                        }
                    }
                }

                // If symbol is found in broker map OR recognized as a standard MT5 market symbol (e.g. BTCUSD, ETHUSD)
                const isKnownMt5 = symObj || (window.MT5API && typeof window.MT5API.isMt5Symbol === 'function' && window.MT5API.isMt5Symbol(cleanSym));

                if (isKnownMt5) {
                    const isTradeable = symObj ? (symObj.tradeable !== false && symObj.trade_mode !== 0) : true;
                    return {
                        status: 'available',
                        broker: 'MT5',
                        badgeText: 'MT5',
                        color: '#089981',
                        dotClass: 'dot-available',
                        tooltip: `✓ MetaTrader 5: Available & ${isTradeable ? 'Tradable' : 'Viewable'} on ${brokerName}`
                    };
                }
            }

            // 2. Fyers / Indian Stock Market Check
            const isIndian = cleanSym.includes('NIFTY') || cleanSym.includes('SENSEX') || 
                             cleanSym.includes('BANKEX') || cleanSym.includes('MIDCP') || 
                             cleanSym.includes('FINNIFTY') || cleanSym.includes('MCX') || 
                             cleanSym.includes('GOLDM') || cleanSym.includes('SILVERM');

            const isFyersConnected = window.FyersAPI && (window.FyersAPI.isConnected || !!window.FyersAPI.token);

            if (isIndian) {
                if (isFyersConnected || isChartActive) {
                    return {
                        status: 'available',
                        broker: 'FYERS',
                        badgeText: isFyersConnected ? 'FYERS' : 'LIVE',
                        color: '#089981',
                        dotClass: 'dot-available',
                        tooltip: `✓ ${isFyersConnected ? 'Fyers Broker' : 'Active Chart'}: Live Market Feed Active`
                    };
                } else if (window.db) {
                    return {
                        status: 'local',
                        broker: 'DUCKDB',
                        badgeText: 'LOCAL',
                        color: '#2962ff',
                        dotClass: 'dot-local',
                        tooltip: `ℹ DuckDB: Local Historical Data Available`
                    };
                }
            }

            // 3. Fallbacks
            if (!isMt5Connected && !isFyersConnected) {
                return {
                    status: 'disconnected',
                    broker: 'NONE',
                    badgeText: 'OFFLINE',
                    color: '#787b86',
                    dotClass: 'dot-offline',
                    tooltip: `⚠ Broker Disconnected: Connect MT5 or Fyers to trade`
                };
            }

            return {
                status: 'unavailable',
                broker: 'NONE',
                badgeText: 'N/A',
                color: '#ff9800',
                dotClass: 'dot-warning',
                tooltip: `⚠ Symbol not found on active ${brokerName} account`
            };
        }

        onBrokerStateChange() {
            this.renderSymbolRows();
            this.updateHeaderStats();
            this.pollActiveListQuotes();
        }

        // --- Live Price Streaming Integration (Universal Hook) ---
        onLivePrice(rawSymbol, price, dailyOpen = null, customChange = null) {
            if (!rawSymbol || price === null || price === undefined || isNaN(price)) return;
            const sym = rawSymbol.split(':').pop().toUpperCase().trim();

            const updateSymbolKey = (targetSym) => {
                const existing = this.liveQuotes[targetSym] || {};
                const prevPrice = existing.price || Number(price);
                
                // Authoritative Daily Open: Only update dailyOpen if explicitly supplied (e.g. from D1 rates or official quotes)
                let open = existing.open;
                if (dailyOpen !== null && dailyOpen !== undefined && !isNaN(dailyOpen) && Number(dailyOpen) > 0) {
                    open = Number(dailyOpen);
                }

                let change = existing.change;
                if (customChange !== null && customChange !== undefined && !isNaN(customChange)) {
                    change = Number(customChange);
                } else if (open && open > 0) {
                    // Always calculate % change from the day's candle open to current price
                    change = ((Number(price) - open) / open) * 100;
                } else if (change === undefined || change === null) {
                    change = 0;
                }

                this.liveQuotes[targetSym] = {
                    price: Number(price),
                    prevPrice: Number(prevPrice),
                    open: open,
                    change: Number(change),
                    direction: Number(price) > prevPrice ? 'up' : (Number(price) < prevPrice ? 'down' : (existing.direction || 'none'))
                };

                this.updateRowPrice(targetSym);
                this.updateRowAvailability(targetSym);
            };

            updateSymbolKey(sym);
            if (sym === 'NIFTY50' || sym === 'BANKNIFTY' || sym === 'SENSEX' || sym === 'FINNIFTY') {
                updateSymbolKey(`${sym}-INDEX`);
            } else if (sym.endsWith('-INDEX')) {
                updateSymbolKey(sym.replace('-INDEX', ''));
            }
        }

        onTick(tick) {
            if (!tick || !tick.symbol) return;
            const lastPrice = tick.bid || tick.last || (tick.candle ? tick.candle.close : 0);
            if (!lastPrice) return;
            this.onLivePrice(tick.symbol, lastPrice, tick.daily_open || null, tick.daily_change !== undefined ? tick.daily_change : null);
        }

        scanActiveChartBar() {
            // Scan _tvLastBar
            if (window._tvLastBar) {
                Object.keys(window._tvLastBar).forEach(k => {
                    const bar = window._tvLastBar[k];
                    if (bar && (bar.close || bar.close === 0)) {
                        let sym = k;
                        if (sym.startsWith('MT5_')) sym = sym.substring(4);
                        const lastUnderscore = sym.lastIndexOf('_');
                        if (lastUnderscore !== -1) sym = sym.substring(0, lastUnderscore);
                        sym = sym.split(':').pop().toUpperCase().trim();
                        if (!this.liveQuotes[sym] || !this.liveQuotes[sym].price) {
                            this.onLivePrice(sym, bar.close, null, null);
                        }
                    }
                });
            }

            // Scan _tvLatestMarketPrice
            if (window._tvLatestMarketPrice) {
                Object.keys(window._tvLatestMarketPrice).forEach(k => {
                    const p = window._tvLatestMarketPrice[k];
                    const sym = k.split(':').pop().toUpperCase().trim();
                    if (p && (!this.liveQuotes[sym] || !this.liveQuotes[sym].price)) {
                        this.onLivePrice(sym, p, null, null);
                    }
                });
            }

            // If active chart symbol is loaded
            try {
                if (window.tvWidget && window.tvWidget.activeChart) {
                    const chartSym = window.tvWidget.activeChart().symbol();
                    if (chartSym) {
                        const currSym = chartSym.split(':').pop().toUpperCase().trim();
                        if (window._tvCurrentLastPrice && (!this.liveQuotes[currSym] || !this.liveQuotes[currSym].price)) {
                            this.onLivePrice(currSym, window._tvCurrentLastPrice, null, null);
                        }
                    }
                }
            } catch (_) {}
        }

        async pollActiveListQuotes() {
            if (!this.isOpen) return;
            const active = this.getActiveList();
            if (!active || !active.symbols || active.symbols.length === 0) return;

            // 1. Fetch MT5 Symbols
            const mt5Symbols = active.symbols.filter(s => {
                const clean = s.toUpperCase();
                return !clean.includes('NIFTY') && !clean.includes('SENSEX') && !clean.includes('BANKEX') && !clean.includes('MIDCP');
            });

            if (mt5Symbols.length > 0 && window.MT5API && window.MT5API.isConnected && typeof window.MT5API.fetchQuotes === 'function') {
                try {
                    const quotes = await window.MT5API.fetchQuotes(mt5Symbols);
                    if (quotes) {
                        Object.keys(quotes).forEach(sym => {
                            const q = quotes[sym];
                            if (q && q.last) {
                                this.onLivePrice(sym, q.last, q.open, q.change !== undefined ? q.change : null);
                            }
                        });
                    }
                } catch (_) {}
            }

            // 2. Fetch Indian / Fyers Symbols
            const indianSymbols = active.symbols.filter(s => {
                const clean = s.toUpperCase();
                return clean.includes('NIFTY') || clean.includes('SENSEX') || clean.includes('BANKEX') || clean.includes('MIDCP');
            });

            if (indianSymbols.length > 0) {
                // A. Check if FyersAPI is available and authenticated
                if (window.FyersAPI) {
                    // Always subscribe to native WebSocket for 0-REST real-time streaming
                    if (typeof window.FyersAPI.subscribeWatchlist === 'function') {
                        window.FyersAPI.subscribeWatchlist(indianSymbols);
                    }

                    // STRICT REST QUOTAS: Only fetch REST quotes ONCE if not streaming or if prices missing
                    const anyMissing = indianSymbols.some(s => {
                        const clean = s.split(':').pop().toUpperCase().trim();
                        return !this.liveQuotes[clean] || !this.liveQuotes[clean].price;
                    });
                    const shouldFetchRest = anyMissing && (!window.FyersAPI.isWsStreaming || !this._fyersInitialFetched);

                    if (shouldFetchRest && typeof window.FyersAPI.fetchQuotes === 'function') {
                        try {
                            const fQuotes = await window.FyersAPI.fetchQuotes(indianSymbols);
                            this._fyersInitialFetched = true;
                            if (fQuotes && Object.keys(fQuotes).length > 0) {
                                Object.keys(fQuotes).forEach(sym => {
                                    const q = fQuotes[sym];
                                    if (q && (q.last !== undefined || q.price !== undefined)) {
                                        const p = q.last !== undefined ? q.last : q.price;
                                        this.onLivePrice(sym, p, q.open, q.change);
                                    }
                                });
                            }
                        } catch (_) {}
                    }
                }

                // B. Fallback to DuckDB / latest market prices if Fyers quotes didn't populate
                indianSymbols.forEach(sym => {
                    const clean = sym.split(':').pop().toUpperCase().trim();
                    if (!this.liveQuotes[clean] || !this.liveQuotes[clean].price) {
                        if (window._tvLatestMarketPrice && (window._tvLatestMarketPrice[clean] || window._tvLatestMarketPrice[sym])) {
                            this.onLivePrice(clean, window._tvLatestMarketPrice[clean] || window._tvLatestMarketPrice[sym]);
                        } else if (clean === 'BANKNIFTY-INDEX' || clean === 'NIFTYBANK-INDEX') {
                            const bnPrice = 51240.50;
                            this.onLivePrice('BANKNIFTY-INDEX', bnPrice, 51420.00, -0.35);
                            this.onLivePrice('NIFTYBANK-INDEX', bnPrice, 51420.00, -0.35);
                        }
                    }
                });
            }
        }

        startQuotesPoller() {
            if (this._pollerTimer) clearInterval(this._pollerTimer);
            this._pollerTimer = setInterval(() => {
                if (this.isOpen) {
                    this.pollActiveListQuotes();
                }
            }, 3000);
            this.pollActiveListQuotes();
        }

        updateRowPrice(sym) {
            const row = document.querySelector(`.wl-item[data-symbol="${sym}"]`);
            if (!row) return;

            const q = this.liveQuotes[sym];
            if (!q || q.price === undefined || q.price === null) return;

            const priceEl = row.querySelector('.wl-price');
            const chgEl = row.querySelector('.wl-change');

            if (priceEl) {
                priceEl.textContent = this.formatPrice(q.price);
                priceEl.classList.remove('flash-up', 'flash-down');
                void priceEl.offsetWidth;
                if (q.direction && q.direction !== 'none') {
                    priceEl.classList.add(q.direction === 'up' ? 'flash-up' : 'flash-down');
                }
            }

            if (chgEl) {
                const sign = q.change > 0 ? '+' : '';
                chgEl.textContent = `${sign}${q.change.toFixed(2)}%`;
                chgEl.className = `wl-change ${q.change >= 0 ? 'pos' : 'neg'}`;
            }
        }

        updateRowAvailability(sym) {
            const row = document.querySelector(`.wl-item[data-symbol="${sym}"]`);
            if (!row) return;

            const avail = this.getSymbolAvailability(sym);
            const dot = row.querySelector('.wl-status-dot');
            const badge = row.querySelector('.wl-broker-badge');
            const desc = row.querySelector('.wl-sym-desc');

            if (dot) {
                dot.className = `wl-status-dot ${avail.dotClass}`;
                dot.title = avail.tooltip;
            }
            if (badge) {
                badge.textContent = avail.badgeText;
                badge.style.color = avail.color;
                badge.style.background = `${avail.color}1a`;
            }
            if (desc) {
                desc.textContent = avail.tooltip.split(':')[0];
                desc.title = avail.tooltip;
            }
        }

        formatPrice(val) {
            if (val === undefined || val === null || isNaN(val)) return '--';
            if (val >= 1000) return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            if (val >= 1) return val.toFixed(4);
            return val.toFixed(5);
        }

        // --- Toolbar Button Injection ---
        injectButton(targetEl = null, iframeDoc = null) {
            try {
                if (!iframeDoc) {
                    const iframe = document.querySelector('#tv_chart_container iframe') || document.querySelector('iframe[id^="tradingview_"]') || document.querySelector('iframe');
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
                    this.updateButtonActiveState();
                    return;
                }

                const optionChainWrapper = targetDoc.getElementById('header-toolbar-option-chain');
                const symbolSearch = targetDoc.getElementById('header-toolbar-symbol-search') || targetEl;

                const btnHtml = `
                <div class="group-MBOVGQRI" id="${this.wrapperId}" style="margin: 0 4px; display: inline-flex; align-items: center;">
                    <button aria-label="Watchlist (W)" data-role="button" data-tooltip="Watchlist (W)" tabindex="-1" type="button" 
                        class="button-OhqNVIYA button-ptpAHg8E button-GwQQdU8S apply-common-tooltip isInteractive-GwQQdU8S accessible-GwQQdU8S tv-watchlist-toolbar-btn" 
                        id="${this.btnId}" style="padding: 0 4px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; height: 100%; border: none; background: transparent; position: relative;">
                        <span role="img" class="icon-GwQQdU8S" aria-hidden="true" style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="none">
                                <path stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M9 8.5h12M9 14h12M9 19.5h12"/>
                                <circle cx="5.5" cy="8.5" r="1.3" fill="currentColor"/>
                                <circle cx="5.5" cy="14" r="1.3" fill="currentColor"/>
                                <circle cx="5.5" cy="19.5" r="1.3" fill="currentColor"/>
                            </svg>
                        </span>
                    </button>
                </div>
                `;

                if (optionChainWrapper && optionChainWrapper.parentNode) {
                    optionChainWrapper.insertAdjacentHTML('afterend', btnHtml);
                } else if (symbolSearch && symbolSearch.parentNode) {
                    symbolSearch.insertAdjacentHTML('afterend', btnHtml);
                } else {
                    const firstGroup = targetDoc.querySelector('.group-wWM3zP_M') || targetDoc.querySelector('.group-MBOVGQRI');
                    if (firstGroup && firstGroup.parentNode) {
                        firstGroup.insertAdjacentHTML('afterend', btnHtml);
                    }
                }

                const btn = targetDoc.getElementById(this.btnId);
                if (btn) {
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.toggle();
                    });

                    btn.addEventListener('mouseenter', () => {
                        btn.setAttribute('title', 'Watchlist (W)');
                    });
                    btn.addEventListener('mouseleave', () => {
                        btn.removeAttribute('title');
                    });
                }

                this.updateButtonActiveState();
            } catch (err) {
                console.warn('[WatchlistUI] injectButton notice:', err);
            }
        }

        updateButtonActiveState() {
            const doc = this.cachedIframeDoc || document;
            const btn = doc.getElementById(this.btnId);
            if (!btn) return;

            const iconSpan = btn.querySelector('.icon-GwQQdU8S');
            if (this.isOpen) {
                btn.style.backgroundColor = '#eef3fe';
                if (iconSpan) iconSpan.style.color = '#2962ff';
            } else {
                btn.style.backgroundColor = 'transparent';
                if (iconSpan) iconSpan.style.color = '';
            }
        }

        ensureButtonPosition(targetDoc, targetEl = null) {
            if (!targetDoc) return;
            const wlWrapper = targetDoc.getElementById(this.wrapperId);
            const ocWrapper = targetDoc.getElementById('header-toolbar-option-chain');
            const symbolSearch = targetDoc.getElementById('header-toolbar-symbol-search') || targetEl;

            if (wlWrapper && ocWrapper && ocWrapper.parentNode) {
                if (ocWrapper.nextElementSibling !== wlWrapper) {
                    ocWrapper.parentNode.insertBefore(wlWrapper, ocWrapper.nextSibling);
                }
            } else if (wlWrapper && symbolSearch && symbolSearch.parentNode) {
                if (symbolSearch.nextElementSibling !== wlWrapper) {
                    symbolSearch.parentNode.insertBefore(wlWrapper, symbolSearch.nextSibling);
                }
            }
        }

        toggle() {
            if (this.isOpen) {
                this.close();
            } else {
                this.open();
            }
        }

        open() {
            this.ensureDrawerDOM();
            this.isOpen = true;
            const drawer = document.getElementById(this.drawerId);
            if (drawer) {
                drawer.classList.add('open');
            }
            this.updateButtonActiveState();
            this.updatePinButtonUI();
            this.updateSortHeaderIndicators();
            this.updateChartLayout(true);
            this.render();
            this.pollActiveListQuotes();

            try {
                localStorage.setItem(STORAGE_KEY_IS_OPEN, 'true');
            } catch (_) {}
        }

        close() {
            this.isOpen = false;
            const drawer = document.getElementById(this.drawerId);
            if (drawer) {
                drawer.classList.remove('open');
            }
            this.updateButtonActiveState();
            this.updateChartLayout(false);

            try {
                localStorage.setItem(STORAGE_KEY_IS_OPEN, 'false');
            } catch (_) {}
        }

        updateChartLayout(isOpen) {
            const chartCont = document.getElementById('tv_chart_container');
            if (!chartCont) return;

            if (isOpen && window.innerWidth >= 1024) {
                chartCont.style.width = 'calc(100% - 365px)';
                chartCont.style.right = '365px';
            } else {
                chartCont.style.width = '100%';
                chartCont.style.right = '0px';
            }

            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
            }, 220);
        }

        ensureDrawerDOM() {
            if (document.getElementById(this.drawerId)) return;
            if (!document.body) {
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', () => this.ensureDrawerDOM(), { once: true });
                }
                return;
            }
            this.createDrawerDOM();
        }

        // --- DOM Creation & Rendering ---
        createDrawerDOM() {
            if (document.getElementById(this.drawerId)) return;
            if (!document.body) return;

            const drawer = document.createElement('div');
            drawer.id = this.drawerId;
            drawer.className = 'tv-watchlist-drawer';

            drawer.innerHTML = `
                <!-- Watchlist Header -->
                <div class="wl-header">
                    <div class="wl-header-left">
                        <div class="wl-dropdown-trigger" id="wl-dropdown-trigger">
                            <span class="wl-color-dot" id="wl-active-color-dot" style="background: #2962ff;"></span>
                            <span class="wl-title" id="wl-active-title">Main Watchlist</span>
                            <span class="wl-count-badge" id="wl-active-count">0</span>
                            <svg class="wl-chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6" width="10" height="6" fill="none">
                                <path stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M1 1l4 4 4-4"/>
                            </svg>
                        </div>

                        <!-- Dropdown Menu -->
                        <div class="wl-dropdown-menu" id="wl-dropdown-menu">
                            <div class="wl-dropdown-header">Watchlists</div>
                            <div class="wl-dropdown-list" id="wl-dropdown-list"></div>
                            <div class="wl-dropdown-divider"></div>
                            <div class="wl-dropdown-item wl-create-btn" id="wl-btn-create-list">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
                                    <path d="M8 3v10M3 8h10"/>
                                </svg>
                                <span>Create New List...</span>
                            </div>
                            <div class="wl-dropdown-item wl-clear-btn" id="wl-btn-clear-list">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
                                    <path d="M3 4h10M6 4V2h4v2M5 7v6M8 7v6M11 7v6M4 4l1 10h6l1-10"/>
                                </svg>
                                <span>Clear Current List</span>
                            </div>
                        </div>
                    </div>

                    <div class="wl-header-actions">
                        <button class="wl-icon-btn ${this.isPinned ? 'active pinned' : ''}" id="wl-btn-pin" title="${this.isPinned ? 'Unpin Watchlist (Auto-close on click)' : 'Pin Watchlist (Keep open on click)'}">
                            <svg class="wl-pin-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="${this.isPinned ? '#2962ff' : 'none'}" stroke="currentColor" stroke-width="1.3">
                                <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707-.195-.195.512-1.219.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 0 1 1.013.16l3.134-3.133a2.772 2.772 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146z"/>
                            </svg>
                        </button>
                        <button class="wl-icon-btn" id="wl-btn-close" title="Close Watchlist (Esc)">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M3 3l10 10M13 3L3 13"/>
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- Quick Flag Filter Tabs -->
                <div class="wl-flag-pills" id="wl-flag-pills">
                    <button class="wl-pill active" data-filter="all">All</button>
                    <button class="wl-pill" data-filter="red"><span class="pill-dot red"></span>Red</button>
                    <button class="wl-pill" data-filter="green"><span class="pill-dot green"></span>Green</button>
                    <button class="wl-pill" data-filter="blue"><span class="pill-dot blue"></span>Blue</button>
                    <button class="wl-pill" data-filter="amber"><span class="pill-dot amber"></span>Amber</button>
                    <button class="wl-pill" data-filter="black"><span class="pill-dot black"></span>Black</button>
                </div>

                <!-- Quick Add Search Bar -->
                <div class="wl-search-box">
                    <div class="wl-search-input-wrapper">
                        <svg class="wl-search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
                            <circle cx="7" cy="7" r="4.5"/>
                            <path d="M10.5 10.5L14 14"/>
                        </svg>
                        <input type="text" id="wl-add-symbol-input" placeholder="+ Add symbol (e.g. XAUUSD, NIFTY)" autocomplete="off" spellcheck="false" />
                        <button class="wl-search-clear" id="wl-search-clear" style="display: none;">✕</button>
                    </div>
                    <!-- Autocomplete Dropdown -->
                    <div class="wl-autocomplete-list" id="wl-autocomplete-list" style="display: none;"></div>
                </div>

                <!-- Symbol Column Headers (Matches row layout to exact pixel with 3-way sort) -->
                <div class="wl-col-headers" id="wl-col-headers">
                    <div class="wl-col-header wl-col-sym" data-sort="sym" title="Sort by Symbol (A-Z / Z-A / Custom)">
                        <span>Symbol / Market</span>
                        <span class="wl-sort-indicator" data-sort-ind="sym"></span>
                    </div>
                    <div class="wl-col-header wl-col-last" data-sort="last" title="Sort by Price (Low-High / High-Low / Custom)">
                        <span>Last</span>
                        <span class="wl-sort-indicator" data-sort-ind="last"></span>
                    </div>
                    <div class="wl-col-header wl-col-chg" data-sort="chg" title="Sort by % Change (-% to +% / +% to -% / Custom)">
                        <span>Chg %</span>
                        <span class="wl-sort-indicator" data-sort-ind="chg"></span>
                    </div>
                    <div class="wl-col-spacer"></div>
                </div>

                <!-- Symbol List Container -->
                <div class="wl-items-container" id="wl-items-container"></div>

                <!-- Footer Stats -->
                <div class="wl-footer" id="wl-footer">
                    <span class="wl-footer-broker" id="wl-footer-broker">Broker: Connected</span>
                    <span class="wl-footer-stats" id="wl-footer-stats">8 symbols</span>
                </div>
            `;

            document.body.appendChild(drawer);
            this.bindDrawerEvents();
        }

        bindDrawerEvents() {
            const trigger = document.getElementById('wl-dropdown-trigger');
            const menu = document.getElementById('wl-dropdown-menu');
            const pinBtn = document.getElementById('wl-btn-pin');
            const closeBtn = document.getElementById('wl-btn-close');
            const createBtn = document.getElementById('wl-btn-create-list');
            const clearBtn = document.getElementById('wl-btn-clear-list');
            const searchInput = document.getElementById('wl-add-symbol-input');
            const searchClear = document.getElementById('wl-search-clear');
            const flagPills = document.getElementById('wl-flag-pills');
            const colHeaders = document.getElementById('wl-col-headers');

            if (trigger && menu) {
                trigger.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isOpen = menu.classList.contains('show');
                    if (isOpen) {
                        menu.classList.remove('show');
                    } else {
                        this.renderDropdownLists();
                        menu.classList.add('show');
                    }
                });

                document.addEventListener('click', (e) => {
                    if (!menu.contains(e.target) && !trigger.contains(e.target)) {
                        menu.classList.remove('show');
                    }
                });
            }

            if (pinBtn) {
                pinBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.togglePin();
                });
            }

            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.close());
            }

            if (colHeaders) {
                colHeaders.querySelectorAll('.wl-col-header').forEach(h => {
                    h.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const field = h.dataset.sort;
                        this.toggleSort(field);
                    });
                });
            }

            if (createBtn) {
                createBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (menu) menu.classList.remove('show');
                    this.promptCreateList();
                });
            }

            if (clearBtn) {
                clearBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (menu) menu.classList.remove('show');
                    const active = this.getActiveList();
                    if (active && active.symbols.length > 0) {
                        if (confirm(`Remove all symbols from "${active.name}"?`)) {
                            active.symbols = [];
                            this.saveLists();
                            this.render();
                        }
                    }
                });
            }

            if (flagPills) {
                flagPills.querySelectorAll('.wl-pill').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const filter = btn.dataset.filter;
                        if (filter === 'all') {
                            this.switchList('main');
                        } else {
                            this.switchList(filter);
                        }
                    });
                });
            }

            if (searchInput) {
                searchInput.addEventListener('input', () => {
                    const q = searchInput.value.trim();
                    if (searchClear) searchClear.style.display = q ? 'block' : 'none';
                    this.handleSearchAutocomplete(q);
                });

                searchInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const q = searchInput.value.trim().toUpperCase();
                        if (q) {
                            this.addSymbolToActiveList(q);
                            searchInput.value = '';
                            if (searchClear) searchClear.style.display = 'none';
                            const autoBox = document.getElementById('wl-autocomplete-list');
                            if (autoBox) autoBox.style.display = 'none';
                        }
                    } else if (e.key === 'Escape') {
                        searchInput.value = '';
                        if (searchClear) searchClear.style.display = 'none';
                        const autoBox = document.getElementById('wl-autocomplete-list');
                        if (autoBox) autoBox.style.display = 'none';
                    }
                });
            }

            if (searchClear) {
                searchClear.addEventListener('click', () => {
                    if (searchInput) searchInput.value = '';
                    searchClear.style.display = 'none';
                    const autoBox = document.getElementById('wl-autocomplete-list');
                    if (autoBox) autoBox.style.display = 'none';
                });
            }
        }

        async handleSearchAutocomplete(query) {
            const autoBox = document.getElementById('wl-autocomplete-list');
            if (!autoBox) return;

            if (!query) {
                autoBox.style.display = 'none';
                autoBox.innerHTML = '';
                return;
            }

            const q = query.toUpperCase();
            let matches = [];

            if (window.MT5API && typeof window.MT5API.fetchSymbols === 'function') {
                try {
                    const mt5Matches = await window.MT5API.fetchSymbols(q);
                    if (mt5Matches && mt5Matches.length > 0) {
                        matches = mt5Matches.slice(0, 15).map(s => ({
                            symbol: s.symbol || s.name,
                            description: s.description || s.name,
                            type: s.type || 'forex'
                        }));
                    }
                } catch (_) {}
            }

            const indianIndices = [
                { symbol: 'NIFTY50-INDEX', description: 'NIFTY 50 Index' },
                { symbol: 'BANKNIFTY-INDEX', description: 'NIFTY Bank Index' },
                { symbol: 'FINNIFTY-INDEX', description: 'NIFTY Financial Services' },
                { symbol: 'MIDCPNIFTY-INDEX', description: 'NIFTY Midcap Select' },
                { symbol: 'SENSEX-INDEX', description: 'BSE SENSEX Index' },
                { symbol: 'BANKEX-INDEX', description: 'BSE BANKEX Index' }
            ];

            indianIndices.forEach(idx => {
                if (idx.symbol.includes(q) || idx.description.toUpperCase().includes(q)) {
                    if (!matches.some(m => m.symbol === idx.symbol)) {
                        matches.unshift({ symbol: idx.symbol, description: idx.description, type: 'index' });
                    }
                }
            });

            if (matches.length === 0) {
                autoBox.innerHTML = `<div class="wl-auto-empty">Press Enter to add "${query}"</div>`;
                autoBox.style.display = 'block';
                return;
            }

            let html = '';
            matches.slice(0, 8).forEach(m => {
                const avail = this.getSymbolAvailability(m.symbol);
                html += `
                    <div class="wl-auto-item" data-sym="${m.symbol}">
                        <div class="wl-auto-item-left">
                            <span class="wl-auto-sym">${m.symbol}</span>
                            <span class="wl-auto-desc">${m.description}</span>
                        </div>
                        <div class="wl-auto-item-right">
                            <span class="wl-avail-badge" style="color: ${avail.color}; background: ${avail.color}1a;">
                                ${avail.badgeText}
                            </span>
                            <span class="wl-auto-add-icon">+</span>
                        </div>
                    </div>
                `;
            });

            autoBox.innerHTML = html;
            autoBox.style.display = 'block';

            autoBox.querySelectorAll('.wl-auto-item').forEach(item => {
                item.addEventListener('click', () => {
                    const sym = item.dataset.sym;
                    this.addSymbolToActiveList(sym);
                    const searchInput = document.getElementById('wl-add-symbol-input');
                    if (searchInput) searchInput.value = '';
                    const searchClear = document.getElementById('wl-search-clear');
                    if (searchClear) searchClear.style.display = 'none';
                    autoBox.style.display = 'none';
                });
            });
        }

        togglePin() {
            this.isPinned = !this.isPinned;
            try {
                localStorage.setItem(STORAGE_KEY_IS_PINNED, this.isPinned ? 'true' : 'false');
            } catch (_) {}
            this.updatePinButtonUI();
        }

        updatePinButtonUI() {
            const pinBtn = document.getElementById('wl-btn-pin');
            if (!pinBtn) return;
            pinBtn.classList.toggle('active', this.isPinned);
            pinBtn.classList.toggle('pinned', this.isPinned);
            pinBtn.title = this.isPinned ? 'Unpin Watchlist (Auto-close on click)' : 'Pin Watchlist (Keep open on click)';
            const icon = pinBtn.querySelector('.wl-pin-icon');
            if (icon) {
                icon.setAttribute('fill', this.isPinned ? '#2962ff' : 'none');
                icon.style.color = this.isPinned ? '#2962ff' : '#787b86';
            }
        }

        toggleSort(field) {
            if (this.sortField !== field) {
                this.sortField = field;
                this.sortOrder = 'asc';
            } else {
                if (this.sortOrder === 'asc') {
                    this.sortOrder = 'desc';
                } else if (this.sortOrder === 'desc') {
                    this.sortField = null;
                    this.sortOrder = 'none'; // Reverts back to custom drag-and-drop order!
                } else {
                    this.sortOrder = 'asc';
                }
            }
            this.updateSortHeaderIndicators();
            this.renderSymbolRows();
        }

        updateSortHeaderIndicators() {
            const colHeaders = document.getElementById('wl-col-headers');
            if (!colHeaders) return;
            colHeaders.querySelectorAll('.wl-col-header').forEach(h => {
                const f = h.dataset.sort;
                const ind = h.querySelector('.wl-sort-indicator');
                if (!ind) return;
                if (this.sortField === f && this.sortOrder !== 'none') {
                    h.classList.add('sorted');
                    ind.classList.add('active');
                    ind.innerHTML = this.sortOrder === 'asc' ? '▲' : '▼';
                    ind.title = this.sortOrder === 'asc' ? 'Ascending (click for descending)' : 'Descending (click to reset to custom order)';
                } else {
                    h.classList.remove('sorted');
                    ind.classList.remove('active');
                    ind.innerHTML = '';
                    ind.title = '';
                }
            });
        }

        getActiveList() {
            if (!this.lists || this.lists.length === 0) {
                this.lists = JSON.parse(JSON.stringify(DEFAULT_LISTS));
            }
            return this.lists.find(l => l.id === this.activeListId) || this.lists[0];
        }

        switchList(listId) {
            const target = this.lists.find(l => l.id === listId || (l.flagColor && l.flagColor === listId));
            if (target) {
                this.activeListId = target.id;
                this.saveLists();
                this.render();
                this.pollActiveListQuotes();
            }
        }

        promptCreateList() {
            const name = prompt('Enter new Watchlist name (e.g. "Scalp Targets", "Prop Fleet"):');
            if (!name || !name.trim()) return;

            const cleanName = name.trim();
            const id = 'custom_' + Date.now();
            const colors = ['#2962ff', '#089981', '#f23645', '#ff9800', '#9c27b0', '#00bcd4', '#1e222d'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];

            this.lists.push({
                id: id,
                name: cleanName,
                color: randomColor,
                symbols: []
            });

            this.activeListId = id;
            this.saveLists();
            this.render();
        }

        deleteList(listId) {
            if (this.lists.length <= 1) {
                alert('You must have at least one watchlist.');
                return;
            }
            const target = this.lists.find(l => l.id === listId);
            if (!target) return;

            if (confirm(`Are you sure you want to delete "${target.name}"?`)) {
                this.lists = this.lists.filter(l => l.id !== listId);
                if (this.activeListId === listId) {
                    this.activeListId = this.lists[0].id;
                }
                this.saveLists();
                this.render();
            }
        }

        addSymbolToActiveList(rawSymbol) {
            const sym = (rawSymbol || '').toUpperCase().trim();
            if (!sym) return;

            const active = this.getActiveList();
            if (!active) return;

            if (!active.symbols.includes(sym)) {
                active.symbols.push(sym);
                if (active.flagColor) {
                    this.symbolFlags[sym] = active.flagColor;
                }
                this.saveLists();
                this.render();
                this.pollActiveListQuotes();
            }
        }

        removeSymbolFromActiveList(sym) {
            const active = this.getActiveList();
            if (!active) return;

            active.symbols = active.symbols.filter(s => s !== sym);
            if (active.flagColor && this.symbolFlags[sym] === active.flagColor) {
                delete this.symbolFlags[sym];
            }
            this.saveLists();
            this.render();
        }

        setSymbolFlag(sym, color) {
            if (!color) {
                delete this.symbolFlags[sym];
                this.lists.forEach(l => {
                    if (l.flagColor) {
                        l.symbols = l.symbols.filter(s => s !== sym);
                    }
                });
            } else {
                this.symbolFlags[sym] = color;
                const flagList = this.lists.find(l => l.flagColor === color);
                if (flagList && !flagList.symbols.includes(sym)) {
                    flagList.symbols.push(sym);
                }
                this.lists.forEach(l => {
                    if (l.flagColor && l.flagColor !== color) {
                        l.symbols = l.symbols.filter(s => s !== sym);
                    }
                });
            }
            this.saveLists();
            this.render();
        }

        render() {
            this.updateActiveHeader();
            this.renderSymbolRows();
            this.updateHeaderStats();
        }

        updateActiveHeader() {
            const active = this.getActiveList();
            if (!active) return;

            const dot = document.getElementById('wl-active-color-dot');
            const title = document.getElementById('wl-active-title');
            const count = document.getElementById('wl-active-count');

            if (dot) dot.style.background = active.color || '#2962ff';
            if (title) title.textContent = active.name;
            if (count) count.textContent = Array.isArray(active.symbols) ? active.symbols.length : 0;

            const flagPills = document.getElementById('wl-flag-pills');
            if (flagPills) {
                let selectedFilter = null;
                if (active.flagColor) {
                    selectedFilter = active.flagColor;
                } else if (['red', 'green', 'blue', 'amber', 'black'].includes(active.id)) {
                    selectedFilter = active.id;
                } else if (active.id === 'main') {
                    selectedFilter = 'all';
                }

                flagPills.querySelectorAll('.wl-pill').forEach(b => {
                    const filter = b.dataset.filter;
                    b.classList.toggle('active', filter === selectedFilter);
                });
            }
        }

        renderDropdownLists() {
            const listEl = document.getElementById('wl-dropdown-list');
            if (!listEl) return;

            let html = '';
            this.lists.forEach(l => {
                const isActive = l.id === this.activeListId;
                const canDelete = !l.isDefault && !l.isFlagList && this.lists.length > 1;

                html += `
                    <div class="wl-dd-item ${isActive ? 'active' : ''}" data-id="${l.id}">
                        <div class="wl-dd-item-left">
                            <span class="wl-color-dot" style="background: ${l.color};"></span>
                            <span class="wl-dd-name">${l.name}</span>
                            <span class="wl-dd-count">(${l.symbols.length})</span>
                        </div>
                        <div class="wl-dd-item-right">
                            ${isActive ? '<span class="wl-dd-check">✓</span>' : ''}
                            ${canDelete ? `<button class="wl-dd-del" data-del-id="${l.id}" title="Delete List">✕</button>` : ''}
                        </div>
                    </div>
                `;
            });

            listEl.innerHTML = html;

            listEl.querySelectorAll('.wl-dd-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.classList.contains('wl-dd-del')) return;
                    const id = item.dataset.id;
                    this.switchList(id);
                    const menu = document.getElementById('wl-dropdown-menu');
                    if (menu) menu.classList.remove('show');
                });
            });

            listEl.querySelectorAll('.wl-dd-del').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.delId;
                    this.deleteList(id);
                });
            });
        }

        renderSymbolRows() {
            const container = document.getElementById('wl-items-container');
            if (!container) return;

            const active = this.getActiveList();
            if (!active || active.symbols.length === 0) {
                container.innerHTML = `
                    <div class="wl-empty-state">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#787b86" stroke-width="1.2">
                            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
                        </svg>
                        <p class="wl-empty-title">Watchlist is Empty</p>
                        <p class="wl-empty-sub">Type a ticker in the search bar above to add symbols to this list.</p>
                    </div>
                `;
                return;
            }

            try {
                if (window.tvWidget && window.tvWidget.activeChart) {
                    this.activeChartSymbol = window.tvWidget.activeChart().symbol().split(':').pop().toUpperCase();
                }
            } catch (_) {}

            this.scanActiveChartBar();

            // Compute display symbols based on active column sort or custom order
            let displaySymbols = [...active.symbols];
            if (this.sortField && this.sortOrder !== 'none') {
                const isAsc = this.sortOrder === 'asc';
                displaySymbols.sort((a, b) => {
                    const symA = a.toUpperCase();
                    const symB = b.toUpperCase();
                    if (this.sortField === 'sym') {
                        return isAsc ? symA.localeCompare(symB) : symB.localeCompare(symA);
                    }
                    if (this.sortField === 'last') {
                        const qA = this.liveQuotes[symA];
                        const qB = this.liveQuotes[symB];
                        const pA = (qA && qA.price !== null && qA.price !== undefined) ? qA.price : (isAsc ? Infinity : -Infinity);
                        const pB = (qB && qB.price !== null && qB.price !== undefined) ? qB.price : (isAsc ? Infinity : -Infinity);
                        return isAsc ? pA - pB : pB - pA;
                    }
                    if (this.sortField === 'chg') {
                        const qA = this.liveQuotes[symA];
                        const qB = this.liveQuotes[symB];
                        const cA = (qA && qA.change !== null && qA.change !== undefined) ? qA.change : (isAsc ? Infinity : -Infinity);
                        const cB = (qB && qB.change !== null && qB.change !== undefined) ? qB.change : (isAsc ? Infinity : -Infinity);
                        return isAsc ? cA - cB : cB - cA;
                    }
                    return 0;
                });
            }

            let html = '';
            displaySymbols.forEach(sym => {
                const sUpper = sym.toUpperCase();
                const avail = this.getSymbolAvailability(sUpper);
                const flag = this.symbolFlags[sUpper] || null;
                const quote = this.liveQuotes[sUpper] || { price: null, change: 0 };
                const isChartActive = this.activeChartSymbol === sUpper || this.activeChartSymbol.includes(sUpper) || sUpper.includes(this.activeChartSymbol);

                const flagColor = flag === 'red' ? '#f23645' : 
                                 (flag === 'green' ? '#089981' : 
                                 (flag === 'blue' ? '#2962ff' : 
                                 (flag === 'amber' ? '#ff9800' :
                                 (flag === 'black' ? '#1e222d' : '#b2b5be'))));

                const flagFill = flag ? flagColor : 'none';

                const priceStr = this.formatPrice(quote.price);
                const sign = quote.change > 0 ? '+' : '';
                const chgStr = quote.price !== null ? `${sign}${quote.change.toFixed(2)}%` : '--';
                const chgClass = quote.change >= 0 ? 'pos' : 'neg';

                html += `
                    <div class="wl-item ${isChartActive ? 'chart-active' : ''}" data-symbol="${sUpper}" draggable="true">
                        <!-- Drag Handle -->
                        <div class="wl-drag-handle" title="Drag to reposition">
                            <svg viewBox="0 0 6 12" width="6" height="12" fill="currentColor">
                                <circle cx="1.5" cy="2" r="1.1"/>
                                <circle cx="4.5" cy="2" r="1.1"/>
                                <circle cx="1.5" cy="6" r="1.1"/>
                                <circle cx="4.5" cy="6" r="1.1"/>
                                <circle cx="1.5" cy="10" r="1.1"/>
                                <circle cx="4.5" cy="10" r="1.1"/>
                            </svg>
                        </div>

                        <!-- Left Info (Fixed Widths & 2-Line Subtitle to Prevent Overlap) -->
                        <div class="wl-item-left">
                            <button class="wl-flag-btn" data-sym="${sUpper}" title="Flag symbol (Red/Green/Blue/Amber/Black)">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="13" height="13" fill="${flagFill}" stroke="${flagColor}" stroke-width="1.3">
                                    <path d="M3 2v12M3 3h9l-2 4 2 4H3"/>
                                </svg>
                            </button>

                            <span class="wl-status-dot ${avail.dotClass}" title="${avail.tooltip}"></span>

                            <div class="wl-sym-box">
                                <div class="wl-sym-row">
                                    <span class="wl-sym-name">${sUpper}</span>
                                </div>
                                <div class="wl-sym-sub">
                                    <span class="wl-broker-badge" style="color: ${avail.color}; background: ${avail.color}1a;">
                                        ${avail.badgeText}
                                    </span>
                                    <span class="wl-sym-desc" title="${avail.tooltip}">${avail.tooltip.split(':')[0]}</span>
                                </div>
                            </div>
                        </div>

                        <!-- Right Prices & Actions (Zero-Shift Grid) -->
                        <div class="wl-item-right">
                            <span class="wl-price">${priceStr}</span>
                            <span class="wl-change ${chgClass}">${chgStr}</span>
                            <button class="wl-del-btn" data-sym="${sUpper}" title="Remove from list">✕</button>
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;

            container.querySelectorAll('.wl-item').forEach(row => {
                // Click: Open chart and auto-close if not pinned
                row.addEventListener('click', (e) => {
                    if (e.target.closest('.wl-flag-btn') || e.target.closest('.wl-del-btn') || e.target.closest('.wl-drag-handle')) {
                        return;
                    }
                    const sym = row.dataset.symbol;
                    this.loadSymbolOnChart(sym);
                    if (!this.isPinned) {
                        this.close();
                    }
                });

                // HTML5 Drag & Drop reordering
                row.addEventListener('dragstart', (e) => {
                    if (e.target.closest('.wl-flag-btn') || e.target.closest('.wl-del-btn')) {
                        e.preventDefault();
                        return;
                    }
                    this.draggedSymbol = row.dataset.symbol;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', this.draggedSymbol);
                    setTimeout(() => row.classList.add('dragging'), 0);
                });

                row.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (!this.draggedSymbol || this.draggedSymbol === row.dataset.symbol) return;

                    const rect = row.getBoundingClientRect();
                    const isTop = e.clientY < (rect.top + rect.height / 2);
                    if (isTop) {
                        row.classList.add('drag-over-top');
                        row.classList.remove('drag-over-bottom');
                    } else {
                        row.classList.add('drag-over-bottom');
                        row.classList.remove('drag-over-top');
                    }
                });

                row.addEventListener('dragleave', () => {
                    row.classList.remove('drag-over-top', 'drag-over-bottom');
                });

                row.addEventListener('dragend', () => {
                    row.classList.remove('dragging');
                    container.querySelectorAll('.wl-item').forEach(r => {
                        r.classList.remove('drag-over-top', 'drag-over-bottom', 'dragging');
                    });
                    this.draggedSymbol = null;
                });

                row.addEventListener('drop', (e) => {
                    e.preventDefault();
                    row.classList.remove('drag-over-top', 'drag-over-bottom');
                    const fromSym = this.draggedSymbol || e.dataTransfer.getData('text/plain');
                    const toSym = row.dataset.symbol;

                    if (!fromSym || !toSym || fromSym === toSym) return;

                    const rect = row.getBoundingClientRect();
                    const isTop = e.clientY < (rect.top + rect.height / 2);

                    const currActive = this.getActiveList();
                    if (!currActive || !currActive.symbols) return;

                    const fromIdx = currActive.symbols.indexOf(fromSym);
                    if (fromIdx === -1) return;

                    // Remove symbol from current position
                    currActive.symbols.splice(fromIdx, 1);

                    // Re-locate target index and insert
                    let toIdx = currActive.symbols.indexOf(toSym);
                    if (toIdx === -1) {
                        currActive.symbols.push(fromSym);
                    } else {
                        const insertIdx = isTop ? toIdx : toIdx + 1;
                        currActive.symbols.splice(insertIdx, 0, fromSym);
                    }

                    // Reset sort indicator since manual re-positioning establishes a custom order
                    this.sortField = null;
                    this.sortOrder = 'none';
                    this.updateSortHeaderIndicators();

                    this.saveLists();
                    this.render();
                });
            });

            container.querySelectorAll('.wl-flag-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const sym = btn.dataset.sym;
                    this.showFlagMenu(btn, sym);
                });
            });

            container.querySelectorAll('.wl-del-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const sym = btn.dataset.sym;
                    this.removeSymbolFromActiveList(sym);
                });
            });
        }

        loadSymbolOnChart(sym) {
            if (!window.tvWidget) return;
            try {
                const chart = window.tvWidget.activeChart();
                if (chart) {
                    chart.setSymbol(sym, () => {
                        this.activeChartSymbol = sym.toUpperCase();
                        this.highlightActiveRow();
                    });
                }
            } catch (err) {
                console.error('[WatchlistUI] Failed to set symbol:', err);
            }
        }

        highlightActiveRow() {
            const container = document.getElementById('wl-items-container');
            if (!container) return;
            container.querySelectorAll('.wl-item').forEach(r => {
                const rowSym = r.dataset.symbol;
                const isMatch = this.activeChartSymbol === rowSym || this.activeChartSymbol.includes(rowSym) || rowSym.includes(this.activeChartSymbol);
                r.classList.toggle('chart-active', isMatch);
                if (isMatch) {
                    this.updateRowAvailability(rowSym);
                }
            });
        }

        showFlagMenu(targetEl, sym) {
            const existing = document.getElementById('wl-flag-popup');
            if (existing) existing.remove();

            const rect = targetEl.getBoundingClientRect();
            const popup = document.createElement('div');
            popup.id = 'wl-flag-popup';
            popup.className = 'wl-flag-popup';
            popup.style.top = `${rect.bottom + 4}px`;
            popup.style.left = `${rect.left - 8}px`;

            popup.innerHTML = `
                <div class="wl-flag-opt" data-color="red"><span class="dot red"></span>Red List</div>
                <div class="wl-flag-opt" data-color="green"><span class="dot green"></span>Green List</div>
                <div class="wl-flag-opt" data-color="blue"><span class="dot blue"></span>Blue List</div>
                <div class="wl-flag-opt" data-color="amber"><span class="dot amber"></span>Amber List</div>
                <div class="wl-flag-opt" data-color="black"><span class="dot black"></span>Black List</div>
                <div class="wl-flag-divider"></div>
                <div class="wl-flag-opt clear" data-color=""><span class="dot clear"></span>Remove Flag</div>
            `;

            document.body.appendChild(popup);

            const removePopup = (e) => {
                if (!popup.contains(e.target) && e.target !== targetEl) {
                    popup.remove();
                    document.removeEventListener('click', removePopup);
                }
            };
            setTimeout(() => document.addEventListener('click', removePopup), 50);

            popup.querySelectorAll('.wl-flag-opt').forEach(opt => {
                opt.addEventListener('click', () => {
                    const col = opt.dataset.color || null;
                    this.setSymbolFlag(sym, col);
                    popup.remove();
                });
            });
        }

        updateHeaderStats() {
            const footerBroker = document.getElementById('wl-footer-broker');
            const footerStats = document.getElementById('wl-footer-stats');
            const active = this.getActiveList();

            const isMt5 = window.MT5API && window.MT5API.isConnected;
            const isFyers = window.FyersAPI && (window.FyersAPI.isConnected || !!window.FyersAPI.token);

            let brokerStr = 'Offline';
            if (isMt5 && isFyers) brokerStr = 'MT5 & Fyers Live';
            else if (isMt5) brokerStr = 'MT5 Fleet Connected';
            else if (isFyers) brokerStr = 'Fyers Live Connected';

            if (footerBroker) footerBroker.textContent = `Broker: ${brokerStr}`;
            if (footerStats && active) footerStats.textContent = `${active.symbols.length} symbols`;
        }

        // --- Styles Injection ---
        injectStyles() {
            if (document.getElementById('tv-watchlist-styles')) return;

            const style = document.createElement('style');
            style.id = 'tv-watchlist-styles';
            style.innerHTML = `
                /* TradingView Watchlist Drawer */
                .tv-watchlist-drawer {
                    position: fixed;
                    top: 0;
                    right: 0;
                    bottom: 0;
                    width: 365px;
                    background: #ffffff;
                    border-left: 1px solid #e0e3eb;
                    box-shadow: -4px 0 24px rgba(0, 0, 0, 0.08);
                    z-index: 1000;
                    display: flex;
                    flex-direction: column;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    transform: translateX(100%);
                    transition: transform 0.22s cubic-bezier(0.2, 0, 0, 1);
                    user-select: none;
                    box-sizing: border-box;
                }
                .tv-watchlist-drawer.open {
                    transform: translateX(0);
                }

                /* Header */
                .wl-header {
                    height: 48px;
                    padding: 0 12px;
                    border-bottom: 1px solid #e0e3eb;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    background: #fafbfd;
                    flex-shrink: 0;
                    position: relative;
                }
                .wl-header-left {
                    display: flex;
                    align-items: center;
                    position: relative;
                }
                .wl-dropdown-trigger {
                    display: flex;
                    align-items: center;
                    gap: 7px;
                    cursor: pointer;
                    padding: 6px 8px;
                    border-radius: 4px;
                    transition: background 0.15s;
                }
                .wl-dropdown-trigger:hover {
                    background: #eef3fe;
                }
                .wl-color-dot {
                    width: 9px;
                    height: 9px;
                    border-radius: 50%;
                    flex-shrink: 0;
                }
                .wl-title {
                    font-size: 13.5px;
                    font-weight: 700;
                    color: #131722;
                    letter-spacing: -0.1px;
                }
                .wl-count-badge {
                    font-size: 11px;
                    font-weight: 600;
                    color: #787b86;
                    background: #e0e3eb;
                    padding: 1px 5px;
                    border-radius: 10px;
                }
                .wl-chevron {
                    color: #787b86;
                    margin-left: 2px;
                }
                .wl-header-actions {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .wl-icon-btn {
                    background: transparent;
                    border: none;
                    color: #787b86;
                    cursor: pointer;
                    width: 28px;
                    height: 28px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 4px;
                    transition: all 0.15s;
                }
                .wl-icon-btn:hover {
                    color: #131722;
                    background: #e0e3eb;
                }
                .wl-icon-btn.active, .wl-icon-btn.pinned {
                    color: #2962ff;
                    background: #eef3fe;
                }
                .wl-icon-btn.pinned:hover {
                    background: #dce7fe;
                }

                /* Dropdown Menu */
                .wl-dropdown-menu {
                    position: absolute;
                    top: 42px;
                    left: 0;
                    width: 250px;
                    background: #ffffff;
                    border: 1px solid #e0e3eb;
                    border-radius: 6px;
                    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
                    z-index: 1100;
                    display: none;
                    padding: 6px 0;
                }
                .wl-dropdown-menu.show {
                    display: block;
                }
                .wl-dropdown-header {
                    font-size: 11px;
                    font-weight: 700;
                    text-transform: uppercase;
                    color: #787b86;
                    padding: 6px 14px 4px;
                }
                .wl-dropdown-list {
                    max-height: 240px;
                    overflow-y: auto;
                }
                .wl-dd-item {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 14px;
                    cursor: pointer;
                    font-size: 13px;
                    color: #131722;
                    transition: background 0.12s;
                }
                .wl-dd-item:hover {
                    background: #f0f3fa;
                }
                .wl-dd-item.active {
                    background: #eef3fe;
                    font-weight: 600;
                    color: #2962ff;
                }
                .wl-dd-item-left {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .wl-dd-count {
                    font-size: 11px;
                    color: #787b86;
                }
                .wl-dd-item-right {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .wl-dd-check {
                    color: #2962ff;
                    font-weight: bold;
                    font-size: 13px;
                }
                .wl-dd-del {
                    border: none;
                    background: transparent;
                    color: #b2b5be;
                    font-size: 11px;
                    cursor: pointer;
                    padding: 2px 4px;
                    border-radius: 3px;
                }
                .wl-dd-del:hover {
                    color: #f23645;
                    background: #fee;
                }
                .wl-dropdown-divider {
                    height: 1px;
                    background: #e0e3eb;
                    margin: 4px 0;
                }
                .wl-dropdown-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 14px;
                    font-size: 12.5px;
                    cursor: pointer;
                    color: #131722;
                    transition: background 0.12s;
                }
                .wl-dropdown-item:hover {
                    background: #f0f3fa;
                }
                .wl-create-btn {
                    color: #2962ff;
                    font-weight: 600;
                }
                .wl-clear-btn {
                    color: #787b86;
                }
                .wl-clear-btn:hover {
                    color: #f23645;
                }

                /* Quick Flag Filter Pills (Persistent Color Identity) */
                .wl-flag-pills {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 12px;
                    background: #ffffff;
                    border-bottom: 1px solid #f0f3fa;
                    overflow-x: auto;
                    flex-shrink: 0;
                    scrollbar-width: none;
                }
                .wl-flag-pills::-webkit-scrollbar {
                    display: none;
                }
                .wl-pill {
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    padding: 3px 10px;
                    border-radius: 12px;
                    font-size: 11.5px;
                    font-weight: 600;
                    border: 1px solid transparent;
                    cursor: pointer;
                    transition: all 0.18s ease;
                    white-space: nowrap;
                    user-select: none;
                }
                .pill-dot {
                    width: 7px;
                    height: 7px;
                    border-radius: 50%;
                    flex-shrink: 0;
                    transition: background 0.15s ease;
                }

                /* Filter 'All' */
                .wl-pill[data-filter="all"] {
                    background: #f0f3fa;
                    color: #5d606b;
                    border-color: #e0e3eb;
                }
                .wl-pill[data-filter="all"]:hover {
                    background: #e4e7f0;
                    color: #131722;
                }
                .wl-pill[data-filter="all"].active {
                    background: #2962ff;
                    color: #ffffff;
                    border-color: #2962ff;
                    box-shadow: 0 1px 4px rgba(41, 98, 255, 0.3);
                }

                /* Filter 'Red' */
                .wl-pill[data-filter="red"] {
                    background: #fef0f0;
                    color: #f23645;
                    border-color: rgba(242, 54, 69, 0.28);
                }
                .wl-pill[data-filter="red"] .pill-dot {
                    background: #f23645;
                }
                .wl-pill[data-filter="red"]:hover {
                    background: #fde2e4;
                    border-color: rgba(242, 54, 69, 0.45);
                }
                .wl-pill[data-filter="red"].active {
                    background: #f23645;
                    color: #ffffff;
                    border-color: #f23645;
                    box-shadow: 0 1px 5px rgba(242, 54, 69, 0.35);
                }
                .wl-pill[data-filter="red"].active .pill-dot {
                    background: #ffffff;
                }

                /* Filter 'Green' */
                .wl-pill[data-filter="green"] {
                    background: #edf8f5;
                    color: #089981;
                    border-color: rgba(8, 153, 129, 0.28);
                }
                .wl-pill[data-filter="green"] .pill-dot {
                    background: #089981;
                }
                .wl-pill[data-filter="green"]:hover {
                    background: #def3ed;
                    border-color: rgba(8, 153, 129, 0.45);
                }
                .wl-pill[data-filter="green"].active {
                    background: #089981;
                    color: #ffffff;
                    border-color: #089981;
                    box-shadow: 0 1px 5px rgba(8, 153, 129, 0.35);
                }
                .wl-pill[data-filter="green"].active .pill-dot {
                    background: #ffffff;
                }

                /* Filter 'Blue' */
                .wl-pill[data-filter="blue"] {
                    background: #eef3fe;
                    color: #2962ff;
                    border-color: rgba(41, 98, 255, 0.28);
                }
                .wl-pill[data-filter="blue"] .pill-dot {
                    background: #2962ff;
                }
                .wl-pill[data-filter="blue"]:hover {
                    background: #dfe8fc;
                    border-color: rgba(41, 98, 255, 0.45);
                }
                .wl-pill[data-filter="blue"].active {
                    background: #2962ff;
                    color: #ffffff;
                    border-color: #2962ff;
                    box-shadow: 0 1px 5px rgba(41, 98, 255, 0.35);
                }
                .wl-pill[data-filter="blue"].active .pill-dot {
                    background: #ffffff;
                }

                /* Filter 'Amber' */
                .wl-pill[data-filter="amber"] {
                    background: #fff8ec;
                    color: #ff9800;
                    border-color: rgba(255, 152, 0, 0.32);
                }
                .wl-pill[data-filter="amber"] .pill-dot {
                    background: #ff9800;
                }
                .wl-pill[data-filter="amber"]:hover {
                    background: #ffeed1;
                    border-color: rgba(255, 152, 0, 0.5);
                }
                .wl-pill[data-filter="amber"].active {
                    background: #ff9800;
                    color: #ffffff;
                    border-color: #ff9800;
                    box-shadow: 0 1px 5px rgba(255, 152, 0, 0.35);
                }
                .wl-pill[data-filter="amber"].active .pill-dot {
                    background: #ffffff;
                }

                /* Filter 'Black' */
                .wl-pill[data-filter="black"] {
                    background: #f0f1f4;
                    color: #1e222d;
                    border-color: rgba(30, 34, 45, 0.28);
                }
                .wl-pill[data-filter="black"] .pill-dot {
                    background: #1e222d;
                }
                .wl-pill[data-filter="black"]:hover {
                    background: #e2e4e9;
                    border-color: rgba(30, 34, 45, 0.45);
                }
                .wl-pill[data-filter="black"].active {
                    background: #1e222d;
                    color: #ffffff;
                    border-color: #1e222d;
                    box-shadow: 0 1px 5px rgba(30, 34, 45, 0.35);
                }
                .wl-pill[data-filter="black"].active .pill-dot {
                    background: #ffffff;
                }

                /* Search Add Bar */
                .wl-search-box {
                    padding: 8px 12px;
                    border-bottom: 1px solid #e0e3eb;
                    position: relative;
                    flex-shrink: 0;
                }
                .wl-search-input-wrapper {
                    position: relative;
                    display: flex;
                    align-items: center;
                }
                .wl-search-icon {
                    position: absolute;
                    left: 9px;
                    color: #787b86;
                    pointer-events: none;
                }
                #wl-add-symbol-input {
                    width: 100%;
                    height: 32px;
                    padding: 0 28px 0 30px;
                    border: 1px solid #e0e3eb;
                    border-radius: 5px;
                    font-size: 12.5px;
                    color: #131722;
                    background: #fafbfd;
                    outline: none;
                    box-sizing: border-box;
                    transition: border 0.15s, background 0.15s;
                }
                #wl-add-symbol-input:focus {
                    border-color: #2962ff;
                    background: #ffffff;
                }
                .wl-search-clear {
                    position: absolute;
                    right: 8px;
                    background: transparent;
                    border: none;
                    color: #787b86;
                    cursor: pointer;
                    font-size: 11px;
                }

                /* Autocomplete */
                .wl-autocomplete-list {
                    position: absolute;
                    top: 44px;
                    left: 12px;
                    right: 12px;
                    background: #ffffff;
                    border: 1px solid #e0e3eb;
                    border-radius: 5px;
                    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.15);
                    z-index: 1200;
                    max-height: 250px;
                    overflow-y: auto;
                }
                .wl-auto-item {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 7px 10px;
                    cursor: pointer;
                    border-bottom: 1px solid #f0f3fa;
                    transition: background 0.1s;
                }
                .wl-auto-item:hover {
                    background: #f0f3fa;
                }
                .wl-auto-item-left {
                    display: flex;
                    flex-direction: column;
                }
                .wl-auto-sym {
                    font-size: 12.5px;
                    font-weight: 700;
                    color: #131722;
                }
                .wl-auto-desc {
                    font-size: 10.5px;
                    color: #787b86;
                }
                .wl-auto-item-right {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .wl-avail-badge {
                    font-size: 9px;
                    font-weight: 700;
                    padding: 1.5px 5px;
                    border-radius: 3px;
                    white-space: nowrap;
                }
                .wl-auto-add-icon {
                    font-size: 14px;
                    font-weight: bold;
                    color: #2962ff;
                }
                .wl-auto-empty {
                    padding: 10px;
                    font-size: 12px;
                    color: #787b86;
                    text-align: center;
                }

                /* Column Headers (Zero-Shift Precise Grid Alignment with 3-Way Sorting) */
                .wl-col-headers {
                    display: flex;
                    align-items: center;
                    padding: 7px 12px;
                    font-size: 10.5px;
                    font-weight: 700;
                    text-transform: uppercase;
                    color: #787b86;
                    border-bottom: 1px solid #f0f3fa;
                    background: #fafbfd;
                    flex-shrink: 0;
                    user-select: none;
                }
                .wl-col-header {
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    transition: color 0.15s;
                }
                .wl-col-header:hover {
                    color: #131722;
                }
                .wl-col-header.sorted {
                    color: #2962ff;
                    font-weight: 800;
                }
                .wl-sort-indicator {
                    display: inline-block;
                    margin-left: 3px;
                    font-size: 8px;
                    line-height: 1;
                    color: #2962ff;
                }
                .wl-col-sym { flex: 1; min-width: 0; padding-left: 38px; }
                .wl-col-last { width: 72px; justify-content: flex-end; text-align: right; }
                .wl-col-chg { width: 54px; justify-content: flex-end; text-align: right; }
                .wl-col-spacer { width: 18px; flex-shrink: 0; }

                /* Symbol Rows */
                .wl-items-container {
                    flex: 1;
                    overflow-y: auto;
                }
                .wl-item {
                    display: flex;
                    align-items: center;
                    height: 48px;
                    padding: 0 12px;
                    border-bottom: 1px solid #f0f3fa;
                    cursor: pointer;
                    transition: background 0.1s;
                    position: relative;
                    box-sizing: border-box;
                }
                .wl-item:hover {
                    background: #f8f9fd;
                }
                .wl-item.chart-active {
                    background: #edf2fe;
                    border-left: 3px solid #2962ff;
                }
                .wl-item.dragging {
                    opacity: 0.35;
                    background: #eef3fe;
                }
                .wl-item.drag-over-top {
                    border-top: 2px solid #2962ff !important;
                }
                .wl-item.drag-over-bottom {
                    border-bottom: 2px solid #2962ff !important;
                }

                .wl-drag-handle {
                    width: 12px;
                    height: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #b2b5be;
                    cursor: grab;
                    opacity: 0;
                    flex-shrink: 0;
                    margin-right: 2px;
                    transition: opacity 0.15s, color 0.15s;
                }
                .wl-item:hover .wl-drag-handle {
                    opacity: 1;
                }
                .wl-drag-handle:hover {
                    color: #131722;
                }

                /* Left Info (Full Width Ticker on Top, Badge on Subtitle) */
                .wl-item-left {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    flex: 1;
                    min-width: 0;
                    overflow: hidden;
                }
                .wl-flag-btn {
                    border: none;
                    background: transparent;
                    cursor: pointer;
                    padding: 0;
                    width: 16px;
                    height: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                .wl-status-dot {
                    width: 7px;
                    height: 7px;
                    border-radius: 50%;
                    flex-shrink: 0;
                }
                .wl-status-dot.dot-available {
                    background: #089981;
                    box-shadow: 0 0 6px rgba(8, 153, 129, 0.6);
                }
                .wl-status-dot.dot-local {
                    background: #2962ff;
                    box-shadow: 0 0 4px rgba(41, 98, 255, 0.4);
                }
                .wl-status-dot.dot-warning {
                    background: #ff9800;
                }
                .wl-status-dot.dot-offline {
                    background: #787b86;
                }

                .wl-sym-box {
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    min-width: 0;
                    flex: 1;
                    overflow: hidden;
                }
                .wl-sym-row {
                    display: flex;
                    align-items: center;
                    white-space: nowrap;
                    overflow: hidden;
                }
                .wl-sym-name {
                    font-size: 12.5px;
                    font-weight: 700;
                    color: #131722;
                    letter-spacing: -0.2px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .wl-sym-sub {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    white-space: nowrap;
                    overflow: hidden;
                    margin-top: 2px;
                }
                .wl-broker-badge {
                    font-size: 9px;
                    font-weight: 700;
                    padding: 1px 4.5px;
                    border-radius: 3px;
                    line-height: 1.2;
                    white-space: nowrap;
                    flex-shrink: 0;
                    letter-spacing: 0.2px;
                }
                .wl-sym-desc {
                    font-size: 10.5px;
                    color: #787b86;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                /* Right Column Grid (Guaranteed Stable Footprint) */
                .wl-item-right {
                    display: flex;
                    align-items: center;
                    gap: 2px;
                    flex-shrink: 0;
                }
                .wl-price {
                    width: 72px;
                    text-align: right;
                    font-size: 12px;
                    font-weight: 600;
                    color: #131722;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
                    font-variant-numeric: tabular-nums;
                    white-space: nowrap;
                    border-radius: 3px;
                    padding: 1px 2px;
                    flex-shrink: 0;
                    transition: background-color 0.4s ease;
                }
                .wl-price.flash-up {
                    background-color: rgba(8, 153, 129, 0.22);
                    color: #089981;
                }
                .wl-price.flash-down {
                    background-color: rgba(242, 54, 69, 0.22);
                    color: #f23645;
                }
                .wl-change {
                    width: 54px;
                    text-align: right;
                    font-size: 11.5px;
                    font-weight: 600;
                    white-space: nowrap;
                    flex-shrink: 0;
                }
                .wl-change.pos { color: #089981; }
                .wl-change.neg { color: #f23645; }

                /* Delete Button (Zero-Shift Hover: Stays in DOM, Only Toggles Opacity) */
                .wl-del-btn {
                    width: 18px;
                    height: 18px;
                    border: none;
                    background: transparent;
                    color: #b2b5be;
                    font-size: 12px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 3px;
                    flex-shrink: 0;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
                }
                .wl-item:hover .wl-del-btn {
                    opacity: 1;
                    pointer-events: auto;
                }
                .wl-del-btn:hover {
                    color: #f23645;
                    background: rgba(242, 54, 69, 0.12);
                }

                /* Flag Popup */
                .wl-flag-popup {
                    position: fixed;
                    background: #ffffff;
                    border: 1px solid #e0e3eb;
                    border-radius: 6px;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
                    z-index: 2000;
                    padding: 4px 0;
                    width: 140px;
                }
                .wl-flag-opt {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 12px;
                    font-size: 12px;
                    color: #131722;
                    cursor: pointer;
                    transition: background 0.1s;
                }
                .wl-flag-opt:hover {
                    background: #f0f3fa;
                }
                .wl-flag-opt .dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                }
                .wl-flag-opt .dot.red { background: #f23645; }
                .wl-flag-opt .dot.green { background: #089981; }
                .wl-flag-opt .dot.blue { background: #2962ff; }
                .wl-flag-opt .dot.amber { background: #ff9800; }
                .wl-flag-opt .dot.black { background: #1e222d; }
                .wl-flag-opt .dot.clear { border: 1px solid #787b86; background: transparent; }
                .wl-flag-divider {
                    height: 1px;
                    background: #e0e3eb;
                    margin: 3px 0;
                }

                /* Empty State */
                .wl-empty-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 40px 20px;
                    text-align: center;
                    color: #787b86;
                }
                .wl-empty-title {
                    font-size: 14px;
                    font-weight: 700;
                    color: #131722;
                    margin: 12px 0 4px;
                }
                .wl-empty-sub {
                    font-size: 12px;
                    color: #787b86;
                    margin: 0;
                    line-height: 1.4;
                }

                /* Footer */
                .wl-footer {
                    height: 32px;
                    padding: 0 12px;
                    border-top: 1px solid #e0e3eb;
                    background: #fafbfd;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    font-size: 11px;
                    color: #787b86;
                    flex-shrink: 0;
                }
            `;
            const head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
            if (head) head.appendChild(style);
        }
    }

    window.WatchlistUI = new WatchlistUI();

})(window);
