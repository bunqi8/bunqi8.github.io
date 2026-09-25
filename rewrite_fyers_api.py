import re

with open('public/fyers_api.js', 'r') as f:
    code = f.read()

# Replace connectWebSocket and related WS methods
ws_code = """
    connectWebSocket() {
        if (!this.token) return;
        this.isConnected = true; // Assume true since token exists, profile is checked separately
        
        if (this.pollInterval) clearInterval(this.pollInterval);
        
        this.pollInterval = setInterval(async () => {
            const symbols = Array.from(this.subscribers.keys());
            if (symbols.length === 0) return;
            
            try {
                // Chunk into arrays of 50
                for (let i = 0; i < symbols.length; i += 50) {
                    const chunk = symbols.slice(i, i + 50);
                    const qUrl = `https://api-t1.fyers.in/data/quotes?symbols=${chunk.join(',')}`;
                    const res = await fetch(qUrl, {
                        headers: { 'Authorization': this.token }
                    });
                    const data = await res.json();
                    
                    if (data.s === 'ok' && data.d) {
                        data.d.forEach(item => {
                            if (item.s === 'ok' && item.v) {
                                const subs = this.subscribers.get(item.n);
                                if (subs) {
                                    const tick = {
                                        time: (item.v.tt * 1000) || Date.now(),
                                        open: item.v.o || item.v.lp,
                                        high: item.v.h || item.v.lp,
                                        low: item.v.l || item.v.lp,
                                        close: item.v.lp,
                                        volume: item.v.vol || 0
                                    };
                                    subs.forEach(cb => cb(tick));
                                }
                            }
                        });
                    }
                }
            } catch (err) {
                console.error("Fyers Polling Error", err);
            }
        }, 1000);
    }
    
    _handleWsMessage(msg) { }
    _sendWsCommand(command, symbols) { }
"""

code = re.sub(r'    connectWebSocket\(\) \{.*    subscribe\(symbol, callback\) \{', ws_code + '\n    subscribe(symbol, callback) {', code, flags=re.DOTALL)

with open('public/fyers_api.js', 'w') as f:
    f.write(code)
