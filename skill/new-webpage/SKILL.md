---
name: new-webpage
description: Add or migrate a static webpage under web/ in the junk repo (served at junk.tomhummel.com/<name>/). Use when asked to create, port, or move a page, tool, or toy into web/, including migrating one from tomhummel.com (tphummel/blog static/).
metadata:
  version: "1.0.0"
---

# New webpage

Rules are in [ADR 0003](../../adr/0003-webpages.md) (structure), [0002](../../adr/0002-no-web-build-step.md) (no build step), [0001](../../adr/0001-web-styling.md) (colors) and [0008](../../adr/0008-pwa-for-all-offline-for-self-contained.md) (icons, manifest, service worker; supersedes 0007). This is the procedure.

## Steps

1. **Branch.** `git switch -c <name>` from an up-to-date `main`. Name is lowercase kebab-case.
2. **Create `web/<name>/index.html`** from the template below. Put every other file the page needs (scripts, modules, data, images) in the same directory and reference it relatively.
3. **Style it** with the [`golden-angle-styling` skill](../golden-angle-styling/SKILL.md): random seed, light and dark variables. Migrated webpages are exempt until they are next changed.
4. **Icons and manifest, and a service worker if self-contained** (ADR 0008, which supersedes ADR 0007). Icons, manifest and head tags are required for every page, including ones that call an API or load code from a CDN; migrated pages are exempt until next changed. The service worker is only for pages with no external dependencies (no API or other-origin calls, no CDN code); a page with one ships no `sw.js` and does not register one. Pick an emoji, then:
   ```sh
   node skill/new-webpage/scripts/make-icons.mjs <name> 🚀 [#background]   # needs Playwright + Chromium
   ```
   It writes `icon.svg`, `apple-touch-icon.png`, `icon-192.png` and `icon-512.png` into `web/<name>/`. Then add `manifest.webmanifest` and the `<head>` tags from the templates below. For a self-contained page also add `sw.js` and the registration snippet, and list every file the page needs in `PRECACHE`: one missing file stops the worker from installing.
5. **Register it.** Add one `<li>` in `web/index.html` under the heading for the project's class (Tools, Games, Toys; add a section only if none fits), in alphabetical order. The user adds type emoji; leave them out unless asked:
   ```html
   <li data-icon="icon.svg"><a href="/<name>/">display name</a>: short description</li>
   ```
   `data-icon` is the icon file the index card shows (the `icon.svg` from step 4; omit it if the page has none). A page you use every day can also go in the `Featured` list at the top of `web/index.html`, in addition to its class.
   If the page has an API, put its link on the same line (`<a href="/api/<name>/...">api</a>`) instead of a separate entry.
6. **If it needs an API**, use the [`new-api` skill](../new-api/SKILL.md) with the same `<name>`. Call it with a same-origin path (`fetch("/api/<name>/...")`). Logic both sides need goes in `web/<name>/<something>.js` as a plain ES module with JSDoc types; the API imports it.
7. **Check locally:** do the one-time setup in the [README](../../README.md#site-and-api) if needed, then `npm run dev` and open `http://localhost:8787/<name>/`. Pages that import ES modules do not work from `file://`.
8. **Push and open a PR.** Open the preview at `https://<branch>.junk.tomhummel.com/<name>/`, exercise the page, and view it in light and dark mode (browser or OS setting). Fix console errors and 404s.

## Template

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>display name</title>
  <style>
    /* palette variables from the golden-angle-styling skill */
  </style>
  <meta name="theme-color" content="#111111"> <!-- the page's dark --bg -->
  <link rel="icon" href="/<name>/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/<name>/apple-touch-icon.png">
  <link rel="manifest" href="/<name>/manifest.webmanifest">
</head>
<body>
  <!-- ... -->
  <!-- service worker registration: self-contained pages only (ADR 0008); omit if the page has an API or CDN dependency -->
  <script>
    if ('serviceWorker' in navigator) {
      addEventListener('load', () => {
        navigator.serviceWorker.register('/<name>/sw.js', { scope: '/<name>/' }).catch(() => {});
      });
    }
  </script>
</body>
</html>
```

`manifest.webmanifest`:

```json
{
  "name": "display name",
  "short_name": "display name",
  "description": "short description",
  "start_url": "/<name>/",
  "scope": "/<name>/",
  "display": "standalone",
  "background_color": "#111111",
  "theme_color": "#111111",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

`sw.js` (replace `<name>`, and list every file the page needs in `PRECACHE`, plus any pinned CDN files it loads). Keep it handling only `GET` requests under `/<name>/`: a page that calls APIs or user-supplied URLs must never have those responses cached.

```js
// Offline support: cache the page's own files, never the requests the page sends.
// Bump CACHE_NAME when a file is removed or renamed so the old entries are deleted on activate.
const CACHE_NAME = '<name>-v1';
const SCOPE_PATH = '/<name>/';

const PRECACHE = [
  '/<name>/',
  // every script, stylesheet, module and data file the page loads, e.g. '/<name>/app.js'
  '/<name>/manifest.webmanifest',
  '/<name>/icon.svg',
  '/<name>/icon-192.png',
  '/<name>/icon-512.png',
  '/<name>/apple-touch-icon.png',
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
// outside /<name>/, such as /api/*) pass through untouched: never cached, never replayed.
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
```

## Do not

- Add a build step, bundler, `package.json`, or generated files under `web/` (ADR 0002).
- Put tests, notes, or drafts in `web/`; everything there is served as-is. Tests for shared logic go in `api/<name>.test.mjs`.
- Import from another webpage's directory, or add a shared layout or stylesheet.
- Create a project folder or `notes.md` for this work.
- Let `sw.js` cache or replay requests outside `/<name>/` (the page's own `fetch()` calls, `/api/*`), or share one service worker between pages (ADR 0007).

## Migrating from tomhummel.com

Source: `https://github.com/tphummel/blog/tree/main/static/<name>/`.

1. Copy the files unchanged into `web/<name>/` and commit that first.
2. Make only the edits needed to work here, as separate commits, and state each in the commit message. Typical ones: remove links to files that never existed (the blog returns its 404 page with status 200, so a "working" icon link may be dead), make self-links relative or root-absolute.
3. Check for calls to external APIs or hard-coded `tomhummel.com` URLs; list them in the PR rather than silently changing them.
4. Keep CDN-loaded libraries (for example Svelte) as they are unless asked to vendor them.
5. Do not add a redirect in this repo. Redirects from `tomhummel.com/<name>` are Cloudflare rules, added by the owner after the new URL works in production.

## Done when

- `/<name>/` loads in the PR preview with no console errors, in both color schemes.
- The entry is under the right heading in `web/index.html`, in order.
- For a self-contained page: the service worker installs (DevTools > Application), every `PRECACHE` file exists, and with the network off (DevTools > Network > Offline) a reload still loads the page. A page with external dependencies has no service worker.
- The manifest has no errors in DevTools > Application, and the icons show there.
- `npm run types && npm run typecheck && npm test` pass (if an API or shared module is involved).
