package auth

import "errors"

var (
	// ErrUsernameTaken is returned when signup is attempted with a username
	// that's already registered.
	ErrUsernameTaken = errors.New("username is already taken")

	// ErrInvalidUsername is returned for an empty or malformed username.
	ErrInvalidUsername = errors.New("invalid username")

	// ErrAuthFailed covers any login, add-key, or recovery failure whose
	// details shouldn't be revealed to the caller (wrong credential,
	// unknown username, unknown or spent recovery code, etc).
	ErrAuthFailed = errors.New("authentication failed")

	// ErrChallengeExpired is returned when a ceremony token is unknown,
	// already used, or past its TTL.
	ErrChallengeExpired = errors.New("challenge expired or not found")
)
