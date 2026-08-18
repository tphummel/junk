package auth

import "errors"

var (
	// ErrRegistrationForbidden is returned when a registration token is
	// configured and the caller didn't present a matching one.
	ErrRegistrationForbidden = errors.New("auth: registration is not open")
	// ErrChallengeExpired is returned when a WebAuthn ceremony's challenge
	// token is unknown or has expired.
	ErrChallengeExpired = errors.New("auth: challenge expired or not found")
	// ErrAuthFailed is a catch-all for a login ceremony that verified but
	// didn't resolve to a usable, active credential.
	ErrAuthFailed = errors.New("auth: authentication failed")
	// ErrUnauthenticated is returned by RequireAuth when no valid session is present.
	ErrUnauthenticated = errors.New("auth: unauthenticated")
)
