package main

import (
	"context"
	"log"
	"time"
)

// runWriter buffers sightings from in and flushes them to the store every
// flushEvery or once flushRows are pending, whichever comes first. It drains
// and flushes whatever is left when in is closed or ctx is cancelled.
func runWriter(ctx context.Context, st *store, in <-chan sighting, flushEvery time.Duration, flushRows int) {
	buf := make([]sighting, 0, flushRows)
	flush := func() {
		if len(buf) == 0 {
			return
		}
		if err := st.Write(buf); err != nil {
			log.Printf("flush %d rows: %v", len(buf), err)
		}
		buf = buf[:0]
	}
	t := time.NewTicker(flushEvery)
	defer t.Stop()
	defer flush()
	for {
		select {
		case s, ok := <-in:
			if !ok {
				return
			}
			buf = append(buf, s)
			if len(buf) >= flushRows {
				flush()
			}
		case <-t.C:
			flush()
		case <-ctx.Done():
			for {
				select {
				case s, ok := <-in:
					if !ok {
						return
					}
					buf = append(buf, s)
				default:
					return
				}
			}
		}
	}
}
