import re

with open('public/cache.js', 'r') as f:
    js = f.read()

# Bump DB version
js = js.replace('const DB_VERSION = 2;', 'const DB_VERSION = 3;')

# Fix the upgrade condition to clear out previous data (since oldVersion < 3)
js = js.replace('if (e.oldVersion < 2 && db.objectStoreNames.contains(\'expiries\')) {', 'if (e.oldVersion < 3 && db.objectStoreNames.contains(\'expiries\')) {')

with open('public/cache.js', 'w') as f:
    f.write(js)

