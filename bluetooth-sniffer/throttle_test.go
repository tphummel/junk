package main

import (
	"testing"
	"time"
)

func TestThrottle(t *testing.T) {
	th := newThrottle(10 * time.Second)
	cases := []struct {
		addr    string
		ts      float64
		changed string
		want    bool
	}{
		{"A", 0, "added", true},
		{"A", 1, "ManufacturerData;RSSI", false},
		{"A", 9.9, "RSSI", false},
		{"A", 5, "Name;RSSI", true}, // identity change passes
		{"A", 14, "RSSI", false},    // window restarted at 5
		{"A", 15, "RSSI;ServiceData", true},
		{"B", 16, "RSSI", true}, // first sighting of B
		{"A", 16, "added", true},
	}
	for i, c := range cases {
		if got := th.Allow(c.addr, c.ts, c.changed); got != c.want {
			t.Errorf("case %d (%s @%v %q): got %v want %v", i, c.addr, c.ts, c.changed, got, c.want)
		}
	}
	off := newThrottle(0)
	for i := 0; i < 3; i++ {
		if !off.Allow("A", float64(i), "RSSI") {
			t.Error("min 0 should allow everything")
		}
	}
}
