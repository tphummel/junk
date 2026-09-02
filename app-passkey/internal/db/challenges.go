package db

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// PutChallenge stores in-flight WebAuthn ceremony state, keyed by an opaque
// session ID handed to the browser. userID is the account the ceremony is
// for (empty for a login ceremony started before the user is resolved).
func (d *DB) PutChallenge(ctx context.Context, sessionID, userID string, payload []byte, expiresAt time.Time) error {
	_, err := d.conn.ExecContext(ctx,
		`INSERT INTO challenges (session_id, user_id, challenge, expires_at) VALUES (?, ?, ?, ?)`,
		sessionID, userID, payload, formatTime(expiresAt),
	)
	return err
}

// TakeChallenge retrieves and deletes a pending challenge; ceremonies are
// one-shot. Returns ErrNotFound if the session ID is unknown or expired.
func (d *DB) TakeChallenge(ctx context.Context, sessionID string) (userID string, payload []byte, err error) {
	tx, err := d.conn.BeginTx(ctx, nil)
	if err != nil {
		return "", nil, err
	}
	defer tx.Rollback()

	var expiresAt string
	row := tx.QueryRowContext(ctx, `SELECT user_id, challenge, expires_at FROM challenges WHERE session_id = ?`, sessionID)
	if err := row.Scan(&userID, &payload, &expiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil, ErrNotFound
		}
		return "", nil, err
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM challenges WHERE session_id = ?`, sessionID); err != nil {
		return "", nil, err
	}
	if err := tx.Commit(); err != nil {
		return "", nil, err
	}

	expiry, err := parseTime(expiresAt)
	if err != nil {
		return "", nil, err
	}
	if time.Now().UTC().After(expiry) {
		return "", nil, ErrNotFound
	}
	return userID, payload, nil
}

// PruneExpiredChallenges deletes any challenge rows past their expiry, so
// abandoned ceremonies don't accumulate forever.
func (d *DB) PruneExpiredChallenges(ctx context.Context) error {
	_, err := d.conn.ExecContext(ctx, `DELETE FROM challenges WHERE expires_at < ?`, formatTime(time.Now().UTC()))
	return err
}
