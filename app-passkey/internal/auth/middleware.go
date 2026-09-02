package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"app-passkey/internal/session"
)

// challengeCookieName carries the opaque token pointing at server-side
// WebAuthn ceremony state (stored in the challenges table). It's separate
// from the session cookie and always short-lived.
const challengeCookieName = "app_passkey_challenge"

// isSecure reports whether a cookie's Secure flag should be set. Local
// development over plain HTTP (as opposed to a deployed HTTPS origin) needs
// it off, or browsers silently refuse to store the cookie.
func isSecure(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}

// SetSessionCookie writes the signed session token cookie.
func SetSessionCookie(w http.ResponseWriter, r *http.Request, token string, ttl time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name:     session.CookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(ttl.Seconds()),
		HttpOnly: true,
		Secure:   isSecure(r),
		SameSite: http.SameSiteLaxMode,
	})
}

// ClearSessionCookie removes the session cookie (logout).
func ClearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     session.CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   isSecure(r),
		SameSite: http.SameSiteLaxMode,
	})
}

// SetChallengeCookie stashes the opaque token for an in-flight WebAuthn
// ceremony. It's cleared as soon as the ceremony finishes (see
// ChallengeCookie), and expires on its own after ChallengeTTL regardless.
func SetChallengeCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     challengeCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(ChallengeTTL.Seconds()),
		HttpOnly: true,
		Secure:   isSecure(r),
		SameSite: http.SameSiteLaxMode,
	})
}

// ChallengeCookie reads and clears the ceremony token cookie.
func ChallengeCookie(w http.ResponseWriter, r *http.Request) (string, bool) {
	c, err := r.Cookie(challengeCookieName)
	if err != nil || c.Value == "" {
		return "", false
	}
	http.SetCookie(w, &http.Cookie{
		Name:     challengeCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   isSecure(r),
		SameSite: http.SameSiteLaxMode,
	})
	return c.Value, true
}

type contextKey int

const userContextKey contextKey = 0

// authenticatedUser is what RequireAuth stashes in the request context.
type authenticatedUser struct {
	UserID   string
	Username string
}

// UserID returns the authenticated user's ID from the request context.
// Only valid inside a handler chain behind RequireAuth.
func UserID(r *http.Request) string {
	u, _ := r.Context().Value(userContextKey).(authenticatedUser)
	return u.UserID
}

// Username returns the authenticated user's username from the request
// context. Only valid inside a handler chain behind RequireAuth.
func Username(r *http.Request) string {
	u, _ := r.Context().Value(userContextKey).(authenticatedUser)
	return u.Username
}

// Authenticate checks the request's session cookie, returning the signed-in
// user's ID and username. Unlike RequireAuth this never writes a response,
// so pages that behave differently for signed-in visitors (the landing
// page redirecting to /home) can use it without adopting RequireAuth's
// all-or-nothing 401.
func (s *Service) Authenticate(r *http.Request) (userID, username string, ok bool) {
	c, err := r.Cookie(session.CookieName)
	if err != nil || c.Value == "" {
		return "", "", false
	}
	claims, err := s.VerifySession(c.Value)
	if err != nil {
		return "", "", false
	}
	return claims.UserID, claims.Username, true
}

// RequireAuth verifies the session cookie, then wraps next so it only runs
// for authenticated requests. It clears the cookie only when one was
// present but didn't verify (stale or tampered); a request with no cookie
// at all has nothing to clear. There's no separate "page" variant -- every
// protected route here is equally an API/page boundary, matching
// trail-check's RequireAuth precedent of a uniform 401 rather than a
// redirect.
func (s *Service) RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(session.CookieName)
		if err != nil || c.Value == "" {
			writeUnauthorized(w, "authentication required")
			return
		}

		claims, err := s.VerifySession(c.Value)
		if err != nil {
			ClearSessionCookie(w, r)
			writeUnauthorized(w, "invalid session")
			return
		}

		ctx := context.WithValue(r.Context(), userContextKey, authenticatedUser{UserID: claims.UserID, Username: claims.Username})
		next(w, r.WithContext(ctx))
	}
}

func writeUnauthorized(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
