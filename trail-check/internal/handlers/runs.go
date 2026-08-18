package handlers

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"trail-check/internal/auth"
	"trail-check/internal/db"
	"trail-check/internal/geo"
	trailgpx "trail-check/internal/gpx"
)

func (h *Handler) handleRunUpload(c *gin.Context) {
	ctx := c.Request.Context()
	userID := auth.UserID(c)

	userTrailID := c.PostForm("user_trail_id")
	ut, err := h.DB.GetUserTrail(ctx, userTrailID, userID)
	if errors.Is(err, db.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "trail not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a GPX file is required"})
		return
	}
	data, err := readMultipartFile(fileHeader)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	runs, err := trailgpx.Parse(data)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	wkt, err := geo.MultiLineStringWKT(runs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	run, err := h.DB.CreateRun(ctx, ut.ID, c.PostForm("name"), wkt, h.Cfg.ProjectedSRID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.Metrics.GPXUploadsTotal.Inc()
	h.Worker.Enqueue(run.ID)

	if strings.Contains(c.GetHeader("Accept"), "turbo-stream") {
		remaining, err := h.DB.ListRunsByUserTrail(ctx, ut.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		h.tmpl.renderStream(c, "run_list_stream", remaining)
		return
	}
	c.Redirect(http.StatusFound, "/dashboard?user_trail_id="+ut.ID)
}

func (h *Handler) handleRunStatus(c *gin.Context) {
	run, err := h.DB.GetRun(c.Request.Context(), c.Param("id"))
	if errors.Is(err, db.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "run not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Authorization: the run's parent user_trail must belong to the caller.
	ut, err := h.DB.GetUserTrail(c.Request.Context(), run.UserTrailID, auth.UserID(c))
	if errors.Is(err, db.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "run not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	_ = ut

	c.JSON(http.StatusOK, gin.H{
		"status":       run.Status,
		"coverage_pct": run.CoveragePct,
		"matched_len":  run.MatchedLen,
	})
}
