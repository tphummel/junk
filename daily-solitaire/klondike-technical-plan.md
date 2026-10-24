# Klondike — Technical Plan

Oct 21, 2026 · @Tom

## Summary

Build a self-hosted, server-only Klondike game: one Go binary and one SQLite database in a single Docker image, rendered with Hotwire/Turbo, passkey-only accounts, and every move stored forever. Offline play and importing games are out of scope.

- **One shared daily deal.** The first player of the day mints the seed; everyone that day plays the same game.
- **Server-authoritative.** Every move is a request; the Go engine validates it and appends it. The browser holds no game state.
- **Event-sourced games.** A game is (variant, ruleset, seed) plus an append-only list of moves. State is always a replay; nothing is overwritten.
- **One database.** A single SQLite file holds all users, replicated continuously by Litestream.
- **Variant-ready.** Games and deals carry a `variant` column (always `klondike` for now) and the engine lives in its own package. A shared interface waits until a second game exists.

## Architecture and stack

Everything is server-rendered HTML. A move is a form POST; the server validates it and redirects back to the game page, and Turbo 8 morphing patches only the DOM that changed. Tap-to-move works with zero JavaScript; a small Stimulus controller adds drag and card animation as an enhancement.

&#91;embedded content: architecture · browser, Go app, storage\]

The browser only renders what the server sends; the engine, all game state and every account record live in one Go process and one SQLite file.

| Layer | Choice | Why |
| --- | --- | --- |
| Server | Go, stdlib `net/http` routing | One static binary, no framework |
| Templates | `templ` (or `html/template`) | Type-safe components, Turbo Frame friendly |
| Hotwire | Turbo Drive, Frames, morphing; Stimulus | Smooth moves and navigation without an SPA |
| Page transitions | View Transitions API via Turbo | Native cross-page animation, zero custom JS |
| Rules engine | Pure Go package, server only | Single source of truth for legality |
| SQLite driver | `modernc.org/sqlite` (pure Go) | CGO-free, distroless image |
| Migrations | Embedded SQL, run at startup | One schema, one database |
| Passkeys | `go-webauthn/webauthn` | Mature WebAuthn server library |
| Assets | `embed.FS`, import maps, no bundler | Nothing to build but Go |
| Backup | Litestream | Continuous replication of one file |

Deals are seeded: the engine shuffles from a 64-bit seed with a fixed PRNG, so any game can be replayed exactly, and one stored seed per day is all the daily deal needs.

## Data model

One SQLite file, `/data/app.db`, holds everything. Every user-owned row carries `user_id` with `ON DELETE CASCADE`, so account deletion is one statement and export is one query.

- **Accounts:** `users`, `credentials` (passkeys), `sessions`, `recovery_codes`, `audit_log`.
- **`games`:** ULID id, user id, variant, ruleset JSON (draw count, pass limit), seed, started and ended timestamps, result, move count, engine version.
- **`moves`:** game id, seq, type (`move`, `draw`, `recycle`, `undo`, `auto`, `resign`), from and to pile, cards moved, timestamp. Primary key (game id, seq).
- **Stats:** SQL views only (daily boards, win rate, streaks, average moves), backed by indexes on `games(deal_date)` and `games(user_id)`. Nothing to rebuild or keep in sync.

Undo is a move, never a delete, so full fidelity includes mistakes and hesitation (timestamps). Each game records the engine version it was played on, and a golden suite of recorded games must replay identically before any engine change ships. Cross-user features like leaderboards become plain queries.

## Daily deal

There is one game per day. The first request for a day mints its seed; everyone who plays that day gets the same deal.

- **Day boundary:** a day is a calendar date in `America/Los_Angeles`, computed server-side. The binary imports `time/tzdata` so the distroless image needs no zoneinfo files.
- **Table:** `daily_deals` with `date` as primary key, variant, ruleset JSON, seed, created at, and the user who triggered it.
- **Hydration:** the first play request for a date takes a seed and runs `INSERT ... ON CONFLICT(date) DO NOTHING`, then `SELECT`s the row. With one SQLite writer the race resolves itself: two simultaneous first players both read the same winning seed.
- **Winnable only:** a solver CLI runs offline to produce 10,000 seeds proven winnable, each stored with its solution as proof and as a test fixture. A migration loads them into a `seed_pool` table, so no solver runs in production. The seed file stays out of any public repo.
- **Unpredictable:** hydration picks an unused pooled seed at random when a date is first played, so even someone holding the list can't know a future deal.
- **One play per deal:** `games.deal_date` references `daily_deals.date`, with `UNIQUE(user_id, deal_date)`. No replays, today or any past day.
- **Grace period:** a game must be started on its day, but an in-progress game can be finished until 3:00 a.m. Pacific the next morning. After that it's closed as a loss and can't be resumed. Catch-up games follow the same rule from the day they're started.
- **Catch-up:** any past date from October 1, 2026 onward that you haven't played is available once and counts on that date's board. A past date nobody played is hydrated the same way on its first catch-up.
- **Rules:** standard Klondike, draw 3 with unlimited passes through the stock. There are no hints. Each player action counts as one move: moving a card or stack, drawing from the stock, recycling the waste, or undoing (an undo doesn't refund the move it reverses). Auto-complete runs only once every card is face-up and adds no moves.
- **Board:** each date's board ranks wins first, then fewest moves, then fastest wall-clock time from first move to last. Only the board is shown; other players' replays are not.
- **No spoilers:** a date's board stays hidden until you've finished that date yourself.

## Move flow

A move is one POST and one redirect; there is no client state to keep in sync.

1. Each playable card or pile is a button inside a form: `POST /games/{id}/moves` with the `card` id, an optional `to` pile, and the client's last known `seq`. The engine derives the source pile and how many cards move (the card plus everything on top of it); a tap simply leaves out `to`.
2. The server loads the game's moves, replays them, and asks the engine whether the move is legal.
3. Legal: append the move in one transaction, then redirect to the game page; morphing updates only the changed piles and the move counter.
4. Illegal or stale `seq` (another tab moved first): redirect the same way, so the board simply re-renders from the server's state.
5. Undo, draw, recycle and auto-complete use the same endpoint with just seq and a `type`.

Tap-to-move follows one fixed rule: the foundation if the card can go there, otherwise the leftmost legal tableau column; a tap with no legal destination does nothing and costs no move, so a single tap is enough on a phone. Target under 100 ms per move round trip; replaying a few hundred moves on each request takes microseconds, so there is no cache and the database stays the only source of truth.

## Accounts and passkeys

Passkeys only, no passwords anywhere. Every account feature below is server-rendered Turbo pages.

- **Sign-up and sign-in:** username plus passkey; discoverable credentials with conditional UI, so the passkey appears in the username field's autofill.
- **Passkey management:** multiple passkeys per account, user-named, with authenticator name and icon from the AAGUID, created and last-used dates, and revoke.
- **Credential hygiene:** WebAuthn Signals (unknown credential, accepted credentials, current user details) keep password managers in sync after revokes and renames.
- **Sessions and devices:** list with device and last seen; revoke one or sign out everywhere.
- **Step-up auth:** a fresh user-verified assertion before adding or removing a passkey, exporting, or deleting the account.
- **Recovery:** one-time recovery codes (hashed, regenerate on demand) and an admin CLI that issues a single-use recovery link.
- **Security log:** user-visible audit trail of sign-ins, passkey changes, and exports.
- **Registration control:** the `SIGNUPS` env var is `open` (default) or `closed`. When closed, the admin CLI creates accounts; it also lists users and disables accounts.
- **Account lifecycle:** display name, generated avatar, and immediate deletion: step-up auth, an offer to download the full archive, then one cascading delete in a single transaction. The user's results leave past boards too.
- **Hardening:** SameSite=Strict session cookies plus CSRF tokens, rate limits on ceremony endpoints, short-lived challenges stored server-side.

## Frontend, design and mobile

No green felt, no bouncing-cards win screen. The direction is a calm, editorial table: warm paper and ink in light mode, deep lacquer in dark, with custom SVG card faces built around large, legible indices.

- **Cards:** original SVG faces with oversized corner indices readable at 48 px wide; minimalist courts; two or three deck themes as CSS custom properties.
- **Motion:** cards carry stable ids, which morphing preserves, so a small Stimulus controller can FLIP-animate each card from its old position to its new one. `prefers-reduced-motion` swaps to fades.
- **Win moment:** the foundations settle and the game's own replay draws as a small timeline of the moves, instead of a fireworks gimmick.
- **Mobile first:** portrait layout fits seven columns at 390 px; tableau fanning compresses with CSS so tall columns never scroll. Tap-to-move is primary; drag is a progressive enhancement.
- **Turbo everywhere:** Drive with view transitions between pages, redirect plus morph for every move, Frames for stats and history panels, morphing for stats refreshes.
- **JS budget:** Turbo, Stimulus and two controllers (animation, drag); nothing else. The game stays playable with JavaScript off.

## Deployment, Litestream, export

One container, one volume, continuous offsite backup.

- **Image:** multi-stage build (Go with `CGO_ENABLED=0`) into a distroless image that also carries the Litestream binary. Litestream runs as PID 1 and starts the app with `-exec`, so replication starts before the first write.
- **SQLite settings:** WAL mode, `busy_timeout`, `synchronous=NORMAL`, foreign keys on, one write connection plus a read pool.
- **Litestream:** replicates the one file `/data/app.db` to MinIO on the NAS plus an offsite S3-compatible bucket; restore is one command.
- **Homelab fit:** Docker host or LXC managed by Terraform and Ansible, behind Caddy and a Cloudflare Tunnel; Prometheus `/metrics`, JSON `slog` logs to Loki, a Gatus check on `/healthz`.
- **Passkey domain:** pick the final hostname before launch. Passkeys are bound to the relying-party ID, and changing it strands every credential.

**Export**

- **Format:** a versioned JSON archive `{format, version, games: [{id, variant, ruleset, seed, deal_date, started, ended, moves: [...]}]}` holding every game and move for the signed-in user.
- **Scope:** full archive only. There is no single-game share, since a daily deal's moves are its solution, and no import.
- Exports are step-up gated and recorded in the security log.

## Milestones and risks

Build the engine first; everything else depends on deterministic replay.

1. **Engine:** Klondike rules, seeded deals, replay; golden replay tests that must pass on every engine change; the offline solver CLI and the 10,000-seed list.
2. **Server skeleton:** schema and migrations, passkey sign-up and sign-in, Turbo layout.
3. **Board:** move endpoint with redirect and morph, card art, portrait layout, tap-to-move.
4. **Polish:** FLIP animation and drag controllers, view transitions, win replay.
5. **History:** stats, game list, move-by-move replay viewer, archive export.
6. **Accounts deep end:** devices, recovery, step-up, security log, Signals, admin CLI.
7. **Ops:** image, Litestream, Terraform and monitoring on the homelab.

**Risks**

- Move latency over a slow mobile connection; mitigated by tiny response payloads.
- Relying-party ID lock-in (see Deployment).
