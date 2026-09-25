import urllib.request
with urllib.request.urlopen("https://huggingface.co/datasets/deep776/fyers-market-data/resolve/main/NSE_NIFTY50_INDEX/option_data/parquet/NSE_NIFTY50_INDEX_20260906_051746/NIFTY2690823900CE_5_2026-05-29_to_2026-09-06.parquet") as response:
    with open('test.parquet', 'wb') as f:
        f.write(response.read())

import pyarrow.parquet as pq
table = pq.read_table('test.parquet')
print("Schema:")
print(table.schema)
print("Row count:", table.num_rows)
if table.num_rows > 0:
    print("Min time:", table.column('time')[0].as_py())
    print("Max time:", table.column('time')[-1].as_py())
