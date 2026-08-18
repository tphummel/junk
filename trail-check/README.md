# Trail Check

A self-hostable service for tracking how much of a reference trail you've
actually covered, validated from your own GPX uploads with SpatiaLite (no
Python). Passkey-only auth (WebAuthn), a Turbo/Leaflet frontend, and an
on-demand OSM tile cache, all in one Go binary. See
[`trail-check-design-doc.md`](./trail-check-design-doc.md) for the full
design.

## Requirements

- Go 1.25.4 (managed via asdf) with CGO enabled
- SpatiaLite (`libsqlite3-mod-spatialite` / `mod_spatialite.so`) available at
  runtime -- this needs the real SQLite C library (via
  `github.com/mattn/go-sqlite3`), not a pure-Go driver, because loading a
  third-party `.so` extension requires `dlopen`

On Debian/Ubuntu:

```bash
sudo apt-get install libsqlite3-mod-spatialite
```

## Development

### Running tests

```bash
CGO_ENABLED=1 asdf exec go test ./...
CGO_ENABLED=1 asdf exec go vet ./...
```

The test suite runs real SpatiaLite queries (schema init, geometry
insertion, coverage calculation) against temporary SQLite files -- there's no
mocked GIS layer.

### Running locally

```bash
mkdir -p data cache
CGO_ENABLED=1 DATABASE_PATH=./data/trail.db TILE_CACHE_ROOT=./cache \
  RP_ID=localhost RP_ORIGINS=http://localhost:8080 \
  asdf exec go run ./cmd/server
```

Then open http://localhost:8080 and create an account (your browser will
prompt for a passkey -- Touch ID, Windows Hello, a security key, or your
phone).

### Building

```bash
CGO_ENABLED=1 asdf exec go build -o bin/trail-check ./cmd/server
```

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | HTTP server port |
| `METRICS_PORT` | 9090 | Prometheus metrics port |
| `DATABASE_PATH` | /data/trail.db | SQLite database path |
| `SPATIALITE_LIB` | mod_spatialite | SpatiaLite loadable extension name |
| `TILE_CACHE_ROOT` | /cache | OSM tile cache directory |
| `TILE_UPSTREAM` | https://tile.openstreetmap.org | Upstream tile server |
| `LOG_LEVEL` | info | Logging level (debug, info, warn, error) |
| `SESSION_TTL_DAYS` | 182 | Session lifetime (~6 months) |
| `JWT_RSA_PRIVATE_KEY` | (generated) | PEM-encoded RSA private key for signing session JWTs |
| `JWT_RSA_PRIVATE_KEY_FILE` | | Path to a PEM file, as an alternative to the env var |
| `RP_ID` | localhost | WebAuthn Relying Party ID (your domain, no scheme/port) |
| `RP_DISPLAY_NAME` | Trail Check | WebAuthn Relying Party display name |
| `RP_ORIGINS` | http://localhost:8080 | Comma-separated list of allowed origins |
| `REGISTRATION_TOKEN` | | If set, required to create a new account (see below) |
| `MATCH_BUFFER_METERS` | 20 | GPS-drift tolerance buffer used when matching runs to a trail |
| `PROJECTED_SRID` | 32611 (UTM 11N) | Projected CRS used for metre-accurate length/buffer math; pick the UTM zone for your trails |

If `JWT_RSA_PRIVATE_KEY` isn't set, the service generates an ephemeral key at
startup (logged as a warning) -- fine for local development, but it means
every restart invalidates all sessions. Generate a real one for production:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt-key.pem
```

**Registration is open by default.** Since there's no username or password --
just "create a passkey" -- an exposed instance with no `REGISTRATION_TOKEN`
set will let anyone create an account. Set `REGISTRATION_TOKEN` to a random
value before exposing the service beyond your own network, and share it only
with people you want to have accounts.

## API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/auth/register` | – | Registration page |
| `POST` | `/auth/register/begin` | – | Begin passkey registration, returns WebAuthn creation options |
| `POST` | `/auth/register/finish` | – | Complete registration, sets `session_jwt` |
| `GET` | `/auth/login` | – | Login page |
| `POST` | `/auth/login/begin` | – | Begin discoverable (usernameless) passkey login |
| `POST` | `/auth/login/finish` | – | Complete login, sets `session_jwt` |
| `POST` | `/auth/logout` | – | Revoke the current session |
| `GET`/`POST` | `/me/passkeys` | ✅ | List / add passkeys (Turbo Frame) |
| `POST`/`PATCH`/`DELETE` | `/me/passkeys/begin`, `/me/passkeys/finish`, `/me/passkeys/:id` | ✅ | Add / suspend-activate / delete a passkey |
| `GET`/`DELETE` | `/me/sessions`, `/me/sessions/:id` | ✅ | List / revoke sessions |
| `GET` | `/me/export` | ✅ | Download all account data as a ZIP |
| `DELETE` | `/me` | ✅ | Delete the account and all its data |
| `GET`/`POST` | `/catalog` | ✅ | List reference trails / upload a new one (GPX) |
| `GET` | `/catalog/:slug` | ✅ | Reference trail geometry (GeoJSON) |
| `POST` | `/catalog/:slug/track` | ✅ | Start tracking a reference trail |
| `POST` | `/runs` | ✅ | Upload a run (GPX), enqueues background validation |
| `GET` | `/runs/:id/status` | ✅ | Poll a run's validation status |
| `GET` | `/dashboard` | ✅ | Progress dashboard with a Leaflet map |
| `GET` | `/dashboard/geo` | ✅ | Covered/uncovered GeoJSON for the map |
| `GET` | `/tiles/:z/:x/:y.png` | – | Cached OSM raster tiles (public by design) |
| `GET` | `/healthz` | – | Liveness check |
| `GET` | `/metrics` | – | Prometheus metrics (separate `METRICS_PORT`) |

The design doc's endpoint table lists single `GET`/`POST /auth/register` and
`/auth/login` entries; WebAuthn ceremonies are inherently two round trips
(fetch options, then submit the signed credential), so each is split into
`/begin` and `/finish` here.

## How coverage is computed

GPX uploads are parsed into a `MULTILINESTRING` (one line per `<trkseg>`, so
a paused recording doesn't get falsely joined across the gap) and matched
against the reference trail with a background worker, using this SpatiaLite
query per user-trail:

1. Union every processed run's geometry for that trail.
2. Buffer *that union* by `MATCH_BUFFER_METERS` (in a projected CRS, so the
   buffer is actually in meters) to absorb GPS drift.
3. Intersect the buffered run coverage against the reference *line* --
   matched length is `ST_Length()` of that intersection.
4. `ST_Difference()` of the reference line against the same buffer gives the
   uncovered gap, for the dashboard's dashed overlay.

This differs slightly from a naive reading of the original design doc, which
buffered *both* geometries and intersected the two buffers -- that yields a
polygon, and `ST_Length()` of a polygon is always zero. Buffering only the
run side and measuring against the reference line is what actually produces
a usable length and line geometries the Leaflet dashboard can render.

## Docker

```bash
docker build -t trail-check:latest .
docker run -d \
  -p 8080:8080 -p 9090:9090 \
  -v $(pwd)/data:/data -v $(pwd)/cache:/cache \
  -e RP_ID=trail.example.com \
  -e RP_ORIGINS=https://trail.example.com \
  -e JWT_RSA_PRIVATE_KEY_FILE=/data/jwt-key.pem \
  -e REGISTRATION_TOKEN=change-me \
  --name trail-check \
  trail-check:latest
```

```bash
docker pull ghcr.io/OWNER/trail-check:latest
```

Images are built and pushed to GHCR on every push to `main` and on tagged
releases (see `.github/workflows/trail-check.yml`).

### Behind Caddy

TLS is terminated externally; the service only ever speaks plain HTTP.

```caddy
trail.example.com {
    reverse_proxy localhost:8080
}
```

## Load testing

```bash
k6 run -e BASE_URL=http://localhost:8080 k6/loadtest.js
```

Passkey login can't be scripted headlessly (it needs a real authenticator's
private key), so the script load-tests the public tile cache and health
endpoint by default. Pass `TRAILCHECK_SESSION_COOKIE` and
`TRAILCHECK_USER_TRAIL_ID` (captured from a real logged-in browser session)
to also exercise authenticated GPX uploads. See the comments at the top of
`k6/loadtest.js`.

## Data export and deletion

`GET /me/export` returns a ZIP with your account, passkeys, sessions, and
every tracked trail's runs as JSON. `DELETE /me` deletes the account and
cascades to all of it.
