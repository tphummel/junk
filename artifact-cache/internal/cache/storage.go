package cache

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// Storage handles content-addressed file storage
type Storage struct {
	basePath string
}

// NewStorage creates a new storage instance
func NewStorage(basePath string) *Storage {
	return &Storage{
		basePath: basePath,
	}
}

// ContentAddressedPath generates a content-addressed path for a given hash
// Format: /data/cache/{hash[0:2]}/{hash[2:4]}/{full_hash}
func (s *Storage) ContentAddressedPath(hash string) string {
	if len(hash) < 4 {
		// Fallback for short hashes (shouldn't happen with SHA256)
		return filepath.Join(s.basePath, hash)
	}
	return filepath.Join(s.basePath, hash[0:2], hash[2:4], hash)
}

// Exists checks if a file exists at the given hash path
func (s *Storage) Exists(hash string) (bool, error) {
	path := s.ContentAddressedPath(hash)
	_, err := os.Stat(path)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, fmt.Errorf("failed to check file existence: %w", err)
}

// Store writes data to a content-addressed path
// Creates parent directories if needed
func (s *Storage) Store(hash string, data io.Reader) error {
	path := s.ContentAddressedPath(hash)

	// Create parent directories
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	// Write to temporary file first for atomicity
	tempPath := path + ".tmp"
	tempFile, err := os.Create(tempPath)
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	defer os.Remove(tempPath) // Clean up temp file on error

	// Copy data to temp file
	if _, err := io.Copy(tempFile, data); err != nil {
		tempFile.Close()
		return fmt.Errorf("failed to write data: %w", err)
	}

	// Close temp file before rename
	if err := tempFile.Close(); err != nil {
		return fmt.Errorf("failed to close temp file: %w", err)
	}

	// Atomic rename
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("failed to rename temp file: %w", err)
	}

	return nil
}

// Open opens a file for reading at the given hash path
func (s *Storage) Open(hash string) (*os.File, error) {
	path := s.ContentAddressedPath(hash)
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	return file, nil
}

// Size returns the size of the file at the given hash path
func (s *Storage) Size(hash string) (int64, error) {
	path := s.ContentAddressedPath(hash)
	info, err := os.Stat(path)
	if err != nil {
		return 0, fmt.Errorf("failed to get file info: %w", err)
	}
	return info.Size(), nil
}
