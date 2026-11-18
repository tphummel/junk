// Offline support: cache the page's own files, never the requests the page sends.
// Bump CACHE_NAME when a file is removed or renamed so the old entries are deleted on activate.
const CACHE_NAME = 'metroid-3-v1';
const SCOPE_PATH = '/metroid-3/';

const PRECACHE = [
  '/metroid-3/',
  '/metroid-3/app.js',
  '/metroid-3/apple-touch-icon.png',
  '/metroid-3/engine.js',
  '/metroid-3/export.js',
  '/metroid-3/icon-192.png',
  '/metroid-3/icon-512.png',
  '/metroid-3/icon.svg',
  '/metroid-3/manifest.webmanifest',
  '/metroid-3/route.js',
  '/metroid-3/store.js',
  '/metroid-3/style.css',
  '/metroid-3/widgets.js',
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

// Network first so updates show up; the cache is the offline fallback.
// A page that calls APIs or user URLs must not have those cached: its own fetch() calls to other URLs (and to same-origin paths
// outside /metroid-3/, such as /api/*) pass through untouched: never cached, never replayed.
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }))
  );
});
