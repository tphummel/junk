package importer

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"sworn/internal/store"
)

const fsqJSON = `{"checkins":{"items":[
 {"createdAt":1560623400,"shout":"Great burger","venue":{"id":"abc","name":"Joe's Pub","location":{"lat":51.5074,"lng":-0.1278,"address":"151 Great Pudding Ln","city":"London","cc":"GB"},"categories":[{"name":"Pub"}]},
  "photos":{"items":[{"prefix":"https://img/","suffix":"/p.jpg"}]}},
 {"createdAt":"2019-07-01T10:00:00Z","venue":{"id":"abc","name":"Joe's Pub","location":{"lat":51.5074,"lng":-0.1278}}},
 {"createdAt":"garbage","venue":{"id":"zzz","name":"Bad"}}
]}}`

func TestParseJSONAndLoadIdempotent(t *testing.T) {
	rows, errs, err := ParseJSON(strings.NewReader(fsqJSON))
	if err != nil || len(rows) != 2 || len(errs) != 1 {
		t.Fatalf("rows=%d errs=%v err=%v", len(rows), errs, err)
	}
	if rows[0].At != time.Unix(1560623400, 0).UTC() || rows[0].Note != "Great burger" || rows[0].Photos[0] != "https://img/original/p.jpg" {
		t.Fatalf("row0 = %+v", rows[0])
	}
	s, _ := store.Open(filepath.Join(t.TempDir(), "i.db"))
	defer s.Close()
	u, _ := s.CreateUserWithPasskey("a", []byte("h"), "", webauthnCred())
	res := Load(s, u.ID, rows, errs)
	if res.Imported != 2 || res.VenuesCreated != 1 || res.Skipped != 0 || len(res.Errors) != 1 {
		t.Fatalf("first load: %+v", res)
	}
	res = Load(s, u.ID, rows, nil)
	if res.Imported != 0 || res.Skipped != 2 || res.VenuesCreated != 0 {
		t.Fatalf("re-import must be idempotent: %+v", res)
	}
	vs, _, _ := s.SearchVenues(store.VenueFilter{})
	if len(vs) != 1 || vs[0].Status != store.StatusReconcile || vs[0].FoursquareID != "abc" || vs[0].Country != "GB" {
		t.Fatalf("venue: %+v", vs)
	}
}

func TestParseCSV(t *testing.T) {
	csv := string([]byte{0xEF, 0xBB, 0xBF}) + "Date,Venue Name,Latitude,Longitude,City,Shout,Venue ID\n" +
		"2018-03-04 12:30:00,Blue Bottle,37.8,-122.27,Oakland,\"good, strong\",v1\n" +
		"not a date,Bad,1,1,X,,v2\n"
	rows, errs, err := ParseCSV(strings.NewReader(csv))
	if err != nil || len(rows) != 1 || len(errs) != 1 {
		t.Fatalf("rows=%v errs=%v err=%v", rows, errs, err)
	}
	if rows[0].Note != "good, strong" || rows[0].Lat != 37.8 || rows[0].FoursquareID != "v1" || rows[0].At.Hour() != 12 {
		t.Fatalf("row: %+v", rows[0])
	}
	if _, _, err := ParseCSV(strings.NewReader("a,b\n1,2\n")); err == nil {
		t.Fatal("missing columns accepted")
	}
	if _, _, err := ParseJSON(strings.NewReader(`{"nope":1}`)); err == nil {
		t.Fatal("bad JSON shape accepted")
	}
}
