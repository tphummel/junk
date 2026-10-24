package web

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"daily-solitaire/internal/store"
)

// waUser adapts an account to go-webauthn. The user handle is the account id.
type waUser struct {
	id, name, display string
	creds             []webauthn.Credential
}

func (u *waUser) WebAuthnID() []byte                         { return []byte(u.id) }
func (u *waUser) WebAuthnName() string                       { return u.name }
func (u *waUser) WebAuthnDisplayName() string                { return u.display }
func (u *waUser) WebAuthnCredentials() []webauthn.Credential { return u.creds }

func (s *Server) loadWAUser(ctx context.Context, u *store.User) (*waUser, error) {
	rows, err := s.store.CredentialsForUser(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	wu := &waUser{id: u.ID, name: u.Username, display: u.DisplayName}
	for _, c := range rows {
		var cred webauthn.Credential
		if err := json.Unmarshal([]byte(c.JSON), &cred); err != nil {
			return nil, fmt.Errorf("decode credential %s: %w", c.ID, err)
		}
		wu.creds = append(wu.creds, cred)
	}
	return wu, nil
}

func descriptors(creds []webauthn.Credential) []protocol.CredentialDescriptor {
	out := make([]protocol.CredentialDescriptor, len(creds))
	for i, c := range creds {
		out[i] = c.Descriptor()
	}
	return out
}

// ceremony is the server-side state of one in-flight WebAuthn ceremony.
type ceremony struct {
	UserID   string
	Username string
	Display  string
	Name     string // label for a passkey being added
	Next     string
	Session  webauthn.SessionData
}

func (s *Server) putCeremony(ctx context.Context, kind string, c ceremony) (string, error) {
	raw, _ := json.Marshal(c)
	return s.store.PutChallenge(ctx, kind, c.UserID, string(raw), ceremonyTTL)
}

func (s *Server) takeCeremony(ctx context.Context, id, kind string) (ceremony, error) {
	var c ceremony
	_, data, err := s.store.TakeChallenge(ctx, id, kind)
	if err != nil {
		return c, errors.New("That sign-in attempt expired. Please try again.")
	}
	if err := json.Unmarshal([]byte(data), &c); err != nil {
		return c, errors.New("That sign-in attempt expired. Please try again.")
	}
	return c, nil
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

var usernameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9_.-]{2,23}$`)

func normalizeUsername(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func cleanDisplayName(s, fallback string) string {
	s = strings.Join(strings.Fields(s), " ")
	if s == "" {
		return fallback
	}
	if utf8.RuneCountInString(s) > 40 {
		s = string([]rune(s)[:40])
	}
	return s
}

// aaguidOf renders an authenticator's AAGUID in canonical UUID form.
func aaguidOf(c *webauthn.Credential) string {
	b := c.Authenticator.AAGUID
	if len(b) != 16 {
		return ""
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// ---- pages ----

func (s *Server) loginPage(w http.ResponseWriter, r *http.Request) {
	if user(r) != nil {
		http.Redirect(w, r, safeNext(r.URL.Query().Get("next")), http.StatusSeeOther)
		return
	}
	s.render(w, r, http.StatusOK, "login", "Sign in", map[string]any{"Next": safeNext(r.URL.Query().Get("next"))})
}

func (s *Server) signupPage(w http.ResponseWriter, r *http.Request) {
	if user(r) != nil {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	s.render(w, r, http.StatusOK, "signup", "Create account", nil)
}

// ---- sign-up ----

func (s *Server) signupBegin(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.SignupsOpen() {
		jsonError(w, http.StatusForbidden, "Sign-ups are closed.")
		return
	}
	var req struct {
		Username    string `json:"username"`
		DisplayName string `json:"display_name"`
	}
	if err := readJSON(r, &req); err != nil {
		jsonError(w, http.StatusBadRequest, "Bad request.")
		return
	}
	name := normalizeUsername(req.Username)
	if !usernameRE.MatchString(name) {
		jsonError(w, http.StatusBadRequest, "Usernames are 3–24 characters: letters, digits, dot, dash or underscore.")
		return
	}
	if _, err := s.store.UserByUsername(r.Context(), name); err == nil {
		jsonError(w, http.StatusConflict, "That username is taken.")
		return
	}
	id := store.NewID(s.store.Now())
	display := cleanDisplayName(req.DisplayName, name)
	wu := &waUser{id: id, name: name, display: display}
	creation, sd, err := s.wa.BeginRegistration(wu,
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired),
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementRequired,
			UserVerification: protocol.VerificationRequired,
		}),
	)
	if err != nil {
		s.log.Error("begin registration", "error", err)
		jsonError(w, http.StatusInternalServerError, "Could not start sign-up.")
		return
	}
	cid, err := s.putCeremony(r.Context(), "signup", ceremony{UserID: id, Username: name, Display: display, Session: *sd})
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Could not start sign-up.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"c": cid, "options": creation})
}

func (s *Server) signupFinish(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	c, err := s.takeCeremony(ctx, r.URL.Query().Get("c"), "signup")
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	wu := &waUser{id: c.UserID, name: c.Username, display: c.Display}
	cred, err := s.wa.FinishRegistration(wu, c.Session, r)
	if err != nil {
		s.log.Warn("finish registration", "error", err)
		jsonError(w, http.StatusBadRequest, "That passkey could not be verified.")
		return
	}
	u, err := s.store.CreateUserWithID(ctx, c.UserID, c.Username, c.Display)
	if errors.Is(err, store.ErrUsernameTaken) {
		jsonError(w, http.StatusConflict, "That username was just taken. Pick another.")
		return
	}
	if err != nil {
		s.log.Error("create user", "error", err)
		jsonError(w, http.StatusInternalServerError, "Could not create the account.")
		return
	}
	if err := s.saveCredential(ctx, u.ID, cred, "Passkey 1"); err != nil {
		s.log.Error("save credential", "error", err)
		jsonError(w, http.StatusInternalServerError, "Could not save the passkey.")
		return
	}
	s.store.Audit(ctx, u.ID, "signup", "account created")
	if err := s.startSession(w, r, u, "passkey", freshWindow); err != nil {
		jsonError(w, http.StatusInternalServerError, "Could not sign in.")
		return
	}
	s.setFlash(w, "Welcome! Save your recovery codes so you can never be locked out.")
	writeJSON(w, http.StatusOK, map[string]string{"redirect": "/account#recovery"})
}

func (s *Server) saveCredential(ctx context.Context, userID string, cred *webauthn.Credential, name string) error {
	raw, err := json.Marshal(cred)
	if err != nil {
		return err
	}
	_, err = s.store.AddCredential(ctx, userID, cred.ID, string(raw), aaguidOf(cred), name)
	return err
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, u *store.User, method string, fresh time.Duration) error {
	token, err := s.store.CreateSession(r.Context(), u.ID, r.UserAgent(), sessionTTL, fresh)
	if err != nil {
		s.log.Error("create session", "error", err)
		return err
	}
	s.setSession(w, token)
	s.metrics.Inc("dailysolitaire_logins_total", method)
	return nil
}

// ---- sign-in ----

func (s *Server) loginBegin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Next     string `json:"next"`
	}
	_ = readJSON(r, &req)
	ctx := r.Context()

	// With a username, ask for that account's passkeys; without one (or for an
	// unknown name, so names can't be probed) run a discoverable ceremony.
	if name := normalizeUsername(req.Username); name != "" {
		if u, err := s.store.UserByUsername(ctx, name); err == nil && !u.Disabled() {
			if wu, err := s.loadWAUser(ctx, u); err == nil && len(wu.creds) > 0 {
				assertion, sd, err := s.wa.BeginLogin(wu, webauthn.WithUserVerification(protocol.VerificationRequired))
				if err == nil {
					cid, err := s.putCeremony(ctx, "login-user", ceremony{UserID: u.ID, Next: safeNext(req.Next), Session: *sd})
					if err == nil {
						writeJSON(w, http.StatusOK, map[string]any{"c": cid, "mode": "user", "options": assertion})
						return
					}
				}
			}
		}
	}
	assertion, sd, err := s.wa.BeginDiscoverableLogin(webauthn.WithUserVerification(protocol.VerificationRequired))
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Could not start sign-in.")
		return
	}
	cid, err := s.putCeremony(ctx, "login", ceremony{Next: safeNext(req.Next), Session: *sd})
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Could not start sign-in.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"c": cid, "mode": "discoverable", "options": assertion})
}

func (s *Server) loginFinish(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cid := r.URL.Query().Get("c")
	kind := "login"
	if r.URL.Query().Get("mode") == "user" {
		kind = "login-user"
	}
	c, err := s.takeCeremony(ctx, cid, kind)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	var (
		u       *store.User
		cred    *webauthn.Credential
		unknown bool
	)
	if kind == "login-user" {
		u, err = s.store.UserByID(ctx, c.UserID)
		if err == nil {
			var wu *waUser
			if wu, err = s.loadWAUser(ctx, u); err == nil {
				cred, err = s.wa.FinishLogin(wu, c.Session, r)
			}
		}
	} else {
		var found *store.User
		handler := func(rawID, userHandle []byte) (webauthn.User, error) {
			uu, err := s.store.UserByID(ctx, string(userHandle))
			if err != nil {
				unknown = true
				return nil, err
			}
			wu, err := s.loadWAUser(ctx, uu)
			if err != nil {
				return nil, err
			}
			if _, err := s.store.CredentialByRawID(ctx, rawID); err != nil {
				unknown = true
				return nil, err
			}
			found = uu
			return wu, nil
		}
		_, cred, err = s.wa.FinishPasskeyLogin(handler, c.Session, r)
		u = found
	}
	if err != nil || u == nil || cred == nil {
		s.log.Info("login failed", "error", err, "unknown_credential", unknown)
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "That passkey wasn't recognised.",
			// Lets the browser drop a passkey this server no longer knows
			// (WebAuthn Signals: signalUnknownCredential).
			"unknown_credential": unknown,
		})
		return
	}
	if u.Disabled() {
		jsonError(w, http.StatusForbidden, "This account has been disabled.")
		return
	}
	raw, _ := json.Marshal(cred)
	_ = s.store.TouchCredential(ctx, cred.ID, string(raw))
	s.store.Audit(ctx, u.ID, "signin", "passkey, "+deviceName(r.UserAgent()))
	if err := s.startSession(w, r, u, "passkey", freshWindow); err != nil {
		jsonError(w, http.StatusInternalServerError, "Could not sign in.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"redirect": safeNext(c.Next)})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if sess := session(r); sess != nil {
		_ = s.store.RevokeSession(r.Context(), sess.UserID, sess.ID)
	}
	s.clearCookie(w)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// ---- step-up ----

func (s *Server) requireFresh(w http.ResponseWriter, r *http.Request) bool {
	if sess := session(r); sess != nil && sess.Fresh(s.store.Now()) {
		return true
	}
	if wantsJSON(r) {
		jsonError(w, http.StatusForbidden, "stepup")
		return false
	}
	next := r.URL.RequestURI()
	if r.Method != http.MethodGet {
		next = "/account"
	}
	http.Redirect(w, r, "/auth/stepup?next="+urlQueryEscape(next), http.StatusSeeOther)
	return false
}

func (s *Server) stepupPage(w http.ResponseWriter, r *http.Request) {
	s.render(w, r, http.StatusOK, "stepup", "Confirm it's you", map[string]any{"Next": safeNext(r.URL.Query().Get("next"))})
}

func (s *Server) stepupBegin(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u := user(r)
	wu, err := s.loadWAUser(ctx, u)
	if err != nil || len(wu.creds) == 0 {
		jsonError(w, http.StatusBadRequest, "This account has no passkey to verify with. Use a recovery code to sign in again.")
		return
	}
	assertion, sd, err := s.wa.BeginLogin(wu, webauthn.WithUserVerification(protocol.VerificationRequired))
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Could not start verification.")
		return
	}
	cid, err := s.putCeremony(ctx, "stepup", ceremony{UserID: u.ID, Session: *sd})
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Could not start verification.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"c": cid, "options": assertion})
}

func (s *Server) stepupFinish(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u := user(r)
	c, err := s.takeCeremony(ctx, r.URL.Query().Get("c"), "stepup")
	if err != nil || c.UserID != u.ID {
		jsonError(w, http.StatusBadRequest, "That verification expired. Please try again.")
		return
	}
	wu, err := s.loadWAUser(ctx, u)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Could not verify.")
		return
	}
	cred, err := s.wa.FinishLogin(wu, c.Session, r)
	if err != nil {
		s.log.Info("step-up failed", "error", err)
		jsonError(w, http.StatusUnauthorized, "That passkey wasn't accepted.")
		return
	}
	raw, _ := json.Marshal(cred)
	_ = s.store.TouchCredential(ctx, cred.ID, string(raw))
	if err := s.store.MarkFresh(ctx, session(r).ID, freshWindow); err != nil {
		jsonError(w, http.StatusInternalServerError, "Could not verify.")
		return
	}
	s.store.Audit(ctx, u.ID, "stepup", "re-verified with passkey")
	writeJSON(w, http.StatusOK, map[string]string{"redirect": safeNext(r.URL.Query().Get("next"))})
}

// ---- recovery ----

func (s *Server) recoverPage(w http.ResponseWriter, r *http.Request) {
	s.render(w, r, http.StatusOK, "recover", "Use a recovery code", nil)
}

func (s *Server) recoverSubmit(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow("recover:" + s.clientIP(r)) {
		s.fail(w, r, http.StatusTooManyRequests, "Too many attempts. Wait a moment and try again.")
		return
	}
	ctx := r.Context()
	userID, err := s.store.ConsumeRecoveryCode(ctx, r.PostFormValue("code"))
	if err != nil {
		s.render(w, r, http.StatusUnauthorized, "recover", "Use a recovery code", map[string]any{"Error": "That code isn't valid, or was already used."})
		return
	}
	s.finishRecovery(w, r, userID, "recovery code")
}

func (s *Server) recoverLinkPage(w http.ResponseWriter, r *http.Request) {
	s.render(w, r, http.StatusOK, "recover_link", "Recovery link", map[string]any{"Token": r.URL.Query().Get("token")})
}

func (s *Server) recoverLinkSubmit(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow("recover:" + s.clientIP(r)) {
		s.fail(w, r, http.StatusTooManyRequests, "Too many attempts. Wait a moment and try again.")
		return
	}
	userID, err := s.store.ConsumeRecoveryLink(r.Context(), r.PostFormValue("token"))
	if err != nil {
		s.fail(w, r, http.StatusUnauthorized, "That link has expired or was already used. Ask the admin for a new one.")
		return
	}
	s.finishRecovery(w, r, userID, "admin recovery link")
}

func (s *Server) finishRecovery(w http.ResponseWriter, r *http.Request, userID, how string) {
	ctx := r.Context()
	u, err := s.store.UserByID(ctx, userID)
	if err != nil || u.Disabled() {
		s.fail(w, r, http.StatusForbidden, "This account is not available.")
		return
	}
	s.store.Audit(ctx, u.ID, "recovery", "signed in with "+how)
	if err := s.startSession(w, r, u, "recovery", recoveryFreshWindow); err != nil {
		s.fail(w, r, http.StatusInternalServerError, "Could not sign in.")
		return
	}
	s.setFlash(w, "You're signed in. Add a new passkey now so you can sign in normally next time.")
	http.Redirect(w, r, "/account#passkeys", http.StatusSeeOther)
}

func urlQueryEscape(s string) string { return url.QueryEscape(s) }
