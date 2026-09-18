// Package handlers implements the service's HTTP handlers.
package handlers

import (
	"net/http"
	"time"

	"github.com/rs/zerolog"

	"png-generation-service/internal/cache"
	"png-generation-service/internal/imagegen"
	"png-generation-service/internal/metrics"
)

// Handlers holds the dependencies shared by the HTTP handlers.
type Handlers struct {
	Cache       *cache.Cache
	Log         zerolog.Logger
	SeedMaxLen  int
	ImageWidth  int
	ImageHeight int
}

// Image serves GET /image?seed=<text>, returning a PNG from the disk cache
// when available and generating (and caching) one otherwise.
//
// An empty seed means "true randomness" per the design doc: it is never
// read from or written to the cache, since caching a single response under
// the fixed empty-seed key would make every subsequent empty-seed request
// deterministically return that one cached image.
func (h *Handlers) Image(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	metrics.HTTPRequestsTotal.WithLabelValues("image").Inc()

	seed := r.URL.Query().Get("seed")

	if len(seed) > h.SeedMaxLen {
		http.Error(w, "seed exceeds maximum length", http.StatusBadRequest)
		h.Log.Error().
			Str("handler", "image").
			Int("status", http.StatusBadRequest).
			Int64("duration_ms", time.Since(start).Milliseconds()).
			Str("error", "seed exceeds SEED_MAX_LEN").
			Msg("request failed")
		return
	}

	var data []byte
	var err error
	cacheable := seed != ""
	cacheHit := false

	if cacheable {
		if cached, ok := h.Cache.Get(cache.Key(seed)); ok {
			data = cached
			cacheHit = true
			metrics.CacheHitsTotal.Inc()
		}
	}

	if data == nil {
		metrics.CacheMissesTotal.Inc()

		genStart := time.Now()
		data, err = imagegen.Generate(seed, h.ImageWidth, h.ImageHeight)
		metrics.GenerationSeconds.Observe(time.Since(genStart).Seconds())

		if err != nil {
			http.Error(w, "failed to generate image", http.StatusInternalServerError)
			h.Log.Error().
				Str("handler", "image").
				Str("seed", seed).
				Int("status", http.StatusInternalServerError).
				Int64("duration_ms", time.Since(start).Milliseconds()).
				Err(err).
				Msg("request failed")
			return
		}

		if cacheable {
			if err := h.Cache.Put(cache.Key(seed), data); err != nil {
				// Serve the generated image anyway; caching is best-effort.
				h.Log.Error().
					Str("handler", "image").
					Str("seed", seed).
					Err(err).
					Msg("failed to write cache entry")
			} else {
				files, bytesTotal := h.Cache.Stats()
				metrics.CacheFilesTotal.Set(float64(files))
				metrics.CacheBytesTotal.Set(float64(bytesTotal))
			}
		}
	}

	w.Header().Set("Content-Type", "image/png")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)

	h.Log.Info().
		Str("handler", "image").
		Str("seed", seed).
		Bool("cache_hit", cacheHit).
		Int("status", http.StatusOK).
		Int64("duration_ms", time.Since(start).Milliseconds()).
		Msg("request completed")
}

// Healthz serves GET /healthz, returning 200 with an empty body. It has no
// side effects: it never touches the cache or image generation.
func (h *Handlers) Healthz(w http.ResponseWriter, r *http.Request) {
	metrics.HTTPRequestsTotal.WithLabelValues("healthz").Inc()
	w.WriteHeader(http.StatusOK)
}
