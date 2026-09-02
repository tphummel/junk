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

// Credential is a stored WebAuthn passkey belonging to a user.
type Credential struct {
	ID           string
	UserID       string
	CredentialID []byte
	PublicKey    []byte
	Credential   webauthn.Credential
	Nickname     string
	SignCount    uint32
	CreatedAt    time.Time
	LastUsedAt   *time.Time
}

// InsertCredential stores a newly registered passkey for a user.
func (d *DB) InsertCredential(ctx context.Context, userID, nickname string, cred webauthn.Credential) (*Credential, error) {
	credJSON, err := json.Marshal(cred)
	if err != nil {
		return nil, err
	}
	c := &Credential{
		ID:           uuid.NewString(),
		UserID:       userID,
		CredentialID: cred.ID,
		PublicKey:    cred.PublicKey,
		Credential:   cred,
		Nickname:     nickname,
		SignCount:    cred.Authenticator.SignCount,
		CreatedAt:    time.Now().UTC(),
	}
	_, err = d.conn.ExecContext(ctx, `
		INSERT INTO credentials (id, user_id, credential_id, public_key, credential_json, sign_count, nickname, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		c.ID, c.UserID, c.CredentialID, c.PublicKey, string(credJSON), c.SignCount, c.Nickname, formatTime(c.CreatedAt),
	)
	if err != nil {
		return nil, err
	}
	return c, nil
}

const credentialColumns = `id, user_id, credential_id, public_key, credential_json, sign_count, nickname, created_at, last_used_at`

func scanCredential(row interface{ Scan(dest ...any) error }) (*Credential, error) {
	var c Credential
	var credJSON, createdAt string
	var lastUsedAt sql.NullString
	err := row.Scan(&c.ID, &c.UserID, &c.CredentialID, &c.PublicKey, &credJSON, &c.SignCount, &c.Nickname, &createdAt, &lastUsedAt)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(credJSON), &c.Credential); err != nil {
		return nil, err
	}
	c.CreatedAt, err = parseTime(createdAt)
	if err != nil {
		return nil, err
	}
	c.LastUsedAt, err = parseTimePtr(lastUsedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// GetCredentialByCredentialID looks up a credential by its raw WebAuthn ID.
func (d *DB) GetCredentialByCredentialID(ctx context.Context, credentialID []byte) (*Credential, error) {
	row := d.conn.QueryRowContext(ctx, `SELECT `+credentialColumns+` FROM credentials WHERE credential_id = ?`, credentialID)
	c, err := scanCredential(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

// ListCredentialsByUser returns all passkeys belonging to a user, newest first.
func (d *DB) ListCredentialsByUser(ctx context.Context, userID string) ([]*Credential, error) {
	rows, err := d.conn.QueryContext(ctx, `SELECT `+credentialColumns+` FROM credentials WHERE user_id = ? ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*Credential
	for rows.Next() {
		c, err := scanCredential(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// TouchCredential persists an updated sign counter after a successful
// assertion (detecting cloned authenticators relies on this monotonically
// increasing) and bumps last_used_at.
func (d *DB) TouchCredential(ctx context.Context, id string, cred webauthn.Credential) error {
	credJSON, err := json.Marshal(cred)
	if err != nil {
		return err
	}
	_, err = d.conn.ExecContext(ctx,
		`UPDATE credentials SET credential_json = ?, sign_count = ?, last_used_at = ? WHERE id = ?`,
		string(credJSON), cred.Authenticator.SignCount, formatTime(time.Now().UTC()), id,
	)
	return err
}

// RenameCredential sets a credential's nickname. Scoped to userID so a user
// can't relabel someone else's key.
func (d *DB) RenameCredential(ctx context.Context, id, userID, nickname string) error {
	res, err := d.conn.ExecContext(ctx,
		`UPDATE credentials SET nickname = ? WHERE id = ? AND user_id = ?`, nickname, id, userID,
	)
	if err != nil {
		return err
	}
	return checkRowsAffected(res)
}

// DeleteCredential removes a credential owned by userID (revoking that
// device's access).
func (d *DB) DeleteCredential(ctx context.Context, id, userID string) error {
	res, err := d.conn.ExecContext(ctx, `DELETE FROM credentials WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	return checkRowsAffected(res)
}

func checkRowsAffected(res sql.Result) error {
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
