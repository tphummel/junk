package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// Checkin is one visit by one user.
type Checkin struct {
	ID          int64
	UserID      int64
	VenueID     int64
	VenueName   string // snapshot at check-in time
	Note        string
	Lat, Lon    *float64
	CheckedInAt time.Time
	OriginalAt  time.Time
	Source      string
	PhotoURLs   []string
}

// NewCheckin describes a check-in to insert.
type NewCheckin struct {
	UserID, VenueID int64
	VenueName       string
	Note            string
	Lat, Lon        *float64
	At              time.Time
	Source          string
	PhotoURLs       []string
}

// InsertCheckin stores a check-in.
func (s *Store) InsertCheckin(n NewCheckin) (int64, error) {
	if n.At.IsZero() {
		n.At = s.now()
	}
	photos := "[]"
	if len(n.PhotoURLs) > 0 {
		b, _ := json.Marshal(n.PhotoURLs)
		photos = string(b)
	}
	res, err := s.db.Exec(`INSERT INTO checkins(user_id,venue_id,venue_name_at_time,note,lat,lon,checked_in_at,source,created_at,photo_urls,original_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?)`, n.UserID, n.VenueID, n.VenueName, n.Note, n.Lat, n.Lon,
		n.At.UTC().Format(time.RFC3339), n.Source, s.ts(), photos, n.At.UTC().Format(time.RFC3339))
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// CheckinExists reports whether the user already has a check-in at the venue at that instant (import idempotency).
func (s *Store) CheckinExists(userID, venueID int64, at time.Time) (bool, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM checkins WHERE user_id=? AND venue_id=? AND checked_in_at=?`,
		userID, venueID, at.UTC().Format(time.RFC3339)).Scan(&n)
	return n > 0, err
}

const checkinCols = `id,user_id,venue_id,venue_name_at_time,note,lat,lon,checked_in_at,source,photo_urls,original_at`

func scanCheckin(r scanner) (*Checkin, error) {
	var c Checkin
	var lat, lon sql.NullFloat64
	var at, photos, orig string
	if err := r.Scan(&c.ID, &c.UserID, &c.VenueID, &c.VenueName, &c.Note, &lat, &lon, &at, &c.Source, &photos, &orig); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if lat.Valid && lon.Valid {
		c.Lat, c.Lon = &lat.Float64, &lon.Float64
	}
	c.CheckedInAt = parseTime(at)
	c.OriginalAt = parseTime(orig)
	_ = json.Unmarshal([]byte(photos), &c.PhotoURLs)
	return &c, nil
}

// Checkin loads a check-in owned by userID (other users' rows read as not found).
func (s *Store) Checkin(userID, id int64) (*Checkin, error) {
	return scanCheckin(s.db.QueryRow(`SELECT `+checkinCols+` FROM checkins WHERE id=? AND user_id=?`, id, userID))
}

// RecentCheckins lists a user's check-ins, newest first.
func (s *Store) RecentCheckins(userID int64, limit, offset int) ([]*Checkin, error) {
	rows, err := s.db.Query(`SELECT `+checkinCols+` FROM checkins WHERE user_id=? ORDER BY checked_in_at DESC, id DESC LIMIT ? OFFSET ?`,
		userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Checkin
	for rows.Next() {
		c, err := scanCheckin(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// UpdateCheckin edits the note and timestamp of the user's own check-in.
func (s *Store) UpdateCheckin(userID, id int64, note string, at time.Time) error {
	res, err := s.db.Exec(`UPDATE checkins SET note=?,checked_in_at=? WHERE id=? AND user_id=?`,
		note, at.UTC().Format(time.RFC3339), id, userID)
	return affected(res, err)
}

// DeleteCheckin removes the user's own check-in.
func (s *Store) DeleteCheckin(userID, id int64) error {
	res, err := s.db.Exec(`DELETE FROM checkins WHERE id=? AND user_id=?`, id, userID)
	return affected(res, err)
}

func affected(res sql.Result, err error) error {
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// VisitStat is a user's history at a venue.
type VisitStat struct {
	Count int
	Last  time.Time
}

// UserVisitStats returns the user's visit count and last visit for each venue id.
func (s *Store) UserVisitStats(userID int64, venueIDs []int64) (map[int64]VisitStat, error) {
	out := map[int64]VisitStat{}
	for _, id := range venueIDs {
		var n int
		var last sql.NullString
		if err := s.db.QueryRow(`SELECT COUNT(*),MAX(checked_in_at) FROM checkins WHERE user_id=? AND venue_id=?`, userID, id).Scan(&n, &last); err != nil {
			return nil, err
		}
		if n > 0 {
			out[id] = VisitStat{n, parseTime(last.String)}
		}
	}
	return out, nil
}

// VenueStats is the shared (all-users) check-in total and last date for a venue page.
func (s *Store) VenueStats(venueID int64) (VisitStat, error) {
	var n int
	var last sql.NullString
	err := s.db.QueryRow(`SELECT COUNT(*),MAX(checked_in_at) FROM checkins WHERE venue_id=?`, venueID).Scan(&n, &last)
	return VisitStat{n, parseTime(last.String)}, err
}

// CheckinPoint is a user's visits aggregated per venue, for the map.
type CheckinPoint struct {
	VenueID  int64
	Name     string
	Lat, Lon float64
	Count    int
}

// UserCheckinPoints returns the user's visited venues inside a bounding box.
func (s *Store) UserCheckinPoints(userID int64, minLat, minLon, maxLat, maxLon float64, limit int) ([]CheckinPoint, error) {
	rows, err := s.db.Query(`SELECT v.id,v.name,v.lat,v.lon,COUNT(*) FROM checkins c JOIN venues v ON v.id=c.venue_id
		WHERE c.user_id=? AND v.lat BETWEEN ? AND ? AND v.lon BETWEEN ? AND ? GROUP BY v.id LIMIT ?`,
		userID, minLat, maxLat, minLon, maxLon, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CheckinPoint
	for rows.Next() {
		var p CheckinPoint
		if err := rows.Scan(&p.VenueID, &p.Name, &p.Lat, &p.Lon, &p.Count); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
