import re

with open('public/options_chain.js', 'r') as f:
    js = f.read()

js = js.replace('background-color: #fff9eb;', 'background-color: #fff4e6;')
js = js.replace('background-color: #f7f1e3;', 'background-color: #f0e6d2;')

with open('public/options_chain.js', 'w') as f:
    f.write(js)

