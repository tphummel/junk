# 0002: No build step for web/

- Status: Accepted
- Date: 2026-11-14

## Context

`web/` is deployed to junk.tomhummel.com as Cloudflare Workers static assets (`assets.directory: ./web` in `wrangler.jsonc`), and Workers Builds is configured with an empty build command. The webpages migrated from tomhummel.com are plain static files with no build. An early plan to colocate web content in each project folder and collect it with a copy script was dropped in favor of serving `web/` directly.

This repo is a junk drawer of many unrelated webpages. Anything that needs a toolchain (bundler, framework CLI, package install) needs upkeep, breaks when left alone, and makes migrating or abandoning a webpage harder. The question of sharing code between a page and the API (the palette logic was duplicated in both when this was decided, and was then moved into one shared module) made it worth stating the rule explicitly.

## Decision

**There is no build step for `web/`.** What is committed in `web/` is exactly what is served.

- Nothing runs between a push and the deploy that reads, transforms, bundles, generates or copies files in `web/`. The Workers Builds build command stays empty, and `assets.directory` stays `./web`.
- Files in `web/` must run in a browser as written: HTML, CSS, JavaScript (including ES modules), SVG, images, JSON and similar. No TypeScript, JSX or other syntax a browser cannot run; use JSDoc for types.
- No npm dependencies in `web/`. Third-party libraries are loaded from a CDN at a pinned version, or vendored (committed) as plain files. A framework is acceptable only if it runs in the browser without a build, as `card-shuffle-svelte` does by compiling `App.svelte` in the page.
- Code shared between `web/` and `api/` is a plain ES module under `web/` that the API imports. The Worker in `api/` is bundled by Wrangler at deploy time; that bundling is for the Worker, not for `web/`, and nothing is generated into `web/`.
- An author may generate a file locally and commit the result, but then it is just a static file: the deploy never regenerates it, and nothing checks that it matches its source.

## Consequences

- Deploying `web/` is a file copy: no toolchain config to maintain, fast builds and previews, and nothing to break when the repo sits untouched.
- Migrating a webpage from the blog is a copy, and removing one is a delete.
- What you commit is what is served, so reading the repo shows what runs.
- No minification, tree-shaking, bundling, hashed filenames (no automatic cache busting) or TypeScript on the client side.
- Third-party code means CDN reliance or committed vendored files. In-browser compilation can be heavy (the Svelte compiler is about 1.6 MB).
- ES modules do not load from `file://`, so a page that imports a module needs the dev server (`npm run dev`) or any HTTP server. A page that is a single inline file does not.
- Shared code between page and API is possible but constrains the shared module to be browser-runnable JavaScript.
- Nothing in CI enforces this rule; it is a convention.

## Alternatives considered

- **Colocate each webpage's web files in its project folder and copy them into a deploy directory with a script.** Rejected earlier as an extra step with no benefit over serving `web/` directly.
- **A static site generator or bundler (Hugo, Astro, Vite) run by Workers Builds.** Adds a toolchain, dependency upkeep and build failures to what are mostly single-file webpages.
- **A GitHub Actions build that deploys with `wrangler`.** Same toolchain cost, plus a workflow and secrets to maintain, and it gives up the GitHub-app deploy.
- **Allow a build for webpages that need one.** Possible later; this ADR would then be superseded by one that says how builds are scoped, so that single-file webpages stay build-free.

## Revisit when

Webpages need npm dependencies in the browser, client-side TypeScript, or shared code that cannot be a plain ES module. Supersede this ADR with a new one at that point rather than quietly adding a build.

Related: [0001 web styling](0001-web-styling.md) (colors are baked into static CSS at authoring time, consistent with this rule).
