package handlers

import (
	"net/http"
	"time"
)

type recoveryBeginRequest struct {
	Code     string `json:"code"`
	Nickname string `json:"nickname"`
}

// handleRecoveryBegin verifies an offline recovery code and, if valid,
// starts a registration ceremony for a replacement passkey.
func (h *Handler) handleRecoveryBegin(w http.ResponseWriter, r *http.Request) {
	var body recoveryBeginRequest
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	creation, token, err := h.Auth.BeginRecovery(r.Context(), body.Code, body.Nickname)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "recovery code is invalid or already used")
		return
	}

	setChallengeCookie(w, r, token)
	writeJSON(w, http.StatusOK, creation)
}

func (h *Handler) handleRecoveryFinish(w http.ResponseWriter, r *http.Request) {
	token, ok := readChallengeCookie(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "no recovery in progress")
		return
	}
	clearChallengeCookie(w, r)

	result, err := h.Auth.FinishRecovery(r.Context(), token, r)
	if err != nil {
		h.Logger.Warn("finish recovery", "error", err)
		writeError(w, http.StatusBadRequest, "recovery failed")
		return
	}

	setSessionCookie(w, r, result.SessionID, time.Until(result.ExpiresAt))
	writeJSON(w, http.StatusOK, map[string]string{"redirect": "/home"})
}
