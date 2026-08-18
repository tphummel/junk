package tiles

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/rs/zerolog"

	"trail-check/internal/metrics"
)

func newTestCache(t *testing.T, upstream *httptest.Server) (*Cache, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	m := metrics.NewWithRegistry(prometheus.NewRegistry())
	c := New(root, upstream.URL, "trail-check-test/1.0", m, zerolog.Nop())
	return c, root
}

func newTestRouter(c *Cache) *gin.Engine {
	r := gin.New()
	r.GET("/tiles/:z/:x/:y", c.Handler())
	return r
}

func TestTileCacheMissThenHit(t *testing.T) {
	fetches := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fetches++
		w.Header().Set("Content-Type", "image/png")
		w.Write([]byte("fake-png-bytes"))
	}))
	defer upstream.Close()

	c, root := newTestCache(t, upstream)
	router := newTestRouter(c)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/tiles/5/10/12.png", nil)
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != "fake-png-bytes" {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
	if fetches != 1 {
		t.Fatalf("expected 1 upstream fetch, got %d", fetches)
	}

	if _, err := os.Stat(filepath.Join(root, "5", "10", "12.png")); err != nil {
		t.Fatalf("expected tile to be cached on disk: %v", err)
	}

	// Second request should be served from disk without hitting upstream again.
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/tiles/5/10/12.png", nil))
	if rec2.Code != http.StatusOK || rec2.Body.String() != "fake-png-bytes" {
		t.Fatalf("unexpected second response: %d %s", rec2.Code, rec2.Body.String())
	}
	if fetches != 1 {
		t.Fatalf("expected cache hit to avoid a second upstream fetch, got %d fetches", fetches)
	}
}

func TestTileCacheRejectsInvalidParams(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("upstream should not be contacted for invalid params")
	}))
	defer upstream.Close()

	c, _ := newTestCache(t, upstream)
	router := newTestRouter(c)

	for _, path := range []string{
		"/tiles/5/10/../../../etc/passwd",
		"/tiles/-1/0/0.png",
		"/tiles/5/-1/0.png",
		"/tiles/5/0/abc.png",
		"/tiles/999/0/0.png",
	} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code == http.StatusOK {
			t.Fatalf("expected %s to be rejected, got 200", path)
		}
	}
}

func TestTileCacheUpstreamError(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer upstream.Close()

	c, _ := newTestCache(t, upstream)
	router := newTestRouter(c)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/tiles/1/1/1.png", nil))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", rec.Code)
	}
}
