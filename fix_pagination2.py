import re

with open('public/cache.js', 'r') as f:
    js = f.read()

old_fetch = """            const res = await fetch(`https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/${remote.folderPath}`);
            const files = await res.json();"""

new_fetch = """            let currentUrl = `https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/${remote.folderPath}`;
            let allFiles = [];
            while (currentUrl) {
                const res = await fetch(currentUrl);
                if (!res.ok) break;
                const chunk = await res.json();
                allFiles = allFiles.concat(chunk);
                
                const linkHeader = res.headers.get('link');
                if (linkHeader && linkHeader.includes('rel="next"')) {
                    const match = linkHeader.match(/<([^>]+)>;\\s*rel="next"/);
                    if (match) {
                        currentUrl = match[1];
                    } else {
                        currentUrl = null;
                    }
                } else {
                    currentUrl = null;
                }
            }
            const files = allFiles;"""

js = js.replace(old_fetch, new_fetch)

with open('public/cache.js', 'w') as f:
    f.write(js)

