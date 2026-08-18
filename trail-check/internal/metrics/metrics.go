// Package metrics defines the Prometheus counters exposed on /metrics.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Metrics holds every counter the service reports.
type Metrics struct {
	TileCacheHits   prometheus.Counter
	TileCacheMisses prometheus.Counter
	LoginSuccess    prometheus.Counter
	LoginFailure    prometheus.Counter
	RunsProcessed   *prometheus.CounterVec // labeled by outcome: processed, error
	GPXUploadsTotal prometheus.Counter
}

// New registers and returns the metrics using the default Prometheus registry.
func New() *Metrics {
	return NewWithRegistry(prometheus.DefaultRegisterer)
}

// NewWithRegistry registers metrics against a custom registry (used in tests
// to avoid "duplicate metrics collector registration" across test cases).
func NewWithRegistry(reg prometheus.Registerer) *Metrics {
	f := promauto.With(reg)
	return &Metrics{
		TileCacheHits: f.NewCounter(prometheus.CounterOpts{
			Name: "tiles_cache_hits_total",
			Help: "Total number of tile requests served from the on-disk cache.",
		}),
		TileCacheMisses: f.NewCounter(prometheus.CounterOpts{
			Name: "tiles_cache_misses_total",
			Help: "Total number of tile requests that required fetching from upstream OSM.",
		}),
		LoginSuccess: f.NewCounter(prometheus.CounterOpts{
			Name: "login_success_total",
			Help: "Total number of successful passkey logins.",
		}),
		LoginFailure: f.NewCounter(prometheus.CounterOpts{
			Name: "login_failure_total",
			Help: "Total number of failed passkey login attempts.",
		}),
		RunsProcessed: f.NewCounterVec(prometheus.CounterOpts{
			Name: "run_processed_total",
			Help: "Total number of uploaded runs processed by the validation worker.",
		}, []string{"outcome"}),
		GPXUploadsTotal: f.NewCounter(prometheus.CounterOpts{
			Name: "gpx_uploads_total",
			Help: "Total number of GPX files uploaded.",
		}),
	}
}
