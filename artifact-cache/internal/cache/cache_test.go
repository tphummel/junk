package cache

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"artifact-cache/internal/db"
	"artifact-cache/internal/fetcher"
)

// setupTestCache creates a complete test cache with in-memory DB and temp storage
func setupTestCache(t *testing.T) *Cache {
	database, err := db.NewDB(":memory:")
	if err != nil {
		t.Fatalf("failed to create test database: %v", err)
	}
	t.Cleanup(func() {
		database.Close()
	})

	tempDir := t.TempDir()
	storage := NewStorage(tempDir)

	fetch := fetcher.NewFetcher(5*time.Second, "TestCache/1.0")

	return NewCache(database, storage, fetch)
}

func TestGet_CacheMiss(t *testing.T) {
	cache := setupTestCache(t)

	testData := []byte("test content from upstream")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(http.StatusOK)
		w.Write(testData)
	}))
	defer server.Close()

	result, err := cache.Get(server.URL, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer result.Data.Close()

	if result.CacheHit {
		t.Error("expected cache miss, got cache hit")
	}

	// Verify data
	data, err := io.ReadAll(result.Data)
	if err != nil {
		t.Fatalf("failed to read result data: %v", err)
	}

	if string(data) != string(testData) {
		t.Errorf("expected data %s, got %s", testData, data)
	}

	// Verify hash
	expectedHash := sha256.Sum256(testData)
	expectedHashStr := hex.EncodeToString(expectedHash[:])
	if result.Hash != expectedHashStr {
		t.Errorf("expected hash %s, got %s", expectedHashStr, result.Hash)
	}

	// Verify size
	if result.Size != int64(len(testData)) {
		t.Errorf("expected size %d, got %d", len(testData), result.Size)
	}
}

func TestGet_CacheHit(t *testing.T) {
	cache := setupTestCache(t)

	testData := []byte("cached content")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write(testData)
	}))
	defer server.Close()

	// First request - cache miss
	result1, err := cache.Get(server.URL, "")
	if err != nil {
		t.Fatalf("first request failed: %v", err)
	}
	result1.Data.Close()

	if result1.CacheHit {
		t.Error("first request should be cache miss")
	}

	// Second request - cache hit
	result2, err := cache.Get(server.URL, "")
	if err != nil {
		t.Fatalf("second request failed: %v", err)
	}
	defer result2.Data.Close()

	if !result2.CacheHit {
		t.Error("second request should be cache hit")
	}

	// Verify data is the same
	data, err := io.ReadAll(result2.Data)
	if err != nil {
		t.Fatalf("failed to read cached data: %v", err)
	}

	if string(data) != string(testData) {
		t.Error("cached data doesn't match original")
	}
}

func TestGet_ChecksumVerification_Miss(t *testing.T) {
	cache := setupTestCache(t)

	testData := []byte("content for checksum verification")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write(testData)
	}))
	defer server.Close()

	// Compute correct checksum
	hash := sha256.Sum256(testData)
	correctChecksum := hex.EncodeToString(hash[:])

	// Request with correct checksum
	result, err := cache.Get(server.URL, correctChecksum)
	if err != nil {
		t.Fatalf("request with correct checksum failed: %v", err)
	}
	result.Data.Close()

	if result.Hash != correctChecksum {
		t.Error("hash mismatch")
	}
}

func TestGet_ChecksumMismatch_Miss(t *testing.T) {
	cache := setupTestCache(t)

	testData := []byte("content")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write(testData)
	}))
	defer server.Close()

	// Use wrong checksum
	wrongChecksum := "0000000000000000000000000000000000000000000000000000000000000000"

	_, err := cache.Get(server.URL, wrongChecksum)
	if err == nil {
		t.Fatal("expected error for checksum mismatch")
	}

	checksumErr, ok := err.(*ChecksumMismatchError)
	if !ok {
		t.Fatalf("expected ChecksumMismatchError, got %T", err)
	}

	if checksumErr.Expected != wrongChecksum {
		t.Errorf("expected checksum %s in error, got %s", wrongChecksum, checksumErr.Expected)
	}
}

func TestGet_ChecksumMismatch_Hit(t *testing.T) {
	cache := setupTestCache(t)

	testData := []byte("cached data")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write(testData)
	}))
	defer server.Close()

	// First request to populate cache
	result1, err := cache.Get(server.URL, "")
	if err != nil {
		t.Fatalf("first request failed: %v", err)
	}
	result1.Data.Close()

	// Second request with wrong checksum
	wrongChecksum := "1111111111111111111111111111111111111111111111111111111111111111"
	_, err = cache.Get(server.URL, wrongChecksum)

	if err == nil {
		t.Fatal("expected error for checksum mismatch on cache hit")
	}

	checksumErr, ok := err.(*ChecksumMismatchError)
	if !ok {
		t.Fatalf("expected ChecksumMismatchError, got %T", err)
	}

	if checksumErr.Expected != wrongChecksum {
		t.Error("checksum error should contain expected checksum")
	}
}

func TestGet_UpstreamError(t *testing.T) {
	cache := setupTestCache(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	_, err := cache.Get(server.URL, "")
	if err == nil {
		t.Fatal("expected error for upstream 404")
	}
}

func TestGet_AccessStatsUpdated(t *testing.T) {
	cache := setupTestCache(t)

	testData := []byte("stats test")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write(testData)
	}))
	defer server.Close()

	// First request
	result1, _ := cache.Get(server.URL, "")
	result1.Data.Close()

	// Second request (cache hit)
	result2, _ := cache.Get(server.URL, "")
	result2.Data.Close()

	// Third request (cache hit)
	result3, _ := cache.Get(server.URL, "")
	result3.Data.Close()

	// Check access count in database
	artifact, err := cache.db.GetArtifactByURL(server.URL)
	if err != nil {
		t.Fatalf("failed to get artifact from DB: %v", err)
	}

	// First request doesn't increment (inserts with 0), subsequent hits increment
	if artifact.AccessCount != 2 {
		t.Errorf("expected access count 2, got %d", artifact.AccessCount)
	}
}

func TestGet_ContentDeduplication(t *testing.T) {
	cache := setupTestCache(t)

	// Same content from two different URLs
	testData := []byte("shared content")

	server1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write(testData)
	}))
	defer server1.Close()

	server2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write(testData)
	}))
	defer server2.Close()

	// Fetch from first URL
	result1, err := cache.Get(server1.URL, "")
	if err != nil {
		t.Fatalf("first request failed: %v", err)
	}
	result1.Data.Close()

	// Fetch from second URL (different URL, same content)
	result2, err := cache.Get(server2.URL, "")
	if err != nil {
		t.Fatalf("second request failed: %v", err)
	}
	result2.Data.Close()

	// Both should have same hash
	if result1.Hash != result2.Hash {
		t.Error("same content should produce same hash")
	}

	// Verify both entries exist in DB with same hash
	artifact1, _ := cache.db.GetArtifactByURL(server1.URL)
	artifact2, _ := cache.db.GetArtifactByURL(server2.URL)

	if artifact1.ContentHash != artifact2.ContentHash {
		t.Error("content deduplication: both artifacts should reference same hash")
	}

	// Storage path should be the same
	if artifact1.StoragePath != artifact2.StoragePath {
		t.Error("deduplicated content should have same storage path")
	}
}

func TestGet_LargeFile(t *testing.T) {
	cache := setupTestCache(t)

	// Test with 1MB file
	testData := make([]byte, 1024*1024)
	for i := range testData {
		testData[i] = byte(i % 256)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write(testData)
	}))
	defer server.Close()

	result, err := cache.Get(server.URL, "")
	if err != nil {
		t.Fatalf("large file fetch failed: %v", err)
	}
	defer result.Data.Close()

	data, err := io.ReadAll(result.Data)
	if err != nil {
		t.Fatalf("failed to read large file: %v", err)
	}

	if len(data) != len(testData) {
		t.Errorf("expected %d bytes, got %d", len(testData), len(data))
	}
}

func TestChecksumMismatchError_Error(t *testing.T) {
	err := &ChecksumMismatchError{
		Expected: "abc123",
		Actual:   "def456",
		URL:      "https://example.com/file.tar.gz",
	}

	msg := err.Error()
	if msg == "" {
		t.Error("expected non-empty error message")
	}

	// Verify message contains key information
	if !contains(msg, "abc123") || !contains(msg, "def456") {
		t.Error("error message should contain both checksums")
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > len(substr) && (s[:len(substr)] == substr || s[len(s)-len(substr):] == substr || containsMiddle(s, substr)))
}

func containsMiddle(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
