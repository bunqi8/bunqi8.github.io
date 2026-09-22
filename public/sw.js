self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    // VIRTUAL FILE SYSTEM ROUTING:
    if (url.pathname.includes('/charting_library/')) {
        const isJs = url.pathname.endsWith('.js');
        const newPath = url.pathname.replace('/charting_library/', '/data_pack/');
        
        // JS files are Base64 encoded as .txt
        const fetchPath = isJs ? newPath.replace(/\.js$/, '.txt') : newPath;
        const targetUrl = url.origin + fetchPath + url.search;
        
        event.respondWith(
            fetch(targetUrl)
                .then(response => {
                    if (!response.ok) throw new Error("Network response was not ok");
                    
                    if (isJs) {
                        return response.text().then(base64Text => {
                            const decoded = atob(base64Text);
                            const bytes = new Uint8Array(decoded.length);
                            for (let i = 0; i < decoded.length; i++) {
                                bytes[i] = decoded.charCodeAt(i);
                            }
                            return new Response(bytes, {
                                headers: {
                                    'Content-Type': 'application/javascript; charset=utf-8',
                                    'Cache-Control': 'public, max-age=31536000'
                                }
                            });
                        });
                    } else {
                        // Return CSS, HTML, etc directly
                        return response;
                    }
                })
                .catch(err => {
                    console.error("SW VFS failed:", err);
                    return new Response("console.error('Failed to load VFS module');", { status: 500 });
                })
        );
    }
});
