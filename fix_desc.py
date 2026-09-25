import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

# Replace the search result for options
old_option_push = """                            results.push({
                                symbol: symbol,
                                full_name: symbol,
                                description: `NIFTY Option ${symbol}`,
                                exchange: "NSE",
                                type: "option"
                            });"""

new_option_push = """                            const strike = parseInt(match[1], 10);
                            const type = match[2];
                            const typeDesc = type === 'CE' ? 'CALL' : 'PUT';
                            const desc = `NIFTY ${strike} ${typeDesc} (${exp.day} ${exp.monthLabel} ${exp.year})`;
                            
                            results.push({
                                symbol: symbol,
                                full_name: symbol,
                                description: desc,
                                exchange: "NSE",
                                type: "option"
                            });"""

js = js.replace(old_option_push, new_option_push)

# And for futures
old_fut_push = """                            results.push({
                                symbol: futSymbol,
                                full_name: futSymbol,
                                description: `NIFTY Futures`,
                                exchange: "NSE",
                                type: "futures"
                            });"""

new_fut_push = """                            const desc = `NIFTY Futures (${exp.day} ${exp.monthLabel} ${exp.year})`;
                            results.push({
                                symbol: futSymbol,
                                full_name: futSymbol,
                                description: desc,
                                exchange: "NSE",
                                type: "futures"
                            });"""

js = js.replace(old_fut_push, new_fut_push)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

