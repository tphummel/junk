package handlers

import (
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"

	"png-generation-service/internal/cache"
)

func newTestHandlers(t *testing.T) *Handlers {
	t.Helper()
	c, err := cache.New(t.TempDir())
	if err != nil {
		t.Fatalf("cache.New: %v", err)
	}
	return &Handlers{
		Cache:       c,
		Log:         zerolog.Nop(),
		SeedMaxLen:  256,
		ImageWidth:  16,
		ImageHeight: 16,
	}
}

func TestImageServesPNG(t *testing.T) {
	h := newTestHandlers(t)

	req := httptest.NewRequest(http.MethodGet, "/image?seed=foo", nil)
	rec := httptest.NewRecorder()
	h.Image(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Fatalf("Content-Type = %q, want image/png", ct)
	}
	if _, err := png.Decode(rec.Body); err != nil {
		t.Fatalf("response body is not a valid PNG: %v", err)
	}
}

func TestImageCachesOnSecondRequest(t *testing.T) {
	h := newTestHandlers(t)

	req := httptest.NewRequest(http.MethodGet, "/image?seed=bar", nil)
	rec1 := httptest.NewRecorder()
	h.Image(rec1, req)

	files, _ := h.Cache.Stats()
	if files != 1 {
		t.Fatalf("files after first request = %d, want 1", files)
	}

	rec2 := httptest.NewRecorder()
	h.Image(rec2, httptest.NewRequest(http.MethodGet, "/image?seed=bar", nil))

	if rec1.Body.String() != rec2.Body.String() {
		t.Fatal("cached response body differs from generated one")
	}
	files, _ = h.Cache.Stats()
	if files != 1 {
		t.Fatalf("files after second request = %d, want 1 (should hit cache, not write again)", files)
	}
}

func TestImageEmptySeedNotCached(t *testing.T) {
	h := newTestHandlers(t)

	h.Image(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/image", nil))
	h.Image(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/image", nil))

	files, _ := h.Cache.Stats()
	if files != 0 {
		t.Fatalf("files = %d, want 0 for empty-seed requests", files)
	}
}

func TestImageRejectsLongSeed(t *testing.T) {
	h := newTestHandlers(t)
	h.SeedMaxLen = 4

	req := httptest.NewRequest(http.MethodGet, "/image?seed="+strings.Repeat("a", 5), nil)
	rec := httptest.NewRecorder()
	h.Image(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestHealthz(t *testing.T) {
	h := newTestHandlers(t)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	h.Healthz(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("body = %q, want empty", rec.Body.String())
	}
}
