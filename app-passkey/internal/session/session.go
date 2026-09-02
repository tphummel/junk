// Package session issues and verifies signed, stateless session tokens
// carried in a cookie. The design doc's data model has no sessions table,
// and logout is just "the session cookie is invalidated/cleared" -- so
// there's nothing server-side to revoke: a session is exactly what its
// signature says it is until it expires.
package session

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// CookieName is the cookie carrying the signed session token.
const CookieName = "app_passkey_session"

// ErrInvalid covers a missing, malformed, mis-signed, or expired token.
var ErrInvalid = errors.New("invalid session")

// Claims identifies the authenticated user carried by a session token.
type Claims struct {
	UserID    string    `json:"uid"`
	Username  string    `json:"un"`
	ExpiresAt time.Time `json:"exp"`
}

// Manager signs and verifies session tokens with an HMAC secret.
type Manager struct {
	secret []byte
}

// NewManager builds a Manager from a secret. If secret is empty, a random
// one is generated (existing sessions won't survive a process restart);
// ephemeral reports whether that happened, so the caller can log a warning.
func NewManager(secret string) (m *Manager, ephemeral bool, err error) {
	if secret != "" {
		return &Manager{secret: []byte(secret)}, false, nil
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, false, fmt.Errorf("generate session secret: %w", err)
	}
	return &Manager{secret: b}, true, nil
}

// Issue creates a signed token for userID/username, valid for ttl.
func (m *Manager) Issue(userID, username string, ttl time.Duration) (string, error) {
	claims := Claims{UserID: userID, Username: username, ExpiresAt: time.Now().Add(ttl).UTC()}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	payloadB64 := base64.RawURLEncoding.EncodeToString(payload)
	sig := m.sign(payloadB64)
	return payloadB64 + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

// Verify checks a token's signature and expiry, returning its claims.
func (m *Manager) Verify(token string) (*Claims, error) {
	var payloadB64, sigB64 string
	for i := 0; i < len(token); i++ {
		if token[i] == '.' {
			payloadB64, sigB64 = token[:i], token[i+1:]
			break
		}
	}
	if payloadB64 == "" || sigB64 == "" {
		return nil, ErrInvalid
	}

	sig, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil {
		return nil, ErrInvalid
	}
	if !hmac.Equal(sig, m.sign(payloadB64)) {
		return nil, ErrInvalid
	}

	payload, err := base64.RawURLEncoding.DecodeString(payloadB64)
	if err != nil {
		return nil, ErrInvalid
	}
	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, ErrInvalid
	}
	if time.Now().After(claims.ExpiresAt) {
		return nil, ErrInvalid
	}
	return &claims, nil
}

func (m *Manager) sign(payloadB64 string) []byte {
	mac := hmac.New(sha256.New, m.secret)
	mac.Write([]byte(payloadB64))
	return mac.Sum(nil)
}
