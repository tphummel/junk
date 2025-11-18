package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"artifact-cache/internal/cache"
	"artifact-cache/internal/db"
	"artifact-cache/internal/fetcher"
	"artifact-cache/internal/metrics"

	"github.com/prometheus/client_golang/prometheus"
)

func setupTestHandler(t *testing.T) (*Handler, *httptest.Server) {
	// Create in-memory database
	database, err := db.NewDB(":memory:")
	if err != nil {
		t.Fatalf("failed to create test database: %v", err)
	}
	t.Cleanup(func() {
		database.Close()
	})

	// Create temporary storage
	tempDir := t.TempDir()
	storage := cache.NewStorage(tempDir)

	// Create fetcher
	fetch := fetcher.NewFetcher(5*time.Second, "TestHandler/1.0")

	// Create cache
	c := cache.NewCache(database, storage, fetch)

	// Create metrics with custom registry for test isolation
	registry := prometheus.NewRegistry()
	m := metrics.NewMetricsWithRegistry(registry)

	// Create handler
	handler := NewHandler(c, database, m)

	// Create test upstream server (will be used by fetcher)
	return handler, nil
}

func TestFetchHandler_Success(t *testing.T) {
	handler, _ := setupTestHandler(t)

	// Create upstream server
	testData := []byte("test artifact content")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/gzip")
		w.WriteHeader(http.StatusOK)
		w.Write(testData)
	}))
	defer upstream.Close()

	// Make request
	req := httptest.NewRequest("GET", "/fetch?url="+url.QueryEscape(upstream.URL), nil)
	w := httptest.NewRecorder()

	handler.FetchHandler(w, req)

	resp := w.Result()
	defer resp.Body.Close()

	// Check status code
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected status 200, got %d", resp.StatusCode)
	}

	// Check headers
	if resp.Header.Get("X-Cache-Status") != "MISS" {
		t.Errorf("expected X-Cache-Status MISS, got %s", resp.Header.Get("X-Cache-Status"))
	}

	if resp.Header.Get("X-Content-SHA256") == "" {
		t.Error("expected X-Content-SHA256 header")
	}

	// Check body
	body, _ := io.ReadAll(resp.Body)
	if string(body) != string(testData) {
		t.Errorf("expected body %s, got %s", testData, body)
	}
}

func TestFetchHandler_CacheHit(t *testing.T) {
	handler, _ := setupTestHandler(t)

	testData := []byte("cached content")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write(testData)
	}))
	defer upstream.Close()

	// First request - cache miss
	req1 := httptest.NewRequest("GET", "/fetch?url="+url.QueryEscape(upstream.URL), nil)
	w1 := httptest.NewRecorder()
	handler.FetchHandler(w1, req1)

	// Second request - cache hit
	req2 := httptest.NewRequest("GET", "/fetch?url="+url.QueryEscape(upstream.URL), nil)
	w2 := httptest.NewRecorder()
	handler.FetchHandler(w2, req2)

	resp2 := w2.Result()
	defer resp2.Body.Close()

	if resp2.Header.Get("X-Cache-Status") != "HIT" {
		t.Error("expected cache HIT on second request")
	}
}

func TestFetchHandler_MissingURL(t *testing.T) {
	handler, _ := setupTestHandler(t)

	req := httptest.NewRequest("GET", "/fetch", nil)
	w := httptest.NewRecorder()

	handler.FetchHandler(w, req)

	resp := w.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", resp.StatusCode)
	}

	var errorResp ErrorResponse
	json.NewDecoder(resp.Body).Decode(&errorResp)

	if errorResp.Error != "missing_parameter" {
		t.Errorf("expected error 'missing_parameter', got %s", errorResp.Error)
	}
}

func TestFetchHandler_MethodNotAllowed(t *testing.T) {
	handler, _ := setupTestHandler(t)

	req := httptest.NewRequest("POST", "/fetch?url=http://example.com", nil)
	w := httptest.NewRecorder()

	handler.FetchHandler(w, req)

	resp := w.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("expected status 405, got %d", resp.StatusCode)
	}
}

func TestFetchHandler_ChecksumVerification(t *testing.T) {
	handler, _ := setupTestHandler(t)

	testData := []byte("checksum test")
	hash := sha256.Sum256(testData)
	correctChecksum := hex.EncodeToString(hash[:])

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write(testData)
	}))
	defer upstream.Close()

	// Request with correct checksum
	req := httptest.NewRequest("GET", "/fetch?url="+url.QueryEscape(upstream.URL)+"&sha256="+correctChecksum, nil)
	w := httptest.NewRecorder()

	handler.FetchHandler(w, req)

	resp := w.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected status 200 with correct checksum, got %d", resp.StatusCode)
	}

	if resp.Header.Get("X-Content-SHA256") != correctChecksum {
		t.Error("SHA256 header should match provided checksum")
	}
}

func TestFetchHandler_ChecksumMismatch(t *testing.T) {
	handler, _ := setupTestHandler(t)

	testData := []byte("content")
	wrongChecksum := "0000000000000000000000000000000000000000000000000000000000000000"

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write(testData)
	}))
	defer upstream.Close()

	req := httptest.NewRequest("GET", "/fetch?url="+url.QueryEscape(upstream.URL)+"&sha256="+wrongChecksum, nil)
	w := httptest.NewRecorder()

	handler.FetchHandler(w, req)

	resp := w.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusConflict {
		t.Errorf("expected status 409 for checksum mismatch, got %d", resp.StatusCode)
	}

	var errorResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&errorResp)

	if errorResp["error"] != "checksum_mismatch" {
		t.Error("expected checksum_mismatch error")
	}

	if errorResp["expected"] != wrongChecksum {
		t.Error("error should include expected checksum")
	}
}

func TestFetchHandler_ContentType(t *testing.T) {
	handler, _ := setupTestHandler(t)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/zip")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("zip content"))
	}))
	defer upstream.Close()

	req := httptest.NewRequest("GET", "/fetch?url="+url.QueryEscape(upstream.URL), nil)
	w := httptest.NewRecorder()

	handler.FetchHandler(w, req)

	resp := w.Result()
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	if contentType != "application/zip" {
		t.Errorf("expected Content-Type application/zip, got %s", contentType)
	}
}

func TestHealthHandler(t *testing.T) {
	handler, _ := setupTestHandler(t)

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()

	handler.HealthHandler(w, req)

	resp := w.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected status 200, got %d", resp.StatusCode)
	}

	var health map[string]string
	json.NewDecoder(resp.Body).Decode(&health)

	if health["status"] != "healthy" {
		t.Errorf("expected status 'healthy', got %s", health["status"])
	}

	if health["timestamp"] == "" {
		t.Error("expected timestamp in response")
	}
}

func TestGetContentType(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"application/json", "application/json"},
		{"text/plain", "text/plain"},
		{"", "application/octet-stream"},
	}

	for _, tt := range tests {
		result := getContentType(tt.input)
		if result != tt.expected {
			t.Errorf("getContentType(%q) = %q, expected %q", tt.input, result, tt.expected)
		}
	}
}
