package dates

import (
	"testing"
	"time"
)

func TestTodayUsesPacificBoundary(t *testing.T) {
	// 2026-10-24 06:59 UTC is 23:59 PDT on the 23rd.
	if got := Today(time.Date(2026, 10, 24, 6, 59, 0, 0, time.UTC)); got != "2026-10-23" {
		t.Fatalf("got %s", got)
	}
	if got := Today(time.Date(2026, 10, 24, 7, 0, 0, 0, time.UTC)); got != "2026-10-24" {
		t.Fatalf("got %s", got)
	}
}

func TestDeadlineIsThreeAMPacificNextDay(t *testing.T) {
	started := time.Date(2026, 10, 24, 20, 0, 0, 0, time.UTC) // 13:00 PDT on the 24th
	want := time.Date(2026, 10, 25, 3, 0, 0, 0, Pacific).UTC()
	if got := Deadline(started); !got.Equal(want) {
		t.Fatalf("got %s want %s", got, want)
	}
	// DST ends 2026-11-01: 3 a.m. PST on the 2nd is 11:00 UTC.
	started = time.Date(2026, 11, 1, 20, 0, 0, 0, time.UTC)
	if got := Deadline(started); !got.Equal(time.Date(2026, 11, 2, 11, 0, 0, 0, time.UTC)) {
		t.Fatalf("dst deadline %s", got)
	}
}

func TestPlayable(t *testing.T) {
	now := time.Date(2026, 10, 24, 18, 0, 0, 0, time.UTC)
	for date, ok := range map[string]bool{
		"2026-10-24": true, "2026-10-01": true, "2026-09-30": false,
		"2026-10-25": false, "nonsense": false, "2026-02-30": false,
	} {
		if (Playable(date, now) == nil) != ok {
			t.Errorf("Playable(%s) = %v, want ok=%v", date, Playable(date, now), ok)
		}
	}
	if got := Range(now); len(got) != 24 || got[0] != "2026-10-24" || got[23] != "2026-10-01" {
		t.Fatalf("range: %v", got)
	}
}
