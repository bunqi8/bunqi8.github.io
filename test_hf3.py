import urllib.request
import json
url = "https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/NSE_NIFTY50_INDEX/option_data/parquet/NSE_NIFTY50_INDEX_20260906_051746"
req = urllib.request.Request(url)
with urllib.request.urlopen(req) as response:
    files = json.loads(response.read().decode())
print(len(files))
