package store

import (
	"database/sql"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Venue statuses.
const (
	StatusLinked    = "osm-linked"
	StatusLocalOnly = "local-only"
	StatusReconcile = "needs-reconcile"
)

// VenueFields are the user-editable venue columns (the OSM link itself is managed separately).
type VenueFields struct {
	Name, Address, City, Country, Category, Cuisine, Website, Phone, LocalNotes string
	Lat, Lon                                                                    float64
}

// Venue is a row of the shared venues table.
type Venue struct {
	ID           int64
	OSMType      string
	OSMID        int64
	OSMVersion   int64
	OSMPulledAt  string
	FoursquareID string
	VenueFields
	OSMTags   string // JSON snapshot, "" when none
	Status    string
	UpdatedAt string
}

// HasOSM reports whether the venue is linked to an OSM element.
func (v *Venue) HasOSM() bool { return v.OSMType != "" && v.OSMID != 0 }

// OSMURL is the canonical openstreetmap.org link, or "".
func (v *Venue) OSMURL() string {
	if !v.HasOSM() {
		return ""
	}
	return fmt.Sprintf("https://www.openstreetmap.org/%s/%d", v.OSMType, v.OSMID)
}

const venueCols = `id,osm_type,osm_id,osm_version,osm_pulled_at,foursquare_id,name,lat,lon,address,city,country,
category,cuisine,website,phone,osm_tags,local_notes,status,updated_at`

type scanner interface{ Scan(...any) error }

func scanVenue(r scanner) (*Venue, error) {
	var v Venue
	var ot, pulled, fsq, tags sql.NullString
	var oid, ver sql.NullInt64
	err := r.Scan(&v.ID, &ot, &oid, &ver, &pulled, &fsq, &v.Name, &v.Lat, &v.Lon, &v.Address, &v.City, &v.Country,
		&v.Category, &v.Cuisine, &v.Website, &v.Phone, &tags, &v.LocalNotes, &v.Status, &v.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	v.OSMType, v.OSMID, v.OSMVersion = ot.String, oid.Int64, ver.Int64
	v.OSMPulledAt, v.FoursquareID, v.OSMTags = pulled.String, fsq.String, tags.String
	return &v, nil
}

// Venue loads one venue.
func (s *Store) Venue(id int64) (*Venue, error) {
	return scanVenue(s.db.QueryRow(`SELECT `+venueCols+` FROM venues WHERE id=?`, id))
}

// NewVenue describes a venue to insert.
type NewVenue struct {
	VenueFields
	OSMType      string
	OSMID        int64
	OSMVersion   int64
	OSMTags      string
	FoursquareID string
	Status       string
}

// InsertVenue creates a venue and returns its id.
func (s *Store) InsertVenue(n NewVenue) (int64, error) {
	if strings.TrimSpace(n.Name) == "" {
		return 0, errors.New("venue name required")
	}
	if n.Status == "" {
		n.Status = StatusLocalOnly
	}
	now := s.ts()
	var pulled any
	var ot, tags, fsq any
	var oid, ver any
	if n.OSMType != "" && n.OSMID != 0 {
		ot, oid, ver, pulled, tags = n.OSMType, n.OSMID, n.OSMVersion, now, nilIfEmpty(n.OSMTags)
	}
	fsq = nilIfEmpty(n.FoursquareID)
	res, err := s.db.Exec(`INSERT INTO venues(osm_type,osm_id,osm_version,osm_pulled_at,foursquare_id,name,lat,lon,address,city,
		country,category,cuisine,website,phone,osm_tags,local_notes,status,updated_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		ot, oid, ver, pulled, fsq, n.Name, n.Lat, n.Lon, n.Address, n.City, n.Country, n.Category, n.Cuisine, n.Website,
		n.Phone, tags, n.LocalNotes, n.Status, now)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// VenueByOSM finds a venue linked to the OSM element.
func (s *Store) VenueByOSM(typ string, id int64) (*Venue, error) {
	return scanVenue(s.db.QueryRow(`SELECT `+venueCols+` FROM venues WHERE osm_type=? AND osm_id=?`, typ, id))
}

// FindDuplicate looks for an existing venue: foursquare id first, then OSM id, then same name within 50 m.
func (s *Store) FindDuplicate(fsqID, osmType string, osmID int64, name string, lat, lon float64) (*Venue, error) {
	if fsqID != "" {
		if v, err := scanVenue(s.db.QueryRow(`SELECT `+venueCols+` FROM venues WHERE foursquare_id=? LIMIT 1`, fsqID)); err == nil {
			return v, nil
		}
	}
	if osmType != "" && osmID != 0 {
		if v, err := s.VenueByOSM(osmType, osmID); err == nil {
			return v, nil
		}
	}
	near, err := s.VenuesNear(lat, lon, 50, 50)
	if err != nil {
		return nil, err
	}
	for _, v := range near {
		if strings.EqualFold(strings.TrimSpace(v.Name), strings.TrimSpace(name)) {
			return v, nil
		}
	}
	return nil, ErrNotFound
}

// Haversine returns the great-circle distance in metres.
func Haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const r = 6371000
	rad := math.Pi / 180
	dLat, dLon := (lat2-lat1)*rad, (lon2-lon1)*rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * r * math.Asin(math.Sqrt(a))
}

// VenuesNear returns venues within radiusM metres (bounding box prefilter + haversine).
func (s *Store) VenuesNear(lat, lon, radiusM float64, limit int) ([]*Venue, error) {
	dLat := radiusM / 111320
	dLon := radiusM / (111320 * math.Max(0.01, math.Cos(lat*math.Pi/180)))
	vs, err := s.VenuesInBBox(lat-dLat, lon-dLon, lat+dLat, lon+dLon, 500)
	if err != nil {
		return nil, err
	}
	var out []*Venue
	for _, v := range vs {
		if Haversine(lat, lon, v.Lat, v.Lon) <= radiusM {
			out = append(out, v)
			if len(out) >= limit {
				break
			}
		}
	}
	return out, nil
}

// VenuesInBBox returns venues in a lat/lon rectangle.
func (s *Store) VenuesInBBox(minLat, minLon, maxLat, maxLon float64, limit int) ([]*Venue, error) {
	rows, err := s.db.Query(`SELECT `+venueCols+` FROM venues WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? LIMIT ?`,
		minLat, maxLat, minLon, maxLon, limit)
	if err != nil {
		return nil, err
	}
	return collectVenues(rows)
}

func collectVenues(rows *sql.Rows) ([]*Venue, error) {
	defer rows.Close()
	var out []*Venue
	for rows.Next() {
		v, err := scanVenue(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

var ftsWord = regexp.MustCompile(`[\p{L}\p{N}]+`)

// FTSQuery turns free text into a safe FTS5 prefix query ("" if nothing searchable).
func FTSQuery(q string) string {
	words := ftsWord.FindAllString(q, 8)
	for i, w := range words {
		words[i] = `"` + w + `"*`
	}
	return strings.Join(words, " ")
}

// VenueFilter drives list/search queries.
type VenueFilter struct {
	Q      string
	Status string
	Limit  int
	Offset int
}

// SearchVenues lists venues, FTS-matched when Q is set. Returns rows and the total.
func (s *Store) SearchVenues(f VenueFilter) ([]*Venue, int, error) {
	if f.Limit <= 0 {
		f.Limit = 50
	}
	where, args := []string{"1=1"}, []any{}
	if f.Status != "" {
		where = append(where, "v.status=?")
		args = append(args, f.Status)
	}
	if f.Q != "" {
		m := FTSQuery(f.Q)
		if m == "" {
			return nil, 0, nil
		}
		where = append(where, "v.id IN (SELECT rowid FROM venues_fts WHERE venues_fts MATCH ?)")
		args = append(args, m)
	}
	w := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM venues v WHERE `+w, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	cols := "v." + strings.ReplaceAll(venueCols, ",", ",v.")
	cols = strings.ReplaceAll(cols, "\n", "")
	rows, err := s.db.Query(`SELECT `+cols+` FROM venues v WHERE `+w+` ORDER BY v.name COLLATE NOCASE, v.id LIMIT ? OFFSET ?`,
		append(args, f.Limit, f.Offset)...)
	if err != nil {
		return nil, 0, err
	}
	vs, err := collectVenues(rows)
	return vs, total, err
}

// VenueEditable converts a venue to its editable field set.
func (v *Venue) Fields() VenueFields { return v.VenueFields }

type fieldPair struct {
	name     string
	old, new string
}

func diffFields(a, b VenueFields) []fieldPair {
	f := func(x float64) string { return fmt.Sprintf("%.7g", x) }
	all := []fieldPair{
		{"name", a.Name, b.Name}, {"address", a.Address, b.Address}, {"city", a.City, b.City},
		{"country", a.Country, b.Country}, {"category", a.Category, b.Category}, {"cuisine", a.Cuisine, b.Cuisine},
		{"website", a.Website, b.Website}, {"phone", a.Phone, b.Phone}, {"local_notes", a.LocalNotes, b.LocalNotes},
		{"lat", f(a.Lat), f(b.Lat)}, {"lon", f(a.Lon), f(b.Lon)},
	}
	var out []fieldPair
	for _, p := range all {
		if p.old != p.new {
			out = append(out, p)
		}
	}
	return out
}

// ErrInvalidVenue is returned for invalid edit input.
var ErrInvalidVenue = errors.New("invalid venue data")

// ValidateFields sanity-checks edit input.
func ValidateFields(f VenueFields) error {
	if strings.TrimSpace(f.Name) == "" || utf8.RuneCountInString(f.Name) > 200 {
		return fmt.Errorf("%w: name required (max 200 chars)", ErrInvalidVenue)
	}
	if f.Lat < -90 || f.Lat > 90 || f.Lon < -180 || f.Lon > 180 {
		return fmt.Errorf("%w: coordinates out of range", ErrInvalidVenue)
	}
	return nil
}

// EditVenue applies a last-write-wins edit and logs every changed field.
// userID 0 records a system change (e.g. an OSM pull). Returns the changed field names.
func (s *Store) EditVenue(id, userID int64, nf VenueFields) ([]string, error) {
	if err := ValidateFields(nf); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	v, err := scanVenue(tx.QueryRow(`SELECT `+venueCols+` FROM venues WHERE id=?`, id))
	if err != nil {
		return nil, err
	}
	diffs := diffFields(v.VenueFields, nf)
	if len(diffs) == 0 {
		return nil, nil
	}
	now := s.ts()
	if _, err := tx.Exec(`UPDATE venues SET name=?,lat=?,lon=?,address=?,city=?,country=?,category=?,cuisine=?,website=?,
		phone=?,local_notes=?,updated_at=? WHERE id=?`, nf.Name, nf.Lat, nf.Lon, nf.Address, nf.City, nf.Country,
		nf.Category, nf.Cuisine, nf.Website, nf.Phone, nf.LocalNotes, now, id); err != nil {
		return nil, err
	}
	var uid any
	if userID != 0 {
		uid = userID
	}
	names := make([]string, 0, len(diffs))
	for _, d := range diffs {
		if _, err := tx.Exec(`INSERT INTO venue_edit_log(venue_id,user_id,field,old_value,new_value,created_at) VALUES(?,?,?,?,?,?)`,
			id, uid, d.name, d.old, d.new, now); err != nil {
			return nil, err
		}
		names = append(names, d.name)
	}
	return names, tx.Commit()
}

// SetOSMSnapshot stores a fresh OSM snapshot (tags, version, pulled_at) and links the venue.
func (s *Store) SetOSMSnapshot(id int64, typ string, osmID, version int64, tagsJSON string) error {
	_, err := s.db.Exec(`UPDATE venues SET osm_type=?,osm_id=?,osm_version=?,osm_tags=?,osm_pulled_at=?,status=?,updated_at=? WHERE id=?`,
		typ, osmID, version, tagsJSON, s.ts(), StatusLinked, s.ts(), id)
	return err
}

// SetStatus changes a venue's status.
func (s *Store) SetStatus(id int64, status string) error {
	_, err := s.db.Exec(`UPDATE venues SET status=?,updated_at=? WHERE id=?`, status, s.ts(), id)
	return err
}

// EditLogEntry is one audited change. UserID is deliberately not exposed to the UI.
type EditLogEntry struct {
	Field, Old, New string
	At              time.Time
}

// EditLog returns the most recent changes for a venue.
func (s *Store) EditLog(venueID int64, limit int) ([]EditLogEntry, error) {
	rows, err := s.db.Query(`SELECT field,COALESCE(old_value,''),COALESCE(new_value,''),created_at FROM venue_edit_log
		WHERE venue_id=? ORDER BY created_at DESC, id DESC LIMIT ?`, venueID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EditLogEntry
	for rows.Next() {
		var e EditLogEntry
		var at string
		if err := rows.Scan(&e.Field, &e.Old, &e.New, &at); err != nil {
			return nil, err
		}
		e.At = parseTime(at)
		out = append(out, e)
	}
	return out, rows.Err()
}

// Audit records an OSM write attempt.
func (s *Store) Audit(venueID int64, action string, ok bool, detail string) {
	var vid any
	if venueID != 0 {
		vid = venueID
	}
	s.db.Exec(`INSERT INTO osm_audit(venue_id,action,ok,detail,created_at) VALUES(?,?,?,?,?)`, vid, action, ok, detail, s.ts())
}
