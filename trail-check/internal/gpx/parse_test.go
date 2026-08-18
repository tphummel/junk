package gpx

import "testing"

const twoSegmentGPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>test</name>
    <trkseg>
      <trkpt lat="34.00" lon="-118.50"></trkpt>
      <trkpt lat="34.01" lon="-118.49"></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="35.00" lon="-119.50"></trkpt>
      <trkpt lat="35.01" lon="-119.49"></trkpt>
      <trkpt lat="35.02" lon="-119.48"></trkpt>
    </trkseg>
  </trk>
</gpx>`

func TestParsePreservesSegmentBreaks(t *testing.T) {
	runs, err := Parse([]byte(twoSegmentGPX))
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 2 {
		t.Fatalf("expected 2 segments, got %d", len(runs))
	}
	if len(runs[0]) != 2 || len(runs[1]) != 3 {
		t.Fatalf("unexpected point counts: %d, %d", len(runs[0]), len(runs[1]))
	}
	if runs[0][0].Lat != 34.00 || runs[0][0].Lon != -118.50 {
		t.Fatalf("unexpected first point: %+v", runs[0][0])
	}
}

func TestParseEmptyGPX(t *testing.T) {
	const empty = `<?xml version="1.0"?><gpx version="1.1" creator="test"></gpx>`
	if _, err := Parse([]byte(empty)); err != ErrNoTrackPoints {
		t.Fatalf("got %v, want ErrNoTrackPoints", err)
	}
}

func TestParseInvalidXML(t *testing.T) {
	if _, err := Parse([]byte("not xml")); err == nil {
		t.Fatal("expected an error parsing invalid XML")
	}
}
