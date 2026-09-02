package handlers

import (
	"net/http"

	"app-passkey/internal/auth"
)

// handleLogout clears the session cookie. Per the design doc there's
// nothing server-side to revoke -- sessions are stateless signed tokens.
func (h *Handler) handleLogout(w http.ResponseWriter, r *http.Request) {
	auth.ClearSessionCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]string{"redirect": "/"})
}
