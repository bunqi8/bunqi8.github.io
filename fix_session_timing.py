import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

old_resolve = """    resolveSymbol: (symbolName, onSymbolResolvedCallback, onResolveErrorCallback) => {
        const symbolInfo = {
            name: symbolName,
            full_name: symbolName,
            description: symbolName,
            type: symbolName.includes('INDEX') ? 'index' : 'option',
            exchange: 'NSE',
            session: '24x7',"""

new_resolve = """    resolveSymbol: (symbolName, onSymbolResolvedCallback, onResolveErrorCallback) => {
        let exchange = 'NSE';
        let session = '0915-1530'; // Standard NSE/BSE trading hours
        
        if (symbolName.includes('SENSEX') || symbolName.includes('BANKEX')) {
            exchange = 'BSE';
        } else if (symbolName.includes('CRUDE') || symbolName.includes('GOLD') || symbolName.includes('SILVER') || symbolName.includes('NATURALGAS')) {
            exchange = 'MCX';
            session = '0900-2330'; // Standard MCX trading hours
        }

        const symbolInfo = {
            name: symbolName,
            full_name: symbolName,
            description: symbolName + ' (Historical Data - Approx. Timings)',
            type: symbolName.includes('INDEX') ? 'index' : (symbolName.includes('FUT') ? 'futures' : 'option'),
            exchange: exchange,
            session: session,"""

js = js.replace(old_resolve, new_resolve)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

