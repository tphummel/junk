package main

import (
	"strings"
	"time"
)

// throttle limits how often noisy updates are recorded per address.
type throttle struct {
	min  time.Duration
	last map[string]float64 // addr -> ts of last recorded event
}

func newThrottle(min time.Duration) *throttle {
	return &throttle{min: min, last: map[string]float64{}}
}

// noisy lists the properties that change on nearly every advertisement.
// Updates touching only these are subject to the minimum interval; any other
// change (first sighting, name, alias, UUIDs, TxPower, ...) is always recorded.
var noisy = map[string]bool{"RSSI": true, "ManufacturerData": true, "ServiceData": true}

// Allow reports whether a sighting of addr at ts with the given changed list
// (see sighting.Changed) should be recorded, and notes it if so.
func (t *throttle) Allow(addr string, ts float64, changed string) bool {
	if t.min <= 0 {
		return true
	}
	last, seen := t.last[addr]
	if seen && ts-last < t.min.Seconds() && onlyNoisy(changed) {
		return false
	}
	t.last[addr] = ts
	return true
}

func onlyNoisy(changed string) bool {
	if changed == "" || changed == "added" {
		return false
	}
	for _, p := range strings.Split(changed, ";") {
		if !noisy[p] {
			return false
		}
	}
	return true
}
