import re

with open('public/index.html', 'r') as f:
    html = f.read()

# Fix viewport
old_vp = '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
new_vp = '<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,minimum-scale=1.0,user-scalable=no,viewport-fit=cover">'
html = html.replace(old_vp, new_vp)

# Fix tv_chart_container height
old_css = '#tv_chart_container { width: 100%; height: 100vh; position: relative; }'
new_css = '#tv_chart_container { width: 100%; height: 100dvh; position: fixed; top: 0; left: 0; bottom: 0; right: 0; }'
html = html.replace(old_css, new_css)

with open('public/index.html', 'w') as f:
    f.write(html)

