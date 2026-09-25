import re

with open('public/cache.js', 'r') as f:
    js = f.read()

old_loop = """            for (let baseTicker of baseTickers) {
                try {
                    const exRes = await fetch(`${ROOT_URL}/${baseTicker}/option_data/parquet`);
                    if (!exRes.ok) continue;
                    const exData = await exRes.json();
                    
                    for (let item of exData) {
                        if (item.type === 'directory') {
                            const folderName = item.path.split('/').pop();
                            const match = folderName.match(/_(\d{8})_(\d{6})$/);
                            if (match) {
                                const dateStr = match[1];
                                const timeStr = match[2];
                                const id = `${baseTicker}_${dateStr}`;
                                if (!this.latestFolders[id] || timeStr > this.latestFolders[id].timeStr) {
                                    this.latestFolders[id] = {
                                        id, baseTicker, dateStr, timeStr, folderPath: item.path
                                    };
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error("Failed to fetch expiries for", baseTicker, e);
                }
            }"""

new_loop = """            await Promise.all(baseTickers.map(async (baseTicker) => {
                try {
                    const exRes = await fetch(`${ROOT_URL}/${baseTicker}/option_data/parquet`);
                    if (!exRes.ok) return;
                    const exData = await exRes.json();
                    
                    for (let item of exData) {
                        if (item.type === 'directory') {
                            const folderName = item.path.split('/').pop();
                            const match = folderName.match(/_(\d{8})_(\d{6})$/);
                            if (match) {
                                const dateStr = match[1];
                                const timeStr = match[2];
                                const id = `${baseTicker}_${dateStr}`;
                                if (!this.latestFolders[id] || timeStr > this.latestFolders[id].timeStr) {
                                    this.latestFolders[id] = {
                                        id, baseTicker, dateStr, timeStr, folderPath: item.path
                                    };
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error("Failed to fetch expiries for", baseTicker, e);
                }
            }));"""

js = js.replace(old_loop, new_loop)

with open('public/cache.js', 'w') as f:
    f.write(js)

