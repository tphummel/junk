package web

import (
	"encoding/json"
	"net/http"
	"path"
	"regexp"
	"time"
)

func (s *Server) insightsPage(w http.ResponseWriter, r *http.Request) {
	in, err := s.st.UserInsights(userFrom(r).ID)
	if err != nil {
		http.Error(w, "error", 500)
		return
	}
	s.render(w, r, "insights", "Insights", in)
}

func (s *Server) mapPage(w http.ResponseWriter, r *http.Request) {
	s.render(w, r, "map", "Map", nil)
}

func (s *Server) apiMap(w http.ResponseWriter, r *http.Request) {
	f := func(k string, def float64) float64 { return formFloat(r, k, def) }
	minLat, minLon, maxLat, maxLon := f("minLat", -90), f("minLon", -180), f("maxLat", 90), f("maxLon", 180)
	pts, err := s.st.UserCheckinPoints(userFrom(r).ID, minLat, minLon, maxLat, maxLon, 1000)
	if err != nil {
		jsonError(w, 500, "error")
		return
	}
	vs, err := s.st.VenuesInBBox(minLat, minLon, maxLat, maxLon, 1000)
	if err != nil {
		jsonError(w, 500, "error")
		return
	}
	type cpt struct {
		ID    int64   `json:"id"`
		Name  string  `json:"name"`
		Lat   float64 `json:"lat"`
		Lon   float64 `json:"lon"`
		Count int     `json:"count"`
	}
	outV := make([]map[string]any, 0, len(vs))
	for _, v := range vs {
		outV = append(outV, map[string]any{"id": v.ID, "name": v.Name, "lat": v.Lat, "lon": v.Lon})
	}
	outC := make([]cpt, 0, len(pts))
	for _, p := range pts {
		outC = append(outC, cpt{p.VenueID, p.Name, p.Lat, p.Lon, p.Count})
	}
	writeJSON(w, 200, map[string]any{"venues": outV, "checkins": outC})
}

var tileRe = regexp.MustCompile(`^\d{1,2}/\d{1,7}/\d{1,7}\.png$`)

// serveTile serves /data/tiles/{z}/{x}/{y}.png; the strict pattern blocks traversal and directory listings.
func (s *Server) serveTile(w http.ResponseWriter, r *http.Request) {
	rel := r.URL.Path[len("/tiles/"):]
	if !tileRe.MatchString(rel) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeFile(w, r, path.Join(s.cfg.TilesDir(), rel))
}

func (s *Server) exportPage(w http.ResponseWriter, r *http.Request) {
	s.render(w, r, "export", "Export", nil)
}

func (s *Server) exportDownload(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	ex, err := s.st.ExportUser(u)
	if err != nil {
		http.Error(w, "error", 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="sworn-`+time.Now().UTC().Format("2006-01-02")+`.json"`)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(ex)
}
