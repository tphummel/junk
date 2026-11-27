// Offline support: cache the page's own files, never the requests the page sends.
// Bump CACHE_NAME when a file is removed or renamed so the old entries are deleted on activate.
const CACHE_NAME = 'monopoly-asset-manager-v1';
const SCOPE_PATH = '/monopoly-asset-manager/';
// Style sheet this page links (ADR 0009): cached and served like the page's own files, or it loses its styling offline.
const SHEET_PATH = '/styles/monopoly/monopoly.css';

const PRECACHE = [
  '/monopoly-asset-manager/',
  '/monopoly-asset-manager/tracker.js',
  '/monopoly-asset-manager/manifest.webmanifest',
  '/monopoly-asset-manager/icon.svg',
  '/monopoly-asset-manager/icon-192.png',
  '/monopoly-asset-manager/icon-512.png',
  '/monopoly-asset-manager/apple-touch-icon.png',
  SHEET_PATH,
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
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !(url.pathname.startsWith(SCOPE_PATH) || url.pathname === SHEET_PATH)) return;

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
