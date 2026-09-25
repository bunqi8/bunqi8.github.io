import re

with open('public/options_chain.js', 'r') as f:
    js = f.read()

js = js.replace('parseInt(dateStr.slice(0,4))', 'parseInt(dateStr.slice(0,4), 10)')
js = js.replace('parseInt(dateStr.slice(4,6))', 'parseInt(dateStr.slice(4,6), 10)')
js = js.replace('parseInt(dateStr.slice(6,8))', 'parseInt(dateStr.slice(6,8), 10)')

with open('public/options_chain.js', 'w') as f:
    f.write(js)

