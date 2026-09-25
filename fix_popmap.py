import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

# Remove it from inside the try block
old_popmap_inside = "            const popMap = { 'NIFTY50':1, 'NIFTY':1, 'BANKNIFTY':2, 'SENSEX':3, 'FINNIFTY':4, 'BANKEX':5, 'MIDCPNIFTY':6, 'NIFTYNXT50':7, 'SX50':8 };\n            \n            // Default listing"
new_popmap_inside = "            // Default listing"
js = js.replace(old_popmap_inside, new_popmap_inside)

# Place it at the top of the file or at the top of searchSymbols
old_search_start = """    searchSymbols: async (userInput, exchange, symbolType, onResultReadyCallback) => {
        let query = userInput.toUpperCase();
        const results = [];"""

new_search_start = """    searchSymbols: async (userInput, exchange, symbolType, onResultReadyCallback) => {
        const popMap = { 'NIFTY50':1, 'NIFTY':1, 'BANKNIFTY':2, 'SENSEX':3, 'FINNIFTY':4, 'BANKEX':5, 'MIDCPNIFTY':6, 'NIFTYNXT50':7, 'SX50':8 };
        let query = userInput.toUpperCase();
        const results = [];"""

js = js.replace(old_search_start, new_search_start)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

