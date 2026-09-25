import re

with open('public/options_chain.js', 'r') as f:
    js = f.read()

# Change align-items to center to avoid any bottom-alignment collapsing bugs
js = re.sub(r'align-items: flex-end;', 'align-items: center;', js)

with open('public/options_chain.js', 'w') as f:
    f.write(js)

