package store

// Count is a labelled tally.
type Count struct {
	Label   string
	N       int
	VenueID int64
}

// Insights are the per-user metrics, computed on the fly (no caching).
type Insights struct {
	Total, UniqueVenues int
	ByYear, ByMonth     []Count
	ByCountry, ByCity   []Count
	ByCategory          []Count
	TopVenues           []Count
	Recent              []*Checkin
}

func (s *Store) counts(q string, args ...any) ([]Count, error) {
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Count
	for rows.Next() {
		var c Count
		if err := rows.Scan(&c.Label, &c.N, &c.VenueID); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// UserInsights computes the metrics for one user.
func (s *Store) UserInsights(userID int64) (*Insights, error) {
	in := &Insights{}
	if err := s.db.QueryRow(`SELECT COUNT(*),COUNT(DISTINCT venue_id) FROM checkins WHERE user_id=?`, userID).Scan(&in.Total, &in.UniqueVenues); err != nil {
		return nil, err
	}
	group := func(expr string, order string, limit int) ([]Count, error) {
		return s.counts(`SELECT `+expr+` AS k,COUNT(*) AS n,0 FROM checkins c JOIN venues v ON v.id=c.venue_id
			WHERE c.user_id=? AND `+expr+` <> '' GROUP BY k ORDER BY `+order+` LIMIT ?`, userID, limit)
	}
	var err error
	if in.ByYear, err = group(`substr(c.checked_in_at,1,4)`, `k DESC`, 100); err != nil {
		return nil, err
	}
	if in.ByMonth, err = group(`substr(c.checked_in_at,1,7)`, `k DESC`, 24); err != nil {
		return nil, err
	}
	if in.ByCountry, err = group(`v.country`, `n DESC, k`, 15); err != nil {
		return nil, err
	}
	if in.ByCity, err = group(`v.city`, `n DESC, k`, 15); err != nil {
		return nil, err
	}
	if in.ByCategory, err = group(`v.category`, `n DESC, k`, 15); err != nil {
		return nil, err
	}
	if in.TopVenues, err = s.counts(`SELECT v.name,COUNT(*) AS n,v.id FROM checkins c JOIN venues v ON v.id=c.venue_id
		WHERE c.user_id=? GROUP BY v.id ORDER BY n DESC, v.name LIMIT 10`, userID); err != nil {
		return nil, err
	}
	in.Recent, err = s.RecentCheckins(userID, 10, 0)
	return in, err
}
