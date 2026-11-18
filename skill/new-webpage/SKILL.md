---
name: new-webpage
description: Add or migrate a static webpage under web/ in the junk repo (served at junk.tomhummel.com/<name>/). Use when asked to create, port, or move a page, tool, or toy into web/, including migrating one from tomhummel.com (tphummel/blog static/).
metadata:
  version: "1.0.0"
---

# New webpage

Rules are in [ADR 0003](../../adr/0003-webpages.md) (structure), [0002](../../adr/0002-no-web-build-step.md) (no build step), [0001](../../adr/0001-web-styling.md) (colors) and [0007](../../adr/0007-web-icons-and-offline.md) (icons, manifest, service worker). This is the procedure.

## Steps

1. **Branch.** `git switch -c <name>` from an up-to-date `main`. Name is lowercase kebab-case.
2. **Create `web/<name>/index.html`** from the template below. Put every other file the page needs (scripts, modules, data, images) in the same directory and reference it relatively.
3. **Style it** with the [`golden-angle-styling` skill](../golden-angle-styling/SKILL.md): random seed, light and dark variables. Migrated webpages are exempt until they are next changed.
4. **Icons, manifest and service worker** (ADR 0007; migrated pages are exempt until next changed). Pick an emoji, then:
   ```sh
   node skill/new-webpage/scripts/make-icons.mjs <name> 🚀 [#background]   # needs Playwright + Chromium
   ```
   It writes `icon.svg`, `apple-touch-icon.png`, `icon-192.png` and `icon-512.png` into `web/<name>/`. Then add `manifest.webmanifest` and `sw.js` from the templates below, the `<head>` tags, and the registration snippet. List every file the page needs in `PRECACHE`: one missing file stops the worker from installing.
5. **Register it.** Add one `<li>` in `web/index.html` under the heading for the project's class (Tools, Games, Toys; add a section only if none fits), in alphabetical order. The user adds type emoji; leave them out unless asked:
   ```html
   <li><a href="/<name>/">display name</a>: short description</li>
   ```
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

`sw.js`: copy [`web/http-rocket/sw.js`](../../web/http-rocket/sw.js), then change `CACHE_NAME` (`<name>-v1`), `SCOPE_PATH` and `PRECACHE`. Keep it handling only `GET` requests under `/<name>/`: a page that calls APIs or user-supplied URLs must never have those responses cached. Pinned CDN files the page loads go in `PRECACHE`.

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
- The service worker installs (DevTools > Application), every `PRECACHE` file exists, and with the network off (DevTools > Network > Offline) a reload still loads the page.
- The manifest has no errors in DevTools > Application, and the icons show there.
- `npm run types && npm run typecheck && npm test` pass (if an API or shared module is involved).
