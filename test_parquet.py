import urllib.request
import pyarrow.parquet as pq

url = 'https://huggingface.co/datasets/deep776/fyers-market-data/resolve/main/NSE_NIFTY50_INDEX/option_data/parquet/NSE_NIFTY50_INDEX_20260922_130037/NIFTY50-INDEX_D_2026-06-14_to_2026-09-22.parquet'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req) as response, open('test.parquet', 'wb') as out_file:
        data = response.read()
        out_file.write(data)
    
    table = pq.read_table('test.parquet')
    print("Schema:")
    print(table.schema)
    
    print(f"\nTotal rows: {table.num_rows}")
    
    # Get first and last time
    time_col = table['time'].to_pylist()
    print(f"\nMin time: {min(time_col)}")
    print(f"Max time: {max(time_col)}")
except Exception as e:
    print(f"Error: {e}")
