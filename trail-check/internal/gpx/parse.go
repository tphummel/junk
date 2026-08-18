// Package gpx parses uploaded GPX files into the geo package's point runs.
package gpx

import (
	"errors"

	"github.com/tkrajina/gpxgo/gpx"

	"trail-check/internal/geo"
)

// ErrNoTrackPoints is returned when a GPX file contains no usable track points.
var ErrNoTrackPoints = errors.New("gpx: file contains no track points")

// Parse reads raw GPX bytes and returns one point run per track segment,
// preserving segment breaks (e.g. from a paused recording) so the caller can
// build a MULTILINESTRING rather than falsely joining unrelated stretches.
func Parse(data []byte) ([][]geo.Point, error) {
	g, err := gpx.ParseBytes(data)
	if err != nil {
		return nil, err
	}

	var runs [][]geo.Point
	for _, track := range g.Tracks {
		for _, segment := range track.Segments {
			if len(segment.Points) == 0 {
				continue
			}
			points := make([]geo.Point, 0, len(segment.Points))
			for _, p := range segment.Points {
				points = append(points, geo.Point{Lat: p.Latitude, Lon: p.Longitude})
			}
			runs = append(runs, points)
		}
	}

	if len(runs) == 0 {
		return nil, ErrNoTrackPoints
	}
	return runs, nil
}
