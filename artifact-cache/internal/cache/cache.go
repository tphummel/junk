package cache

import (
	"bytes"
	"fmt"
	"io"

	"artifact-cache/internal/db"
	"artifact-cache/internal/fetcher"
)

// Cache orchestrates artifact caching operations
type Cache struct {
	db      *db.DB
	storage *Storage
	fetcher *fetcher.Fetcher
}

// NewCache creates a new cache instance
func NewCache(database *db.DB, storage *Storage, fetch *fetcher.Fetcher) *Cache {
	return &Cache{
		db:      database,
		storage: storage,
		fetcher: fetch,
	}
}

// GetResult represents the result of a cache get operation
type GetResult struct {
	Data        io.ReadCloser
	Hash        string
	Size        int64
	ContentType string
	CacheHit    bool
}

// Get retrieves an artifact from cache or fetches it from upstream
func (c *Cache) Get(sourceURL string, expectedSHA256 string) (*GetResult, error) {
	// Check if artifact exists in database
	artifact, err := c.db.GetArtifactByURL(sourceURL)
	if err != nil {
		return nil, fmt.Errorf("database lookup failed: %w", err)
	}

	// Cache HIT
	if artifact != nil {
		// Verify file still exists on disk
		exists, err := c.storage.Exists(artifact.ContentHash)
		if err != nil {
			return nil, fmt.Errorf("failed to check file existence: %w", err)
		}

		if !exists {
			return nil, fmt.Errorf("cache inconsistency: metadata exists but file missing for %s", sourceURL)
		}

		// Verify checksum if provided
		if expectedSHA256 != "" && artifact.ContentHash != expectedSHA256 {
			return nil, &ChecksumMismatchError{
				Expected: expectedSHA256,
				Actual:   artifact.ContentHash,
				URL:      sourceURL,
			}
		}

		// Update access statistics
		if err := c.db.UpdateAccessStats(sourceURL); err != nil {
			// Log but don't fail on stats update error
			// In production, this would use structured logging
		}

		// Open file for reading
		file, err := c.storage.Open(artifact.ContentHash)
		if err != nil {
			return nil, fmt.Errorf("failed to open cached file: %w", err)
		}

		return &GetResult{
			Data:        file,
			Hash:        artifact.ContentHash,
			Size:        artifact.FileSize,
			ContentType: artifact.ContentType,
			CacheHit:    true,
		}, nil
	}

	// Cache MISS - fetch from upstream
	result, err := c.fetcher.Fetch(sourceURL)
	if err != nil {
		return nil, fmt.Errorf("upstream fetch failed: %w", err)
	}

	// Verify checksum if provided
	if expectedSHA256 != "" && result.SHA256 != expectedSHA256 {
		return nil, &ChecksumMismatchError{
			Expected: expectedSHA256,
			Actual:   result.SHA256,
			URL:      sourceURL,
		}
	}

	// Store to disk
	reader := bytes.NewReader(result.Data)
	if err := c.storage.Store(result.SHA256, reader); err != nil {
		return nil, fmt.Errorf("failed to store artifact: %w", err)
	}

	// Save metadata to database
	storagePath := c.storage.ContentAddressedPath(result.SHA256)
	newArtifact := &db.Artifact{
		SourceURL:   sourceURL,
		ContentHash: result.SHA256,
		StoragePath: storagePath,
		FileSize:    result.Size,
		ContentType: result.ContentType,
	}

	if err := c.db.InsertArtifact(newArtifact); err != nil {
		return nil, fmt.Errorf("failed to save metadata: %w", err)
	}

	// Return the data
	dataReader := bytes.NewReader(result.Data)
	return &GetResult{
		Data:        io.NopCloser(dataReader),
		Hash:        result.SHA256,
		Size:        result.Size,
		ContentType: result.ContentType,
		CacheHit:    false,
	}, nil
}

// ChecksumMismatchError is returned when content hash doesn't match expected
type ChecksumMismatchError struct {
	Expected string
	Actual   string
	URL      string
}

func (e *ChecksumMismatchError) Error() string {
	return fmt.Sprintf("checksum mismatch for %s: expected %s, got %s", e.URL, e.Expected, e.Actual)
}
