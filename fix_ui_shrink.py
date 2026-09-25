import re

with open('public/options_chain.js', 'r') as f:
    js = f.read()

# Fix oc-header
js = js.replace(".oc-header { padding: 16px 24px;", ".oc-header { flex-shrink: 0; padding: 16px 24px;")

# Fix oc-base-strip
js = js.replace(".oc-base-strip { display: flex;", ".oc-base-strip { flex-shrink: 0; display: flex;")

# Fix oc-expiries-strip
js = js.replace(".oc-expiries-strip { display: flex;", ".oc-expiries-strip { flex-shrink: 0; display: flex;")

# Fix oc-table-top-header
js = js.replace(".oc-table-top-header { display: flex;", ".oc-table-top-header { flex-shrink: 0; display: flex;")

# Fix oc-table-header
js = js.replace(".oc-table-header { display: flex;", ".oc-table-header { flex-shrink: 0; display: flex;")

with open('public/options_chain.js', 'w') as f:
    f.write(js)

