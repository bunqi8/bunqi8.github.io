import re

with open('public/cache.js', 'r') as f:
    js = f.read()

old_trigger = """            } else {
                console.log("[SyncManager] Cache is completely up to date!");
            }
            
        } catch (e) {"""

new_trigger = """            } else {
                console.log("[SyncManager] Cache is completely up to date!");
            }
            
            // Fire background garbage collection 10 seconds after sync finishes so it doesn't block the UI
            setTimeout(() => {
                this.garbageCollectCache().catch(e => console.error("GC failed", e));
            }, 10000);
            
        } catch (e) {"""

js = js.replace(old_trigger, new_trigger)

with open('public/cache.js', 'w') as f:
    f.write(js)

