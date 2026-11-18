-- Jigseer hosted schema. Forward-only: never edit this file once applied; add 0002_*.sql instead.
-- Timestamps are UTC ISO 8601 strings (2026-11-14T10:00:00Z) so text order matches time order.

CREATE TABLE puzzles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  total_pieces INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  puzzle_id TEXT NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  connection_count INTEGER NOT NULL DEFAULT 1,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- D1 bills rows scanned (ADR 0008). Transcript, leaderboard and story read a puzzle's hits in
-- time order; the live-update poll reads MAX(updated_at) for a puzzle.
CREATE INDEX hits_puzzle_created ON hits (puzzle_id, created_at);
CREATE INDEX hits_puzzle_updated ON hits (puzzle_id, updated_at);
