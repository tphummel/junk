package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

// User is an account.
type User struct {
	ID          string
	Username    string
	DisplayName string
	Deck        string
	DisabledAt  *time.Time
	CreatedAt   time.Time
}

// Disabled reports whether the account has been disabled by an admin.
func (u *User) Disabled() bool { return u.DisabledAt != nil }

// ErrUsernameTaken is returned when creating a user whose name exists.
var ErrUsernameTaken = errors.New("store: username already taken")

const userCols = `id, username, display_name, deck, disabled_at, created_at`

func scanUser(row interface{ Scan(...any) error }) (*User, error) {
	var (
		u        User
		disabled sql.NullString
		created  string
	)
	if err := row.Scan(&u.ID, &u.Username, &u.DisplayName, &u.Deck, &disabled, &created); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	u.DisabledAt = parseNullTS(disabled)
	u.CreatedAt = parseTS(created)
	return &u, nil
}

// CreateUser inserts a new account with a fresh id.
func (s *Store) CreateUser(ctx context.Context, username, displayName string) (*User, error) {
	return s.CreateUserWithID(ctx, s.newID(), username, displayName)
}

// CreateUserWithID inserts an account whose id was chosen earlier (a passkey
// sign-up ceremony fixes the WebAuthn user handle before the account exists).
func (s *Store) CreateUserWithID(ctx context.Context, id, username, displayName string) (*User, error) {
	now := s.Now()
	u := &User{ID: id, Username: username, DisplayName: displayName, Deck: "paper", CreatedAt: now}
	_, err := s.w.ExecContext(ctx,
		`INSERT INTO users (id, username, display_name, deck, created_at) VALUES (?, ?, ?, ?, ?)`,
		u.ID, u.Username, u.DisplayName, u.Deck, ts(now))
	if isUnique(err) {
		return nil, ErrUsernameTaken
	}
	return u, err
}

// UserByID looks up an account.
func (s *Store) UserByID(ctx context.Context, id string) (*User, error) {
	return scanUser(s.r.QueryRowContext(ctx, `SELECT `+userCols+` FROM users WHERE id = ?`, id))
}

// UserByUsername looks up an account (case-insensitively).
func (s *Store) UserByUsername(ctx context.Context, name string) (*User, error) {
	return scanUser(s.r.QueryRowContext(ctx, `SELECT `+userCols+` FROM users WHERE username = ?`, name))
}

// ListUsers returns all accounts, oldest first.
func (s *Store) ListUsers(ctx context.Context) ([]*User, error) {
	rows, err := s.r.QueryContext(ctx, `SELECT `+userCols+` FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// SetDisabled disables or re-enables an account. Disabling also ends its sessions.
func (s *Store) SetDisabled(ctx context.Context, userID string, disabled bool) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		var val any
		if disabled {
			val = ts(s.Now())
		}
		res, err := tx.ExecContext(ctx, `UPDATE users SET disabled_at = ? WHERE id = ?`, val, userID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		if disabled {
			_, err = tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, userID)
		}
		return err
	})
}

// UpdateProfile changes the display name and deck theme.
func (s *Store) UpdateProfile(ctx context.Context, userID, displayName, deck string) error {
	_, err := s.w.ExecContext(ctx, `UPDATE users SET display_name = ?, deck = ? WHERE id = ?`, displayName, deck, userID)
	return err
}

// DeleteUser removes the account and, by cascade, everything it owns:
// passkeys, sessions, games and moves. One statement.
func (s *Store) DeleteUser(ctx context.Context, userID string) error {
	_, err := s.w.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, userID)
	return err
}

// ---- credentials ----

// Credential is a stored passkey.
type Credential struct {
	ID           string
	UserID       string
	CredentialID []byte
	JSON         string
	AAGUID       string
	Name         string
	CreatedAt    time.Time
	LastUsedAt   *time.Time
}

const credCols = `id, user_id, credential_id, credential_json, aaguid, name, created_at, last_used_at`

func scanCred(row interface{ Scan(...any) error }) (*Credential, error) {
	var (
		c       Credential
		created string
		used    sql.NullString
	)
	if err := row.Scan(&c.ID, &c.UserID, &c.CredentialID, &c.JSON, &c.AAGUID, &c.Name, &created, &used); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	c.CreatedAt = parseTS(created)
	c.LastUsedAt = parseNullTS(used)
	return &c, nil
}

// AddCredential stores a new passkey.
func (s *Store) AddCredential(ctx context.Context, userID string, rawID []byte, credJSON, aaguid, name string) (*Credential, error) {
	now := s.Now()
	c := &Credential{ID: s.newID(), UserID: userID, CredentialID: rawID, JSON: credJSON, AAGUID: aaguid, Name: name, CreatedAt: now}
	_, err := s.w.ExecContext(ctx,
		`INSERT INTO credentials (id, user_id, credential_id, credential_json, aaguid, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		c.ID, userID, rawID, credJSON, aaguid, name, ts(now))
	return c, err
}

// CredentialsForUser lists a user's passkeys, oldest first.
func (s *Store) CredentialsForUser(ctx context.Context, userID string) ([]*Credential, error) {
	rows, err := s.r.QueryContext(ctx, `SELECT `+credCols+` FROM credentials WHERE user_id = ? ORDER BY id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Credential
	for rows.Next() {
		c, err := scanCred(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CredentialByRawID finds a passkey by its WebAuthn credential ID.
func (s *Store) CredentialByRawID(ctx context.Context, rawID []byte) (*Credential, error) {
	return scanCred(s.r.QueryRowContext(ctx, `SELECT `+credCols+` FROM credentials WHERE credential_id = ?`, rawID))
}

// TouchCredential records a successful use, updating the stored credential
// state (sign counter, backup flags).
func (s *Store) TouchCredential(ctx context.Context, rawID []byte, credJSON string) error {
	_, err := s.w.ExecContext(ctx, `UPDATE credentials SET credential_json = ?, last_used_at = ? WHERE credential_id = ?`, credJSON, ts(s.Now()), rawID)
	return err
}

// RenameCredential changes a passkey's label.
func (s *Store) RenameCredential(ctx context.Context, userID, id, name string) error {
	res, err := s.w.ExecContext(ctx, `UPDATE credentials SET name = ? WHERE id = ? AND user_id = ?`, name, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ErrLastCredential is returned when revoking the only passkey on an account.
var ErrLastCredential = errors.New("store: cannot revoke the last passkey")

// DeleteCredential revokes a passkey, refusing to remove the last one.
func (s *Store) DeleteCredential(ctx context.Context, userID, id string) (*Credential, error) {
	var gone *Credential
	err := s.tx(ctx, func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM credentials WHERE user_id = ?`, userID).Scan(&n); err != nil {
			return err
		}
		c, err := scanCred(tx.QueryRowContext(ctx, `SELECT `+credCols+` FROM credentials WHERE id = ? AND user_id = ?`, id, userID))
		if err != nil {
			return err
		}
		if n <= 1 {
			return ErrLastCredential
		}
		gone = c
		_, err = tx.ExecContext(ctx, `DELETE FROM credentials WHERE id = ?`, id)
		return err
	})
	return gone, err
}

// ---- sessions ----

// Session is a signed-in browser.
type Session struct {
	ID         string // sha256(token), hex; never the cookie value
	UserID     string
	CreatedAt  time.Time
	LastSeenAt time.Time
	ExpiresAt  time.Time
	UserAgent  string
	FreshUntil *time.Time
}

// Fresh reports whether a recent user-verified assertion covers this session.
func (s *Session) Fresh(now time.Time) bool { return s.FreshUntil != nil && now.Before(*s.FreshUntil) }

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// NewToken returns a random URL-safe secret.
func NewToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// CreateSession starts a session and returns the cookie token.
func (s *Store) CreateSession(ctx context.Context, userID, userAgent string, ttl time.Duration, fresh time.Duration) (string, error) {
	token := NewToken()
	now := s.Now()
	var freshUntil any
	if fresh > 0 {
		freshUntil = ts(now.Add(fresh))
	}
	if len(userAgent) > 300 {
		userAgent = userAgent[:300]
	}
	_, err := s.w.ExecContext(ctx,
		`INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent, fresh_until) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		hashToken(token), userID, ts(now), ts(now), ts(now.Add(ttl)), userAgent, freshUntil)
	return token, err
}

const sessCols = `id, user_id, created_at, last_seen_at, expires_at, user_agent, fresh_until`

func scanSession(row interface{ Scan(...any) error }) (*Session, error) {
	var (
		x                      Session
		created, seen, expires string
		fresh                  sql.NullString
	)
	if err := row.Scan(&x.ID, &x.UserID, &created, &seen, &expires, &x.UserAgent, &fresh); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	x.CreatedAt, x.LastSeenAt, x.ExpiresAt = parseTS(created), parseTS(seen), parseTS(expires)
	x.FreshUntil = parseNullTS(fresh)
	return &x, nil
}

// SessionByToken resolves a cookie token to a live session and its enabled user.
func (s *Store) SessionByToken(ctx context.Context, token string) (*Session, *User, error) {
	sess, err := scanSession(s.r.QueryRowContext(ctx, `SELECT `+sessCols+` FROM sessions WHERE id = ?`, hashToken(token)))
	if err != nil {
		return nil, nil, err
	}
	if !s.Now().Before(sess.ExpiresAt) {
		return nil, nil, ErrNotFound
	}
	u, err := s.UserByID(ctx, sess.UserID)
	if err != nil {
		return nil, nil, err
	}
	if u.Disabled() {
		return nil, nil, ErrNotFound
	}
	return sess, u, nil
}

// TouchSession updates last-seen, at most once a minute.
func (s *Store) TouchSession(ctx context.Context, sess *Session) {
	now := s.Now()
	if now.Sub(sess.LastSeenAt) < time.Minute {
		return
	}
	_, _ = s.w.ExecContext(ctx, `UPDATE sessions SET last_seen_at = ? WHERE id = ?`, ts(now), sess.ID)
}

// MarkFresh records a user-verified assertion for step-up auth.
func (s *Store) MarkFresh(ctx context.Context, sessionID string, window time.Duration) error {
	_, err := s.w.ExecContext(ctx, `UPDATE sessions SET fresh_until = ? WHERE id = ?`, ts(s.Now().Add(window)), sessionID)
	return err
}

// SessionsForUser lists live sessions, most recently seen first.
func (s *Store) SessionsForUser(ctx context.Context, userID string) ([]*Session, error) {
	rows, err := s.r.QueryContext(ctx, `SELECT `+sessCols+` FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC`, userID, ts(s.Now()))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Session
	for rows.Next() {
		x, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// RevokeSession ends one session belonging to the user.
func (s *Store) RevokeSession(ctx context.Context, userID, sessionID string) error {
	_, err := s.w.ExecContext(ctx, `DELETE FROM sessions WHERE id = ? AND user_id = ?`, sessionID, userID)
	return err
}

// RevokeAllSessions signs the user out everywhere.
func (s *Store) RevokeAllSessions(ctx context.Context, userID string) error {
	_, err := s.w.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, userID)
	return err
}

// PruneExpired deletes expired sessions and challenges.
func (s *Store) PruneExpired(ctx context.Context) error {
	now := ts(s.Now())
	if _, err := s.w.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= ?`, now); err != nil {
		return err
	}
	_, err := s.w.ExecContext(ctx, `DELETE FROM challenges WHERE expires_at <= ?`, now)
	return err
}

// ---- WebAuthn challenges ----

// PutChallenge stores ceremony state under a fresh id.
func (s *Store) PutChallenge(ctx context.Context, kind, userID, data string, ttl time.Duration) (string, error) {
	id := NewToken()
	_, err := s.w.ExecContext(ctx, `INSERT INTO challenges (id, kind, user_id, data, expires_at) VALUES (?, ?, ?, ?, ?)`,
		hashToken(id), kind, userID, data, ts(s.Now().Add(ttl)))
	return id, err
}

// TakeChallenge fetches and deletes ceremony state: each challenge is single-use.
func (s *Store) TakeChallenge(ctx context.Context, id, kind string) (userID, data string, err error) {
	err = s.tx(ctx, func(tx *sql.Tx) error {
		var expires string
		var k string
		row := tx.QueryRowContext(ctx, `SELECT kind, user_id, data, expires_at FROM challenges WHERE id = ?`, hashToken(id))
		if e := row.Scan(&k, &userID, &data, &expires); e != nil {
			if errors.Is(e, sql.ErrNoRows) {
				return ErrNotFound
			}
			return e
		}
		if _, e := tx.ExecContext(ctx, `DELETE FROM challenges WHERE id = ?`, hashToken(id)); e != nil {
			return e
		}
		if k != kind || !s.Now().Before(parseTS(expires)) {
			return ErrNotFound
		}
		return nil
	})
	return
}

// ---- recovery ----

func hashCode(code string) string {
	code = strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(code))
	return hashToken("recovery:" + code)
}

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// NewRecoveryCodes replaces the user's recovery codes with n fresh one-time
// codes (hashed at rest) and returns the plaintext once.
func (s *Store) NewRecoveryCodes(ctx context.Context, userID string, n int) ([]string, error) {
	codes := make([]string, n)
	for i := range codes {
		b := make([]byte, 10)
		if _, err := rand.Read(b); err != nil {
			return nil, err
		}
		for j := range b {
			b[j] = codeAlphabet[int(b[j])%len(codeAlphabet)]
		}
		codes[i] = string(b[:5]) + "-" + string(b[5:])
	}
	now := ts(s.Now())
	err := s.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM recovery_codes WHERE user_id = ?`, userID); err != nil {
			return err
		}
		for _, c := range codes {
			if _, err := tx.ExecContext(ctx, `INSERT INTO recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)`, userID, hashCode(c), now); err != nil {
				return err
			}
		}
		return nil
	})
	return codes, err
}

// RecoveryCodesLeft counts unused codes.
func (s *Store) RecoveryCodesLeft(ctx context.Context, userID string) (int, error) {
	var n int
	err := s.r.QueryRowContext(ctx, `SELECT COUNT(*) FROM recovery_codes WHERE user_id = ? AND used_at IS NULL`, userID).Scan(&n)
	return n, err
}

// ConsumeRecoveryCode marks a code used and returns its owner.
func (s *Store) ConsumeRecoveryCode(ctx context.Context, code string) (string, error) {
	var userID string
	err := s.tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE recovery_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL`, ts(s.Now()), hashCode(code))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return tx.QueryRowContext(ctx, `SELECT user_id FROM recovery_codes WHERE code_hash = ?`, hashCode(code)).Scan(&userID)
	})
	return userID, err
}

// NewRecoveryLink issues a single-use sign-in token (admin CLI).
func (s *Store) NewRecoveryLink(ctx context.Context, userID string, ttl time.Duration) (string, error) {
	token := NewToken()
	now := s.Now()
	_, err := s.w.ExecContext(ctx, `INSERT INTO recovery_links (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		hashToken(token), userID, ts(now.Add(ttl)), ts(now))
	return token, err
}

// ConsumeRecoveryLink redeems a link token and returns its user.
func (s *Store) ConsumeRecoveryLink(ctx context.Context, token string) (string, error) {
	var userID string
	err := s.tx(ctx, func(tx *sql.Tx) error {
		var expires string
		var used sql.NullString
		row := tx.QueryRowContext(ctx, `SELECT user_id, expires_at, used_at FROM recovery_links WHERE token_hash = ?`, hashToken(token))
		if err := row.Scan(&userID, &expires, &used); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if used.Valid || !s.Now().Before(parseTS(expires)) {
			return ErrNotFound
		}
		_, err := tx.ExecContext(ctx, `UPDATE recovery_links SET used_at = ? WHERE token_hash = ?`, ts(s.Now()), hashToken(token))
		return err
	})
	return userID, err
}

// ---- audit log ----

// AuditEntry is one security-log line.
type AuditEntry struct {
	Event     string
	Detail    string
	CreatedAt time.Time
}

// Audit records a security event for the user.
func (s *Store) Audit(ctx context.Context, userID, event, detail string) {
	_, _ = s.w.ExecContext(ctx, `INSERT INTO audit_log (user_id, event, detail, created_at) VALUES (?, ?, ?, ?)`, userID, event, detail, ts(s.Now()))
}

// AuditLog returns the user's most recent security events.
func (s *Store) AuditLog(ctx context.Context, userID string, limit int) ([]AuditEntry, error) {
	rows, err := s.r.QueryContext(ctx, `SELECT event, detail, created_at FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEntry
	for rows.Next() {
		var e AuditEntry
		var at string
		if err := rows.Scan(&e.Event, &e.Detail, &at); err != nil {
			return nil, err
		}
		e.CreatedAt = parseTS(at)
		out = append(out, e)
	}
	return out, rows.Err()
}
