import re

with open('public/fyers_api.js', 'r') as f:
    code = f.read()

code = code.replace("if (symbols.length === 0) return;", "if (symbols.length === 0) { clearInterval(this.pollInterval); this.pollInterval = null; return; }")

with open('public/fyers_api.js', 'w') as f:
    f.write(code)
