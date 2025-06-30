const CACHE_NAME = 'basalt-data-entry-v1';
const ASSETS_TO_CACHE = [
    '.',
    '/index.html',
    '/app.js',
    '/auth.js',
    '/config.js',
    '/masterData.js',
    '/manifest.json',
    '/favicon.ico',
    '/icon192.png',
    '/icon512.png',
    'https://unpkg.com/dexie@latest/dist/dexie.js',
    'https://alcdn.msauth.net/browser/2.30.0/js/msal-browser.min.js'
];

// Install event - cache assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME) {
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => self.clients.claim())
    );
});

// Fetch event - handle offline functionality
self.addEventListener('fetch', event => {
    // Don't cache API calls or authentication requests
    if (event.request.url.includes('/api/') || 
        event.request.url.includes('login.microsoftonline.com') ||
        event.request.url.includes('graph.microsoft.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request)
                    .then(response => {
                        // Cache successful GET requests
                        if (event.request.method === 'GET' && response.status === 200) {
                            const responseToCache = response.clone();
                            caches.open(CACHE_NAME)
                                .then(cache => {
                                    cache.put(event.request, responseToCache);
                                });
                        }
                        return response;
                    })
                    .catch(() => {
                        // Return a fallback for images
                        if (event.request.url.match(/\.(jpg|jpeg|png|gif|svg)$/)) {
                            return caches.match('/images/offline-placeholder.png');
                        }
                        throw new Error('Network unavailable');
                    });
            })
    );
});
