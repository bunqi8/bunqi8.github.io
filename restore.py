import re

with open("public/datafeed.js", "r") as f:
    lines = f.readlines()

out = []
skip = False
for line in lines:
    if "safeHistoryCallback(bars;" in line or "let safeBars = " in line or "onHistoryCallback, resolution);" in line:
        continue
    
    # We will just manually put back the onHistoryCallback for all of them
    
    if "DFLog.info('getBars', `Returning ${bars.length} bars to TV`);" in line:
        out.append(line)
        out.append("                safeHistoryCallback(bars, onHistoryCallback, resolution);\n")
        continue

    if "DFLog.info('getBars', `Returning ${latestBars.length} latest bars." in line:
        out.append(line)
        out.append("                    safeHistoryCallback(latestBars, onHistoryCallback, resolution);\n")
        continue
        
    if "DFLog.info('getBars', `Returning ${olderBars.length} older bars." in line:
        out.append(line)
        out.append("                    safeHistoryCallback(olderBars, onHistoryCallback, resolution);\n")
        continue
        
    if "DFLog.info('getBars', `Returning ${deepBars.length} deep history bars from Fyers API`);" in line:
        out.append(line)
        out.append("                        safeHistoryCallback(deepBars, onHistoryCallback, resolution);\n")
        continue

    out.append(line)

with open("public/datafeed.js", "w") as f:
    f.writelines(out)
