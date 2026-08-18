package db

import (
	"context"
	"path/filepath"
	"testing"
)

func openTestDB(t *testing.T) *DB {
	t.Helper()
	d, err := Open(filepath.Join(t.TempDir(), "test.db"), "mod_spatialite")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestUserCRUD(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	exists, err := d.AnyUserExists(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatal("expected no users yet")
	}

	u, err := d.CreateUser(ctx)
	if err != nil {
		t.Fatal(err)
	}

	got, err := d.GetUser(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != u.ID {
		t.Fatalf("got id %s, want %s", got.ID, u.ID)
	}

	exists, err = d.AnyUserExists(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("expected a user to exist")
	}

	if err := d.DeleteUser(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GetUser(ctx, u.ID); err != ErrNotFound {
		t.Fatalf("got err %v, want ErrNotFound", err)
	}
}

func TestCatalogTrailAndCoverage(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	u, err := d.CreateUser(ctx)
	if err != nil {
		t.Fatal(err)
	}

	// A straight ~2.78km east-west reference line along latitude 34.0.
	refWKT := "LINESTRING(-118.50 34.00, -118.20 34.00)"
	ct, err := d.CreateCatalogTrail(ctx, "Test Trail", "test-trail", refWKT, 32611)
	if err != nil {
		t.Fatal(err)
	}
	if ct.LengthM <= 0 {
		t.Fatalf("expected positive length, got %f", ct.LengthM)
	}

	ut, err := d.CreateUserTrail(ctx, u.ID, ct.ID)
	if err != nil {
		t.Fatal(err)
	}
	// idempotent re-enroll should return the same row
	ut2, err := d.CreateUserTrail(ctx, u.ID, ct.ID)
	if err != nil {
		t.Fatal(err)
	}
	if ut.ID != ut2.ID {
		t.Fatalf("expected re-enrolling to return the same user_trail, got %s vs %s", ut.ID, ut2.ID)
	}

	// Before any runs, coverage should be zero and the gap should be the whole trail.
	cov, err := d.ComputeCoverage(ctx, ut.ID, "", 20, 32611)
	if err != nil {
		t.Fatal(err)
	}
	if cov.MatchedLenM != 0 {
		t.Fatalf("expected 0 matched length with no runs, got %f", cov.MatchedLenM)
	}
	if cov.UncoveredGeoJSON == "" {
		t.Fatal("expected the full trail to be uncovered with no runs")
	}

	// A run that covers only the western half of the trail.
	runWKT := "LINESTRING(-118.50 34.0001, -118.35 34.0001)"
	run, err := d.CreateRun(ctx, ut.ID, "morning run", runWKT, 32611)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != RunPending {
		t.Fatalf("expected pending status, got %s", run.Status)
	}

	if err := d.ProcessRun(ctx, run.ID, ut.ID, 20, 32611); err != nil {
		t.Fatal(err)
	}

	processed, err := d.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if processed.Status != RunProcessed {
		t.Fatalf("expected processed status, got %s (error: %v)", processed.Status, processed.ErrorMessage)
	}
	if processed.CoveragePct == nil {
		t.Fatal("expected coverage_pct to be set")
	}
	if *processed.CoveragePct <= 30 || *processed.CoveragePct >= 70 {
		t.Fatalf("expected roughly half coverage, got %.1f%%", *processed.CoveragePct)
	}

	// Live dashboard coverage (processed runs only) should now show partial coverage.
	cov, err = d.ComputeCoverage(ctx, ut.ID, "", 20, 32611)
	if err != nil {
		t.Fatal(err)
	}
	if cov.MatchedLenM <= 0 {
		t.Fatal("expected nonzero matched length after processing a run")
	}
	if cov.CoveredGeoJSON == "" {
		t.Fatal("expected covered geojson to be populated")
	}
	if cov.UncoveredGeoJSON == "" {
		t.Fatal("expected the eastern half to still show as a gap")
	}
}
