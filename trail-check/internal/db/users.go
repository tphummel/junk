package db

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

// ErrNotFound is returned when a lookup finds no matching row.
var ErrNotFound = errors.New("db: not found")

// User is an account. Identity lives entirely in the WebAuthn credentials
// attached to it; there is no username or email by design.
type User struct {
	ID        string
	CreatedAt time.Time
}

// CreateUser inserts a new user and returns it.
func (d *DB) CreateUser(ctx context.Context) (*User, error) {
	u := &User{ID: uuid.NewString(), CreatedAt: time.Now().UTC()}
	_, err := d.conn.ExecContext(ctx,
		`INSERT INTO user (id, created_at) VALUES (?, ?)`,
		u.ID, formatTime(u.CreatedAt),
	)
	if err != nil {
		return nil, err
	}
	return u, nil
}

// GetUser fetches a user by ID.
func (d *DB) GetUser(ctx context.Context, id string) (*User, error) {
	var u User
	var createdAt string
	err := d.conn.QueryRowContext(ctx,
		`SELECT id, created_at FROM user WHERE id = ?`, id,
	).Scan(&u.ID, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	u.CreatedAt, err = parseTime(createdAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// DeleteUser removes a user and cascades to their passkeys, sessions,
// user_trails and runs via foreign key ON DELETE CASCADE.
func (d *DB) DeleteUser(ctx context.Context, id string) error {
	res, err := d.conn.ExecContext(ctx, `DELETE FROM user WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// AnyUserExists reports whether at least one account has been created yet.
func (d *DB) AnyUserExists(ctx context.Context) (bool, error) {
	var exists int
	err := d.conn.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM user)`).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists == 1, nil
}

func formatTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339Nano)
}

func parseTime(s string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t, nil
	}
	// SQLite's strftime default columns use this layout.
	return time.Parse("2006-01-02T15:04:05.000Z", s)
}

func parseTimePtr(s sql.NullString) (*time.Time, error) {
	if !s.Valid || s.String == "" {
		return nil, nil
	}
	t, err := parseTime(s.String)
	if err != nil {
		return nil, err
	}
	return &t, nil
}
