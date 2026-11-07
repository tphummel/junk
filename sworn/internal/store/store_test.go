package store

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
)

func newStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func cred(id string) webauthn.Credential {
	return webauthn.Credential{ID: []byte(id), PublicKey: []byte("pk-" + id)}
}

func TestFirstUserIsAdminAndLastPasskeyProtected(t *testing.T) {
	s := newStore(t)
	a, err := s.CreateUserWithPasskey("alice", []byte("h-alice"), "phone", cred("a1"))
	if err != nil || !a.IsAdmin {
		t.Fatalf("first user: %v admin=%v", err, a != nil && a.IsAdmin)
	}
	b, err := s.CreateUserWithPasskey("bob", []byte("h-bob"), "", cred("b1"))
	if err != nil || b.IsAdmin {
		t.Fatalf("second user must not be admin: %v", err)
	}
	if _, err := s.CreateUserWithPasskey("alice", []byte("h-alice"), "", cred("a2")); !errors.Is(err, ErrUsernameTaken) {
		t.Fatalf("want ErrUsernameTaken, got %v", err)
	}
	if err := s.DeactivatePasskey(a.ID, mustFirstPasskey(t, s, a.ID)); !errors.Is(err, ErrLastPasskey) {
		t.Fatalf("want ErrLastPasskey, got %v", err)
	}
	if err := s.AddPasskey(a.ID, "key", cred("a2")); err != nil {
		t.Fatal(err)
	}
	if err := s.DeactivatePasskey(a.ID, mustFirstPasskey(t, s, a.ID)); err != nil {
		t.Fatalf("rotation should work: %v", err)
	}
	if act, _ := s.Passkeys(a.ID, true); len(act) != 1 || string(act[0].Credential.ID) != "a2" {
		t.Fatalf("active passkeys = %+v", act)
	}
	// Another user's passkey id is not addressable.
	if err := s.DeactivatePasskey(b.ID, mustFirstPasskey(t, s, a.ID)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-user deactivate: %v", err)
	}
}

func mustFirstPasskey(t *testing.T, s *Store, uid int64) int64 {
	t.Helper()
	pks, _ := s.Passkeys(uid, true)
	if len(pks) == 0 {
		t.Fatal("no passkeys")
	}
	return pks[0].ID
}

func TestSessionSlidingAndExpiry(t *testing.T) {
	s := newStore(t)
	u, _ := s.CreateUserWithPasskey("a", []byte("h-a"), "", cred("x"))
	now := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	s.SetClock(func() time.Time { return now })
	tok, _ := s.CreateSession(u.ID, []byte("x"))
	now = now.Add(20 * 24 * time.Hour)
	if _, err := s.SessionUser(tok); err != nil {
		t.Fatalf("day 20: %v", err)
	}
	now = now.Add(20 * 24 * time.Hour) // day 40 > 30, but slid at day 20
	if _, err := s.SessionUser(tok); err != nil {
		t.Fatalf("sliding expiry should keep session alive: %v", err)
	}
	now = now.Add(31 * 24 * time.Hour)
	if _, err := s.SessionUser(tok); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired session accepted: %v", err)
	}
}

func TestVenueSearchEditLogAndFTS(t *testing.T) {
	s := newStore(t)
	u, _ := s.CreateUserWithPasskey("a", []byte("h-a"), "", cred("x"))
	id, err := s.InsertVenue(NewVenue{VenueFields: VenueFields{Name: "Joe's Pub", City: "London", Category: "amenity=pub", Lat: 51.5, Lon: -0.12}})
	if err != nil {
		t.Fatal(err)
	}
	s.InsertVenue(NewVenue{VenueFields: VenueFields{Name: "Blue Bottle Coffee", City: "Oakland", Lat: 37.8, Lon: -122.27}})
	for q, want := range map[string]int{"joe": 1, "pub": 1, "lond": 1, "coffee oak": 1, "zzz": 0, `"; DROP TABLE venues; --`: 0} {
		vs, n, err := s.SearchVenues(VenueFilter{Q: q})
		if err != nil || len(vs) != want || n != want {
			t.Errorf("search %q: got %d (%v), want %d", q, len(vs), err, want)
		}
	}
	v, _ := s.Venue(id)
	nf := v.VenueFields
	nf.Name, nf.Website, nf.LocalNotes = "Joe's Pub & Kitchen", "https://joes.example", "great chips"
	changed, err := s.EditVenue(id, u.ID, nf)
	if err != nil || len(changed) != 3 {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	if again, _ := s.EditVenue(id, u.ID, nf); len(again) != 0 {
		t.Fatalf("no-op edit logged: %v", again)
	}
	log, _ := s.EditLog(id, 10)
	if len(log) != 3 {
		t.Fatalf("log = %+v", log)
	}
	// FTS index follows edits.
	if vs, _, _ := s.SearchVenues(VenueFilter{Q: "kitchen"}); len(vs) != 1 {
		t.Fatal("FTS not updated after edit")
	}
	if vs, _, _ := s.SearchVenues(VenueFilter{Q: "joe", Status: StatusLinked}); len(vs) != 0 {
		t.Fatal("status filter ignored")
	}
	nf.Name = ""
	if _, err := s.EditVenue(id, u.ID, nf); !errors.Is(err, ErrInvalidVenue) {
		t.Fatalf("blank name accepted: %v", err)
	}
}

func TestFindDuplicate(t *testing.T) {
	s := newStore(t)
	id, _ := s.InsertVenue(NewVenue{VenueFields: VenueFields{Name: "Cafe X", Lat: 40, Lon: -74}, FoursquareID: "fsq1"})
	s.InsertVenue(NewVenue{VenueFields: VenueFields{Name: "Linked", Lat: 41, Lon: -74}, OSMType: "node", OSMID: 99, Status: StatusLinked})
	cases := []struct {
		name, fsq, ot string
		oid           int64
		lat, lon      float64
		want          bool
	}{
		{"by foursquare id", "fsq1", "", 0, 0, 0, true},
		{"by osm id", "", "node", 99, 0, 0, true},
		{"same name within 50m", "", "", 0, 40.0002, -74, true}, // ~22 m
		{"same name too far", "", "", 0, 40.002, -74, false},    // ~220 m
	}
	for _, c := range cases {
		name := c.name
		if c.name != "same name within 50m" && c.name != "same name too far" {
			name = "zzz"
		} else {
			name = "cafe x"
		}
		v, err := s.FindDuplicate(c.fsq, c.ot, c.oid, name, c.lat, c.lon)
		if (err == nil) != c.want {
			t.Errorf("%s: err=%v", c.name, err)
		}
		if err == nil && c.name == "by foursquare id" && v.ID != id {
			t.Errorf("wrong venue")
		}
	}
}

func TestCheckinsPrivacyInsightsExport(t *testing.T) {
	s := newStore(t)
	a, _ := s.CreateUserWithPasskey("a", []byte("h-a"), "", cred("a"))
	b, _ := s.CreateUserWithPasskey("b", []byte("h-b"), "", cred("b"))
	v1, _ := s.InsertVenue(NewVenue{VenueFields: VenueFields{Name: "One", City: "X", Country: "GB", Category: "amenity=cafe", Lat: 1, Lon: 1}, OSMType: "node", OSMID: 5, OSMTags: `{"amenity":"cafe"}`, Status: StatusLinked})
	v2, _ := s.InsertVenue(NewVenue{VenueFields: VenueFields{Name: "Two", City: "Y", Country: "GB", Lat: 2, Lon: 2}})
	t1 := time.Date(2019, 6, 15, 18, 30, 0, 0, time.UTC)
	ca, _ := s.InsertCheckin(NewCheckin{UserID: a.ID, VenueID: v1, VenueName: "One", Note: "hi", At: t1, Source: "imported", PhotoURLs: []string{"https://p/1.jpg"}})
	s.InsertCheckin(NewCheckin{UserID: a.ID, VenueID: v1, VenueName: "One", At: t1.Add(time.Hour), Source: "manual"})
	s.InsertCheckin(NewCheckin{UserID: a.ID, VenueID: v2, VenueName: "Two", At: t1.AddDate(1, 0, 0), Source: "manual"})
	s.InsertCheckin(NewCheckin{UserID: b.ID, VenueID: v1, VenueName: "One", At: t1, Source: "manual"})

	if _, err := s.Checkin(b.ID, ca); !errors.Is(err, ErrNotFound) {
		t.Fatal("user b can read user a's check-in")
	}
	if err := s.DeleteCheckin(b.ID, ca); !errors.Is(err, ErrNotFound) {
		t.Fatal("user b can delete user a's check-in")
	}
	if ok, _ := s.CheckinExists(a.ID, v1, t1); !ok {
		t.Fatal("CheckinExists false")
	}
	st, _ := s.VenueStats(v1)
	if st.Count != 3 {
		t.Fatalf("shared venue count = %d, want 3 (all users)", st.Count)
	}
	in, err := s.UserInsights(a.ID)
	if err != nil || in.Total != 3 || in.UniqueVenues != 2 || in.TopVenues[0].Label != "One" || in.TopVenues[0].N != 2 {
		t.Fatalf("insights: %+v err=%v", in, err)
	}
	if len(in.ByYear) != 2 || in.ByYear[0].Label != "2020" {
		t.Fatalf("by year: %+v", in.ByYear)
	}
	ex, err := s.ExportUser(a)
	if err != nil || len(ex.Checkins) != 3 || ex.SchemaVersion != 1 || ex.Username != "a" {
		t.Fatalf("export: %+v err=%v", ex, err)
	}
	first := ex.Checkins[0]
	if first.Venue.OSM == nil || first.Venue.OSM.ID != 5 || len(first.PhotoURLs) != 1 || string(first.Venue.OSMTags) != `{"amenity":"cafe"}` {
		t.Fatalf("export shape: %+v", first)
	}
}
