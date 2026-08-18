package handlers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"trail-check/internal/auth"
	"trail-check/internal/db"
)

type passkeysPageData struct {
	basePage
	Passkeys []*db.Passkey
}

func (h *Handler) loadPasskeysPageData(c *gin.Context) (passkeysPageData, error) {
	pks, err := h.DB.ListPasskeysByUser(c.Request.Context(), auth.UserID(c))
	return passkeysPageData{basePage: basePage{Authenticated: true}, Passkeys: pks}, err
}

func (h *Handler) handlePasskeysList(c *gin.Context) {
	data, err := h.loadPasskeysPageData(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.tmpl.render(c, http.StatusOK, "passkeys.html", data)
}

type addPasskeyBeginRequest struct {
	Label string `json:"label"`
}

func (h *Handler) handlePasskeyAddBegin(c *gin.Context) {
	var body addPasskeyBeginRequest
	_ = c.ShouldBindJSON(&body)

	creation, token, err := h.Auth.BeginAddPasskey(c.Request.Context(), auth.UserID(c), body.Label)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	auth.SetChallengeCookie(c, token)
	c.JSON(http.StatusOK, creation)
}

func (h *Handler) handlePasskeyAddFinish(c *gin.Context) {
	token, ok := auth.ChallengeCookie(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no passkey registration in progress"})
		return
	}
	if _, _, err := h.Auth.FinishRegistration(c.Request.Context(), token, c.Request, deviceLabel(c)); err != nil {
		h.Logger.Warn().Err(err).Msg("finish add passkey")
		c.JSON(http.StatusBadRequest, gin.H{"error": "could not add passkey"})
		return
	}

	data, err := h.loadPasskeysPageData(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.tmpl.renderPartial(c, http.StatusOK, "passkey_list", data)
}

type patchPasskeyRequest struct {
	Status string `json:"status"`
}

func (h *Handler) handlePasskeyPatch(c *gin.Context) {
	var body patchPasskeyRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status is required"})
		return
	}
	status := db.PasskeyStatus(body.Status)
	if status != db.PasskeyActive && status != db.PasskeySuspended {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status must be 'active' or 'suspended'"})
		return
	}

	userID := auth.UserID(c)
	if status == db.PasskeySuspended {
		if n, err := h.DB.CountActivePasskeys(c.Request.Context(), userID); err == nil && n <= 1 {
			c.JSON(http.StatusConflict, gin.H{"error": "cannot suspend your only active passkey"})
			return
		}
	}

	err := h.DB.SetPasskeyStatus(c.Request.Context(), c.Param("id"), userID, status)
	if errors.Is(err, db.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "passkey not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	data, err := h.loadPasskeysPageData(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.tmpl.renderPartial(c, http.StatusOK, "passkey_list", data)
}

func (h *Handler) handlePasskeyDelete(c *gin.Context) {
	userID := auth.UserID(c)
	if n, err := h.DB.CountActivePasskeys(c.Request.Context(), userID); err == nil && n <= 1 {
		c.JSON(http.StatusConflict, gin.H{"error": "cannot delete your only active passkey"})
		return
	}

	err := h.DB.DeletePasskey(c.Request.Context(), c.Param("id"), userID)
	if errors.Is(err, db.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "passkey not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	data, err := h.loadPasskeysPageData(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.tmpl.renderPartial(c, http.StatusOK, "passkey_list", data)
}

func (h *Handler) handleSessionsList(c *gin.Context) {
	sessions, err := h.DB.ListSessionsByUser(c.Request.Context(), auth.UserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, sessions)
}

func (h *Handler) handleSessionRevoke(c *gin.Context) {
	err := h.DB.RevokeSession(c.Request.Context(), c.Param("id"), auth.UserID(c))
	if errors.Is(err, db.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}
