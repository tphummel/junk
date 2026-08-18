package db

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

// Session is a logged-in session, one per device/browser.
type Session struct {
	ID          string
	UserID      string
	ExpiresAt   time.Time
	RevokedAt   *time.Time
	LastSeenAt  time.Time
	DeviceLabel string
	CreatedAt   time.Time
}

// CreateSession starts a new session for a user that expires after ttl.
func (d *DB) CreateSession(ctx context.Context, userID, deviceLabel string, ttl time.Duration) (*Session, error) {
	now := time.Now().UTC()
	s := &Session{
		ID:          uuid.NewString(),
		UserID:      userID,
		ExpiresAt:   now.Add(ttl),
		LastSeenAt:  now,
		DeviceLabel: deviceLabel,
		CreatedAt:   now,
	}
	_, err := d.conn.ExecContext(ctx, `
		INSERT INTO session (id, user_id, expires_at, last_seen_at, device_label, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		s.ID, s.UserID, formatTime(s.ExpiresAt), formatTime(s.LastSeenAt), s.DeviceLabel, formatTime(s.CreatedAt),
	)
	if err != nil {
		return nil, err
	}
	return s, nil
}

func scanSession(row interface {
	Scan(dest ...any) error
}) (*Session, error) {
	var s Session
	var expiresAt, lastSeenAt, createdAt string
	var revokedAt sql.NullString
	err := row.Scan(&s.ID, &s.UserID, &expiresAt, &revokedAt, &lastSeenAt, &s.DeviceLabel, &createdAt)
	if err != nil {
		return nil, err
	}
	if s.ExpiresAt, err = parseTime(expiresAt); err != nil {
		return nil, err
	}
	if s.LastSeenAt, err = parseTime(lastSeenAt); err != nil {
		return nil, err
	}
	if s.CreatedAt, err = parseTime(createdAt); err != nil {
		return nil, err
	}
	if s.RevokedAt, err = parseTimePtr(revokedAt); err != nil {
		return nil, err
	}
	return &s, nil
}

const sessionColumns = `id, user_id, expires_at, revoked_at, last_seen_at, device_label, created_at`

// GetSession fetches a session by ID.
func (d *DB) GetSession(ctx context.Context, id string) (*Session, error) {
	row := d.conn.QueryRowContext(ctx, `SELECT `+sessionColumns+` FROM session WHERE id = ?`, id)
	s, err := scanSession(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

// ListSessionsByUser returns all sessions for a user, most recently seen first.
func (d *DB) ListSessionsByUser(ctx context.Context, userID string) ([]*Session, error) {
	rows, err := d.conn.QueryContext(ctx, `SELECT `+sessionColumns+` FROM session WHERE user_id = ? ORDER BY last_seen_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*Session
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// TouchSession updates last_seen_at for an active session.
func (d *DB) TouchSession(ctx context.Context, id string) error {
	_, err := d.conn.ExecContext(ctx, `UPDATE session SET last_seen_at = ? WHERE id = ?`, formatTime(time.Now().UTC()), id)
	return err
}

// RevokeSession marks a session revoked, ending it immediately.
func (d *DB) RevokeSession(ctx context.Context, id, userID string) error {
	res, err := d.conn.ExecContext(ctx,
		`UPDATE session SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
		formatTime(time.Now().UTC()), id, userID,
	)
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

// RevokeAllSessionsForUser revokes every active session for a user.
func (d *DB) RevokeAllSessionsForUser(ctx context.Context, userID string) error {
	_, err := d.conn.ExecContext(ctx,
		`UPDATE session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
		formatTime(time.Now().UTC()), userID,
	)
	return err
}
