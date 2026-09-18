// Package cache implements a write-once, read-many disk cache for generated
// PNGs. There is no TTL or size-based eviction: files persist until an
// external process removes them.
package cache

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// Cache stores PNG files under a directory, keyed by content hash. Reads are
// lock-free (files are immutable once written); a mutex protects only the
// in-process size counters used for metrics.
type Cache struct {
	dir string

	mu    sync.RWMutex
	files int
	bytes int64
}

// New creates (if needed) dir and returns a Cache backed by it, with its
// size counters initialized from any files already present.
func New(dir string) (*Cache, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create cache dir %q: %w", dir, err)
	}

	c := &Cache{dir: dir}
	if err := c.scan(); err != nil {
		return nil, fmt.Errorf("scan cache dir %q: %w", dir, err)
	}
	return c, nil
}

func (c *Cache) scan() error {
	entries, err := os.ReadDir(c.dir)
	if err != nil {
		return err
	}

	var files int
	var total int64
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		files++
		total += info.Size()
	}

	c.mu.Lock()
	c.files = files
	c.bytes = total
	c.mu.Unlock()
	return nil
}

// Key derives the deterministic cache filename for a seed.
func Key(seed string) string {
	sum := sha256.Sum256([]byte(seed))
	return hex.EncodeToString(sum[:]) + ".png"
}

func (c *Cache) path(key string) string {
	return filepath.Join(c.dir, key)
}

// Get reads a cached PNG by key. The second return value is false on a miss
// (including any read error, which is treated as a cache miss).
func (c *Cache) Get(key string) ([]byte, bool) {
	data, err := os.ReadFile(c.path(key))
	if err != nil {
		return nil, false
	}
	return data, true
}

// Put writes data under key. It writes to a temporary file in the same
// directory and atomically renames it into place, so concurrent readers
// never observe a partially written file.
//
// Since a given seed always generates identical bytes, two concurrent
// misses for the same key racing each other is harmless for the cached
// content, but the size counters would be double-counted if both raced past
// a naive existence check; Put stats a fresh key just before the rename to
// keep that race narrow rather than adding cross-request locking for what
// is, at worst, a momentarily-off metric.
func (c *Cache) Put(key string, data []byte) error {
	tmp, err := os.CreateTemp(c.dir, "."+key+".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op once the rename below succeeds

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}

	_, statErr := os.Stat(c.path(key))
	existed := statErr == nil

	if err := os.Rename(tmpName, c.path(key)); err != nil {
		return err
	}

	if !existed {
		c.mu.Lock()
		c.files++
		c.bytes += int64(len(data))
		c.mu.Unlock()
	}
	return nil
}

// Stats returns the current number of cached files and their total size in
// bytes, as tracked in-process.
func (c *Cache) Stats() (files int, bytes int64) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.files, c.bytes
}
