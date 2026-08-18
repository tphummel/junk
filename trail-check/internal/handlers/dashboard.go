package handlers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"trail-check/internal/auth"
	"trail-check/internal/db"
)

type dashboardPageData struct {
	basePage
	Trails   []*db.UserTrailWithCatalog
	Selected *db.UserTrailWithCatalog
	Runs     []*db.Run
	Coverage *db.CoverageResult
}

func (h *Handler) handleDashboard(c *gin.Context) {
	ctx := c.Request.Context()
	userID := auth.UserID(c)

	trails, err := h.DB.ListUserTrailsByUser(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var selected *db.UserTrailWithCatalog
	if id := c.Query("user_trail_id"); id != "" {
		for _, t := range trails {
			if t.UserTrail.ID == id {
				selected = t
				break
			}
		}
	} else if slug := c.Query("slug"); slug != "" {
		for _, t := range trails {
			if t.CatalogTrail.Slug == slug {
				selected = t
				break
			}
		}
	} else if len(trails) > 0 {
		selected = trails[0]
	}

	data := dashboardPageData{basePage: basePage{Authenticated: true}, Trails: trails, Selected: selected}
	if selected != nil {
		runs, err := h.DB.ListRunsByUserTrail(ctx, selected.UserTrail.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		coverage, err := h.DB.ComputeCoverage(ctx, selected.UserTrail.ID, "", h.Cfg.MatchBufferMeters, h.Cfg.ProjectedSRID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		data.Runs = runs
		data.Coverage = coverage
	}

	h.tmpl.render(c, http.StatusOK, "dashboard.html", data)
}

func (h *Handler) handleDashboardGeo(c *gin.Context) {
	ctx := c.Request.Context()
	userTrailID := c.Query("user_trail_id")

	ut, err := h.DB.GetUserTrail(ctx, userTrailID, auth.UserID(c))
	if errors.Is(err, db.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "trail not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	coverage, err := h.DB.ComputeCoverage(ctx, ut.ID, "", h.Cfg.MatchBufferMeters, h.Cfg.ProjectedSRID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"covered_geojson":   coverage.CoveredGeoJSON,
		"uncovered_geojson": coverage.UncoveredGeoJSON,
		"coverage_pct":      coverage.CoveragePct,
	})
}
