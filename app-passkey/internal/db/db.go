// Package db is the SQLite persistence layer for app-passkey: the database
// connection, schema, and every query the service runs against users,
// credentials, recovery codes, and in-flight WebAuthn challenges.
package db

import (
	"database/sql"
	_ "embed"
	"errors"
	"fmt"

	_ "github.com/mattn/go-sqlite3"
)

//go:embed schema.sql
var schemaSQL string

// ErrNotFound is returned when a lookup by ID or unique key matches nothing.
var ErrNotFound = errors.New("db: not found")

// DB wraps the SQLite connection.
type DB struct {
	conn *sql.DB
}

// Open creates a connection pool, applies PRAGMAs from the design doc
// (WAL journaling, foreign keys), and applies the schema.
func Open(path string) (*DB, error) {
	conn, err := sql.Open("sqlite3", path)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	// SQLite has a single writer; serialize all access through one
	// connection so concurrent requests never hit SQLITE_BUSY. Traffic
	// here is low (a personal identity service), so this trades a little
	// write concurrency for a much simpler, lock-free story.
	conn.SetMaxOpenConns(1)

	if _, err := conn.Exec("PRAGMA journal_mode = WAL"); err != nil {
		conn.Close()
		return nil, fmt.Errorf("enable WAL mode: %w", err)
	}
	if _, err := conn.Exec("PRAGMA foreign_keys = ON"); err != nil {
		conn.Close()
		return nil, fmt.Errorf("enable foreign_keys: %w", err)
	}
	if _, err := conn.Exec(schemaSQL); err != nil {
		conn.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}

	return &DB{conn: conn}, nil
}

// Close closes the underlying connection pool.
func (d *DB) Close() error {
	return d.conn.Close()
}
