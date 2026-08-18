package handlers

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/rs/zerolog"

	"trail-check/internal/auth"
	"trail-check/internal/db"
	"trail-check/internal/metrics"
	"trail-check/internal/tiles"
	"trail-check/internal/worker"
)

const refGPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="test"><trk><name>ref</name><trkseg>
<trkpt lat="34.00" lon="-118.50"></trkpt>
<trkpt lat="34.00" lon="-118.40"></trkpt>
<trkpt lat="34.00" lon="-118.30"></trkpt>
<trkpt lat="34.00" lon="-118.20"></trkpt>
</trkseg></trk></gpx>`

const runGPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="test"><trk><name>run</name><trkseg>
<trkpt lat="34.0001" lon="-118.500"></trkpt>
<trkpt lat="34.0001" lon="-118.400"></trkpt>
<trkpt lat="34.0001" lon="-118.350"></trkpt>
</trkseg></trk></gpx>`

type testEnv struct {
	router *gin.Engine
	db     *db.DB
	auth   *auth.Service
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	gin.SetMode(gin.TestMode)

	database, err := db.Open(filepath.Join(t.TempDir(), "test.db"), "mod_spatialite")
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	authSvc, err := auth.New(database, auth.Config{
		RPID:          "localhost",
		RPDisplayName: "Trail Check Test",
		RPOrigins:     []string{"http://localhost"},
		SessionTTL:    time.Hour,
	}, zerolog.Nop())
	if err != nil {
		t.Fatalf("auth.New: %v", err)
	}

	m := metrics.NewWithRegistry(prometheus.NewRegistry())
	w := worker.New(database, m, zerolog.Nop(), 20, 32611)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() {
		w.Close()
		cancel()
	})
	go w.Run(ctx)

	tileUpstream := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		rw.Write([]byte("fake-tile"))
	}))
	t.Cleanup(tileUpstream.Close)
	tileCache := tiles.New(t.TempDir(), tileUpstream.URL, "test/1.0", m, zerolog.Nop())

	h := New(database, authSvc, w, tileCache, m, zerolog.Nop(), Config{
		SessionTTL:        time.Hour,
		MatchBufferMeters: 20,
		ProjectedSRID:     32611,
	})

	router := gin.New()
	router.Use(gin.Recovery())
	h.RegisterRoutes(router)

	return &testEnv{router: router, db: database, auth: authSvc}
}

func TestHealthz(t *testing.T) {
	e := newTestEnv(t)
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestProtectedRoutesRejectUnauthenticated(t *testing.T) {
	e := newTestEnv(t)
	for _, path := range []string{"/dashboard", "/catalog", "/me/passkeys", "/me/export"} {
		rec := httptest.NewRecorder()
		e.router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s: expected 401, got %d", path, rec.Code)
		}
	}
}

func TestRegisterBeginReturnsCreationOptions(t *testing.T) {
	e := newTestEnv(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/auth/register/begin", strings.NewReader(`{"label":"my device"}`))
	req.Header.Set("Content-Type", "application/json")
	e.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	pk, ok := out["publicKey"].(map[string]any)
	if !ok {
		t.Fatalf("expected a publicKey field, got %v", out)
	}
	if pk["challenge"] == "" || pk["challenge"] == nil {
		t.Fatal("expected a non-empty challenge")
	}
	if rec.Result().Cookies() == nil {
		t.Fatal("expected a challenge cookie to be set")
	}
}

func multipartBody(t *testing.T, fields map[string]string, fileField, fileName, fileContent string) (*bytes.Buffer, string) {
	t.Helper()
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	for k, v := range fields {
		if err := w.WriteField(k, v); err != nil {
			t.Fatal(err)
		}
	}
	fw, err := w.CreateFormFile(fileField, fileName)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write([]byte(fileContent)); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf, w.FormDataContentType()
}

func TestFullTrailTrackingFlow(t *testing.T) {
	e := newTestEnv(t)
	ctx := context.Background()

	u, err := e.db.CreateUser(ctx)
	if err != nil {
		t.Fatal(err)
	}
	login, err := e.auth.IssueSession(ctx, u.ID, "test-agent")
	if err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{Name: auth.SessionCookieName, Value: login.JWT}

	do := func(method, path string, body *bytes.Buffer, contentType string) *httptest.ResponseRecorder {
		var r *http.Request
		if body != nil {
			r = httptest.NewRequest(method, path, body)
		} else {
			r = httptest.NewRequest(method, path, nil)
		}
		if contentType != "" {
			r.Header.Set("Content-Type", contentType)
		}
		r.AddCookie(cookie)
		rec := httptest.NewRecorder()
		e.router.ServeHTTP(rec, r)
		return rec
	}

	// 1. Create a catalog (reference) trail.
	body, ct := multipartBody(t, map[string]string{"name": "Test Trail", "slug": "test-trail"}, "file", "ref.gpx", refGPX)
	rec := do(http.MethodPost, "/catalog", body, ct)
	if rec.Code != http.StatusFound {
		t.Fatalf("expected redirect after catalog create, got %d: %s", rec.Code, rec.Body.String())
	}

	// 2. List catalog and confirm the trail is there.
	rec = do(http.MethodGet, "/catalog", nil, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Test Trail") {
		t.Fatalf("expected catalog listing to include Test Trail, got %d: %s", rec.Code, rec.Body.String())
	}

	// 3. Track the trail.
	rec = do(http.MethodPost, "/catalog/test-trail/track", nil, "")
	if rec.Code != http.StatusFound {
		t.Fatalf("expected redirect after tracking, got %d: %s", rec.Code, rec.Body.String())
	}
	location := rec.Header().Get("Location")
	if !strings.Contains(location, "user_trail_id=") {
		t.Fatalf("expected redirect location to carry user_trail_id, got %q", location)
	}
	userTrailID := strings.TrimPrefix(location, "/dashboard?user_trail_id=")

	// 4. Upload a run against it.
	body, ct = multipartBody(t, map[string]string{"user_trail_id": userTrailID, "name": "morning run"}, "file", "run.gpx", runGPX)
	rec = do(http.MethodPost, "/runs", body, ct)
	if rec.Code != http.StatusFound {
		t.Fatalf("expected redirect after run upload, got %d: %s", rec.Code, rec.Body.String())
	}

	runs, err := e.db.ListRunsByUserTrail(ctx, userTrailID)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 {
		t.Fatalf("expected 1 run, got %d", len(runs))
	}
	runID := runs[0].ID

	// 5. Poll run status until the background worker finishes processing.
	var finalStatus string
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		rec = do(http.MethodGet, "/runs/"+runID+"/status", nil, "")
		if rec.Code != http.StatusOK {
			t.Fatalf("status check failed: %d %s", rec.Code, rec.Body.String())
		}
		var status struct {
			Status      string   `json:"status"`
			CoveragePct *float64 `json:"coverage_pct"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
			t.Fatal(err)
		}
		finalStatus = status.Status
		if status.Status != "pending" {
			if status.Status != "processed" {
				t.Fatalf("expected run to process successfully, got status %q", status.Status)
			}
			if status.CoveragePct == nil {
				t.Fatal("expected coverage_pct to be set on a processed run")
			}
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if finalStatus != "processed" {
		t.Fatalf("run did not finish processing in time, last status: %q", finalStatus)
	}

	// 6. Dashboard should render with the tracked trail selected.
	rec = do(http.MethodGet, "/dashboard?user_trail_id="+userTrailID, nil, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Test Trail") {
		t.Fatalf("expected dashboard to render Test Trail, got %d: %s", rec.Code, rec.Body.String())
	}

	// 7. Dashboard geo endpoint should return non-empty coverage GeoJSON.
	rec = do(http.MethodGet, "/dashboard/geo?user_trail_id="+userTrailID, nil, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 from dashboard geo, got %d: %s", rec.Code, rec.Body.String())
	}
	var geo struct {
		Covered   string `json:"covered_geojson"`
		Uncovered string `json:"uncovered_geojson"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &geo); err != nil {
		t.Fatal(err)
	}
	if geo.Covered == "" {
		t.Fatal("expected non-empty covered_geojson after a processed run")
	}
	if geo.Uncovered == "" {
		t.Fatal("expected non-empty uncovered_geojson since the run doesn't cover the whole trail")
	}

	// 8. Export should produce a valid, non-empty ZIP.
	rec = do(http.MethodGet, "/me/export", nil, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 from export, got %d", rec.Code)
	}
	zr, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	if err != nil {
		t.Fatalf("export did not produce a valid zip: %v", err)
	}
	if len(zr.File) == 0 {
		t.Fatal("expected export zip to contain files")
	}

	// 9. Delete the account, then confirm the session no longer works.
	rec = do(http.MethodDelete, "/me", nil, "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204 from account delete, got %d: %s", rec.Code, rec.Body.String())
	}
	rec = do(http.MethodGet, "/dashboard", nil, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 after account deletion, got %d", rec.Code)
	}
}
