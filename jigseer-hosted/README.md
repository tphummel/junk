# Jigseer (hosted)

A hosted, anonymous version of [`jigseer/`](../jigseer/README.md), the self-hosted Docker app for tracking a collaborative jigsaw puzzle. This one runs on the junk Cloudflare Worker at `https://junk.tomhummel.com/jigseer/`. The two share no code or data. Plan: [`PLAN.md`](PLAN.md). Rules: [ADR 0007](../adr/0007-worker-storage.md) (storage) and [ADR 0008](../adr/0008-server-rendered-apps.md) (server-rendered apps).

Status: phase 1. Only `/jigseer/status` and `/jigseer/health` exist.

## Layout

| Path | What |
| --- | --- |
| `src/app.ts` | The Hono app, mounted at `/jigseer` in `api/index.ts` |
| `src/url.ts` | `url()`: every link, redirect and form action goes through it |
| `migrations/` | Forward-only D1 schema |
| `test/` | `node:test`; `sqlite-d1.mjs` runs the real migrations on in-memory SQLite |
| `../web/jigseer/static/` | CSS and client JS, served as plain assets (not created yet) |

## Develop

From the repo root, once per checkout: `npm ci && npm run types`.

```sh
npx wrangler d1 migrations apply JIGSEER_DB --local   # creates the local database
npm run dev                                           # http://localhost:8787/jigseer/health
npm run typecheck && npm test
```

## One-time Cloudflare setup (by hand, before the first deploy)

1. Create the databases and add each printed `database_id` under `d1_databases` and `previews.d1_databases` in `wrangler.jsonc`:
   ```sh
   npx wrangler d1 create jigseer
   npx wrangler d1 create jigseer-preview
   ```
2. In the dashboard (Workers & Pages → `junk` → Settings → Build), change the deploy command to:
   ```sh
   npx wrangler d1 migrations apply JIGSEER_DB --remote && npx wrangler deploy
   ```
   How previews get `jigseer-preview` migrated is not settled yet (ADR 0007, Open). Until it is, apply them by hand: `npx wrangler d1 migrations apply jigseer-preview --remote`.
3. Set a usage notification in the Cloudflare dashboard (ADR 0007).

## What it stores

Each hit stores the player name, connection count, client IP (`CF-Connecting-IP`), user agent and timestamps. Deleting a puzzle deletes its hits.
