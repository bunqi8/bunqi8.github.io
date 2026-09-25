import asyncio
import websockets

async def test_ws(url):
    try:
        async with websockets.connect(url) as ws:
            print(f"Connected to {url}")
            return True
    except Exception as e:
        print(f"Failed {url}: {e}")
        return False

async def main():
    await test_ws('wss://api-t1.fyers.in/data/quotes')
    await test_ws('wss://api.fyers.in/socket/v2/data/')
    await test_ws('wss://api-t1.fyers.in/socket/v2/data/')
    
asyncio.run(main())
