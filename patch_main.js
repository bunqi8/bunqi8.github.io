const fs = require('fs');
let code = fs.readFileSync('public/main.js', 'utf8');

// The file currently has:
// window.onload = function() {
// ...
// updateUrl();
//     });
// }
// window.onload = function() { ...

// Let's just fix it by replacing the whole window.onload block correctly.
code = code.replace(/window\.onload = function\(\) \{\n\s+\/\/ 1\. Initialize Charting Library Widget[\s\S]*\}\;/m, `function bootWidget() {
    // 1. Initialize Charting Library Widget
    const widgetOptions = {
        symbol: urlLayoutId ? undefined : urlSymbol,
        interval: urlLayoutId ? undefined : urlInterval,
        container: 'tv_chart_container',
        library_path: 'chart_engine/',
        datafeed: Datafeed,
        save_load_adapter: localSaveLoadAdapter,
        locale: 'en',
        load_last_chart: true, 
        autosize: true,
        theme: 'Light',
        timezone: 'Asia/Kolkata',
        enabled_features: [
            "use_localstorage_for_settings",
            "study_templates",
            "show_chart_property_page",
            "show_symbol_logos",
            "show_exchange_logos",
            "show_symbol_logo_in_legend"
        ],
        disabled_features: []
    };

    const widget = new TradingView.widget(widgetOptions);

    widget.chartReady().then(() => {
        console.log("[App] Chart is fully ready and fluid.");
        const charts = safeGet('charts');
        if (charts.length === 0) {
            widget.saveChartToServer({ chartName: 'Unnamed' });
        }

        widget.subscribe('onAutoSaveNeeded', () => {
            console.log("[App] Engine detected changes. Forcing auto-save...");
            widget.saveChartToServer();
        });

        const activeChart = widget.activeChart();
        const currentSymbol = activeChart.symbol();
        const currentInterval = activeChart.resolution();
        
        if (urlParams.has('symbol') && currentSymbol !== urlSymbol) {
            activeChart.setSymbol(urlSymbol, () => {});
        }
        if (urlParams.has('interval') && currentInterval !== urlInterval) {
            activeChart.setResolution(urlInterval, () => {});
        }

        const updateUrl = () => {
            const currentUrl = new URL(window.location.href);
            currentUrl.searchParams.set('symbol', activeChart.symbol());
            currentUrl.searchParams.set('interval', activeChart.resolution());
            window.history.replaceState({}, '', currentUrl);
        };

        activeChart.onSymbolChanged().subscribe(null, updateUrl);
        activeChart.onIntervalChanged().subscribe(null, updateUrl);
        updateUrl();
    });
}

window.onload = function() {
    if (window.db) {
        bootWidget();
    } else {
        console.log("Waiting for DuckDB-WASM...");
        window.addEventListener('DuckDBReady', bootWidget);
    }
};`);

fs.writeFileSync('public/main.js', code);
