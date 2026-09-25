import re

with open('public/fyers_api.js', 'r') as f:
    code = f.read()

# Replace connectWebSocket implementation
poll_logic = """
    connectWebSocket() {
        if (!this.token) return;
        this.isConnected = true; 
        
        if (this.isPolling) return;
        this.isPolling = true;
        
        const poll = async () => {
            const symbols = Array.from(this.subscribers.keys());
            if (symbols.length === 0) { 
                this.isPolling = false;
                this.pollInterval = null; // for compatibility with subscribe check
                return; 
            }
            
            // Fyers rate limit: 200/min. We target 150/min max.
            // 50 symbols per request.
            const numChunks = Math.ceil(symbols.length / 50);
            const dynamicDelayMs = Math.max(1000, numChunks * 400);
            
            try {
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
                                        time: Date.now(),
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
            
            setTimeout(poll, dynamicDelayMs);
        };
        
        this.pollInterval = true; // Flag that polling is active
        poll();
    }
"""

code = re.sub(r'    connectWebSocket\(\) \{.*    _handleWsMessage\(msg\) \{ \}', poll_logic.strip() + '\n\n    _handleWsMessage(msg) { }', code, flags=re.DOTALL)

with open('public/fyers_api.js', 'w') as f:
    f.write(code)
