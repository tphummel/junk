package auth

import (
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"

	"trail-check/internal/db"
)

// webAuthnUser adapts a db.User plus their stored passkeys to the
// go-webauthn webauthn.User interface. There is no username or email by
// design (see the design doc): the WebAuthn user handle is the account's
// UUID, and the display name is a non-identifying label derived from it.
type webAuthnUser struct {
	user     *db.User
	passkeys []*db.Passkey
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
	return "trailcheck-" + u.user.ID[:8]
}

func (u *webAuthnUser) WebAuthnDisplayName() string {
	return u.WebAuthnName()
}

func (u *webAuthnUser) WebAuthnCredentials() []webauthn.Credential {
	creds := make([]webauthn.Credential, 0, len(u.passkeys))
	for _, pk := range u.passkeys {
		if pk.Status != db.PasskeyActive {
			continue
		}
		creds = append(creds, pk.Credential)
	}
	return creds
}

func userIDFromWebAuthnHandle(handle []byte) (string, error) {
	id, err := uuid.FromBytes(handle)
	if err != nil {
		return "", err
	}
	return id.String(), nil
}
