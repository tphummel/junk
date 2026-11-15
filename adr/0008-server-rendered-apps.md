# 0008: How server-rendered apps are hosted on the junk Worker

- Status: Proposed
- Date: 2026-11-15

## Context

The junk Worker serves static pages from `web/` ([ADR 0003](0003-webpages.md)) and JSON APIs under `/api/*` ([ADR 0004](0004-apis.md)). Neither covers an app whose HTML is rendered per request from stored data, with its own routes under one path. The hosted Jigseer (`jigseer-saas/`, served at `/jigseer/`) is the first. [ADR 0005](0005-cloudflare-workers-deployment.md) deploys one Worker and sets `assets.run_worker_first` to `/api/*`; [ADR 0002](0002-no-web-build-step.md) bans a build step for `web/`.

## Decision

1. **A top-level project folder** holds the app (`jigseer-saas/`). It exports one Hono app, with its source in `src/`, tests in `test/`, migrations in `migrations/` ([ADR 0007](0007-worker-storage.md)), and a `README.md`. The folder name may differ from the mount path when the obvious name is taken (`jigseer/` is the self-hosted Docker image).
2. **Mounted at `/<name>`.** `api/index.ts` imports the app and mounts it with `app.route("/<name>", sub)`, alongside the `/api` routes, in alphabetical order. `<name>` is lowercase kebab-case and must not collide with a `web/` directory that has an `index.html`. Durable Object classes are re-exported from `api/index.ts`.
3. **Routing in `wrangler.jsonc`.** `assets.run_worker_first` gains `/<name>/*` and a negative pattern for the app's static files, for example `["/api/*", "/jigseer/*", "!/jigseer/static/*"]`, so dynamic paths run Worker code and static files are served as plain assets.
4. **Static files** (CSS, client JavaScript, icons) go in `web/<name>/static/`, are committed as they will be served, and are not bundled ([ADR 0002](0002-no-web-build-step.md)). The app's own server code is bundled by wrangler, as the APIs are. Client JavaScript is a plain ES module with no framework.
5. **HTML is rendered with Hono JSX** (`.tsx`), which escapes by default. Raw HTML injection is not used. Layout and components live inside the project; nothing is shared with `web/` pages or other projects.
6. **One URL helper.** The app is mounted under a prefix, so every link, form `action`, redirect, event-stream and share URL is built by a single `url()` helper that adds it. A test scans rendered HTML for root-relative `href` and `action` values missing the prefix.
7. **Forms post and redirect** (`303`), so a refresh does not resubmit. Input is validated on the server and bad input renders the page again with a message, status `400`; no stack traces.
8. **Public, like the APIs.** No authentication. Anonymous write endpoints get a rate limit (Workers Rate Limiting binding), keyed on the client IP. The binding only offers 10 or 60 second periods, counted per location, so "N per second" means a rate averaged over a period, not a strict gate. Anything needing protection needs its own ADR first ([ADR 0004](0004-apis.md)).
9. **Register it** in `web/index.html` under the heading for its class (Tools, Games, Toys), per [ADR 0003](0003-webpages.md).
10. **Tests** use `node:test`. The `test` script in `package.json` covers `jigseer-saas/test/**` as well as `api/**`. Route tests call `app.request()` with a stub env; SQL tests follow [ADR 0007](0007-worker-storage.md).

## Consequences

- Another stateful product is a folder, a mount line, a `run_worker_first` entry and its bindings, not a new Worker or domain.
- Every app in the shared Worker deploys together: one failing bundle or migration blocks the site ([ADR 0005](0005-cloudflare-workers-deployment.md)).
- `api/index.ts` and `wrangler.jsonc` become registries that parallel sessions conflict on; keep both entries.
- Routes under a prefix make a missed `url()` a 404; the link-scan test catches most of them.
- Server-rendered pages cost a Worker invocation per view, unlike static pages.
- Worker-first static paths depend on pattern order and negation; a wrong pattern shows up as missing or slow assets and is only checked by running the dev server or a preview.

## Alternatives considered

- **A separate Worker per app.** Isolated deploys and rollbacks and its own hostname, but needs a `wrangler.jsonc`, a Workers Builds project and a domain each; rejected for now because the junk Worker already deploys previews and one more path is cheaper.
- **Putting the app under `/api/<name>`.** Fits ADR 0004, but that ADR promises JSON in and out, and HTML pages and static assets would not belong there.
- **Cloudflare Pages Functions.** No Durable Objects ([ADR 0005](0005-cloudflare-workers-deployment.md)).
- **A framework such as React or a full-stack meta-framework.** Adds a build step and runtime for pages that are forms and tables.

## Open

- Whether the mounted-prefix approach holds up for a second app, or whether apps should move to their own Workers once there are more than a couple.
- Where per-project rate-limit settings live (`wrangler.jsonc` `ratelimits`) and whether a strict per-second gate (a Durable Object) is ever needed. Jigseer starts at `limit: 10, period: 10` for all `POST`s, which is one write per second on average; revisit if players on one network are throttled.
