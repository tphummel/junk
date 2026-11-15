CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE,
    handle     BLOB NOT NULL,  -- WebAuthn user handle (random, opaque)
    is_admin   BOOLEAN NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS passkeys (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id   BLOB NOT NULL UNIQUE,
    public_key      BLOB NOT NULL,
    credential_json TEXT NOT NULL,
    sign_count      INTEGER NOT NULL DEFAULT 0,
    name            TEXT NOT NULL DEFAULT '',
    active          BOOLEAN NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);

CREATE TABLE IF NOT EXISTS sessions (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id BLOB,
    token         TEXT NOT NULL UNIQUE,
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS venues (
    id            INTEGER PRIMARY KEY,
    osm_type      TEXT,
    osm_id        INTEGER,
    osm_version   INTEGER,
    osm_pulled_at TEXT,
    foursquare_id TEXT,
    name          TEXT NOT NULL,
    lat           REAL NOT NULL DEFAULT 0,
    lon           REAL NOT NULL DEFAULT 0,
    address       TEXT NOT NULL DEFAULT '',
    city          TEXT NOT NULL DEFAULT '',
    country       TEXT NOT NULL DEFAULT '',
    category      TEXT NOT NULL DEFAULT '',
    cuisine       TEXT NOT NULL DEFAULT '',
    website       TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
    osm_tags      TEXT,
    local_notes   TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'local-only'
                  CHECK (status IN ('osm-linked','local-only','needs-reconcile')),
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_venues_name ON venues(name);
CREATE INDEX IF NOT EXISTS idx_venues_latlon ON venues(lat, lon);
CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_osm ON venues(osm_type, osm_id) WHERE osm_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_venues_fsq ON venues(foursquare_id) WHERE foursquare_id IS NOT NULL;

CREATE VIRTUAL TABLE IF NOT EXISTS venues_fts USING fts5(
    name, address, city, category,
    content='venues', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS venues_ai AFTER INSERT ON venues BEGIN
    INSERT INTO venues_fts(rowid, name, address, city, category)
    VALUES (new.id, new.name, new.address, new.city, new.category);
END;
CREATE TRIGGER IF NOT EXISTS venues_ad AFTER DELETE ON venues BEGIN
    INSERT INTO venues_fts(venues_fts, rowid, name, address, city, category)
    VALUES ('delete', old.id, old.name, old.address, old.city, old.category);
END;
CREATE TRIGGER IF NOT EXISTS venues_au AFTER UPDATE ON venues BEGIN
    INSERT INTO venues_fts(venues_fts, rowid, name, address, city, category)
    VALUES ('delete', old.id, old.name, old.address, old.city, old.category);
    INSERT INTO venues_fts(rowid, name, address, city, category)
    VALUES (new.id, new.name, new.address, new.city, new.category);
END;

CREATE TABLE IF NOT EXISTS venue_edit_log (
    id         INTEGER PRIMARY KEY,
    venue_id   INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id),
    field      TEXT NOT NULL,
    old_value  TEXT,
    new_value  TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edit_log_venue ON venue_edit_log(venue_id, created_at DESC);

CREATE TABLE IF NOT EXISTS checkins (
    id                 INTEGER PRIMARY KEY,
    user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    venue_id           INTEGER NOT NULL REFERENCES venues(id),
    venue_name_at_time TEXT NOT NULL,
    note               TEXT NOT NULL DEFAULT '',
    lat                REAL,
    lon                REAL,
    checked_in_at      TEXT NOT NULL,
    source             TEXT NOT NULL CHECK (source IN ('imported','manual','gps')),
    created_at         TEXT NOT NULL,
    photo_urls         TEXT NOT NULL DEFAULT '[]',
    original_at        TEXT NOT NULL DEFAULT ''  -- first recorded time; edits may move checked_in_at at most +/-1 day from it
);
CREATE INDEX IF NOT EXISTS idx_checkins_user_time ON checkins(user_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkins_venue ON checkins(venue_id);

-- OSM write audit (design: "Log failures to audit").
CREATE TABLE IF NOT EXISTS osm_audit (
    id         INTEGER PRIMARY KEY,
    venue_id   INTEGER,
    action     TEXT NOT NULL,
    ok         BOOLEAN NOT NULL,
    detail     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
