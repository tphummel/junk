package db

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

// User is a root identity: just a UUID and a username, per the design doc's
// "no email address associated with the account" model.
type User struct {
	ID        string
	Username  string
	CreatedAt time.Time
}

// CreateUser inserts a new user with the given username, which must be
// unique. Returns ErrConflict-equivalent (a plain error) if it's taken.
func (d *DB) CreateUser(ctx context.Context, username string) (*User, error) {
	u := &User{
		ID:        uuid.NewString(),
		Username:  username,
		CreatedAt: time.Now().UTC(),
	}
	_, err := d.conn.ExecContext(ctx,
		`INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)`,
		u.ID, u.Username, formatTime(u.CreatedAt),
	)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func scanUser(row interface{ Scan(dest ...any) error }) (*User, error) {
	var u User
	var createdAt string
	if err := row.Scan(&u.ID, &u.Username, &createdAt); err != nil {
		return nil, err
	}
	var err error
	u.CreatedAt, err = parseTime(createdAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// GetUserByID looks up a user by their UUID.
func (d *DB) GetUserByID(ctx context.Context, id string) (*User, error) {
	row := d.conn.QueryRowContext(ctx, `SELECT id, username, created_at FROM users WHERE id = ?`, id)
	u, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return u, err
}

// GetUserByUsername looks up a user by their username.
func (d *DB) GetUserByUsername(ctx context.Context, username string) (*User, error) {
	row := d.conn.QueryRowContext(ctx, `SELECT id, username, created_at FROM users WHERE username = ?`, username)
	u, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return u, err
}

// UserSummary is a row in the admin "all users" view.
type UserSummary struct {
	User
	CredentialCount int
}

// ListUsersWithCredentialCounts returns every user along with how many
// credentials (active or not) they have registered, newest account first.
// It backs the admin page.
func (d *DB) ListUsersWithCredentialCounts(ctx context.Context) ([]*UserSummary, error) {
	rows, err := d.conn.QueryContext(ctx, `
		SELECT u.id, u.username, u.created_at, COUNT(c.id)
		FROM users u
		LEFT JOIN credentials c ON c.user_id = u.id
		GROUP BY u.id
		ORDER BY u.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*UserSummary
	for rows.Next() {
		var s UserSummary
		var createdAt string
		if err := rows.Scan(&s.ID, &s.Username, &createdAt, &s.CredentialCount); err != nil {
			return nil, err
		}
		s.CreatedAt, err = parseTime(createdAt)
		if err != nil {
			return nil, err
		}
		out = append(out, &s)
	}
	return out, rows.Err()
}
