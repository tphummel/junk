# 📐 Trail‑Check Service – Full Design Document
*Version 1.0 – 18 Aug 2026*

---

## 1. Purpose

Provide a **self‑hostable web service** that lets a single user (or a small team)

* register / log‑in with **WebAuthn passkeys**
* upload GPX runs and validate them against a reference trail using **SpatiaLite** (no Python)
* view overall and per‑segment progress on a map built with **Leaflet + OpenStreetMap raster tiles**
* manage passkeys, export all personal data, and revoke sessions

All components run inside a **Podman OCI image** behind an external TLS terminator (Caddy or any reverse‑proxy).

---

## 2. High‑Level Architecture

```
+-------------------+   HTTP (plain)   +-------------------+   HTTP (plain)   +-------------------+
|   Browser (Leaflet, Turbo)  |   Go Service (Gin)   |   SQLite + SpatiaLite   |
|  – Turbo.js (SPA feel)      |  • Auth (WebAuthn)   |   – /data/trail.db     |
|  – Leaflet (OSM raster)     |  • Session JWT cookie|   – geometry ops      |
|  – Embedded static assets    |  • GPX upload/worker|   – tile cache (FS)    |
+-------------------+ <------------> +-------------------+ <------------> +-------------------+
        ^                         ^          ^                ^
        |                         |          |                |
        |                         |          |                |
        |                         |          |                |
        |                         |          |                |
        |                         |          |                |
        v                         v          v                v
+-------------------+   HTTP (plain)   +-------------------+   HTTP (plain)   +-------------------+
|  Reverse‑proxy (Caddy) | <--- HTTPS ---> |  Container (Podman)   |
|  – Terminates TLS      |   (forward)    |  – Exposes :8080       |
|  – Forwards to http://localhost:8080                     |
+-------------------+                    +-------------------+

```

*All heavy GIS work stays inside SQLite/SpatiaLite; the Go process only orchestrates data flow.*

---

## 3. Data Model (SQLite + SpatiaLite)

| Table | Primary Key | Important Columns |
|-------|-------------|-------------------|
| **user** | `id` UUID | `created_at` |
| **passkey** | `id` UUID | `user_id`, `credential_id` BLOB, `public_key` BLOB, `label`, `status` (`active`/`suspended`) |
| **session** | `id` UUID | `user_id`, `expires_at`, `revoked_at`, `last_seen_at`, `device_label` |
| **catalog_trail** | `id` UUID | `name`, `slug`, `geom` (MULTILINESTRING, SRID 4326), `length_m` |
| **user_trail** | `id` UUID | `user_id`, `catalog_trail_id` |
| **trail_segment** | `id` UUID | `catalog_trail_id`, `order`, `name`, `geom`, `length_m` |
| **run** | `id` UUID | `user_trail_id`, `name`, `uploaded_at`, `geom` (MULTILINESTRING), `status` (`pending`,`processed`,`error`), `matched_len`, `coverage_pct`, `gap_geom` |

*Geometries are stored in SRID 4326; lengths are computed in UTM 11N (EPSG 32611) for metre accuracy.*

---

## 4. GPX → Geometry → Validation Flow

1. **Upload (`POST /runs`)**
   * Parse GPX with `github.com/tkrajina/gpxgo/gpx`.
   * Merge all track segments into a `geom.MultiLineString`, convert to WKT.
   * Insert a `run` row (`status='PENDING'`).

2. **Enqueue** – the `run_id` is sent on a **Go channel** (`chan string`).

3. **Background worker** (goroutine) executes a single SpatiaLite SQL statement:

```sql
WITH
  runs_union AS (
    SELECT ST_Union(r.geom) AS geom
    FROM run r
    WHERE r.user_trail_id = :utid AND r.status = 'PROCESSED'
  ),
  ref AS (
    SELECT ct.geom FROM catalog_trail ct
    JOIN user_trail ut ON ct.id = ut.catalog_trail_id
    WHERE ut.id = :utid
  ),
  buffered AS (
    SELECT ST_Transform(ref.geom,32611)  AS ref_proj,
           ST_Transform(runs_union.geom,32611) AS run_proj
  ),
  covered AS (
    SELECT ST_Transform(
           ST_Intersection(
             ST_Buffer(ref_proj, :buf_m),
             ST_Buffer(run_proj, :buf_m)
           ),4326) AS geom
    FROM buffered
  )
UPDATE run
SET matched_len = ST_Length(ST_Transform(covered.geom,32611)),
    coverage_pct = (matched_len / ST_Length(ST_Transform(ref.geom,32611))) * 100,
    gap_geom = ST_Difference(ref.geom, covered.geom),
    status = 'processed'
WHERE id = :run_id;
```

* `:buf_m` (default **20 m**) provides tolerance for GPS drift.
* Updates `matched_len`, `coverage_pct`, `gap_geom`, and sets `status='processed'`.

4. **Completion** – the worker finishes; the UI can poll (`GET /runs/:id/status`) or receive a Turbo‑Stream push.

---

## 5. Authentication & Session

| Step | Details |
|------|---------|
| **Register / Login** | WebAuthn (`go‑webauthn`). Successful assertion creates a **session row** (`expires_at = now + SESSION_TTL_DAYS`, default **6 months**, configurable via `SESSION_TTL_DAYS`). |
| **JWT Cookie** | Signed with RSA‑256 (`RS256`). Payload: `{sub:userID, sid:sessionID, exp, dev:deviceLabel}`. Stored in an **HttpOnly, SameSite Lax** cookie named `session_jwt`. `Secure` flag is **off** (TLS termination is external). |
| **Middleware (`requireAuth`)** | 1️⃣ Read cookie → verify JWT signature using the RSA private key supplied via `JWT_RSA_PRIVATE_KEY` env var.<br>2️⃣ Look up `session` row by `sid`.<br>3️⃣ Reject if `revoked_at` set or `expires_at` passed.<br>4️⃣ Store `userID` in the request context (`c.Set("userID", …)`). |
| **Logout / Revoke** | Update `revoked_at = now` on the session row and clear the cookie. |
| **Session TTL** | Default **6 months** (`SESSION_TTL_DAYS` env var). |

---

## 6. Tile Cache – On‑Demand OSM Raster (Filesystem)

### 6.1 Storage Layout

```
/cache/
 ├─ <z>/
 │   ├─ <x>/
 │   │   └─ <y>.png
 │   └─ …
 └─ …
```

Each tile is stored as a plain PNG file under `<cache_root>/<z>/<x>/<y>.png`.

### 6.2 Handler (`GET /tiles/:z/:x/:y.png`)

1. Build the file path from `TILE_CACHE_ROOT`.
2. **If file exists** → return it (`cache hit`).
3. **If missing** → fetch the tile from `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, write it atomically to the cache (async) and return it (`cache miss`).

**Metrics** (Prometheus): `tiles_cache_hits_total`, `tiles_cache_misses_total`.

*The tile endpoint is **public (no auth)** because OSM raster tiles are non‑private public assets; keeping it unauthenticated avoids unnecessary overhead and allows normal browser caching.*

---

## 7. API / Turbo Endpoints

| Method | Path | Auth | Returns | Notes |
|--------|------|------|---------|-------|
| `GET /auth/register` | – | — | HTML (WebAuthn UI) | Turbo‑enabled |
| `POST /auth/register` | – | — | Sets `session_jwt` cookie → redirect to dashboard |
| `GET /auth/login` | – | — | HTML (WebAuthn UI) |
| `POST /auth/login` | – | — | Sets `session_jwt` cookie |
| `GET /me/passkeys` | – | ✅ | `<turbo-frame id="passkey-list">` table |
| `POST /me/passkeys` | – | ✅ | Returns updated `<turbo-frame>` |
| `PATCH /me/passkeys/:id` | – | ✅ | Suspend / activate |
| `DELETE /me/passkeys/:id` | – | ✅ | Delete |
| `GET /catalog` | – | ✅ | List of reference trails |
| `POST /catalog` | – | ✅ | Upload reference GPX → creates `catalog_trail` |
| `GET /catalog/:slug` | – | ✅ | Returns reference geometry (GeoJSON) |
| `POST /runs` | – | ✅ | Stores run, enqueues validation, returns Turbo‑Stream that replaces a `<turbo-frame id="run-status">` |
| `GET /runs/:id/status` | – | ✅ | JSON `{status, coverage_pct, matched_len}` (polling fallback) |
| `GET /dashboard` | – | ✅ | Page with progress bars + Leaflet map |
| `GET /dashboard/geo?user_trail_id=…` | – | ✅ | Returns JSON `{covered_geojson, uncovered_geojson}` (both GeoJSON strings) |
| `GET /tiles/:z/:x/:y.png` | — | — | Raster tile (cached) |
| `GET /metrics` | — | — | Prometheus format |
| `GET /healthz` | — | — | `200 OK` |
| `GET /me/export` | – | ✅ | `application/zip` containing account data |
| `DELETE /me` | – | ✅ | Cascade delete user, passkeys, sessions, runs |

All protected routes use the `requireAuth` middleware; the tile endpoint is intentionally **public**.

---

## 8. Front‑End (Leaflet + Turbo)

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Trail‑Check Dashboard</title>
  <link rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://cdn.jsdelivr.net/npm/@hotwired/turbo@7/dist/turbo.min.js"></script>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    #map { height: 80vh; }
  </style>
</head>
<body>
  <h1>Santa Monica Backbone Trail</h1>

  <div id="progress">
    <!-- progress bars rendered by server inside a <turbo-frame> -->
    <turbo-frame id="progress-bars">…</turbo-frame>
  </div>

  <div id="map"></div>

  <script>
    const map = L.map('map').setView([34.0, -118.5], 9);
    L.tileLayer('/tiles/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    // Load covered/uncovered layers
    fetch('/dashboard/geo?user_trail_id=123')
      .then(r => r.json())
      .then(d => {
        const covered = L.geoJSON(JSON.parse(d.covered_geojson), {
          style: {color:'#ff8800', weight:4}
        }).addTo(map);
        const uncovered = L.geoJSON(JSON.parse(d.uncovered_geojson), {
          style: {color:'#0066ff', weight:4, dashArray:'6,6'}
        }).addTo(map);
        const group = L.featureGroup([covered, uncovered]);
        map.fitBounds(group.getBounds(), {padding:[20,20]});
      });
  </script>
</body>
</html>
```

*All forms and links are automatically intercepted by Turbo, giving an SPA‑like navigation without writing any client‑side JavaScript beyond the map setup.*

---

## 9. Non‑Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Performance** | Tile fetch ≤ 50 ms after cache warm‑up; GPX validation ≤ 2 s per run. |
| **Scalability** | Single‑process Go server; filesystem tile cache scales to many concurrent reads; SQLite is sufficient for low‑traffic use. |
| **Reliability** | Graceful shutdown (10 s timeout) – drain channel, finish pending validations, close DB. |
| **Security** | RSA‑256 signed JWT; HttpOnly + SameSite Lax cookie; WebAuthn attestation verification; no external rate limiting (low traffic). |
| **Observability** | JSON logs via `zerolog` (`LOG_LEVEL` env: debug/info/warn/error). Prometheus metrics (`/metrics`). Health endpoint (`/healthz`). |
| **Portability** | OCI‑compatible image; runs on any Linux host (Podman, Docker, Kubernetes). |
| **Backup** | Operator‑managed – mount `/data` (trail DB) and `/cache` (tile cache) as persistent volumes. |
| **Compliance** | GDPR‑friendly: account export (ZIP) and easy deletion (`DELETE /me`). |
| **Testing** | Unit tests for core logic; HTTP integration tests (`net/http/httptest`); k6 load test suite. |
| **CI/CD** | GitHub Actions: build OCI image with Podman, run tests, run k6, push tagged image to **ghcr.io** (semantic versioning). |
| **Documentation** | Minimal README: run command, required env vars, volume mounts, Caddy TLS tip. |

---

## 10. Implementation Checklist

| Task | Done? |
|------|-------|
| **Go modules** – gin, go‑webauthn, gpx, go‑geom, zerolog, prometheus client | ☐ |
| **Embed static assets** (`embed.FS`) – Turbo, Leaflet CSS/JS, custom CSS | ☐ |
| **SQLite schema migrations** – trail DB + tile cache DB (if separate) | ☐ |
| **Auth flow** – WebAuthn registration/login, JWT creation, session row handling | ☐ |
| **Session middleware** – JWT verification + DB lookup | ☐ |
| **GPX upload handler** – parse, insert run, enqueue ID | ☐ |
| **Background worker** – channel consumer, SpatiaLite validation SQL | ☐ |
| **Dashboard API** – coverage GeoJSON query (covered/uncovered) | ☐ |
| **Tile handler** – filesystem cache (public, no auth) | ☐ |
| **Metrics & health endpoints** | ☐ |
| **Graceful shutdown** – capture SIGINT/SIGTERM, drain channel, close DB | ☐ |
| **Dockerfile** (multi‑stage): builder (Go), runtime (Alpine, non‑root user) | ☐ |
| **GitHub Actions workflow** – build, test, k6, push | ☐ |
| **README** – run command, env vars (`SESSION_TTL_DAYS`, `JWT_RSA_PRIVATE_KEY`, `LOG_LEVEL`, `TILE_CACHE_ROOT`), volume mounts, Caddy TLS example | ☐ |
| **k6 script** – simulate login, GPX upload, tile requests | ☐ |
| **Unit / integration tests** – auth, session, GPX parsing, validation SQL, tile cache logic | ☐ |
| **Prometheus counters** – `tiles_cache_hits_total`, `tiles_cache_misses_total`, `login_success_total`, `run_processed_total`, etc. | ☐ |

---

## 11. Summary

- **All‑Go stack** (no Python) handling GPX validation with SpatiaLite.
- **Open‑source mapping**: Leaflet + OSM raster tiles cached on‑demand to the filesystem (no commercial SDKs).
- **Passkey‑only authentication** with JWT‑session cookies stored in SQLite.
- **Simple, public tile endpoint** (no auth) for fast map loading and easy browser caching.
- **Containerised, TLS‑agnostic** – ready to run behind any reverse‑proxy (Caddy recommended).

The design meets the functional goals, keeps the runtime footprint minimal, and is ready for implementation, CI/CD, and deployment. 🚀

---

## Implementation notes (deviations from the above)

This implementation follows the design doc closely, with a few adjustments
made while building it against real SpatiaLite:

- **Coverage SQL (§4):** the query above buffers *both* the reference and
  run geometries and intersects the two buffers, which produces a polygon --
  `ST_Length()` of a polygon is always 0, so `matched_len` would never be
  anything but zero. The implementation buffers only the run track (that's
  where the GPS-drift tolerance belongs) and intersects/differences it
  against the reference *line*, which yields line geometries with a real
  length and that Leaflet can render directly. See
  `internal/db/coverage.go` for the corrected query and reasoning.
- **`WHERE status = 'PROCESSED'` (§4):** taken literally, the run currently
  being validated is excluded from its own coverage calculation, since its
  status only flips to `processed` at the end. The implementation includes
  the in-flight run explicitly (`status = 'processed' OR id = :run_id`) so
  the very first uploaded run doesn't compute 0% coverage against itself.
- **Runtime base image:** Debian (`golang:1.25-bookworm` /
  `debian:bookworm-slim`) rather than this repo's usual Alpine convention.
  SpatiaLite pulls in enough native library surface (PROJ, GEOS, RTTOPO,
  FreeXL) that it wasn't worth re-validating against musl when glibc was
  already confirmed to work.
- **Registration/login endpoints (§7):** WebAuthn ceremonies are inherently
  two round trips (fetch options, then submit the signed credential), so
  each design-doc endpoint is split into `/begin` and `/finish`. Registration
  is wide open to anyone who can reach the instance -- there's no username or
  password to gate on, and no invite mechanism was added; that's a deliberate
  choice for a home-network deployment, not an oversight.
- **Podman vs Docker:** the design doc specifies Podman; the GitHub Actions
  workflow uses `docker/build-push-action`, matching every other project in
  this repo. The resulting OCI image is the same either way.
