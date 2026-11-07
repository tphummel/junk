package web

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"sworn/internal/store"
)

const challengeCookie = "vc_challenge"
const challengeTTL = 5 * time.Minute

type challenge struct {
	kind     string // register | login | addkey
	session  webauthn.SessionData
	username string
	keyName  string
	userID   int64
	handle   []byte
	exp      time.Time
}

type waUser struct {
	handle []byte // opaque random user handle stored on the users row
	name   string
	creds  []webauthn.Credential
}

func (u *waUser) WebAuthnID() []byte                         { return u.handle }
func (u *waUser) WebAuthnName() string                       { return u.name }
func (u *waUser) WebAuthnDisplayName() string                { return u.name }
func (u *waUser) WebAuthnCredentials() []webauthn.Credential { return u.creds }

func (s *Server) loadWAUser(u *store.User) (*waUser, error) {
	pks, err := s.st.Passkeys(u.ID, true)
	if err != nil {
		return nil, err
	}
	wu := &waUser{handle: u.Handle, name: u.Username}
	for _, p := range pks {
		wu.creds = append(wu.creds, p.Credential)
	}
	return wu, nil
}

func (s *Server) putChallenge(w http.ResponseWriter, r *http.Request, c challenge) {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	tok := base64.RawURLEncoding.EncodeToString(b)
	c.exp = time.Now().Add(challengeTTL)
	s.chMu.Lock()
	for k, v := range s.challenges { // opportunistic expiry sweep
		if time.Now().After(v.exp) {
			delete(s.challenges, k)
		}
	}
	s.challenges[tok] = c
	s.chMu.Unlock()
	s.setCookie(w, r, challengeCookie, tok, int(challengeTTL.Seconds()))
}

func (s *Server) takeChallenge(w http.ResponseWriter, r *http.Request, kind string) (challenge, bool) {
	ck, err := r.Cookie(challengeCookie)
	if err != nil {
		return challenge{}, false
	}
	s.chMu.Lock()
	c, ok := s.challenges[ck.Value]
	delete(s.challenges, ck.Value)
	s.chMu.Unlock()
	s.setCookie(w, r, challengeCookie, "", -1)
	if !ok || time.Now().After(c.exp) || c.kind != kind {
		return challenge{}, false
	}
	return c, true
}

func (s *Server) registrationOpen() bool {
	n, err := s.st.CountUsers()
	return err == nil && (n == 0 || s.cfg.AllowRegister)
}

func (s *Server) loginPage(w http.ResponseWriter, r *http.Request) {
	if u, _ := s.sessionFrom(r); u != nil {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	s.render(w, r, "login", "Sign in", map[string]any{"CanRegister": s.registrationOpen()})
}

func (s *Server) registerPage(w http.ResponseWriter, r *http.Request) {
	if !s.registrationOpen() {
		http.NotFound(w, r)
		return
	}
	n, _ := s.st.CountUsers()
	s.render(w, r, "register", "Register", map[string]any{"First": n == 0})
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, userID int64, credID []byte) error {
	tok, err := s.st.CreateSession(userID, credID)
	if err != nil {
		return err
	}
	s.setCookie(w, r, sessionCookie, tok, int(store.SessionTTL.Seconds()))
	return nil
}

func (s *Server) registerBegin(w http.ResponseWriter, r *http.Request) {
	if !s.registrationOpen() {
		http.NotFound(w, r)
		return
	}
	var in struct{ Username, Name string }
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in) != nil {
		jsonError(w, 400, "bad request")
		return
	}
	in.Username = strings.TrimSpace(in.Username)
	if len(in.Username) < 1 || len(in.Username) > 64 {
		jsonError(w, 400, "username must be 1-64 characters")
		return
	}
	if _, err := s.st.UserByUsername(in.Username); err == nil {
		jsonError(w, 409, "username taken")
		return
	}
	handle := make([]byte, 32)
	_, _ = rand.Read(handle)
	wu := &waUser{handle: handle, name: in.Username}
	opts, sd, err := s.wa.BeginRegistration(wu, webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementPreferred))
	if err != nil {
		jsonError(w, 500, "could not start registration")
		return
	}
	s.putChallenge(w, r, challenge{kind: "register", session: *sd, username: in.Username, keyName: strings.TrimSpace(in.Name), handle: handle})
	writeJSON(w, 200, opts)
}

func (s *Server) registerFinish(w http.ResponseWriter, r *http.Request) {
	c, ok := s.takeChallenge(w, r, "register")
	if !ok || !s.registrationOpen() {
		jsonError(w, 400, "registration expired; try again")
		return
	}
	wu := &waUser{handle: c.handle, name: c.username}
	cred, err := s.wa.FinishRegistration(wu, c.session, r)
	if err != nil {
		s.log.Warn("register finish failed", "err", err)
		jsonError(w, 400, "passkey verification failed")
		return
	}
	u, err := s.st.CreateUserWithPasskey(c.username, c.handle, c.keyName, *cred)
	if errors.Is(err, store.ErrUsernameTaken) {
		jsonError(w, 409, "username taken")
		return
	} else if err != nil {
		jsonError(w, 500, "could not create account")
		return
	}
	if err := s.startSession(w, r, u.ID, cred.ID); err != nil {
		jsonError(w, 500, "could not start session")
		return
	}
	s.log.Info("account created", "user_id", u.ID, "admin", u.IsAdmin)
	writeJSON(w, 200, map[string]any{"ok": true, "redirect": "/"})
}

func (s *Server) loginBegin(w http.ResponseWriter, r *http.Request) {
	var in struct{ Username string }
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in) != nil {
		jsonError(w, 400, "bad request")
		return
	}
	u, err := s.st.UserByUsername(in.Username)
	if err != nil {
		jsonError(w, 401, "unknown user or no active passkey")
		return
	}
	wu, err := s.loadWAUser(u)
	if err != nil || len(wu.creds) == 0 {
		jsonError(w, 401, "unknown user or no active passkey")
		return
	}
	opts, sd, err := s.wa.BeginLogin(wu)
	if err != nil {
		jsonError(w, 500, "could not start login")
		return
	}
	s.putChallenge(w, r, challenge{kind: "login", session: *sd, userID: u.ID})
	writeJSON(w, 200, opts)
}

func (s *Server) loginFinish(w http.ResponseWriter, r *http.Request) {
	c, ok := s.takeChallenge(w, r, "login")
	if !ok {
		jsonError(w, 400, "login expired; try again")
		return
	}
	u, err := s.st.UserByID(c.userID)
	if err != nil {
		jsonError(w, 401, "login failed")
		return
	}
	wu, err := s.loadWAUser(u) // active passkeys only: deactivated keys cannot sign in
	if err != nil {
		jsonError(w, 500, "login failed")
		return
	}
	cred, err := s.wa.FinishLogin(wu, c.session, r)
	if err != nil {
		s.log.Warn("login failed", "user_id", u.ID, "err", err)
		jsonError(w, 401, "passkey verification failed")
		return
	}
	_ = s.st.TouchPasskey(*cred)
	if err := s.startSession(w, r, u.ID, cred.ID); err != nil {
		jsonError(w, 500, "could not start session")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "redirect": "/"})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		s.st.DeleteSession(c.Value)
	}
	s.setCookie(w, r, sessionCookie, "", -1)
	http.Redirect(w, r, "/login", http.StatusSeeOther)
}

func (s *Server) passkeysPage(w http.ResponseWriter, r *http.Request) {
	pks, err := s.st.Passkeys(userFrom(r).ID, false)
	if err != nil {
		http.Error(w, "error", 500)
		return
	}
	s.render(w, r, "passkeys", "Passkeys", pks)
}

func (s *Server) passkeyAddBegin(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	var in struct{ Name string }
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in)
	wu, err := s.loadWAUser(u)
	if err != nil {
		jsonError(w, 500, "error")
		return
	}
	opts, sd, err := s.wa.BeginRegistration(wu, webauthn.WithExclusions(webauthn.Credentials(wu.creds).CredentialDescriptors()),
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementPreferred))
	if err != nil {
		jsonError(w, 500, "could not start registration")
		return
	}
	s.putChallenge(w, r, challenge{kind: "addkey", session: *sd, userID: u.ID, keyName: strings.TrimSpace(in.Name)})
	writeJSON(w, 200, opts)
}

func (s *Server) passkeyAddFinish(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	c, ok := s.takeChallenge(w, r, "addkey")
	if !ok || c.userID != u.ID {
		jsonError(w, 400, "expired; try again")
		return
	}
	wu, err := s.loadWAUser(u)
	if err != nil {
		jsonError(w, 500, "error")
		return
	}
	cred, err := s.wa.FinishRegistration(wu, c.session, r)
	if err != nil {
		jsonError(w, 400, "passkey verification failed")
		return
	}
	if err := s.st.AddPasskey(u.ID, c.keyName, *cred); err != nil {
		jsonError(w, 500, "could not store passkey")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) passkeyDeactivate(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	switch err := s.st.DeactivatePasskey(userFrom(r).ID, id); {
	case errors.Is(err, store.ErrLastPasskey):
		s.redirect(w, r, "/passkeys", "", "You must keep at least one active passkey. Add a new one first.")
	case errors.Is(err, store.ErrNotFound):
		http.NotFound(w, r)
	case err != nil:
		http.Error(w, "error", 500)
	default:
		s.redirect(w, r, "/passkeys", "Passkey deactivated.", "")
	}
}
