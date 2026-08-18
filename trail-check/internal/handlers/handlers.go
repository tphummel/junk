// Package handlers wires HTTP routes to the auth, db, worker and tiles
// packages, and renders the Turbo/Leaflet frontend.
package handlers

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"

	"trail-check/internal/auth"
	"trail-check/internal/db"
	"trail-check/internal/metrics"
	"trail-check/internal/tiles"
	"trail-check/internal/worker"
)

// Config carries the small bits of runtime config handlers need directly
// (everything else lives behind the auth/db/worker services).
type Config struct {
	SessionTTL        time.Duration
	MatchBufferMeters float64
	ProjectedSRID     int
}

// Handler holds every dependency the HTTP layer needs.
type Handler struct {
	DB      *db.DB
	Auth    *auth.Service
	Worker  *worker.Worker
	Tiles   *tiles.Cache
	Metrics *metrics.Metrics
	Logger  zerolog.Logger
	Cfg     Config
	tmpl    *templates
}

// New builds the handler set and loads templates.
func New(database *db.DB, authSvc *auth.Service, w *worker.Worker, tileCache *tiles.Cache, m *metrics.Metrics, logger zerolog.Logger, cfg Config) *Handler {
	return &Handler{
		DB:      database,
		Auth:    authSvc,
		Worker:  w,
		Tiles:   tileCache,
		Metrics: m,
		Logger:  logger,
		Cfg:     cfg,
		tmpl:    loadTemplates(),
	}
}

// RegisterRoutes mounts every route on the given engine.
func (h *Handler) RegisterRoutes(r *gin.Engine) {
	r.StaticFS("/static", staticFS())

	r.GET("/healthz", h.handleHealthz)
	r.GET("/tiles/:z/:x/:y", h.Tiles.Handler())

	r.GET("/", h.handleIndex)

	authGroup := r.Group("/auth")
	{
		authGroup.GET("/register", h.handleRegisterPage)
		authGroup.POST("/register/begin", h.handleRegisterBegin)
		authGroup.POST("/register/finish", h.handleRegisterFinish)
		authGroup.GET("/login", h.handleLoginPage)
		authGroup.POST("/login/begin", h.handleLoginBegin)
		authGroup.POST("/login/finish", h.handleLoginFinish)
		authGroup.POST("/logout", h.handleLogout)
	}

	catalog := r.Group("/catalog")
	catalog.Use(h.Auth.RequireAuth())
	{
		catalog.GET("", h.handleCatalogList)
		catalog.POST("", h.handleCatalogCreate)
		catalog.GET("/:slug", h.handleCatalogGet)
		catalog.POST("/:slug/track", h.handleCatalogTrack)
	}

	me := r.Group("/me")
	me.Use(h.Auth.RequireAuth())
	{
		me.GET("/passkeys", h.handlePasskeysList)
		me.POST("/passkeys/begin", h.handlePasskeyAddBegin)
		me.POST("/passkeys/finish", h.handlePasskeyAddFinish)
		me.PATCH("/passkeys/:id", h.handlePasskeyPatch)
		me.DELETE("/passkeys/:id", h.handlePasskeyDelete)
		me.GET("/sessions", h.handleSessionsList)
		me.DELETE("/sessions/:id", h.handleSessionRevoke)
		me.GET("/export", h.handleExport)
		me.DELETE("", h.handleDeleteAccount)
	}

	dashboard := r.Group("/dashboard")
	dashboard.Use(h.Auth.RequireAuth())
	{
		dashboard.GET("", h.handleDashboard)
		dashboard.GET("/geo", h.handleDashboardGeo)
	}

	runs := r.Group("/runs")
	runs.Use(h.Auth.RequireAuth())
	{
		runs.POST("", h.handleRunUpload)
		runs.GET("/:id/status", h.handleRunStatus)
	}
}
