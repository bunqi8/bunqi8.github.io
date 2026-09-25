import re

with open('public/fyers_api.js', 'r') as f:
    code = f.read()

# Add auth error handling inside the poll loop
auth_error_logic = """
                    const data = await res.json();
                    
                    if (data.s === 'error' && (data.code === -15 || data.message.toLowerCase().includes('token'))) {
                        console.error("Fyers Auth Error:", data.message);
                        this.isPolling = false;
                        this.pollInterval = null;
                        this.token = null;
                        localStorage.removeItem('fyers_token');
                        
                        // Show visual alert on the UI
                        alert("Fyers Live Data Disconnected: Your access token has expired or is invalid.\\n\\nPlease click the Broker button to provide a new token.");
                        
                        return; // Stop the polling loop completely
                    }
                    
                    if (data.s === 'ok' && data.d) {
"""

code = code.replace("const data = await res.json();\n                    \n                    if (data.s === 'ok' && data.d) {", auth_error_logic.strip('\n'))

with open('public/fyers_api.js', 'w') as f:
    f.write(code)
