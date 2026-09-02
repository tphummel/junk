package handlers

import (
	"net/http"
	"time"

	"app-passkey/internal/auth"
	"app-passkey/internal/session"
)

// challengeCookieName carries the opaque token pointing at server-side
// WebAuthn ceremony state (stored in the challenges table). It's separate
// from the session cookie and always short-lived.
const challengeCookieName = "app_passkey_challenge"

func setChallengeCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     challengeCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(auth.ChallengeTTL.Seconds()),
		HttpOnly: true,
		Secure:   isSecure(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func readChallengeCookie(r *http.Request) (string, bool) {
	c, err := r.Cookie(challengeCookieName)
	if err != nil || c.Value == "" {
		return "", false
	}
	return c.Value, true
}

func clearChallengeCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     challengeCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   isSecure(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, token string, ttl time.Duration) {
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

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
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

// isSecure reports whether the cookie's Secure flag should be set. Local
// development over plain HTTP (as opposed to a deployed HTTPS origin) needs
// it off, or browsers silently refuse to store the cookie.
func isSecure(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}
