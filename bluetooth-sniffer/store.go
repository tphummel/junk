package main

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          REAL    NOT NULL,
  sensor      TEXT,             -- address of the local adapter that heard it
  addr        TEXT    NOT NULL,
  addr_type   TEXT,             -- 'public' | 'random'
  name        TEXT,             -- BlueZ Name
  alias       TEXT,             -- BlueZ Alias (MAC-derived when unnamed)
  rssi        INTEGER,          -- dBm, can be NULL
  svc_uuids   TEXT,             -- ';'-joined
  mfr_id      INTEGER,          -- lowest manufacturer company ID present
  mfr_data    TEXT,             -- '0xCID=hex;...' , '' if none
  svc_data    TEXT,             -- 'uuid=hex;...', '' if none
  txp         INTEGER,          -- dBm, can be NULL
  ad_flags    INTEGER,          -- raw AD Flags byte, NULL if absent
  appearance  INTEGER,          -- GAP appearance code
  modalias    TEXT,
  changed     TEXT,             -- ';'-joined properties in this update, or 'added'
  raw_ad      TEXT              -- '0xTYPE=hex;...' (needs -raw-ad and bluetoothd -E)
);
CREATE INDEX IF NOT EXISTS idx_events_ts   ON events (ts);
CREATE INDEX IF NOT EXISTS idx_events_addr ON events (addr, ts);

CREATE TABLE IF NOT EXISTS devices (
  addr          TEXT PRIMARY KEY,
  addr_type     TEXT,
  name          TEXT,
  alias         TEXT,
  svc_uuids     TEXT,
  mfr_id        INTEGER,
  appearance    INTEGER,
  modalias      TEXT,
  first_seen    REAL,
  last_seen     REAL,
  seen_count    INTEGER NOT NULL DEFAULT 0,
  last_rssi     INTEGER,
  min_rssi      INTEGER,
  max_rssi      INTEGER
);
`

const upsertSQL = `
INSERT INTO devices (addr, addr_type, name, alias, svc_uuids, mfr_id, appearance, modalias,
                     first_seen, last_seen, seen_count, last_rssi, min_rssi, max_rssi)
VALUES (?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?)
ON CONFLICT(addr) DO UPDATE SET
  seen_count = seen_count + excluded.seen_count,
  first_seen = MIN(COALESCE(first_seen, excluded.first_seen), excluded.first_seen),
  last_seen  = MAX(COALESCE(last_seen, excluded.last_seen), excluded.last_seen),
  last_rssi  = COALESCE(excluded.last_rssi, last_rssi),
  min_rssi   = CASE WHEN min_rssi IS NULL THEN excluded.min_rssi
                    WHEN excluded.min_rssi IS NULL THEN min_rssi
                    ELSE MIN(min_rssi, excluded.min_rssi) END,
  max_rssi   = CASE WHEN max_rssi IS NULL THEN excluded.max_rssi
                    WHEN excluded.max_rssi IS NULL THEN max_rssi
                    ELSE MAX(max_rssi, excluded.max_rssi) END,
  name       = COALESCE(excluded.name, name),
  alias      = COALESCE(excluded.alias, alias),
  svc_uuids  = COALESCE(excluded.svc_uuids, svc_uuids),
  addr_type  = COALESCE(excluded.addr_type, addr_type),
  mfr_id     = COALESCE(excluded.mfr_id, mfr_id),
  appearance = COALESCE(excluded.appearance, appearance),
  modalias   = COALESCE(excluded.modalias, modalias)
`

// columnsAdded lists columns introduced after the first schema; migrate adds
// them to older databases.
var columnsAdded = []struct{ table, col, typ string }{
	{"events", "ad_flags", "INTEGER"},
	{"events", "alias", "TEXT"},
	{"events", "sensor", "TEXT"},
	{"events", "mfr_id", "INTEGER"},
	{"events", "appearance", "INTEGER"},
	{"events", "modalias", "TEXT"},
	{"events", "changed", "TEXT"},
	{"events", "raw_ad", "TEXT"},
	{"devices", "alias", "TEXT"},
	{"devices", "mfr_id", "INTEGER"},
	{"devices", "appearance", "INTEGER"},
	{"devices", "modalias", "TEXT"},
}

type store struct {
	db *sql.DB
}

func openStore(path string) (*store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	// A single connection keeps pragmas applied and serialises writes.
	db.SetMaxOpenConns(1)
	for _, p := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA synchronous=NORMAL",
		"PRAGMA busy_timeout=5000",
	} {
		if _, err := db.Exec(p); err != nil {
			db.Close()
			return nil, fmt.Errorf("%s: %w", p, err)
		}
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("create schema: %w", err)
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &store{db: db}, nil
}

// migrate upgrades databases created with earlier schemas: it adds the
// columns in columnsAdded and drops events.connectable (BlueZ cannot tell us
// connectability; ad_flags replaces it).
func migrate(db *sql.DB) error {
	cols := func(table string) (map[string]bool, error) {
		rows, err := db.Query("SELECT name FROM pragma_table_info(?)", table)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		m := map[string]bool{}
		for rows.Next() {
			var n string
			if err := rows.Scan(&n); err != nil {
				return nil, err
			}
			m[n] = true
		}
		return m, rows.Err()
	}
	have := map[string]map[string]bool{}
	for _, t := range []string{"events", "devices"} {
		m, err := cols(t)
		if err != nil {
			return err
		}
		have[t] = m
	}
	var stmts []string
	for _, c := range columnsAdded {
		if !have[c.table][c.col] {
			stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", c.table, c.col, c.typ))
		}
	}
	if have["events"]["connectable"] {
		stmts = append(stmts, "ALTER TABLE events DROP COLUMN connectable")
	}
	for _, q := range stmts {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("%s: %w", q, err)
		}
	}
	return nil
}

func (s *store) Close() error { return s.db.Close() }

// rollup is the per-address aggregate of a batch of sightings.
type rollup struct {
	addrType, name, alias, uuids, modalias string
	first, last                            float64
	count                                  int
	lastRSSI, minRSSI, maxRSSI             *int
	mfrID, appearance                      *int
}

// Write inserts the batch into events and folds it into devices, in one
// transaction.
func (s *store) Write(batch []sighting) error {
	if len(batch) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	ins, err := tx.Prepare(`INSERT INTO events
		(ts, sensor, addr, addr_type, name, alias, rssi, svc_uuids, mfr_id, mfr_data, svc_data,
		 txp, ad_flags, appearance, modalias, changed, raw_ad)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		return err
	}
	defer ins.Close()

	rolls := map[string]*rollup{}
	var order []string
	for _, e := range batch {
		if _, err := ins.Exec(e.TS, e.Sensor, e.Addr, e.AddrType, e.Name, e.Alias, ptr(e.RSSI),
			e.SvcUUIDs, ptr(e.MfrID), e.MfrData, e.SvcData, ptr(e.TxPower), ptr(e.ADFlags),
			ptr(e.Appearance), e.Modalias, e.Changed, e.RawAD); err != nil {
			return err
		}
		r := rolls[e.Addr]
		if r == nil {
			r = &rollup{first: e.TS, last: e.TS}
			rolls[e.Addr] = r
			order = append(order, e.Addr)
		}
		r.count++
		r.first = min(r.first, e.TS)
		r.last = max(r.last, e.TS)
		if e.AddrType != "" {
			r.addrType = e.AddrType
		}
		if e.Name != "" {
			r.name = e.Name
		}
		if e.Alias != "" {
			r.alias = e.Alias
		}
		if e.SvcUUIDs != "" {
			r.uuids = e.SvcUUIDs
		}
		if e.Modalias != "" {
			r.modalias = e.Modalias
		}
		if e.MfrID != nil {
			r.mfrID = e.MfrID
		}
		if e.Appearance != nil {
			r.appearance = e.Appearance
		}
		if e.RSSI != nil {
			v := *e.RSSI
			r.lastRSSI = &v
			if r.minRSSI == nil || v < *r.minRSSI {
				r.minRSSI = &v
			}
			if r.maxRSSI == nil || v > *r.maxRSSI {
				r.maxRSSI = &v
			}
		}
	}

	up, err := tx.Prepare(upsertSQL)
	if err != nil {
		return err
	}
	defer up.Close()
	for _, addr := range order {
		r := rolls[addr]
		if _, err := up.Exec(addr, r.addrType, r.name, r.alias, r.uuids, ptr(r.mfrID), ptr(r.appearance), r.modalias,
			r.first, r.last, r.count, ptr(r.lastRSSI), ptr(r.minRSSI), ptr(r.maxRSSI)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Purge deletes events older than keepDays, optionally VACUUMing afterwards.
// It returns the number of deleted rows.
func (s *store) Purge(now time.Time, keepDays int, vacuum bool) (int64, error) {
	cutoff := float64(now.Unix()) - float64(keepDays)*86400
	res, err := s.db.Exec("DELETE FROM events WHERE ts < ?", cutoff)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if vacuum {
		if _, err := s.db.Exec("VACUUM"); err != nil {
			return n, err
		}
	}
	return n, nil
}

func ptr(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}
