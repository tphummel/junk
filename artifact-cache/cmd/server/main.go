package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"artifact-cache/internal/cache"
	"artifact-cache/internal/config"
	"artifact-cache/internal/db"
	"artifact-cache/internal/fetcher"
	"artifact-cache/internal/handlers"
	"artifact-cache/internal/metrics"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
	// Load configuration
	cfg := config.Load()

	// Set up structured logging
	logLevel := parseLogLevel(cfg.LogLevel)
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: logLevel,
	}))
	slog.SetDefault(logger)

	slog.Info("starting artifact cache service",
		"version", "1.0.0",
		"port", cfg.Port,
		"metrics_port", cfg.MetricsPort,
		"storage_path", cfg.StoragePath,
		"database_path", cfg.DatabasePath,
	)

	// Initialize database
	database, err := db.NewDB(cfg.DatabasePath)
	if err != nil {
		slog.Error("failed to initialize database", "error", err)
		os.Exit(1)
	}
	defer database.Close()
	slog.Info("database initialized", "path", cfg.DatabasePath)

	// Initialize storage
	storage := cache.NewStorage(cfg.StoragePath)
	slog.Info("storage initialized", "path", cfg.StoragePath)

	// Initialize fetcher
	timeout := time.Duration(cfg.UpstreamTimeout) * time.Second
	fetch := fetcher.NewFetcher(timeout, cfg.UserAgent)
	slog.Info("fetcher initialized", "timeout", timeout, "user_agent", cfg.UserAgent)

	// Initialize cache
	cacheEngine := cache.NewCache(database, storage, fetch)
	slog.Info("cache engine initialized")

	// Initialize metrics
	metricsCollector := metrics.NewMetrics()
	slog.Info("metrics initialized")

	// Initialize handlers
	handler := handlers.NewHandler(cacheEngine, database, metricsCollector)

	// Set up HTTP server
	mux := http.NewServeMux()
	mux.HandleFunc("/fetch", handler.FetchHandler)
	mux.HandleFunc("/health", handler.HealthHandler)

	server := &http.Server{
		Addr:         fmt.Sprintf("0.0.0.0:%d", cfg.Port),
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: time.Duration(cfg.UpstreamTimeout+30) * time.Second,
	}

	// Set up metrics server
	metricsMux := http.NewServeMux()
	metricsMux.Handle("/metrics", promhttp.Handler())

	metricsServer := &http.Server{
		Addr:         fmt.Sprintf("0.0.0.0:%d", cfg.MetricsPort),
		Handler:      metricsMux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	// Start metrics server in background
	go func() {
		slog.Info("metrics server starting", "port", cfg.MetricsPort)
		if err := metricsServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("metrics server failed", "error", err)
		}
	}()

	// Start main server in background
	go func() {
		slog.Info("main server starting", "port", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("main server failed", "error", err)
		}
	}()

	// Wait for interrupt signal for graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down servers gracefully")

	// Create shutdown context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Shutdown both servers
	if err := server.Shutdown(ctx); err != nil {
		slog.Error("main server shutdown error", "error", err)
	}

	if err := metricsServer.Shutdown(ctx); err != nil {
		slog.Error("metrics server shutdown error", "error", err)
	}

	slog.Info("servers stopped")
}

func parseLogLevel(level string) slog.Level {
	switch level {
	case "debug":
		return slog.LevelDebug
	case "info":
		return slog.LevelInfo
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
