// Package osm talks to OpenStreetMap: Overpass for reads, API 0.6 for writes.
package osm

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"sworn/internal/store"
)

// Element is a node/way/relation snapshot.
type Element struct {
	Type    string            `json:"type"`
	ID      int64             `json:"id"`
	Version int64             `json:"version"`
	Lat     float64           `json:"lat"`
	Lon     float64           `json:"lon"`
	Tags    map[string]string `json:"tags"`
}

// categoryKeys are the tag keys that define a venue's category, in priority order.
var categoryKeys = []string{"amenity", "shop", "tourism", "leisure", "craft", "office", "historic", "healthcare", "sport"}

// Category returns "key=value" for the element's primary category, or "".
func (e Element) Category() string {
	for _, k := range categoryKeys {
		if v := e.Tags[k]; v != "" {
			return k + "=" + v
		}
	}
	return ""
}

func first(tags map[string]string, keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(tags[k]); v != "" {
			return v
		}
	}
	return ""
}

// Fields derives the venue columns from OSM tags.
func (e Element) Fields() store.VenueFields {
	t := e.Tags
	addr := first(t, "addr:full")
	if addr == "" {
		addr = strings.TrimSpace(first(t, "addr:housenumber") + " " + first(t, "addr:street"))
	}
	return store.VenueFields{
		Name:     first(t, "name"),
		Address:  addr,
		City:     first(t, "addr:city", "addr:town", "addr:village"),
		Country:  first(t, "addr:country"),
		Category: e.Category(),
		Cuisine:  first(t, "cuisine"),
		Website:  first(t, "website", "contact:website"),
		Phone:    first(t, "phone", "contact:phone"),
		Lat:      e.Lat,
		Lon:      e.Lon,
	}
}

// TagsJSON is the snapshot stored in venues.osm_tags.
func (e Element) TagsJSON() string {
	b, _ := json.Marshal(e.Tags)
	return string(b)
}

// TagsFromVenue builds the tag set used to create a brand new node.
func TagsFromVenue(f store.VenueFields) map[string]string {
	t := map[string]string{}
	set := func(k, v string) {
		if v = strings.TrimSpace(v); v != "" {
			t[k] = v
		}
	}
	set("name", f.Name)
	set("addr:full", f.Address)
	set("addr:city", f.City)
	set("cuisine", f.Cuisine)
	set("website", f.Website)
	set("phone", f.Phone)
	if k, v, ok := strings.Cut(f.Category, "="); ok {
		set(strings.TrimSpace(k), v)
	}
	return t
}

// Change is the set of edits needed to bring an element in line with a venue.
type Change struct {
	Tags      map[string]string // tag key -> new value
	Moved     bool
	Lat, Lon  float64
	FieldKeys []string // human-readable list of venue fields that differ
}

// Empty reports whether nothing needs pushing.
func (c Change) Empty() bool { return len(c.Tags) == 0 && !c.Moved }

// Diff compares the pushable venue fields against what the (last pulled) element
// says. Blank local values never delete OSM data.
func Diff(el Element, v store.VenueFields) Change {
	cur := el.Fields()
	c := Change{Tags: map[string]string{}}
	check := func(field, key, local, remote string) {
		if local = strings.TrimSpace(local); local != "" && local != remote {
			c.Tags[key] = local
			c.FieldKeys = append(c.FieldKeys, field)
		}
	}
	check("name", "name", v.Name, cur.Name)
	check("address", "addr:full", v.Address, cur.Address)
	check("city", "addr:city", v.City, cur.City)
	check("cuisine", "cuisine", v.Cuisine, cur.Cuisine)
	check("website", "website", v.Website, cur.Website)
	check("phone", "phone", v.Phone, cur.Phone)
	if k, val, ok := strings.Cut(v.Category, "="); ok && v.Category != cur.Category {
		c.Tags[strings.TrimSpace(k)] = strings.TrimSpace(val)
		c.FieldKeys = append(c.FieldKeys, "category")
	}
	if el.Type == "node" && (math.Abs(v.Lat-el.Lat) > 1e-7 || math.Abs(v.Lon-el.Lon) > 1e-7) {
		c.Moved, c.Lat, c.Lon = true, v.Lat, v.Lon
		c.FieldKeys = append(c.FieldKeys, "lat", "lon")
	}
	return c
}

// ElementFromVenue rebuilds the last pulled element from a stored venue snapshot.
func ElementFromVenue(v *store.Venue) Element {
	e := Element{Type: v.OSMType, ID: v.OSMID, Version: v.OSMVersion, Lat: v.Lat, Lon: v.Lon, Tags: map[string]string{}}
	_ = json.Unmarshal([]byte(v.OSMTags), &e.Tags)
	return e
}

// Levenshtein is the edit distance between two strings (case-insensitive).
func Levenshtein(a, b string) int {
	ra, rb := []rune(strings.ToLower(a)), []rune(strings.ToLower(b))
	prev := make([]int, len(rb)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ra); i++ {
		cur := make([]int, len(rb)+1)
		cur[0] = i
		for j := 1; j <= len(rb); j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev = cur
	}
	return prev[len(rb)]
}

// URL is the openstreetmap.org page for the element.
func (e Element) URL() string {
	return fmt.Sprintf("https://www.openstreetmap.org/%s/%d", e.Type, e.ID)
}
