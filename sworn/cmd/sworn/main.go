// Command sworn is a self-hosted personal check-in tracker with OSM-enriched shared venues.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"sworn/internal/config"
	"sworn/internal/store"
	"sworn/internal/web"
)

func main() {
	healthcheck := flag.Bool("healthcheck", false, "probe /health on the local server and exit")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "config:", err)
		os.Exit(1)
	}
	if *healthcheck {
		os.Exit(probe(cfg.Port))
	}

	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := os.MkdirAll(cfg.TilesDir(), 0o755); err != nil {
		log.Error("create data dir", "err", err)
		os.Exit(1)
	}
	st, err := store.Open(cfg.DBPath())
	if err != nil {
		log.Error("open database", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	srv, err := web.New(cfg, st, log)
	if err != nil {
		log.Error("init", "err", err)
		os.Exit(1)
	}
	httpSrv := &http.Server{
		Addr:              net.JoinHostPort(cfg.Bind, cfg.Port),
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	log.Info("sworn starting", "addr", httpSrv.Addr, "rp_id", cfg.RPID, "origins", cfg.RPOrigins,
		"osm_writes", cfg.OSMAPIKey != "", "data_dir", cfg.DataDir) // the key itself is never logged

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server", "err", err)
			stop()
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdown)
	log.Info("stopped")
}

func probe(port string) int {
	c := http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get("http://127.0.0.1:" + port + "/health")
	if err != nil || resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
