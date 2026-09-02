-- app-passkey schema. Applied once at startup inside Open.
--
-- This mirrors the design doc's data model (users / credentials /
-- recovery_codes / challenges) with two pragmatic additions: a
-- `credential_id` column on credentials (the raw WebAuthn credential ID,
-- needed to look up a credential independently of its DB-generated `id`),
-- and a `lookup_id` column on recovery_codes (a non-secret prefix that lets
-- a submitted recovery code find its candidate row without scanning every
-- hash in the table). Both are just indexes into data the design doc already
-- describes; no new concepts.

CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS credentials (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id   BLOB NOT NULL UNIQUE,
    public_key      BLOB NOT NULL,
    credential_json TEXT NOT NULL,
    sign_count      INTEGER NOT NULL DEFAULT 0,
    nickname        TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_used_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_credentials_user_id ON credentials(user_id);

CREATE TABLE IF NOT EXISTS recovery_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lookup_id  TEXT NOT NULL UNIQUE,
    code_hash  BLOB NOT NULL,
    used_at    TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_user_id ON recovery_codes(user_id);

-- challenges holds in-flight WebAuthn ceremony state (registration or login)
-- so it survives across the Begin/Finish request pair even if those land on
-- different server instances. `challenge` stores the JSON-encoded ceremony
-- payload (the go-webauthn SessionData plus a little bookkeeping); user_id
-- is set for registration ceremonies (bootstrap signup, add-key, or
-- break-glass recovery) and empty for a login ceremony, which doesn't know
-- the user's ID until the assertion resolves it via username lookup done
-- beforehand. There's no foreign key on user_id: a signup ceremony's user
-- doesn't exist yet when the challenge row is created.
CREATE TABLE IF NOT EXISTS challenges (
    session_id TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL DEFAULT '',
    challenge  BLOB NOT NULL,
    expires_at TEXT NOT NULL
);
