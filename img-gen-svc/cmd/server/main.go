// Command server runs the dynamic PNG generation service.
package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/zerolog"

	"img-gen-svc/internal/cache"
	"img-gen-svc/internal/config"
	"img-gen-svc/internal/handlers"
	"img-gen-svc/internal/metrics"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	logger := newLogger(cfg.LogLevel)

	diskCache, err := cache.New(cfg.CacheDir)
	if err != nil {
		return fmt.Errorf("init cache: %w", err)
	}

	files, bytesTotal := diskCache.Stats()
	metrics.CacheFilesTotal.Set(float64(files))
	metrics.CacheBytesTotal.Set(float64(bytesTotal))

	h := &handlers.Handlers{
		Cache:       diskCache,
		Log:         logger,
		SeedMaxLen:  cfg.SeedMaxLen,
		ImageWidth:  cfg.ImageWidth,
		ImageHeight: cfg.ImageHeight,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /image", h.Image)
	mux.HandleFunc("GET "+cfg.HealthPath, h.Healthz)
	mux.Handle("GET "+cfg.MetricsPath, promhttp.Handler())

	addr := fmt.Sprintf(":%d", cfg.Port)
	logger.Info().
		Str("addr", addr).
		Str("cache_dir", cfg.CacheDir).
		Int("cache_files", files).
		Msg("starting server")

	return http.ListenAndServe(addr, mux)
}

func newLogger(level string) zerolog.Logger {
	lvl, err := zerolog.ParseLevel(level)
	if err != nil {
		lvl = zerolog.InfoLevel
	}
	return zerolog.New(os.Stdout).Level(lvl).With().Timestamp().Logger()
}
