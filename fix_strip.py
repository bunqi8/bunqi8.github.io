import re

with open('public/options_chain.js', 'r') as f:
    js = f.read()

# Add min-height to the strip so the month label isn't cropped
js = re.sub(r'\.oc-expiries-strip \{.*?\}', '.oc-expiries-strip { display: flex; overflow-x: auto; padding: 16px 24px; border-bottom: 1px solid #e0e3eb; align-items: flex-end; gap: 16px; min-height: 60px; }', js)

with open('public/options_chain.js', 'w') as f:
    f.write(js)

