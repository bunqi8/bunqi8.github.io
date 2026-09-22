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
                            plot_ema1: { plottype: 0, linewidth: 1, color: "#000000" }, // Black
                            plot_ema2: { plottype: 0, linewidth: 1, color: "#4CAF50" }, // Green
                            plot_ema3: { plottype: 0, linewidth: 1, color: "#F44336" }, // Red
                            plot_ema4: { plottype: 0, linewidth: 1, color: "#FF9800" }, // Orange
                            plot_ema5: { plottype: 0, linewidth: 1, color: "#2196F3" }, // Blue
                            plot_cross_up: { plottype: 3, linewidth: 3, color: "#2962FF" }, // Blue Cross
                            plot_cross_dn: { plottype: 3, linewidth: 3, color: "#E040FB" }  // Magenta Cross
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
                        plot_ema1: { title: "EMA 1 (3)", isHidden: false },
                        plot_ema2: { title: "EMA 2 (30)", isHidden: false },
                        plot_ema3: { title: "EMA 3 (50)", isHidden: false },
                        plot_ema4: { title: "EMA 4 (100)", isHidden: false },
                        plot_ema5: { title: "EMA 5 (200)", isHidden: false },
                        plot_cross_up: { title: "Cross Up", isHidden: false },
                        plot_cross_dn: { title: "Cross Down", isHidden: false }
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
            }
        ];

        let localIndicators = [];
        try {
            const stored = JSON.parse(localStorage.getItem('tv_local_indicators') || '{}');
            for (let key in stored) {
                try {
                    const code = stored[key];
                    const factory = new Function('PineJS', 'return (' + code + ');');
                    const indicatorObj = factory(PineJS);
                    if (indicatorObj && indicatorObj.name) {
                        localIndicators.push(indicatorObj);
                    }
                } catch (e) {
                    console.error("Failed to parse local indicator:", key, e);
                }
            }
        } catch (e) {
            console.error("Failed to read tv_local_indicators", e);
        }

        resolve([...hardcodedIndicators, ...localIndicators]);
    });
};
