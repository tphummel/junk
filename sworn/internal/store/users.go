package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
)

// SessionTTL is the sliding session lifetime.
const SessionTTL = 30 * 24 * time.Hour

// User is an account.
type User struct {
	ID        int64
	Username  string
	Handle    []byte
	IsAdmin   bool
	CreatedAt time.Time
}

// Passkey is a stored WebAuthn credential.
type Passkey struct {
	ID         int64
	UserID     int64
	Name       string
	Active     bool
	CreatedAt  time.Time
	Credential webauthn.Credential
}

// ErrUsernameTaken is returned when creating a duplicate username.
var ErrUsernameTaken = errors.New("username taken")

// ErrLastPasskey is returned when deactivating a user's only active passkey.
var ErrLastPasskey = errors.New("cannot deactivate the last active passkey")

// CountUsers returns the number of accounts.
func (s *Store) CountUsers() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// CreateUserWithPasskey atomically creates an account and its first passkey.
// The first account ever created becomes admin.
func (s *Store) CreateUserWithPasskey(username string, handle []byte, keyName string, cred webauthn.Credential) (*User, error) {
	username = strings.TrimSpace(username)
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var n int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		return nil, err
	}
	now := s.ts()
	res, err := tx.Exec(`INSERT INTO users(username,handle,is_admin,created_at) VALUES(?,?,?,?)`, username, handle, n == 0, now)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return nil, ErrUsernameTaken
		}
		return nil, err
	}
	id, _ := res.LastInsertId()
	if err := insertPasskey(tx, id, keyName, cred, now); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &User{ID: id, Username: username, Handle: handle, IsAdmin: n == 0, CreatedAt: parseTime(now)}, nil
}

func insertPasskey(tx *sql.Tx, userID int64, name string, cred webauthn.Credential, now string) error {
	j, err := json.Marshal(cred)
	if err != nil {
		return err
	}
	if name == "" {
		name = "passkey"
	}
	_, err = tx.Exec(`INSERT INTO passkeys(user_id,credential_id,public_key,credential_json,sign_count,name,active,created_at)
		VALUES(?,?,?,?,?,?,1,?)`, userID, cred.ID, cred.PublicKey, string(j), cred.Authenticator.SignCount, name, now)
	return err
}

// AddPasskey stores an additional active passkey.
func (s *Store) AddPasskey(userID int64, name string, cred webauthn.Credential) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := insertPasskey(tx, userID, name, cred, s.ts()); err != nil {
		return err
	}
	return tx.Commit()
}

// UserByID loads a user.
func (s *Store) UserByID(id int64) (*User, error) {
	return s.scanUser(s.db.QueryRow(`SELECT id,username,handle,is_admin,created_at FROM users WHERE id=?`, id))
}

// UserByUsername loads a user by name.
func (s *Store) UserByUsername(name string) (*User, error) {
	return s.scanUser(s.db.QueryRow(`SELECT id,username,handle,is_admin,created_at FROM users WHERE username=?`, strings.TrimSpace(name)))
}

func (s *Store) scanUser(row *sql.Row) (*User, error) {
	var u User
	var created string
	if err := row.Scan(&u.ID, &u.Username, &u.Handle, &u.IsAdmin, &created); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	u.CreatedAt = parseTime(created)
	return &u, nil
}

// Passkeys lists a user's passkeys; activeOnly filters out deactivated ones.
func (s *Store) Passkeys(userID int64, activeOnly bool) ([]Passkey, error) {
	q := `SELECT id,user_id,name,active,created_at,credential_json FROM passkeys WHERE user_id=?`
	if activeOnly {
		q += ` AND active=1`
	}
	rows, err := s.db.Query(q+` ORDER BY id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Passkey
	for rows.Next() {
		var p Passkey
		var created, cj string
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &p.Active, &created, &cj); err != nil {
			return nil, err
		}
		p.CreatedAt = parseTime(created)
		if err := json.Unmarshal([]byte(cj), &p.Credential); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// DeactivatePasskey deactivates a passkey, refusing to remove the last active one.
func (s *Store) DeactivatePasskey(userID, passkeyID int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var active bool
	if err := tx.QueryRow(`SELECT active FROM passkeys WHERE id=? AND user_id=?`, passkeyID, userID).Scan(&active); err != nil {
		return ErrNotFound
	}
	if !active {
		return nil
	}
	var n int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM passkeys WHERE user_id=? AND active=1`, userID).Scan(&n); err != nil {
		return err
	}
	if n <= 1 {
		return ErrLastPasskey
	}
	if _, err := tx.Exec(`UPDATE passkeys SET active=0 WHERE id=?`, passkeyID); err != nil {
		return err
	}
	// Sessions minted with that credential die with it.
	if _, err := tx.Exec(`DELETE FROM sessions WHERE credential_id=(SELECT credential_id FROM passkeys WHERE id=?)`, passkeyID); err != nil {
		return err
	}
	return tx.Commit()
}

// TouchPasskey records the new sign counter after a successful login.
func (s *Store) TouchPasskey(cred webauthn.Credential) error {
	j, err := json.Marshal(cred)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE passkeys SET sign_count=?, credential_json=? WHERE credential_id=?`,
		cred.Authenticator.SignCount, string(j), cred.ID)
	return err
}

// CreateSession mints a session token for the user.
func (s *Store) CreateSession(userID int64, credentialID []byte) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	tok := base64.RawURLEncoding.EncodeToString(b)
	now := s.now().UTC()
	_, err := s.db.Exec(`INSERT INTO sessions(user_id,credential_id,token,created_at,expires_at) VALUES(?,?,?,?,?)`,
		userID, credentialID, tok, now.Format(time.RFC3339), now.Add(SessionTTL).Format(time.RFC3339))
	return tok, err
}

// SessionUser resolves a token to its user and slides the expiry forward.
func (s *Store) SessionUser(token string) (*User, error) {
	var uid int64
	var exp string
	if err := s.db.QueryRow(`SELECT user_id,expires_at FROM sessions WHERE token=?`, token).Scan(&uid, &exp); err != nil {
		return nil, ErrNotFound
	}
	now := s.now().UTC()
	if !parseTime(exp).After(now) {
		s.db.Exec(`DELETE FROM sessions WHERE token=?`, token)
		return nil, ErrNotFound
	}
	newExp := now.Add(SessionTTL)
	// Only write when it moves the expiry by more than an hour.
	if newExp.Sub(parseTime(exp)) > time.Hour {
		s.db.Exec(`UPDATE sessions SET expires_at=? WHERE token=?`, newExp.Format(time.RFC3339), token)
	}
	return s.UserByID(uid)
}

// DeleteSession logs a token out.
func (s *Store) DeleteSession(token string) {
	s.db.Exec(`DELETE FROM sessions WHERE token=?`, token)
}
