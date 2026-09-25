import requests

url = 'https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/BSE_SENSEX_INDEX/option_data/parquet/BSE_SENSEX_INDEX_20260917_112035'
all_files = []

while url:
    print("Fetching:", url)
    res = requests.get(url)
    all_files.extend(res.json())
    
    link = res.headers.get('link')
    print("Link:", link)
    url = None
    if link and 'rel="next"' in link:
        for part in link.split(','):
            if 'rel="next"' in part:
                import re
                match = re.search(r'<([^>]+)>', part)
                if match:
                    url = match.group(1)

print("Total files:", len(all_files))
print("Has FUT:", any('FUT' in f['path'] for f in all_files))
