import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

# Delete hardcoded NIFTY50-INDEX search injection
old_hardcode = """        if ("NIFTY50-INDEX".includes(query)) {
            results.push({ symbol: "NIFTY50-INDEX", full_name: "NIFTY50-INDEX", description: "Nifty 50 Index", exchange: "NSE", type: "index" });
        }"""
js = js.replace(old_hardcode, "")

# Fix Future descriptions
old_fut_desc = """                            // Extract year and month from future ticker e.g. NIFTY26SEPFUT
                            let desc = `NIFTY Futures`;
                            const futMatch = futSymbol.match(/NIFTY(\\d{2})([A-Z]{3})FUT/);
                            if (futMatch) {
                                desc = `NIFTY Futures (${futMatch[2]} 20${futMatch[1]})`;
                            }"""
new_fut_desc = """                            const baseName = futSymbol.replace(/\\d{2}[A-Z]{3}FUT/, '');
                            let desc = `${baseName} Futures`;
                            const futMatch = futSymbol.match(/[A-Z]+(\\d{2})([A-Z]{3})FUT/);
                            if (futMatch) {
                                desc = `${baseName} Futures (${futMatch[2]} 20${futMatch[1]})`;
                            }"""
js = js.replace(old_fut_desc, new_fut_desc)

# Fix Option descriptions
old_opt_desc = """                    const match = filename.match(/NIFTY.+?(\\d{5})([CP]E)_/);
                    if (match) {
                        const strike = match[1];
                        const type = match[2];
                        const optSymbol = filename.split('_')[0];
                        
                        if (optSymbol.includes(query) && !results.find(r => r.symbol === optSymbol)) {
                            const typeDesc = type === 'CE' ? 'CALL' : 'PUT';
                            const desc = `NIFTY ${strike} ${typeDesc} (${exp.day} ${exp.monthLabel} ${exp.year})`;"""

new_opt_desc = """                    const match = filename.match(/[A-Z]+.+?(\\d{5})([CP]E)_/);
                    if (match) {
                        const strike = match[1];
                        const type = match[2];
                        const optSymbol = filename.split('_')[0];
                        
                        if (optSymbol.includes(query) && !results.find(r => r.symbol === optSymbol)) {
                            const typeDesc = type === 'CE' ? 'CALL' : 'PUT';
                            const baseName = optSymbol.replace(/\\d.*/, '');
                            const desc = `${baseName} ${strike} ${typeDesc} (${exp.day} ${exp.monthLabel} ${exp.year})`;"""
js = js.replace(old_opt_desc, new_opt_desc)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

