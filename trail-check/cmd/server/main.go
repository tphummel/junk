// Command server runs the Trail Check HTTP service: the Gin/Turbo/Leaflet
// app, the SpatiaLite-backed GPX validation worker, the public tile cache,
// and a separate metrics server.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/zerolog"

	"trail-check/internal/auth"
	"trail-check/internal/config"
	"trail-check/internal/db"
	"trail-check/internal/handlers"
	"trail-check/internal/metrics"
	"trail-check/internal/tiles"
	"trail-check/internal/worker"
)

// shutdownTimeout bounds how long graceful shutdown waits for in-flight
// requests and queued run validations to finish before forcing an exit.
const shutdownTimeout = 10 * time.Second

func main() {
	healthcheck := flag.Bool("healthcheck", false, "check that a locally running server is healthy, then exit (used by the container HEALTHCHECK)")
	flag.Parse()

	cfg := config.Load()

	if *healthcheck {
		os.Exit(runHealthcheck(cfg.Port))
	}

	logger := newLogger(cfg.LogLevel)
	logger.Info().
		Int("port", cfg.Port).
		Int("metrics_port", cfg.MetricsPort).
		Str("database_path", cfg.DatabasePath).
		Str("tile_cache_root", cfg.TileCacheRoot).
		Msg("starting trail-check")

	database, err := db.Open(cfg.DatabasePath, cfg.SpatialiteLib)
	if err != nil {
		logger.Fatal().Err(err).Msg("open database")
	}
	defer database.Close()

	authSvc, err := auth.New(database, auth.Config{
		RPID:              cfg.RPID,
		RPDisplayName:     cfg.RPDisplayName,
		RPOrigins:         cfg.RPOrigins,
		SessionTTL:        time.Duration(cfg.SessionTTLDays) * 24 * time.Hour,
		JWTPrivateKeyPEM:  cfg.JWTPrivateKeyPEM,
		JWTPrivateKeyFile: cfg.JWTPrivateKeyFile,
	}, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("configure auth service")
	}

	m := metrics.New()

	w := worker.New(database, m, logger, cfg.MatchBufferMeters, cfg.ProjectedSRID)
	workerCtx, cancelWorker := context.WithCancel(context.Background())
	workerDone := make(chan struct{})
	go func() {
		w.Run(workerCtx)
		close(workerDone)
	}()

	tileCache := tiles.New(cfg.TileCacheRoot, cfg.TileUpstream, "trail-check/1.0 (+https://github.com/)", m, logger)

	h := handlers.New(database, authSvc, w, tileCache, m, logger, handlers.Config{
		SessionTTL:        time.Duration(cfg.SessionTTLDays) * 24 * time.Hour,
		MatchBufferMeters: cfg.MatchBufferMeters,
		ProjectedSRID:     cfg.ProjectedSRID,
	})

	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(ginLogger(logger), gin.Recovery())
	h.RegisterRoutes(router)

	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
	}

	metricsMux := http.NewServeMux()
	metricsMux.Handle("/metrics", promhttp.Handler())
	metricsServer := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.MetricsPort),
		Handler:      metricsMux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	go func() {
		logger.Info().Int("port", cfg.Port).Msg("http server listening")
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error().Err(err).Msg("http server failed")
		}
	}()
	go func() {
		logger.Info().Int("port", cfg.MetricsPort).Msg("metrics server listening")
		if err := metricsServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error().Err(err).Msg("metrics server failed")
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	logger.Info().Msg("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	// Stop accepting new HTTP requests first so no new runs get enqueued,
	// then let the worker drain whatever's already queued within the same
	// deadline, then close the database.
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error().Err(err).Msg("http server shutdown")
	}
	if err := metricsServer.Shutdown(shutdownCtx); err != nil {
		logger.Error().Err(err).Msg("metrics server shutdown")
	}

	w.Close() // stop accepting new work; the running loop will drain what's left and return
	select {
	case <-workerDone:
		logger.Info().Msg("worker queue drained")
	case <-shutdownCtx.Done():
		logger.Warn().Msg("shutdown timed out before worker queue drained")
	}
	cancelWorker()

	logger.Info().Msg("shutdown complete")
}

// runHealthcheck hits the local /healthz endpoint and returns a process exit
// code, so it can back the container's HEALTHCHECK without needing curl or
// wget installed in the runtime image.
func runHealthcheck(port int) int {
	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/healthz", port))
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck failed:", err)
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "healthcheck failed: status", resp.StatusCode)
		return 1
	}
	return 0
}

func newLogger(level string) zerolog.Logger {
	l, err := zerolog.ParseLevel(level)
	if err != nil {
		l = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(l)
	return zerolog.New(os.Stdout).With().Timestamp().Logger()
}

func ginLogger(logger zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		c.Next()
		logger.Info().
			Str("method", c.Request.Method).
			Str("path", path).
			Int("status", c.Writer.Status()).
			Dur("duration", time.Since(start)).
			Msg("request")
	}
}
