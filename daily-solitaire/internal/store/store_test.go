package store

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func openTest(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestNewIDIsSortableULID(t *testing.T) {
	a := NewID(time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC))
	b := NewID(time.Date(2026, 10, 24, 0, 0, 1, 0, time.UTC))
	if len(a) != 26 || strings.Trim(a, crockford) != "" {
		t.Fatalf("bad ulid %q", a)
	}
	if !(a < b) {
		t.Fatalf("not time ordered: %s %s", a, b)
	}
}

func TestMigrationsAreIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	for i := 0; i < 2; i++ {
		s, err := Open(path)
		if err != nil {
			t.Fatalf("open #%d: %v", i, err)
		}
		s.Close()
	}
}

// fixedClock returns a controllable clock set to 2026-10-24 12:00 PDT.
func fixedClock(s *Store) *time.Time {
	now := time.Date(2026, 10, 24, 19, 0, 0, 0, time.UTC)
	s.SetClock(func() time.Time { return now })
	return &now
}
