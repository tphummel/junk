// Package worker runs the background GPX validation queue: a single
// goroutine consuming run IDs off a channel and running the SpatiaLite
// coverage calculation for each.
package worker

import (
	"context"

	"github.com/rs/zerolog"

	"trail-check/internal/db"
	"trail-check/internal/metrics"
)

// queueSize is generous for a low-traffic, single-user/small-team service;
// Enqueue blocks if it's ever exceeded rather than dropping a run.
const queueSize = 64

// Worker validates uploaded runs against their trail's reference geometry.
type Worker struct {
	db            *db.DB
	metrics       *metrics.Metrics
	logger        zerolog.Logger
	bufferMeters  float64
	projectedSRID int
	queue         chan string
}

// New creates a worker with its run queue. Call Run in a goroutine to start
// consuming it, and Enqueue (from any goroutine) to submit run IDs.
func New(database *db.DB, m *metrics.Metrics, logger zerolog.Logger, bufferMeters float64, projectedSRID int) *Worker {
	return &Worker{
		db:            database,
		metrics:       m,
		logger:        logger,
		bufferMeters:  bufferMeters,
		projectedSRID: projectedSRID,
		queue:         make(chan string, queueSize),
	}
}

// Enqueue submits a run for background validation.
func (w *Worker) Enqueue(runID string) {
	w.queue <- runID
}

// Close stops accepting new work. Call this before Run's context is
// canceled during shutdown so the run loop drains whatever is already
// queued instead of blocking forever on an empty channel.
func (w *Worker) Close() {
	close(w.queue)
}

// Run consumes the queue until it's closed and drained, or ctx is done.
// Pass a context with the graceful-shutdown deadline so a run stuck on a
// pathological geometry can't hang shutdown indefinitely.
func (w *Worker) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case runID, ok := <-w.queue:
			if !ok {
				return
			}
			w.process(ctx, runID)
		}
	}
}

func (w *Worker) process(ctx context.Context, runID string) {
	run, err := w.db.GetRun(ctx, runID)
	if err != nil {
		w.logger.Error().Err(err).Str("run_id", runID).Msg("load run for validation")
		w.metrics.RunsProcessed.WithLabelValues("error").Inc()
		return
	}

	if err := w.db.ProcessRun(ctx, runID, run.UserTrailID, w.bufferMeters, w.projectedSRID); err != nil {
		w.logger.Error().Err(err).Str("run_id", runID).Msg("process run")
		w.metrics.RunsProcessed.WithLabelValues("error").Inc()
		return
	}

	w.logger.Info().Str("run_id", runID).Msg("run processed")
	w.metrics.RunsProcessed.WithLabelValues("processed").Inc()
}
