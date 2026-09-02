package auth

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/descope/virtualwebauthn"

	"app-passkey/internal/db"
)

const (
	testRPID    = "localhost"
	testRPName  = "app-passkey test"
	testOrigin  = "https://localhost"
	testSession = time.Hour
)

type testEnv struct {
	svc *Service
	db  *db.DB
	rp  virtualwebauthn.RelyingParty
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	svc, err := New(database, Config{
		RPID:          testRPID,
		RPDisplayName: testRPName,
		RPOrigins:     []string{testOrigin},
		SessionTTL:    testSession,
		SessionSecret: "test-secret",
	}, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	rp := virtualwebauthn.RelyingParty{Name: testRPName, ID: testRPID, Origin: testOrigin}
	return &testEnv{svc: svc, db: database, rp: rp}
}

func jsonRequest(t *testing.T, body string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	return r
}

func marshalCreation(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

// TestFullSignupLoginRecoveryFlow simulates the design doc's end-to-end
// story with a mock WebAuthn authenticator standing in for a physical
// device: Signup -> Confirm -> Login -> Add Key -> Label -> Revoke ->
// Recovery.
func TestFullSignupLoginRecoveryFlow(t *testing.T) {
	ctx := context.Background()
	e := newTestEnv(t)

	authenticator := virtualwebauthn.NewAuthenticator()
	primaryCred := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)

	// --- Signup ---
	creation, signupToken, err := e.svc.BeginSignup(ctx, "alice")
	if err != nil {
		t.Fatalf("BeginSignup: %v", err)
	}
	attOpts, err := virtualwebauthn.ParseAttestationOptions(marshalCreation(t, creation))
	if err != nil {
		t.Fatalf("ParseAttestationOptions: %v", err)
	}
	attResp := virtualwebauthn.CreateAttestationResponse(e.rp, authenticator, primaryCred, *attOpts)

	signup, err := e.svc.FinishSignup(ctx, signupToken, jsonRequest(t, attResp), "MacBook")
	if err != nil {
		t.Fatalf("FinishSignup: %v", err)
	}
	if signup.User.Username != "alice" {
		t.Fatalf("expected username alice, got %q", signup.User.Username)
	}
	if len(signup.RecoveryCodes) != 10 {
		t.Fatalf("expected 10 recovery codes, got %d", len(signup.RecoveryCodes))
	}
	authenticator.AddCredential(primaryCred)
	authenticator.Options.UserHandle = e.mustWebAuthnID(ctx, signup.User.ID)

	// Signing up shouldn't log the user in yet.
	if _, err := e.svc.db.GetUserByUsername(ctx, "alice"); err != nil {
		t.Fatalf("expected user to exist after FinishSignup: %v", err)
	}

	// --- Confirm signup (user saved their recovery codes) ---
	loginResult, err := e.svc.ConfirmSignup(ctx, signup.ConfirmToken)
	if err != nil {
		t.Fatalf("ConfirmSignup: %v", err)
	}
	claims, err := e.svc.VerifySession(loginResult.SessionID)
	if err != nil {
		t.Fatalf("VerifySession: %v", err)
	}
	if claims.UserID != signup.User.ID {
		t.Fatalf("expected session for %q, got %q", signup.User.ID, claims.UserID)
	}
	// The confirm token is one-shot.
	if _, err := e.svc.ConfirmSignup(ctx, signup.ConfirmToken); err != ErrChallengeExpired {
		t.Fatalf("expected re-using confirm token to fail, got %v", err)
	}

	// --- Login ---
	assertion, loginToken, err := e.svc.BeginLogin(ctx, "alice")
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	assertOpts, err := virtualwebauthn.ParseAssertionOptions(marshalCreation(t, assertion))
	if err != nil {
		t.Fatalf("ParseAssertionOptions: %v", err)
	}
	assertResp := virtualwebauthn.CreateAssertionResponse(e.rp, authenticator, primaryCred, *assertOpts)

	login, err := e.svc.FinishLogin(ctx, loginToken, jsonRequest(t, assertResp))
	if err != nil {
		t.Fatalf("FinishLogin: %v", err)
	}
	if login.User.Username != "alice" {
		t.Fatalf("expected login for alice, got %q", login.User.Username)
	}

	// A used login challenge can't be replayed.
	if _, err := e.svc.FinishLogin(ctx, loginToken, jsonRequest(t, assertResp)); err == nil {
		t.Fatal("expected replaying a spent login challenge to fail")
	}

	// --- Add a second key ---
	backupCred := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	addCreation, addToken, err := e.svc.BeginAddKey(ctx, signup.User.ID, "YubiKey")
	if err != nil {
		t.Fatalf("BeginAddKey: %v", err)
	}
	addOpts, err := virtualwebauthn.ParseAttestationOptions(marshalCreation(t, addCreation))
	if err != nil {
		t.Fatalf("ParseAttestationOptions (add key): %v", err)
	}
	addResp := virtualwebauthn.CreateAttestationResponse(e.rp, authenticator, backupCred, *addOpts)
	addedCred, err := e.svc.FinishAddKey(ctx, signup.User.ID, addToken, jsonRequest(t, addResp))
	if err != nil {
		t.Fatalf("FinishAddKey: %v", err)
	}
	if addedCred.Nickname != "YubiKey" {
		t.Fatalf("expected nickname YubiKey, got %q", addedCred.Nickname)
	}
	authenticator.AddCredential(backupCred)

	keys, err := e.svc.ListKeys(ctx, signup.User.ID)
	if err != nil {
		t.Fatalf("ListKeys: %v", err)
	}
	if len(keys) != 2 {
		t.Fatalf("expected 2 keys, got %d", len(keys))
	}

	// --- Label a key ---
	if err := e.svc.LabelKey(ctx, signup.User.ID, addedCred.ID, "Work YubiKey"); err != nil {
		t.Fatalf("LabelKey: %v", err)
	}
	keys, _ = e.svc.ListKeys(ctx, signup.User.ID)
	found := false
	for _, k := range keys {
		if k.ID == addedCred.ID && k.Nickname == "Work YubiKey" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected relabeled key to show the new nickname")
	}

	// --- Revoke a key ---
	if err := e.svc.RevokeKey(ctx, signup.User.ID, addedCred.ID); err != nil {
		t.Fatalf("RevokeKey: %v", err)
	}
	keys, _ = e.svc.ListKeys(ctx, signup.User.ID)
	if len(keys) != 1 {
		t.Fatalf("expected 1 key after revoke, got %d", len(keys))
	}
	if err := e.svc.RevokeKey(ctx, signup.User.ID, "not-a-real-id"); err != db.ErrNotFound {
		t.Fatalf("expected ErrNotFound revoking an unknown key, got %v", err)
	}

	// --- Admin listing ---
	summaries, err := e.svc.ListUsersForAdmin(ctx)
	if err != nil {
		t.Fatalf("ListUsersForAdmin: %v", err)
	}
	if len(summaries) != 1 || summaries[0].Username != "alice" || summaries[0].CredentialCount != 1 {
		t.Fatalf("unexpected admin summary: %+v", summaries)
	}

	// --- Recovery: lose the passkey, use a code, register a new one ---
	recoveryCode := signup.RecoveryCodes[0]
	recoveryCred := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	recCreation, recToken, err := e.svc.BeginRecovery(ctx, recoveryCode, "Recovered Phone")
	if err != nil {
		t.Fatalf("BeginRecovery: %v", err)
	}
	recOpts, err := virtualwebauthn.ParseAttestationOptions(marshalCreation(t, recCreation))
	if err != nil {
		t.Fatalf("ParseAttestationOptions (recovery): %v", err)
	}
	recResp := virtualwebauthn.CreateAttestationResponse(e.rp, authenticator, recoveryCred, *recOpts)

	recoveryLogin, err := e.svc.FinishRecovery(ctx, recToken, jsonRequest(t, recResp))
	if err != nil {
		t.Fatalf("FinishRecovery: %v", err)
	}
	if recoveryLogin.User.Username != "alice" {
		t.Fatalf("expected recovery to log in alice, got %q", recoveryLogin.User.Username)
	}

	// The recovery code is single-use: reusing it must fail.
	if _, _, err := e.svc.BeginRecovery(ctx, recoveryCode, ""); err != ErrAuthFailed {
		t.Fatalf("expected reused recovery code to fail, got %v", err)
	}

	keys, _ = e.svc.ListKeys(ctx, signup.User.ID)
	if len(keys) != 2 {
		t.Fatalf("expected 2 keys after recovery (primary + recovered), got %d", len(keys))
	}
}

func (e *testEnv) mustWebAuthnID(ctx context.Context, userID string) []byte {
	wu, err := e.svc.loadWebAuthnUser(ctx, userID)
	if err != nil {
		panic(err)
	}
	return wu.WebAuthnID()
}

func TestBeginSignupRejectsDuplicateUsername(t *testing.T) {
	ctx := context.Background()
	e := newTestEnv(t)

	authenticator := virtualwebauthn.NewAuthenticator()
	cred := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)

	creation, token, err := e.svc.BeginSignup(ctx, "bob")
	if err != nil {
		t.Fatalf("BeginSignup: %v", err)
	}
	attOpts, err := virtualwebauthn.ParseAttestationOptions(marshalCreation(t, creation))
	if err != nil {
		t.Fatal(err)
	}
	attResp := virtualwebauthn.CreateAttestationResponse(e.rp, authenticator, cred, *attOpts)
	if _, err := e.svc.FinishSignup(ctx, token, jsonRequest(t, attResp), ""); err != nil {
		t.Fatalf("FinishSignup: %v", err)
	}

	if _, _, err := e.svc.BeginSignup(ctx, "bob"); err != ErrUsernameTaken {
		t.Fatalf("expected ErrUsernameTaken, got %v", err)
	}
	if _, _, err := e.svc.BeginSignup(ctx, "   "); err != ErrInvalidUsername {
		t.Fatalf("expected ErrInvalidUsername for blank username, got %v", err)
	}
}

func TestBeginLoginRejectsUnknownUsername(t *testing.T) {
	ctx := context.Background()
	e := newTestEnv(t)
	if _, _, err := e.svc.BeginLogin(ctx, "nobody"); err != ErrAuthFailed {
		t.Fatalf("expected ErrAuthFailed for unknown username, got %v", err)
	}
}

func TestBeginRecoveryRejectsBadCode(t *testing.T) {
	ctx := context.Background()
	e := newTestEnv(t)
	if _, _, err := e.svc.BeginRecovery(ctx, "not-a-real-code", ""); err != ErrAuthFailed {
		t.Fatalf("expected ErrAuthFailed for malformed code, got %v", err)
	}
	if _, _, err := e.svc.BeginRecovery(ctx, "aaaaaaaa-bbbbbbbbbbbbbbbbbbbbbbbb", ""); err != ErrAuthFailed {
		t.Fatalf("expected ErrAuthFailed for unknown code, got %v", err)
	}
}
