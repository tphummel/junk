// Package tiles implements the public, unauthenticated on-demand OSM raster
// tile cache described in the design doc: serve from the filesystem cache
// when present, otherwise fetch from upstream, cache atomically, and serve.
package tiles

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"
	"golang.org/x/sync/singleflight"

	"trail-check/internal/metrics"
)

// maxZoom mirrors the sample frontend's Leaflet maxZoom and bounds how deep
// callers can make us recurse into the cache directory tree.
const maxZoom = 19

// Cache serves OSM raster tiles from an on-disk cache, populating it from
// upstream on a miss.
type Cache struct {
	root      string
	upstream  string
	userAgent string
	client    *http.Client
	metrics   *metrics.Metrics
	logger    zerolog.Logger
	group     singleflight.Group
}

// New creates a tile cache rooted at root, fetching misses from upstream
// (e.g. "https://tile.openstreetmap.org").
func New(root, upstream, userAgent string, m *metrics.Metrics, logger zerolog.Logger) *Cache {
	return &Cache{
		root:      root,
		upstream:  upstream,
		userAgent: userAgent,
		client:    &http.Client{Timeout: 15 * time.Second},
		metrics:   m,
		logger:    logger,
	}
}

func (c *Cache) tilePath(z, x, y int) string {
	return filepath.Join(c.root, strconv.Itoa(z), strconv.Itoa(x), strconv.Itoa(y)+".png")
}

// Handler serves GET /tiles/:z/:x/:y.png.
func (c *Cache) Handler() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		z, x, y, ok := parseTileParams(ctx)
		if !ok {
			ctx.AbortWithStatus(http.StatusBadRequest)
			return
		}

		path := c.tilePath(z, x, y)
		if data, err := os.ReadFile(path); err == nil {
			c.metrics.TileCacheHits.Inc()
			ctx.Data(http.StatusOK, "image/png", data)
			return
		} else if !errors.Is(err, os.ErrNotExist) {
			c.logger.Error().Err(err).Str("path", path).Msg("read cached tile")
			ctx.AbortWithStatus(http.StatusInternalServerError)
			return
		}

		c.metrics.TileCacheMisses.Inc()
		data, err := c.fetchAndCache(ctx, z, x, y)
		if err != nil {
			c.logger.Warn().Err(err).Int("z", z).Int("x", x).Int("y", y).Msg("fetch upstream tile")
			ctx.AbortWithStatus(http.StatusBadGateway)
			return
		}
		ctx.Data(http.StatusOK, "image/png", data)
	}
}

// fetchAndCache fetches a tile from upstream and writes it to the cache,
// coalescing concurrent requests for the same tile into a single upstream
// fetch.
func (c *Cache) fetchAndCache(ctx *gin.Context, z, x, y int) ([]byte, error) {
	key := fmt.Sprintf("%d/%d/%d", z, x, y)
	v, err, _ := c.group.Do(key, func() (any, error) {
		url := fmt.Sprintf("%s/%d/%d/%d.png", c.upstream, z, x, y)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", c.userAgent)

		resp, err := c.client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("upstream returned %s", resp.Status)
		}
		data, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, err
		}

		if err := c.writeAtomic(z, x, y, data); err != nil {
			// Serve the tile anyway; a cache write failure shouldn't fail the request.
			c.logger.Error().Err(err).Msg("write tile to cache")
		}
		return data, nil
	})
	if err != nil {
		return nil, err
	}
	return v.([]byte), nil
}

func (c *Cache) writeAtomic(z, x, y int, data []byte) error {
	dir := filepath.Join(c.root, strconv.Itoa(z), strconv.Itoa(x))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+strconv.Itoa(y)+".png.*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}
	return os.Rename(tmpPath, filepath.Join(dir, strconv.Itoa(y)+".png"))
}

func parseTileParams(ctx *gin.Context) (z, x, y int, ok bool) {
	yParam := ctx.Param("y")
	yStr, found := trimSuffix(yParam, ".png")
	if !found {
		return 0, 0, 0, false
	}

	var err error
	if z, err = strconv.Atoi(ctx.Param("z")); err != nil || z < 0 || z > maxZoom {
		return 0, 0, 0, false
	}
	if x, err = strconv.Atoi(ctx.Param("x")); err != nil || x < 0 {
		return 0, 0, 0, false
	}
	if y, err = strconv.Atoi(yStr); err != nil || y < 0 {
		return 0, 0, 0, false
	}
	return z, x, y, true
}

func trimSuffix(s, suffix string) (string, bool) {
	if len(s) <= len(suffix) || s[len(s)-len(suffix):] != suffix {
		return "", false
	}
	return s[:len(s)-len(suffix)], true
}
