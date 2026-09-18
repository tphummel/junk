package cache

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestKeyDeterministicAndSafe(t *testing.T) {
	k1 := Key("seed-a")
	k2 := Key("seed-a")
	if k1 != k2 {
		t.Fatalf("Key not deterministic: %q != %q", k1, k2)
	}
	if Key("seed-a") == Key("seed-b") {
		t.Fatal("different seeds produced the same key")
	}
	if !strings.HasSuffix(k1, ".png") {
		t.Fatalf("key %q missing .png suffix", k1)
	}
	if strings.ContainsAny(k1, "/\\") {
		t.Fatalf("key %q contains a path separator", k1)
	}
}

func TestPutGetRoundTrip(t *testing.T) {
	dir := t.TempDir()
	c, err := New(dir)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	key := Key("hello")
	if _, ok := c.Get(key); ok {
		t.Fatal("expected miss before Put")
	}

	data := []byte("fake-png-bytes")
	if err := c.Put(key, data); err != nil {
		t.Fatalf("Put: %v", err)
	}

	got, ok := c.Get(key)
	if !ok {
		t.Fatal("expected hit after Put")
	}
	if !bytes.Equal(got, data) {
		t.Fatalf("got %q, want %q", got, data)
	}

	files, sz := c.Stats()
	if files != 1 {
		t.Fatalf("files = %d, want 1", files)
	}
	if sz != int64(len(data)) {
		t.Fatalf("bytes = %d, want %d", sz, len(data))
	}
}

func TestPutLeavesNoTempFiles(t *testing.T) {
	dir := t.TempDir()
	c, err := New(dir)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := c.Put(Key("x"), []byte("data")); err != nil {
		t.Fatalf("Put: %v", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d entries in cache dir, want 1: %v", len(entries), entries)
	}
	if entries[0].Name() != Key("x") {
		t.Fatalf("got file %q, want %q", entries[0].Name(), Key("x"))
	}
}

func TestNewScansExistingFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "preexisting.png"), []byte("abc"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	c, err := New(dir)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	files, sz := c.Stats()
	if files != 1 || sz != 3 {
		t.Fatalf("got files=%d bytes=%d, want files=1 bytes=3", files, sz)
	}
}
