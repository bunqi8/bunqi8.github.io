import re

with open('public/options_chain.js', 'r') as f:
    js = f.read()

# Add active class toggling
open_mod = """window.openOptionsChainModal = function() {
    const iframe = document.querySelector('iframe[id^="tradingview_"]');
    if (iframe) {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const btn = doc.getElementById('btn-option-chain-real');
        if (btn) btn.classList.add('isActive-GwQQdU8S', 'isActive');
    }"""
js = js.replace("window.openOptionsChainModal = function() {", open_mod)

close_mod = """window.closeOptionsChainModal = function() {
    const iframe = document.querySelector('iframe[id^="tradingview_"]');
    if (iframe) {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const btn = doc.getElementById('btn-option-chain-real');
        if (btn) btn.classList.remove('isActive-GwQQdU8S', 'isActive');
    }"""
js = js.replace("window.closeOptionsChainModal = function() {", close_mod)

with open('public/options_chain.js', 'w') as f:
    f.write(js)

