package store

import (
	"database/sql"
	"encoding/json"
	"time"
)

// ExportSchemaVersion is bumped on breaking export format changes.
const ExportSchemaVersion = 1

type exportOSM struct {
	Type string `json:"type"`
	ID   int64  `json:"id"`
}

type exportVenue struct {
	Name         string          `json:"name"`
	OSM          *exportOSM      `json:"osm,omitempty"`
	FoursquareID string          `json:"foursquare_id,omitempty"`
	Lat          float64         `json:"lat"`
	Lon          float64         `json:"lon"`
	Address      string          `json:"address"`
	City         string          `json:"city"`
	Country      string          `json:"country"`
	Category     string          `json:"category"`
	OSMTags      json.RawMessage `json:"osm_tags,omitempty"`
}

type exportCheckin struct {
	ID          int64       `json:"id"`
	CheckedInAt string      `json:"checked_in_at"`
	Note        string      `json:"note"`
	Lat         *float64    `json:"lat"`
	Lon         *float64    `json:"lon"`
	Source      string      `json:"source"`
	PhotoURLs   []string    `json:"photo_urls"`
	Venue       exportVenue `json:"venue"`
}

// Export is the personal-data JSON document. It never includes the edit
// log, other users' check-ins, or session data.
type Export struct {
	ExportedAt    string          `json:"exported_at"`
	SchemaVersion int             `json:"schema_version"`
	Username      string          `json:"username"`
	Checkins      []exportCheckin `json:"checkins"`
}

// ExportUser builds the export for one user.
func (s *Store) ExportUser(u *User) (*Export, error) {
	rows, err := s.db.Query(`SELECT c.id,c.checked_in_at,c.note,c.lat,c.lon,c.source,c.photo_urls,
		v.name,v.osm_type,v.osm_id,v.foursquare_id,v.lat,v.lon,v.address,v.city,v.country,v.category,v.osm_tags
		FROM checkins c JOIN venues v ON v.id=c.venue_id WHERE c.user_id=? ORDER BY c.checked_in_at, c.id`, u.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ex := &Export{ExportedAt: s.ts(), SchemaVersion: ExportSchemaVersion, Username: u.Username, Checkins: []exportCheckin{}}
	for rows.Next() {
		var c exportCheckin
		var lat, lon sql.NullFloat64
		var photos string
		var ot, fsq, tags sql.NullString
		var oid sql.NullInt64
		if err := rows.Scan(&c.ID, &c.CheckedInAt, &c.Note, &lat, &lon, &c.Source, &photos,
			&c.Venue.Name, &ot, &oid, &fsq, &c.Venue.Lat, &c.Venue.Lon, &c.Venue.Address, &c.Venue.City,
			&c.Venue.Country, &c.Venue.Category, &tags); err != nil {
			return nil, err
		}
		if lat.Valid && lon.Valid {
			c.Lat, c.Lon = &lat.Float64, &lon.Float64
		}
		c.PhotoURLs = []string{}
		_ = json.Unmarshal([]byte(photos), &c.PhotoURLs)
		if ot.Valid && oid.Valid {
			c.Venue.OSM = &exportOSM{ot.String, oid.Int64}
		}
		c.Venue.FoursquareID = fsq.String
		if tags.Valid && json.Valid([]byte(tags.String)) {
			c.Venue.OSMTags = json.RawMessage(tags.String)
		}
		ex.Checkins = append(ex.Checkins, c)
	}
	return ex, rows.Err()
}

var _ = time.RFC3339
