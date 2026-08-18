-- trail-check schema. Applied once at startup inside NewDB.
-- Spatial columns are added below via AddGeometryColumn() rather than plain
-- CREATE TABLE, since SpatiaLite needs to register them in its own metadata
-- tables (geometry_columns) for ST_* functions and AsGeoJSON() to work.

CREATE TABLE IF NOT EXISTS user (
    id         TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS passkey (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    credential_id   BLOB NOT NULL UNIQUE,
    public_key      BLOB NOT NULL,
    credential_json TEXT NOT NULL,
    label           TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    sign_count      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_used_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_passkey_user_id ON passkey(user_id);

CREATE TABLE IF NOT EXISTS session (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    expires_at   TEXT NOT NULL,
    revoked_at   TEXT,
    last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    device_label TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_session_user_id ON session(user_id);

CREATE TABLE IF NOT EXISTS catalog_trail (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    slug       TEXT NOT NULL UNIQUE,
    length_m   REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS trail_segment (
    id               TEXT PRIMARY KEY,
    catalog_trail_id TEXT NOT NULL REFERENCES catalog_trail(id) ON DELETE CASCADE,
    seq_order        INTEGER NOT NULL,
    name             TEXT NOT NULL DEFAULT '',
    length_m         REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_trail_segment_catalog_trail_id ON trail_segment(catalog_trail_id);

CREATE TABLE IF NOT EXISTS user_trail (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    catalog_trail_id TEXT NOT NULL REFERENCES catalog_trail(id) ON DELETE CASCADE,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (user_id, catalog_trail_id)
);

CREATE INDEX IF NOT EXISTS idx_user_trail_user_id ON user_trail(user_id);

CREATE TABLE IF NOT EXISTS run (
    id            TEXT PRIMARY KEY,
    user_trail_id TEXT NOT NULL REFERENCES user_trail(id) ON DELETE CASCADE,
    name          TEXT NOT NULL DEFAULT '',
    uploaded_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'error')),
    length_m      REAL NOT NULL DEFAULT 0,
    matched_len   REAL,
    coverage_pct  REAL,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_run_user_trail_id ON run(user_trail_id);

-- Geometry columns: SRID 4326 (WGS84), stored as MULTILINESTRING.
SELECT AddGeometryColumn('catalog_trail', 'geom', 4326, 'MULTILINESTRING', 'XY');
SELECT AddGeometryColumn('trail_segment', 'geom', 4326, 'MULTILINESTRING', 'XY');
SELECT AddGeometryColumn('run', 'geom', 4326, 'MULTILINESTRING', 'XY');
SELECT AddGeometryColumn('run', 'gap_geom', 4326, 'MULTILINESTRING', 'XY');
