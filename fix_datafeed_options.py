import re

with open('public/datafeed.js', 'r') as f:
    js = f.read()

# Fix the regex
js = js.replace("const match = filename.match(/NIFTY.+?(\\d{5})([CP]E)_/);", "const match = filename.match(/[A-Z]+.+?(\\d{5})([CP]E)_/);")

# Fix the description building
old_desc = "const desc = `NIFTY ${strike} ${typeDesc} (${exp.day} ${exp.monthLabel} ${exp.year})`;"
new_desc = """const baseName = symbol.replace(/\\d.*/, '');
                            const desc = `${baseName} ${strike} ${typeDesc} (${exp.day} ${exp.monthLabel} ${exp.year})`;"""
js = js.replace(old_desc, new_desc)

# Fix exchange hardcoding
old_exch = "exchange: \"NSE\","
new_exch = "exchange: (exp.baseTicker || \"NSE_\").split('_')[0],"
js = js.replace(old_exch, new_exch)

with open('public/datafeed.js', 'w') as f:
    f.write(js)

