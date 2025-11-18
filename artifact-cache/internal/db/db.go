package db

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// DB wraps the SQLite database connection
type DB struct {
	conn *sql.DB
}

// Artifact represents a cached artifact in the database
type Artifact struct {
	ID              int
	SourceURL       string
	ContentHash     string
	StoragePath     string
	FileSize        int64
	ContentType     string
	FirstCachedAt   time.Time
	LastAccessedAt  time.Time
	AccessCount     int
}

// Stats holds cache statistics
type Stats struct {
	TotalItems      int
	TotalSizeBytes  int64
	TotalAccesses   int64
}

// NewDB creates a new database connection and initializes the schema
func NewDB(dataSourceName string) (*DB, error) {
	conn, err := sql.Open("sqlite", dataSourceName)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Enable WAL mode for better concurrency
	if _, err := conn.Exec("PRAGMA journal_mode=WAL"); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to enable WAL mode: %w", err)
	}

	db := &DB{conn: conn}
	if err := db.initSchema(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}

	return db, nil
}

// initSchema creates tables and indexes if they don't exist
func (db *DB) initSchema() error {
	schema := `
		CREATE TABLE IF NOT EXISTS artifacts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_url TEXT NOT NULL UNIQUE,
			content_hash TEXT NOT NULL,
			storage_path TEXT NOT NULL,
			file_size INTEGER NOT NULL,
			content_type TEXT,
			first_cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			access_count INTEGER DEFAULT 0
		);

		CREATE INDEX IF NOT EXISTS idx_source_url ON artifacts(source_url);
		CREATE INDEX IF NOT EXISTS idx_content_hash ON artifacts(content_hash);
		CREATE INDEX IF NOT EXISTS idx_last_accessed ON artifacts(last_accessed_at);
	`

	_, err := db.conn.Exec(schema)
	return err
}

// InsertArtifact adds a new artifact to the database
func (db *DB) InsertArtifact(artifact *Artifact) error {
	query := `
		INSERT INTO artifacts (source_url, content_hash, storage_path, file_size, content_type)
		VALUES (?, ?, ?, ?, ?)
	`

	result, err := db.conn.Exec(query,
		artifact.SourceURL,
		artifact.ContentHash,
		artifact.StoragePath,
		artifact.FileSize,
		artifact.ContentType,
	)
	if err != nil {
		return fmt.Errorf("failed to insert artifact: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return fmt.Errorf("failed to get last insert id: %w", err)
	}

	artifact.ID = int(id)
	return nil
}

// GetArtifactByURL retrieves an artifact by its source URL
func (db *DB) GetArtifactByURL(sourceURL string) (*Artifact, error) {
	query := `
		SELECT id, source_url, content_hash, storage_path, file_size, content_type,
		       first_cached_at, last_accessed_at, access_count
		FROM artifacts
		WHERE source_url = ?
	`

	var artifact Artifact
	err := db.conn.QueryRow(query, sourceURL).Scan(
		&artifact.ID,
		&artifact.SourceURL,
		&artifact.ContentHash,
		&artifact.StoragePath,
		&artifact.FileSize,
		&artifact.ContentType,
		&artifact.FirstCachedAt,
		&artifact.LastAccessedAt,
		&artifact.AccessCount,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query artifact: %w", err)
	}

	return &artifact, nil
}

// UpdateAccessStats updates the last accessed time and increments access count
func (db *DB) UpdateAccessStats(sourceURL string) error {
	query := `
		UPDATE artifacts
		SET last_accessed_at = CURRENT_TIMESTAMP,
		    access_count = access_count + 1
		WHERE source_url = ?
	`

	result, err := db.conn.Exec(query, sourceURL)
	if err != nil {
		return fmt.Errorf("failed to update access stats: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rows == 0 {
		return fmt.Errorf("no artifact found with URL: %s", sourceURL)
	}

	return nil
}

// GetStats returns overall cache statistics
func (db *DB) GetStats() (*Stats, error) {
	query := `
		SELECT
			COUNT(*) as total_items,
			COALESCE(SUM(file_size), 0) as total_size_bytes,
			COALESCE(SUM(access_count), 0) as total_accesses
		FROM artifacts
	`

	var stats Stats
	err := db.conn.QueryRow(query).Scan(
		&stats.TotalItems,
		&stats.TotalSizeBytes,
		&stats.TotalAccesses,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to query stats: %w", err)
	}

	return &stats, nil
}

// Close closes the database connection
func (db *DB) Close() error {
	return db.conn.Close()
}
