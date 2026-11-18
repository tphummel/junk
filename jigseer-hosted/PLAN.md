# Jigseer on Cloudflare: move the Docker app into the junk Worker

Status: draft plan, nothing built yet.

Scope, as decided:
- **Hosted, anonymous.** Same product as today (a puzzle is a short code in a URL). No accounts, no paid plans.
- **Hangs off junk.** It is served at `https://junk.tomhummel.com/jigseer/` by the existing `junk` Worker, not a separate Worker or hostname.
- **No admin.** `/admin` and the SQLite download are dropped, not ported.
- **Starts empty.** No data migration from the Fly app.
- **`jigseer/` stays.** The self-hosted Docker image (PHP, SQLite, GHCR workflow, `fly.toml`) remains in the repo and is not retired. The hosted app is a separate project, `jigseer-hosted/`, that reimplements it on Cloudflare; the two do not share code or data.

Goal: everything `jigseer/` does today, except admin, runs on Workers, Static Assets, D1 and Durable Objects, with no container and no volume.

## 1. What exists today

| Piece | Where | Size |
| --- | --- | --- |
| Router and all handlers | `src/Application.php` | 889 lines |
| SQLite layer, two tables (`puzzles`, `hits`) | `src/Database.php` | 315 lines |
| Request/Response helpers, templating | `src/Http/*`, `src/TemplateRenderer.php`, `src/support.php` | ~380 lines |
| Server-rendered views | `templates/` | ~1,200 lines |
| Tests | `tests/run.php` (PHP, no PHPUnit) | 635 lines |
| Delivery | `Dockerfile`, `Caddyfile`, `fly.toml`, `.github/workflows/jigseer.yml` (GHCR image) | |

Routes to port (all under `/jigseer` in the new home):

| Route | Behavior |
| --- | --- |
| `GET /` , `GET /?code=X` | Home form; a code redirects to `/p/X/play` |
| `POST /puzzles` | Create a puzzle (name, optional piece count); 6-char code from an unambiguous alphabet |
| `GET /p/:id/{play,leaderboard,story,transcript,settings}` | Server-rendered tabs (`/p/:id` is `play`) |
| `POST /p/:id/hits` | Record a hit (player, connection count) |
| `POST /p/:id/settings`, `/settings/delete` | Update pieces and notes; delete the puzzle after typing `delete` |
| `GET /p/:id/settings/export` | ZIP of `puzzle.csv` and `hits.csv` |
| `POST /p/:id/transcript/delete` | Delete one hit |
| `GET /p/:id/qr` | QR code for the share URL, cached forever |
| `GET /p/:id/events` | SSE: one "refresh" event when a newer hit exists, else keep-alive; the client reconnects |
| `GET /status`, `/health` | Health JSON |
| ~~`/admin`, `/admin/database`~~ | Dropped |

Logic to keep as-is, with its tests ported: the leaderboard SQL (window `LAG`, 20-minute activity gap, recent-100 hits), story session grouping (20-minute gaps, sessions under 2 connections dropped, "current" if the last hit was within 20 minutes), `format_duration`, progress (`total_pieces - 1` connections), stable player colors by first hit.

## 2. Target architecture

```
Browser ──► junk Worker (api/index.ts)
              ├─ /api/*            existing Hono APIs (unchanged)
              ├─ /jigseer/*        Jigseer Hono app (`html` templates), mounted with basePath
              ├─ static assets     web/ as today; Jigseer's CSS/JS in web/jigseer/static/
              ├─ D1  "JIGSEER_DB"  puzzles, hits
              └─ DO  "JIGSEER_ROOM" one hibernating WebSocket room per puzzle, fan-out only
```

| Today | Cloudflare |
| --- | --- |
| FrankenPHP + Caddy | The junk Worker; the app is a Hono sub-app mounted at `/jigseer` |
| `public/` static files | Static Assets under `web/jigseer/static/`, served without running Worker code |
| PHP templates | Hono `html` tagged templates in `.ts` (auto-escaped, same markup); no JSX, because the test runner cannot transform it (ADR 0009) |
| SQLite file via PDO on a Fly volume | **D1.** Same SQLite dialect, so the schema and the `LAG` query port nearly verbatim; foreign keys and `ON DELETE CASCADE` are on by default. Backups: D1 Time Travel (30-day point-in-time restore), no extra job |
| SSE that polls the DB on each reconnect | Phase 4: a Durable Object per puzzle holds WebSockets (hibernation API); the Worker pings it after each write and it broadcasts "refresh". Until then, keep the SSE endpoint, one indexed D1 read per poll. SSE stays as the fallback afterwards |
| `api.qrserver.com` fetch plus GD placeholder, PNG cached on disk | QR generated in the Worker with a small pure-JS library, as SVG: no network call, no placeholder case; `Cache-Control: public, immutable` |
| Hand-rolled ZIP via `pack()` | Same stored-ZIP writer ported to TS (or `fflate`); CSV via a small escaper |
| `/health` with Fly env vars | `/jigseer/health`: D1 ping, version, `request.cf.colo` |
| Fly auto-stop/start, 1 GB VM | Nothing to size |

Why D1 is the system of record and the Durable Object only does realtime: queries and exports stay plain SQL over one database, and the schema is the existing SQLite one. One SQLite-backed Durable Object per puzzle as the store is the alternative; it isolates tenants but makes any cross-puzzle query awkward, and nothing needs one now that admin is gone.

R2 is not used. It would only serve the unimplemented puzzle-photo feature, which stays out of scope, so the new schema has no `image_path` column. It keeps `ip_address`.

## 3. How it fits this repo, and what needs an ADR first

The existing rules cover JSON APIs under `/api/*` and static pages in `web/`. A server-rendered app with state fits neither, so write these before code:

- **ADR 0008, storage on the junk Worker.** Resolves the "Storage" item left open in ADR 0004: D1 for relational data, Durable Objects for realtime coordination, KV for config; dedicated bindings per project, named with a project prefix (`JIGSEER_DB`), so one project cannot read another's data by accident; every binding gets a `previews` entry pointing at a test resource, never production; D1 migrations live in the project folder and are applied by the deploy command.
- **ADR 0009, server-rendered apps on the junk Worker.** A project folder at the top level exports a Hono app; `api/index.ts` mounts it at `/<name>` and re-exports any Durable Object classes; no routing config, because paths with no matching file in `web/` already reach the Worker. Anonymous and public, like the APIs.

No authentication ADR is needed: nothing in scope is protected. (If admin returns later, it will need one, per ADR 0004.)

Also add `skill/new-worker-app/SKILL.md`, a link in `web/index.html` under Games or Tools, and leave `skill/new-docker-app` alone: `jigseer/` remains its reference app.

## 4. Layout

```
jigseer-hosted/
├── PLAN.md → README.md once built
├── migrations/0001_init.sql
├── src/
│   ├── app.ts              # Hono app, routes; exported for api/index.ts
│   ├── routes/             # puzzles, hits, settings, export, qr, events, health
│   ├── db.ts               # D1 queries (ported from Database.php)
│   ├── domain/             # pure logic: story, leaderboard, duration, code, progress
│   ├── room.ts             # Durable Object (phase 4)
│   ├── export.ts           # CSV + ZIP
│   ├── qr.ts
│   └── views/              # html templates: Layout, Nav, Breadcrumb, Play, Leaderboard, Story, Transcript, Settings, Home, NotFound, partials
└── test/                   # node:test
web/jigseer/static/         # app.css, live.js
api/index.ts                # + app.route("/jigseer", jigseer) and DO export
wrangler.jsonc              # + d1_databases, durable_objects, migrations, previews entries
```

Changes to the root: `wrangler.jsonc` (bindings and `migrations_dir` pointing at `jigseer-hosted/migrations`) and the mount line in `api/index.ts`. The `test` glob in `package.json` is `**/*.test.mjs`, and `tsc` follows imports, so neither needs a per-project edit.

## 5. Testing

- Port `tests/run.php` case by case to `node:test`.
- Pure `domain/` modules get plain unit tests.
- SQL runs against in-memory SQLite using Node 22's built-in `node:sqlite` behind a thin D1-shaped adapter (`prepare().bind().all()/first()/run()`), so the same migration file and the same queries run in tests with no extra tooling.
- Route tests use `app.request()` with a stub env, as `new-api` describes.
- A manual pass per phase on the PR preview, including two phones for realtime.

## 6. Phases (each one a PR)

1. **ADRs and skeleton.** ADR 0008 and 0009, folder scaffold, `wrangler.jsonc` with D1 and previews, migration `0001`, `/jigseer/health`, test wiring. By hand: create the production and preview D1 databases and set the dashboard deploy command to apply migrations before `wrangler deploy` (and for previews, the preview database), documented in the PR. Also set a usage notification in the dashboard.
2. **Core parity.** Domain modules and tests, `db.ts`, home, create, play, hits, leaderboard, story, transcript, settings, delete, with templates ported from `templates/*.php` and SSE polling for live updates.
3. **Remaining routes.** QR (SVG) and the export ZIP.
4. **Realtime upgrade.** `JIGSEER_ROOM` Durable Object with WebSocket hibernation; the Worker notifies it after writes; the client uses the socket and falls back to SSE.

Two projects now carry the name, so the READMEs of both should say which is which and link to each other. Nothing in `jigseer/` changes otherwise.

## 7. Risks and decisions inside the port

- **Base path.** The old app links to `/p/...`, `/puzzles` and form actions from the site root. Every link, redirect, form `action`, the SSE URL, and the QR share URL must go through one `url()` helper that adds `/jigseer`. A missed one is a 404 that tests only catch if they check links, so add a test that scans rendered HTML for root-relative `href`/`action` values that lack the prefix.
- **Static assets.** `run_worker_first` stays `["/api/*"]`: files in `web/jigseer/static/` are served as assets and every other `/jigseer/*` path reaches the app. `web/jigseer/` must contain only `static/`, or a file there shadows a route. Verified in `wrangler dev`; check once on a preview.
- **Shared Worker.** Per ADR 0005, a bundling or migration failure here blocks deploys of every page and API on the site (the live version keeps serving). Keep the Jigseer import cheap and the migration step safe to re-run.
- **Timestamps.** The leaderboard gap math uses `strftime('%s', …)`. Write UTC ISO strings (`2026-11-14T10:00:00Z`) so text order matches time order.
- **Privacy.** Hits store the client IP (`CF-Connecting-IP`) and user agent, as the self-hosted app does. A hosted service is a different promise than a homelab one: the README says what is stored and that deleting a puzzle deletes its hits.
- **Rate limit: 1 write per second per client.** Applies to every `POST` (`/puzzles`, hits, settings, deletes), keyed on the client IP. The Workers Rate Limiting binding only supports 10 or 60 second periods and counts per Cloudflare location, so the closest setting is `limit: 10, period: 10` (1 per second on average, bursts of up to 10). A strict 1-per-second gate would need a Durable Object, which is more than this is worth. Over the limit returns `429` with `Retry-After` and the page shows a "slow down" message; the hit is not recorded, so the play buttons must keep the player's input on screen. Players on one wifi share an IP, so a table of people tapping at once may trip it; if that happens in practice, key on IP plus puzzle plus player name instead. Turnstile only if spam appears.
- **Cost model.** The account is on Workers Paid, so there are no daily D1 or request cutoffs; abuse and runaway polling show up as a bill. Polling SSE is one Worker request and one D1 read per client every few seconds, which phase 4 removes. D1 bills rows scanned, so `0001_init.sql` creates indexes on `hits(puzzle_id, created_at)` and `hits(puzzle_id, updated_at)`, and the Jigseer README states expected daily reads, writes and requests (ADR 0008). Declare the Durable Object class as SQLite-backed in the `migrations` block (the free plan only allows that kind), and check current plan limits before phase 4.
- **Redirects.** Keep POST-then-redirect with 303 so refreshes do not resubmit. `html` templates escape by default; use `raw()` only for markup the app built.
- **Fly-specific code** (`FLY_*` env vars in `/health`) is dropped.

## 8. Assumptions to confirm

1. **Rate limit approximation:** `limit: 10, period: 10`, keyed on IP, rather than a strict 1 per second.
2. **Path name:** `/jigseer/` on `junk.tomhummel.com`.
