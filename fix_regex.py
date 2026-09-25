import re

# Fix datafeed.js
with open('public/datafeed.js', 'r') as f:
    js = f.read()

js = js.replace(r'filename.match(/NIFTY\d+?(\d{5})([CP]E)_/)', r'filename.match(/NIFTY.+?(\d{5})([CP]E)_/)')

with open('public/datafeed.js', 'w') as f:
    f.write(js)

# Fix options_chain.js
with open('public/options_chain.js', 'r') as f:
    js2 = f.read()

js2 = js2.replace(r'filename.match(/NIFTY\d+?(\d{5})([CP]E)_/)', r'filename.match(/NIFTY.+?(\d{5})([CP]E)_/)')

old_auto_detect = """        const symbol = window.tvWidget.activeChart().symbol();
        const match = symbol.match(/NIFTY\d+?(\d{2})(\d{2})(\d{2})\d{5}[CP]E/);
        if (match) {
            let y = match[1];
            let m = match[2];
            let d = match[3];
            // Format to match dateStr (e.g. "20260915")
            let symDateStr = `20${y}${m}${d}`;"""

new_auto_detect = """        const symbol = window.tvWidget.activeChart().symbol();
        const match = symbol.match(/NIFTY(\d{2})([1-9OND])(\d{2})\d{5}[CP]E/);
        if (match) {
            let y = match[1];
            let mStr = match[2];
            let d = match[3];
            
            let m = mStr;
            if (mStr === 'O') m = '10';
            else if (mStr === 'N') m = '11';
            else if (mStr === 'D') m = '12';
            else m = mStr.padStart(2, '0');
            
            // Format to match dateStr (e.g. "20260915")
            let symDateStr = `20${y}${m}${d}`;"""

js2 = js2.replace(old_auto_detect, new_auto_detect)

with open('public/options_chain.js', 'w') as f:
    f.write(js2)

