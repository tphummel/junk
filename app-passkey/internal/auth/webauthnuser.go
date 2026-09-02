package auth

import (
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"

	"app-passkey/internal/db"
)

// webAuthnUser adapts a db.User plus their stored credentials to the
// go-webauthn webauthn.User interface. Login here is username-based (not
// discoverable/usernameless), per the design doc's "User enters username"
// login flow.
type webAuthnUser struct {
	user        *db.User
	credentials []*db.Credential
}

func (u *webAuthnUser) WebAuthnID() []byte {
	id, err := uuid.Parse(u.user.ID)
	if err != nil {
		return []byte(u.user.ID)
	}
	b := id
	return b[:]
}

func (u *webAuthnUser) WebAuthnName() string {
	return u.user.Username
}

func (u *webAuthnUser) WebAuthnDisplayName() string {
	return u.user.Username
}

func (u *webAuthnUser) WebAuthnCredentials() []webauthn.Credential {
	creds := make([]webauthn.Credential, 0, len(u.credentials))
	for _, c := range u.credentials {
		creds = append(creds, c.Credential)
	}
	return creds
}
