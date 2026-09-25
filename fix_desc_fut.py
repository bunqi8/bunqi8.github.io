import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

old_desc = """                    if (filename.includes('FUT_')) {
                        const futSymbol = filename.split('_')[0];
                        if (futSymbol.includes(query) && !results.find(r => r.symbol === futSymbol)) {
                            const desc = `NIFTY Futures (${exp.day} ${exp.monthLabel} ${exp.year})`;
                            results.push({
                                symbol: futSymbol,
                                full_name: futSymbol,
                                description: desc,
                                exchange: "NSE",
                                type: "futures"
                            });
                        }
                    }"""

new_desc = """                    if (filename.includes('FUT_')) {
                        const futSymbol = filename.split('_')[0];
                        if (futSymbol.includes(query) && !results.find(r => r.symbol === futSymbol)) {
                            // Extract year and month from future ticker e.g. NIFTY26SEPFUT
                            let desc = `NIFTY Futures`;
                            const futMatch = futSymbol.match(/NIFTY(\\d{2})([A-Z]{3})FUT/);
                            if (futMatch) {
                                desc = `NIFTY Futures (${futMatch[2]} 20${futMatch[1]})`;
                            }
                            
                            results.push({
                                symbol: futSymbol,
                                full_name: futSymbol,
                                description: desc,
                                exchange: "NSE",
                                type: "futures"
                            });
                        }
                    }"""

js = js.replace(old_desc, new_desc)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

