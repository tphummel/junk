// Package geo builds WKT geometry literals from plain lat/lon points so the
// database layer can hand them straight to SpatiaLite's GeomFromText().
package geo

import (
	"errors"
	"strconv"
	"strings"
)

// ErrTooFewPoints is returned when a line cannot be built from fewer than 2 points.
var ErrTooFewPoints = errors.New("geo: at least 2 points are required to build a line")

// ErrNoLines is returned when no usable line strings were supplied.
var ErrNoLines = errors.New("geo: no usable line segments supplied")

// Point is a single WGS84 (SRID 4326) coordinate.
type Point struct {
	Lat float64
	Lon float64
}

// dedupe drops consecutive duplicate points, which GPS devices commonly emit
// while stationary and which otherwise produce degenerate zero-length segments.
func dedupe(points []Point) []Point {
	out := make([]Point, 0, len(points))
	for _, p := range points {
		if n := len(out); n > 0 && out[n-1] == p {
			continue
		}
		out = append(out, p)
	}
	return out
}

func writeLineBody(b *strings.Builder, points []Point) {
	for i, p := range points {
		if i > 0 {
			b.WriteString(", ")
		}
		b.WriteString(strconv.FormatFloat(p.Lon, 'f', 7, 64))
		b.WriteByte(' ')
		b.WriteString(strconv.FormatFloat(p.Lat, 'f', 7, 64))
	}
}

// LineStringWKT builds a WKT LINESTRING literal from an ordered list of points.
func LineStringWKT(points []Point) (string, error) {
	points = dedupe(points)
	if len(points) < 2 {
		return "", ErrTooFewPoints
	}
	var b strings.Builder
	b.WriteString("LINESTRING(")
	writeLineBody(&b, points)
	b.WriteString(")")
	return b.String(), nil
}

// MultiLineStringWKT builds a WKT MULTILINESTRING literal from a list of point
// runs (e.g. one run per GPX track segment). Runs with fewer than 2 points
// after de-duplication are skipped.
func MultiLineStringWKT(lines [][]Point) (string, error) {
	var b strings.Builder
	b.WriteString("MULTILINESTRING(")
	written := 0
	for _, line := range lines {
		line = dedupe(line)
		if len(line) < 2 {
			continue
		}
		if written > 0 {
			b.WriteString(", ")
		}
		b.WriteString("(")
		writeLineBody(&b, line)
		b.WriteString(")")
		written++
	}
	b.WriteString(")")
	if written == 0 {
		return "", ErrNoLines
	}
	return b.String(), nil
}
