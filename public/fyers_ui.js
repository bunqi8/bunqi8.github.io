// Fyers UI Integration for TradingView

class FyersUI {
    constructor() {
        this.btnId = 'btn-fyers-broker';
        this.setupEventListeners();
    }
    
    injectButton(targetEl, iframeDoc) {
        if (iframeDoc.getElementById(this.btnId)) return;
        
        const btnHtml = `
        <div class="group-MBOVGQRI" style="margin: 0 4px;">
            <button id="${this.btnId}" class="button-OhqNVIYA button-ptpAHg8E apply-common-tooltip isInteractive-GwQQdU8S" title="Fyers Connection" style="padding: 0 12px; font-weight: bold; font-size: 13px; color: #f44336; border: 1px solid #f44336; background: rgba(244,67,54,0.1);">
                Broker: Offline
            </button>
        </div>
        `;
        targetEl.insertAdjacentHTML('afterend', btnHtml);
        
        const btn = iframeDoc.getElementById(this.btnId);
        btn.addEventListener('click', () => this.showModal());
        
        // Initial check
        this.updateButtonState(window.FyersAPI.isConnected, window.FyersAPI.profileName);
    }
    
    updateButtonState(isConnected, name, error = null) {
        const iframe = document.querySelector('iframe[id^="tradingview_"]');
        if (!iframe) return;
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        const btn = iframeDoc.getElementById(this.btnId);
        if (!btn) return;
        
        if (isConnected) {
            btn.style.color = '#4caf50';
            btn.style.borderColor = '#4caf50';
            btn.style.background = 'rgba(76,175,80,0.1)';
            btn.innerText = `Broker: ${name}`;
        } else {
            btn.style.color = '#f44336';
            btn.style.borderColor = '#f44336';
            btn.style.background = 'rgba(244,67,54,0.1)';
            btn.innerText = error ? 'Broker: Auth Error' : 'Broker: Offline';
        }
    }
    
    setupEventListeners() {
        window.addEventListener('fyers_connection_status', (e) => {
            this.updateButtonState(e.detail.connected, e.detail.name, e.detail.error);
        });
        
        // Auto-validate on load if token exists
        setTimeout(() => {
            if (window.FyersAPI && window.FyersAPI.token) {
                window.FyersAPI.validateAndGetProfile();
            }
        }, 1000);
    }
    
    showModal() {
        let modal = document.getElementById('fyers-auth-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'fyers-auth-modal';
            modal.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
            modal.innerHTML = `
                <div style="background:#fff;padding:24px;border-radius:8px;width:400px;font-family:sans-serif;">
                    <h3 style="margin-top:0;">Fyers API Connection</h3>
                    <p style="font-size:13px;color:#666;">Paste your Fyers App_ID:Access_Token generated from your backend script.</p>
                    <input type="password" id="fyers-token-input" placeholder="Enter Access Token" style="width:100%;padding:10px;margin:12px 0;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;">
                    <div style="display:flex;justify-content:flex-end;gap:12px;">
                        <button id="fyers-btn-cancel" style="padding:8px 16px;cursor:pointer;background:#eee;border:none;border-radius:4px;">Cancel</button>
                        <button id="fyers-btn-save" style="padding:8px 16px;cursor:pointer;background:#2962FF;color:#fff;border:none;border-radius:4px;">Save & Connect</button>
                    </div>
                    <div id="fyers-auth-msg" style="margin-top:12px;font-size:13px;color:#f44336;display:none;"></div>
                </div>
            `;
            document.body.appendChild(modal);
            
            document.getElementById('fyers-btn-cancel').onclick = () => modal.style.display = 'none';
            document.getElementById('fyers-btn-save').onclick = async () => {
                const token = document.getElementById('fyers-token-input').value.trim();
                if (!token) return;
                
                const btnSave = document.getElementById('fyers-btn-save');
                btnSave.innerText = 'Connecting...';
                window.FyersAPI.setToken(token);
                
                const res = await window.FyersAPI.validateAndGetProfile();
                if (res.success) {
                    modal.style.display = 'none';
                } else {
                    const msgEl = document.getElementById('fyers-auth-msg');
                    msgEl.innerText = res.msg || 'Authentication failed. Invalid token.';
                    msgEl.style.display = 'block';
                }
                btnSave.innerText = 'Save & Connect';
            };
        }
        document.getElementById('fyers-token-input').value = window.FyersAPI.token || '';
        document.getElementById('fyers-auth-msg').style.display = 'none';
        modal.style.display = 'flex';
    }
}

window.FyersUI = new FyersUI();
