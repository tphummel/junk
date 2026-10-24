# daily-solitaire

A self-hosted, server-only Klondike game: **one shared deal per day**, passkey-only accounts, every move
stored forever. One Go binary, one SQLite file, one Docker image. Built from
[klondike-technical-plan.md](./klondike-technical-plan.md) (the design doc this implements).

- Server-authoritative and event-sourced: a game is `(variant, ruleset, seed)` plus an append-only move list; state is always a replay.
- Server-rendered HTML with Hotwire: a move is a form POST + redirect and Turbo morphs the changed piles. Tap-to-move works with JavaScript off.
- Pure Go (`modernc.org/sqlite`, no CGO), `html/template`, `go-webauthn`, embedded assets, no bundler.

## Run it

```bash
make run                      # http://localhost:8080 (DATABASE_PATH=./data/app.db)
make test                     # go test -race ./...
make build                    # bin/daily-solitaire, bin/admin, bin/solver (CGO_ENABLED=0)
make docker-build             # Litestream-wrapped distroless image
make docker-run               # local container, no replication
```

Requires Go 1.25 (`.tool-versions`). Passkeys need `localhost` or HTTPS, so local dev works as-is.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` / `METRICS_PORT` | 8080 / 9090 | App and Prometheus `/metrics` listeners (separate so scraping never blocks play) |
| `DATABASE_PATH` | /data/app.db | The one SQLite file |
| `RP_ID` | localhost | WebAuthn relying-party ID. **Choose the final hostname before launch; changing it strands every passkey** |
| `RP_ORIGINS` | http://localhost:8080 | Comma-separated allowed origins |
| `RP_DISPLAY_NAME` | Daily Solitaire | |
| `BASE_URL` | first origin | Used by the admin CLI to print links; `https` makes cookies `Secure` + `__Host-` |
| `SESSION_SECRET` | (generated) | Keys CSRF tokens |
| `SIGNUPS` | open | `open` or `closed` (closed: accounts via the admin CLI) |
| `TRUST_PROXY` | false | Read client IP from `X-Forwarded-For` (behind Caddy / tunnel) |
| `LOG_LEVEL` | info | JSON `slog` to stdout |

Endpoints: `/healthz`, and `/metrics` on the metrics port.

## Layout

```
cmd/server    the app            cmd/admin   operator CLI           cmd/solver  offline seed solver
internal/klondike   rules engine: seeded deals, moves, undo, replay, solver, golden fixtures
internal/store      SQLite: migrations, accounts, daily deals, games/moves, views
internal/web        handlers, passkey ceremonies, templates, static (Turbo, Stimulus vendored)
internal/dates      Pacific day boundary, 3 a.m. grace deadline
```

## How the rules landed

- **Daily deal:** first play request of a date mints the seed (`INSERT … ON CONFLICT DO NOTHING` then `SELECT`) from the unused pool at random; everyone gets the same cards. Day = calendar date in `America/Los_Angeles` (`time/tzdata` compiled in).
- **One play per deal:** `UNIQUE(user_id, deal_date)`. Catch-up for any unplayed date from 2026-10-01.
- **Grace:** a game closes as a loss at 3:00 a.m. Pacific the morning after the day it was *started* (checked lazily on every request plus a 1-minute sweeper).
- **Moves counted:** move, draw, recycle, undo (undo doesn't refund). Auto-complete (offered only when stock/waste are empty and nothing is face-down) and resign add none. Draw 3, unlimited passes, no hints.
- **Tap rule:** foundation if possible, else leftmost legal column; no destination = nothing happens, no move. (A king already at a column base never "moves" to an empty column.)
- **Board:** wins, then fewest moves, then fastest first-to-last-move time; hidden until you've finished that date yourself.
- **No leaks:** face-down and stock cards are rendered with positional ids and no identity; the browser holds no game state.
- **Golden suite:** `internal/klondike/testdata/golden.jsonl` holds solver-proven games that must replay to the same final position; recorded draws/recycles are checked against the replay. Bump `EngineVersion` only with those passing.

## Seed pool (winnable-only deals)

```bash
bin/solver -random -want 10000 -out seed-pool.jsonl   # offline, hours of CPU; ~60% of deals solve within the default 300k-node budget
bin/admin load-seeds seed-pool.jsonl                  # re-verifies every solution with the engine
bin/admin pool
```

The file is git-ignored; keep it out of public repos. With an empty pool the server still works but mints unproven random seeds (and logs a warning).

## Accounts

Passkeys only (discoverable credentials, conditional-UI autofill on the username field; user verification required). Multiple named passkeys with authenticator name (from a small built-in AAGUID map), revoke (never the last), step-up (fresh UV assertion, 5 min) before adding/removing passkeys, export, delete and regenerating recovery codes; hashed one-time recovery codes; device/session list with revoke and sign-out-everywhere; user-visible security log; WebAuthn Signals; SameSite=Strict cookies + CSRF tokens + `http.CrossOriginProtection`; rate-limited ceremony endpoints; account deletion is one cascading `DELETE`; export is a versioned JSON archive.

Admin CLI (works on the DB file; `docker exec` into the container):

```
admin create-user <name> [display]    # prints a single-use sign-in link (for SIGNUPS=closed)
admin recovery-link <name>            # single-use, 1 hour
admin list-users | disable-user <name> | enable-user <name> | load-seeds <file> | pool
```

## Deploy

Image: multi-stage `CGO_ENABLED=0` build → distroless with the Litestream binary as PID 1 (`-exec` starts the app). Set `LITESTREAM_REPLICA_URL`, `LITESTREAM_ENDPOINT`, `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY` (see `litestream.yml`; add a second replica for offsite). Mount a volume on `/data`. Caddy stanza:

```
solitaire.example.com {
    reverse_proxy localhost:8080
}
```

Run with `TRUST_PROXY=true`, `RP_ID=solitaire.example.com`, `RP_ORIGINS=https://solitaire.example.com`.
CI: `.github/workflows/daily-solitaire.yml` (test, vet, build/push to GHCR) like the sibling apps.

## Status vs. the plan

Done: milestones 1–6 in substance and the image/CI part of 7 — engine + solver + golden tests, schema/migrations, passkeys, board with tap-to-move, FLIP animation + drag, view transitions, win timeline, stats views, history, replay viewer, archive export, devices/recovery/step-up/security log/Signals/admin CLI.

Not done / deviations:
- **The 10,000-seed pool is not generated** (run `make seeds`); only 13 fixtures are checked in as golden tests.
- **Docker image and Litestream wiring are unbuilt/untested** (no Docker daemon in the authoring sandbox). Terraform/Ansible/Gatus/Loki setup is out of scope here.
- `html/template` instead of `templ`; a third Stimulus controller (`passkey`) is needed for WebAuthn, beyond the plan's two (animation, drag).
- AAGUID names come from a tiny built-in map, with no icons.
- Auto-complete is stricter than "all face up": it requires stock and waste empty so it can never get stuck.
- Solver solutions contain some pointless shuffling moves; they're proofs of winnability, not model play.

## Tests

`go test -race ./...` — engine (rules, undo round-trip property test, golden replays, solver), store (shared deal under concurrency, one play per deal, stale-seq conflicts, expiry at 3 a.m., board ranking, streaks, cascade delete), web (full passkey signup/login/step-up/recovery flows with `virtualwebauthn`, playing a solver proof through the real HTTP endpoint, no-spoiler and privacy checks, CSRF/headers). A manual Playwright pass with a virtual authenticator confirmed signup, conditional-UI sign-in, morph keeping element identity, tap-to-move, undo, resign and the replay frame.
