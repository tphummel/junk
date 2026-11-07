# VenueCheck

Self-hosted personal check-in tracker (Swarm/Foursquare replacement) with a shared venue
layer enriched from OpenStreetMap, and the ability to contribute **new** venues back to OSM.
One Go binary, one SQLite file, server-rendered mobile-friendly HTML, passkey-only auth.

Design: [`venuecheck-design-doc.md`](./venuecheck-design-doc.md). Build log: [`notes.md`](./notes.md).

## What's implemented

| Area | Status |
| --- | --- |
| Passkey (WebAuthn) register/login, rotation, min-1-active-key rule, 30-day sliding sessions | ✅ |
| Check-in: debounced search, local FTS5 + live Overpass in parallel, merged/deduped, tracked badge, OSM upsert, "create local venue" | ✅ |
| Check-in edit (note, time ±1 day from the original), delete; private per user | ✅ |
| Shared venues: any user edits any field, last-write-wins, per-field edit log (no attribution shown) | ✅ |
| Venue page: totals for all users, last check-in, map pin, OSM link, refresh from OSM | ✅ |
| Admin: venue list (filter, search, 50/page), detail, OSM tag viewer, pull, push (create node / update element), reconcile (50 m + Levenshtein ≤ 2), dismiss | ✅ |
| Foursquare JSON / Swarm CSV import (idempotent, dedupe by fsq id then name+50 m, photo URLs kept as-is) | ✅ |
| Map: bundled Leaflet 1.9.4, tiles from `/data/tiles/{z}/{x}/{y}.png`, your check-ins + shared venues, "Near me" | ✅ |
| Insights: totals, by year/month/country/city/category, top 10, recent (HTML + CSS bars) | ✅ |
| JSON export (`POST /export`) | ✅ |
| CSRF tokens, CSP, `HttpOnly`/`SameSite=Strict`/`Secure`-when-HTTPS cookies, parameterized SQL, OSM key env-only | ✅ |

## Run it

```sh
# local dev (passkeys work on http://localhost)
cd ai
DATA_DIR=./data RP_ID=localhost RP_ORIGINS=http://localhost:8080 \
  CGO_ENABLED=1 go run -tags sqlite_fts5 ./cmd/venuecheck

# tests (the sqlite_fts5 build tag is required for venue search)
CGO_ENABLED=1 go test -tags sqlite_fts5 ./...
```

Open the app and visit `/register`: the first account becomes the administrator and
`/register` then returns 404 (set `ALLOW_REGISTER=true` to let additional people sign up).

### Docker

```sh
docker build -t venuecheck ai/
docker run -d --name venuecheck -p 8080:8080 -v $PWD/data:/data \
  -e RP_ID=venuecheck.home.example -e RP_ORIGINS=https://venuecheck.home.example venuecheck
```

or use [`docker-compose.yml`](./docker-compose.yml). CI (`.github/workflows/ai.yml`) runs
tests + `go vet`, then builds the image and pushes `ghcr.io/<owner>/venuecheck` on `main` and `v*` tags
(PRs build without pushing).

### ⚠️ Passkeys need HTTPS (or localhost)

Browsers only expose WebAuthn in a secure context, and the relying-party ID must be a **hostname**,
not an IP. The design doc's "plain HTTP on `192.168.x.x`" therefore cannot work for passkeys.
Give the box a LAN hostname and terminate TLS with Caddy (internal CA or a DNS-challenge cert):

```
venuecheck.home.example {
    reverse_proxy 192.168.1.50:8080
}
```

and set `RP_ID=venuecheck.home.example`, `RP_ORIGINS=https://venuecheck.home.example`.
The `Secure` cookie flag is set whenever the first `RP_ORIGINS` entry is `https://` (or the request
arrives with `X-Forwarded-Proto: https`).

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `BIND` / `PORT` | `0.0.0.0` / `8080` | listen address |
| `DATA_DIR` | `/data` | `venue.db`, `tiles/`, `backup/` |
| `RP_ID` | `localhost` | WebAuthn relying-party ID (hostname) |
| `RP_ORIGINS` | `http://localhost:$PORT` | comma-separated allowed origins |
| `ALLOW_REGISTER` | `false` | allow registration after the first account |
| `OSM_API_KEY` | – | OAuth2 bearer token with `write_api`; enables pushes. Never stored, rendered or logged |
| `OSM_USER_ID` | – | informational only |
| `OSM_API_BASE` | `https://api.openstreetmap.org/api/0.6` | use `https://api06.dev.openstreetmap.org/api/0.6` to rehearse against the OSM dev server |
| `OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | Overpass endpoint |
| `OSM_MIN_GAP_SECONDS` | `5` | minimum spacing between OSM write calls (429s back off exponentially) |
| `INSTANCE_HOSTNAME` | OS hostname | used in the changeset comment `VenueCheck (<host>)` |

Backup: `docker exec venuecheck sqlite3 /data/venue.db ".backup /data/backup/venue-$(date +%F).db"`
(the runtime image is Alpine without `sqlite3`; `apk add sqlite` in the container or copy the DB file while
the app is idle — WAL mode makes a plain `cp` of `venue.db*` unsafe while running).

Tiles: slice raster tiles z1–z18 into `data/tiles/{z}/{x}/{y}.png` (e.g. with `gdal2tiles` or a tile-server
export). Without tiles the map shows markers on a blank background.

## Layout

```
cmd/venuecheck/     entrypoint (+ -healthcheck flag used by the Docker HEALTHCHECK)
internal/config/    env parsing
internal/store/     SQLite schema + queries (users, passkeys, sessions, venues, edit log, check-ins, insights, export)
internal/osm/       Overpass client, OSM API 0.6 writer (rate limit + backoff), tag<->field mapping, diff
internal/importer/  Foursquare JSON / Swarm CSV parsing + idempotent loader
internal/web/       handlers, auth/CSRF, html/template pages, embedded static assets (Leaflet bundled)
```

## Decisions and deviations from the design doc

- **FTS5** needs the `sqlite_fts5` build tag with `mattn/go-sqlite3` (set in the Dockerfile and CI). The doc's
  `CREATE VTABLE` is `CREATE VIRTUAL TABLE`, kept in sync with `venues` via triggers.
- **Go 1.25 / Alpine 3.22** rather than 1.22/3.20, matching the other Go apps in this repo.
- **Passkey login is username-first** (like `app-passkey`); deactivated keys are excluded from the allow list
  and their sessions are revoked.
- **User handles** are random opaque bytes stored on `users.handle` (not the integer id).
- **Imported venues start as `needs-reconcile`** (the doc says both "local-only" and "flagged needs-reconcile"
  after import; the latter is what the admin queue needs). *Dismiss* confirms `local-only`.
- **Reconcile is per venue** from the admin detail page (filter the list by `needs-reconcile`) rather than a multi-select job.
- **Pushing updates**: the diff is computed between current venue fields and the last pulled snapshot; blank local
  values never delete OSM data; ways/relations get tag updates only (no moving). The live element is re-fetched
  before the PUT so unrelated upstream tag edits are preserved. The Pull / Push / Create actions all require an
  explicit confirm in the UI.
- **`checkins.original_at`** (extra column) anchors the "±1 day" timestamp-edit rule so repeated edits cannot drift.
- **`osm_audit`** table records every OSM write attempt (ok/failure + detail), per "Log failures to audit".
- **Overpass without a position** does a best-effort global name match restricted to amenity/shop/tourism/leisure;
  it can be slow or time out, in which case local results are shown with a notice.
- **Map "modal"** is a Leaflet popup linking to the venue page.
- Insights ignore venues with an empty country/city/category in those breakdowns.

## Not done / follow-ups

- Browser testing was done with Playwright + a virtual authenticator against `localhost`; the Docker image could
  not be built in the authoring sandbox (no Docker daemon), so the first CI run is its first build.
- No login rate limiting (LAN-only per the design).
- Tile slicing is manual, as specified.
