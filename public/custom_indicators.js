window.getCustomIndicators = function(PineJS) {
    return Promise.resolve([
        {
            name: "SuperTrend Custom",
            metainfo: {
                _metainfoVersion: 52,
                isTVScript: false,
                isTVScriptStub: false,
                is_hidden_study: false,
                defaults: {
                    styles: {
                        plot_up: { linestyle: 0, linewidth: 1, plottype: 7, trackPrice: false, transparency: 0, visible: true, color: "#089981" },
                        plot_down: { linestyle: 0, linewidth: 1, plottype: 7, trackPrice: false, transparency: 0, visible: true, color: "#f23645" },
                        plot_mid: { linestyle: 0, linewidth: 1, plottype: 0, trackPrice: false, transparency: 0, visible: false, color: "#000000" },
                        plot_buy_circle: { plottype: "shape_circle", location: "Absolute", visible: true, color: "#089981", transparency: 0 },
                        plot_buy_label: { plottype: "shape_label_up", location: "Absolute", visible: true, color: "#089981", textColor: "#FFFFFF", transparency: 0 },
                        plot_sell_circle: { plottype: "shape_circle", location: "Absolute", visible: true, color: "#f23645", transparency: 0 },
                        plot_sell_label: { plottype: "shape_label_down", location: "Absolute", visible: true, color: "#f23645", textColor: "#FFFFFF", transparency: 0 }
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
        }
    ]);
};
