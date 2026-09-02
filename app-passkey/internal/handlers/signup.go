package handlers

import (
	"errors"
	"net/http"
	"time"

	"app-passkey/internal/auth"
)

type signupBeginRequest struct {
	Username string `json:"username"`
}

func (h *Handler) handleSignupBegin(w http.ResponseWriter, r *http.Request) {
	var body signupBeginRequest
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	creation, token, err := h.Auth.BeginSignup(r.Context(), body.Username)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrUsernameTaken):
			writeError(w, http.StatusConflict, "username is already taken")
		case errors.Is(err, auth.ErrInvalidUsername):
			writeError(w, http.StatusBadRequest, "username is required")
		default:
			h.Logger.Error("begin signup", "error", err)
			writeError(w, http.StatusInternalServerError, "could not start signup")
		}
		return
	}

	auth.SetChallengeCookie(w, r, token)
	writeJSON(w, http.StatusOK, creation)
}

func (h *Handler) handleSignupFinish(w http.ResponseWriter, r *http.Request) {
	token, ok := auth.ChallengeCookie(w, r)
	if !ok {
		writeError(w, http.StatusBadRequest, "no signup in progress")
		return
	}

	nickname := r.URL.Query().Get("nickname")
	result, err := h.Auth.FinishSignup(r.Context(), token, r, nickname)
	if err != nil {
		h.Logger.Warn("finish signup", "error", err)
		writeError(w, http.StatusBadRequest, "signup failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"username":       result.User.Username,
		"recovery_codes": result.RecoveryCodes,
		"confirm_token":  result.ConfirmToken,
	})
}

type signupConfirmRequest struct {
	ConfirmToken string `json:"confirm_token"`
}

func (h *Handler) handleSignupConfirm(w http.ResponseWriter, r *http.Request) {
	var body signupConfirmRequest
	if err := decodeJSON(r, &body); err != nil || body.ConfirmToken == "" {
		writeError(w, http.StatusBadRequest, "confirm_token is required")
		return
	}

	result, err := h.Auth.ConfirmSignup(r.Context(), body.ConfirmToken)
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not confirm signup; please sign up again")
		return
	}

	auth.SetSessionCookie(w, r, result.SessionID, time.Until(result.ExpiresAt))
	writeJSON(w, http.StatusOK, map[string]string{"redirect": "/home"})
}
