-- daily-solitaire schema. One SQLite file holds everything; every
-- user-owned row carries user_id with ON DELETE CASCADE, so deleting an
-- account is one statement and exporting one is one query per table.

CREATE TABLE users (
    id           TEXT PRIMARY KEY,                 -- ULID; also the WebAuthn user handle
    username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    deck         TEXT NOT NULL DEFAULT 'paper',
    disabled_at  TEXT,
    created_at   TEXT NOT NULL
);

CREATE TABLE credentials (
    id              TEXT PRIMARY KEY,              -- ULID
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id   BLOB NOT NULL UNIQUE,          -- raw WebAuthn credential ID
    credential_json TEXT NOT NULL,                 -- go-webauthn Credential
    aaguid          TEXT NOT NULL DEFAULT '',
    name            TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    last_used_at    TEXT
);
CREATE INDEX idx_credentials_user ON credentials(user_id);

CREATE TABLE sessions (
    id           TEXT PRIMARY KEY,                 -- sha256 of the cookie token
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    user_agent   TEXT NOT NULL DEFAULT '',
    fresh_until  TEXT                              -- step-up: user-verified assertion is recent until this time
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE recovery_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL UNIQUE,
    used_at    TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX idx_recovery_codes_user ON recovery_codes(user_id);

-- Single-use links issued by the admin CLI (account creation and recovery).
CREATE TABLE recovery_links (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at    TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event      TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_user ON audit_log(user_id, id DESC);

-- Short-lived WebAuthn ceremony state, kept server-side.
CREATE TABLE challenges (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    user_id    TEXT NOT NULL DEFAULT '',
    data       TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

-- Offline-solved winnable seeds. The solution is the proof; it is loaded by
-- the admin CLI so no solver runs in production.
CREATE TABLE seed_pool (
    seed      INTEGER PRIMARY KEY,
    solution  TEXT NOT NULL,
    used_date TEXT
);
CREATE INDEX idx_seed_pool_unused ON seed_pool(used_date) WHERE used_date IS NULL;

CREATE TABLE daily_deals (
    date       TEXT PRIMARY KEY,
    variant    TEXT NOT NULL DEFAULT 'klondike',
    ruleset    TEXT NOT NULL,
    seed       INTEGER NOT NULL,
    pooled     INTEGER NOT NULL DEFAULT 0,       -- 1 when the seed came from the proven-winnable pool
    created_at TEXT NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE games (
    id             TEXT PRIMARY KEY,               -- ULID
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    variant        TEXT NOT NULL DEFAULT 'klondike',
    ruleset        TEXT NOT NULL,
    seed           INTEGER NOT NULL,
    deal_date      TEXT NOT NULL REFERENCES daily_deals(date),
    started_at     TEXT NOT NULL,
    first_move_at  TEXT,
    ended_at       TEXT,
    deadline       TEXT NOT NULL,                  -- 3:00 a.m. Pacific after the day it was started
    result         TEXT CHECK (result IN ('won', 'resigned', 'expired')),
    move_count     INTEGER NOT NULL DEFAULT 0,     -- counted actions: move, draw, recycle, undo
    elapsed_ms     INTEGER,                        -- first move to last move, set when the game ends
    engine_version INTEGER NOT NULL,
    UNIQUE (user_id, deal_date)                    -- one play per deal, no replays
);
CREATE INDEX idx_games_deal_date ON games(deal_date);
CREATE INDEX idx_games_user ON games(user_id);
CREATE INDEX idx_games_open ON games(deadline) WHERE result IS NULL;

CREATE TABLE moves (
    game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,
    type       TEXT NOT NULL CHECK (type IN ('move', 'draw', 'recycle', 'undo', 'auto', 'resign')),
    from_pile  TEXT NOT NULL DEFAULT '',
    to_pile    TEXT NOT NULL DEFAULT '',
    cards      TEXT NOT NULL DEFAULT '[]',         -- JSON array of card ids
    created_at TEXT NOT NULL,
    PRIMARY KEY (game_id, seq)
) WITHOUT ROWID;

-- Stats are views only: nothing to rebuild or keep in sync.

CREATE VIEW v_daily_board AS
SELECT g.deal_date,
       g.user_id,
       u.display_name,
       g.result,
       g.move_count,
       g.elapsed_ms,
       ROW_NUMBER() OVER (
           PARTITION BY g.deal_date
           ORDER BY (g.result = 'won') DESC,
                    CASE WHEN g.result = 'won' THEN g.move_count END ASC,
                    CASE WHEN g.result = 'won' THEN g.elapsed_ms END ASC,
                    g.ended_at ASC
       ) AS rank
FROM games g
JOIN users u ON u.id = g.user_id
WHERE g.result IS NOT NULL;

CREATE VIEW v_user_stats AS
SELECT user_id,
       COUNT(*)                                          AS played,
       SUM(result = 'won')                               AS wins,
       ROUND(100.0 * SUM(result = 'won') / COUNT(*), 1)  AS win_rate,
       AVG(CASE WHEN result = 'won' THEN move_count END) AS avg_moves,
       MIN(CASE WHEN result = 'won' THEN move_count END) AS best_moves,
       MIN(CASE WHEN result = 'won' THEN elapsed_ms END) AS best_ms
FROM games
WHERE result IS NOT NULL
GROUP BY user_id;

-- Runs of consecutive winning dates (gaps and islands).
CREATE VIEW v_win_streaks AS
SELECT user_id,
       MIN(deal_date) AS start_date,
       MAX(deal_date) AS end_date,
       COUNT(*)       AS length
FROM (
    SELECT user_id,
           deal_date,
           julianday(deal_date) - ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY deal_date) AS island
    FROM games
    WHERE result = 'won'
)
GROUP BY user_id, island;
