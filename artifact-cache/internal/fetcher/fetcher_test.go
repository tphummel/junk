package fetcher

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestFetch_Success(t *testing.T) {
	// Create test server
	testData := []byte("test content for download")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(http.StatusOK)
		w.Write(testData)
	}))
	defer server.Close()

	fetcher := NewFetcher(5*time.Second, "TestAgent/1.0")
	result, err := fetcher.Fetch(server.URL)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result == nil {
		t.Fatal("expected non-nil result")
	}
	defer os.Remove(result.TempFile)

	// Verify temp file exists and read data
	fileData, err := os.ReadFile(result.TempFile)
	if err != nil {
		t.Fatalf("failed to read temp file: %v", err)
	}

	if string(fileData) != string(testData) {
		t.Errorf("expected data %s, got %s", testData, fileData)
	}

	// Verify hash
	expectedHash := sha256.Sum256(testData)
	expectedHashStr := hex.EncodeToString(expectedHash[:])
	if result.SHA256 != expectedHashStr {
		t.Errorf("expected hash %s, got %s", expectedHashStr, result.SHA256)
	}

	// Verify size
	if result.Size != int64(len(testData)) {
		t.Errorf("expected size %d, got %d", len(testData), result.Size)
	}

	// Verify content type
	if result.ContentType != "application/octet-stream" {
		t.Errorf("expected content type 'application/octet-stream', got %s", result.ContentType)
	}
}

func TestFetch_UserAgent(t *testing.T) {
	expectedUA := "CustomAgent/2.0"
	var receivedUA string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedUA = r.Header.Get("User-Agent")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))
	defer server.Close()

	fetcher := NewFetcher(5*time.Second, expectedUA)
	result, err := fetcher.Fetch(server.URL)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer os.Remove(result.TempFile)

	if receivedUA != expectedUA {
		t.Errorf("expected User-Agent %s, got %s", expectedUA, receivedUA)
	}
}

func TestFetch_404Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("not found"))
	}))
	defer server.Close()

	fetcher := NewFetcher(5*time.Second, "TestAgent/1.0")
	_, err := fetcher.Fetch(server.URL)

	if err == nil {
		t.Fatal("expected error for 404 response")
	}

	httpErr, ok := err.(*UpstreamHTTPError)
	if !ok {
		t.Fatalf("expected UpstreamHTTPError, got %T", err)
	}

	if httpErr.StatusCode != 404 {
		t.Errorf("expected status code 404, got %d", httpErr.StatusCode)
	}
}

func TestFetch_500Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	fetcher := NewFetcher(5*time.Second, "TestAgent/1.0")
	_, err := fetcher.Fetch(server.URL)

	if err == nil {
		t.Fatal("expected error for 500 response")
	}

	httpErr, ok := err.(*UpstreamHTTPError)
	if !ok {
		t.Fatalf("expected UpstreamHTTPError, got %T", err)
	}

	if httpErr.StatusCode != 500 {
		t.Errorf("expected status code 500, got %d", httpErr.StatusCode)
	}
}

func TestFetch_InvalidURL(t *testing.T) {
	fetcher := NewFetcher(5*time.Second, "TestAgent/1.0")
	_, err := fetcher.Fetch("://invalid-url")

	if err == nil {
		t.Fatal("expected error for invalid URL")
	}
}

func TestFetch_NetworkError(t *testing.T) {
	// Use a URL that will fail to connect
	fetcher := NewFetcher(1*time.Second, "TestAgent/1.0")
	_, err := fetcher.Fetch("http://192.0.2.1:1") // TEST-NET-1, should timeout

	if err == nil {
		t.Fatal("expected error for unreachable host")
	}

	upstreamErr, ok := err.(*UpstreamError)
	if !ok {
		t.Fatalf("expected UpstreamError, got %T", err)
	}

	if upstreamErr.Cause == nil {
		t.Error("expected non-nil cause for upstream error")
	}
}

func TestFetch_EmptyResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		// No body
	}))
	defer server.Close()

	fetcher := NewFetcher(5*time.Second, "TestAgent/1.0")
	result, err := fetcher.Fetch(server.URL)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer os.Remove(result.TempFile)

	// Read temp file to verify it's empty
	fileData, err := os.ReadFile(result.TempFile)
	if err != nil {
		t.Fatalf("failed to read temp file: %v", err)
	}

	if len(fileData) != 0 {
		t.Errorf("expected empty data, got %d bytes", len(fileData))
	}

	// Hash of empty content
	emptyHash := sha256.Sum256([]byte{})
	expectedHash := hex.EncodeToString(emptyHash[:])
	if result.SHA256 != expectedHash {
		t.Errorf("expected hash %s for empty content, got %s", expectedHash, result.SHA256)
	}
}

func TestFetch_LargeFile(t *testing.T) {
	// Test with a reasonably large payload
	testData := make([]byte, 1024*1024) // 1MB
	for i := range testData {
		testData[i] = byte(i % 256)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write(testData)
	}))
	defer server.Close()

	fetcher := NewFetcher(10*time.Second, "TestAgent/1.0")
	result, err := fetcher.Fetch(server.URL)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer os.Remove(result.TempFile)

	// Read temp file and verify size
	fileData, err := os.ReadFile(result.TempFile)
	if err != nil {
		t.Fatalf("failed to read temp file: %v", err)
	}

	if len(fileData) != len(testData) {
		t.Errorf("expected %d bytes, got %d", len(testData), len(fileData))
	}

	// Verify hash matches
	expectedHash := sha256.Sum256(testData)
	expectedHashStr := hex.EncodeToString(expectedHash[:])
	if result.SHA256 != expectedHashStr {
		t.Error("hash mismatch for large file")
	}
}

func TestUpstreamHTTPError_Error(t *testing.T) {
	err := &UpstreamHTTPError{
		URL:        "https://example.com/file.tar.gz",
		StatusCode: 404,
	}

	expected := "upstream returned status 404 for https://example.com/file.tar.gz"
	if err.Error() != expected {
		t.Errorf("expected error message %q, got %q", expected, err.Error())
	}
}

func TestUpstreamError_Error(t *testing.T) {
	cause := &UpstreamHTTPError{URL: "http://test.com", StatusCode: 500}
	err := &UpstreamError{
		URL:   "http://example.com",
		Cause: cause,
	}

	msg := err.Error()
	if msg == "" {
		t.Error("expected non-empty error message")
	}

	// Verify Unwrap works
	if err.Unwrap() != cause {
		t.Error("Unwrap() should return the cause")
	}
}
