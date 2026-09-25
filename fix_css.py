import re

with open('public/options_chain.js', 'r') as f:
    js = f.read()

# Fix the padding so backgrounds go edge-to-edge
js = re.sub(r'\.oc-table-top-header \{.*?\}', '.oc-table-top-header { display: flex; padding: 12px 0 4px 0; font-size: 13px; font-weight: 600; color: #131722; }', js)
js = re.sub(r'\.oc-table-header \{.*?\}', '.oc-table-header { display: flex; padding: 4px 0 12px 0; border-bottom: 1px solid #e0e3eb; font-size: 12px; color: #787b86; }', js)
js = re.sub(r'\.oc-row \{.*?\}', '.oc-row { display: flex; padding: 0; border-bottom: 1px solid #f0f3fa; }', js)

# Fix the month label CSS to ensure it's visible
js = re.sub(r'\.oc-month-label \{.*?\}', '.oc-month-label { font-size: 12px; color: #131722; font-weight: 500; min-height: 14px; margin-bottom: 2px; }', js)

with open('public/options_chain.js', 'w') as f:
    f.write(js)

