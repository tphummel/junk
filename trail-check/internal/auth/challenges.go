package auth

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
)

// challengeTTL bounds how long a WebAuthn ceremony has to complete.
const challengeTTL = 5 * time.Minute

type pendingChallenge struct {
	session webauthn.SessionData
	// userID is set for registration ceremonies (both bootstrap and
	// add-passkey), so FinishRegistration knows which user to attach the
	// new credential to without trusting anything from the client.
	userID  string
	label   string
	expires time.Time
}

// challengeStore holds in-flight WebAuthn ceremony session data server-side,
// keyed by an opaque token handed to the browser in a short-lived cookie.
// Per the go-webauthn docs, SessionData must not be trusted to the client
// unmodified, so we never serialize it into the cookie itself.
type challengeStore struct {
	mu      sync.Mutex
	entries map[string]pendingChallenge
}

func newChallengeStore() *challengeStore {
	s := &challengeStore{entries: make(map[string]pendingChallenge)}
	go s.sweepLoop()
	return s
}

func (s *challengeStore) sweepLoop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.Lock()
		now := time.Now()
		for k, v := range s.entries {
			if now.After(v.expires) {
				delete(s.entries, k)
			}
		}
		s.mu.Unlock()
	}
}

func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (s *challengeStore) put(session webauthn.SessionData, userID, label string) (string, error) {
	token, err := newToken()
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	s.entries[token] = pendingChallenge{session: session, userID: userID, label: label, expires: time.Now().Add(challengeTTL)}
	s.mu.Unlock()
	return token, nil
}

// take retrieves and deletes a pending challenge; ceremonies are one-shot.
func (s *challengeStore) take(token string) (pendingChallenge, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	pc, ok := s.entries[token]
	if !ok {
		return pendingChallenge{}, false
	}
	delete(s.entries, token)
	if time.Now().After(pc.expires) {
		return pendingChallenge{}, false
	}
	return pc, true
}
