import re

with open('public/cache.js', 'r') as f:
    js = f.read()

js = js.replace('const DB_VERSION = 4;', 'const DB_VERSION = 5;')
js = js.replace('if (e.oldVersion < 3 &&', 'if (e.oldVersion < 5 &&')

with open('public/cache.js', 'w') as f:
    f.write(js)

