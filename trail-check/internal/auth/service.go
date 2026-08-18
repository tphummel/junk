// Package auth implements passkey (WebAuthn) registration and login, and the
// JWT-cookie session layer built on top of it.
package auth

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/rs/zerolog"

	"trail-check/internal/db"
)

// SessionCookieName is the cookie carrying the signed session JWT.
const SessionCookieName = "session_jwt"

// challengeCookieName carries the opaque token pointing at server-side
// WebAuthn ceremony state. It's separate from the session cookie and always
// short-lived.
const challengeCookieName = "webauthn_challenge"

// Config configures the auth service.
type Config struct {
	RPID              string
	RPDisplayName     string
	RPOrigins         []string
	SessionTTL        time.Duration
	JWTPrivateKeyPEM  string
	JWTPrivateKeyFile string
}

// Service issues and verifies passkeys and sessions.
type Service struct {
	db     *db.DB
	wa     *webauthn.WebAuthn
	jwt    *jwtSigner
	chals  *challengeStore
	cfg    Config
	logger zerolog.Logger
}

// New builds the auth service, generating an ephemeral JWT signing key (with
// a logged warning) if none is configured.
func New(database *db.DB, cfg Config, logger zerolog.Logger) (*Service, error) {
	requireResidentKey := true
	waCfg := &webauthn.Config{
		RPID:          cfg.RPID,
		RPDisplayName: cfg.RPDisplayName,
		RPOrigins:     cfg.RPOrigins,
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			RequireResidentKey: &requireResidentKey,
			ResidentKey:        protocol.ResidentKeyRequirementRequired,
			UserVerification:   protocol.VerificationRequired,
		},
	}
	wa, err := webauthn.New(waCfg)
	if err != nil {
		return nil, fmt.Errorf("configure webauthn: %w", err)
	}

	signer, ephemeral, err := newJWTSigner(cfg.JWTPrivateKeyPEM, cfg.JWTPrivateKeyFile)
	if err != nil {
		return nil, err
	}
	if ephemeral {
		logger.Warn().Msg("JWT_RSA_PRIVATE_KEY not set; generated an ephemeral key. Sessions will not survive a restart. Set JWT_RSA_PRIVATE_KEY or JWT_RSA_PRIVATE_KEY_FILE in production.")
	}

	return &Service{
		db:     database,
		wa:     wa,
		jwt:    signer,
		chals:  newChallengeStore(),
		cfg:    cfg,
		logger: logger,
	}, nil
}

func (s *Service) loadWebAuthnUser(ctx context.Context, userID string) (*webAuthnUser, error) {
	u, err := s.db.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	pks, err := s.db.ListPasskeysByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &webAuthnUser{user: u, passkeys: pks}, nil
}

// BeginBootstrapRegistration starts a registration ceremony for a brand new
// account (the "first passkey" / sign-up flow). Registration is open to
// anyone who can reach the server; there is no invite gate.
func (s *Service) BeginBootstrapRegistration(ctx context.Context, label string) (*protocol.CredentialCreation, string, error) {
	u, err := s.db.CreateUser(ctx)
	if err != nil {
		return nil, "", err
	}
	return s.beginRegistration(ctx, &webAuthnUser{user: u}, label)
}

// BeginAddPasskey starts a registration ceremony for an additional passkey
// on an already-authenticated account.
func (s *Service) BeginAddPasskey(ctx context.Context, userID, label string) (*protocol.CredentialCreation, string, error) {
	wu, err := s.loadWebAuthnUser(ctx, userID)
	if err != nil {
		return nil, "", err
	}
	return s.beginRegistration(ctx, wu, label)
}

func (s *Service) beginRegistration(ctx context.Context, wu *webAuthnUser, label string) (*protocol.CredentialCreation, string, error) {
	existing := make([]protocol.CredentialDescriptor, 0, len(wu.passkeys))
	for _, pk := range wu.passkeys {
		existing = append(existing, pk.Credential.Descriptor())
	}
	creation, session, err := s.wa.BeginRegistration(wu, webauthn.WithExclusions(existing))
	if err != nil {
		return nil, "", err
	}
	token, err := s.chals.put(*session, wu.user.ID, label)
	if err != nil {
		return nil, "", err
	}
	return creation, token, nil
}

// FinishRegistration completes a registration ceremony and stores the new
// passkey. When this was a bootstrap registration (the account's very first
// passkey), it also starts a session so the new account is immediately
// logged in, matching the design doc's "POST /auth/register sets
// session_jwt cookie" behavior; login is nil for an add-passkey ceremony on
// an already-authenticated account.
func (s *Service) FinishRegistration(ctx context.Context, token string, r *http.Request, deviceLabel string) (*db.Passkey, *LoginResult, error) {
	pc, ok := s.chals.take(token)
	if !ok {
		return nil, nil, ErrChallengeExpired
	}
	wu, err := s.loadWebAuthnUser(ctx, pc.userID)
	if err != nil {
		return nil, nil, err
	}
	isBootstrap := len(wu.passkeys) == 0

	cred, err := s.wa.FinishRegistration(wu, pc.session, r)
	if err != nil {
		return nil, nil, err
	}
	label := pc.label
	if label == "" {
		label = "passkey"
	}
	pk, err := s.db.InsertPasskey(ctx, pc.userID, label, *cred)
	if err != nil {
		return nil, nil, err
	}

	if !isBootstrap {
		return pk, nil, nil
	}
	login, err := s.startSession(ctx, wu.user, deviceLabel)
	if err != nil {
		return pk, nil, err
	}
	return pk, login, nil
}

// BeginLogin starts a discoverable (usernameless) passkey login ceremony.
func (s *Service) BeginLogin(ctx context.Context) (*protocol.CredentialAssertion, string, error) {
	assertion, session, err := s.wa.BeginDiscoverableLogin()
	if err != nil {
		return nil, "", err
	}
	token, err := s.chals.put(*session, "", "")
	if err != nil {
		return nil, "", err
	}
	return assertion, token, nil
}

// LoginResult is the outcome of a successful login ceremony.
type LoginResult struct {
	User    *db.User
	Session *db.Session
	JWT     string
}

// FinishLogin completes a discoverable login ceremony, creates a session,
// and mints its JWT.
func (s *Service) FinishLogin(ctx context.Context, token string, r *http.Request, deviceLabel string) (*LoginResult, error) {
	pc, ok := s.chals.take(token)
	if !ok {
		return nil, ErrChallengeExpired
	}

	var loaded *webAuthnUser
	handler := func(rawID, userHandle []byte) (webauthn.User, error) {
		userID, err := userIDFromWebAuthnHandle(userHandle)
		if err != nil {
			return nil, err
		}
		wu, err := s.loadWebAuthnUser(ctx, userID)
		if err != nil {
			return nil, err
		}
		loaded = wu
		return wu, nil
	}

	waUser, cred, err := s.wa.FinishPasskeyLogin(handler, pc.session, r)
	if err != nil {
		return nil, err
	}
	_ = waUser

	if loaded == nil {
		return nil, ErrAuthFailed
	}

	var matched *db.Passkey
	for _, pk := range loaded.passkeys {
		if string(pk.CredentialID) == string(cred.ID) {
			matched = pk
			break
		}
	}
	if matched == nil || matched.Status != db.PasskeyActive {
		return nil, ErrAuthFailed
	}

	if err := s.db.TouchPasskey(ctx, matched.ID, *cred); err != nil {
		return nil, err
	}

	return s.startSession(ctx, loaded.user, deviceLabel)
}

// startSession creates a session row and its signed JWT for a user. Used
// both after a login ceremony and immediately after bootstrap registration
// (creating your first passkey logs you in).
func (s *Service) startSession(ctx context.Context, u *db.User, deviceLabel string) (*LoginResult, error) {
	sess, err := s.db.CreateSession(ctx, u.ID, deviceLabel, s.cfg.SessionTTL)
	if err != nil {
		return nil, err
	}
	jwtStr, err := s.jwt.sign(u.ID, sess.ID, deviceLabel, sess.ExpiresAt)
	if err != nil {
		return nil, err
	}
	return &LoginResult{User: u, Session: sess, JWT: jwtStr}, nil
}

// IssueSession creates a session and JWT for a user directly, without a
// WebAuthn ceremony. Login and bootstrap registration use this internally;
// it's also exported for integration tests that need an authenticated
// session without simulating real authenticator cryptography.
func (s *Service) IssueSession(ctx context.Context, userID, deviceLabel string) (*LoginResult, error) {
	u, err := s.db.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.startSession(ctx, u, deviceLabel)
}

// Logout revokes a session by its JWT.
func (s *Service) Logout(ctx context.Context, tokenString string) error {
	claims, err := s.jwt.verify(tokenString)
	if err != nil {
		return nil // already invalid; nothing to revoke
	}
	return s.db.RevokeSession(ctx, claims.SessionID, claims.Subject)
}
