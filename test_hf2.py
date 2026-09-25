import urllib.request
import json
import re

url = "https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/NSE_NIFTY50_INDEX/option_data/parquet/NSE_NIFTY50_INDEX_20260922_130037"
req = urllib.request.Request(url)
with urllib.request.urlopen(req) as response:
    files = json.loads(response.read().decode())

symbols = set()
for f in files:
    filename = f['path'].split('/')[-1]
    # NIFTY2692221300CE_1_2026-06-14_to_2026-09-22.parquet
    match = re.match(r'([A-Z0-9-]+)_([0-9SDW]+)_', filename)
    if match:
        symbols.add(match.group(1))

print(f"Total unique symbols: {len(symbols)}")
print("Sample symbols:")
print(list(symbols)[:10])
