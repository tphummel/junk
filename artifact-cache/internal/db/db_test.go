package db

import (
	"testing"
	"time"
)

// setupTestDB creates an in-memory database for testing
func setupTestDB(t *testing.T) *DB {
	db, err := NewDB(":memory:")
	if err != nil {
		t.Fatalf("failed to create test database: %v", err)
	}
	t.Cleanup(func() {
		db.Close()
	})
	return db
}

func TestNewDB(t *testing.T) {
	db := setupTestDB(t)

	if db == nil {
		t.Fatal("expected non-nil DB")
	}

	if db.conn == nil {
		t.Fatal("expected non-nil connection")
	}
}

func TestInsertArtifact(t *testing.T) {
	db := setupTestDB(t)

	artifact := &Artifact{
		SourceURL:    "https://example.com/file.tar.gz",
		ContentHash:  "abc123def456",
		StoragePath:  "/data/cache/ab/c1/abc123def456",
		FileSize:     1024,
		ContentType:  "application/gzip",
	}

	err := db.InsertArtifact(artifact)
	if err != nil {
		t.Fatalf("failed to insert artifact: %v", err)
	}

	if artifact.ID == 0 {
		t.Error("expected ID to be set after insert")
	}
}

func TestInsertArtifact_DuplicateURL(t *testing.T) {
	db := setupTestDB(t)

	artifact1 := &Artifact{
		SourceURL:    "https://example.com/file.tar.gz",
		ContentHash:  "abc123",
		StoragePath:  "/data/cache/ab/c1/abc123",
		FileSize:     1024,
		ContentType:  "application/gzip",
	}

	err := db.InsertArtifact(artifact1)
	if err != nil {
		t.Fatalf("failed to insert first artifact: %v", err)
	}

	artifact2 := &Artifact{
		SourceURL:    "https://example.com/file.tar.gz", // Same URL
		ContentHash:  "def456",
		StoragePath:  "/data/cache/de/f4/def456",
		FileSize:     2048,
		ContentType:  "application/gzip",
	}

	err = db.InsertArtifact(artifact2)
	if err == nil {
		t.Error("expected error when inserting duplicate URL, got nil")
	}
}

func TestGetArtifactByURL(t *testing.T) {
	db := setupTestDB(t)

	// Insert an artifact
	original := &Artifact{
		SourceURL:    "https://example.com/test.jar",
		ContentHash:  "hash123",
		StoragePath:  "/data/cache/ha/sh/hash123",
		FileSize:     2048,
		ContentType:  "application/java-archive",
	}

	err := db.InsertArtifact(original)
	if err != nil {
		t.Fatalf("failed to insert artifact: %v", err)
	}

	// Retrieve the artifact
	retrieved, err := db.GetArtifactByURL("https://example.com/test.jar")
	if err != nil {
		t.Fatalf("failed to get artifact: %v", err)
	}

	if retrieved == nil {
		t.Fatal("expected non-nil artifact")
	}

	if retrieved.SourceURL != original.SourceURL {
		t.Errorf("expected SourceURL %s, got %s", original.SourceURL, retrieved.SourceURL)
	}

	if retrieved.ContentHash != original.ContentHash {
		t.Errorf("expected ContentHash %s, got %s", original.ContentHash, retrieved.ContentHash)
	}

	if retrieved.StoragePath != original.StoragePath {
		t.Errorf("expected StoragePath %s, got %s", original.StoragePath, retrieved.StoragePath)
	}

	if retrieved.FileSize != original.FileSize {
		t.Errorf("expected FileSize %d, got %d", original.FileSize, retrieved.FileSize)
	}

	if retrieved.ContentType != original.ContentType {
		t.Errorf("expected ContentType %s, got %s", original.ContentType, retrieved.ContentType)
	}

	if retrieved.AccessCount != 0 {
		t.Errorf("expected AccessCount 0, got %d", retrieved.AccessCount)
	}
}

func TestGetArtifactByURL_NotFound(t *testing.T) {
	db := setupTestDB(t)

	artifact, err := db.GetArtifactByURL("https://example.com/nonexistent.tar.gz")
	if err != nil {
		t.Fatalf("expected no error for non-existent artifact, got: %v", err)
	}

	if artifact != nil {
		t.Error("expected nil artifact for non-existent URL")
	}
}

func TestUpdateAccessStats(t *testing.T) {
	db := setupTestDB(t)

	// Insert an artifact
	artifact := &Artifact{
		SourceURL:    "https://example.com/popular.zip",
		ContentHash:  "popular123",
		StoragePath:  "/data/cache/po/pu/popular123",
		FileSize:     4096,
		ContentType:  "application/zip",
	}

	err := db.InsertArtifact(artifact)
	if err != nil {
		t.Fatalf("failed to insert artifact: %v", err)
	}

	// Get initial state
	before, err := db.GetArtifactByURL(artifact.SourceURL)
	if err != nil {
		t.Fatalf("failed to get artifact before update: %v", err)
	}

	initialAccessCount := before.AccessCount
	initialAccessTime := before.LastAccessedAt

	// Wait to ensure timestamp changes (SQLite CURRENT_TIMESTAMP has second precision)
	time.Sleep(1100 * time.Millisecond)

	// Update access stats
	err = db.UpdateAccessStats(artifact.SourceURL)
	if err != nil {
		t.Fatalf("failed to update access stats: %v", err)
	}

	// Get updated state
	after, err := db.GetArtifactByURL(artifact.SourceURL)
	if err != nil {
		t.Fatalf("failed to get artifact after update: %v", err)
	}

	if after.AccessCount != initialAccessCount+1 {
		t.Errorf("expected AccessCount to increase by 1, got %d -> %d", initialAccessCount, after.AccessCount)
	}

	if !after.LastAccessedAt.After(initialAccessTime) {
		t.Error("expected LastAccessedAt to be updated to a later time")
	}
}

func TestUpdateAccessStats_NotFound(t *testing.T) {
	db := setupTestDB(t)

	err := db.UpdateAccessStats("https://example.com/nonexistent.tar.gz")
	if err == nil {
		t.Error("expected error when updating non-existent artifact")
	}
}

func TestGetStats_Empty(t *testing.T) {
	db := setupTestDB(t)

	stats, err := db.GetStats()
	if err != nil {
		t.Fatalf("failed to get stats: %v", err)
	}

	if stats.TotalItems != 0 {
		t.Errorf("expected TotalItems 0, got %d", stats.TotalItems)
	}

	if stats.TotalSizeBytes != 0 {
		t.Errorf("expected TotalSizeBytes 0, got %d", stats.TotalSizeBytes)
	}

	if stats.TotalAccesses != 0 {
		t.Errorf("expected TotalAccesses 0, got %d", stats.TotalAccesses)
	}
}

func TestGetStats_WithData(t *testing.T) {
	db := setupTestDB(t)

	// Insert multiple artifacts
	artifacts := []*Artifact{
		{
			SourceURL:   "https://example.com/file1.tar.gz",
			ContentHash: "hash1",
			StoragePath: "/data/cache/ha/sh/hash1",
			FileSize:    1000,
			ContentType: "application/gzip",
		},
		{
			SourceURL:   "https://example.com/file2.zip",
			ContentHash: "hash2",
			StoragePath: "/data/cache/ha/sh/hash2",
			FileSize:    2000,
			ContentType: "application/zip",
		},
		{
			SourceURL:   "https://example.com/file3.jar",
			ContentHash: "hash3",
			StoragePath: "/data/cache/ha/sh/hash3",
			FileSize:    3000,
			ContentType: "application/java-archive",
		},
	}

	for _, artifact := range artifacts {
		err := db.InsertArtifact(artifact)
		if err != nil {
			t.Fatalf("failed to insert artifact: %v", err)
		}
	}

	// Update access stats for some artifacts
	db.UpdateAccessStats("https://example.com/file1.tar.gz")
	db.UpdateAccessStats("https://example.com/file1.tar.gz")
	db.UpdateAccessStats("https://example.com/file2.zip")

	stats, err := db.GetStats()
	if err != nil {
		t.Fatalf("failed to get stats: %v", err)
	}

	if stats.TotalItems != 3 {
		t.Errorf("expected TotalItems 3, got %d", stats.TotalItems)
	}

	expectedSize := int64(1000 + 2000 + 3000)
	if stats.TotalSizeBytes != expectedSize {
		t.Errorf("expected TotalSizeBytes %d, got %d", expectedSize, stats.TotalSizeBytes)
	}

	expectedAccesses := int64(2 + 1 + 0) // file1: 2, file2: 1, file3: 0
	if stats.TotalAccesses != expectedAccesses {
		t.Errorf("expected TotalAccesses %d, got %d", expectedAccesses, stats.TotalAccesses)
	}
}

func TestMultipleArtifactsSameHash(t *testing.T) {
	db := setupTestDB(t)

	// Two different URLs can have the same content hash (deduplication)
	artifact1 := &Artifact{
		SourceURL:   "https://example.com/file1.tar.gz",
		ContentHash: "samehash123",
		StoragePath: "/data/cache/sa/me/samehash123",
		FileSize:    5000,
		ContentType: "application/gzip",
	}

	artifact2 := &Artifact{
		SourceURL:   "https://mirror.example.com/file1.tar.gz",
		ContentHash: "samehash123", // Same hash, different URL
		StoragePath: "/data/cache/sa/me/samehash123",
		FileSize:    5000,
		ContentType: "application/gzip",
	}

	err := db.InsertArtifact(artifact1)
	if err != nil {
		t.Fatalf("failed to insert artifact1: %v", err)
	}

	err = db.InsertArtifact(artifact2)
	if err != nil {
		t.Fatalf("failed to insert artifact2: %v", err)
	}

	// Both should be retrievable independently
	retrieved1, _ := db.GetArtifactByURL(artifact1.SourceURL)
	retrieved2, _ := db.GetArtifactByURL(artifact2.SourceURL)

	if retrieved1.ContentHash != retrieved2.ContentHash {
		t.Error("expected both artifacts to have the same content hash")
	}

	if retrieved1.SourceURL == retrieved2.SourceURL {
		t.Error("expected different source URLs")
	}
}
