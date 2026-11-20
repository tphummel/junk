const CACHE_NAME = 'rps-v2';

const PRECACHE = [
  '/rps/',
  '/rps/manifest.webmanifest',
  '/rps/icon-192.png',
  '/rps/icon-512.png',
  '/rps/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// network first so page updates show up; cache is the offline fallback
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // bot throws must always be live, never cached or replayed offline
  if (new URL(event.request.url).pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
