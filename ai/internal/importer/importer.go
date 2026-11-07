// Package importer loads Foursquare JSON and Swarm CSV exports.
package importer

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"venuecheck/internal/store"
)

// Row is one normalised historical check-in.
type Row struct {
	FoursquareID string
	Name         string
	Lat, Lon     float64
	Address      string
	City         string
	Country      string
	Category     string
	At           time.Time
	Note         string
	Photos       []string
}

// Result summarises an import run.
type Result struct {
	Rows, Imported, Skipped, VenuesCreated int
	Errors                                 []string
}

// ParseTime accepts RFC3339, "2006-01-02 15:04:05", unix seconds or unix milliseconds.
func ParseTime(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, errors.New("empty timestamp")
	}
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		if n > 1e11 { // milliseconds
			return time.UnixMilli(n).UTC(), nil
		}
		return time.Unix(n, 0).UTC(), nil
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05", "2006-01-02T15:04:05", "2006-01-02 15:04", "2006-01-02"} {
		if t, err := time.ParseInLocation(layout, s, time.UTC); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("unrecognised timestamp %q", s)
}

type jsonVenue struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Location struct {
		Lat     float64 `json:"lat"`
		Lng     float64 `json:"lng"`
		Address string  `json:"address"`
		City    string  `json:"city"`
		CC      string  `json:"cc"`
		Country string  `json:"country"`
	} `json:"location"`
	Categories []struct {
		Name string `json:"name"`
	} `json:"categories"`
}

type jsonItem struct {
	CreatedAt json.RawMessage `json:"createdAt"`
	Timestamp json.RawMessage `json:"timestamp"`
	Text      string          `json:"text"`
	Shout     string          `json:"shout"`
	Venue     jsonVenue       `json:"venue"`
	Photos    struct {
		Items []struct {
			URL    string `json:"url"`
			Prefix string `json:"prefix"`
			Suffix string `json:"suffix"`
		} `json:"items"`
	} `json:"photos"`
}

// ParseJSON reads a Foursquare export: a top-level array, or an object with
// "items", "tips" or "checkins" (optionally nested under "checkins").
func ParseJSON(r io.Reader) ([]Row, []string, error) {
	raw, err := io.ReadAll(io.LimitReader(r, 256<<20))
	if err != nil {
		return nil, nil, err
	}
	var items []jsonItem
	if err := json.Unmarshal(raw, &items); err != nil {
		var obj map[string]json.RawMessage
		if err := json.Unmarshal(raw, &obj); err != nil {
			return nil, nil, fmt.Errorf("not valid JSON: %w", err)
		}
		found := false
		for _, k := range []string{"items", "tips", "checkins"} {
			v, ok := obj[k]
			if !ok {
				continue
			}
			if err := json.Unmarshal(v, &items); err == nil {
				found = true
				break
			}
			var nested struct {
				Items []jsonItem `json:"items"`
			}
			if err := json.Unmarshal(v, &nested); err == nil {
				items, found = nested.Items, true
				break
			}
		}
		if !found {
			return nil, nil, errors.New(`JSON must be an array or contain "items", "tips" or "checkins"`)
		}
	}
	var rows []Row
	var errs []string
	for i, it := range items {
		ts := strings.Trim(string(firstRaw(it.CreatedAt, it.Timestamp)), `"`)
		at, err := ParseTime(ts)
		if err != nil {
			errs = append(errs, fmt.Sprintf("item %d: %v", i+1, err))
			continue
		}
		v := it.Venue
		row := Row{FoursquareID: v.ID, Name: v.Name, Lat: v.Location.Lat, Lon: v.Location.Lng, Address: v.Location.Address,
			City: v.Location.City, Country: firstStr(v.Location.CC, v.Location.Country), At: at, Note: firstStr(it.Text, it.Shout)}
		if len(v.Categories) > 0 {
			row.Category = v.Categories[0].Name
		}
		for _, p := range it.Photos.Items {
			if u := firstStr(p.URL, p.Prefix+"original"+p.Suffix); u != "original" {
				row.Photos = append(row.Photos, u)
			}
		}
		rows = append(rows, row)
	}
	return rows, errs, nil
}

func firstRaw(a, b json.RawMessage) json.RawMessage {
	if len(a) > 0 && string(a) != "null" {
		return a
	}
	return b
}

func firstStr(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

var csvAliases = map[string][]string{
	"id":       {"venue_id", "venueid", "foursquare_id", "venue id"},
	"name":     {"venue_name", "venue name", "venue", "name"},
	"lat":      {"lat", "latitude", "venue_lat", "venue latitude"},
	"lon":      {"lng", "lon", "long", "longitude", "venue_lng", "venue longitude"},
	"address":  {"address", "venue_address", "venue address"},
	"city":     {"city", "venue_city", "venue city"},
	"country":  {"country", "cc", "venue_country", "venue country"},
	"category": {"category", "venue_category", "venue category", "primary category"},
	"at":       {"date", "created_at", "createdat", "timestamp", "checkin_time", "created at"},
	"note":     {"shout", "note", "comment", "text", "notes"},
	"photos":   {"photo", "photos", "photo_urls", "photo urls"},
}

// ParseCSV reads a Swarm CSV export. Columns are matched case-insensitively
// against common aliases (see csvAliases).
func ParseCSV(r io.Reader) ([]Row, []string, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	cr.LazyQuotes = true
	header, err := cr.Read()
	if err != nil {
		return nil, nil, fmt.Errorf("read CSV header: %w", err)
	}
	idx := map[string]int{}
	for i, h := range header {
		h = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(h, "\ufeff")))
		for key, aliases := range csvAliases {
			for _, a := range aliases {
				if h == a {
					if _, dup := idx[key]; !dup {
						idx[key] = i
					}
				}
			}
		}
	}
	for _, need := range []string{"name", "at"} {
		if _, ok := idx[need]; !ok {
			return nil, nil, fmt.Errorf("CSV is missing a %q column (accepted: %s)", need, strings.Join(csvAliases[need], ", "))
		}
	}
	get := func(rec []string, key string) string {
		if i, ok := idx[key]; ok && i < len(rec) {
			return strings.TrimSpace(rec[i])
		}
		return ""
	}
	var rows []Row
	var errs []string
	for line := 2; ; line++ {
		rec, err := cr.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			errs = append(errs, fmt.Sprintf("line %d: %v", line, err))
			continue
		}
		at, err := ParseTime(get(rec, "at"))
		if err != nil {
			errs = append(errs, fmt.Sprintf("line %d: %v", line, err))
			continue
		}
		lat, _ := strconv.ParseFloat(get(rec, "lat"), 64)
		lon, _ := strconv.ParseFloat(get(rec, "lon"), 64)
		row := Row{FoursquareID: get(rec, "id"), Name: get(rec, "name"), Lat: lat, Lon: lon, Address: get(rec, "address"),
			City: get(rec, "city"), Country: get(rec, "country"), Category: get(rec, "category"), At: at, Note: get(rec, "note")}
		for _, p := range strings.FieldsFunc(get(rec, "photos"), func(r rune) bool { return r == ' ' || r == '|' || r == ';' }) {
			if strings.HasPrefix(p, "http") {
				row.Photos = append(row.Photos, p)
			}
		}
		rows = append(rows, row)
	}
	return rows, errs, nil
}

// Load writes rows into the store for userID. Venues dedupe by foursquare id,
// then same name within 50 m; unmatched venues are created as needs-reconcile.
// Rows whose (venue, timestamp) already exist for the user are skipped, so re-imports are idempotent.
func Load(s *store.Store, userID int64, rows []Row, parseErrs []string) Result {
	res := Result{Rows: len(rows) + len(parseErrs), Errors: append([]string(nil), parseErrs...)}
	for i, r := range rows {
		if strings.TrimSpace(r.Name) == "" {
			res.Errors = append(res.Errors, fmt.Sprintf("row %d: venue name missing", i+1))
			continue
		}
		v, err := s.FindDuplicate(r.FoursquareID, "", 0, r.Name, r.Lat, r.Lon)
		if errors.Is(err, store.ErrNotFound) {
			id, ierr := s.InsertVenue(store.NewVenue{
				VenueFields: store.VenueFields{Name: r.Name, Lat: r.Lat, Lon: r.Lon, Address: r.Address, City: r.City,
					Country: strings.ToUpper(r.Country), Category: r.Category},
				FoursquareID: r.FoursquareID, Status: store.StatusReconcile,
			})
			if ierr != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("row %d: %v", i+1, ierr))
				continue
			}
			res.VenuesCreated++
			v, err = s.Venue(id)
		}
		if err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("row %d: %v", i+1, err))
			continue
		}
		if exists, _ := s.CheckinExists(userID, v.ID, r.At); exists {
			res.Skipped++
			continue
		}
		if _, err := s.InsertCheckin(store.NewCheckin{UserID: userID, VenueID: v.ID, VenueName: r.Name, Note: r.Note,
			At: r.At, Source: "imported", PhotoURLs: r.Photos}); err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("row %d: %v", i+1, err))
			continue
		}
		res.Imported++
	}
	return res
}
