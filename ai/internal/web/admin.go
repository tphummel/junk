package web

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"venuecheck/internal/importer"
	"venuecheck/internal/osm"
	"venuecheck/internal/store"
)

func (s *Server) adminVenues(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.FormValue("page"))
	if page < 1 {
		page = 1
	}
	status := r.FormValue("status")
	if status != store.StatusLinked && status != store.StatusLocalOnly && status != store.StatusReconcile {
		status = ""
	}
	q := strings.TrimSpace(r.FormValue("q"))
	vs, total, err := s.st.SearchVenues(store.VenueFilter{Q: q, Status: status, Limit: 50, Offset: (page - 1) * 50})
	if err != nil {
		http.Error(w, "error", 500)
		return
	}
	s.render(w, r, "admin_venues", "Admin: venues", map[string]any{"Venues": vs, "Q": q, "Status": status, "Page": page,
		"Total": total, "More": page*50 < total})
}

type adminVenueData struct {
	V          *store.Venue
	Log        []store.EditLogEntry
	Pending    []string // venue fields that differ from the last OSM snapshot
	CanPush    bool
	Candidates []candidate
	Reconciled bool // candidate search was run
}

type candidate struct {
	Type     string
	ID       int64
	Name     string
	Category string
	Distance int
	Dist     int // levenshtein distance of the name
}

func (s *Server) adminVenue(w http.ResponseWriter, r *http.Request) {
	v := s.venueFromPath(w, r)
	if v == nil {
		return
	}
	s.renderAdminVenue(w, r, v, nil, false)
}

func (s *Server) renderAdminVenue(w http.ResponseWriter, r *http.Request, v *store.Venue, cands []candidate, ran bool) {
	d := adminVenueData{V: v, Candidates: cands, Reconciled: ran, CanPush: s.writer.Configured()}
	d.Log, _ = s.st.EditLog(v.ID, 100)
	if v.HasOSM() {
		d.Pending = osm.Diff(osm.ElementFromVenue(v), v.VenueFields).FieldKeys
	}
	s.render(w, r, "admin_venue", "Admin: "+v.Name, d)
}

func (s *Server) adminPull(w http.ResponseWriter, r *http.Request) {
	v := s.venueFromPath(w, r)
	if v == nil {
		return
	}
	changed, err := s.pullVenue(r.Context(), v)
	back := "/admin/venues/" + r.PathValue("id")
	if err != nil {
		s.log.Warn("pull failed", "venue_id", v.ID, "err", err)
		s.redirect(w, r, back, "", "Pull failed: "+err.Error())
		return
	}
	s.redirect(w, r, back, fmt.Sprintf("Pulled from OSM (%d field(s) changed).", len(changed)), "")
}

// adminPush creates a node (local-only venues) or uploads changed fields (osm-linked).
func (s *Server) adminPush(w http.ResponseWriter, r *http.Request) {
	v := s.venueFromPath(w, r)
	if v == nil {
		return
	}
	back := "/admin/venues/" + r.PathValue("id")
	if !s.writer.Configured() {
		s.redirect(w, r, back, "", "OSM writing is not configured (set OSM_API_KEY).")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()

	if v.HasOSM() {
		el := osm.ElementFromVenue(v)
		ch := osm.Diff(el, v.VenueFields)
		if ch.Empty() {
			s.redirect(w, r, back, "Nothing to push.", "")
			return
		}
		ver, err := s.writer.UpdateElement(ctx, v.OSMType, v.OSMID, ch)
		if err != nil {
			s.st.Audit(v.ID, "update", false, err.Error())
			s.log.Warn("osm update failed", "venue_id", v.ID, "err", err)
			s.redirect(w, r, back, "", "OSM update failed: "+err.Error())
			return
		}
		for k, val := range ch.Tags {
			el.Tags[k] = val
		}
		if ch.Moved {
			el.Lat, el.Lon = ch.Lat, ch.Lon
		}
		_ = s.st.SetOSMSnapshot(v.ID, v.OSMType, v.OSMID, ver, el.TagsJSON())
		s.st.Audit(v.ID, "update", true, strings.Join(ch.FieldKeys, ","))
		s.redirect(w, r, back, "Pushed to OSM: "+strings.Join(ch.FieldKeys, ", "), "")
		return
	}

	if v.Status == store.StatusLinked {
		s.redirect(w, r, back, "", "Venue has no OSM element to update.")
		return
	}
	tags := osm.TagsFromVenue(v.VenueFields)
	if tags["name"] == "" || len(tags) < 2 {
		s.redirect(w, r, back, "", "Add a category (e.g. amenity=cafe) before creating a node in OSM.")
		return
	}
	id, err := s.writer.CreateNode(ctx, v.Lat, v.Lon, tags)
	if err != nil {
		s.st.Audit(v.ID, "create", false, err.Error())
		s.log.Warn("osm create failed", "venue_id", v.ID, "err", err)
		s.redirect(w, r, back, "", "OSM create failed: "+err.Error())
		return
	}
	el := osm.Element{Type: "node", ID: id, Version: 1, Lat: v.Lat, Lon: v.Lon, Tags: tags}
	if err := s.st.SetOSMSnapshot(v.ID, "node", id, 1, el.TagsJSON()); err != nil {
		s.log.Error("created node but could not link it", "venue_id", v.ID, "node", id, "err", err)
	}
	s.st.Audit(v.ID, "create", true, fmt.Sprintf("node/%d", id))
	s.redirect(w, r, back, fmt.Sprintf("Created node/%d in OSM.", id), "")
}

// adminReconcile searches OSM within 50 m for a name match (Levenshtein <= 2).
func (s *Server) adminReconcile(w http.ResponseWriter, r *http.Request) {
	v := s.venueFromPath(w, r)
	if v == nil {
		return
	}
	if v.HasOSM() {
		s.redirect(w, r, "/admin/venues/"+r.PathValue("id"), "", "Venue is already linked to OSM.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	els, err := s.overpass.Around(ctx, v.Lat, v.Lon, 50)
	if err != nil {
		s.redirect(w, r, "/admin/venues/"+r.PathValue("id"), "", "OSM lookup failed: "+err.Error())
		return
	}
	var cands []candidate
	for _, el := range els {
		d := osm.Levenshtein(v.Name, el.Tags["name"])
		if d > 2 {
			continue
		}
		cands = append(cands, candidate{el.Type, el.ID, el.Tags["name"], el.Category(),
			int(store.Haversine(v.Lat, v.Lon, el.Lat, el.Lon)), d})
	}
	s.renderAdminVenue(w, r, v, cands, true)
}

// adminLink attaches the chosen OSM element and stores its snapshot (local fields are not overwritten).
func (s *Server) adminLink(w http.ResponseWriter, r *http.Request) {
	v := s.venueFromPath(w, r)
	if v == nil {
		return
	}
	back := "/admin/venues/" + r.PathValue("id")
	id, _ := strconv.ParseInt(r.FormValue("osm_id"), 10, 64)
	typ := r.FormValue("osm_type")
	if other, err := s.st.VenueByOSM(typ, id); err == nil && other.ID != v.ID {
		s.redirect(w, r, back, "", fmt.Sprintf("That OSM element is already linked to venue #%d.", other.ID))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	el, err := s.overpass.Get(ctx, typ, id)
	if err != nil {
		s.redirect(w, r, back, "", "Could not fetch that element: "+err.Error())
		return
	}
	if err := s.st.SetOSMSnapshot(v.ID, el.Type, el.ID, el.Version, el.TagsJSON()); err != nil {
		s.redirect(w, r, back, "", "Could not link: "+err.Error())
		return
	}
	s.redirect(w, r, back, fmt.Sprintf("Linked to %s/%d.", el.Type, el.ID), "")
}

func (s *Server) adminDismiss(w http.ResponseWriter, r *http.Request) {
	v := s.venueFromPath(w, r)
	if v == nil {
		return
	}
	if v.HasOSM() {
		http.Error(w, "venue is linked", http.StatusConflict)
		return
	}
	if err := s.st.SetStatus(v.ID, store.StatusLocalOnly); err != nil {
		http.Error(w, "error", 500)
		return
	}
	s.redirect(w, r, "/admin/venues/"+r.PathValue("id"), "Confirmed: no OSM match (local-only).", "")
}

func (s *Server) importPage(w http.ResponseWriter, r *http.Request) {
	s.render(w, r, "admin_import", "Admin: import", nil)
}

func (s *Server) importUpload(w http.ResponseWriter, r *http.Request) {
	f, hdr, err := r.FormFile("file")
	if err != nil {
		s.redirect(w, r, "/admin/import", "", "Choose a file to upload.")
		return
	}
	defer f.Close()
	var rows []importer.Row
	var perrs []string
	switch {
	case strings.HasSuffix(strings.ToLower(hdr.Filename), ".csv"):
		rows, perrs, err = importer.ParseCSV(f)
	case strings.HasSuffix(strings.ToLower(hdr.Filename), ".json"):
		rows, perrs, err = importer.ParseJSON(f)
	default:
		err = errors.New("file must be .json (Foursquare) or .csv (Swarm)")
	}
	if err != nil {
		s.redirect(w, r, "/admin/import", "", err.Error())
		return
	}
	res := importer.Load(s.st, userFrom(r).ID, rows, perrs)
	s.log.Info("import finished", "rows", res.Rows, "imported", res.Imported, "skipped", res.Skipped, "errors", len(res.Errors))
	if len(res.Errors) > 100 {
		res.Errors = append(res.Errors[:100], fmt.Sprintf("… and %d more", len(res.Errors)-100))
	}
	s.render(w, r, "admin_import", "Admin: import", res)
}
