package handlers

import (
	"errors"
	"net/http"

	"app-passkey/internal/auth"
	"app-passkey/internal/db"
)

type keyView struct {
	ID         string  `json:"id"`
	Nickname   string  `json:"nickname"`
	CreatedAt  string  `json:"created_at"`
	LastUsedAt *string `json:"last_used_at,omitempty"`
}

func toKeyView(c *db.Credential) keyView {
	kv := keyView{ID: c.ID, Nickname: c.Nickname, CreatedAt: c.CreatedAt.Format("2006-01-02T15:04:05Z")}
	if c.LastUsedAt != nil {
		s := c.LastUsedAt.Format("2006-01-02T15:04:05Z")
		kv.LastUsedAt = &s
	}
	return kv
}

func (h *Handler) handleKeysList(w http.ResponseWriter, r *http.Request) {
	keys, err := h.Auth.ListKeys(r.Context(), auth.UserID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list keys")
		return
	}
	views := make([]keyView, 0, len(keys))
	for _, k := range keys {
		views = append(views, toKeyView(k))
	}
	writeJSON(w, http.StatusOK, views)
}

type keysBeginRequest struct {
	Nickname string `json:"nickname"`
}

func (h *Handler) handleKeysBegin(w http.ResponseWriter, r *http.Request) {
	var body keysBeginRequest
	_ = decodeJSON(r, &body)

	creation, token, err := h.Auth.BeginAddKey(r.Context(), auth.UserID(r), body.Nickname)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not start add-key ceremony")
		return
	}
	auth.SetChallengeCookie(w, r, token)
	writeJSON(w, http.StatusOK, creation)
}

func (h *Handler) handleKeysFinish(w http.ResponseWriter, r *http.Request) {
	token, ok := auth.ChallengeCookie(w, r)
	if !ok {
		writeError(w, http.StatusBadRequest, "no add-key ceremony in progress")
		return
	}

	cred, err := h.Auth.FinishAddKey(r.Context(), auth.UserID(r), token, r)
	if err != nil {
		h.Logger.Warn("finish add key", "error", err)
		writeError(w, http.StatusBadRequest, "could not add key")
		return
	}
	writeJSON(w, http.StatusOK, toKeyView(cred))
}

type keysLabelRequest struct {
	Nickname string `json:"nickname"`
}

func (h *Handler) handleKeysLabel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var body keysLabelRequest
	if err := decodeJSON(r, &body); err != nil || body.Nickname == "" {
		writeError(w, http.StatusBadRequest, "nickname is required")
		return
	}

	if err := h.Auth.LabelKey(r.Context(), auth.UserID(r), id, body.Nickname); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "key not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not label key")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) handleKeysRevoke(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	if err := h.Auth.RevokeKey(r.Context(), auth.UserID(r), id); err != nil {
		switch {
		case errors.Is(err, db.ErrNotFound):
			writeError(w, http.StatusNotFound, "key not found")
		case errors.Is(err, auth.ErrLastCredential):
			writeError(w, http.StatusConflict, "cannot revoke your only passkey")
		default:
			writeError(w, http.StatusInternalServerError, "could not revoke key")
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
