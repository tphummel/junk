# junk

a place for things without a home: unfinished, out of date, broken things

inspired by https://github.com/jessfraz/junk

## Site and API (junk.tomhummel.com)

A single Cloudflare Worker with static assets, deployed from `main` by Cloudflare Workers Builds (GitHub app).

- `web/` is served as-is at `https://junk.tomhummel.com/` (no build step)
- `api/` is a Hono router served at `https://junk.tomhummel.com/api/*`; register each app in `api/index.ts`
- `wrangler.jsonc` is the source of truth: Worker name, assets, routing, custom domain, and any bindings (KV, D1, R2, Durable Objects)
- Local dev: `npm install && npm run types && npm run dev`

### Dashboard settings (not representable in wrangler.jsonc)

Workers & Pages → `junk` → Settings → Build:

| Setting | Value |
| --- | --- |
| Git repository / branch | `tphummel/junk` / `main` |
| Root directory | _(blank)_ |
| Build command | _(blank)_ |
| Deploy command | `npx wrangler deploy` |
| Preview command | `npx wrangler preview` (preview builds enabled for non-production branches) |
| Build watch paths (include) | `web/*, api/*, wrangler.jsonc, package.json, package-lock.json, tsconfig.json` |

The Worker name in the dashboard must match `name` in `wrangler.jsonc` or builds fail.

### Secrets

Secrets are not in the repo. Set them with `wrangler secret put <NAME>` (production) or `.dev.vars` (local, gitignored). Required secrets: _none yet_.
