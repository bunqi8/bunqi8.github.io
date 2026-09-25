import urllib.request
import json

url = "https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/NSE_NIFTY50_INDEX/option_data/parquet"
req = urllib.request.Request(url)
with urllib.request.urlopen(req) as response:
    dirs = json.loads(response.read().decode())
    
print("Directories:")
for d in dirs:
    print(d['path'])

latest_dir = dirs[-1]['path']
print(f"\nFetching files from {latest_dir}...")
url2 = f"https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/{latest_dir}"
req2 = urllib.request.Request(url2)
with urllib.request.urlopen(req2) as response2:
    files = json.loads(response2.read().decode())

print(f"Total files: {len(files)}")
print("Sample files:")
for f in files[:10]:
    print(f['path'].split('/')[-1])
