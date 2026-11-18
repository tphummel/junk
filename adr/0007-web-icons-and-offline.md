# 0007: Webpages ship icons, a manifest and a service worker

- Status: Accepted
- Date: 2026-11-18

## Context

`web/` pages are small tools and games that are often used from a phone or an installed home-screen icon. A page with no icon gets a letter or a blank tile when installed, and a page with no service worker shows the browser's offline error instead of working. A page that is self-contained, using only its own files and browser storage, runs fine offline and costs little to support. A page that exists to call an external API, or that needs a CDN to start, has little to offer offline: a cached shell that can only show errors, plus upkeep for caching other origins' code.

Without a rule, each page decides for itself and icons and offline support get skipped. The design is a versioned cache, a precache list, network-first fetches with the cache as the offline fallback, `skipWaiting` and `clients.claim`. This ADR makes that design the rule for self-contained pages. It follows [ADR 0002](0002-no-web-build-step.md) (no build step) and [ADR 0003](0003-webpages.md) (self-contained pages).

## Decision

A webpage **with no external dependencies** ships all of the following in its own directory, `web/<name>/`. A page has an external dependency if it calls an API or any other origin, or loads code (a framework, compiler or library) from a CDN. Its own files and plain links to other sites (`<a href>`) are not dependencies.

Pages with an external dependency are exempt, because offline support would not make them work. They may opt in; one that does follows items 1 to 4, caches only its own files and pinned CDN files listed in `PRECACHE`, and says so when a feature needs the network.

1. **Icons.** An emoji chosen for the page, rendered once to static PNGs and committed:
   - `apple-touch-icon.png` (180px), `icon-192.png`, `icon-512.png`, on a solid background, because iOS fills transparency with black. The emoji sits inside the maskable safe zone (about 62% of the canvas).
   - `icon.svg` (the emoji as SVG text) for the browser tab.
   - The `skill/new-webpage/scripts/make-icons.mjs` script renders them. Nothing runs at deploy time.
2. **Manifest.** `manifest.webmanifest` with `name`, `short_name`, `description`, `start_url` and `scope` of `/<name>/`, `display: standalone`, `theme_color` and `background_color` from the page's palette ([ADR 0001](0001-web-styling.md)), and the 192px and 512px icons with `purpose: "any maskable"`.
3. **Page tags** in `<head>`: `rel="icon"`, `rel="apple-touch-icon"`, `rel="manifest"` and `<meta name="theme-color">`, with root-absolute `/<name>/...` paths.
4. **Service worker.** `sw.js` in the page directory, registered as `navigator.serviceWorker.register("/<name>/sw.js", { scope: "/<name>/" })`, with failures ignored. Start from the template in the [`new-webpage` skill](../skill/new-webpage/SKILL.md) and change the names:
   - Cache name `<name>-v1`, and a `PRECACHE` list of every file the page needs to run. A page that opts in despite a CDN dependency lists the pinned CDN files here too.
   - Network first, falling back to the cache, so a deploy shows up on the next load.
   - It handles only `GET` requests for files under `/<name>/` (and any pinned CDN files in `PRECACHE`). Other requests, including the page's own `fetch()` calls and anything under `/api/`, pass through untouched. A page that calls APIs or user-supplied URLs must never have those responses cached or replayed.
5. **Offline behavior.** The page must load and work offline from its own files and browser storage. If it has a feature that needs the network (for example, a page that sends requests but is otherwise self-contained), that feature says so when offline rather than failing silently.
6. **Pages that predate this ADR** and are not otherwise exempt are exempt until they are next modified, as with palettes in ADR 0001. Adding the pieces to one at any time is fine, and a page that has some of them should be completed when touched. Migrated pages (ADR 0003) get the same treatment.
7. **The index page is exempt.** `web/index.html` has no manifest, icons or service worker: it is a link registry, not an app (ADR 0003), and a worker at the site root would see every page's requests.
8. The procedure and templates are in the [`new-webpage` skill](../skill/new-webpage/SKILL.md).

## Consequences

- A new self-contained page installs to the home screen with its own icon and opens offline.
- Network-bound pages stay simple, with no worker to maintain and no risk of serving stale API data.
- A page that gains an external dependency later can keep its worker or drop it. If it keeps it, item 4 still applies, so the page's own `fetch()` calls are not cached.
- Each page carries its own copy of about 45 lines of `sw.js`, a manifest and four small images, in line with ADR 0003.
- `cache.addAll` fails as a whole: a file in `PRECACHE` that does not exist, or a renamed file left in the list, stops the worker from installing. Adding or removing a page file means editing `PRECACHE` (and bumping the cache name when removing, so old entries are deleted).
- Network-first means a stale cache is only served when the network fails. It does not remove the need to test an update after deploy.
- A service worker bug is sticky for installed users. The recovery is to deploy a fixed `sw.js`, and for a broken one, to unregister it from the browser's site settings.
- Every `*.junk.tomhummel.com` branch preview is its own origin, so workers there are separate from production's.
- Nothing in CI checks any of this, so a page that skips a piece is not flagged.

## Alternatives considered

- **One service worker at the site root.** Fewer files, but it would see every page's requests and cache the API. It couples pages and conflicts with ADR 0003.
- **A generated precache list or Workbox.** Removes the `PRECACHE` upkeep, but needs a build step (ADR 0002).
- **Cache first.** Faster, but pages would show stale code after a deploy until the cache name changes.
- **Icons and service workers optional.** Leaves pages without an icon or offline support.
- **Requiring them for every page, including network-bound ones.** Gives pages that cannot work offline a shell that only shows errors, and puts CDN and API caching rules on every such page.
- **Requiring every existing page to be retrofitted at once.** Mechanical, but touches pages no one is working on; a separate change can do it.
