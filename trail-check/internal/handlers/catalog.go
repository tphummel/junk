package handlers

import (
	"errors"
	"mime/multipart"
	"net/http"
	"regexp"

	"github.com/gin-gonic/gin"

	"trail-check/internal/auth"
	"trail-check/internal/db"
	"trail-check/internal/geo"
	trailgpx "trail-check/internal/gpx"
)

var slugPattern = regexp.MustCompile(`^[a-z0-9-]+$`)

type catalogPageData struct {
	basePage
	Trails       []*db.CatalogTrail
	TrackedSlugs map[string]bool
}

func (h *Handler) handleCatalogList(c *gin.Context) {
	ctx := c.Request.Context()
	trails, err := h.DB.ListCatalogTrails(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	tracked, err := h.DB.ListUserTrailsByUser(ctx, auth.UserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	trackedSlugs := make(map[string]bool, len(tracked))
	for _, ut := range tracked {
		trackedSlugs[ut.CatalogTrail.Slug] = true
	}

	h.tmpl.render(c, http.StatusOK, "catalog_list.html", catalogPageData{
		basePage:     basePage{Authenticated: true},
		Trails:       trails,
		TrackedSlugs: trackedSlugs,
	})
}

func (h *Handler) handleCatalogCreate(c *gin.Context) {
	name := c.PostForm("name")
	slug := c.PostForm("slug")
	if name == "" || !slugPattern.MatchString(slug) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required and slug must match [a-z0-9-]+"})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a GPX file is required"})
		return
	}
	wkt, err := parseGPXFileToWKT(fileHeader)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if _, err := h.DB.CreateCatalogTrail(c.Request.Context(), name, slug, wkt, h.Cfg.ProjectedSRID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Redirect(http.StatusFound, "/catalog")
}

func (h *Handler) handleCatalogGet(c *gin.Context) {
	ct, err := h.DB.GetCatalogTrailBySlug(c.Request.Context(), c.Param("slug"))
	if errors.Is(err, db.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "trail not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	geojson, err := h.DB.GetCatalogTrailGeoJSON(c.Request.Context(), ct.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id":       ct.ID,
		"name":     ct.Name,
		"slug":     ct.Slug,
		"length_m": ct.LengthM,
		"geojson":  geojson,
	})
}

func (h *Handler) handleCatalogTrack(c *gin.Context) {
	ct, err := h.DB.GetCatalogTrailBySlug(c.Request.Context(), c.Param("slug"))
	if errors.Is(err, db.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "trail not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	ut, err := h.DB.CreateUserTrail(c.Request.Context(), auth.UserID(c), ct.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Redirect(http.StatusFound, "/dashboard?user_trail_id="+ut.ID)
}

// parseGPXFileToWKT reads an uploaded GPX file and builds a WKT
// MULTILINESTRING from its track segments.
func parseGPXFileToWKT(fh *multipart.FileHeader) (string, error) {
	data, err := readMultipartFile(fh)
	if err != nil {
		return "", err
	}
	runs, err := trailgpx.Parse(data)
	if err != nil {
		return "", err
	}
	return geo.MultiLineStringWKT(runs)
}
