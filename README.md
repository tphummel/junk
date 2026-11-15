# junk

A place for things without a home: unfinished, out of date, broken things. Inspired by <https://github.com/jessfraz/junk>.

## Layout

| Path | What |
| --- | --- |
| `<project>/` | One experiment or tool per folder, each with its own `README.md`. Some have a workflow in `.github/workflows/`. |
| `web/` | Static experiments, served at `https://junk.tomhummel.com/<name>/`. |
| `api/` | The Worker behind `https://junk.tomhummel.com/api/<name>/`. |
| `adr/` | Decisions on how `web/` and `api/` are built. Read before changing them. |
| `skill/` | Agent skills for this repo. |
| `AGENTS.md` | Instructions for agents (and people) working here. |
| `HOMELAB_APP_STRATEGY.md` | Patterns from the homelab server apps (`jigseer/`, `artifact-cache/`). |

## Site and API

One Cloudflare Worker with static assets, deployed from `main` by Cloudflare Workers Builds (the GitHub app). `web/` is served as-is with no build step; `api/` is a [Hono](https://hono.dev) router for `/api/*`. `wrangler.jsonc` holds the config. Every PR gets a preview at `https://<branch>.junk.tomhummel.com`.

```sh
npm install && npm run types   # once; generates worker-configuration.d.ts
npm run dev                    # http://localhost:8787
npm run typecheck && npm test  # CI runs both on PRs
```

Pages that import ES modules need the dev server; they do not load from `file://`.

To add an experiment, follow [ADR 0003](adr/0003-web-experiments.md) (web) and [ADR 0004](adr/0004-api-experiments.md) (API).

## Cloudflare dashboard settings

Set by hand under Workers & Pages → `junk` → Settings → Build (not representable in `wrangler.jsonc`):

| Setting | Value |
| --- | --- |
| Repository / branch | `tphummel/junk` / `main` |
| Root directory, build command | _(blank)_ |
| Deploy command | `npx wrangler deploy` |
| Preview command | `npx wrangler preview` (preview builds on non-production branches) |
| Build watch paths (include) | `web/*, api/*, wrangler.jsonc, package.json, package-lock.json, tsconfig.json` |

The Worker name in the dashboard must equal `name` in `wrangler.jsonc`, or builds fail. Secrets are never committed: use `wrangler secret put <NAME>` (production) or `.dev.vars` (local, gitignored). There are none yet.
