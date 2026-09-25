import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

old_query = """    searchSymbols: async (userInput, exchange, symbolType, onResultReadyCallback) => {
        const query = userInput.toUpperCase();
        const results = [];
        
        try {"""

new_query = """    searchSymbols: async (userInput, exchange, symbolType, onResultReadyCallback) => {
        let query = userInput.toUpperCase();
        const results = [];
        
        try {
            // If the search box is pre-filled with the exact current chart symbol (which happens when clicking the top-left symbol button),
            // treat it as an empty search so we can display all available Base Indices for easy switching!
            try {
                const chartSym = window.tvWidget ? window.tvWidget.activeChart().symbol() : '';
                if (query === chartSym) {
                    query = '';
                }
            } catch(e) {}
"""

js = js.replace(old_query, new_query)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

