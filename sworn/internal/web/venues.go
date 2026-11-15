package web

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"sworn/internal/store"
)

func (s *Server) venuesPage(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.FormValue("page"))
	if page < 1 {
		page = 1
	}
	q := strings.TrimSpace(r.FormValue("q"))
	vs, total, err := s.st.SearchVenues(store.VenueFilter{Q: q, Limit: 50, Offset: (page - 1) * 50})
	if err != nil {
		http.Error(w, "error", 500)
		return
	}
	s.render(w, r, "venues", "Venues", map[string]any{"Venues": vs, "Q": q, "Page": page, "Total": total, "More": page*50 < total})
}

func (s *Server) venueFromPath(w http.ResponseWriter, r *http.Request) *store.Venue {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	v, err := s.st.Venue(id)
	if err != nil {
		http.NotFound(w, r)
		return nil
	}
	return v
}

func (s *Server) venueDetail(w http.ResponseWriter, r *http.Request) {
	v := s.venueFromPath(w, r)
	if v == nil {
		return
	}
	stats, _ := s.st.VenueStats(v.ID)
	log, _ := s.st.EditLog(v.ID, 50) // user attribution is never shown here
	s.render(w, r, "venue", v.Name, map[string]any{"V": v, "Stats": stats, "Log": log})
}

func formFloat(r *http.Request, k string, def float64) float64 {
	if f, err := strconv.ParseFloat(strings.TrimSpace(r.FormValue(k)), 64); err == nil {
		return f
	}
	return def
}

// venueEdit is a last-write-wins edit of any field by any authenticated user.
func (s *Server) venueEdit(w http.ResponseWriter, r *http.Request) {
	v := s.venueFromPath(w, r)
	if v == nil {
		return
	}
	t := func(k string, max int) string {
		x := strings.TrimSpace(r.FormValue(k))
		if r := []rune(x); len(r) > max {
			x = string(r[:max])
		}
		return x
	}
	nf := store.VenueFields{
		Name: t("name", 200), Address: t("address", 300), City: t("city", 100), Country: strings.ToUpper(t("country", 2)),
		Category: t("category", 100), Cuisine: t("cuisine", 100), Website: t("website", 300), Phone: t("phone", 50),
		LocalNotes: t("local_notes", 5000),
		Lat:        formFloat(r, "lat", v.Lat), Lon: formFloat(r, "lon", v.Lon),
	}
	if nf.Website != "" && !strings.HasPrefix(nf.Website, "http://") && !strings.HasPrefix(nf.Website, "https://") {
		s.redirect(w, r, "/venues/"+r.PathValue("id"), "", "Website must start with http:// or https://")
		return
	}
	changed, err := s.st.EditVenue(v.ID, userFrom(r).ID, nf)
	switch {
	case errors.Is(err, store.ErrInvalidVenue):
		s.redirect(w, r, "/venues/"+r.PathValue("id"), "", err.Error())
	case err != nil:
		http.Error(w, "error", 500)
	case len(changed) == 0:
		s.redirect(w, r, "/venues/"+r.PathValue("id"), "No changes.", "")
	default:
		s.redirect(w, r, "/venues/"+r.PathValue("id"), "Saved: "+strings.Join(changed, ", "), "")
	}
}

// pullVenue refreshes an OSM-linked venue from Overpass. OSM wins for fields it
// provides; blank OSM values never erase local data, and local_notes is untouched.
func (s *Server) pullVenue(ctx context.Context, v *store.Venue) ([]string, error) {
	if !v.HasOSM() {
		return nil, errors.New("venue is not linked to OSM")
	}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	el, err := s.overpass.Get(ctx, v.OSMType, v.OSMID)
	if err != nil {
		return nil, err
	}
	nf := v.VenueFields
	o := el.Fields()
	over := func(dst *string, src string) {
		if src != "" {
			*dst = src
		}
	}
	over(&nf.Name, o.Name)
	over(&nf.Address, o.Address)
	over(&nf.City, o.City)
	over(&nf.Country, o.Country)
	over(&nf.Category, o.Category)
	over(&nf.Cuisine, o.Cuisine)
	over(&nf.Website, o.Website)
	over(&nf.Phone, o.Phone)
	if el.Lat != 0 || el.Lon != 0 {
		nf.Lat, nf.Lon = el.Lat, el.Lon
	}
	changed, err := s.st.EditVenue(v.ID, 0, nf)
	if err != nil {
		return nil, err
	}
	return changed, s.st.SetOSMSnapshot(v.ID, el.Type, el.ID, el.Version, el.TagsJSON())
}

func (s *Server) venueRefresh(w http.ResponseWriter, r *http.Request) {
	v := s.venueFromPath(w, r)
	if v == nil {
		return
	}
	changed, err := s.pullVenue(r.Context(), v)
	if err != nil {
		s.log.Warn("refresh failed", "venue_id", v.ID, "err", err)
		s.redirect(w, r, "/venues/"+r.PathValue("id"), "", "Refresh from OpenStreetMap failed.")
		return
	}
	msg := "Already up to date."
	if len(changed) > 0 {
		msg = "Updated from OSM: " + strings.Join(changed, ", ")
	}
	s.redirect(w, r, "/venues/"+r.PathValue("id"), msg, "")
}
