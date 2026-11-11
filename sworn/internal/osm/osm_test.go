package osm

import (
	"context"
	"encoding/xml"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"sworn/internal/store"
)

func TestFieldsAndDiff(t *testing.T) {
	el := Element{Type: "node", ID: 1, Lat: 51.5, Lon: -0.1, Tags: map[string]string{
		"name": "Joe's", "amenity": "pub", "addr:housenumber": "151", "addr:street": "Great Pudding Ln",
		"addr:city": "London", "contact:website": "https://j.example"}}
	f := el.Fields()
	if f.Category != "amenity=pub" || f.Address != "151 Great Pudding Ln" || f.Website != "https://j.example" || f.City != "London" {
		t.Fatalf("fields: %+v", f)
	}
	if !Diff(el, f).Empty() {
		t.Fatal("identical venue should produce no change")
	}
	f.Phone, f.Name, f.Lat, f.Cuisine = "+44 1", "Joe's Pub", 51.6, ""
	ch := Diff(el, f)
	if ch.Tags["phone"] != "+44 1" || ch.Tags["name"] != "Joe's Pub" || !ch.Moved || len(ch.Tags) != 2 {
		t.Fatalf("diff: %+v", ch)
	}
	// Blank local values never delete OSM data.
	f2 := el.Fields()
	f2.City = ""
	if !Diff(el, f2).Empty() {
		t.Fatal("blank local city must not push")
	}
	// Ways cannot be moved.
	way := el
	way.Type = "way"
	g := way.Fields()
	g.Lat = 0
	if Diff(way, g).Moved {
		t.Fatal("ways must not move")
	}
	tags := TagsFromVenue(store.VenueFields{Name: " Cafe ", Category: "amenity=cafe", Website: "https://c.example"})
	if tags["amenity"] != "cafe" || tags["name"] != "Cafe" || len(tags) != 3 {
		t.Fatalf("tags: %v", tags)
	}
}

func TestLevenshtein(t *testing.T) {
	for _, c := range []struct {
		a, b string
		d    int
	}{{"Joe's Pub", "joe's pub", 0}, {"Cafe", "Café", 1}, {"kitten", "sitting", 3}, {"", "abc", 3}, {"Starbucks", "Starbuck", 1}} {
		if got := Levenshtein(c.a, c.b); got != c.d {
			t.Errorf("%q/%q = %d want %d", c.a, c.b, got, c.d)
		}
	}
}

func TestOverpassClient(t *testing.T) {
	var gotQL string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		gotQL = r.FormValue("data")
		if !strings.Contains(r.UserAgent(), "Sworn") {
			t.Error("missing UA")
		}
		io.WriteString(w, `{"elements":[
		 {"type":"node","id":1,"version":3,"lat":1,"lon":2,"tags":{"name":"A","amenity":"cafe"}},
		 {"type":"way","id":2,"version":1,"center":{"lat":5,"lon":6},"tags":{"name":"B","shop":"books"}}]}`)
	}))
	defer srv.Close()
	o := NewOverpass(srv.URL, "Sworn/test")
	lat, lon := 51.5, -0.12
	els, err := o.Search(context.Background(), `a.b("c")`, &lat, &lon, 500)
	if err != nil || len(els) != 2 || els[1].Lat != 5 || els[0].Version != 3 {
		t.Fatalf("els=%+v err=%v", els, err)
	}
	if !strings.Contains(gotQL, `around:500,51.500000,-0.120000`) || !strings.Contains(gotQL, `a\\.b(\\\"c\\\")`) && !strings.Contains(gotQL, `\\.`) {
		t.Fatalf("query not escaped/targeted: %s", gotQL)
	}
	if _, err := o.Get(context.Background(), "bogus", 1); err == nil {
		t.Fatal("bad type accepted")
	}
}

func TestWriterCreateNodeAndBackoff(t *testing.T) {
	var calls []string
	var tooMany atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		calls = append(calls, r.Method+" "+r.URL.Path)
		if r.Header.Get("Authorization") != "Bearer secret" {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/changeset/create":
			if tooMany.Add(1) == 1 { // first attempt is rate limited
				w.WriteHeader(429)
				return
			}
			if !strings.Contains(string(body), "Sworn (box)") {
				t.Errorf("changeset comment missing: %s", body)
			}
			io.WriteString(w, "777")
		case "/node/create":
			if !strings.Contains(string(body), `changeset="777"`) || !strings.Contains(string(body), `k="name" v="Cafe"`) {
				t.Errorf("node xml: %s", body)
			}
			io.WriteString(w, "4242")
		case "/changeset/777/close":
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	w := NewWriter(srv.URL, "secret", "box", "Sworn/test", 5*time.Millisecond)
	id, err := w.CreateNode(context.Background(), 1.5, 2.5, map[string]string{"name": "Cafe", "amenity": "cafe"})
	if err != nil || id != 4242 {
		t.Fatalf("id=%d err=%v", id, err)
	}
	if tooMany.Load() != 2 {
		t.Fatalf("expected a retry after 429, calls=%v", calls)
	}
	if calls[len(calls)-1] != "PUT /changeset/777/close" {
		t.Fatalf("changeset not closed: %v", calls)
	}
	if _, err := NewWriter(srv.URL, "", "box", "ua", 0).CreateNode(context.Background(), 0, 0, nil); err != ErrNotConfigured {
		t.Fatalf("want ErrNotConfigured, got %v", err)
	}
}

func TestWriterUpdateElementPreservesStructure(t *testing.T) {
	var put string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		switch {
		case r.Method == "GET" && r.URL.Path == "/way/9":
			io.WriteString(w, `<osm><way id="9" version="4" changeset="1" user="x"><nd ref="1"/><nd ref="2"/><tag k="name" v="Old"/><tag k="other" v="keep"/></way></osm>`)
		case r.URL.Path == "/changeset/create":
			io.WriteString(w, "5")
		case r.Method == "PUT" && r.URL.Path == "/way/9":
			put = string(body)
			io.WriteString(w, "5")
		}
	}))
	defer srv.Close()
	w := NewWriter(srv.URL, "t", "h", "ua", 0)
	ver, err := w.UpdateElement(context.Background(), "way", 9, Change{Tags: map[string]string{"name": "New"}})
	if err != nil || ver != 5 {
		t.Fatalf("ver=%d err=%v", ver, err)
	}
	var doc xOSM
	if err := xml.Unmarshal([]byte(put), &doc); err != nil || len(doc.Ways) != 1 {
		t.Fatalf("put xml: %s (%v)", put, err)
	}
	way := doc.Ways[0]
	tags := map[string]string{}
	for _, tg := range way.Tags {
		tags[tg.K] = tg.V
	}
	if len(way.Nds) != 2 || way.Version != 4 || way.Changeset != 5 || tags["name"] != "New" || tags["other"] != "keep" {
		t.Fatalf("lost data: %+v", way)
	}
}
