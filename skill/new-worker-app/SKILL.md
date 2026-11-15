---
name: new-worker-app
description: Add a server-rendered app with its own state (D1, Durable Objects) to the junk Worker, served at junk.tomhummel.com/<name>/. Use when asked for an app with stored data and HTML pages rendered per request that fits neither web/ (static) nor api/ (JSON), and is not a Docker image.
metadata:
  version: "1.0.0"
---

# New Worker app

Rules are in [ADR 0008](../../adr/0008-server-rendered-apps.md) (hosting) and [ADR 0007](../../adr/0007-worker-storage.md) (storage). Reference: [`jigseer-saas/`](../../jigseer-saas/README.md). Static pages use [`new-webpage`](../new-webpage/SKILL.md), JSON endpoints use [`new-api`](../new-api/SKILL.md), container apps use [`new-docker-app`](../new-docker-app/SKILL.md).

## Steps

1. **Branch** from an up-to-date `main`; run `npm ci && npm run types`.
2. **Folder** `<project>/` with `src/app.ts` (default-exports a Hono app, typed with its bindings), `src/url.ts` (the mount prefix and a `url()` helper), `migrations/`, `test/`, `README.md`.
3. **Mount** it in `api/index.ts`: one import and one `app.route("/<name>", sub)`, alphabetical. Add `/<name>/*` and `!/<name>/static/*` to `assets.run_worker_first` in `wrangler.jsonc`. Static files go in `web/<name>/static/`.
4. **Storage** per ADR 0007: bindings `<PROJECT>_DB` etc. in `wrangler.jsonc` and a matching `previews` entry pointing at `<project>-preview`; `migrations_dir` pointing at the project's `migrations/`; indexes in the same migration as the table; `npm run types` after editing.
5. **Render** with `hono/html` in `.ts` files; build every link and redirect with `url()`; POST then `303`; validate input and re-render with `400`.
6. **Tests** in `<project>/test/*.test.mjs` with `node:test`, `app.request()` and a stub env; SQL tests apply the real migrations to in-memory SQLite (copy `jigseer-saas/test/sqlite-d1.mjs`). Add the folder's test glob to `package.json`, and `src/**/*.ts` to `tsconfig.json`.
7. **Run:** `npx wrangler d1 migrations apply <BINDING> --local`, then `npm run dev`; check `npm run typecheck && npm test`.
8. **PR** with the one-time manual steps (create databases, copy IDs, dashboard deploy command) in its description. Check the preview.

## Do not

- Add a second Worker, or share a binding between projects.
- Edit an applied migration; add the next number.
- Use JSX, a framework, or a build step.
