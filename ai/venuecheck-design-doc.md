# VenueCheck — Design Document

(Original design brief, reformatted more compactly (same content). See `README.md` for implementation decisions and deviations.)

## Overview

Self-hosted personal check-in tracker with shared venue data, OSM enrichment, and OSM venue creation. Go web app serving mobile-friendly HTML. Docker image, SQLite, LAN-only, passkey auth.

## Goals

- Personal check-in tracking (15+ years migrated from Foursquare/Swarm)
- Venue data enriched from OpenStreetMap on demand
- Contribute **new** venues to OSM (places not yet mapped)
- Admin panel for OSM reconciliation and sync
- Easy JSON export of all personal data
- Single container, single SQLite file, LAN-only

## Non-Goals

- Social features, friend feeds, public profiles
- Push notifications
- Native mobile app
- Public API
- Plugin system
- TOTP / backup code fallback
- Publishing check-in counts or visit stats to OSM
- Multi-tenant isolation beyond shared venue layer
- Automatic/batch OSM sync (always user-triggered)

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Docker Container (LAN-bound)                   │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │  Go HTTP Server (port 8080)               │  │
│  │  • HTML UI (embedded static files)        │  │
│  │  • Internal JSON API (same port)          │  │
│  │  • Static raster tile handler (/tiles/)   │  │
│  └────────────────────┬──────────────────────┘  │
│                       │                         │
│  ┌────────────────────▼──────────────────────┐  │
│  │  SQLite  /data/venue.db (WAL mode)        │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  Volumes:                                       │
│    /data/venue.db      — database               │
│    /data/tiles/        — static raster tiles    │
│    /data/backup/       — manual sqlite backups  │
│                                                 │
│  Outbound (user-triggered only):                │
│    Overpass API   — OSM search / refresh        │
│    OSM API 0.6    — push new venue nodes        │
└─────────────────────────────────────────────────┘

Bind: 192.168.x.x (LAN only)
TLS:  optional (Caddy in front); no TLS by default
```

---

## Data Model (SQLite)

### `users`
`id` INTEGER PK · `username` TEXT UNIQUE · `is_admin` BOOLEAN (first registered account = TRUE) · `created_at` TEXT RFC3339

### `passkeys`
`id` · `user_id` FK→users · `credential_id` BLOB UNIQUE · `public_key` BLOB (COSE) · `sign_count` · `name` (user-facing label) · `active` BOOLEAN (rotation: add new, deactivate old) · `created_at`

Constraint: at least 1 active passkey per user at all times.

### `sessions`
`id` · `user_id` FK→users · `credential_id` BLOB FK→passkeys · `token` TEXT UNIQUE (cookie value) · `created_at` · `expires_at` (30-day sliding)

### `venues` (shared by all users)
`id` · `osm_type` (node/way/relation, NULL) · `osm_id` · `osm_version` (last-synced) · `osm_pulled_at` · `foursquare_id` (legacy import) · `name` · `lat` · `lon` · `address` · `city` · `country` · `category` (e.g. `amenity=restaurant`) · `cuisine` · `website` · `phone` · `osm_tags` (JSON, full tag snapshot at pull time) · `local_notes` (shared, any user can edit) · `status` (`osm-linked` / `local-only` / `needs-reconcile`) · `updated_at`

### `venue_edit_log` (audit)
`id` · `venue_id` FK→venues · `user_id` FK→users · `field` · `old_value` · `new_value` · `created_at`

UI never displays `user_id` to non-admin users.

### `checkins` (private per user)
`id` · `user_id` FK→users · `venue_id` FK→venues · `venue_name_at_time` (historical snapshot) · `note` · `lat`/`lon` (GPS at check-in) · `checked_in_at` RFC3339 UTC · `source` (`imported` / `manual` / `gps`) · `created_at` · `photo_urls` TEXT JSON array (`ALTER TABLE checkins ADD COLUMN photo_urls TEXT DEFAULT '[]'`)

### Key indexes

```sql
CREATE INDEX idx_checkins_user_time ON checkins(user_id, checked_in_at DESC);
CREATE INDEX idx_checkins_venue ON checkins(venue_id);
CREATE INDEX idx_venues_name ON venues(name);
CREATE VTABLE venues_fts USING fts5(name, address, city, category, content=venues);  -- sic: VIRTUAL TABLE
CREATE INDEX idx_edit_log_venue ON venue_edit_log(venue_id, created_at DESC);
```

Spatial: bounding-box query on `lat`/`lon` (no R-tree needed at 100k scale).

---

## Auth (Passkey-Only)

- WebAuthn. No email, no TOTP, no backup codes.
- **Bootstrap:** first `POST /register` sets `is_admin = true`.
- **Rotation:** UI lists active passkeys → "Add passkey" → "Deactivate [name]". Min 1 active enforced.
- **Session:** `HttpOnly; SameSite=Strict` cookie. `Secure` flag only when TLS present. 30-day sliding TTL.
- **No cross-device persistence.**

---

## Admin

### Gate
All `/admin/*` routes: `WHERE user.is_admin = true`, else 404.

### Panel: Venue List
Table of all venues. Columns: name, status, city, category, updated_at. Filter: status, text search. Pagination (50/page).

### Panel: Venue Detail
- Full metadata + `osm_tags` JSON viewer.
- **Edit log** for this venue (field, old, new, timestamp). No user attribution shown.
- Actions:
  - **Pull (refresh from OSM):** Overpass query by `osm_type`+`osm_id` → overwrite `osm_tags` + derived fields + `osm_pulled_at`. Preserves `local_notes`.
  - **Push to OSM:** `local-only` → creates a node via OSM API 0.6 (name, lat/lon, category, address, website, phone, cuisine), sets `osm_type`, `osm_id`, `status = osm-linked`. `osm-linked` → uploads changed fields as a changeset.
  - **Reconcile:** for `local-only` venues, queries Overpass (name + 50m radius) → shows candidates → user picks → links `osm_type`/`osm_id` → sets `status = osm-linked`.

### Panel: Import
File upload (JSON / CSV) for Foursquare/Swarm bulk import. Progress indicator (row count / errors).

---

## Check-In Search & Capture

1. User taps "Check in".
2. Search box appears.
3. On input (debounced 300ms), **two parallel queries**: **Local** FTS5 over `venues` (name, address, city, category); **OSM (live)** Overpass — `around:radius` if geolocation available, otherwise global text search.
4. Results merged: local venues prioritized with a badge (e.g. `📍 Tracked · 12 visits · Last: Jun 2019`); OSM-only results below, no badge. Dedup: same `osm_type`+`osm_id`, or name+50m → show local card with an "updated from OSM" hint.
5. User taps a result: **tracked** → link check-in to existing `venue_id`; **new** → upsert into `venues` (cache OSM tags, set `osm_pulled_at`, `status = osm-linked`) → check in.
6. Optional note field.
7. Fallback: "Create local venue" (name + coords, `status = local-only`).

**Edit / Delete:** user can edit own check-in note, timestamp (±1 day), or delete. No editing of venue fields from the check-in detail.

---

## Venue Editing (Shared)

- Any authenticated user can edit any venue field. **Last-write-wins.** No merge, no conflict UI.
- Every field change → `venue_edit_log` row.
- **Pushable fields** (trigger OSM changeset if `status = osm-linked`): `name`, `address`, `city`, `category`, `cuisine`, `website`, `phone`, `lat`, `lon`
- **Local-only fields** (never pushed): `local_notes`, check-in data, `foursquare_id`
- **New node creation** pushes only: name, lat/lon, category, address, website, phone, cuisine.

---

## OSM Integration

### Inbound (user-triggered only)

| Trigger | Query |
|---|---|
| Check-in search | Overpass `around` / text search |
| "Refresh from OSM" on venue detail | Overpass `node/way/relation` by ID |
| Admin "Pull" | Same |
| Admin "Reconcile" | Overpass `around(50)` + name match |

Response cached: tags → `osm_tags` JSON, `osm_pulled_at` set. Subsequent UI reads served from local.

### Outbound (user-triggered only)

- **Identity:** single app-level OSM API key (`OSM_API_KEY`, `OSM_USER_ID` env vars).
- **Operations:** create node (first push of a `local-only` venue); update element (field edits on `osm-linked` venues).
- **Change comment:** `VenueCheck (<instance-hostname>)`
- **Rate limit:** min 5s between calls. Exponential backoff on 429. Log failures to audit.
- **No batch / no cron.** Every push is a discrete user action.

### Reconcile Job (admin-triggered, not automatic)

- Admin selects `local-only` / `needs-reconcile` venues.
- For each: Overpass `around(lat,lon, 50m)` + name (fuzzy, Levenshtein ≤ 2). Admin picks or dismisses.
- Pick: set `osm_type`, `osm_id`, `status = osm-linked`. Dismiss: `status = local-only`.

---

## Map

- Static raster tiles (OSM Standard or equivalent), pre-sliced z1–z18, stored at `/data/tiles/{z}/{x}/{y}.png`, served at `/tiles/`.
- Leaflet.js bundled (no CDN). Layers: user's check-ins (private, colored markers); venues (shared, default markers).
- Click marker → venue/check-in detail; "Near me" → geolocation → fly to. No drawing/editing on map.
- Tiles are static; manual re-slice if updates needed.

---

## Insights (Minimal, per-user)

Computed on the fly from `checkins` JOIN `venues`, no caching: total check-ins; unique venues; by year / month; by country / city; by category; top 10 venues; 10 most recent.

Per-venue detail page (shared, all users): total check-ins (all users), last check-in date, map pin, OSM link (if `osm-linked`), metadata + local notes.

Rendered as HTML lists + CSS bars. No JS chart library.

---

## Foursquare / Swarm Import

- **Trigger:** Admin panel upload. **Formats:** Foursquare JSON export, Swarm CSV export.
- **Mapping:** `tips[]` / Swarm rows → `checkins` (source = `imported`); `tip.venue.id` → `venues.foursquare_id`; venue name/lat/lon/address/category → `venues` (dedupe by `foursquare_id`, then name+50m); tip text → `checkins.note`; tip timestamp (UTC) → `checkins.checked_in_at`; photo URLs → `checkins.photo_urls` as-is (no download); new venue, no OSM match → `local-only`.
- **Idempotent:** skip rows where `foursquare_id` + `checked_in_at` already exist.
- **Post-import:** venues with no OSM match are flagged `needs-reconcile`.

---

## Export

- `POST /export` (authenticated, any user). Single JSON download of the user's own check-ins + embedded venue snapshots:

```json
{
  "exported_at": "2025-07-15T12:00:00Z",
  "schema_version": 1,
  "username": "john",
  "checkins": [
    {
      "id": 1, "checked_in_at": "2019-06-15T18:30:00Z", "note": "Great burger",
      "lat": 51.5075, "lon": -0.1280, "source": "imported", "photo_urls": ["https://..."],
      "venue": {
        "name": "Joe's Pub", "osm": { "type": "node", "id": 123456 }, "foursquare_id": "abc123",
        "lat": 51.5074, "lon": -0.1278, "address": "151 Great Pudding Ln, London",
        "city": "London", "country": "GB", "category": "amenity=restaurant",
        "osm_tags": { "amenity": "restaurant", "cuisine": "burger" }
      }
    }
  ]
}
```

- Does **not** include `venue_edit_log`, other users' check-ins, or session data.
- **Raw backup:** `docker exec venuecheck sqlite3 /data/venue.db ".backup /data/backup/venue-$(date +%F).db"`

---

## Deployment

Single container (CGO required for the SQLite driver), compose file binding to the LAN address, optional Caddy in front for TLS (flips the `Secure` cookie flag). Run: `docker compose up -d`. See `Dockerfile` and `docker-compose.yml` in this folder (updated from the brief's Go 1.22 / Alpine 3.20 sketch).

---

## Security

| Control | Detail |
|---|---|
| Network | LAN-bind only. No public exposure. |
| Cookies | `HttpOnly`, `SameSite=Strict`, `Secure` (if TLS) |
| CSRF | Per-session token in HTML forms, validated on all POST |
| Input | Parameterized queries only. No string-concat SQL. |
| OSM key | Env var only. Never in DB, HTML, JS, or logs. |
| SQLite | WAL mode. No external table access. |
| No telemetry | No outbound calls except user-triggered OSM/Overpass. No analytics, APM, or external error reporting. |
| Log level | `INFO` default. No PII in logs. |

---

## UI Pages

| Route | Access | Content |
|---|---|---|
| `/login` | Public | Passkey button |
| `/register` | Public (first account only) | Username + passkey |
| `/` | Authed | Recent check-ins list + "Check in" button |
| `/checkin` | Authed | Search → results → confirm → note |
| `/checkins/{id}` | Authed (own) | Detail, edit note/ts, delete |
| `/venues/{id}` | Authed | Shared venue detail, edit fields, map, edit log |
| `/venues` | Authed | Search/browse all venues |
| `/insights` | Authed | Personal insight metrics |
| `/map` | Authed | Full-screen map, check-in + venue markers |
| `/admin/venues` | Admin | Venue list, status, reconcile |
| `/admin/venues/{id}` | Admin | Detail + pull/push/reconcile + edit log |
| `/admin/import` | Admin | File upload for Foursquare/Swarm |
| `/passkeys` | Authed | List, add, deactivate |
| `/export` | Authed | Trigger JSON download |

Mobile-first, responsive, CSS-only layout. Leaflet from local `/static/leaflet/`. No build step; Go templates + embedded static files.

---

## Open / Future

OSM tile re-slice (manual) · bulk OSM import of a city's POIs (out of scope v1) · photo download/storage (URLs only) · per-user OSM accounts for push (single app key) · OSM check-in schema (no visit stats pushed) · multi-language UI (English only).
