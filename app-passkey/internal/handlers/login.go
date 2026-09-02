package handlers

import (
	"net/http"
	"time"

	"app-passkey/internal/auth"
)

type loginBeginRequest struct {
	Username string `json:"username"`
}

func (h *Handler) handleLoginBegin(w http.ResponseWriter, r *http.Request) {
	var body loginBeginRequest
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	assertion, token, err := h.Auth.BeginLogin(r.Context(), body.Username)
	if err != nil {
		// Don't reveal whether the username exists.
		writeError(w, http.StatusUnauthorized, "login failed")
		return
	}

	auth.SetChallengeCookie(w, r, token)
	writeJSON(w, http.StatusOK, assertion)
}

func (h *Handler) handleLoginFinish(w http.ResponseWriter, r *http.Request) {
	token, ok := auth.ChallengeCookie(w, r)
	if !ok {
		writeError(w, http.StatusBadRequest, "no login in progress")
		return
	}

	result, err := h.Auth.FinishLogin(r.Context(), token, r)
	if err != nil {
		h.Logger.Warn("finish login", "error", err)
		writeError(w, http.StatusUnauthorized, "login failed")
		return
	}

	auth.SetSessionCookie(w, r, result.SessionID, time.Until(result.ExpiresAt))
	writeJSON(w, http.StatusOK, map[string]string{"redirect": "/home"})
}
