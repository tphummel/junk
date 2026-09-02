package handlers

import "net/http"

// handleLogout clears the session cookie. Per the design doc there's
// nothing server-side to revoke -- sessions are stateless signed tokens.
func (h *Handler) handleLogout(w http.ResponseWriter, r *http.Request) {
	clearSessionCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]string{"redirect": "/"})
}
