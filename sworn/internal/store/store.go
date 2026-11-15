// Package store is Sworn's SQLite persistence layer. All queries are
// parameterized; no SQL is built from user input.
package store

import (
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"time"

	_ "github.com/mattn/go-sqlite3" // CGO driver; build with -tags sqlite_fts5
)

//go:embed schema.sql
var schema string

// ErrNotFound is returned when a row does not exist (or is not visible to the caller).
var ErrNotFound = errors.New("not found")

// Store wraps the database handle.
type Store struct {
	db  *sql.DB
	now func() time.Time
}

// Open opens (creating if needed) the SQLite database in WAL mode and applies the schema.
func Open(path string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_journal_mode=WAL&_foreign_keys=on&_busy_timeout=5000&_synchronous=NORMAL", path)
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // single writer; avoids SQLITE_BUSY in a single-process app
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("apply schema (built without -tags sqlite_fts5?): %w", err)
	}
	return &Store{db: db, now: time.Now}, nil
}

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() }

// Ping checks DB liveness.
func (s *Store) Ping() error { return s.db.Ping() }

// SetClock overrides the clock (tests).
func (s *Store) SetClock(f func() time.Time) { s.now = f }

func (s *Store) ts() string { return s.now().UTC().Format(time.RFC3339) }

func parseTime(v string) time.Time {
	t, _ := time.Parse(time.RFC3339, v)
	return t
}

func nullStr(v sql.NullString) string { return v.String }
