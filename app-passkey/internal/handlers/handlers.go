// Package handlers wires the auth service to HTTP: the JSON ceremony API
// consumed by static/app.js, and the server-rendered pages (home, admin,
// signup, login, keys).
package handlers

import (
	"log/slog"
	"net/http"

	"app-passkey/internal/auth"
)

// Handler holds dependencies shared by every HTTP handler.
type Handler struct {
	Auth   *auth.Service
	Logger *slog.Logger
}

// New builds a Handler.
func New(authSvc *auth.Service, logger *slog.Logger) *Handler {
	return &Handler{Auth: authSvc, Logger: logger}
}

// RegisterRoutes wires every route onto mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /healthz", h.handleHealthz)

	// Pages
	mux.HandleFunc("GET /{$}", h.handleIndex)
	mux.HandleFunc("GET /signup", h.handleSignupPage)
	mux.HandleFunc("GET /login", h.handleLoginPage)
	mux.HandleFunc("GET /recovery", h.handleRecoveryPage)
	mux.HandleFunc("GET /home", h.Auth.RequireAuth(h.handleHomePage))
	mux.HandleFunc("GET /keys", h.Auth.RequireAuth(h.handleKeysPage))
	mux.HandleFunc("GET /admin", h.Auth.RequireAuth(h.handleAdminPage))

	// Static assets
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServerFS(staticFS())))

	// Signup ceremony
	mux.HandleFunc("POST /api/signup/begin", h.handleSignupBegin)
	mux.HandleFunc("POST /api/signup/finish", h.handleSignupFinish)
	mux.HandleFunc("POST /api/signup/confirm", h.handleSignupConfirm)

	// Login ceremony
	mux.HandleFunc("POST /api/login/begin", h.handleLoginBegin)
	mux.HandleFunc("POST /api/login/finish", h.handleLoginFinish)

	// Logout
	mux.HandleFunc("POST /api/logout", h.handleLogout)

	// Recovery ("break-glass")
	mux.HandleFunc("POST /api/recovery/begin", h.handleRecoveryBegin)
	mux.HandleFunc("POST /api/recovery/finish", h.handleRecoveryFinish)

	// Manage keys (authenticated)
	mux.HandleFunc("GET /api/keys", h.Auth.RequireAuth(h.handleKeysList))
	mux.HandleFunc("POST /api/keys/begin", h.Auth.RequireAuth(h.handleKeysBegin))
	mux.HandleFunc("POST /api/keys/finish", h.Auth.RequireAuth(h.handleKeysFinish))
	mux.HandleFunc("PATCH /api/keys/{id}", h.Auth.RequireAuth(h.handleKeysLabel))
	mux.HandleFunc("DELETE /api/keys/{id}", h.Auth.RequireAuth(h.handleKeysRevoke))
}

func (h *Handler) handleHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
