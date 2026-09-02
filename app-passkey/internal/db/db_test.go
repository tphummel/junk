package db

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
)

func newTestDB(t *testing.T) *DB {
	t.Helper()
	d, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

// TestFullCRUDCycle exercises the design doc's "no-mock" integration test:
// User -> Credentials -> Recovery Codes, entirely against a real (temp
// file) SQLite database.
func TestFullCRUDCycle(t *testing.T) {
	ctx := context.Background()
	d := newTestDB(t)

	// User
	u, err := d.CreateUser(ctx, "alice")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if _, err := d.CreateUser(ctx, "alice"); err == nil {
		t.Fatal("expected duplicate username to fail")
	}
	got, err := d.GetUserByUsername(ctx, "alice")
	if err != nil {
		t.Fatalf("GetUserByUsername: %v", err)
	}
	if got.ID != u.ID {
		t.Fatalf("expected %q, got %q", u.ID, got.ID)
	}
	if _, err := d.GetUserByID(ctx, "does-not-exist"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}

	// Credentials
	cred := webauthn.Credential{
		ID:        []byte("cred-1"),
		PublicKey: []byte("pubkey-1"),
		Authenticator: webauthn.Authenticator{
			SignCount: 0,
		},
	}
	pk, err := d.InsertCredential(ctx, u.ID, "Work Laptop", cred)
	if err != nil {
		t.Fatalf("InsertCredential: %v", err)
	}

	list, err := d.ListCredentialsByUser(ctx, u.ID)
	if err != nil {
		t.Fatalf("ListCredentialsByUser: %v", err)
	}
	if len(list) != 1 || list[0].Nickname != "Work Laptop" {
		t.Fatalf("expected 1 credential named Work Laptop, got %+v", list)
	}

	byCredID, err := d.GetCredentialByCredentialID(ctx, cred.ID)
	if err != nil {
		t.Fatalf("GetCredentialByCredentialID: %v", err)
	}
	if byCredID.ID != pk.ID {
		t.Fatalf("expected %q, got %q", pk.ID, byCredID.ID)
	}

	updatedCred := cred
	updatedCred.Authenticator.SignCount = 5
	if err := d.TouchCredential(ctx, pk.ID, updatedCred); err != nil {
		t.Fatalf("TouchCredential: %v", err)
	}
	byCredID, err = d.GetCredentialByCredentialID(ctx, cred.ID)
	if err != nil {
		t.Fatalf("GetCredentialByCredentialID after touch: %v", err)
	}
	if byCredID.SignCount != 5 {
		t.Fatalf("expected sign_count 5, got %d", byCredID.SignCount)
	}
	if byCredID.LastUsedAt == nil {
		t.Fatal("expected last_used_at to be set after touch")
	}

	if err := d.RenameCredential(ctx, pk.ID, u.ID, "YubiKey Backup"); err != nil {
		t.Fatalf("RenameCredential: %v", err)
	}
	if err := d.RenameCredential(ctx, pk.ID, "someone-else", "Stolen"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound renaming with wrong owner, got %v", err)
	}

	// Recovery codes
	lookupIDs := []string{"abc123", "def456"}
	hashes := [][]byte{[]byte("hash-1"), []byte("hash-2")}
	if err := d.InsertRecoveryCodes(ctx, u.ID, lookupIDs, hashes); err != nil {
		t.Fatalf("InsertRecoveryCodes: %v", err)
	}

	n, err := d.CountUnusedRecoveryCodes(ctx, u.ID)
	if err != nil {
		t.Fatalf("CountUnusedRecoveryCodes: %v", err)
	}
	if n != 2 {
		t.Fatalf("expected 2 unused codes, got %d", n)
	}

	rc, err := d.GetUnusedRecoveryCodeByLookupID(ctx, "abc123")
	if err != nil {
		t.Fatalf("GetUnusedRecoveryCodeByLookupID: %v", err)
	}
	if rc.UserID != u.ID {
		t.Fatalf("expected recovery code to belong to %q, got %q", u.ID, rc.UserID)
	}

	if err := d.MarkRecoveryCodeUsed(ctx, rc.ID); err != nil {
		t.Fatalf("MarkRecoveryCodeUsed: %v", err)
	}
	if err := d.MarkRecoveryCodeUsed(ctx, rc.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected re-using a spent code to fail with ErrNotFound, got %v", err)
	}
	if _, err := d.GetUnusedRecoveryCodeByLookupID(ctx, "abc123"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected used code to no longer be fetchable as unused, got %v", err)
	}

	n, err = d.CountUnusedRecoveryCodes(ctx, u.ID)
	if err != nil {
		t.Fatalf("CountUnusedRecoveryCodes after use: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected 1 unused code remaining, got %d", n)
	}

	// Admin summary
	summaries, err := d.ListUsersWithCredentialCounts(ctx)
	if err != nil {
		t.Fatalf("ListUsersWithCredentialCounts: %v", err)
	}
	if len(summaries) != 1 || summaries[0].CredentialCount != 1 {
		t.Fatalf("expected 1 user with 1 credential, got %+v", summaries)
	}

	// Revoke the credential.
	if err := d.DeleteCredential(ctx, pk.ID, u.ID); err != nil {
		t.Fatalf("DeleteCredential: %v", err)
	}
	list, err = d.ListCredentialsByUser(ctx, u.ID)
	if err != nil {
		t.Fatalf("ListCredentialsByUser after delete: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("expected 0 credentials after delete, got %d", len(list))
	}
}

func TestChallengeRoundTrip(t *testing.T) {
	ctx := context.Background()
	d := newTestDB(t)

	if err := d.PutChallenge(ctx, "session-1", "user-1", []byte(`{"challenge":true}`), time.Now().Add(time.Minute)); err != nil {
		t.Fatalf("PutChallenge: %v", err)
	}

	userID, payload, err := d.TakeChallenge(ctx, "session-1")
	if err != nil {
		t.Fatalf("TakeChallenge: %v", err)
	}
	if userID != "user-1" || string(payload) != `{"challenge":true}` {
		t.Fatalf("unexpected challenge payload: userID=%q payload=%s", userID, payload)
	}

	// Ceremonies are one-shot: taking again should fail.
	if _, _, err := d.TakeChallenge(ctx, "session-1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound on second take, got %v", err)
	}
}

func TestChallengeExpiry(t *testing.T) {
	ctx := context.Background()
	d := newTestDB(t)

	if err := d.PutChallenge(ctx, "session-expired", "user-1", []byte("x"), time.Now().Add(-time.Minute)); err != nil {
		t.Fatalf("PutChallenge: %v", err)
	}
	if _, _, err := d.TakeChallenge(ctx, "session-expired"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected expired challenge to be rejected, got %v", err)
	}
}

func TestPruneExpiredChallenges(t *testing.T) {
	ctx := context.Background()
	d := newTestDB(t)

	if err := d.PutChallenge(ctx, "expired", "", []byte("x"), time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := d.PutChallenge(ctx, "fresh", "", []byte("x"), time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := d.PruneExpiredChallenges(ctx); err != nil {
		t.Fatalf("PruneExpiredChallenges: %v", err)
	}
	if _, _, err := d.TakeChallenge(ctx, "expired"); !errors.Is(err, ErrNotFound) {
		t.Fatal("expected expired challenge to be pruned")
	}
	if _, _, err := d.TakeChallenge(ctx, "fresh"); err != nil {
		t.Fatalf("expected fresh challenge to survive pruning, got %v", err)
	}
}
