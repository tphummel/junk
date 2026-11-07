package importer

import "github.com/go-webauthn/webauthn/webauthn"

func webauthnCred() webauthn.Credential {
	return webauthn.Credential{ID: []byte("c"), PublicKey: []byte("k")}
}
