// Command server runs the app-passkey HTTP service: passkey (WebAuthn)
// signup and login, offline recovery codes, and the security dashboard.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"app-passkey/internal/auth"
	"app-passkey/internal/config"
	"app-passkey/internal/db"
	"app-passkey/internal/handlers"
)

// sessionTTL is how long an issued session cookie stays valid.
const sessionTTL = 30 * 24 * time.Hour

// shutdownTimeout bounds how long graceful shutdown waits for in-flight
// requests before forcing an exit.
const shutdownTimeout = 10 * time.Second

func main() {
	healthcheck := flag.Bool("healthcheck", false, "check that a locally running server is healthy, then exit (used by the container HEALTHCHECK)")
	flag.Parse()

	cfg := config.Load()

	if *healthcheck {
		os.Exit(runHealthcheck(cfg.Port))
	}

	logger := newLogger(cfg.LogLevel)
	logger.Info("starting app-passkey",
		"port", cfg.Port,
		"database_path", cfg.DatabasePath,
		"rp_id", cfg.RPID,
	)

	database, err := db.Open(cfg.DatabasePath)
	if err != nil {
		logger.Error("open database", "error", err)
		os.Exit(1)
	}
	defer database.Close()

	authSvc, err := auth.New(database, auth.Config{
		RPID:          cfg.RPID,
		RPDisplayName: cfg.RPDisplayName,
		RPOrigins:     cfg.RPOrigins,
		SessionTTL:    sessionTTL,
		SessionSecret: cfg.SessionSecret,
	}, logger)
	if err != nil {
		logger.Error("configure auth service", "error", err)
		os.Exit(1)
	}

	h := handlers.New(authSvc, logger)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      requestLogger(logger, mux),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	go pruneExpiredChallenges(database, logger)

	go func() {
		logger.Info("http server listening", "port", cfg.Port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("http server failed", "error", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	logger.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("http server shutdown", "error", err)
	}
	logger.Info("shutdown complete")
}

// pruneExpiredChallenges periodically clears out abandoned WebAuthn
// ceremonies so the challenges table doesn't grow unbounded.
func pruneExpiredChallenges(database *db.DB, logger *slog.Logger) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		if err := database.PruneExpiredChallenges(context.Background()); err != nil {
			logger.Warn("prune expired challenges", "error", err)
		}
	}
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

func newLogger(level string) *slog.Logger {
	var lvl slog.Level
	if err := lvl.UnmarshalText([]byte(level)); err != nil {
		lvl = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lvl}))
}

func requestLogger(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		logger.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", sw.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (sw *statusWriter) WriteHeader(status int) {
	sw.status = status
	sw.ResponseWriter.WriteHeader(status)
}
