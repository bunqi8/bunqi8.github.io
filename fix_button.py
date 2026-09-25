import re

with open('public/main.js', 'r') as f:
    js = f.read()

old_button_logic = """        window.tvWidget.headerReady().then(function() {
            var button = window.tvWidget.createButton();
            button.classList.add('apply-common-tooltip');
            button.addEventListener('click', function() {
                if (window.openOptionsChainModal) window.openOptionsChainModal();
            });
            // Match TradingView Indicators button style precisely using the exact classes provided by the user
            button.innerHTML = `
                <div class="button-OhqNVIYA button-ptpAHg8E withText-ptpAHg8E button-GwQQdU8S apply-common-tooltip isInteractive-GwQQdU8S accessible-GwQQdU8S" tabindex="-1" type="button" aria-label="Open Options Chain" data-tooltip="Open Options Chain">
                    <span role="img" class="icon-GwQQdU8S" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="none">
                            <rect x="5.5" y="7.5" width="17" height="13" rx="1.5" stroke="currentColor" stroke-width="1.2"></rect>
                            <path stroke="currentColor" stroke-width="1.2" d="M5.5 12.5h17M14 7.5v13"></path>
                        </svg>
                    </span>
                    <div class="js-button-text text-GwQQdU8S">Option Chain</div>
                </div>
            `;
            
            // Try to find the button's wrapper and add the native TV class if possible to perfectly match hover states
            try {
                // Add the native separator as requested by the user
                if (button.parentElement) {
                    const sep = document.createElement('div');
                    sep.className = 'separatorWrap-MBOVGQRI';
                    sep.innerHTML = '<div class="separator-xVhBjD5m separator-MBOVGQRI"></div>';
                    button.parentElement.insertBefore(sep, button);
                }
            } catch (e) {}
        });"""

new_button_logic = """        window.tvWidget.headerReady().then(function() {
            // Wait for iframe DOM
            const iframe = document.querySelector('iframe[id^="tradingview_"]');
            if (!iframe) return;
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            
            const checkReady = setInterval(() => {
                const indicatorsBtn = iframeDoc.getElementById('header-toolbar-indicators');
                if (indicatorsBtn) {
                    clearInterval(checkReady);
                    
                    const ocBtnHtml = `
                        <div class="group-MBOVGQRI" id="header-toolbar-option-chain">
                            <button aria-label="Options Chain" data-role="button" data-tooltip-hotkey='{"keys":["O"],"text":"{0}"}' data-tooltip="Options Chain" tabindex="-1" type="button" class="button-OhqNVIYA button-ptpAHg8E withText-ptpAHg8E button-GwQQdU8S apply-common-tooltip isInteractive-GwQQdU8S accessible-GwQQdU8S" id="btn-option-chain-real">
                                <span role="img" class="icon-GwQQdU8S" aria-hidden="true">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="none">
                                        <rect x="5.5" y="7.5" width="17" height="13" rx="1.5" stroke="currentColor" stroke-width="1.2"></rect>
                                        <path stroke="currentColor" stroke-width="1.2" d="M5.5 12.5h17M14 7.5v13"></path>
                                    </svg>
                                </span>
                                <div class="js-button-text text-GwQQdU8S">Option Chain</div>
                            </button>
                        </div>
                    `;
                    
                    indicatorsBtn.parentElement.insertAdjacentHTML('afterend', ocBtnHtml);
                    
                    const realBtn = iframeDoc.getElementById('btn-option-chain-real');
                    if (realBtn) {
                        realBtn.addEventListener('click', () => {
                            if (window.openOptionsChainModal) window.openOptionsChainModal();
                        });
                        
                        // Override TV's internal tooltip listener since we injected raw HTML
                        realBtn.addEventListener('mouseenter', () => {
                            realBtn.setAttribute('title', 'Options Chain  O');
                        });
                        realBtn.addEventListener('mouseleave', () => {
                            realBtn.removeAttribute('title');
                        });
                    }
                }
            }, 500);
        });"""

js = js.replace(old_button_logic, new_button_logic)

with open('public/main.js', 'w') as f:
    f.write(js)

