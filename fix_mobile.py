import re

with open('public/main.js', 'r') as f:
    js = f.read()

# Fix the button injection
old_btn = """            const checkReady = setInterval(() => {
                const indicatorsBtn = iframeDoc.getElementById('header-toolbar-indicators');
                if (indicatorsBtn) {
                    clearInterval(checkReady);
                    
                    const ocBtnHtml = `
                        <div class="group-MBOVGQRI" id="header-toolbar-option-chain">"""

new_btn = """            let attempts = 0;
            const checkReady = setInterval(() => {
                attempts++;
                
                // Native TV desktop indicators button
                let targetEl = iframeDoc.getElementById('header-toolbar-indicators');
                
                // Mobile fallbacks
                if (!targetEl) targetEl = iframeDoc.getElementById('header-toolbar-symbol-search');
                if (!targetEl) targetEl = iframeDoc.querySelector('.group-wWM3zP_M');
                if (!targetEl) targetEl = iframeDoc.querySelector('.group-MBOVGQRI');
                
                if (targetEl || attempts > 10) {
                    clearInterval(checkReady);
                    
                    if (!targetEl) {
                        // Ultimate fallback using API
                        const fb = window.tvWidget.createButton();
                        fb.innerHTML = '<div style="color: #2962FF; font-weight: bold;">Option Chain</div>';
                        fb.addEventListener('click', () => { if (window.openOptionsChainModal) window.openOptionsChainModal(); });
                        return;
                    }
                    
                    const ocBtnHtml = `
                        <div class="group-MBOVGQRI" id="header-toolbar-option-chain" style="margin: 0 4px;">"""

js = js.replace(old_btn, new_btn)

# replace the indicatorsBtn variable name below it
js = js.replace("indicatorsBtn.parentElement.insertAdjacentHTML('afterend', ocBtnHtml);", "targetEl.insertAdjacentHTML('afterend', ocBtnHtml);")

with open('public/main.js', 'w') as f:
    f.write(js)

with open('public/cache.js', 'r') as f:
    cjs = f.read()

old_catch = """        } catch (e) {
            console.error("[SyncManager] Root sync failed", e);
        }"""
new_catch = """        } catch (e) {
            console.error("[SyncManager] Root sync failed", e);
            const cachedExpiries = await this.getAllExpiries();
            if (cachedExpiries.length === 0) {
                alert("Network Error: Could not connect to HuggingFace dataset (Proxy/Connection failed). The chart cannot load without data.");
            }
        }"""
cjs = cjs.replace(old_catch, new_catch)

with open('public/cache.js', 'w') as f:
    f.write(cjs)

