package db

import (
	"context"
	"database/sql"
	"errors"
)

// coverageQuery computes, for a user's tracked trail, how much of the
// reference line is covered by their uploaded runs (buffered by
// bufferMeters to absorb GPS drift) and what's left uncovered.
//
// The design doc's original SQL buffered *both* the reference and the run
// tracks and took their intersection, which yields a polygon -- ST_Length()
// of a polygon is 0, so matched_len would always come out zero. Instead we
// buffer only the run tracks (the GPS-drift tolerance belongs there) and
// intersect/difference that buffer against the reference *line*, which
// yields line geometries that ST_Length() and the Leaflet dashboard overlay
// both expect.
//
// includeRunID additionally folds in one run that isn't 'processed' yet
// (the run currently being validated by the worker); pass "" to only
// consider already-processed runs, as the live dashboard does.
const coverageQuery = `
WITH ut AS (
    SELECT catalog_trail_id FROM user_trail WHERE id = ?
),
ref AS (
    SELECT ct.geom AS geom, ct.length_m AS length_m
    FROM catalog_trail ct
    JOIN ut ON ct.id = ut.catalog_trail_id
),
ru AS (
    SELECT ST_Union(geom) AS geom
    FROM run
    WHERE user_trail_id = ?
      AND (status = 'processed' OR id = ?)
),
proj AS (
    SELECT
        ST_Transform((SELECT geom FROM ref), ?) AS ref_proj,
        ST_Buffer(ST_Transform((SELECT geom FROM ru), ?), ?) AS run_buf
)
SELECT
    (SELECT length_m FROM ref) AS ref_len,
    CASE WHEN (SELECT run_buf FROM proj) IS NULL THEN 0
         ELSE ST_Length(ST_Intersection((SELECT ref_proj FROM proj), (SELECT run_buf FROM proj)))
    END AS matched_len,
    CASE WHEN (SELECT run_buf FROM proj) IS NULL THEN NULL
         ELSE AsGeoJSON(ST_Transform(ST_Intersection((SELECT ref_proj FROM proj), (SELECT run_buf FROM proj)), 4326))
    END AS covered_geojson,
    CASE WHEN (SELECT run_buf FROM proj) IS NULL THEN AsGeoJSON(ST_Transform((SELECT ref_proj FROM proj), 4326))
         ELSE AsGeoJSON(ST_Transform(ST_Difference((SELECT ref_proj FROM proj), (SELECT run_buf FROM proj)), 4326))
    END AS gap_geojson,
    CASE WHEN (SELECT run_buf FROM proj) IS NULL THEN AsText(ST_Transform((SELECT ref_proj FROM proj), 4326))
         ELSE AsText(ST_Transform(ST_Difference((SELECT ref_proj FROM proj), (SELECT run_buf FROM proj)), 4326))
    END AS gap_wkt
`

// CoverageResult is how much of a reference trail a user's runs cover.
type CoverageResult struct {
	RefLengthM       float64
	MatchedLenM      float64
	CoveragePct      float64
	CoveredGeoJSON   string // "" if nothing is covered yet
	UncoveredGeoJSON string // "" if fully covered
	UncoveredWKT     string // "" if fully covered; used to persist gap_geom
}

// ComputeCoverage runs the coverage query for a user's tracked trail.
// includeRunID additionally folds in a not-yet-processed run (used by the
// worker while validating it); pass "" for the live dashboard view, which
// should only reflect already-processed runs.
func (d *DB) ComputeCoverage(ctx context.Context, userTrailID, includeRunID string, bufferMeters float64, projectedSRID int) (*CoverageResult, error) {
	var res CoverageResult
	var covered, gapGeoJSON, gapWKT sql.NullString
	err := d.conn.QueryRowContext(ctx, coverageQuery,
		userTrailID, userTrailID, includeRunID, projectedSRID, projectedSRID, bufferMeters,
	).Scan(&res.RefLengthM, &res.MatchedLenM, &covered, &gapGeoJSON, &gapWKT)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if res.RefLengthM > 0 {
		res.CoveragePct = (res.MatchedLenM / res.RefLengthM) * 100
	}
	res.CoveredGeoJSON = covered.String
	res.UncoveredGeoJSON = gapGeoJSON.String
	res.UncoveredWKT = gapWKT.String
	return &res, nil
}

// ProcessRun computes coverage for a pending run's parent trail (including
// that run itself) and persists the result, marking the run processed. If
// computation fails outright, the run is marked 'error' with the failure
// message instead.
func (d *DB) ProcessRun(ctx context.Context, runID, userTrailID string, bufferMeters float64, projectedSRID int) error {
	res, err := d.ComputeCoverage(ctx, userTrailID, runID, bufferMeters, projectedSRID)
	if err != nil {
		_ = d.MarkRunError(ctx, runID, err.Error())
		return err
	}
	return d.ApplyRunCoverage(ctx, runID, res.MatchedLenM, res.CoveragePct, res.UncoveredWKT)
}
