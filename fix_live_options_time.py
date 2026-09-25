import re

with open('public/datafeed.js', 'r') as f:
    code = f.read()

live_options_old = """
        // Pure Fyers API call for Live Options
        if (symbolInfo.isLive && window.FyersAPI) {
            const fyersBars = await window.FyersAPI.getHistory(symbolInfo.name, resolution, rawFrom, rawTo);
            if (fyersBars.length > 0) {
"""

live_options_new = """
        // Pure Fyers API call for Live Options
        if (symbolInfo.isLive && window.FyersAPI) {
            let fyersBars = await window.FyersAPI.getHistory(symbolInfo.name, resolution, rawFrom, rawTo);
            fyersBars = alignFyersDwmTime(fyersBars, resolution);
            if (fyersBars.length > 0) {
"""

code = code.replace(live_options_old.strip('\n'), live_options_new.strip('\n'))

with open('public/datafeed.js', 'w') as f:
    f.write(code)
