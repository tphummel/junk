package osm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Overpass is a read-only client.
type Overpass struct {
	URL       string
	UserAgent string
	HTTP      *http.Client
}

// NewOverpass builds a client with a sane timeout.
func NewOverpass(endpoint, userAgent string) *Overpass {
	return &Overpass{URL: endpoint, UserAgent: userAgent, HTTP: &http.Client{Timeout: 30 * time.Second}}
}

type overpassResp struct {
	Elements []struct {
		Type    string                      `json:"type"`
		ID      int64                       `json:"id"`
		Version int64                       `json:"version"`
		Lat     float64                     `json:"lat"`
		Lon     float64                     `json:"lon"`
		Center  *struct{ Lat, Lon float64 } `json:"center"`
		Tags    map[string]string           `json:"tags"`
	} `json:"elements"`
}

func (o *Overpass) query(ctx context.Context, ql string) ([]Element, error) {
	form := url.Values{"data": {ql}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.URL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", o.UserAgent)
	resp, err := o.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("overpass: status %d", resp.StatusCode)
	}
	var r overpassResp
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, fmt.Errorf("overpass: bad response: %w", err)
	}
	out := make([]Element, 0, len(r.Elements))
	for _, e := range r.Elements {
		el := Element{Type: e.Type, ID: e.ID, Version: e.Version, Lat: e.Lat, Lon: e.Lon, Tags: e.Tags}
		if e.Center != nil {
			el.Lat, el.Lon = e.Center.Lat, e.Center.Lon
		}
		if el.Tags == nil {
			el.Tags = map[string]string{}
		}
		out = append(out, el)
	}
	return out, nil
}

// ErrNoElement is returned when Get finds nothing (deleted upstream?).
var ErrNoElement = errors.New("osm element not found")

// Get fetches one element by type and id.
func (o *Overpass) Get(ctx context.Context, typ string, id int64) (Element, error) {
	if typ != "node" && typ != "way" && typ != "relation" {
		return Element{}, fmt.Errorf("bad osm type %q", typ)
	}
	els, err := o.query(ctx, fmt.Sprintf(`[out:json][timeout:25];%s(%d);out center meta;`, typ, id))
	if err != nil {
		return Element{}, err
	}
	if len(els) == 0 {
		return Element{}, ErrNoElement
	}
	return els[0], nil
}

// qlEscape escapes a string for use inside an Overpass QL double-quoted string.
func qlEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", " ").Replace(s)
}

var regexMeta = regexp.MustCompile(`[.^$*+?()\[\]{}|\\]`)

const kindFilter = `["name"][~"^(amenity|shop|tourism|leisure|craft|office|historic)$"~"."]`

// Search finds named POIs. With a position it searches around it (radius metres);
// without one it falls back to a (slow, best-effort) global name match.
func (o *Overpass) Search(ctx context.Context, term string, lat, lon *float64, radius int) ([]Element, error) {
	term = strings.TrimSpace(term)
	nameRe := ""
	if term != "" {
		nameRe = fmt.Sprintf(`["name"~"%s",i]`, qlEscape(regexMeta.ReplaceAllString(term, `\$0`)))
	}
	var ql string
	switch {
	case lat != nil && lon != nil:
		ql = fmt.Sprintf(`[out:json][timeout:20];nwr(around:%d,%.6f,%.6f)%s%s;out center meta 25;`, radius, *lat, *lon, kindFilter, nameRe)
	case term != "":
		ql = fmt.Sprintf(`[out:json][timeout:20];nwr%s%s;out center meta 20;`, nameRe, `[~"^(amenity|shop|tourism|leisure)$"~"."]`)
	default:
		return nil, nil
	}
	return o.query(ctx, ql)
}

// Around lists named features within radius metres of a point (reconcile).
func (o *Overpass) Around(ctx context.Context, lat, lon float64, radius int) ([]Element, error) {
	return o.query(ctx, fmt.Sprintf(`[out:json][timeout:20];nwr(around:%d,%.6f,%.6f)["name"];out center meta 50;`, radius, lat, lon))
}
