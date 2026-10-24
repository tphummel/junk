// Command server runs Daily Solitaire: one Go binary, one SQLite database.
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

	"daily-solitaire/internal/config"
	"daily-solitaire/internal/store"
	"daily-solitaire/internal/web"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

const shutdownTimeout = 10 * time.Second

func main() {
	healthcheck := flag.Bool("healthcheck", false, "check that a locally running server is healthy, then exit (used by the container HEALTHCHECK)")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println(version)
		return
	}
	cfg := config.Load()
	if *healthcheck {
		os.Exit(runHealthcheck(cfg.Port))
	}

	logger := newLogger(cfg.LogLevel)
	logger.Info("starting daily-solitaire",
		"version", version, "port", cfg.Port, "metrics_port", cfg.MetricsPort,
		"database_path", cfg.DatabasePath, "rp_id", cfg.RPID, "origins", cfg.RPOrigins, "signups", cfg.Signups)

	st, err := store.Open(cfg.DatabasePath)
	if err != nil {
		logger.Error("open database", "error", err)
		os.Exit(1)
	}
	defer st.Close()

	if total, unused, err := st.SeedPoolStats(context.Background()); err == nil {
		logger.Info("seed pool", "total", total, "unused", unused)
		if unused == 0 {
			logger.Warn("seed pool is empty: daily deals will not be proven winnable; load seeds with `admin load-seeds`")
		}
	}

	srv, err := web.New(cfg, st, logger)
	if err != nil {
		logger.Error("configure server", "error", err)
		os.Exit(1)
	}
	srv.Metrics().AddGauge("dailysolitaire_seed_pool_unused", "Unused proven-winnable seeds left in the pool.", func() float64 {
		_, unused, _ := st.SeedPoolStats(context.Background())
		return float64(unused)
	})

	main := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	// Metrics get their own listener so scraping can never block gameplay.
	mux := http.NewServeMux()
	mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		srv.Metrics().Write(w)
	})
	metrics := &http.Server{Addr: fmt.Sprintf(":%d", cfg.MetricsPort), Handler: mux, ReadHeaderTimeout: 5 * time.Second}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go maintenance(ctx, st, logger)
	go serve(logger, "http", main)
	go serve(logger, "metrics", metrics)

	<-ctx.Done()
	logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	_ = metrics.Shutdown(shutdownCtx)
	if err := main.Shutdown(shutdownCtx); err != nil {
		logger.Error("http shutdown", "error", err)
	}
	logger.Info("shutdown complete")
}

func serve(logger *slog.Logger, name string, s *http.Server) {
	logger.Info("listening", "server", name, "addr", s.Addr)
	if err := s.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("server failed", "server", name, "error", err)
		os.Exit(1)
	}
}

// maintenance closes games past their 3 a.m. deadline and prunes expired
// sessions and ceremonies. Pages also expire games lazily, so this just keeps
// boards and stats current without anyone visiting.
func maintenance(ctx context.Context, st *store.Store, logger *slog.Logger) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		if n, err := st.ExpireGames(ctx); err != nil {
			logger.Warn("expire games", "error", err)
		} else if n > 0 {
			logger.Info("closed games past their deadline", "count", n)
		}
		if err := st.PruneExpired(ctx); err != nil {
			logger.Warn("prune expired", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// runHealthcheck hits /healthz and returns an exit code, so the container
// HEALTHCHECK needs neither curl nor a shell.
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
