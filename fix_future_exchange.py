import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

# Fix future exchange hardcoding
old_exch = """                                exchange: "NSE",
                                type: "futures\""""
new_exch = """                                exchange: (exp.baseTicker || "NSE_").split('_')[0],
                                type: "futures\""""
js = js.replace(old_exch, new_exch)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

