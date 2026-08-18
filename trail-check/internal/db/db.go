// Package db is the SQLite + SpatiaLite persistence layer. It owns the
// database connection, schema migrations, and every query the service runs
// -- including the spatial coverage calculations -- since they all share the
// same SpatiaLite-loaded connection and geometry column metadata.
package db

import (
	"database/sql"
	_ "embed"
	"fmt"
	"sync"

	sqlite3 "github.com/mattn/go-sqlite3"
)

//go:embed schema.sql
var schemaSQL string

const driverName = "sqlite3_spatialite"

var registerOnce sync.Once

// DB wraps the SQLite connection with SpatiaLite loaded.
type DB struct {
	conn *sql.DB
}

// Open creates a connection pool with the SpatiaLite extension loaded on
// every connection, initializes SpatiaLite's metadata, and applies the
// schema. spatialiteLib is the loadable extension name (e.g. "mod_spatialite");
// it is resolved via the platform's normal dynamic library search path.
func Open(path, spatialiteLib string) (*DB, error) {
	registerOnce.Do(func() {
		sql.Register(driverName, &sqlite3.SQLiteDriver{
			Extensions: []string{spatialiteLib},
			ConnectHook: func(conn *sqlite3.SQLiteConn) error {
				// SpatiaLite's generated triggers call GeometryConstraints()
				// from schema-defined trigger bodies; recent SQLite refuses
				// that under its default "trusted_schema=OFF" hardening.
				// The schema here is entirely ours, so trusting it is safe.
				if _, err := conn.Exec("PRAGMA trusted_schema = ON", nil); err != nil {
					return fmt.Errorf("enable trusted_schema: %w", err)
				}
				if _, err := conn.Exec("PRAGMA foreign_keys = ON", nil); err != nil {
					return fmt.Errorf("enable foreign_keys: %w", err)
				}
				if _, err := conn.Exec("PRAGMA busy_timeout = 5000", nil); err != nil {
					return fmt.Errorf("set busy_timeout: %w", err)
				}
				return nil
			},
		})
	})

	conn, err := sql.Open(driverName, path)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	// SQLite has a single writer; serialize all access through one
	// connection so we never hit SQLITE_BUSY under the pool's default
	// concurrent-connection behavior. Traffic here is low (single
	// user/small team), so this trades a little write concurrency for a
	// much simpler, lock-free story.
	conn.SetMaxOpenConns(1)

	if _, err := conn.Exec("PRAGMA journal_mode = WAL"); err != nil {
		conn.Close()
		return nil, fmt.Errorf("enable WAL mode: %w", err)
	}

	if _, err := conn.Exec("SELECT InitSpatialMetaData(1)"); err != nil {
		conn.Close()
		return nil, fmt.Errorf("init spatial metadata: %w", err)
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
