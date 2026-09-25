import re

with open('public/fyers_api.js', 'r') as f:
    code = f.read()

code = code.replace("if (!this.ws)", "if (!this.pollInterval)")
code = code.replace("this._sendWsCommand('SUB_DATA', [symbol]);", "")
code = code.replace("this._sendWsCommand('UNSUB_DATA', [symbol]);", "")
code = code.replace("this.ws = null;", "")
code = code.replace("if (this.ws && this.subscribers.size === 0)", "if (this.pollInterval && this.subscribers.size === 0)")

with open('public/fyers_api.js', 'w') as f:
    f.write(code)
