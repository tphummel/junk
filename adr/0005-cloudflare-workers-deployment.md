# 0005: How web/ and api/ are deployed to Cloudflare Workers

- Status: Accepted
- Date: 2026-11-14

## Context

`web/` (static files) and `api/` (a Hono Worker) ship together at `https://junk.tomhummel.com`. The owner wants deploys on every push to `main`, a preview for every PR, as much configuration as possible in the repo, and little upkeep. [ADR 0002](0002-no-web-build-step.md) removed the build step.

## Decision

1. **One Worker with static assets.** `wrangler.jsonc` sets `main: api/index.ts` and `assets.directory: ./web`. `assets.run_worker_first: ["/api/*"]` sends only API paths to Worker code; everything else is served as static files. (Pages Functions were rejected because Durable Objects cannot be defined in Pages.)
2. **Cloudflare Workers Builds deploys it**, through the Cloudflare GitHub app connected to this repo. GitHub Actions does not deploy and holds no Cloudflare credentials.
   - Push to `main`: `npx wrangler deploy`.
   - Other branches and PRs: `npx wrangler preview`, served at `https://<branch>.junk.tomhummel.com` (`previews_enabled` on the route) and reported on the PR. A change is checked there (a page at `/<name>/`, an API at `/api/<name>/...`) before merging.
   - Build command and root directory are blank. The deploy bundles `api/` and uploads `web/` as it is.
3. **Configuration lives in `wrangler.jsonc`:** the Worker name, entry point, assets, route and custom domain, `workers_dev: false` (reachable only on the custom domain), `preview_urls: true`, observability, and the `previews` block. Bindings (KV, D1, R2, Durable Objects) and vars are declared there too. Previews do not inherit production settings, so each binding or var also needs a matching `previews` entry that points at test resources, never production ones.
4. **Settings that cannot live in the repo** are set by hand in the dashboard, under Workers & Pages → `junk` → Settings → Build:

   | Setting | Value |
   | --- | --- |
   | Repository / branch | `tphummel/junk` / `main` |
   | Root directory, build command | _(blank)_ |
   | Deploy command | `npx wrangler deploy` |
   | Preview command | `npx wrangler preview` (non-production branches) |
   | Build watch paths (include) | `web/*, api/*, wrangler.jsonc, package.json, package-lock.json, tsconfig.json` |

   The Worker's name in the dashboard must equal `name` in `wrangler.jsonc`, or builds fail.
5. **Docs-only and unrelated changes do not deploy**, because of the watch paths. A new path that affects the deploy (for example `migrations/`) must be added to them.
6. **CI checks, it does not deploy.** `.github/workflows/web.yml` runs `npm run types`, `npm run typecheck` and `npm test` on PRs and pushes to `main`. A Workers Build and CI run in parallel and independently.
7. **Upkeep is automated by Dependabot** (weekly, one group for `wrangler`, `hono` and `typescript`). `compatibility_date` is changed by hand when wanted.
8. **Secrets** are never committed: `wrangler secret put` for production, `.dev.vars` locally.

## Consequences

- Merging to `main` is the release. Rolling back is a revert, or a rollback in the dashboard.
- Deploy is independent of CI, so merging with a failing check still deploys unless branch protection requires the check.
- All webpages and APIs share one deploy: a Worker that fails to bundle blocks them all, and bindings are shared across them.
- The dashboard settings are not reviewed in PRs and can drift from this table.
- Each binding needs its own test resource for previews, which must be created by hand.

## Alternatives considered

- **GitHub Actions running `wrangler deploy`.** Same toolchain, plus a workflow, an API token and secrets to maintain, and it loses the GitHub-app previews.
- **Cloudflare Pages.** No Durable Objects, and Functions are a second system to learn.
- **One Worker per API.** Better isolation and independent rollbacks, but a route and a config per API, which suits a junk drawer poorly.

## Open

Whether CI should be a required check before merge. Storage and its migrations ([ADR 0004](0004-apis.md)) will change this ADR's watch paths and possibly the deploy command.
