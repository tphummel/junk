// Package metrics defines the Prometheus metrics exposed by the service.
package metrics

import "github.com/prometheus/client_golang/prometheus"

var (
	// HTTPRequestsTotal counts requests per handler ("image", "healthz").
	HTTPRequestsTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "http_requests_total",
		Help: "Number of HTTP requests per endpoint.",
	}, []string{"handler"})

	// CacheHitsTotal counts PNGs served from the disk cache.
	CacheHitsTotal = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "cache_hits_total",
		Help: "Number of PNGs served from the disk cache.",
	})

	// CacheMissesTotal counts PNGs generated because they were not cached.
	CacheMissesTotal = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "cache_misses_total",
		Help: "Number of PNGs generated because they were not cached.",
	})

	// GenerationSeconds tracks image generation latency (cache misses only).
	GenerationSeconds = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name: "generation_seconds",
		Help: "Latency for image generation (only on cache miss).",
	})

	// CacheFilesTotal is the current number of cached PNG files.
	CacheFilesTotal = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "cache_files_total",
		Help: "Current number of cached PNG files.",
	})

	// CacheBytesTotal is the current total size, in bytes, of all cached PNG files.
	CacheBytesTotal = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "cache_bytes_total",
		Help: "Current total size (bytes) of all cached PNG files.",
	})
)

func init() {
	prometheus.MustRegister(
		HTTPRequestsTotal,
		CacheHitsTotal,
		CacheMissesTotal,
		GenerationSeconds,
		CacheFilesTotal,
		CacheBytesTotal,
	)
}
