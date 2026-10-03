package main

import (
	"database/sql"
	"path/filepath"
	"testing"
	"time"
)

func ip(i int) *int { return &i }

func TestWriteAndRollup(t *testing.T) {
	st, err := openStore(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	if err := st.Write([]sighting{
		{TS: 10, Addr: "A", AddrType: "public", Name: "foo", Alias: "bar", RSSI: ip(-70), SvcUUIDs: "u1"},
		{TS: 12, Addr: "A", RSSI: ip(-50)},
		{TS: 11, Addr: "B"},
	}); err != nil {
		t.Fatal(err)
	}
	// Second batch: empty name must not clobber; late timestamp must not move last_seen back.
	if err := st.Write([]sighting{
		{TS: 5, Addr: "A", RSSI: ip(-90)},
		{TS: 11, Addr: "B", RSSI: ip(-40)},
	}); err != nil {
		t.Fatal(err)
	}

	var name, alias, typ, uuids string
	var first, last float64
	var count int
	var lastR, minR, maxR int
	err = st.db.QueryRow(`SELECT name, alias, addr_type, svc_uuids, first_seen, last_seen, seen_count, last_rssi, min_rssi, max_rssi FROM devices WHERE addr='A'`).
		Scan(&name, &alias, &typ, &uuids, &first, &last, &count, &lastR, &minR, &maxR)
	if err != nil {
		t.Fatal(err)
	}
	if name != "foo" || alias != "bar" || typ != "public" || uuids != "u1" || first != 5 || last != 12 || count != 3 || lastR != -90 || minR != -90 || maxR != -50 {
		t.Errorf("A: %s %s %s %v %v %d %d %d %d", name, typ, uuids, first, last, count, lastR, minR, maxR)
	}

	// B: first batch had NULL rssi, second set it.
	if err := st.db.QueryRow(`SELECT min_rssi, max_rssi FROM devices WHERE addr='B'`).Scan(&minR, &maxR); err != nil || minR != -40 || maxR != -40 {
		t.Errorf("B: %v %d %d", err, minR, maxR)
	}

	var n int
	st.db.QueryRow(`SELECT COUNT(*) FROM events`).Scan(&n)
	if n != 5 {
		t.Errorf("events = %d", n)
	}
}

func TestPurge(t *testing.T) {
	st, err := openStore(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	now := time.Unix(1_000_000_000, 0)
	old := float64(now.Unix()) - 15*86400
	recent := float64(now.Unix()) - 1*86400
	if err := st.Write([]sighting{{TS: old, Addr: "A"}, {TS: recent, Addr: "A"}}); err != nil {
		t.Fatal(err)
	}
	n, err := st.Purge(now, 14, true)
	if err != nil || n != 1 {
		t.Fatalf("purged %d err %v", n, err)
	}
	var c int
	st.db.QueryRow(`SELECT seen_count FROM devices WHERE addr='A'`).Scan(&c)
	if c != 2 {
		t.Errorf("devices rollup should survive purge, seen_count=%d", c)
	}
}

func TestMigrateOldSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	old, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, addr TEXT NOT NULL,
		  addr_type TEXT, name TEXT, rssi INTEGER, svc_uuids TEXT, mfr_data TEXT, svc_data TEXT, txp INTEGER, connectable INTEGER)`,
		`CREATE TABLE devices (addr TEXT PRIMARY KEY, addr_type TEXT, name TEXT, svc_uuids TEXT, first_seen REAL,
		  last_seen REAL, seen_count INTEGER NOT NULL DEFAULT 0, last_rssi INTEGER, min_rssi INTEGER, max_rssi INTEGER)`,
		`INSERT INTO events (ts, addr, connectable) VALUES (1, 'A', 1)`,
	} {
		if _, err := old.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	old.Close()

	st, err := openStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	err = st.Write([]sighting{{
		TS: 2, Sensor: "S", Addr: "A", Alias: "al", ADFlags: ip(6), MfrID: ip(76), Appearance: ip(64),
		Modalias: "m", Changed: "RSSI", RawAD: "0x01=06",
	}})
	if err != nil {
		t.Fatal(err)
	}
	var f, mfr, app int
	var sensor, changed, raw string
	err = st.db.QueryRow("SELECT ad_flags, mfr_id, appearance, sensor, changed, raw_ad FROM events WHERE ts=2").
		Scan(&f, &mfr, &app, &sensor, &changed, &raw)
	if err != nil || f != 6 || mfr != 76 || app != 64 || sensor != "S" || changed != "RSSI" || raw != "0x01=06" {
		t.Fatalf("events row: %v %d %d %d %s %s %s", err, f, mfr, app, sensor, changed, raw)
	}
	var m string
	if err := st.db.QueryRow("SELECT mfr_id, appearance, modalias FROM devices WHERE addr='A'").Scan(&mfr, &app, &m); err != nil || mfr != 76 || app != 64 || m != "m" {
		t.Fatalf("devices row: %v %d %d %s", err, mfr, app, m)
	}
	if _, err := st.db.Exec("SELECT connectable FROM events"); err == nil {
		t.Error("connectable column should be dropped")
	}
}
