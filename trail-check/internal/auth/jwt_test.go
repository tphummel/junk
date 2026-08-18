package auth

import (
	"testing"
	"time"
)

func TestJWTSignAndVerify(t *testing.T) {
	signer, ephemeral, err := newJWTSigner("", "")
	if err != nil {
		t.Fatal(err)
	}
	if !ephemeral {
		t.Fatal("expected an ephemeral key when none is configured")
	}

	tok, err := signer.sign("user-1", "session-1", "chrome/macos", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}

	claims, err := signer.verify(tok)
	if err != nil {
		t.Fatal(err)
	}
	if claims.Subject != "user-1" || claims.SessionID != "session-1" || claims.DeviceLabel != "chrome/macos" {
		t.Fatalf("unexpected claims: %+v", claims)
	}
}

func TestJWTVerifyExpired(t *testing.T) {
	signer, _, err := newJWTSigner("", "")
	if err != nil {
		t.Fatal(err)
	}
	tok, err := signer.sign("user-1", "session-1", "", time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := signer.verify(tok); err == nil {
		t.Fatal("expected verification of an expired token to fail")
	}
}

func TestJWTVerifyRejectsForeignKey(t *testing.T) {
	signer1, _, err := newJWTSigner("", "")
	if err != nil {
		t.Fatal(err)
	}
	signer2, _, err := newJWTSigner("", "")
	if err != nil {
		t.Fatal(err)
	}
	tok, err := signer1.sign("user-1", "session-1", "", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := signer2.verify(tok); err == nil {
		t.Fatal("expected verification with a different key to fail")
	}
}
