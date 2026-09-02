// Package auth implements passkey (WebAuthn) registration and login, the
// offline recovery-code "break-glass" flow, and the session-cookie layer
// built on top of them, per the design doc.
package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"

	"app-passkey/internal/db"
	"app-passkey/internal/recoverycode"
	"app-passkey/internal/session"
)

// ChallengeTTL bounds how long a WebAuthn ceremony (and, for recovery, the
// "one-time window to register a new Passkey") has to complete. Handlers
// use the same value for the challenge cookie's max age.
const ChallengeTTL = 5 * time.Minute

// Config configures the auth service.
type Config struct {
	RPID          string
	RPDisplayName string
	RPOrigins     []string
	SessionTTL    time.Duration
	SessionSecret string
}

// Service issues and verifies passkeys, recovery codes, and sessions.
type Service struct {
	db       *db.DB
	wa       *webauthn.WebAuthn
	sessions *session.Manager
	cfg      Config
	logger   *slog.Logger
}

// New builds the auth service, generating an ephemeral session secret (with
// a logged warning) if none is configured.
func New(database *db.DB, cfg Config, logger *slog.Logger) (*Service, error) {
	wa, err := webauthn.New(&webauthn.Config{
		RPID:          cfg.RPID,
		RPDisplayName: cfg.RPDisplayName,
		RPOrigins:     cfg.RPOrigins,
	})
	if err != nil {
		return nil, fmt.Errorf("configure webauthn: %w", err)
	}

	sessions, ephemeral, err := session.NewManager(cfg.SessionSecret)
	if err != nil {
		return nil, err
	}
	if ephemeral {
		logger.Warn("SESSION_SECRET not set; generated an ephemeral key. Sessions will not survive a restart.")
	}

	return &Service{db: database, wa: wa, sessions: sessions, cfg: cfg, logger: logger}, nil
}

// ceremonyPurpose distinguishes what a stored challenge is for, so Finish*
// can refuse to complete the wrong kind of ceremony with a mismatched token.
type ceremonyPurpose string

const (
	purposeSignup   ceremonyPurpose = "signup"
	purposeLogin    ceremonyPurpose = "login"
	purposeAddKey   ceremonyPurpose = "add-key"
	purposeRecovery ceremonyPurpose = "recovery"
	purposeConfirm  ceremonyPurpose = "confirm-signup"
)

// ceremonyPayload is what gets JSON-encoded into the challenges table's
// `challenge` BLOB column: the go-webauthn session data plus enough
// bookkeeping to safely resume the ceremony on Finish.
type ceremonyPayload struct {
	Purpose  ceremonyPurpose
	Session  webauthn.SessionData
	Username string // signup only: the user doesn't exist in the DB yet
	Nickname string // registration ceremonies: label for the new credential
}

func (s *Service) putChallenge(ctx context.Context, userID string, p ceremonyPayload) (string, error) {
	token := uuid.NewString()
	raw, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	if err := s.db.PutChallenge(ctx, token, userID, raw, time.Now().Add(ChallengeTTL)); err != nil {
		return "", err
	}
	return token, nil
}

func (s *Service) takeChallenge(ctx context.Context, token string, want ceremonyPurpose) (userID string, p ceremonyPayload, err error) {
	userID, raw, err := s.db.TakeChallenge(ctx, token)
	if err != nil {
		return "", ceremonyPayload{}, ErrChallengeExpired
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return "", ceremonyPayload{}, ErrChallengeExpired
	}
	if p.Purpose != want {
		return "", ceremonyPayload{}, ErrChallengeExpired
	}
	return userID, p, nil
}

func (s *Service) loadWebAuthnUser(ctx context.Context, userID string) (*webAuthnUser, error) {
	u, err := s.db.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	creds, err := s.db.ListCredentialsByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &webAuthnUser{user: u, credentials: creds}, nil
}

func normalizeUsername(username string) string {
	return strings.TrimSpace(username)
}

// BeginSignup starts a registration ceremony for a brand new account. The
// user row is not created until FinishSignup succeeds, so an abandoned
// signup never leaves an orphan account behind.
func (s *Service) BeginSignup(ctx context.Context, username string) (*protocol.CredentialCreation, string, error) {
	username = normalizeUsername(username)
	if username == "" {
		return nil, "", ErrInvalidUsername
	}
	if _, err := s.db.GetUserByUsername(ctx, username); err == nil {
		return nil, "", ErrUsernameTaken
	}

	pendingID := uuid.NewString()
	wu := &webAuthnUser{user: &db.User{ID: pendingID, Username: username}}

	creation, sessionData, err := s.wa.BeginRegistration(wu)
	if err != nil {
		return nil, "", err
	}
	token, err := s.putChallenge(ctx, pendingID, ceremonyPayload{
		Purpose:  purposeSignup,
		Session:  *sessionData,
		Username: username,
	})
	if err != nil {
		return nil, "", err
	}
	return creation, token, nil
}

// SignupResult is the outcome of a successful FinishSignup: the new
// account plus the plaintext recovery codes, visible this one time.
type SignupResult struct {
	User          *db.User
	RecoveryCodes []string
	ConfirmToken  string
}

// FinishSignup completes a bootstrap registration ceremony: it creates the
// account, stores the new passkey, and generates recovery codes. Per the
// design doc ("Registration is not complete until the user confirms save"),
// this does not log the user in -- call ConfirmSignup with the returned
// ConfirmToken once the user has saved their codes.
func (s *Service) FinishSignup(ctx context.Context, token string, r *http.Request, nickname string) (*SignupResult, error) {
	pendingID, pc, err := s.takeChallenge(ctx, token, purposeSignup)
	if err != nil {
		return nil, err
	}

	wu := &webAuthnUser{user: &db.User{ID: pendingID, Username: pc.Username}}
	cred, err := s.wa.FinishRegistration(wu, pc.Session, r)
	if err != nil {
		return nil, err
	}

	u, err := s.db.CreateUser(ctx, pc.Username)
	if err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}
	if nickname == "" {
		nickname = "passkey"
	}
	if _, err := s.db.InsertCredential(ctx, u.ID, nickname, *cred); err != nil {
		return nil, fmt.Errorf("store credential: %w", err)
	}

	codes, err := recoverycode.Generate()
	if err != nil {
		return nil, fmt.Errorf("generate recovery codes: %w", err)
	}
	lookupIDs := make([]string, len(codes))
	hashes := make([][]byte, len(codes))
	display := make([]string, len(codes))
	for i, c := range codes {
		lookupIDs[i] = c.LookupID
		hashes[i] = c.Hash
		display[i] = c.Display
	}
	if err := s.db.InsertRecoveryCodes(ctx, u.ID, lookupIDs, hashes); err != nil {
		return nil, fmt.Errorf("store recovery codes: %w", err)
	}

	confirmToken, err := s.putChallenge(ctx, u.ID, ceremonyPayload{Purpose: purposeConfirm})
	if err != nil {
		return nil, err
	}

	return &SignupResult{User: u, RecoveryCodes: display, ConfirmToken: confirmToken}, nil
}

// LoginResult is the outcome of a successful login, signup confirmation, or
// recovery ceremony: an issued session.
type LoginResult struct {
	User      *db.User
	SessionID string // the signed session token to set as a cookie
	ExpiresAt time.Time
}

func (s *Service) issueSession(u *db.User) (*LoginResult, error) {
	expiresAt := time.Now().Add(s.cfg.SessionTTL)
	token, err := s.sessions.Issue(u.ID, u.Username, s.cfg.SessionTTL)
	if err != nil {
		return nil, err
	}
	return &LoginResult{User: u, SessionID: token, ExpiresAt: expiresAt}, nil
}

// ConfirmSignup completes signup after the user confirms they've saved
// their recovery codes, issuing their first session.
func (s *Service) ConfirmSignup(ctx context.Context, confirmToken string) (*LoginResult, error) {
	userID, _, err := s.takeChallenge(ctx, confirmToken, purposeConfirm)
	if err != nil {
		return nil, err
	}
	u, err := s.db.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.issueSession(u)
}

// VerifySession checks a session cookie's signature and expiry.
func (s *Service) VerifySession(token string) (*session.Claims, error) {
	return s.sessions.Verify(token)
}

// BeginLogin starts a login ceremony for a known username.
func (s *Service) BeginLogin(ctx context.Context, username string) (*protocol.CredentialAssertion, string, error) {
	username = normalizeUsername(username)
	u, err := s.db.GetUserByUsername(ctx, username)
	if err != nil {
		return nil, "", ErrAuthFailed
	}
	wu, err := s.loadWebAuthnUser(ctx, u.ID)
	if err != nil {
		return nil, "", err
	}
	if len(wu.credentials) == 0 {
		return nil, "", ErrAuthFailed
	}

	assertion, sessionData, err := s.wa.BeginLogin(wu)
	if err != nil {
		return nil, "", err
	}
	token, err := s.putChallenge(ctx, u.ID, ceremonyPayload{Purpose: purposeLogin, Session: *sessionData})
	if err != nil {
		return nil, "", err
	}
	return assertion, token, nil
}

// FinishLogin completes a login ceremony, updates the credential's sign
// counter, and issues a session.
func (s *Service) FinishLogin(ctx context.Context, token string, r *http.Request) (*LoginResult, error) {
	userID, pc, err := s.takeChallenge(ctx, token, purposeLogin)
	if err != nil {
		return nil, err
	}
	wu, err := s.loadWebAuthnUser(ctx, userID)
	if err != nil {
		return nil, ErrAuthFailed
	}

	cred, err := s.wa.FinishLogin(wu, pc.Session, r)
	if err != nil {
		return nil, ErrAuthFailed
	}

	var matched *db.Credential
	for _, c := range wu.credentials {
		if string(c.CredentialID) == string(cred.ID) {
			matched = c
			break
		}
	}
	if matched == nil {
		return nil, ErrAuthFailed
	}
	if err := s.db.TouchCredential(ctx, matched.ID, *cred); err != nil {
		return nil, err
	}

	return s.issueSession(wu.user)
}

// BeginAddKey starts a registration ceremony for an additional passkey on
// an already-authenticated account.
func (s *Service) BeginAddKey(ctx context.Context, userID, nickname string) (*protocol.CredentialCreation, string, error) {
	wu, err := s.loadWebAuthnUser(ctx, userID)
	if err != nil {
		return nil, "", err
	}
	creation, sessionData, err := s.wa.BeginRegistration(wu, webauthn.WithExclusions(existingCredentialDescriptors(wu)))
	if err != nil {
		return nil, "", err
	}
	token, err := s.putChallenge(ctx, userID, ceremonyPayload{Purpose: purposeAddKey, Session: *sessionData, Nickname: nickname})
	if err != nil {
		return nil, "", err
	}
	return creation, token, nil
}

// FinishAddKey completes an add-key ceremony and stores the new credential.
func (s *Service) FinishAddKey(ctx context.Context, userID, token string, r *http.Request) (*db.Credential, error) {
	pendingUserID, pc, err := s.takeChallenge(ctx, token, purposeAddKey)
	if err != nil {
		return nil, err
	}
	if pendingUserID != userID {
		return nil, ErrChallengeExpired
	}
	wu, err := s.loadWebAuthnUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	cred, err := s.wa.FinishRegistration(wu, pc.Session, r)
	if err != nil {
		return nil, err
	}
	nickname := pc.Nickname
	if nickname == "" {
		nickname = "passkey"
	}
	return s.db.InsertCredential(ctx, userID, nickname, *cred)
}

// BeginRecovery verifies an offline recovery code and, if valid, starts a
// registration ceremony for a replacement passkey -- the design doc's
// "one-time window to register a new Passkey", bounded by the same
// ChallengeTTL as any other ceremony. The code is consumed (marked used)
// immediately, before the new passkey is ever registered, matching "Single-
// use" in the spec.
func (s *Service) BeginRecovery(ctx context.Context, code, nickname string) (*protocol.CredentialCreation, string, error) {
	lookupID, secret, err := recoverycode.Split(code)
	if err != nil {
		return nil, "", ErrAuthFailed
	}
	rc, err := s.db.GetUnusedRecoveryCodeByLookupID(ctx, lookupID)
	if err != nil {
		return nil, "", ErrAuthFailed
	}
	if !recoverycode.Verify(secret, rc.CodeHash) {
		return nil, "", ErrAuthFailed
	}
	if err := s.db.MarkRecoveryCodeUsed(ctx, rc.ID); err != nil {
		return nil, "", ErrAuthFailed
	}

	wu, err := s.loadWebAuthnUser(ctx, rc.UserID)
	if err != nil {
		return nil, "", err
	}
	creation, sessionData, err := s.wa.BeginRegistration(wu, webauthn.WithExclusions(existingCredentialDescriptors(wu)))
	if err != nil {
		return nil, "", err
	}
	token, err := s.putChallenge(ctx, rc.UserID, ceremonyPayload{Purpose: purposeRecovery, Session: *sessionData, Nickname: nickname})
	if err != nil {
		return nil, "", err
	}
	return creation, token, nil
}

// FinishRecovery completes the break-glass registration ceremony, stores
// the replacement passkey, and immediately logs the user back in.
func (s *Service) FinishRecovery(ctx context.Context, token string, r *http.Request) (*LoginResult, error) {
	userID, pc, err := s.takeChallenge(ctx, token, purposeRecovery)
	if err != nil {
		return nil, err
	}
	wu, err := s.loadWebAuthnUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	cred, err := s.wa.FinishRegistration(wu, pc.Session, r)
	if err != nil {
		return nil, err
	}
	nickname := pc.Nickname
	if nickname == "" {
		nickname = "recovered device"
	}
	if _, err := s.db.InsertCredential(ctx, userID, nickname, *cred); err != nil {
		return nil, err
	}
	return s.issueSession(wu.user)
}

func existingCredentialDescriptors(wu *webAuthnUser) []protocol.CredentialDescriptor {
	out := make([]protocol.CredentialDescriptor, 0, len(wu.credentials))
	for _, c := range wu.credentials {
		out = append(out, c.Credential.Descriptor())
	}
	return out
}

// ListKeys returns every credential registered to a user, for the security
// dashboard.
func (s *Service) ListKeys(ctx context.Context, userID string) ([]*db.Credential, error) {
	return s.db.ListCredentialsByUser(ctx, userID)
}

// LabelKey assigns a nickname to one of a user's credentials.
func (s *Service) LabelKey(ctx context.Context, userID, credentialID, nickname string) error {
	return s.db.RenameCredential(ctx, credentialID, userID, nickname)
}

// RevokeKey deletes one of a user's credentials, immediately stopping that
// device from authenticating.
func (s *Service) RevokeKey(ctx context.Context, userID, credentialID string) error {
	return s.db.DeleteCredential(ctx, credentialID, userID)
}

// ListUsersForAdmin returns every user with their credential count and
// creation date, for the admin page.
func (s *Service) ListUsersForAdmin(ctx context.Context) ([]*db.UserSummary, error) {
	return s.db.ListUsersWithCredentialCounts(ctx)
}
