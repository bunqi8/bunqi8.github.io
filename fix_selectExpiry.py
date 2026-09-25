import re

with open('public/options_chain.js', 'r') as f:
    js = f.read()

# Fix index file matching
old_idx = "if (filename.includes('NIFTY50-INDEX_D_') || filename.includes('NIFTY50-INDEX_1_')) {"
new_idx = "if (filename.includes('-INDEX_D_') || filename.includes('-INDEX_1_')) {"
js = js.replace(old_idx, new_idx)

# Fix option symbol matching (SENSEX vs NIFTY)
old_regex = "const match = filename.match(/NIFTY.+?(\\d{5})([CP]E)_/);"
new_regex = "const match = filename.match(/[A-Z]+.+?(\\d{5})([CP]E)_/);"
js = js.replace(old_regex, new_regex)

with open('public/options_chain.js', 'w') as f:
    f.write(js)

