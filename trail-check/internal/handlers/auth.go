package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"trail-check/internal/auth"
)

func deviceLabel(c *gin.Context) string {
	ua := c.Request.UserAgent()
	if len(ua) > 120 {
		ua = ua[:120]
	}
	return ua
}

type basePage struct {
	Authenticated bool
}

func (h *Handler) handleIndex(c *gin.Context) {
	if _, err := c.Cookie(auth.SessionCookieName); err == nil {
		c.Redirect(http.StatusFound, "/dashboard")
		return
	}
	h.tmpl.render(c, http.StatusOK, "index.html", basePage{})
}

func (h *Handler) handleHealthz(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h *Handler) handleRegisterPage(c *gin.Context) {
	h.tmpl.render(c, http.StatusOK, "register.html", basePage{})
}

func (h *Handler) handleLoginPage(c *gin.Context) {
	h.tmpl.render(c, http.StatusOK, "login.html", basePage{})
}

type registerBeginRequest struct {
	Label string `json:"label"`
}

func (h *Handler) handleRegisterBegin(c *gin.Context) {
	var body registerBeginRequest
	_ = c.ShouldBindJSON(&body)

	creation, token, err := h.Auth.BeginBootstrapRegistration(c.Request.Context(), body.Label)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	auth.SetChallengeCookie(c, token)
	c.JSON(http.StatusOK, creation)
}

func (h *Handler) handleRegisterFinish(c *gin.Context) {
	token, ok := auth.ChallengeCookie(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no registration in progress"})
		return
	}

	_, login, err := h.Auth.FinishRegistration(c.Request.Context(), token, c.Request, deviceLabel(c))
	if err != nil {
		h.Logger.Warn().Err(err).Msg("finish registration")
		c.JSON(http.StatusBadRequest, gin.H{"error": "registration failed"})
		return
	}
	if login != nil {
		auth.SetSessionCookie(c, login.JWT, h.Cfg.SessionTTL)
	}
	c.JSON(http.StatusOK, gin.H{"redirect": "/dashboard"})
}

func (h *Handler) handleLoginBegin(c *gin.Context) {
	assertion, token, err := h.Auth.BeginLogin(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	auth.SetChallengeCookie(c, token)
	c.JSON(http.StatusOK, assertion)
}

func (h *Handler) handleLoginFinish(c *gin.Context) {
	token, ok := auth.ChallengeCookie(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no login in progress"})
		return
	}

	result, err := h.Auth.FinishLogin(c.Request.Context(), token, c.Request, deviceLabel(c))
	if err != nil {
		h.Metrics.LoginFailure.Inc()
		h.Logger.Warn().Err(err).Msg("finish login")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "login failed"})
		return
	}
	h.Metrics.LoginSuccess.Inc()
	auth.SetSessionCookie(c, result.JWT, h.Cfg.SessionTTL)
	c.JSON(http.StatusOK, gin.H{"redirect": "/dashboard"})
}

func (h *Handler) handleLogout(c *gin.Context) {
	if tok, err := c.Cookie(auth.SessionCookieName); err == nil && tok != "" {
		_ = h.Auth.Logout(c.Request.Context(), tok)
	}
	auth.ClearSessionCookie(c)
	c.Redirect(http.StatusFound, "/")
}
