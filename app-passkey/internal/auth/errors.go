package auth

import "errors"

var (
	// ErrUsernameTaken is returned when signup is attempted with a username
	// that's already registered.
	ErrUsernameTaken = errors.New("auth: username is already taken")

	// ErrInvalidUsername is returned for an empty or malformed username.
	ErrInvalidUsername = errors.New("auth: invalid username")

	// ErrAuthFailed covers any login, add-key, or recovery failure whose
	// details shouldn't be revealed to the caller (wrong credential,
	// unknown username, unknown or spent recovery code, etc).
	ErrAuthFailed = errors.New("auth: authentication failed")

	// ErrChallengeExpired is returned when a ceremony token is unknown,
	// already used, or past its TTL.
	ErrChallengeExpired = errors.New("auth: challenge expired or not found")

	// ErrUnauthenticated is returned by RequireAuth when no valid session
	// cookie is present.
	ErrUnauthenticated = errors.New("auth: unauthenticated")

	// ErrLastCredential is returned by RevokeKey when asked to delete a
	// user's only remaining passkey, which would strand them with no
	// primary authentication factor.
	ErrLastCredential = errors.New("auth: cannot revoke your only passkey")
)
