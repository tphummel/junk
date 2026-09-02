// Package recoverycode generates and verifies the offline "break-glass"
// recovery codes described in the design doc: high-entropy, Argon2-hashed,
// single-use.
package recoverycode

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base32"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Count is how many recovery codes are generated at signup, per the design
// doc's "Server generates 10 random recovery codes."
const Count = 10

// Argon2id parameters. Fixed rather than configurable: this is a
// single-tenant, homelab-scale service, so there's no need to tune them per
// deployment.
const (
	argonTime    = 1
	argonMemory  = 64 * 1024 // 64 MiB
	argonThreads = 4
	argonKeyLen  = 32
	saltLen      = 16

	lookupBytes = 5  // -> 8 base32 chars, indexed and non-secret
	secretBytes = 15 // -> 24 base32 chars, the actual secret material
)

var encoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// Code is one generated recovery code: Display is what the user saves
// offline, LookupID is the non-secret prefix used to find its DB row, and
// Hash is what gets stored instead of the secret.
type Code struct {
	Display  string
	LookupID string
	Hash     []byte
}

// Generate creates Count fresh recovery codes.
func Generate() ([]Code, error) {
	codes := make([]Code, 0, Count)
	for i := 0; i < Count; i++ {
		c, err := generateOne()
		if err != nil {
			return nil, err
		}
		codes = append(codes, c)
	}
	return codes, nil
}

func generateOne() (Code, error) {
	lookupRaw := make([]byte, lookupBytes)
	if _, err := rand.Read(lookupRaw); err != nil {
		return Code{}, fmt.Errorf("generate lookup id: %w", err)
	}
	secretRaw := make([]byte, secretBytes)
	if _, err := rand.Read(secretRaw); err != nil {
		return Code{}, fmt.Errorf("generate secret: %w", err)
	}

	lookupID := encoding.EncodeToString(lookupRaw)
	secret := encoding.EncodeToString(secretRaw)

	hash, err := hashSecret(secret)
	if err != nil {
		return Code{}, err
	}

	return Code{
		Display:  lookupID + "-" + secret,
		LookupID: lookupID,
		Hash:     hash,
	}, nil
}

// hashSecret derives an Argon2id hash of a secret, prefixed with the random
// salt used, so Verify can recompute it.
func hashSecret(secret string) ([]byte, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return nil, fmt.Errorf("generate salt: %w", err)
	}
	digest := argon2.IDKey([]byte(secret), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return append(salt, digest...), nil
}

// ErrMalformed indicates a submitted recovery code isn't in the expected
// "LOOKUPID-SECRET" shape.
var ErrMalformed = errors.New("recoverycode: malformed recovery code")

// Split parses a user-submitted code into its lookup ID and secret, without
// touching the database or doing any hashing.
func Split(display string) (lookupID, secret string, err error) {
	parts := strings.SplitN(strings.TrimSpace(display), "-", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", ErrMalformed
	}
	return parts[0], parts[1], nil
}

// Verify checks a submitted secret against a stored (salt || hash) value in
// constant time.
func Verify(secret string, stored []byte) bool {
	if len(stored) <= saltLen {
		return false
	}
	salt, wantDigest := stored[:saltLen], stored[saltLen:]
	gotDigest := argon2.IDKey([]byte(secret), salt, argonTime, argonMemory, argonThreads, uint32(len(wantDigest)))
	return subtle.ConstantTimeCompare(gotDigest, wantDigest) == 1
}
