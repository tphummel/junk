# 0005: How web/ and api/ are deployed to Cloudflare Workers

- Status: Accepted
- Date: 2026-11-14

## Context

`web/` and `api/` ship together at `https://junk.tomhummel.com`. The owner wants a deploy on every push to `main`, a preview for every PR, as much configuration as possible in the repo, and little upkeep.

## Decision

1. **One Worker with static assets.** `wrangler.jsonc` sets `main: api/index.ts` and `assets.directory: ./web`, and `assets.run_worker_first: ["/api/*"]` sends only API paths to Worker code. (Pages Functions were rejected because Durable Objects cannot be defined in Pages.)
2. **Cloudflare Workers Builds deploys it**, through the Cloudflare GitHub app. GitHub Actions does not deploy and holds no Cloudflare credentials.
   - Push to `main`: `npx wrangler deploy`.
   - Other branches and PRs: `npx wrangler preview`, served at `https://<branch>.junk.tomhummel.com` and reported on the PR. Check a change there before merging.
   - The build command is blank: the deploy bundles `api/` and uploads `web/` as it is ([ADR 0002](0002-no-web-build-step.md)).
3. **Configuration lives in `wrangler.jsonc`:** name, entry point, assets, custom-domain route (with `previews_enabled`), `workers_dev: false`, `preview_urls: true`, observability, and the `previews` block. Bindings (KV, D1, R2, Durable Objects) and vars are declared there too. Previews do not inherit production settings, so each binding or var needs a matching `previews` entry pointing at test resources, never production ones. Secrets are never committed: `wrangler secret put` for production, `.dev.vars` locally.
4. **Dashboard settings** cannot live in the repo and are set by hand under Workers & Pages → `junk` → Settings → Build:

   | Setting | Value |
   | --- | --- |
   | Repository / branch | `tphummel/junk` / `main` |
   | Root directory, build command | _(blank)_ |
   | Deploy command | `npx wrangler deploy` |
   | Preview command | `npx wrangler preview` (non-production branches) |
   | Build watch paths (include) | `web/*, api/*, wrangler.jsonc, package.json, package-lock.json, tsconfig.json` |

   The Worker's name in the dashboard must equal `name` in `wrangler.jsonc`. Changes outside the watch paths, such as docs, do not deploy; a new path that affects the deploy (for example `migrations/`) must be added.
5. **CI checks and does not deploy.** `.github/workflows/web.yml` runs typecheck and tests, in parallel with and independent of the Workers Build.

## Consequences

- Merging to `main` is the release. Rolling back is a revert or a dashboard rollback.
- A failing CI check does not block the deploy unless branch protection requires it.
- All webpages and APIs share one deploy and its bindings: a Worker that fails to bundle blocks them all.
- Dashboard settings are not reviewed in PRs and can drift from the table above.
- Test resources for previews must be created by hand.

## Alternatives considered

- **GitHub Actions running `wrangler deploy`.** Adds a workflow, an API token and secrets to maintain, and loses the GitHub-app previews.
- **Cloudflare Pages.** No Durable Objects.
- **One Worker per API.** Better isolation and independent rollbacks, but a route and a config per API.

## Open

Whether CI should be a required check. Storage ([ADR 0004](0004-apis.md)) will add watch paths and possibly change the deploy command.
