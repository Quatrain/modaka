const CACHE_NAME = 'second-brain-v1';
const ASSETS = [
  '/',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
     caches.match(e.request).then((res) => {
        if (res) return res;
        // Do not cache API routes, only fallback to network
        return fetch(e.request);
     })
  );
});
