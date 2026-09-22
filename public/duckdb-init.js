import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.1-dev106.0/+esm';

async function initDuckDB() {
    console.log("Initializing DuckDB-WASM...");
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    
    // Select a bundle based on browser checks
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
    
    // Instantiate the worker
    const worker_url = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], {type: 'text/javascript'})
    );
    
    const worker = new Worker(worker_url);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(worker_url);
    
    console.log("DuckDB-WASM Initialized Successfully!");
    window.db = db;
    // Increase WASM memory limit to prevent out-of-bounds crashes on Parquet decoding
    const conn = await db.connect();
    await conn.query(`PRAGMA memory_limit='1GB'`);
    await conn.close();
    
    // Let TradingView know the DB is ready
    window.dispatchEvent(new Event('DuckDBReady'));
}

initDuckDB().catch(console.error);
