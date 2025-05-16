const CACHE = 'app-static-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// On install: cache the shell
self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

// On fetch: serve from cache first
self.addEventListener('fetch', evt => {
  evt.respondWith(
    caches.match(evt.request).then(cached => cached || fetch(evt.request))
  );
});
