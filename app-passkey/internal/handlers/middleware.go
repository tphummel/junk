package handlers

import (
	"context"
	"net/http"

	"app-passkey/internal/session"
)

type contextKey int

const claimsContextKey contextKey = 0

func withClaims(r *http.Request, claims *session.Claims) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), claimsContextKey, claims))
}

// claimsFromContext returns the authenticated session's claims. Only valid
// inside a handler wrapped by requireAuthAPI or requireAuthPage.
func claimsFromContext(r *http.Request) *session.Claims {
	claims, _ := r.Context().Value(claimsContextKey).(*session.Claims)
	return claims
}

func (h *Handler) authenticate(r *http.Request) (*session.Claims, bool) {
	c, err := r.Cookie(session.CookieName)
	if err != nil || c.Value == "" {
		return nil, false
	}
	claims, err := h.Auth.VerifySession(c.Value)
	if err != nil {
		return nil, false
	}
	return claims, true
}

// requireAuthAPI wraps a JSON API handler, rejecting unauthenticated
// requests with 401.
func (h *Handler) requireAuthAPI(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := h.authenticate(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		next(w, withClaims(r, claims))
	}
}

// requireAuthPage wraps a page handler, redirecting unauthenticated
// requests to the login page.
func (h *Handler) requireAuthPage(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := h.authenticate(r)
		if !ok {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}
		next(w, withClaims(r, claims))
	}
}
