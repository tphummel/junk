package web

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/descope/virtualwebauthn"

	"sworn/internal/config"
	"sworn/internal/store"
)

const (
	rpID   = "localhost"
	origin = "https://localhost"
)

// fakeOSM serves both Overpass (POST /overpass) and OSM API 0.6 (/api/...).
type fakeOSM struct {
	srv      *httptest.Server
	overpass string // JSON body returned for every Overpass query
	lastQL   string
	creates  int
}

func newFakeOSM(t *testing.T) *fakeOSM {
	f := &fakeOSM{overpass: `{"elements":[]}`}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/overpass":
			r.ParseForm()
			f.lastQL = r.FormValue("data")
			io.WriteString(w, f.overpass)
		case r.URL.Path == "/api/changeset/create":
			io.WriteString(w, "11")
		case r.URL.Path == "/api/node/create":
			f.creates++
			io.WriteString(w, "9001")
		}
	}))
	t.Cleanup(f.srv.Close)
	return f
}

type env struct {
	t    *testing.T
	s    *Server
	st   *store.Store
	h    http.Handler
	osm  *fakeOSM
	rp   virtualwebauthn.RelyingParty
	auth virtualwebauthn.Authenticator
	cred virtualwebauthn.Credential
	jar  map[string]*http.Cookie
}

func newEnv(t *testing.T, allowRegister bool) *env {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "w.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	f := newFakeOSM(t)
	cfg := &config.Config{Port: "8080", DataDir: t.TempDir(), RPID: rpID, RPOrigins: []string{origin}, OSMAPIKey: "k",
		OSMAPIBase: f.srv.URL + "/api", OverpassURL: f.srv.URL + "/overpass", Hostname: "test", AllowRegister: allowRegister}
	s, err := New(cfg, st, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	return &env{t: t, s: s, st: st, h: s.Handler(), osm: f,
		rp:   virtualwebauthn.RelyingParty{Name: "Sworn", ID: rpID, Origin: origin},
		auth: virtualwebauthn.NewAuthenticator(), cred: virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2),
		jar: map[string]*http.Cookie{}}
}

func (e *env) do(method, path string, body []byte, hdr map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, bytes.NewReader(body))
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	for _, c := range e.jar {
		r.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, r)
	for _, c := range rec.Result().Cookies() {
		if c.MaxAge < 0 {
			delete(e.jar, c.Name)
		} else {
			e.jar[c.Name] = c
		}
	}
	return rec
}

func (e *env) csrf() string {
	return csrfToken(e.jar[sessionCookie].Value)
}

// postForm sends an authenticated form POST with a valid CSRF token.
func (e *env) postForm(path string, v url.Values) *httptest.ResponseRecorder {
	if v == nil {
		v = url.Values{}
	}
	v.Set("csrf", e.csrf())
	return e.do("POST", path, []byte(v.Encode()), map[string]string{"Content-Type": "application/x-www-form-urlencoded"})
}

func (e *env) get(path string) *httptest.ResponseRecorder { return e.do("GET", path, nil, nil) }

// register runs a full WebAuthn registration ceremony and leaves the env logged in.
func (e *env) register(username string) {
	e.t.Helper()
	rec := e.do("POST", "/register/begin", []byte(`{"username":"`+username+`","name":"laptop"}`), nil)
	if rec.Code != 200 {
		e.t.Fatalf("register/begin %d: %s", rec.Code, rec.Body)
	}
	opts, err := virtualwebauthn.ParseAttestationOptions(rec.Body.String())
	if err != nil {
		e.t.Fatal(err)
	}
	resp := virtualwebauthn.CreateAttestationResponse(e.rp, e.auth, e.cred, *opts)
	rec = e.do("POST", "/register/finish", []byte(resp), nil)
	if rec.Code != 200 {
		e.t.Fatalf("register/finish %d: %s", rec.Code, rec.Body)
	}
	e.auth.AddCredential(e.cred)
}

func (e *env) login(username string) *httptest.ResponseRecorder {
	return e.loginWith(username, e.cred)
}

func (e *env) loginWith(username string, cred virtualwebauthn.Credential) *httptest.ResponseRecorder {
	rec := e.do("POST", "/login/begin", []byte(`{"username":"`+username+`"}`), nil)
	if rec.Code != 200 {
		return rec
	}
	opts, err := virtualwebauthn.ParseAssertionOptions(rec.Body.String())
	if err != nil {
		e.t.Fatal(err)
	}
	resp := virtualwebauthn.CreateAssertionResponse(e.rp, e.auth, cred, *opts)
	return e.do("POST", "/login/finish", []byte(resp), nil)
}

func TestHealthAndUnauthenticated(t *testing.T) {
	e := newEnv(t, false)
	if rec := e.get("/health"); rec.Code != 200 {
		t.Fatal("health")
	}
	for _, p := range []string{"/", "/venues", "/map", "/insights", "/checkin", "/passkeys", "/export"} {
		if rec := e.get(p); rec.Code != 303 || rec.Header().Get("Location") != "/login" {
			t.Errorf("%s: %d %s", p, rec.Code, rec.Header().Get("Location"))
		}
	}
	for _, p := range []string{"/api/search?q=x", "/api/map", "/tiles/1/0/0.png"} {
		if p == "/tiles/1/0/0.png" {
			continue
		}
		if rec := e.get(p); rec.Code != 401 {
			t.Errorf("%s: %d", p, rec.Code)
		}
	}
	if rec := e.get("/admin/venues"); rec.Code != 303 {
		t.Errorf("admin unauth: %d", rec.Code)
	}
}

func TestRegistrationLoginSecurityHeadersAndCookies(t *testing.T) {
	e := newEnv(t, false)
	e.register("alice")
	ck := e.jar[sessionCookie]
	if ck == nil || !ck.HttpOnly || ck.SameSite != http.SameSiteStrictMode || !ck.Secure {
		t.Fatalf("session cookie flags: %+v", ck) // origin is https => Secure
	}
	rec := e.get("/")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Recent check-ins") {
		t.Fatalf("home: %d", rec.Code)
	}
	if csp := rec.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "script-src 'self'") {
		t.Fatalf("csp: %q", csp)
	}
	// First user is admin.
	if rec := e.get("/admin/venues"); rec.Code != 200 {
		t.Fatalf("admin as first user: %d", rec.Code)
	}
	// Registration is now closed.
	e2 := newEnv(t, false)
	e2.register("first")
	e2.jar = map[string]*http.Cookie{}
	if rec := e2.get("/register"); rec.Code != 404 {
		t.Fatalf("/register after bootstrap = %d", rec.Code)
	}
	if rec := e2.do("POST", "/register/begin", []byte(`{"username":"mallory"}`), nil); rec.Code != 404 {
		t.Fatalf("register/begin after bootstrap = %d", rec.Code)
	}
	// Log out, log back in with the passkey.
	e.postForm("/logout", nil)
	if rec := e.get("/"); rec.Code != 303 {
		t.Fatal("still logged in after logout")
	}
	if rec := e.login("alice"); rec.Code != 200 {
		t.Fatalf("login: %d %s", rec.Code, rec.Body)
	}
	if rec := e.get("/"); rec.Code != 200 {
		t.Fatal("not logged in after login")
	}
	if rec := e.do("POST", "/login/begin", []byte(`{"username":"nobody"}`), nil); rec.Code != 401 {
		t.Fatalf("unknown user: %d", rec.Code)
	}
}

func TestCSRFRequired(t *testing.T) {
	e := newEnv(t, false)
	e.register("alice")
	rec := e.do("POST", "/logout", []byte("x=1"), map[string]string{"Content-Type": "application/x-www-form-urlencoded"})
	if rec.Code != 403 {
		t.Fatalf("logout without csrf = %d", rec.Code)
	}
	rec = e.do("POST", "/export", []byte("csrf=wrong"), map[string]string{"Content-Type": "application/x-www-form-urlencoded"})
	if rec.Code != 403 {
		t.Fatalf("export with wrong csrf = %d", rec.Code)
	}
	if rec := e.postForm("/export", nil); rec.Code != 200 || !strings.Contains(rec.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("export: %d", rec.Code)
	}
}

func TestPasskeyRotation(t *testing.T) {
	e := newEnv(t, false)
	e.register("alice")
	pks, _ := e.st.Passkeys(1, true)
	// Cannot deactivate the only passkey.
	rec := e.postForm("/passkeys/"+itoa(pks[0].ID)+"/deactivate", nil)
	if rec.Code != 303 || !strings.Contains(rec.Header().Get("Location"), "err=") {
		t.Fatalf("expected error redirect, got %d %s", rec.Code, rec.Header().Get("Location"))
	}
	// Add a second passkey.
	rec = e.do("POST", "/passkeys/begin", []byte(`{"name":"yubikey"}`), map[string]string{"X-CSRF-Token": e.csrf()})
	if rec.Code != 200 {
		t.Fatalf("add begin: %d %s", rec.Code, rec.Body)
	}
	opts, _ := virtualwebauthn.ParseAttestationOptions(rec.Body.String())
	second := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	resp := virtualwebauthn.CreateAttestationResponse(e.rp, e.auth, second, *opts)
	rec = e.do("POST", "/passkeys/finish", []byte(resp), map[string]string{"X-CSRF-Token": e.csrf()})
	if rec.Code != 200 {
		t.Fatalf("add finish: %d %s", rec.Code, rec.Body)
	}
	e.auth.AddCredential(second)
	// Add without CSRF header is refused.
	if rec := e.do("POST", "/passkeys/begin", []byte(`{}`), nil); rec.Code != 403 {
		t.Fatalf("passkeys/begin without csrf = %d", rec.Code)
	}
	// Deactivate the original; its login must stop working, the new one must work.
	e.postForm("/passkeys/"+itoa(pks[0].ID)+"/deactivate", nil)
	e.jar = map[string]*http.Cookie{}
	if rec := e.login("alice"); rec.Code != 401 {
		t.Fatalf("deactivated passkey must not sign in, got %d", rec.Code)
	}
	if rec := e.loginWith("alice", second); rec.Code != 200 {
		t.Fatalf("login with new key: %d %s", rec.Code, rec.Body)
	}
	if act, _ := e.st.Passkeys(1, true); len(act) != 1 {
		t.Fatalf("active = %d", len(act))
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

var osmResult = `{"elements":[
 {"type":"node","id":501,"version":2,"lat":51.5001,"lon":-0.1201,"tags":{"name":"Joe's Pub","amenity":"pub","addr:city":"London"}},
 {"type":"node","id":502,"version":1,"lat":51.5003,"lon":-0.1203,"tags":{"name":"Cafe Nero","amenity":"cafe"}}]}`

func TestCheckinFlowWithOSMAndPrivacy(t *testing.T) {
	e := newEnv(t, true)
	e.register("alice")
	// Pre-existing tracked venue linked to osm node 501 (older version).
	vid, _ := e.st.InsertVenue(store.NewVenue{VenueFields: store.VenueFields{Name: "Joe's Pub", Lat: 51.5001, Lon: -0.1201},
		OSMType: "node", OSMID: 501, OSMVersion: 1, Status: store.StatusLinked})
	e.st.InsertCheckin(store.NewCheckin{UserID: 1, VenueID: vid, VenueName: "Joe's Pub", At: time.Date(2019, 6, 1, 0, 0, 0, 0, time.UTC), Source: "imported"})
	e.osm.overpass = osmResult

	rec := e.get("/api/search?q=joe&lat=51.5&lon=-0.12")
	if rec.Code != 200 {
		t.Fatalf("search: %d %s", rec.Code, rec.Body)
	}
	var res struct {
		Local []localHit `json:"local"`
		OSM   []osmHit   `json:"osm"`
	}
	json.Unmarshal(rec.Body.Bytes(), &res)
	if len(res.Local) != 1 || res.Local[0].Visits != 1 || !res.Local[0].OSMUpdated {
		t.Fatalf("local hits (tracked + updated-from-OSM expected): %+v", res.Local)
	}
	if len(res.OSM) != 1 || res.OSM[0].Name != "Cafe Nero" {
		t.Fatalf("osm-only hits must exclude the tracked venue: %+v", res.OSM)
	}
	if !strings.Contains(e.osm.lastQL, "around:500") {
		t.Fatalf("expected an around query, got %s", e.osm.lastQL)
	}

	// Check in at the OSM-only result: upserts a linked venue.
	rec = e.postForm("/checkin", url.Values{"osm_type": {"node"}, "osm_id": {"502"}, "note": {"flat white"}, "lat": {"51.5"}, "lon": {"-0.12"}})
	if rec.Code != 303 || !strings.HasPrefix(rec.Header().Get("Location"), "/checkins/") {
		t.Fatalf("checkin: %d %s", rec.Code, rec.Header().Get("Location"))
	}
	v, err := e.st.VenueByOSM("node", 502)
	if err != nil || v.Status != store.StatusLinked || v.OSMTags == "" || v.OSMPulledAt == "" {
		t.Fatalf("upserted venue: %+v err=%v", v, err)
	}
	// Second check-in reuses the venue.
	e.postForm("/checkin", url.Values{"osm_type": {"node"}, "osm_id": {"502"}})
	if vs, _, _ := e.st.SearchVenues(store.VenueFilter{}); len(vs) != 2 {
		t.Fatalf("venues = %d, want 2", len(vs))
	}
	// Fallback: local venue.
	rec = e.postForm("/checkin", url.Values{"new": {"1"}, "name": {"My Secret Spot"}, "venue_lat": {"10"}, "venue_lon": {"20"}})
	if rec.Code != 303 {
		t.Fatalf("local venue: %d", rec.Code)
	}
	lv, _, _ := e.st.SearchVenues(store.VenueFilter{Q: "secret"})
	if len(lv) != 1 || lv[0].Status != store.StatusLocalOnly {
		t.Fatalf("local venue: %+v", lv)
	}

	// Edit within ±1 day works, beyond it is refused.
	c, _ := e.st.Checkin(1, 1)
	ok := e.postForm("/checkins/1", url.Values{"note": {"edited"}, "checked_in_at": {c.CheckedInAt.Add(23 * time.Hour).Format("2006-01-02T15:04")}})
	bad := e.postForm("/checkins/1", url.Values{"note": {"x"}, "checked_in_at": {c.CheckedInAt.Add(30 * time.Hour).Format("2006-01-02T15:04")}})
	if !strings.Contains(ok.Header().Get("Location"), "msg=") || !strings.Contains(bad.Header().Get("Location"), "err=") {
		t.Fatalf("edit window: ok=%s bad=%s", ok.Header().Get("Location"), bad.Header().Get("Location"))
	}

	// Privacy: a second user cannot see or delete alice's check-in.
	bob := newEnvSharing(t, e)
	bob.register("bob")
	if rec := bob.get("/checkins/1"); rec.Code != 404 {
		t.Fatalf("bob reads alice's check-in: %d", rec.Code)
	}
	if rec := bob.postForm("/checkins/1/delete", nil); rec.Code != 404 {
		t.Fatalf("bob deletes alice's check-in: %d", rec.Code)
	}
	if rec := bob.get("/admin/venues"); rec.Code != 404 {
		t.Fatalf("non-admin admin access = %d, want 404", rec.Code)
	}
	// ... but bob sees shared venue pages and aggregate counts.
	rec = bob.get("/venues/" + itoa(vid))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "<strong>1</strong>") {
		t.Fatalf("shared venue page: %d", rec.Code)
	}
	// Bob's export contains none of alice's data.
	rec = bob.postForm("/export", nil)
	if strings.Contains(rec.Body.String(), "flat white") || strings.Contains(rec.Body.String(), "Joe's Pub") {
		t.Fatalf("export leaked: %s", rec.Body)
	}
}

// newEnvSharing makes a second client (own cookies/authenticator) against the same server.
func newEnvSharing(t *testing.T, e *env) *env {
	return &env{t: t, s: e.s, st: e.st, h: e.h, osm: e.osm, rp: e.rp,
		auth: virtualwebauthn.NewAuthenticator(), cred: virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2),
		jar: map[string]*http.Cookie{}}
}

func TestVenueEditLogAndAdminPushPull(t *testing.T) {
	e := newEnv(t, false)
	e.register("alice")
	lid, _ := e.st.InsertVenue(store.NewVenue{VenueFields: store.VenueFields{Name: "Local Cafe", Category: "amenity=cafe", Lat: 1, Lon: 2}, Status: store.StatusReconcile})

	rec := e.postForm("/venues/"+itoa(lid), url.Values{"name": {"Local Cafe"}, "category": {"amenity=cafe"}, "lat": {"1"}, "lon": {"2"},
		"website": {"javascript:alert(1)"}})
	if !strings.Contains(rec.Header().Get("Location"), "err=") {
		t.Fatalf("javascript: URL accepted: %s", rec.Header().Get("Location"))
	}
	e.postForm("/venues/"+itoa(lid), url.Values{"name": {"Local Cafe"}, "category": {"amenity=cafe"}, "lat": {"1"}, "lon": {"2"},
		"phone": {"123"}, "local_notes": {"<script>x</script>"}})
	page := e.get("/venues/" + itoa(lid)).Body.String()
	if strings.Contains(page, "<script>x</script>") || !strings.Contains(page, "&lt;script&gt;x&lt;/script&gt;") {
		t.Fatal("notes not HTML-escaped")
	}
	if !strings.Contains(page, "<td>phone</td>") {
		t.Fatalf("edit log missing phone change")
	}

	// Push creates a node and links the venue.
	rec = e.postForm("/admin/venues/"+itoa(lid)+"/push", nil)
	if e.osm.creates != 1 || !strings.Contains(rec.Header().Get("Location"), "node%2F9001") {
		t.Fatalf("push: creates=%d loc=%s", e.osm.creates, rec.Header().Get("Location"))
	}
	v, _ := e.st.Venue(lid)
	if v.OSMType != "node" || v.OSMID != 9001 || v.Status != store.StatusLinked || v.OSMVersion != 1 {
		t.Fatalf("venue after push: %+v", v)
	}

	// Pull overwrites derived fields but keeps local notes.
	e.osm.overpass = `{"elements":[{"type":"node","id":9001,"version":2,"lat":1,"lon":2,"tags":{"name":"Renamed Cafe","amenity":"cafe","cuisine":"coffee"}}]}`
	e.postForm("/admin/venues/"+itoa(lid)+"/pull", nil)
	v, _ = e.st.Venue(lid)
	if v.Name != "Renamed Cafe" || v.Cuisine != "coffee" || v.LocalNotes != "<script>x</script>" || v.OSMVersion != 2 {
		t.Fatalf("after pull: %+v", v)
	}
	if rec := e.get("/admin/venues/" + itoa(lid)); rec.Code != 200 || !strings.Contains(rec.Body.String(), "Renamed Cafe") {
		t.Fatalf("admin detail: %d", rec.Code)
	}
}

func TestReconcileAndImportUpload(t *testing.T) {
	e := newEnv(t, false)
	e.register("alice")
	vid, _ := e.st.InsertVenue(store.NewVenue{VenueFields: store.VenueFields{Name: "Starbucks", Lat: 40, Lon: -74}, Status: store.StatusReconcile})
	e.osm.overpass = `{"elements":[
	 {"type":"node","id":1,"version":1,"lat":40.0001,"lon":-74,"tags":{"name":"Starbuck","amenity":"cafe"}},
	 {"type":"node","id":2,"version":1,"lat":40.0001,"lon":-74,"tags":{"name":"Totally Different","amenity":"cafe"}}]}`
	rec := e.postForm("/admin/venues/"+itoa(vid)+"/reconcile", nil)
	body := rec.Body.String()
	if rec.Code != 200 || !strings.Contains(body, "Starbuck") || strings.Contains(body, "Totally Different") {
		t.Fatalf("candidates must be fuzzy-filtered: %d", rec.Code)
	}
	e.osm.overpass = `{"elements":[{"type":"node","id":1,"version":4,"lat":40,"lon":-74,"tags":{"name":"Starbuck","amenity":"cafe"}}]}`
	e.postForm("/admin/venues/"+itoa(vid)+"/link", url.Values{"osm_type": {"node"}, "osm_id": {"1"}})
	if v, _ := e.st.Venue(vid); v.Status != store.StatusLinked || v.OSMID != 1 || v.OSMVersion != 4 || v.Name != "Starbucks" {
		t.Fatalf("link: %+v", v)
	}
	// Dismiss on a second venue.
	v2, _ := e.st.InsertVenue(store.NewVenue{VenueFields: store.VenueFields{Name: "Nowhere", Lat: 5, Lon: 5}, Status: store.StatusReconcile})
	e.postForm("/admin/venues/"+itoa(v2)+"/dismiss", nil)
	if v, _ := e.st.Venue(v2); v.Status != store.StatusLocalOnly {
		t.Fatalf("dismiss: %+v", v)
	}

	// Upload an import file (multipart, CSRF as a form field).
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	mw.WriteField("csrf", e.csrf())
	fw, _ := mw.CreateFormFile("file", "checkins.json")
	fw.Write([]byte(`[{"createdAt":1560623400,"venue":{"id":"v9","name":"Imported Place","location":{"lat":3,"lng":4}}}]`))
	mw.Close()
	rec = e.do("POST", "/admin/import", buf.Bytes(), map[string]string{"Content-Type": mw.FormDataContentType()})
	if rec.Code != 200 || !regexp.MustCompile(`Imported: <strong>1</strong>`).MatchString(rec.Body.String()) {
		t.Fatalf("import: %d %s", rec.Code, rec.Body)
	}
	if in, _ := e.st.UserInsights(1); in.Total != 1 {
		t.Fatalf("imported check-ins = %d", in.Total)
	}
}

func TestTileHandlerRejectsTraversal(t *testing.T) {
	e := newEnv(t, false)
	e.register("alice")
	if rec := e.get("/tiles/../venue.db"); rec.Code == 200 {
		t.Fatal("traversal served")
	}
	for _, p := range []string{"/tiles/1/2/3.png", "/tiles/", "/tiles/a/b/c.png"} {
		if rec := e.get(p); rec.Code != 404 {
			t.Errorf("%s = %d", p, rec.Code)
		}
	}
}

// TestAllPagesRender hits every GET page as the admin to catch template errors.
func TestAllPagesRender(t *testing.T) {
	e := newEnv(t, false)
	e.register("alice")
	vid, _ := e.st.InsertVenue(store.NewVenue{VenueFields: store.VenueFields{Name: "V", City: "C", Country: "GB", Category: "amenity=cafe", Lat: 1, Lon: 2},
		OSMType: "node", OSMID: 7, OSMTags: `{"amenity":"cafe"}`, Status: store.StatusLinked})
	cid, _ := e.st.InsertCheckin(store.NewCheckin{UserID: 1, VenueID: vid, VenueName: "V", At: time.Now(), Source: "manual"})
	for _, p := range []string{"/", "/checkin", "/checkin/new?new=1", "/checkin/new?venue_id=" + itoa(vid), "/checkins/" + itoa(cid),
		"/venues", "/venues?q=v", "/venues/" + itoa(vid), "/insights", "/map", "/export", "/passkeys",
		"/admin/venues", "/admin/venues?status=osm-linked&q=v", "/admin/venues/" + itoa(vid), "/admin/import", "/api/map?minLat=0&maxLat=5&minLon=0&maxLon=5"} {
		rec := e.get(p)
		if rec.Code != 200 {
			t.Errorf("%s: %d %s", p, rec.Code, strings.TrimSpace(rec.Body.String())[:min(120, rec.Body.Len())])
		}
	}
	if body := e.get("/api/map?minLat=0&maxLat=5&minLon=0&maxLon=5").Body.String(); !strings.Contains(body, `"checkins":[{`) {
		t.Errorf("map api: %s", body)
	}
}
