self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Intercept requests to /data_pack/*.js
    if (url.pathname.includes('/data_pack/') && url.pathname.endsWith('.js')) {
        // Change the request to the obfuscated .txt file, safely preserving query params
        const newPath = url.pathname.replace(/\.js$/, '.txt');
        const txtUrl = url.origin + newPath + url.search;
        
        event.respondWith(
            fetch(txtUrl)
                .then(response => {
                    if (!response.ok) throw new Error("Network response was not ok");
                    return response.text();
                })
                .then(base64Text => {
                    // Decode base64 back to raw JS string
                    const decoded = atob(base64Text);
                    
                    // Convert string to Uint8Array for the response body
                    const bytes = new Uint8Array(decoded.length);
                    for (let i = 0; i < decoded.length; i++) {
                        bytes[i] = decoded.charCodeAt(i);
                    }
                    
                    // Return the decoded content as valid JavaScript
                    return new Response(bytes, {
                        headers: {
                            'Content-Type': 'application/javascript; charset=utf-8',
                            'Cache-Control': 'public, max-age=31536000'
                        }
                    });
                })
                .catch(err => {
                    console.error("SW Decryption failed:", err);
                    return new Response("console.error('Failed to load module');", { 
                        status: 500,
                        headers: { 'Content-Type': 'application/javascript' }
                    });
                })
        );
    }
});
