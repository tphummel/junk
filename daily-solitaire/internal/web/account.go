package web

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"daily-solitaire/internal/dates"
	"daily-solitaire/internal/store"
)

// Decks are the selectable card themes (CSS custom properties).
var decks = []string{"paper", "linen", "contrast"}

type passkeyView struct {
	ID            string
	Name          string
	Authenticator string
	CreatedAt     time.Time
	LastUsedAt    *time.Time
}

type sessionView struct {
	ID       string
	Device   string
	LastSeen time.Time
	Created  time.Time
	Current  bool
}

type accountData struct {
	Passkeys      []passkeyView
	Sessions      []sessionView
	CodesLeft     int
	Audit         []store.AuditEntry
	Fresh         bool
	Decks         []string
	SignalCredIDs []string // base64url, for WebAuthn Signals
	UserHandle    string   // base64url of the account id
	CanRevoke     bool
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func (s *Server) accountPage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, sess := user(r), session(r)
	creds, err := s.store.CredentialsForUser(ctx, u.ID)
	if err != nil {
		s.fail(w, r, http.StatusInternalServerError, "Could not load your account.")
		return
	}
	d := accountData{Fresh: sess.Fresh(s.store.Now()), Decks: decks, UserHandle: b64([]byte(u.ID)), CanRevoke: len(creds) > 1}
	for _, c := range creds {
		d.Passkeys = append(d.Passkeys, passkeyView{ID: c.ID, Name: c.Name, Authenticator: aaguidName(c.AAGUID), CreatedAt: c.CreatedAt, LastUsedAt: c.LastUsedAt})
		d.SignalCredIDs = append(d.SignalCredIDs, b64(c.CredentialID))
	}
	if sessions, err := s.store.SessionsForUser(ctx, u.ID); err == nil {
		for _, x := range sessions {
			d.Sessions = append(d.Sessions, sessionView{ID: x.ID, Device: deviceName(x.UserAgent), LastSeen: x.LastSeenAt, Created: x.CreatedAt, Current: x.ID == sess.ID})
		}
	}
	d.CodesLeft, _ = s.store.RecoveryCodesLeft(ctx, u.ID)
	d.Audit, _ = s.store.AuditLog(ctx, u.ID, 25)
	s.render(w, r, http.StatusOK, "account", "Account", d)
}

func (s *Server) updateProfile(w http.ResponseWriter, r *http.Request) {
	u := user(r)
	deck := r.PostFormValue("deck")
	valid := false
	for _, d := range decks {
		valid = valid || d == deck
	}
	if !valid {
		deck = u.Deck
	}
	name := cleanDisplayName(r.PostFormValue("display_name"), u.Username)
	if err := s.store.UpdateProfile(r.Context(), u.ID, name, deck); err != nil {
		s.fail(w, r, http.StatusInternalServerError, "Could not save your profile.")
		return
	}
	s.store.Audit(r.Context(), u.ID, "profile", "display name or deck changed")
	s.setFlash(w, "Profile saved.")
	http.Redirect(w, r, "/account", http.StatusSeeOther)
}

// ---- passkey management ----

func (s *Server) addPasskeyBegin(w http.ResponseWriter, r *http.Request) {
	if !s.requireFresh(w, r) {
		return
	}
	ctx := r.Context()
	u := user(r)
	var req struct {
		Name string `json:"name"`
	}
	_ = readJSON(r, &req)
	wu, err := s.loadWAUser(ctx, u)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Could not start.")
		return
	}
	creation, sd, err := s.wa.BeginRegistration(wu,
		webauthn.WithExclusions(descriptors(wu.creds)),
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementRequired,
			UserVerification: protocol.VerificationRequired,
		}),
	)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Could not start.")
		return
	}
	name := cleanDisplayName(req.Name, fmt.Sprintf("Passkey %d", len(wu.creds)+1))
	cid, err := s.putCeremony(ctx, "add", ceremony{UserID: u.ID, Name: name, Session: *sd})
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Could not start.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"c": cid, "options": creation})
}

func (s *Server) addPasskeyFinish(w http.ResponseWriter, r *http.Request) {
	if !s.requireFresh(w, r) {
		return
	}
	ctx := r.Context()
	u := user(r)
	c, err := s.takeCeremony(ctx, r.URL.Query().Get("c"), "add")
	if err != nil || c.UserID != u.ID {
		jsonError(w, http.StatusBadRequest, "That attempt expired. Please try again.")
		return
	}
	wu, err := s.loadWAUser(ctx, u)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Could not save the passkey.")
		return
	}
	cred, err := s.wa.FinishRegistration(wu, c.Session, r)
	if err != nil {
		s.log.Warn("add passkey", "error", err)
		jsonError(w, http.StatusBadRequest, "That passkey could not be verified.")
		return
	}
	if err := s.saveCredential(ctx, u.ID, cred, c.Name); err != nil {
		jsonError(w, http.StatusInternalServerError, "Could not save the passkey.")
		return
	}
	s.store.Audit(ctx, u.ID, "passkey_added", c.Name)
	s.setFlash(w, "Passkey added.")
	writeJSON(w, http.StatusOK, map[string]string{"redirect": "/account#passkeys"})
}

func (s *Server) renamePasskey(w http.ResponseWriter, r *http.Request) {
	u := user(r)
	name := cleanDisplayName(r.PostFormValue("name"), "Passkey")
	switch err := s.store.RenameCredential(r.Context(), u.ID, r.PathValue("id"), name); {
	case errors.Is(err, store.ErrNotFound):
		s.notFound(w, r)
		return
	case err != nil:
		s.fail(w, r, http.StatusInternalServerError, "Could not rename the passkey.")
		return
	}
	s.store.Audit(r.Context(), u.ID, "passkey_renamed", name)
	s.setFlash(w, "Passkey renamed.")
	http.Redirect(w, r, "/account#passkeys", http.StatusSeeOther)
}

func (s *Server) revokePasskey(w http.ResponseWriter, r *http.Request) {
	if !s.requireFresh(w, r) {
		return
	}
	u := user(r)
	gone, err := s.store.DeleteCredential(r.Context(), u.ID, r.PathValue("id"))
	switch {
	case errors.Is(err, store.ErrNotFound):
		s.notFound(w, r)
		return
	case errors.Is(err, store.ErrLastCredential):
		s.setFlash(w, "That's your only passkey. Add another one before revoking it.")
		http.Redirect(w, r, "/account#passkeys", http.StatusSeeOther)
		return
	case err != nil:
		s.fail(w, r, http.StatusInternalServerError, "Could not revoke the passkey.")
		return
	}
	s.store.Audit(r.Context(), u.ID, "passkey_revoked", gone.Name)
	s.setFlash(w, "Passkey revoked.")
	http.Redirect(w, r, "/account#passkeys", http.StatusSeeOther)
}

// ---- sessions ----

func (s *Server) revokeSession(w http.ResponseWriter, r *http.Request) {
	u, sess := user(r), session(r)
	id := r.PathValue("id")
	if err := s.store.RevokeSession(r.Context(), u.ID, id); err != nil {
		s.fail(w, r, http.StatusInternalServerError, "Could not end the session.")
		return
	}
	s.store.Audit(r.Context(), u.ID, "session_revoked", "")
	if id == sess.ID {
		s.clearCookie(w)
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	s.setFlash(w, "Session ended.")
	http.Redirect(w, r, "/account#sessions", http.StatusSeeOther)
}

func (s *Server) revokeAllSessions(w http.ResponseWriter, r *http.Request) {
	u := user(r)
	if err := s.store.RevokeAllSessions(r.Context(), u.ID); err != nil {
		s.fail(w, r, http.StatusInternalServerError, "Could not sign you out.")
		return
	}
	s.store.Audit(r.Context(), u.ID, "sessions_revoked", "")
	s.clearCookie(w)
	s.setFlash(w, "Signed out everywhere.")
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// ---- recovery codes ----

func (s *Server) newRecoveryCodes(w http.ResponseWriter, r *http.Request) {
	if !s.requireFresh(w, r) {
		return
	}
	u := user(r)
	codes, err := s.store.NewRecoveryCodes(r.Context(), u.ID, 10)
	if err != nil {
		s.fail(w, r, http.StatusInternalServerError, "Could not create recovery codes.")
		return
	}
	s.store.Audit(r.Context(), u.ID, "recovery_codes", "10 new codes")
	s.render(w, r, http.StatusOK, "codes", "Recovery codes", codes)
}

// ---- export and deletion ----

func (s *Server) exportArchive(w http.ResponseWriter, r *http.Request) {
	if !s.requireFresh(w, r) {
		return
	}
	u := user(r)
	archive, err := s.store.ExportUser(r.Context(), u.ID)
	if err != nil {
		s.fail(w, r, http.StatusInternalServerError, "Could not build your archive.")
		return
	}
	s.store.Audit(r.Context(), u.ID, "export", fmt.Sprintf("%d games", len(archive.Games)))
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="daily-solitaire-%s-%s.json"`, u.Username, dates.Today(s.store.Now())))
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(archive)
}

func (s *Server) deletePage(w http.ResponseWriter, r *http.Request) {
	if !s.requireFresh(w, r) {
		return
	}
	s.render(w, r, http.StatusOK, "delete", "Delete account", nil)
}

func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) {
	if !s.requireFresh(w, r) {
		return
	}
	u := user(r)
	if normalizeUsername(r.PostFormValue("confirm")) != u.Username {
		s.setFlash(w, "Type your username exactly to confirm.")
		http.Redirect(w, r, "/account/delete", http.StatusSeeOther)
		return
	}
	// One cascading delete removes passkeys, sessions, games and moves, and
	// the user's results leave past boards with them.
	if err := s.store.DeleteUser(r.Context(), u.ID); err != nil {
		s.fail(w, r, http.StatusInternalServerError, "Could not delete the account.")
		return
	}
	s.log.Info("account deleted", "user", u.ID)
	s.clearCookie(w)
	s.setFlash(w, "Your account and every game in it have been deleted.")
	http.Redirect(w, r, "/", http.StatusSeeOther)
}
