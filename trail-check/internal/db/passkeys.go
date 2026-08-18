package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
)

// PasskeyStatus is the lifecycle state of a stored credential.
type PasskeyStatus string

const (
	PasskeyActive    PasskeyStatus = "active"
	PasskeySuspended PasskeyStatus = "suspended"
)

// Passkey is a stored WebAuthn credential belonging to a user.
type Passkey struct {
	ID           string
	UserID       string
	CredentialID []byte
	PublicKey    []byte
	Credential   webauthn.Credential
	Label        string
	Status       PasskeyStatus
	SignCount    uint32
	CreatedAt    time.Time
	LastUsedAt   *time.Time
}

// InsertPasskey stores a newly registered credential for a user.
func (d *DB) InsertPasskey(ctx context.Context, userID, label string, cred webauthn.Credential) (*Passkey, error) {
	credJSON, err := json.Marshal(cred)
	if err != nil {
		return nil, err
	}
	pk := &Passkey{
		ID:           uuid.NewString(),
		UserID:       userID,
		CredentialID: cred.ID,
		PublicKey:    cred.PublicKey,
		Credential:   cred,
		Label:        label,
		Status:       PasskeyActive,
		SignCount:    cred.Authenticator.SignCount,
		CreatedAt:    time.Now().UTC(),
	}
	_, err = d.conn.ExecContext(ctx, `
		INSERT INTO passkey (id, user_id, credential_id, public_key, credential_json, label, status, sign_count, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		pk.ID, pk.UserID, pk.CredentialID, pk.PublicKey, string(credJSON), pk.Label, string(pk.Status), pk.SignCount, formatTime(pk.CreatedAt),
	)
	if err != nil {
		return nil, err
	}
	return pk, nil
}

func scanPasskey(row interface {
	Scan(dest ...any) error
}) (*Passkey, error) {
	var pk Passkey
	var status, credJSON, createdAt string
	var lastUsedAt sql.NullString
	err := row.Scan(&pk.ID, &pk.UserID, &pk.CredentialID, &pk.PublicKey, &credJSON, &pk.Label, &status, &pk.SignCount, &createdAt, &lastUsedAt)
	if err != nil {
		return nil, err
	}
	pk.Status = PasskeyStatus(status)
	if err := json.Unmarshal([]byte(credJSON), &pk.Credential); err != nil {
		return nil, err
	}
	pk.CreatedAt, err = parseTime(createdAt)
	if err != nil {
		return nil, err
	}
	pk.LastUsedAt, err = parseTimePtr(lastUsedAt)
	if err != nil {
		return nil, err
	}
	return &pk, nil
}

const passkeyColumns = `id, user_id, credential_id, public_key, credential_json, label, status, sign_count, created_at, last_used_at`

// GetPasskeyByCredentialID looks up a credential by its raw WebAuthn credential ID.
func (d *DB) GetPasskeyByCredentialID(ctx context.Context, credentialID []byte) (*Passkey, error) {
	row := d.conn.QueryRowContext(ctx, `SELECT `+passkeyColumns+` FROM passkey WHERE credential_id = ?`, credentialID)
	pk, err := scanPasskey(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return pk, err
}

// ListPasskeysByUser returns all credentials belonging to a user, newest first.
func (d *DB) ListPasskeysByUser(ctx context.Context, userID string) ([]*Passkey, error) {
	rows, err := d.conn.QueryContext(ctx, `SELECT `+passkeyColumns+` FROM passkey WHERE user_id = ? ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*Passkey
	for rows.Next() {
		pk, err := scanPasskey(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, pk)
	}
	return out, rows.Err()
}

// CountActivePasskeys returns how many active (non-suspended) credentials a user has.
func (d *DB) CountActivePasskeys(ctx context.Context, userID string) (int, error) {
	var n int
	err := d.conn.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM passkey WHERE user_id = ? AND status = 'active'`, userID,
	).Scan(&n)
	return n, err
}

// TouchPasskey persists an updated sign counter (and clone-warning state)
// after a successful assertion, and bumps last_used_at. This must happen on
// every login to detect cloned authenticators via the SignCount rule.
func (d *DB) TouchPasskey(ctx context.Context, id string, cred webauthn.Credential) error {
	credJSON, err := json.Marshal(cred)
	if err != nil {
		return err
	}
	_, err = d.conn.ExecContext(ctx,
		`UPDATE passkey SET credential_json = ?, sign_count = ?, last_used_at = ? WHERE id = ?`,
		string(credJSON), cred.Authenticator.SignCount, formatTime(time.Now().UTC()), id,
	)
	return err
}

// SetPasskeyStatus activates or suspends a credential.
func (d *DB) SetPasskeyStatus(ctx context.Context, id, userID string, status PasskeyStatus) error {
	res, err := d.conn.ExecContext(ctx,
		`UPDATE passkey SET status = ? WHERE id = ? AND user_id = ?`, string(status), id, userID,
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

// DeletePasskey removes a credential owned by userID.
func (d *DB) DeletePasskey(ctx context.Context, id, userID string) error {
	res, err := d.conn.ExecContext(ctx, `DELETE FROM passkey WHERE id = ? AND user_id = ?`, id, userID)
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
