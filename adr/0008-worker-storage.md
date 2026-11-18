# 0008: How Worker projects store data

- Status: Proposed
- Date: 2026-11-15

## Context

[ADR 0004](0004-apis.md) left storage open: which of KV, D1, R2 and Durable Objects, and whether projects share bindings. The first stateful project, a hosted Jigseer (`jigseer-hosted/`), needs relational data (puzzles and hits, with window-function queries) and per-puzzle realtime coordination. [ADR 0005](0005-cloudflare-workers-deployment.md) says previews do not inherit production bindings, and Workers Builds runs only the commands set in the dashboard.

## Decision

1. **Pick by data shape.**

   | Need | Use |
   | --- | --- |
   | Relational data, queries, exports | D1 |
   | Per-key coordination, WebSocket fan-out, counters needing strong consistency | Durable Objects (SQLite-backed classes only) |
   | Small config or cache, read often, written rarely | KV |
   | Files and blobs | R2 |

   Start with the simplest that fits. D1 is the default store; a Durable Object holds state only when it must be consistent per key or must hold connections.
2. **Dedicated bindings, prefixed by project.** Each project gets its own D1 database, bucket, namespace and Durable Object classes, bound as `<PROJECT>_<KIND>` (`JIGSEER_DB`, `JIGSEER_ROOM`). Databases and buckets are named `<project>` (production) and `<project>-preview`. No binding is shared between projects, so one project cannot read another's data.
3. **Previews use test resources.** Every binding in `wrangler.jsonc` has a matching entry under `previews` pointing at the `-preview` resource, never production ([ADR 0005](0005-cloudflare-workers-deployment.md)). Preview data is disposable.
4. **Resources are created by hand,** once, before the first deploy that needs them (`wrangler d1 create`, and so on). The PR that adds a binding lists the commands and the resulting IDs go into `wrangler.jsonc`.
5. **Schema lives in the project folder** as numbered, forward-only SQL files in `<project>/migrations/` (`0001_init.sql`), applied by `wrangler d1 migrations apply`. `migrations_dir` in `wrangler.jsonc` points at it. A migration never edits an applied file; fix mistakes with a new one.
6. **Migrations run in the deploy command,** before the Worker deploys: `npx wrangler d1 migrations apply <DB binding> --remote && npx wrangler deploy`. A failed migration stops the deploy. Migrations are backward compatible with the code currently running (add, then backfill, then drop in a later release), because the old Worker serves traffic during a deploy and a rollback restores old code against the new schema.
7. **Backups** are D1 Time Travel (point-in-time restore); no extra job until data is worth more than that.
8. **Tests run the real SQL.** Project tests apply the migration files to in-memory SQLite with Node's built-in `node:sqlite`, behind a small adapter with D1's `prepare().bind().all()/first()/run()` shape. Tests do not need a Cloudflare account or network.
9. **Limits are account-wide.** The account is on Workers Paid. Quotas and bills are shared by every Worker, API and project in this repo, so dedicated bindings isolate data, not usage. Rules:
   - Every query on a hot path (pages, polling, writes) is covered by an index, because D1 bills rows scanned, not queries. Migrations create the indexes with the table.
   - A project's `README.md` states its expected daily reads, writes and requests, and the limits it relies on.
   - A usage notification is set in the Cloudflare dashboard, since Paid has no hard daily cutoff and an abused public write endpoint shows up as a bill, not an outage.
10. **Data is public by capability.** Access is by an unguessable URL, not by account. Projects store no secrets and no personal data beyond request metadata they document in their README (Jigseer stores the client IP and user agent with each hit). Anything more needs its own ADR (authentication is still open from ADR 0004).

## Consequences

- Adding a stateful project is a set of bindings, a migrations folder, and the manual creation steps.
- A project's data is isolated, at the cost of more bindings in one `wrangler.jsonc` that parallel sessions will conflict on; keep both entries.
- Because migrations run in the deploy of the shared Worker, a failed migration stops the deploy of every page and API until fixed; the version already live keeps serving ([ADR 0005](0005-cloudflare-workers-deployment.md)). A migration that succeeds but breaks the live code only breaks that project's routes, which is why migrations must be backward compatible.
- Preview databases must be migrated too, or previews fail. How `wrangler preview` applies migrations to the preview database is not settled and must be verified in the first project (see Open).
- `node:sqlite` is SQLite, not D1: D1-only behavior (limits, batching semantics) is not covered by tests.

- Paid removes the daily D1 row caps and the Worker request cap that Free has, but not the per-database and per-object size limits. Current limits are in the Cloudflare docs and are not copied here.

## Alternatives considered

- **One shared D1 database with per-project table prefixes.** Fewer resources, but any project's code can read every other project's data, and one bad migration affects all.
- **Durable Object SQLite as the store for everything.** Strong per-key consistency and isolation, but cross-key queries and listings need fan-out; D1 fits the first use better.
- **KV for puzzles and hits.** No queries or transactions; the leaderboard and story views need both.
- **An external database through Hyperdrive.** Adds a service, credentials and cost for no benefit at this size.
- **Applying migrations by hand.** Cheap, but drifts from the code and is easy to forget on a deploy-on-merge repo.
- **Vitest with `@cloudflare/vitest-pool-workers`.** Exercises real D1, but adds a second test runner against the `node:test` convention in ADR 0004.

## Open

- How previews get their `-preview` database migrated: whether the preview command can run `d1 migrations apply` before `wrangler preview`, or whether it needs a script. Verify in phase 1 of Jigseer and amend by a new ADR if the answer changes the deploy commands.
- A hard spending or usage cap per project, if any project's traffic starts to matter. Cloudflare notifies; it does not stop.
