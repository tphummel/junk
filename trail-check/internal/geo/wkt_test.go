package geo

import "testing"

func TestLineStringWKT(t *testing.T) {
	got, err := LineStringWKT([]Point{{Lat: 34.0, Lon: -118.5}, {Lat: 34.1, Lon: -118.4}})
	if err != nil {
		t.Fatal(err)
	}
	want := "LINESTRING(-118.5000000 34.0000000, -118.4000000 34.1000000)"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestLineStringWKTTooFewPoints(t *testing.T) {
	if _, err := LineStringWKT([]Point{{Lat: 34.0, Lon: -118.5}}); err != ErrTooFewPoints {
		t.Fatalf("got %v, want ErrTooFewPoints", err)
	}
	if _, err := LineStringWKT(nil); err != ErrTooFewPoints {
		t.Fatalf("got %v, want ErrTooFewPoints", err)
	}
}

func TestLineStringWKTDedupesConsecutivePoints(t *testing.T) {
	pts := []Point{{Lat: 34.0, Lon: -118.5}, {Lat: 34.0, Lon: -118.5}, {Lat: 34.1, Lon: -118.4}}
	got, err := LineStringWKT(pts)
	if err != nil {
		t.Fatal(err)
	}
	want := "LINESTRING(-118.5000000 34.0000000, -118.4000000 34.1000000)"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestMultiLineStringWKT(t *testing.T) {
	lines := [][]Point{
		{{Lat: 34.0, Lon: -118.5}, {Lat: 34.1, Lon: -118.4}},
		{{Lat: 35.0, Lon: -119.5}, {Lat: 35.1, Lon: -119.4}},
	}
	got, err := MultiLineStringWKT(lines)
	if err != nil {
		t.Fatal(err)
	}
	want := "MULTILINESTRING((-118.5000000 34.0000000, -118.4000000 34.1000000), (-119.5000000 35.0000000, -119.4000000 35.1000000))"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestMultiLineStringWKTSkipsDegenerateRuns(t *testing.T) {
	lines := [][]Point{
		{{Lat: 34.0, Lon: -118.5}}, // single point, dropped
		{{Lat: 35.0, Lon: -119.5}, {Lat: 35.1, Lon: -119.4}},
	}
	got, err := MultiLineStringWKT(lines)
	if err != nil {
		t.Fatal(err)
	}
	want := "MULTILINESTRING((-119.5000000 35.0000000, -119.4000000 35.1000000))"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestMultiLineStringWKTNoUsableLines(t *testing.T) {
	if _, err := MultiLineStringWKT([][]Point{{{Lat: 1, Lon: 1}}, nil}); err != ErrNoLines {
		t.Fatalf("got %v, want ErrNoLines", err)
	}
}
