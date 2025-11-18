package cache

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestContentAddressedPath(t *testing.T) {
	storage := NewStorage("/data/cache")

	tests := []struct {
		name     string
		hash     string
		expected string
	}{
		{
			name:     "full SHA256 hash",
			hash:     "7a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b",
			expected: "/data/cache/7a/1b/7a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b",
		},
		{
			name:     "short hash",
			hash:     "abc123",
			expected: "/data/cache/ab/c1/abc123",
		},
		{
			name:     "very short hash fallback",
			hash:     "ab",
			expected: "/data/cache/ab",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := storage.ContentAddressedPath(tt.hash)
			if result != tt.expected {
				t.Errorf("expected %s, got %s", tt.expected, result)
			}
		})
	}
}

func TestStore(t *testing.T) {
	// Create temporary directory for testing
	tempDir := t.TempDir()
	storage := NewStorage(tempDir)

	hash := "abc123def456"
	data := []byte("test content")
	reader := bytes.NewReader(data)

	err := storage.Store(hash, reader)
	if err != nil {
		t.Fatalf("failed to store data: %v", err)
	}

	// Verify file was created at correct path
	expectedPath := filepath.Join(tempDir, "ab", "c1", hash)
	if _, err := os.Stat(expectedPath); os.IsNotExist(err) {
		t.Errorf("file was not created at expected path: %s", expectedPath)
	}

	// Verify content
	storedData, err := os.ReadFile(expectedPath)
	if err != nil {
		t.Fatalf("failed to read stored file: %v", err)
	}

	if !bytes.Equal(storedData, data) {
		t.Errorf("stored data doesn't match original. expected %s, got %s", data, storedData)
	}
}

func TestStoreCreatesDirectories(t *testing.T) {
	tempDir := t.TempDir()
	storage := NewStorage(tempDir)

	hash := "xyz789abc123"
	data := bytes.NewReader([]byte("test"))

	err := storage.Store(hash, data)
	if err != nil {
		t.Fatalf("failed to store data: %v", err)
	}

	// Verify directory structure was created
	dirPath := filepath.Join(tempDir, "xy", "z7")
	if _, err := os.Stat(dirPath); os.IsNotExist(err) {
		t.Errorf("directories were not created: %s", dirPath)
	}
}

func TestExists(t *testing.T) {
	tempDir := t.TempDir()
	storage := NewStorage(tempDir)

	hash := "test123"

	// File doesn't exist yet
	exists, err := storage.Exists(hash)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if exists {
		t.Error("file should not exist yet")
	}

	// Store the file
	data := bytes.NewReader([]byte("test content"))
	if err := storage.Store(hash, data); err != nil {
		t.Fatalf("failed to store data: %v", err)
	}

	// File should exist now
	exists, err = storage.Exists(hash)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !exists {
		t.Error("file should exist after storing")
	}
}

func TestOpen(t *testing.T) {
	tempDir := t.TempDir()
	storage := NewStorage(tempDir)

	hash := "open123"
	originalData := []byte("file content")

	// Store file first
	if err := storage.Store(hash, bytes.NewReader(originalData)); err != nil {
		t.Fatalf("failed to store data: %v", err)
	}

	// Open and read file
	file, err := storage.Open(hash)
	if err != nil {
		t.Fatalf("failed to open file: %v", err)
	}
	defer file.Close()

	readData, err := os.ReadFile(file.Name())
	if err != nil {
		t.Fatalf("failed to read file: %v", err)
	}

	if !bytes.Equal(readData, originalData) {
		t.Errorf("read data doesn't match original. expected %s, got %s", originalData, readData)
	}
}

func TestOpenNonexistent(t *testing.T) {
	tempDir := t.TempDir()
	storage := NewStorage(tempDir)

	_, err := storage.Open("nonexistent")
	if err == nil {
		t.Error("expected error when opening nonexistent file")
	}
}

func TestSize(t *testing.T) {
	tempDir := t.TempDir()
	storage := NewStorage(tempDir)

	hash := "size123"
	data := []byte("this is test content with known size")

	// Store file
	if err := storage.Store(hash, bytes.NewReader(data)); err != nil {
		t.Fatalf("failed to store data: %v", err)
	}

	// Get size
	size, err := storage.Size(hash)
	if err != nil {
		t.Fatalf("failed to get size: %v", err)
	}

	expectedSize := int64(len(data))
	if size != expectedSize {
		t.Errorf("expected size %d, got %d", expectedSize, size)
	}
}

func TestSizeNonexistent(t *testing.T) {
	tempDir := t.TempDir()
	storage := NewStorage(tempDir)

	_, err := storage.Size("nonexistent")
	if err == nil {
		t.Error("expected error when getting size of nonexistent file")
	}
}

func TestStoreAtomicity(t *testing.T) {
	tempDir := t.TempDir()
	storage := NewStorage(tempDir)

	hash := "atomic123"

	// Verify no .tmp files are left behind after successful store
	data := bytes.NewReader([]byte("test"))
	if err := storage.Store(hash, data); err != nil {
		t.Fatalf("failed to store data: %v", err)
	}

	// Check for .tmp files
	err := filepath.Walk(tempDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if strings.HasSuffix(path, ".tmp") {
			t.Errorf("found leftover temp file: %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("failed to walk directory: %v", err)
	}
}
