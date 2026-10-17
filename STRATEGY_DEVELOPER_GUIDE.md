# Strategy & Backtesting Development Guide for TradingView Advanced Charts

This guide provides the complete specification and architecture instructions for creating **Strategies with Trade Chains** in this trading platform. Any AI assistant or developer building custom strategies must follow this document to ensure 100% compatibility with the chart engine, PineJS runtime, Strategy Tester UI, and on-chart trade markers.

---

## 1. System Architecture: Indicator vs. Strategy

In this platform, all custom scripts are written in JavaScript conforming to the TradingView PineJS structure. However, there is a fundamental distinction:

| Feature | Standard Indicator | Backtesting Strategy |
| :--- | :--- | :--- |
| **Primary Goal** | Plot lines, histograms, bands, or signal dots on the chart | Execute simulated trades, compute PnL, drawdowns, win rates, and display the Strategy Tester bottom panel |
| **Detection** | Regular script without strategy calls | Automatically detected when the script contains `this.strategy.buy` and `this.strategy.sell` (`window.isStrategyScript(code)`) |
| **Engine Injection** | None | The constructor is automatically wrapped; an active `StrategyContext` is injected into `this.strategy` |
| **Chart Markers** | Limited to static PineJS shape plots | Dynamic locked execution arrows showing `B: <id> @ <price> Q: <qty>` (green) and `S: <id> @ <price> Q: <qty>` (red) positioned cleanly outside the candles |
| **Lifecycle** | Recomputed on bar updates | Automatically executes backtests, compounding equity, and pairs orders into **Trade Chains** |

---

## 2. What is a "Trade Chain"?

A **Trade Chain** is a complete trading sequence identified by a shared `chainId` (typically tracked using `this._chainCounter`).

### Why Trade Chains?
Traditional backtesting engines only support simple 1-buy-1-sell models. Trade Chains allow:
1. **Single-Leg Swings**: Enter on signal, exit when opposite signal occurs.
2. **Averaging Down / DCA**: Multiple `buy` calls sharing the same `id` (e.g. buying 1 unit at 25000, 1 unit at 24800, 1 unit at 24600).
3. **Pyramiding / Scaling In**: Adding to winning positions as trend develops under the same `id`.
4. **Partial Exits**: Selling a portion of the accumulated quantity (`qty: 1`) while keeping the chain open (`isEnd: false`).
5. **Full Chain Termination**: Closing the chain (`isEnd: true`) which calculates the combined net PnL, duration in bars, and returns.

### Sequential vs. Concurrent Trade Chains
* **Sequential (Default)**: Chain $N$ must be closed (`isEnd: true`) before Chain $N+1$ begins.
* **Concurrent**: Multiple independent trade chains can run simultaneously if different `id`s are active.

---

## 3. The `this.strategy` API Reference

When a strategy is instantiated, `this.strategy` is provided automatically.

### `this.strategy.buy(order)`
Emits a BUY order.
```javascript
this.strategy.buy({
    id: this._chainCounter,  // Required: Trade Chain ID (number or string)
    price: close,            // Optional: Execution price (defaults to current bar close)
    qty: 1,                  // Optional: Quantity (defaults to 1)
    isEnd: false,            // Optional: Set true if this buy closes a short chain
    tag: "Bullish Breakout"  // Optional: Descriptive order tag
});
```

### `this.strategy.sell(order)`
Emits a SELL order.
```javascript
this.strategy.sell({
    id: this._chainCounter,  // Required: Trade Chain ID (number or string)
    price: close,            // Optional: Execution price (defaults to current bar close)
    qty: 1,                  // Optional: Quantity (defaults to 1)
    isEnd: true,             // IMPORTANT: Set true when this sell completely closes the chain!
    tag: "Target Hit"        // Optional: Descriptive order tag
});
```

### `this.strategy.close(order)`
Convenience wrapper that calls `this.strategy.sell({ ...order, isEnd: true })`.

---

## 4. How On-Chart Trade Labels & Markers Work

On each trade execution, the platform renders locked execution shapes directly on the TradingView chart using `chart.createShape`:

1. **Label Text Format**:
   * BUY: `B: <id> @ <price> Q: <qty>` (e.g., `B: 1 @ 25000 Q: 1`) in green `#089981`.
   * SELL: `S: <id> @ <price> Q: <qty>` (e.g., `S: 1 @ 25200 Q: 1`) in red `#f23645`.

2. **Placement Rules & Native TradingView Techniques**:
   * **Exact Coordinate Projection via PriceScale**:
     * Rather than using arbitrary price multipliers or guessing price margins, the engine projects exact screen pixels using TradingView's native `priceScale.priceToCoordinate()` and `priceScale.coordinateToPrice()`.
     * Exact candle highs and lows are pulled directly from TradingView's `mainSeries.data()` cache (`bar[2]` for high, `bar[3]` for low).
   * **BUY Arrow**:
     * Must be placed **below** the candle's lowest wick (`low`).
     * If the indicator defines a PineJS `Buy` shape pill, the engine detects this from `indicatorMeta` and places the arrow tip **30px below the wick (cleanly beneath the 24px Buy pill)**.
     * If no PineJS `Buy` pill exists, the arrow tip sits **6px directly below the low wick**.
     * Arrow direction points **UP** towards the candle/signal. The label text (`B: <id> @ <price> Q: <qty>`) hangs downward in open space below the chart.
   * **SELL Arrow**:
     * Must be placed **above** the candle's highest wick (`high`).
     * If the indicator defines a PineJS `Sell` shape pill, the arrow tip is placed **30px above the wick (cleanly above the 24px Sell pill)**.
     * If no PineJS `Sell` pill exists, the arrow tip sits **6px directly above the high wick**.
     * Arrow direction points **DOWN** towards the candle/signal. The label text (`S: <id> @ <price> Q: <qty>`) sits upward in open space above the chart.
   * **Multiple Trades on the Same Bar**:
     * When scaling in, pyramiding, or averaging on the same bar, subsequent trades are stacked vertically with a native 24px step (`tradeIdx * 24`), preventing label collisions.
   * **Automatic Lifecycle**:
     * Trade markers are locked (`lock: true`, `disableSelection: true`, `disableSave: true`, `disableUndo: true`) so they behave strictly as native chart graphics.
     * When the strategy recalculates, timeframes change, or the strategy is removed from the chart, all old markers are cleaned up automatically.

---

## 5. Complete Strategy Template

Below is the standard, production-ready strategy template:

```javascript
{
    name: "EMA Crossover Strategy (Trade Chains)",
    metainfo: {
        _metainfoVersion: 52,
        isTVScript: false,
        is_hidden_study: false,
        defaults: {
            styles: {
                plot_fast: { plottype: 0, linewidth: 2, color: "#2962FF" },
                plot_slow: { plottype: 0, linewidth: 2, color: "#FF9800" },
                plot_buy:  { plottype: "shape_label_up", location: "BelowBar", color: "#089981", textColor: "#ffffff", size: "auto" },
                plot_sell: { plottype: "shape_label_down", location: "AboveBar", color: "#f23645", textColor: "#ffffff", size: "auto" }
            },
            inputs: {
                fastLen: 9,
                slowLen: 21
            }
        },
        plots: [
            { id: "plot_fast", type: "line" },
            { id: "plot_slow", type: "line" },
            { id: "plot_buy",  type: "shapes" },
            { id: "plot_sell", type: "shapes" }
        ],
        styles: {
            plot_fast: { title: "Fast EMA", isHidden: false },
            plot_slow: { title: "Slow EMA", isHidden: false },
            plot_buy:  { title: "Buy Signal", isHidden: false, text: "Buy" },
            plot_sell: { title: "Sell Signal", isHidden: false, text: "Sell" }
        },
        description: "EMA Crossover Strategy (Trade Chains)",
        shortDescription: "EMA Strat",
        is_price_study: true,
        inputs: [
            { id: "fastLen", name: "Fast EMA Period", defval: 9, type: "integer", min: 1 },
            { id: "slowLen", name: "Slow EMA Period", defval: 21, type: "integer", min: 1 }
        ],
        id: "EMA_Crossover_Strategy@tv-basicstudies-1",
        scriptIdPart: "",
        name: "EMA Crossover Strategy (Trade Chains)",
        format: { type: "price", precision: 2 }
    },
    constructor: function () {
        this.init = function(ctx, get_input) {
            this._context = ctx;
            this._input = get_input;
            this._chainCounter = 1;
            this._inTrade = false;
        };

        this.main = function(ctx, get_input) {
            this._context = ctx || this._context;
            this._input = get_input || this._input;

            var fastLen = this._input(0);
            var slowLen = this._input(1);

            var close = PineJS.Std.close(this._context);
            var closeSeries = this._context.new_var(close);

            var fastEMA = PineJS.Std.ema(closeSeries, fastLen, this._context);
            var slowEMA = PineJS.Std.ema(closeSeries, slowLen, this._context);

            var fastSeries = this._context.new_var(fastEMA);
            var slowSeries = this._context.new_var(slowEMA);

            var fastPrev = fastSeries.get(1);
            var slowPrev = slowSeries.get(1);

            var buySignal = (fastPrev <= slowPrev && fastEMA > slowEMA);
            var sellSignal = (fastPrev >= slowPrev && fastEMA < slowEMA);

            if (!this._chainCounter) this._chainCounter = 1;

            // Strategy Execution Logic
            if (this.strategy) {
                if (buySignal && !this._inTrade) {
                    // Open Trade Chain
                    this.strategy.buy({
                        id: this._chainCounter,
                        price: close,
                        qty: 1,
                        tag: "Golden Cross Entry"
                    });
                    this._inTrade = true;
                } else if (sellSignal && this._inTrade) {
                    // Close Trade Chain
                    this.strategy.sell({
                        id: this._chainCounter,
                        price: close,
                        qty: 1,
                        isEnd: true,
                        tag: "Death Cross Exit"
                    });
                    this._inTrade = false;
                    this._chainCounter++; // Increment ID for next chain
                }
            }

            return [
                { value: fastEMA },
                { value: slowEMA },
                { value: buySignal ? 1 : NaN },
                { value: sellSignal ? 1 : NaN }
            ];
        };
    }
}
```

---

## 6. Multi-Leg / DCA Averaging Strategy Example

For strategies that scale in or average down before exiting:

```javascript
// Opening leg 1
this.strategy.buy({ id: this._chainCounter, price: close, qty: 1, tag: "Initial Entry" });

// Adding leg 2 (Averaging down if price drops 1%)
if (close < entryPrice * 0.99 && legCount < 2) {
    this.strategy.buy({ id: this._chainCounter, price: close, qty: 1, tag: "DCA Dip Buy" });
}

// Full Exit on target hit or trend reversal
if (close >= targetPrice) {
    this.strategy.sell({
        id: this._chainCounter,
        price: close,
        qty: totalAccumulatedQty, // Closes all accumulated units
        isEnd: true,              // Marks the chain as ended!
        tag: "Target Achieved"
    });
    this._chainCounter++;         // Ready for next chain!
}
```

---

## 7. Rules and Common Mistakes Checklist

When generating or editing strategies, make sure you never violate these rules:

1. **Include Both `buy` and `sell` Operations**:
   The validator (`isStrategyScript`) will reject any script as a strategy if it does not contain both `this.strategy.buy` and `this.strategy.sell`.
2. **Always Mark `isEnd: true` on Closing Orders**:
   If `isEnd: true` is omitted, the engine considers the chain still OPEN. Unclosed chains will not appear in the "Trade Chains" table or Win Rate calculations until finalized.
3. **Increment `this._chainCounter` After Exiting**:
   Always do `this._chainCounter++` after `isEnd: true` so the subsequent trade begins a fresh chain with a unique ID.
4. **Guard Against Every-Bar Execution**:
   Always use a state boolean (`this._inTrade = true/false`) or condition checks so you don't fire buy orders on 50 consecutive bars unless intentional averaging is desired.
5. **Shape Styles `text` Property**:
   In `metainfo.styles`, shape plots must provide `text: "Buy"` or `text: "Sell"`. In `main()`, return `{ value: buySignal ? 1 : NaN }` when `location: "BelowBar"` / `"AboveBar"`.
6. **Automatic Cleanup**:
   When removing a strategy from the chart, TradingView notifies `StrategyTesterUI`, which completely hides the bottom panel and removes all chart execution arrows automatically.
