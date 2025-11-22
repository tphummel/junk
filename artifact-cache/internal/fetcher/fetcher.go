package fetcher

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// Fetcher handles HTTP downloads from upstream sources
type Fetcher struct {
	client    *http.Client
	userAgent string
	tempDir   string
}

// NewFetcher creates a new fetcher with the given timeout and user agent
func NewFetcher(timeout time.Duration, userAgent string) *Fetcher {
	return &Fetcher{
		client: &http.Client{
			Timeout: timeout,
		},
		userAgent: userAgent,
		tempDir:   os.TempDir(),
	}
}

// Result contains the fetched data metadata and temporary file path
type Result struct {
	TempFile    string // Path to temporary file containing the downloaded data
	SHA256      string
	Size        int64
	ContentType string
}

// Fetch downloads content from a URL to a temporary file and computes its SHA256 hash
// The caller is responsible for cleaning up the temporary file
func (f *Fetcher) Fetch(url string) (*Result, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	if f.userAgent != "" {
		req.Header.Set("User-Agent", f.userAgent)
	}

	resp, err := f.client.Do(req)
	if err != nil {
		return nil, &UpstreamError{
			URL:   url,
			Cause: err,
		}
	}
	defer resp.Body.Close()

	// Check for non-2xx status codes
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &UpstreamHTTPError{
			URL:        url,
			StatusCode: resp.StatusCode,
		}
	}

	// Create temporary file for streaming download
	tempFile, err := os.CreateTemp(f.tempDir, "artifact-cache-*.tmp")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp file: %w", err)
	}
	tempPath := tempFile.Name()

	// Ensure cleanup on error
	defer func() {
		if err != nil {
			tempFile.Close()
			os.Remove(tempPath)
		}
	}()

	// Stream body to temp file and compute hash simultaneously
	hash := sha256.New()
	multiWriter := io.MultiWriter(tempFile, hash)

	size, err := io.Copy(multiWriter, resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	// Close the temp file
	if err := tempFile.Close(); err != nil {
		return nil, fmt.Errorf("failed to close temp file: %w", err)
	}

	return &Result{
		TempFile:    tempPath,
		SHA256:      hex.EncodeToString(hash.Sum(nil)),
		Size:        size,
		ContentType: resp.Header.Get("Content-Type"),
	}, nil
}

// UpstreamError represents a network or connectivity error
type UpstreamError struct {
	URL   string
	Cause error
}

func (e *UpstreamError) Error() string {
	return fmt.Sprintf("upstream error for %s: %v", e.URL, e.Cause)
}

func (e *UpstreamError) Unwrap() error {
	return e.Cause
}

// UpstreamHTTPError represents an HTTP error response from upstream
type UpstreamHTTPError struct {
	URL        string
	StatusCode int
}

func (e *UpstreamHTTPError) Error() string {
	return fmt.Sprintf("upstream returned status %d for %s", e.StatusCode, e.URL)
}
