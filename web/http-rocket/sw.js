// Offline support for HTTP Rocket: cache the app's own files, never the requests the app sends.
// Bump CACHE_NAME when a file is removed or renamed so the old entries are deleted on activate.
const CACHE_NAME = 'http-rocket-v1';
const SCOPE_PATH = '/http-rocket/';

const PRECACHE = [
  '/http-rocket/',
  '/http-rocket/app.js',
  '/http-rocket/model.js',
  '/http-rocket/storage.js',
  '/http-rocket/manifest.webmanifest',
  '/http-rocket/icon.svg',
  '/http-rocket/icon-192.png',
  '/http-rocket/icon-512.png',
  '/http-rocket/apple-touch-icon.png',
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
// This page is an HTTP client, so its own fetch() calls to other URLs (and to same-origin paths
// outside /http-rocket/, such as /api/*) pass through untouched: never cached, never replayed.
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
