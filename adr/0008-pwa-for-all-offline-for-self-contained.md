# 0008: Every webpage is installable; offline support only for self-contained pages

- Status: Accepted
- Date: 2026-11-21

## Context

[ADR 0007](0007-web-icons-and-offline.md) required icons, a manifest and a service worker only for pages with no external dependencies, and exempted the rest from all of it. That bundled two separate things. Installability (a home-screen icon and a standalone window) needs only static files and costs nothing at runtime. Offline support needs a service worker, and is only worth having when the page can work without the network. `borfin-shlump` showed the gap: it is used from a phone and wants a touch icon, but it needs a CDN and an API to run, so a service worker would only cache a shell that shows errors.

## Decision

This ADR supersedes ADR 0007. Its items 1 to 3 (icons, manifest, page tags) now apply to every webpage, and its service worker and offline items apply only to self-contained pages.

1. **Every webpage ships icons, a manifest and page tags**, as in ADR 0007 items 1 to 3: `apple-touch-icon.png` (180px), `icon-192.png`, `icon-512.png` and `icon.svg`, rendered by `skill/new-webpage/scripts/make-icons.mjs`; `manifest.webmanifest` scoped to `/<name>/` with `theme_color` and `background_color` from the page's palette ([ADR 0001](0001-web-styling.md)); and the `icon`, `apple-touch-icon`, `manifest` and `theme-color` tags in `<head>`. This holds whether or not the page has external dependencies.
2. **Service worker and offline support only with no external dependencies.** A page has an external dependency if it calls an API or any other origin, or loads code (a framework, compiler or library) from a CDN. Its own files and plain links to other sites are not dependencies. A page with none ships `sw.js` and works offline as in ADR 0007 items 4 and 5. A page with one **does not ship a service worker**, and does not opt in: the page needs the network, so there is nothing useful to serve offline and no CDN or API caching to maintain.
3. **A page that gains an external dependency later** removes its `sw.js` and its registration. Users who already installed the worker keep it until it is unregistered, so deploy a replacement `sw.js` that unregisters itself (`self.registration.unregister()` on activate) before deleting the file.
4. **Pages that predate this ADR** are exempt until they are next modified, then complete the pieces above. Migrated pages ([ADR 0003](0003-webpages.md)) are treated the same.
5. **The index page is exempt** from all of it, as in ADR 0007 item 7.
6. The procedure and templates are in the [`new-webpage` skill](../skill/new-webpage/SKILL.md).

## Consequences

- Every page installs to the home screen with its own icon, including pages that need the network.
- Network-bound pages still have no worker, so there is no risk of serving stale API data or cached CDN code.
- Pages that were exempt under ADR 0007 because of a dependency (for example `borfin-shlump`) need icons and a manifest when next touched.
- An installed page that is offline opens its window and then shows the browser or page error, rather than an offline shell.
- Each page carries its own copy of the icons and manifest, in line with ADR 0003.
- Nothing in CI checks any of this.

## Alternatives considered

- **Keep ADR 0007 as is.** Leaves network-bound pages with no icon when installed.
- **Let pages with dependencies opt in to a worker** (ADR 0007's allowance). Adds upkeep for caching pinned CDN files, for a page that still cannot work offline.
- **Retrofit every existing page now.** Mechanical, but touches pages no one is working on; a separate change can do it.
