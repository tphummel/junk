// Package dates holds the daily-deal calendar rules: a day is a calendar date
// in America/Los_Angeles, a game must be started on or after the epoch, and
// an in-progress game can be finished until 3:00 a.m. Pacific the morning
// after the day it was started.
package dates

import (
	"fmt"
	"time"
	_ "time/tzdata" // the distroless image has no zoneinfo files
)

// Layout is the date format used for deal dates.
const Layout = "2006-01-02"

// Epoch is the first playable date.
const Epoch = "2026-10-01"

// GraceHour is the hour (Pacific) the next morning at which unfinished games
// are closed as losses.
const GraceHour = 3

// Pacific is the zone that defines the day boundary.
var Pacific = mustLoad("America/Los_Angeles")

func mustLoad(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(fmt.Sprintf("dates: load %s: %v", name, err))
	}
	return loc
}

// Today is the current deal date.
func Today(now time.Time) string { return now.In(Pacific).Format(Layout) }

// Yesterday is the deal date before today.
func Yesterday(now time.Time) string { return now.In(Pacific).AddDate(0, 0, -1).Format(Layout) }

// Deadline is when a game started at the given time is closed as a loss: 3:00
// a.m. Pacific on the day after it was started.
func Deadline(started time.Time) time.Time {
	p := started.In(Pacific)
	return time.Date(p.Year(), p.Month(), p.Day()+1, GraceHour, 0, 0, 0, Pacific).UTC()
}

// Parse validates a deal date string.
func Parse(date string) (time.Time, error) {
	t, err := time.ParseInLocation(Layout, date, Pacific)
	if err != nil || t.Format(Layout) != date {
		return time.Time{}, fmt.Errorf("dates: bad date %q", date)
	}
	return t, nil
}

// Playable reports whether a game for date may be started at now: any date
// from the epoch through today.
func Playable(date string, now time.Time) error {
	if _, err := Parse(date); err != nil {
		return err
	}
	if date < Epoch {
		return fmt.Errorf("dates: %s is before the first deal (%s)", date, Epoch)
	}
	if date > Today(now) {
		return fmt.Errorf("dates: %s has not been dealt yet", date)
	}
	return nil
}

// Range lists deal dates from the epoch through today, newest first.
func Range(now time.Time) []string {
	end, _ := Parse(Today(now))
	start, _ := Parse(Epoch)
	var out []string
	for d := end; !d.Before(start); d = d.AddDate(0, 0, -1) {
		out = append(out, d.Format(Layout))
	}
	return out
}
