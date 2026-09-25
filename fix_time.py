import re

with open('public/fyers_api.js', 'r') as f:
    code = f.read()

code = code.replace("time: (item.v.tt * 1000) || Date.now(),", "time: Date.now(),")

with open('public/fyers_api.js', 'w') as f:
    f.write(code)
