package handlers

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/descope/virtualwebauthn"

	"app-passkey/internal/auth"
	"app-passkey/internal/db"
)

const (
	testRPID   = "localhost"
	testOrigin = "https://localhost"
)

type testEnv struct {
	mux *http.ServeMux
	rp  virtualwebauthn.RelyingParty
	jar map[string]*http.Cookie
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	authSvc, err := auth.New(database, auth.Config{
		RPID:          testRPID,
		RPDisplayName: "app-passkey test",
		RPOrigins:     []string{testOrigin},
		SessionTTL:    time.Hour,
		SessionSecret: "test-secret",
	}, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatalf("auth.New: %v", err)
	}

	h := New(authSvc, slog.New(slog.DiscardHandler))
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	return &testEnv{
		mux: mux,
		rp:  virtualwebauthn.RelyingParty{Name: "app-passkey test", ID: testRPID, Origin: testOrigin},
		jar: make(map[string]*http.Cookie),
	}
}

// do sends a request through the mux, carrying and updating this env's
// cookie jar so a ceremony's challenge/session cookies flow across calls
// just like a real browser.
func (e *testEnv) do(method, path string, body []byte) *httptest.ResponseRecorder {
	var r *http.Request
	if body != nil {
		r = httptest.NewRequest(method, path, bytes.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	} else {
		r = httptest.NewRequest(method, path, nil)
	}
	for _, c := range e.jar {
		r.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, r)
	for _, c := range rec.Result().Cookies() {
		if c.MaxAge < 0 {
			delete(e.jar, c.Name)
		} else {
			e.jar[c.Name] = c
		}
	}
	return rec
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestHealthz(t *testing.T) {
	e := newTestEnv(t)
	rec := e.do(http.MethodGet, "/healthz", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

// TestProtectedPagesRejectUnauthenticated matches trail-check's precedent
// (see TestProtectedRoutesRejectUnauthenticated): every route behind
// RequireAuth responds 401, page routes included, rather than redirecting.
func TestProtectedPagesRejectUnauthenticated(t *testing.T) {
	e := newTestEnv(t)
	for _, path := range []string{"/home", "/keys", "/admin"} {
		rec := e.do(http.MethodGet, path, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: expected 401, got %d", path, rec.Code)
		}
	}
}

func TestProtectedAPIRejectsUnauthenticated(t *testing.T) {
	e := newTestEnv(t)
	rec := e.do(http.MethodGet, "/api/keys", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

// TestFullHTTPSignupLoginFlow drives the whole design-doc user story
// through the actual HTTP handlers: signup, confirm, home page, add a key,
// label it, revoke it, log out, then recover via a saved code.
func TestFullHTTPSignupLoginFlow(t *testing.T) {
	e := newTestEnv(t)
	authenticator := virtualwebauthn.NewAuthenticator()
	primaryCred := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)

	// --- Signup begin ---
	rec := e.do(http.MethodPost, "/api/signup/begin", mustJSON(t, map[string]string{"username": "alice"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("signup/begin: expected 200, got %d: %s", rec.Code, rec.Body)
	}
	attOpts, err := virtualwebauthn.ParseAttestationOptions(rec.Body.String())
	if err != nil {
		t.Fatalf("ParseAttestationOptions: %v", err)
	}
	attResp := virtualwebauthn.CreateAttestationResponse(e.rp, authenticator, primaryCred, *attOpts)

	// --- Signup finish ---
	rec = e.do(http.MethodPost, "/api/signup/finish?nickname=MacBook", []byte(attResp))
	if rec.Code != http.StatusOK {
		t.Fatalf("signup/finish: expected 200, got %d: %s", rec.Code, rec.Body)
	}
	var signupOut struct {
		Username      string   `json:"username"`
		RecoveryCodes []string `json:"recovery_codes"`
		ConfirmToken  string   `json:"confirm_token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &signupOut); err != nil {
		t.Fatal(err)
	}
	if signupOut.Username != "alice" || len(signupOut.RecoveryCodes) != 10 {
		t.Fatalf("unexpected signup response: %+v", signupOut)
	}
	authenticator.AddCredential(primaryCred)

	// Not logged in yet: home should reject.
	rec = e.do(http.MethodGet, "/home", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 before confirming signup, got %d", rec.Code)
	}

	// --- Confirm signup ---
	rec = e.do(http.MethodPost, "/api/signup/confirm", mustJSON(t, map[string]string{"confirm_token": signupOut.ConfirmToken}))
	if rec.Code != http.StatusOK {
		t.Fatalf("signup/confirm: expected 200, got %d: %s", rec.Code, rec.Body)
	}

	// --- Home page now accessible ---
	rec = e.do(http.MethodGet, "/home", nil)
	if rec.Code != http.StatusOK || !bytesContains(rec.Body.Bytes(), "alice") {
		t.Fatalf("expected home page to greet alice, got %d: %s", rec.Code, rec.Body)
	}

	// --- Admin page lists the user ---
	rec = e.do(http.MethodGet, "/admin", nil)
	if rec.Code != http.StatusOK || !bytesContains(rec.Body.Bytes(), "alice") {
		t.Fatalf("expected admin page to list alice, got %d: %s", rec.Code, rec.Body)
	}

	// --- Add a key ---
	rec = e.do(http.MethodPost, "/api/keys/begin", mustJSON(t, map[string]string{"nickname": "YubiKey"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("keys/begin: expected 200, got %d: %s", rec.Code, rec.Body)
	}
	addOpts, err := virtualwebauthn.ParseAttestationOptions(rec.Body.String())
	if err != nil {
		t.Fatal(err)
	}
	backupCred := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	addResp := virtualwebauthn.CreateAttestationResponse(e.rp, authenticator, backupCred, *addOpts)

	rec = e.do(http.MethodPost, "/api/keys/finish", []byte(addResp))
	if rec.Code != http.StatusOK {
		t.Fatalf("keys/finish: expected 200, got %d: %s", rec.Code, rec.Body)
	}
	var addedKey keyView
	if err := json.Unmarshal(rec.Body.Bytes(), &addedKey); err != nil {
		t.Fatal(err)
	}
	authenticator.AddCredential(backupCred)

	// --- List keys ---
	rec = e.do(http.MethodGet, "/api/keys", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("keys list: expected 200, got %d", rec.Code)
	}
	var keys []keyView
	if err := json.Unmarshal(rec.Body.Bytes(), &keys); err != nil {
		t.Fatal(err)
	}
	if len(keys) != 2 {
		t.Fatalf("expected 2 keys, got %d", len(keys))
	}

	// --- Label the key ---
	rec = e.do(http.MethodPatch, "/api/keys/"+addedKey.ID, mustJSON(t, map[string]string{"nickname": "Renamed"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("label key: expected 200, got %d: %s", rec.Code, rec.Body)
	}

	// --- Revoke the key ---
	rec = e.do(http.MethodDelete, "/api/keys/"+addedKey.ID, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("revoke key: expected 204, got %d: %s", rec.Code, rec.Body)
	}
	rec = e.do(http.MethodGet, "/api/keys", nil)
	json.Unmarshal(rec.Body.Bytes(), &keys)
	if len(keys) != 1 {
		t.Fatalf("expected 1 key after revoke, got %d", len(keys))
	}

	// --- Logout ---
	rec = e.do(http.MethodPost, "/api/logout", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("logout: expected 200, got %d", rec.Code)
	}
	rec = e.do(http.MethodGet, "/home", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 after logout, got %d", rec.Code)
	}

	// --- Log back in with the primary passkey ---
	rec = e.do(http.MethodPost, "/api/login/begin", mustJSON(t, map[string]string{"username": "alice"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("login/begin: expected 200, got %d: %s", rec.Code, rec.Body)
	}
	assertOpts, err := virtualwebauthn.ParseAssertionOptions(rec.Body.String())
	if err != nil {
		t.Fatal(err)
	}
	assertResp := virtualwebauthn.CreateAssertionResponse(e.rp, authenticator, primaryCred, *assertOpts)
	rec = e.do(http.MethodPost, "/api/login/finish", []byte(assertResp))
	if rec.Code != http.StatusOK {
		t.Fatalf("login/finish: expected 200, got %d: %s", rec.Code, rec.Body)
	}
	rec = e.do(http.MethodGet, "/home", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected home page after login, got %d", rec.Code)
	}

	// --- Recovery: lose the device, verify a saved code, register a fresh passkey ---
	delete(e.jar, "app_passkey_session") // simulate a brand new browser with no session
	recoveryCred := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	rec = e.do(http.MethodPost, "/api/recovery/begin", mustJSON(t, map[string]string{
		"code": signupOut.RecoveryCodes[1], "nickname": "Recovered Phone",
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("recovery/begin: expected 200, got %d: %s", rec.Code, rec.Body)
	}
	recOpts, err := virtualwebauthn.ParseAttestationOptions(rec.Body.String())
	if err != nil {
		t.Fatal(err)
	}
	recResp := virtualwebauthn.CreateAttestationResponse(e.rp, authenticator, recoveryCred, *recOpts)
	rec = e.do(http.MethodPost, "/api/recovery/finish", []byte(recResp))
	if rec.Code != http.StatusOK {
		t.Fatalf("recovery/finish: expected 200, got %d: %s", rec.Code, rec.Body)
	}
	rec = e.do(http.MethodGet, "/home", nil)
	if rec.Code != http.StatusOK || !bytesContains(rec.Body.Bytes(), "alice") {
		t.Fatalf("expected recovery to log alice back in, got %d: %s", rec.Code, rec.Body)
	}

	// A spent recovery code must not work twice.
	rec = e.do(http.MethodPost, "/api/recovery/begin", mustJSON(t, map[string]string{"code": signupOut.RecoveryCodes[1]}))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected reused recovery code to be rejected, got %d", rec.Code)
	}

	// --- Revoking your only remaining passkey is refused (mirrors
	// trail-check's "cannot delete your only active passkey" guard) ---
	rec = e.do(http.MethodGet, "/api/keys", nil)
	var remaining []keyView
	if err := json.Unmarshal(rec.Body.Bytes(), &remaining); err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 2 {
		t.Fatalf("expected 2 keys before the last-credential check, got %d", len(remaining))
	}
	rec = e.do(http.MethodDelete, "/api/keys/"+remaining[0].ID, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("revoke down to 1 key: expected 204, got %d: %s", rec.Code, rec.Body)
	}
	rec = e.do(http.MethodDelete, "/api/keys/"+remaining[1].ID, nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 revoking the only remaining key, got %d: %s", rec.Code, rec.Body)
	}
}

func bytesContains(haystack []byte, needle string) bool {
	return bytes.Contains(haystack, []byte(needle))
}
