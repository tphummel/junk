package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"artifact-cache/internal/cache"
	"artifact-cache/internal/db"
	"artifact-cache/internal/metrics"
)

// Handler holds dependencies for HTTP handlers
type Handler struct {
	cache   *cache.Cache
	db      *db.DB
	metrics *metrics.Metrics
}

// NewHandler creates a new handler instance
func NewHandler(c *cache.Cache, database *db.DB, m *metrics.Metrics) *Handler {
	return &Handler{
		cache:   c,
		db:      database,
		metrics: m,
	}
}

// ErrorResponse represents an error returned to the client
type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
	Details string `json:"details,omitempty"`
}

// FetchHandler handles GET /fetch requests
func (h *Handler) FetchHandler(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	// Only allow GET requests
	if r.Method != http.MethodGet {
		h.writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Only GET requests are allowed", "")
		h.metrics.RecordError(time.Since(start).Seconds())
		return
	}

	// Get URL parameter
	sourceURL := r.URL.Query().Get("url")
	if sourceURL == "" {
		h.writeError(w, http.StatusBadRequest, "missing_parameter", "Missing required 'url' parameter", "url")
		h.metrics.RecordError(time.Since(start).Seconds())
		return
	}

	// Get optional checksum parameter
	expectedSHA256 := r.URL.Query().Get("sha256")

	slog.Info("fetch request",
		"url", sourceURL,
		"has_checksum", expectedSHA256 != "",
		"client_ip", r.RemoteAddr,
	)

	// Get artifact from cache
	result, err := h.cache.Get(sourceURL, expectedSHA256)
	if err != nil {
		h.handleFetchError(w, err, start)
		return
	}
	defer result.Data.Close()

	// Set response headers
	w.Header().Set("Content-Type", getContentType(result.ContentType))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", result.Size))
	w.Header().Set("X-Content-SHA256", result.Hash)

	if result.CacheHit {
		w.Header().Set("X-Cache-Status", "HIT")
	} else {
		w.Header().Set("X-Cache-Status", "MISS")
	}

	// Write status code
	w.WriteHeader(http.StatusOK)

	// Stream content to client
	written, err := io.Copy(w, result.Data)
	if err != nil {
		slog.Error("failed to stream content",
			"url", sourceURL,
			"error", err,
		)
		return
	}

	// Record metrics
	duration := time.Since(start).Seconds()
	if result.CacheHit {
		h.metrics.RecordCacheHit(duration, written)
		slog.Info("cache HIT",
			"url", sourceURL,
			"size_bytes", written,
			"duration_ms", duration*1000,
		)
	} else {
		h.metrics.RecordCacheMiss(duration, result.Size, written)
		slog.Info("cache MISS - downloaded from upstream",
			"url", sourceURL,
			"size_bytes", written,
			"duration_ms", duration*1000,
		)
	}
}

// HealthHandler handles GET /health requests
func (h *Handler) HealthHandler(w http.ResponseWriter, r *http.Request) {
	response := map[string]string{
		"status":    "healthy",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// handleFetchError handles errors from cache.Get and writes appropriate HTTP responses
func (h *Handler) handleFetchError(w http.ResponseWriter, err error, start time.Time) {
	duration := time.Since(start).Seconds()
	h.metrics.RecordError(duration)

	slog.Error("fetch failed", "error", err)

	// Check for specific error types
	switch e := err.(type) {
	case *cache.ChecksumMismatchError:
		h.writeErrorJSON(w, http.StatusConflict, map[string]interface{}{
			"error":      "checksum_mismatch",
			"expected":   e.Expected,
			"actual":     e.Actual,
			"source_url": e.URL,
			"message":    "Artifact checksum does not match expected value",
		})

	default:
		// Generic internal server error
		h.writeError(w, http.StatusInternalServerError, "internal_error", err.Error(), "")
	}
}

// writeError writes a JSON error response
func (h *Handler) writeError(w http.ResponseWriter, statusCode int, errorCode, message, details string) {
	response := ErrorResponse{
		Error:   errorCode,
		Message: message,
		Details: details,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(response)
}

// writeErrorJSON writes a custom JSON error response
func (h *Handler) writeErrorJSON(w http.ResponseWriter, statusCode int, data map[string]interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(data)
}

// getContentType returns the content type or a default
func getContentType(contentType string) string {
	if contentType == "" {
		return "application/octet-stream"
	}
	return contentType
}
