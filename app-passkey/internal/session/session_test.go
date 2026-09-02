package session

import (
	"testing"
	"time"
)

func TestIssueAndVerifyRoundTrip(t *testing.T) {
	m, ephemeral, err := NewManager("test-secret")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	if ephemeral {
		t.Fatal("expected non-ephemeral manager with an explicit secret")
	}

	token, err := m.Issue("user-1", "alice", time.Hour)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	claims, err := m.Verify(token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claims.UserID != "user-1" || claims.Username != "alice" {
		t.Fatalf("unexpected claims: %+v", claims)
	}
}

func TestVerifyRejectsExpiredToken(t *testing.T) {
	m, _, err := NewManager("test-secret")
	if err != nil {
		t.Fatal(err)
	}
	token, err := m.Issue("user-1", "alice", -time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Verify(token); err != ErrInvalid {
		t.Fatalf("expected ErrInvalid for expired token, got %v", err)
	}
}

func TestVerifyRejectsTamperedToken(t *testing.T) {
	m, _, err := NewManager("test-secret")
	if err != nil {
		t.Fatal(err)
	}
	token, err := m.Issue("user-1", "alice", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	tampered := token[:len(token)-1] + "x"
	if _, err := m.Verify(tampered); err != ErrInvalid {
		t.Fatalf("expected ErrInvalid for tampered token, got %v", err)
	}
}

func TestVerifyRejectsWrongSecret(t *testing.T) {
	m1, _, err := NewManager("secret-one")
	if err != nil {
		t.Fatal(err)
	}
	m2, _, err := NewManager("secret-two")
	if err != nil {
		t.Fatal(err)
	}
	token, err := m1.Issue("user-1", "alice", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m2.Verify(token); err != ErrInvalid {
		t.Fatalf("expected ErrInvalid across managers with different secrets, got %v", err)
	}
}

func TestVerifyRejectsGarbage(t *testing.T) {
	m, _, err := NewManager("test-secret")
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"", "no-dot-here", ".", "abc.", ".xyz"} {
		if _, err := m.Verify(bad); err != ErrInvalid {
			t.Errorf("Verify(%q): expected ErrInvalid, got %v", bad, err)
		}
	}
}

func TestNewManagerGeneratesEphemeralSecret(t *testing.T) {
	m, ephemeral, err := NewManager("")
	if err != nil {
		t.Fatal(err)
	}
	if !ephemeral {
		t.Fatal("expected ephemeral manager when no secret is given")
	}
	if _, err := m.Issue("u", "n", time.Hour); err != nil {
		t.Fatalf("Issue with ephemeral secret: %v", err)
	}
}
