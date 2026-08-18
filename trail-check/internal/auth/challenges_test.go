package auth

import (
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
)

func TestChallengeStorePutTakeIsOneShot(t *testing.T) {
	s := newChallengeStore()
	token, err := s.put(webauthn.SessionData{Challenge: "abc"}, "user-1", "my-phone")
	if err != nil {
		t.Fatal(err)
	}

	pc, ok := s.take(token)
	if !ok {
		t.Fatal("expected to retrieve the pending challenge")
	}
	if pc.userID != "user-1" || pc.label != "my-phone" || pc.session.Challenge != "abc" {
		t.Fatalf("unexpected pending challenge: %+v", pc)
	}

	if _, ok := s.take(token); ok {
		t.Fatal("expected the challenge to be consumed after the first take")
	}
}

func TestChallengeStoreExpiry(t *testing.T) {
	s := newChallengeStore()
	token, err := s.put(webauthn.SessionData{Challenge: "abc"}, "user-1", "")
	if err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	entry := s.entries[token]
	entry.expires = time.Now().Add(-time.Second)
	s.entries[token] = entry
	s.mu.Unlock()

	if _, ok := s.take(token); ok {
		t.Fatal("expected an expired challenge to be rejected")
	}
}

func TestChallengeStoreUnknownToken(t *testing.T) {
	s := newChallengeStore()
	if _, ok := s.take("does-not-exist"); ok {
		t.Fatal("expected unknown token to be rejected")
	}
}
