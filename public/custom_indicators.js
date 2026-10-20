window.isStrategyScript = function(code) {
    if (!code || typeof code !== 'string') return false;
    const hasBuy = /this\.strategy\.buy|strategy\.buy|action\s*:\s*['"]BUY['"]/i.test(code);
    const hasSell = /this\.strategy\.sell|strategy\.sell|action\s*:\s*['"]SELL['"]/i.test(code);
    return hasBuy && hasSell;
};

// Sanitizes indicator/strategy titles by removing creator tags like [LuxAlgo], [LazyBear], (by ChartArt), etc.
window.sanitizeIndicatorName = function(name) {
    if (!name || typeof name !== 'string') return name;
    let clean = name;
    if (clean === 'CM_Ultimate_MA_MTF_V2' || clean === 'CM Ultimate MA MTF V2' || clean === 'UltimateMA') {
        return 'MA Ultimate MTF v2';
    }
    clean = clean.replace(/\s*\[\s*(?:LuxAlgo|LazyBear|ChartArt)[^\]]*\]/gi, '');
    clean = clean.replace(/\s*\(\s*by\s+[^)]+\)/gi, '');
    clean = clean.replace(/\s*\[\s*by\s+[^\]]+\]/gi, '');
    clean = clean.replace(/\s+by\s+(?:LuxAlgo|LazyBear|ChartArt)\b/gi, '');
    clean = clean.replace(/\s{2,}/g, ' ').trim();
    return clean;
};

// --- ROBUST LOCAL INDICATOR STORAGE & AUTO-HEALING ENGINE ---
window.TVLocalStore = window.TVLocalStore || {
    PRIMARY_KEY: 'tv_local_indicators',
    BACKUP_KEY: 'tv_local_indicators_backup',
    ARCHIVE_KEY: 'tv_local_indicators_archive',

    getIndicators: function() {
        let primary = {};
        let backup = {};
        try {
            primary = JSON.parse(localStorage.getItem(this.PRIMARY_KEY) || '{}');
            if (typeof primary !== 'object' || primary === null || Array.isArray(primary)) primary = {};
        } catch (e) {
            console.warn("[TVLocalStore] Corrupted primary storage, attempting backup recovery:", e);
            primary = {};
        }

        try {
            backup = JSON.parse(localStorage.getItem(this.BACKUP_KEY) || '{}');
            if (typeof backup !== 'object' || backup === null || Array.isArray(backup)) backup = {};
        } catch (e) {
            backup = {};
        }

        let healed = false;
        if (primary['CM_Ultimate_MA_MTF_V2']) {
            primary['MA Ultimate MTF v2'] = { ...primary['CM_Ultimate_MA_MTF_V2'], name: 'MA Ultimate MTF v2' };
            delete primary['CM_Ultimate_MA_MTF_V2'];
            healed = true;
        }
        if (backup['CM_Ultimate_MA_MTF_V2']) {
            backup['MA Ultimate MTF v2'] = { ...backup['CM_Ultimate_MA_MTF_V2'], name: 'MA Ultimate MTF v2' };
            delete backup['CM_Ultimate_MA_MTF_V2'];
            healed = true;
        }

        for (const k in backup) {
            if (!primary[k] && backup[k]) {
                primary[k] = backup[k];
                healed = true;
            }
        }

        let backupUpdated = false;
        for (const k in primary) {
            if (!backup[k] && primary[k]) {
                backup[k] = primary[k];
                backupUpdated = true;
            }
        }

        if (healed) {
            try {
                localStorage.setItem(this.PRIMARY_KEY, JSON.stringify(primary));
                console.log("[TVLocalStore] Auto-healed primary storage from backup.");
            } catch (_) {}
        }
        if (backupUpdated) {
            try {
                localStorage.setItem(this.BACKUP_KEY, JSON.stringify(backup));
            } catch (_) {}
        }

        // Auto-sanitize existing stored indicators: strip creator suffixes ([LuxAlgo], [LazyBear], (by ChartArt), etc.)
        let sanitized = false;
        const cleanedPrimary = {};
        for (const rawKey in primary) {
            const cleanKey = window.sanitizeIndicatorName(rawKey);
            let code = primary[rawKey];
            if (cleanKey !== rawKey) {
                sanitized = true;
                if (typeof code === 'string') {
                    code = code.replace(/name\s*:\s*["'][^"']+["']/, `name: "${cleanKey}"`);
                    code = code.replace(/description\s*:\s*["'][^"']+["']/, `description: "${cleanKey}"`);
                }
            }
            cleanedPrimary[cleanKey] = code;
        }
        if (sanitized) {
            primary = cleanedPrimary;
            try {
                localStorage.setItem(this.PRIMARY_KEY, JSON.stringify(primary));
                localStorage.setItem(this.BACKUP_KEY, JSON.stringify(primary));
                console.log("[TVLocalStore] Auto-migrated stored indicators to clean creator-free names.");
            } catch (_) {}

            try {
                let favs = JSON.parse(localStorage.getItem('tv_favorite_indicators') || '[]');
                if (Array.isArray(favs)) {
                    let updatedFavs = favs.map(f => window.sanitizeIndicatorName(f));
                    localStorage.setItem('tv_favorite_indicators', JSON.stringify(updatedFavs));
                }
            } catch (_) {}
        }

        return primary;
    },

    saveIndicator: function(name, code, existingName = null) {
        if (!name || typeof name !== 'string') return;
        const current = this.getIndicators();
        if (existingName && existingName !== name && current[existingName]) {
            delete current[existingName];
        }
        current[name] = code;

        try {
            localStorage.setItem(this.PRIMARY_KEY, JSON.stringify(current));
            localStorage.setItem(this.BACKUP_KEY, JSON.stringify(current));
            this._recordArchive(current, `Saved "${name}"`);

            // Persist script metadata & update timestamp
            const meta = JSON.parse(localStorage.getItem('tv_scripts_metadata') || '{}');
            meta[name] = {
                updatedAt: Date.now(),
                createdAt: (existingName && meta[existingName] && meta[existingName].createdAt) || (meta[name] && meta[name].createdAt) || Date.now()
            };
            if (existingName && existingName !== name && meta[existingName]) delete meta[existingName];
            localStorage.setItem('tv_scripts_metadata', JSON.stringify(meta));
        } catch (e) {
            console.error("[TVLocalStore] Failed to save indicator:", e);
        }
        return current;
    },

    deleteIndicator: function(name) {
        if (!name) return;
        const current = this.getIndicators();
        if (current[name]) {
            this._recordArchive(current, `Pre-delete "${name}"`);
            delete current[name];
            try {
                localStorage.setItem(this.PRIMARY_KEY, JSON.stringify(current));
                localStorage.setItem(this.BACKUP_KEY, JSON.stringify(current));

                const meta = JSON.parse(localStorage.getItem('tv_scripts_metadata') || '{}');
                if (meta[name]) {
                    delete meta[name];
                    localStorage.setItem('tv_scripts_metadata', JSON.stringify(meta));
                }
            } catch (e) {
                console.error("[TVLocalStore] Failed to delete indicator:", e);
            }
        }
        return current;
    },

    exportBackupJson: function() {
        const indicators = this.getIndicators();
        const exportData = {
            version: 1,
            exportedAt: new Date().toISOString(),
            scripts: indicators
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tradingview_local_indicators_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    importBackupJson: function(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            const scripts = data.scripts || data;
            if (typeof scripts !== 'object' || scripts === null || Array.isArray(scripts)) {
                throw new Error("Invalid backup format: expected an object of scripts.");
            }
            const current = this.getIndicators();
            let count = 0;
            for (const [name, code] of Object.entries(scripts)) {
                if (typeof code === 'string' && code.trim().length > 0) {
                    current[name] = code;
                    count++;
                }
            }
            localStorage.setItem(this.PRIMARY_KEY, JSON.stringify(current));
            localStorage.setItem(this.BACKUP_KEY, JSON.stringify(current));
            this._recordArchive(current, `Imported ${count} scripts`);
            return { success: true, count };
        } catch (e) {
            return { success: false, error: e.message };
        }
    },

    _recordArchive: function(data, reason) {
        try {
            let list = JSON.parse(localStorage.getItem(this.ARCHIVE_KEY) || '[]');
            if (!Array.isArray(list)) list = [];
            list.unshift({ timestamp: Date.now(), reason, count: Object.keys(data).length, data });
            if (list.length > 5) list = list.slice(0, 5);
            localStorage.setItem(this.ARCHIVE_KEY, JSON.stringify(list));
        } catch (_) {}
    }
};

window.getCustomIndicators = function (PineJS) {
    return new Promise((resolve, reject) => {
        let hardcodedIndicators = [
            {
                name: "SuperTrend Custom",
                metainfo: {
                    _metainfoVersion: 52,
                    isTVScript: false,
                    is_hidden_study: false,
                    defaults: {
                        styles: {
                            plot_up: { plottype: 7, linewidth: 1, color: "#089981" },
                            plot_down: { plottype: 7, linewidth: 1, color: "#f23645" },
                            plot_mid: { plottype: 0, linewidth: 1, color: "#000000" },
                            plot_buy_circle: { plottype: "shape_circle", location: "Absolute", color: "#089981", size: "auto" },
                            plot_buy_label: { plottype: "shape_label_up", location: "Absolute", color: "#089981", textColor: "#ffffff", size: "auto" },
                            plot_sell_circle: { plottype: "shape_circle", location: "Absolute", color: "#f23645", size: "auto" },
                            plot_sell_label: { plottype: "shape_label_down", location: "Absolute", color: "#f23645", textColor: "#ffffff", size: "auto" }
                        },
                        inputs: {
                            in_period: 10,
                            in_source: "hl2",
                            in_multiplier: 3.0,
                            in_changeATR: true,
                            in_showSignals: true,
                            in_highlighting: true
                        },
                        filledAreasStyle: {
                            fill_up: { color: "#089981", transparency: 95, visible: true },
                            fill_down: { color: "#f23645", transparency: 95, visible: true }
                        }
                    },
                    plots: [
                        { id: "plot_up", type: "line" },
                        { id: "plot_down", type: "line" },
                        { id: "plot_mid", type: "line" },
                        { id: "plot_buy_circle", type: "shapes" },
                        { id: "plot_buy_label", type: "shapes" },
                        { id: "plot_sell_circle", type: "shapes" },
                        { id: "plot_sell_label", type: "shapes" }
                    ],
                    styles: {
                        plot_up: { title: "Up Trend", histogramBase: 0, joinPoints: false },
                        plot_down: { title: "Down Trend", histogramBase: 0, joinPoints: false },
                        plot_mid: { title: "Body Middle", isHidden: true, display: 0 },
                        plot_buy_circle: { title: "UpTrend Begins", isHidden: false },
                        plot_buy_label: { title: "Buy Label", isHidden: false, text: "Buy" },
                        plot_sell_circle: { title: "DownTrend Begins", isHidden: false },
                        plot_sell_label: { title: "Sell Label", isHidden: false, text: "Sell" }
                    },
                    description: "SuperTrend Custom",
                    shortDescription: "SuperTrend Custom",
                    is_price_study: true,
                    inputs: [
                        { id: "in_period", name: "ATR Period", defval: 10, type: "integer", min: 1 },
                        { id: "in_source", name: "Source", defval: "hl2", type: "source", options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"] },
                        { id: "in_multiplier", name: "ATR Multiplier", defval: 3.0, type: "float", min: 0.1, step: 0.1 },
                        { id: "in_changeATR", name: "Change ATR Calculation Method ?", defval: true, type: "bool" },
                        { id: "in_showSignals", name: "Show Buy/Sell Signals ?", defval: true, type: "bool" },
                        { id: "in_highlighting", name: "Highlighter On/Off ?", defval: true, type: "bool" }
                    ],
                    filledAreas: [
                        { id: "fill_up", objAId: "plot_up", objBId: "plot_mid", type: "plot_plot", title: "UpTrend Highlighter" },
                        { id: "fill_down", objAId: "plot_down", objBId: "plot_mid", type: "plot_plot", title: "DownTrend Highlighter" }
                    ],
                    id: "SuperTrend_Custom@tv-basicstudies-1",
                    scriptIdPart: "",
                    name: "SuperTrend Custom",
                    format: { precision: 2, type: "price" }
                },
                constructor: function () {
                    this.init = function(ctx, get_input) {
                        this._context = ctx;
                        this._input = get_input;
                    };

                    this.main = function (ctx, get_input) {
                        this._context = ctx || this._context;
                        this._input = get_input || this._input;
                        
                        var periods = this._input(0);
                        var sourceStr = this._input(1);
                        var multiplier = this._input(2);
                        var changeATR = this._input(3);
                        var showSignals = this._input(4);
                        var highlighting = this._input(5);

                        var high = PineJS.Std.high(this._context);
                        var low = PineJS.Std.low(this._context);
                        var close = PineJS.Std.close(this._context);
                        var open = PineJS.Std.open(this._context);
                        
                        var hl2 = (high + low) / 2.0;
                        var hlc3 = (high + low + close) / 3.0;
                        var ohlc4 = (open + high + low + close) / 4.0;
                        
                        var srcVal = hl2;
                        if (sourceStr === "open") srcVal = open;
                        else if (sourceStr === "high") srcVal = high;
                        else if (sourceStr === "low") srcVal = low;
                        else if (sourceStr === "close") srcVal = close;
                        else if (sourceStr === "hlc3") srcVal = hlc3;
                        else if (sourceStr === "ohlc4") srcVal = ohlc4;

                        var prev_close = this._context.new_var(close).get(1);
                        if (isNaN(prev_close)) prev_close = close;

                        var tr = Math.max(
                            high - low,
                            Math.abs(high - prev_close),
                            Math.abs(low - prev_close)
                        );

                        var trSeries = this._context.new_var(tr);
                        
                        var atrVal;
                        if (changeATR) {
                            atrVal = PineJS.Std.rma(trSeries, periods, this._context);
                        } else {
                            atrVal = PineJS.Std.sma(trSeries, periods, this._context);
                        }

                        var upVal = srcVal - (multiplier * atrVal);
                        var dnVal = srcVal + (multiplier * atrVal);
                        
                        var final_upper = this._context.new_var();
                        var final_lower = this._context.new_var();
                        var trend = this._context.new_var();
                        
                        var prev_final_upper = final_upper.get(1);
                        var prev_final_lower = final_lower.get(1);
                        var prev_trend = trend.get(1);

                        if (isNaN(prev_final_upper)) prev_final_upper = upVal;
                        if (isNaN(prev_final_lower)) prev_final_lower = dnVal;
                        if (isNaN(prev_trend)) prev_trend = 1;

                        var curr_up = (prev_close > prev_final_upper) ? Math.max(upVal, prev_final_upper) : upVal;
                        var curr_dn = (prev_close < prev_final_lower) ? Math.min(dnVal, prev_final_lower) : dnVal;

                        final_upper.set(curr_up);
                        final_lower.set(curr_dn);

                        var curr_trend = prev_trend;
                        if (curr_trend === -1 && close > prev_final_lower) {
                            curr_trend = 1;
                        } else if (curr_trend === 1 && close < prev_final_upper) {
                            curr_trend = -1;
                        }
                        trend.set(curr_trend);

                        var buySignal = (curr_trend === 1 && prev_trend === -1);
                        var sellSignal = (curr_trend === -1 && prev_trend === 1);

                        var upPlot = curr_trend === 1 ? curr_up : NaN;
                        var dnPlot = curr_trend === 1 ? NaN : curr_dn;
                        var mPlot = highlighting ? ohlc4 : NaN;

                        var buyCircle = buySignal ? curr_up : NaN;
                        var buyLabel = (buySignal && showSignals) ? curr_up : NaN;
                        
                        var sellCircle = sellSignal ? curr_dn : NaN;
                        var sellLabel = (sellSignal && showSignals) ? curr_dn : NaN;

                        return [
                            { value: upPlot },
                            { value: dnPlot },
                            { value: mPlot },
                            { value: buyCircle },
                            { value: buyLabel },
                            { value: sellCircle },
                            { value: sellLabel }
                        ];
                    };
                }
            },
            {
                name: "5 EMA Crossover",
                metainfo: {
                    _metainfoVersion: 52,
                    isTVScript: false,
                    is_hidden_study: false,
                    defaults: {
                        styles: {
                            plot_ema1: { plottype: 0, linewidth: 1, color: "#000000", linestyle: 0, visible: true, trackPrice: false },
                            plot_ema2: { plottype: 0, linewidth: 1, color: "#4CAF50", linestyle: 0, visible: true, trackPrice: false },
                            plot_ema3: { plottype: 0, linewidth: 1, color: "#F44336", linestyle: 0, visible: true, trackPrice: false },
                            plot_ema4: { plottype: 0, linewidth: 1, color: "#FF9800", linestyle: 0, visible: true, trackPrice: false },
                            plot_ema5: { plottype: 0, linewidth: 1, color: "#2196F3", linestyle: 0, visible: true, trackPrice: false },
                            plot_cross_up: { plottype: 3, linewidth: 6, color: "#2962FF", linestyle: 0, visible: true, trackPrice: false },
                            plot_cross_dn: { plottype: 3, linewidth: 6, color: "#FF00FF", linestyle: 0, visible: true, trackPrice: false }
                        },
                        inputs: {
                            len1: 3,
                            len2: 30,
                            len3: 50,
                            len4: 100,
                            len5: 200
                        }
                    },
                    plots: [
                        { id: "plot_ema1", type: "line" },
                        { id: "plot_ema2", type: "line" },
                        { id: "plot_ema3", type: "line" },
                        { id: "plot_ema4", type: "line" },
                        { id: "plot_ema5", type: "line" },
                        { id: "plot_cross_up", type: "line" },
                        { id: "plot_cross_dn", type: "line" }
                    ],
                    styles: {
                        plot_ema1: { title: "EMA 3", isHidden: false, histogramBase: 0 },
                        plot_ema2: { title: "EMA 30", isHidden: false, histogramBase: 0 },
                        plot_ema3: { title: "EMA 50", isHidden: false, histogramBase: 0 },
                        plot_ema4: { title: "EMA 100", isHidden: false, histogramBase: 0 },
                        plot_ema5: { title: "EMA 200", isHidden: false, histogramBase: 0 },
                        plot_cross_up: { title: "Cross Up", isHidden: false, histogramBase: 0 },
                        plot_cross_dn: { title: "Cross Down", isHidden: false, histogramBase: 0 }
                    },
                    description: "5 EMA Crossover",
                    shortDescription: "5 EMAs",
                    is_price_study: true,
                    inputs: [
                        { id: "len1", name: "EMA 1 Length", defval: 3, type: "integer", min: 1 },
                        { id: "len2", name: "EMA 2 Length", defval: 30, type: "integer", min: 1 },
                        { id: "len3", name: "EMA 3 Length", defval: 50, type: "integer", min: 1 },
                        { id: "len4", name: "EMA 4 Length", defval: 100, type: "integer", min: 1 },
                        { id: "len5", name: "EMA 5 Length", defval: 200, type: "integer", min: 1 }
                    ],
                    id: "5_EMA_Crossover@tv-basicstudies-1",
                    scriptIdPart: "",
                    name: "5 EMA Crossover",
                    format: { type: "price", precision: 2 }
                },
                constructor: function() {
                    this.init = function(ctx, get_input) {
                        this._context = ctx;
                        this._input = get_input;
                    };
                    this.main = function(ctx, get_input) {
                        this._context = ctx || this._context;
                        this._input = get_input || this._input;
                        
                        var len1 = this._input(0);
                        var len2 = this._input(1);
                        var len3 = this._input(2);
                        var len4 = this._input(3);
                        var len5 = this._input(4);
                        
                        var close = PineJS.Std.close(this._context);
                        var closeSeries = this._context.new_var(close);
                        
                        var ema1 = PineJS.Std.ema(closeSeries, len1, this._context);
                        var ema2 = PineJS.Std.ema(closeSeries, len2, this._context);
                        var ema3 = PineJS.Std.ema(closeSeries, len3, this._context);
                        var ema4 = PineJS.Std.ema(closeSeries, len4, this._context);
                        var ema5 = PineJS.Std.ema(closeSeries, len5, this._context);
                        
                        var ema1Series = this._context.new_var(ema1);
                        var ema2Series = this._context.new_var(ema2);
                        
                        var ema1_prev = ema1Series.get(1);
                        var ema2_prev = ema2Series.get(1);
                        
                        var crossUp = false;
                        var crossDn = false;
                        
                        if (!isNaN(ema1) && !isNaN(ema2) && !isNaN(ema1_prev) && !isNaN(ema2_prev)) {
                            if (ema1_prev <= ema2_prev && ema1 > ema2) {
                                crossUp = true;
                            } else if (ema1_prev >= ema2_prev && ema1 < ema2) {
                                crossDn = true;
                            }
                        }
                        
                        var plotUp = crossUp ? ema1 : NaN;
                        var plotDn = crossDn ? ema1 : NaN;
                        
                        return [
                            { value: ema1 },
                            { value: ema2 },
                            { value: ema3 },
                            { value: ema4 },
                            { value: ema5 },
                            { value: plotUp },
                            { value: plotDn }
                        ];
                    };
                }
            },
            {
                name: "SuperTrend Strategy (Trade Chains)",
                metainfo: {
                    _metainfoVersion: 52,
                    isTVScript: false,
                    is_hidden_study: false,
                    defaults: {
                        styles: {
                            plot_up: { plottype: 7, linewidth: 2, color: "#089981" },
                            plot_down: { plottype: 7, linewidth: 2, color: "#f23645" },
                            plot_buy_label: { plottype: "shape_label_up", location: "BelowBar", color: "#089981", textColor: "#ffffff", size: "auto" },
                            plot_sell_label: { plottype: "shape_label_down", location: "AboveBar", color: "#f23645", textColor: "#ffffff", size: "auto" }
                        },
                        inputs: {
                            in_period: 10,
                            in_multiplier: 3.0
                        }
                    },
                    plots: [
                        { id: "plot_up", type: "line" },
                        { id: "plot_down", type: "line" },
                        { id: "plot_buy_label", type: "shapes" },
                        { id: "plot_sell_label", type: "shapes" }
                    ],
                    styles: {
                        plot_up: { title: "Up Trend", histogramBase: 0, joinPoints: false },
                        plot_down: { title: "Down Trend", histogramBase: 0, joinPoints: false },
                        plot_buy_label: { title: "Buy Signal (Chain Entry)", isHidden: false, text: "Buy" },
                        plot_sell_label: { title: "Sell Signal (Chain Exit)", isHidden: false, text: "Sell" }
                    },
                    description: "SuperTrend Strategy (Trade Chains)",
                    shortDescription: "SuperTrend Strat",
                    is_price_study: true,
                    inputs: [
                        { id: "in_period", name: "ATR Period", defval: 10, type: "integer", min: 1 },
                        { id: "in_multiplier", name: "ATR Multiplier", defval: 3.0, type: "float", min: 0.1, step: 0.1 }
                    ],
                    id: "SuperTrend_Strategy@tv-basicstudies-1",
                    scriptIdPart: "",
                    name: "SuperTrend Strategy (Trade Chains)",
                    format: { precision: 2, type: "price" }
                },
                constructor: function () {
                    this.init = function(ctx, get_input) {
                        this._context = ctx;
                        this._input = get_input;
                        this._chainCounter = 1;
                    };

                    this.main = function (ctx, get_input) {
                        this._context = ctx || this._context;
                        this._input = get_input || this._input;
                        
                        var periods = this._input(0);
                        var multiplier = this._input(1);

                        var high = PineJS.Std.high(this._context);
                        var low = PineJS.Std.low(this._context);
                        var close = PineJS.Std.close(this._context);
                        var hl2 = (high + low) / 2.0;

                        var prev_close = this._context.new_var(close).get(1);
                        if (isNaN(prev_close)) prev_close = close;

                        var tr = Math.max(
                            high - low,
                            Math.abs(high - prev_close),
                            Math.abs(low - prev_close)
                        );

                        var trSeries = this._context.new_var(tr);
                        var atrVal = PineJS.Std.rma(trSeries, periods, this._context);

                        var upVal = hl2 - (multiplier * atrVal);
                        var dnVal = hl2 + (multiplier * atrVal);
                        
                        var final_upper = this._context.new_var();
                        var final_lower = this._context.new_var();
                        var trend = this._context.new_var();
                        
                        var prev_final_upper = final_upper.get(1);
                        var prev_final_lower = final_lower.get(1);
                        var prev_trend = trend.get(1);

                        if (isNaN(prev_final_upper)) prev_final_upper = upVal;
                        if (isNaN(prev_final_lower)) prev_final_lower = dnVal;
                        if (isNaN(prev_trend)) prev_trend = 1;

                        var curr_up = (prev_close > prev_final_upper) ? Math.max(upVal, prev_final_upper) : upVal;
                        var curr_dn = (prev_close < prev_final_lower) ? Math.min(dnVal, prev_final_lower) : dnVal;

                        final_upper.set(curr_up);
                        final_lower.set(curr_dn);

                        var curr_trend = prev_trend;
                        if (curr_trend === -1 && close > prev_final_lower) {
                            curr_trend = 1;
                        } else if (curr_trend === 1 && close < prev_final_upper) {
                            curr_trend = -1;
                        }
                        trend.set(curr_trend);

                        var buySignal = (curr_trend === 1 && prev_trend === -1);
                        var sellSignal = (curr_trend === -1 && prev_trend === 1);

                        if (!this._chainCounter) this._chainCounter = 1;

                        // Strategy Trade Chain Execution
                        if (this.strategy) {
                            if (buySignal) {
                                this.strategy.buy({
                                    id: this._chainCounter,
                                    price: close,
                                    qty: 1,
                                    tag: "SuperTrend Bullish Entry"
                                });
                            } else if (sellSignal) {
                                this.strategy.sell({
                                    id: this._chainCounter,
                                    price: close,
                                    qty: 1,
                                    isEnd: true,
                                    tag: "SuperTrend Bearish Exit"
                                });
                                this._chainCounter++;
                            }
                        }

                        var upPlot = curr_trend === 1 ? curr_up : NaN;
                        var dnPlot = curr_trend === 1 ? NaN : curr_dn;

                        var buyPlotVal = buySignal ? 1 : NaN;
                        var sellPlotVal = sellSignal ? 1 : NaN;

                        return [
                            { value: upPlot },
                            { value: dnPlot },
                            { value: buyPlotVal },
                            { value: sellPlotVal }
                        ];
                    };
                }
            }
        ];

        let localIndicators = [];
        try {
            const stored = (window.TVLocalStore ? window.TVLocalStore.getIndicators() : JSON.parse(localStorage.getItem('tv_local_indicators') || '{}'));
            let storageNeedsResave = false;

            for (let key in stored) {
                try {
                    let code = stored[key];
                    if (!code || typeof code !== 'string') continue;

                    const factory = new Function('PineJS', 'return (' + code + ');');
                    const indicatorObj = factory(PineJS);
                    if (indicatorObj && (indicatorObj.name || (indicatorObj.metainfo && indicatorObj.metainfo.description))) {
                        indicatorObj._sourceType = 'local';
                        indicatorObj._isLocal = true;

                        if (!indicatorObj.metainfo) indicatorObj.metainfo = {};

                        // 1. Ensure metainfo.description and indicatorObj.name match and are never empty
                        if (!indicatorObj.metainfo.description) {
                            indicatorObj.metainfo.description = indicatorObj.name || key;
                        }
                        if (!indicatorObj.name) {
                            indicatorObj.name = indicatorObj.metainfo.description || key;
                        }
                        if (!indicatorObj.metainfo.shortDescription) {
                            indicatorObj.metainfo.shortDescription = indicatorObj.metainfo.description;
                        }

                        // 2. Guarantee DETERMINISTIC, STABLE metainfo.id (CRITICAL: NEVER use Date.now() on reload!)
                        // If already defined, preserve it so active chart studies restore without "study not found" errors
                        if (!indicatorObj.metainfo.id) {
                            const clean = indicatorObj.name.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '');
                            const stableLocalId = `${clean || 'Custom_Study'}_Local@tv-basicstudies-1`;
                            indicatorObj.metainfo.id = stableLocalId;
                            if (window.injectStudyMetaId) {
                                code = window.injectStudyMetaId(code, stableLocalId);
                                stored[key] = code;
                                storageNeedsResave = true;
                            }
                        }

                        const isStrat = key.includes("Strategy") || (window.isStrategyScript && window.isStrategyScript(code));
                        indicatorObj.isStrategy = isStrat;
                        indicatorObj._isStrat = isStrat;
                        localIndicators.push(indicatorObj);
                    }
                } catch (e) {
                    console.error("Failed to parse local indicator:", key, e);
                }
            }

            if (storageNeedsResave && window.TVLocalStore) {
                try {
                    localStorage.setItem(window.TVLocalStore.PRIMARY_KEY, JSON.stringify(stored));
                    localStorage.setItem(window.TVLocalStore.BACKUP_KEY, JSON.stringify(stored));
                } catch (_) {}
            }
        } catch (e) {
            console.error("Failed to read tv_local_indicators", e);
        }

        let remoteIndicators = [];
        if (window.ScriptRepoManager && typeof window.ScriptRepoManager.getRemotePineJSIndicators === 'function') {
            try {
                remoteIndicators = window.ScriptRepoManager.getRemotePineJSIndicators(PineJS);
            } catch (e) {
                console.error("Failed to load remote indicators:", e);
            }
        }

        hardcodedIndicators.forEach(ind => {
            ind._sourceType = 'default';
            ind._isDefault = true;
            if (ind.name === "SuperTrend Strategy (Trade Chains)") {
                ind.isStrategy = true;
                ind._isStrat = true;
            } else {
                ind.isStrategy = false;
                ind._isStrat = false;
            }
        });

        const allList = [...hardcodedIndicators, ...localIndicators, ...remoteIndicators];
        
        // Wrap ONLY true strategies with StrategyEngine context (leave normal indicators untouched!)
        allList.forEach(ind => {
            if (!ind || !ind.constructor) return;
            const fnStr = ind.constructor.toString();
            const isStrat = ind.isStrategy === true ||
                            ind._isStrat === true ||
                            (ind.name && ind.name.toLowerCase().includes('strategy')) ||
                            (window.isStrategyScript && window.isStrategyScript(fnStr));

            if (!isStrat) {
                // NORMAL INDICATOR: Keep original constructor untouched! Do not register into StrategyEngine!
                return;
            }

            const origConstructor = ind.constructor;
            ind.constructor = function() {
                const instance = new origConstructor();
                if (window.StrategyEngine) {
                    const strategyContext = window.StrategyEngine.getOrCreateContext(ind.name);
                    strategyContext.indicatorMeta = ind.metainfo;
                    instance.strategy = strategyContext;
                    let barCount = 0;
                    
                    const origInit = instance.init;
                    instance.init = function(ctx, get_input) {
                        barCount = 0;
                        if (instance.strategy) instance.strategy.reset();
                        if (origInit) origInit.call(instance, ctx, get_input);
                    };

                    const origMain = instance.main;
                    instance.main = function(ctx, get_input) {
                        instance._context = ctx || instance._context;
                        if (instance.strategy) {
                            let time = 0, open = 0, high = 0, low = 0, close = 0, volume = 0;
                            try {
                                time = PineJS.Std.time(instance._context);
                                open = PineJS.Std.open(instance._context);
                                high = PineJS.Std.high(instance._context);
                                low = PineJS.Std.low(instance._context);
                                close = PineJS.Std.close(instance._context);
                                volume = PineJS.Std.volume(instance._context);
                            } catch(_) {}
                            instance.strategy.onBarStart(barCount++, { time, open, high, low, close, volume });
                        }
                        return origMain.call(instance, ctx, get_input);
                    };
                }
                return instance;
            };
        });

        // Backwards compatibility alias engine:
        // Automatically registers legacy names and IDs so charts with previously applied studies
        // run the updated constructor and calculations seamlessly without "study not found" errors.
        const LEGACY_STUDY_ALIASES = {
            "MA Ultimate MTF v2": [
                { name: "CM_Ultimate_MA_MTF_V2", id: "CM_Ultimate_MA_MTF_V2@tv-basicstudies-1" },
                { name: "CM_Ultimate_MA_MTF_V2", id: "CM_Ultimate_MA_MTF_V2_github_bunqi8_tradingview_indicators@tv-basicstudies-1" },
                { name: "UltimateMA", id: "UltimateMA@tv-basicstudies-1" }
            ]
        };

        const aliasList = [];
        allList.forEach(ind => {
            const aliases = LEGACY_STUDY_ALIASES[ind.name];
            if (aliases && Array.isArray(aliases)) {
                aliases.forEach(alias => {
                    const cloned = {
                        ...ind,
                        name: alias.name,
                        metainfo: {
                            ...ind.metainfo,
                            id: alias.id,
                            name: alias.name,
                            description: alias.name,
                            shortDescription: alias.name,
                            is_hidden_study: true
                        },
                        constructor: ind.constructor
                    };
                    aliasList.push(cloned);
                });
            }
        });

        allList.push(...aliasList);

        resolve(allList);
    });
};

