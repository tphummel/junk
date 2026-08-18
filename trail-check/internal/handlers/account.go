package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"trail-check/internal/auth"
	"trail-check/internal/dataexport"
)

func (h *Handler) handleExport(c *gin.Context) {
	data, err := dataexport.Build(c.Request.Context(), h.DB, auth.UserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Header("Content-Disposition", `attachment; filename="trail-check-export.zip"`)
	c.Data(http.StatusOK, "application/zip", data)
}

func (h *Handler) handleDeleteAccount(c *gin.Context) {
	userID := auth.UserID(c)
	if err := h.DB.DeleteUser(c.Request.Context(), userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	auth.ClearSessionCookie(c)
	c.Status(http.StatusNoContent)
}
