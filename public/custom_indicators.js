window.getCustomIndicators = function(PineJS) {
    return Promise.resolve([
        {
            name: "Supertrend Custom",
            metainfo: {
                _metainfoVersion: 52,
                isTVScript: false,
                isTVScriptStub: false,
                is_hidden_study: false,
                defaults: {
                    styles: {
                        plot_up: { linestyle: 0, linewidth: 2, plottype: 0, trackPrice: false, transparency: 0, visible: true, color: "#089981" },
                        plot_down: { linestyle: 0, linewidth: 2, plottype: 0, trackPrice: false, transparency: 0, visible: true, color: "#f23645" },
                        plot_mid: { linestyle: 0, linewidth: 1, plottype: 0, trackPrice: false, transparency: 0, visible: false, color: "#000000" }
                    },
                    inputs: {
                        atrPeriod: 10,
                        factor: 3.0
                    },
                    filledAreasStyle: {
                        fill_up: { color: "#089981", transparency: 90, visible: true },
                        fill_down: { color: "#f23645", transparency: 90, visible: true }
                    }
                },
                plots: [
                    { id: "plot_up", type: "line" },
                    { id: "plot_down", type: "line" },
                    { id: "plot_mid", type: "line" }
                ],
                styles: {
                    plot_up: { title: "Up Trend", histogramBase: 0, joinPoints: false },
                    plot_down: { title: "Down Trend", histogramBase: 0, joinPoints: false },
                    plot_mid: { title: "Body Middle", isHidden: true, display: 0 } // completely hidden
                },
                description: "Supertrend Custom",
                shortDescription: "Supertrend",
                is_price_study: true, // overlays on price
                inputs: [
                    { id: "atrPeriod", name: "ATR Length", defval: 10, type: "integer", min: 1, max: 2000 },
                    { id: "factor", name: "Factor", defval: 3.0, type: "float", min: 0.01, step: 0.01, max: 100 }
                ],
                filledAreas: [
                    { id: "fill_up", objAId: "plot_up", objBId: "plot_mid", type: "plot_plot", title: "Uptrend background" },
                    { id: "fill_down", objAId: "plot_down", objBId: "plot_mid", type: "plot_plot", title: "Downtrend background" }
                ],
                id: "Supertrend_Custom@tv-basicstudies-1",
                scriptIdPart: "",
                name: "Supertrend Custom",
                format: { precision: 2, type: "price" },
            },
            constructor: function () {
                this.main = function (ctx, get_input) {
                    this._context = ctx;
                    this._input = get_input;

                    var atrPeriod = this._input(0);
                    var factor = this._input(1);

                    var high = PineJS.Std.high(ctx);
                    var low = PineJS.Std.low(ctx);
                    var close = PineJS.Std.close(ctx);
                    var open = PineJS.Std.open(ctx);

                    var hl2 = (high + low) / 2.0;
                    var tr = PineJS.Std.tr(ctx);
                    var trSeries = ctx.new_var(tr);
                    var atr = PineJS.Std.rma(trSeries, atrPeriod, ctx);

                    var basic_upper = hl2 + (factor * atr);
                    var basic_lower = hl2 - (factor * atr);

                    var final_upper = ctx.new_var();
                    var final_lower = ctx.new_var();
                    var trend = ctx.new_var(); // 1 for UP, -1 for DOWN
                    var supertrend = ctx.new_var();

                    var prev_final_upper = final_upper.get(1);
                    var prev_final_lower = final_lower.get(1);
                    var prev_close = ctx.new_var(close).get(1);
                    var prev_trend = trend.get(1);

                    if (isNaN(prev_final_upper)) prev_final_upper = 0;
                    if (isNaN(prev_final_lower)) prev_final_lower = 0;
                    if (isNaN(prev_trend)) prev_trend = 1;

                    // Final Upper
                    var curr_final_upper = basic_upper;
                    if (!isNaN(prev_final_upper) && !isNaN(prev_close) && basic_upper >= prev_final_upper) {
                        if (prev_close <= prev_final_upper) {
                            curr_final_upper = prev_final_upper;
                        }
                    }
                    final_upper.set(curr_final_upper);

                    // Final Lower
                    var curr_final_lower = basic_lower;
                    if (!isNaN(prev_final_lower) && !isNaN(prev_close) && basic_lower <= prev_final_lower) {
                        if (prev_close >= prev_final_lower) {
                            curr_final_lower = prev_final_lower;
                        }
                    }
                    final_lower.set(curr_final_lower);

                    // Trend
                    var curr_trend = prev_trend;
                    if (isNaN(atr)) {
                        curr_trend = 1;
                    } else {
                        if (curr_trend === 1 && close < curr_final_lower) {
                            curr_trend = -1;
                        } else if (curr_trend === -1 && close > curr_final_upper) {
                            curr_trend = 1;
                        }
                    }
                    trend.set(curr_trend);

                    // Supertrend Line
                    var curr_st = (curr_trend === 1) ? curr_final_lower : curr_final_upper;
                    supertrend.set(curr_st);

                    var upTrendVal = curr_trend === 1 ? curr_st : NaN;
                    var downTrendVal = curr_trend === -1 ? curr_st : NaN;
                    
                    var midVal = (open + close) / 2.0;

                    return [{ value: upTrendVal }, { value: downTrendVal }, { value: midVal }];
                };
            }
        }
    ]);
}
