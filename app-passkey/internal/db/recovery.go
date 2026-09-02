package db

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// RecoveryCode is one hashed, single-use "break-glass" recovery code.
type RecoveryCode struct {
	ID        int64
	UserID    string
	LookupID  string
	CodeHash  []byte
	UsedAt    *time.Time
	CreatedAt time.Time
}

// InsertRecoveryCodes stores a freshly generated batch of hashed recovery
// codes for a user, all in one transaction so a partial batch never lands.
func (d *DB) InsertRecoveryCodes(ctx context.Context, userID string, lookupIDs []string, hashes [][]byte) error {
	if len(lookupIDs) != len(hashes) {
		return errors.New("lookupIDs and hashes length mismatch")
	}
	tx, err := d.conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := formatTime(time.Now().UTC())
	for i := range lookupIDs {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO recovery_codes (user_id, lookup_id, code_hash, created_at) VALUES (?, ?, ?, ?)`,
			userID, lookupIDs[i], hashes[i], now,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GetUnusedRecoveryCodeByLookupID finds an unused recovery code by its
// lookup prefix. Returns ErrNotFound if it doesn't exist or was already used.
func (d *DB) GetUnusedRecoveryCodeByLookupID(ctx context.Context, lookupID string) (*RecoveryCode, error) {
	row := d.conn.QueryRowContext(ctx, `
		SELECT id, user_id, lookup_id, code_hash, used_at, created_at
		FROM recovery_codes WHERE lookup_id = ? AND used_at IS NULL`, lookupID)

	var rc RecoveryCode
	var usedAt sql.NullString
	var createdAt string
	err := row.Scan(&rc.ID, &rc.UserID, &rc.LookupID, &rc.CodeHash, &usedAt, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	rc.CreatedAt, err = parseTime(createdAt)
	if err != nil {
		return nil, err
	}
	rc.UsedAt, err = parseTimePtr(usedAt)
	if err != nil {
		return nil, err
	}
	return &rc, nil
}

// MarkRecoveryCodeUsed consumes a recovery code, atomically failing if it
// was already used (single-use enforcement).
func (d *DB) MarkRecoveryCodeUsed(ctx context.Context, id int64) error {
	res, err := d.conn.ExecContext(ctx,
		`UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`,
		formatTime(time.Now().UTC()), id,
	)
	if err != nil {
		return err
	}
	return checkRowsAffected(res)
}

// CountUnusedRecoveryCodes reports how many recovery codes a user has left.
func (d *DB) CountUnusedRecoveryCodes(ctx context.Context, userID string) (int, error) {
	var n int
	err := d.conn.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM recovery_codes WHERE user_id = ? AND used_at IS NULL`, userID,
	).Scan(&n)
	return n, err
}
