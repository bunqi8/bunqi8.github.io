import urllib.request
import json
import re

url = "https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/NSE_NIFTY50_INDEX/option_data/parquet/NSE_NIFTY50_INDEX_20260922_130037"
req = urllib.request.Request(url)
with urllib.request.urlopen(req) as response:
    files = json.loads(response.read().decode())

expiries = set()
for f in files:
    filename = f['path'].split('/')[-1]
    match = re.match(r'NIFTY(\d{5})\d{5}[CP]E_', filename)
    if match:
        expiries.add(match.group(1))

print("Expiries in latest folder:", expiries)
