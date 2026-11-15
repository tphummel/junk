package web

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"sworn/internal/osm"
	"sworn/internal/store"
)

func (s *Server) home(w http.ResponseWriter, r *http.Request) {
	cs, err := s.st.RecentCheckins(userFrom(r).ID, 30, 0)
	if err != nil {
		http.Error(w, "error", 500)
		return
	}
	s.render(w, r, "home", "Recent check-ins", cs)
}

func (s *Server) checkinSearchPage(w http.ResponseWriter, r *http.Request) {
	s.render(w, r, "checkin", "Check in", nil)
}

type localHit struct {
	VenueID    int64  `json:"venue_id"`
	Name       string `json:"name"`
	Address    string `json:"address"`
	City       string `json:"city"`
	Category   string `json:"category"`
	Visits     int    `json:"visits"`
	Last       string `json:"last,omitempty"`
	OSMUpdated bool   `json:"osm_updated,omitempty"`
}

type osmHit struct {
	OSMType  string  `json:"osm_type"`
	OSMID    int64   `json:"osm_id"`
	Name     string  `json:"name"`
	Address  string  `json:"address"`
	Category string  `json:"category"`
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	Distance int     `json:"distance_m,omitempty"`
}

func osmKey(typ string, id int64) string { return fmt.Sprintf("%s/%d", typ, id) }

func (s *Server) cacheElement(el osm.Element) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	if len(s.elementCache) > 500 {
		for k, v := range s.elementCache {
			if time.Since(v.at) > 10*time.Minute {
				delete(s.elementCache, k)
			}
		}
	}
	s.elementCache[osmKey(el.Type, el.ID)] = cachedElement{el, time.Now()}
}

func (s *Server) cachedElement(typ string, id int64) (osm.Element, bool) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	c, ok := s.elementCache[osmKey(typ, id)]
	if !ok || time.Since(c.at) > 10*time.Minute {
		return osm.Element{}, false
	}
	return c.el, true
}

func parseCoord(r *http.Request, lk, ok string) (*float64, *float64) {
	lat, e1 := strconv.ParseFloat(r.FormValue(lk), 64)
	lon, e2 := strconv.ParseFloat(r.FormValue(ok), 64)
	if e1 != nil || e2 != nil || lat < -90 || lat > 90 || lon < -180 || lon > 180 {
		return nil, nil
	}
	return &lat, &lon
}

// apiSearch runs the local FTS query and the live Overpass query in parallel and merges them.
// Local venues come first; OSM elements matching a tracked venue are folded into its card.
func (s *Server) apiSearch(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	q := strings.TrimSpace(r.FormValue("q"))
	lat, lon := parseCoord(r, "lat", "lon")
	if len([]rune(q)) < 2 && lat == nil {
		writeJSON(w, 200, map[string]any{"local": []localHit{}, "osm": []osmHit{}})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	var (
		wg      sync.WaitGroup
		locals  []*store.Venue
		els     []osm.Element
		osmErr  error
		localEr error
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		if q != "" {
			locals, _, localEr = s.st.SearchVenues(store.VenueFilter{Q: q, Limit: 10})
		} else if lat != nil {
			locals, localEr = s.st.VenuesNear(*lat, *lon, 500, 10)
		}
	}()
	go func() {
		defer wg.Done()
		els, osmErr = s.overpass.Search(ctx, q, lat, lon, 500)
	}()
	wg.Wait()
	if localEr != nil {
		jsonError(w, 500, "search failed")
		return
	}

	byOSM := map[string]*store.Venue{}
	for _, v := range locals {
		if v.HasOSM() {
			byOSM[osmKey(v.OSMType, v.OSMID)] = v
		}
	}
	updated := map[int64]bool{}
	var osmHits []osmHit
	for _, el := range els {
		if el.Tags["name"] == "" {
			continue
		}
		s.cacheElement(el)
		v := byOSM[osmKey(el.Type, el.ID)]
		if v == nil {
			if lv, err := s.st.VenueByOSM(el.Type, el.ID); err == nil {
				v = lv
			} else if lv, err := s.st.FindDuplicate("", "", 0, el.Tags["name"], el.Lat, el.Lon); err == nil {
				v = lv
			}
			if v != nil {
				locals = append(locals, v)
				byOSM[osmKey(el.Type, el.ID)] = v
			}
		}
		if v != nil {
			if el.Version > v.OSMVersion {
				updated[v.ID] = true
			}
			continue
		}
		f := el.Fields()
		h := osmHit{el.Type, el.ID, f.Name, f.Address, f.Category, el.Lat, el.Lon, 0}
		if lat != nil {
			h.Distance = int(store.Haversine(*lat, *lon, el.Lat, el.Lon))
		}
		osmHits = append(osmHits, h)
	}
	if lat != nil {
		sort.SliceStable(osmHits, func(i, j int) bool { return osmHits[i].Distance < osmHits[j].Distance })
	}

	ids := make([]int64, 0, len(locals))
	seen := map[int64]bool{}
	var uniq []*store.Venue
	for _, v := range locals {
		if !seen[v.ID] {
			seen[v.ID] = true
			ids = append(ids, v.ID)
			uniq = append(uniq, v)
		}
	}
	stats, _ := s.st.UserVisitStats(u.ID, ids)
	hits := make([]localHit, 0, len(uniq))
	for _, v := range uniq {
		h := localHit{VenueID: v.ID, Name: v.Name, Address: v.Address, City: v.City, Category: v.Category, OSMUpdated: updated[v.ID]}
		if st, ok := stats[v.ID]; ok {
			h.Visits, h.Last = st.Count, st.Last.Format("Jan 2006")
		}
		hits = append(hits, h)
	}
	// Previously visited venues first, then most visited.
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].Visits > hits[j].Visits })
	resp := map[string]any{"local": hits, "osm": osmHits}
	if osmErr != nil {
		s.log.Warn("overpass search failed", "err", osmErr)
		resp["osm_error"] = "OpenStreetMap search is unavailable right now; showing local results only."
	}
	writeJSON(w, 200, resp)
}

type confirmData struct {
	Venue    *store.Venue
	OSM      *osmHit
	Stats    store.VisitStat
	New      bool
	Lat, Lon string
}

func (s *Server) checkinConfirmPage(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	d := confirmData{Lat: r.FormValue("lat"), Lon: r.FormValue("lon")}
	switch {
	case r.FormValue("venue_id") != "":
		id, _ := strconv.ParseInt(r.FormValue("venue_id"), 10, 64)
		v, err := s.st.Venue(id)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		d.Venue = v
		if st, _ := s.st.UserVisitStats(u.ID, []int64{id}); len(st) > 0 {
			d.Stats = st[id]
		}
	case r.FormValue("osm_id") != "":
		id, _ := strconv.ParseInt(r.FormValue("osm_id"), 10, 64)
		typ := r.FormValue("osm_type")
		el, err := s.resolveElement(r.Context(), typ, id)
		if err != nil {
			s.redirect(w, r, "/checkin", "", "Could not load that place from OpenStreetMap.")
			return
		}
		f := el.Fields()
		d.OSM = &osmHit{el.Type, el.ID, f.Name, f.Address, f.Category, el.Lat, el.Lon, 0}
	case r.FormValue("new") != "":
		d.New = true
	default:
		http.NotFound(w, r)
		return
	}
	s.render(w, r, "checkin_confirm", "Confirm check-in", d)
}

func (s *Server) resolveElement(ctx context.Context, typ string, id int64) (osm.Element, error) {
	if el, ok := s.cachedElement(typ, id); ok {
		return el, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	el, err := s.overpass.Get(ctx, typ, id)
	if err == nil {
		s.cacheElement(el)
	}
	return el, err
}

// upsertOSMVenue returns the local venue for an OSM element, creating it (status osm-linked) if new.
func (s *Server) upsertOSMVenue(el osm.Element) (*store.Venue, error) {
	if v, err := s.st.VenueByOSM(el.Type, el.ID); err == nil {
		return v, nil
	}
	f := el.Fields()
	if f.Name == "" {
		return nil, errors.New("OSM element has no name")
	}
	id, err := s.st.InsertVenue(store.NewVenue{VenueFields: f, OSMType: el.Type, OSMID: el.ID, OSMVersion: el.Version,
		OSMTags: el.TagsJSON(), Status: store.StatusLinked})
	if err != nil {
		return nil, err
	}
	return s.st.Venue(id)
}

func (s *Server) checkinCreate(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	note := strings.TrimSpace(r.FormValue("note"))
	if len(note) > 2000 {
		note = note[:2000]
	}
	lat, lon := parseCoord(r, "lat", "lon")
	var v *store.Venue
	var err error
	switch {
	case r.FormValue("venue_id") != "":
		id, _ := strconv.ParseInt(r.FormValue("venue_id"), 10, 64)
		v, err = s.st.Venue(id)
	case r.FormValue("osm_id") != "":
		id, _ := strconv.ParseInt(r.FormValue("osm_id"), 10, 64)
		var el osm.Element
		if el, err = s.resolveElement(r.Context(), r.FormValue("osm_type"), id); err == nil {
			v, err = s.upsertOSMVenue(el)
		}
	case r.FormValue("new") != "":
		f := store.VenueFields{Name: strings.TrimSpace(r.FormValue("name"))}
		vlat, vlon := parseCoord(r, "venue_lat", "venue_lon")
		if vlat == nil {
			vlat, vlon = lat, lon
		}
		if vlat == nil {
			s.redirect(w, r, "/checkin/new?new=1", "", "Coordinates are required for a new venue (allow location or enter them).")
			return
		}
		f.Lat, f.Lon = *vlat, *vlon
		if err = store.ValidateFields(f); err != nil {
			s.redirect(w, r, "/checkin/new?new=1", "", "A venue name is required.")
			return
		}
		var id int64
		if id, err = s.st.InsertVenue(store.NewVenue{VenueFields: f, Status: store.StatusLocalOnly}); err == nil {
			v, err = s.st.Venue(id)
		}
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil || v == nil {
		s.log.Warn("check-in failed", "err", err)
		s.redirect(w, r, "/checkin", "", "Could not create that check-in.")
		return
	}
	src := "manual"
	if lat != nil {
		src = "gps"
	}
	id, err := s.st.InsertCheckin(store.NewCheckin{UserID: u.ID, VenueID: v.ID, VenueName: v.Name, Note: note, Lat: lat, Lon: lon, Source: src})
	if err != nil {
		http.Error(w, "error", 500)
		return
	}
	s.redirect(w, r, "/checkins/"+strconv.FormatInt(id, 10), "Checked in at "+v.Name+".", "")
}

type checkinView struct {
	C     *store.Checkin
	Venue *store.Venue
}

func (s *Server) loadCheckin(w http.ResponseWriter, r *http.Request) *store.Checkin {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	c, err := s.st.Checkin(userFrom(r).ID, id) // other users' check-ins are invisible
	if err != nil {
		http.NotFound(w, r)
		return nil
	}
	return c
}

func (s *Server) checkinDetail(w http.ResponseWriter, r *http.Request) {
	c := s.loadCheckin(w, r)
	if c == nil {
		return
	}
	v, _ := s.st.Venue(c.VenueID)
	s.render(w, r, "checkin_detail", c.VenueName, checkinView{c, v})
}

func (s *Server) checkinUpdate(w http.ResponseWriter, r *http.Request) {
	c := s.loadCheckin(w, r)
	if c == nil {
		return
	}
	at := c.CheckedInAt
	if raw := strings.TrimSpace(r.FormValue("checked_in_at")); raw != "" {
		t, err := time.ParseInLocation("2006-01-02T15:04", raw, time.UTC)
		if err != nil {
			s.redirect(w, r, "/checkins/"+r.PathValue("id"), "", "Invalid date/time.")
			return
		}
		if d := t.Sub(c.OriginalAt); d > 24*time.Hour || d < -24*time.Hour {
			s.redirect(w, r, "/checkins/"+r.PathValue("id"), "", "The time can only move by up to one day.")
			return
		}
		at = t
	}
	note := strings.TrimSpace(r.FormValue("note"))
	if len(note) > 2000 {
		note = note[:2000]
	}
	if err := s.st.UpdateCheckin(c.UserID, c.ID, note, at); err != nil {
		http.Error(w, "error", 500)
		return
	}
	s.redirect(w, r, "/checkins/"+r.PathValue("id"), "Saved.", "")
}

func (s *Server) checkinDelete(w http.ResponseWriter, r *http.Request) {
	c := s.loadCheckin(w, r)
	if c == nil {
		return
	}
	if err := s.st.DeleteCheckin(c.UserID, c.ID); err != nil {
		http.Error(w, "error", 500)
		return
	}
	s.redirect(w, r, "/", "Check-in deleted.", "")
}
