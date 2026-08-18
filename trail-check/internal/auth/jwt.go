package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// sessionClaims is the JWT payload stored in the session_jwt cookie.
// It is intentionally minimal: the actual session state (revocation,
// expiry, device label) lives in the session table, and this token is
// just a tamper-proof pointer into it plus a hard expiry of its own.
type sessionClaims struct {
	jwt.RegisteredClaims
	SessionID   string `json:"sid"`
	DeviceLabel string `json:"dev"`
}

// jwtSigner issues and verifies RS256 session tokens.
type jwtSigner struct {
	private *rsa.PrivateKey
	public  *rsa.PublicKey
}

// loadOrGenerateKey loads an RSA private key from a PEM string or file, or
// generates an ephemeral one if neither is configured. An ephemeral key
// means sessions won't survive a restart, which is fine for local
// development but should not be relied on in production -- the caller logs
// a warning when this path is taken.
func loadOrGenerateKey(pemString, pemFile string) (key *rsa.PrivateKey, ephemeral bool, err error) {
	raw := pemString
	if raw == "" && pemFile != "" {
		data, err := os.ReadFile(pemFile)
		if err != nil {
			return nil, false, fmt.Errorf("read JWT_RSA_PRIVATE_KEY_FILE: %w", err)
		}
		raw = string(data)
	}
	if raw == "" {
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			return nil, false, fmt.Errorf("generate ephemeral RSA key: %w", err)
		}
		return key, true, nil
	}

	block, _ := pem.Decode([]byte(raw))
	if block == nil {
		return nil, false, fmt.Errorf("JWT_RSA_PRIVATE_KEY is not valid PEM")
	}
	if k, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return k, false, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, false, fmt.Errorf("parse JWT_RSA_PRIVATE_KEY: %w", err)
	}
	k, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, false, fmt.Errorf("JWT_RSA_PRIVATE_KEY is not an RSA key")
	}
	return k, false, nil
}

func newJWTSigner(pemString, pemFile string) (*jwtSigner, bool, error) {
	key, ephemeral, err := loadOrGenerateKey(pemString, pemFile)
	if err != nil {
		return nil, false, err
	}
	return &jwtSigner{private: key, public: &key.PublicKey}, ephemeral, nil
}

func (s *jwtSigner) sign(userID, sessionID, deviceLabel string, expiresAt time.Time) (string, error) {
	claims := sessionClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
		SessionID:   sessionID,
		DeviceLabel: deviceLabel,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	return token.SignedString(s.private)
}

func (s *jwtSigner) verify(tokenString string) (*sessionClaims, error) {
	claims := &sessionClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return s.public, nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return claims, nil
}
