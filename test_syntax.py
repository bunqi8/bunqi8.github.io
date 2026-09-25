import urllib.request
with open('public/options_chain.js', 'r') as f:
    text = f.read()
if '\\`' in text or '\\${' in text:
    print("WARNING: Found escaped template literals!")
else:
    print("Syntax looks clean!")
