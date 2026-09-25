import re

with open('public/options_chain.js', 'r') as f:
    js = f.read()

old_btn = """        btnFutures.onclick = () => window.loadSymbol(futSymbol);"""
new_btn = """        btnFutures.onclick = () => {
            window.loadSymbol(futSymbol);
            window.closeOptionsChainModal();
        };"""
js = js.replace(old_btn, new_btn)

with open('public/options_chain.js', 'w') as f:
    f.write(js)

