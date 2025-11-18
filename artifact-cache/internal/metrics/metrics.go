package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Metrics holds all Prometheus metrics for the artifact cache
type Metrics struct {
	RequestsTotal           *prometheus.CounterVec
	DownloadsTotal          prometheus.Counter
	BytesDownloadedTotal    prometheus.Counter
	BytesServedTotal        prometheus.Counter
	ItemsTotal              prometheus.Gauge
	SizeBytes               prometheus.Gauge
	RequestDuration         *prometheus.HistogramVec
	DownloadSizeBytes       prometheus.Histogram
}

// NewMetrics creates and registers all Prometheus metrics using the default registry
func NewMetrics() *Metrics {
	return NewMetricsWithRegistry(prometheus.DefaultRegisterer)
}

// NewMetricsWithRegistry creates and registers all Prometheus metrics with a custom registry
func NewMetricsWithRegistry(reg prometheus.Registerer) *Metrics {
	factory := promauto.With(reg)

	return &Metrics{
		RequestsTotal: factory.NewCounterVec(
			prometheus.CounterOpts{
				Name: "artifact_cache_requests_total",
				Help: "Total number of cache requests",
			},
			[]string{"status"}, // hit, miss, error
		),
		DownloadsTotal: factory.NewCounter(
			prometheus.CounterOpts{
				Name: "artifact_cache_downloads_total",
				Help: "Total number of upstream downloads",
			},
		),
		BytesDownloadedTotal: factory.NewCounter(
			prometheus.CounterOpts{
				Name: "artifact_cache_bytes_downloaded_total",
				Help: "Total bytes downloaded from upstream",
			},
		),
		BytesServedTotal: factory.NewCounter(
			prometheus.CounterOpts{
				Name: "artifact_cache_bytes_served_total",
				Help: "Total bytes served to clients",
			},
		),
		ItemsTotal: factory.NewGauge(
			prometheus.GaugeOpts{
				Name: "artifact_cache_items_total",
				Help: "Number of cached artifacts",
			},
		),
		SizeBytes: factory.NewGauge(
			prometheus.GaugeOpts{
				Name: "artifact_cache_size_bytes",
				Help: "Total cache size in bytes",
			},
		),
		RequestDuration: factory.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "artifact_cache_request_duration_seconds",
				Help:    "Request duration in seconds",
				Buckets: prometheus.DefBuckets,
			},
			[]string{"status"}, // hit, miss, error
		),
		DownloadSizeBytes: factory.NewHistogram(
			prometheus.HistogramOpts{
				Name:    "artifact_cache_download_size_bytes",
				Help:    "Download size distribution",
				Buckets: prometheus.ExponentialBuckets(1024, 2, 20), // 1KB to ~1GB
			},
		),
	}
}

// RecordCacheHit records a cache hit
func (m *Metrics) RecordCacheHit(duration float64, bytesServed int64) {
	m.RequestsTotal.WithLabelValues("hit").Inc()
	m.RequestDuration.WithLabelValues("hit").Observe(duration)
	m.BytesServedTotal.Add(float64(bytesServed))
}

// RecordCacheMiss records a cache miss (successful download)
func (m *Metrics) RecordCacheMiss(duration float64, bytesDownloaded int64, bytesServed int64) {
	m.RequestsTotal.WithLabelValues("miss").Inc()
	m.RequestDuration.WithLabelValues("miss").Observe(duration)
	m.DownloadsTotal.Inc()
	m.BytesDownloadedTotal.Add(float64(bytesDownloaded))
	m.BytesServedTotal.Add(float64(bytesServed))
	m.DownloadSizeBytes.Observe(float64(bytesDownloaded))
}

// RecordError records a failed request
func (m *Metrics) RecordError(duration float64) {
	m.RequestsTotal.WithLabelValues("error").Inc()
	m.RequestDuration.WithLabelValues("error").Observe(duration)
}

// UpdateCacheStats updates gauge metrics for total items and size
func (m *Metrics) UpdateCacheStats(itemCount int, totalSize int64) {
	m.ItemsTotal.Set(float64(itemCount))
	m.SizeBytes.Set(float64(totalSize))
}
