# 0002: No build step for web/

- Status: Accepted
- Date: 2026-11-14

## Context

`web/` is deployed as Cloudflare Workers static assets with an empty build command, and the webpages migrated from tomhummel.com are plain static files. This repo is a junk drawer of unrelated webpages. Anything that needs a toolchain needs upkeep, breaks when left alone, and makes migrating or abandoning a webpage harder. Sharing code between a page and the API made it worth stating the rule.

## Decision

**There is no build step for `web/`.** What is committed in `web/` is exactly what is served.

- Nothing between a push and the deploy reads, transforms, bundles, generates or copies files in `web/`.
- Files run in a browser as written: HTML, CSS, JavaScript (including ES modules), SVG, images, JSON. No TypeScript, JSX or other syntax a browser cannot run; use JSDoc for types.
- No npm dependencies in `web/`. Third-party libraries load from a CDN at a pinned version, or are committed as plain files. A framework is acceptable only if it runs in the browser without a build, as `card-shuffle-svelte` does.
- Code shared between `web/` and `api/` is a plain ES module under `web/` that the API imports. Wrangler bundles it into the Worker; nothing is generated into `web/`.
- A file generated locally and committed is just a static file; the deploy never regenerates it.

## Consequences

- Deploying `web/` is a file copy. Migrating a webpage from the blog is a copy, and removing one is a delete.
- No minification, bundling, hashed filenames or client-side TypeScript.
- Third-party code means CDN reliance or vendored files.
- ES modules do not load from `file://`, so a page that imports one needs the dev server or any HTTP server.
- A shared module must be browser-runnable JavaScript.
- CI does not enforce this rule.

## Alternatives considered

- **Copy each webpage from its project folder into a deploy directory with a script.** An extra step with no benefit over serving `web/` directly.
- **A static site generator or bundler (Hugo, Astro, Vite).** Adds a toolchain and build failures to mostly single-file pages.
- **Allow a build for webpages that need one.** Possible later, by an ADR that scopes builds so single-file pages stay build-free.

## Revisit when

Webpages need npm dependencies in the browser, client-side TypeScript, or shared code that cannot be a plain ES module. Supersede this ADR then, rather than quietly adding a build.
