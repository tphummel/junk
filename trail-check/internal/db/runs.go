package db

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

// RunStatus is the processing lifecycle of an uploaded run.
type RunStatus string

const (
	RunPending   RunStatus = "pending"
	RunProcessed RunStatus = "processed"
	RunError     RunStatus = "error"
)

// Run is one uploaded GPX track validated (or pending validation) against a
// user's tracked trail.
type Run struct {
	ID           string
	UserTrailID  string
	Name         string
	UploadedAt   time.Time
	Status       RunStatus
	LengthM      float64
	MatchedLen   *float64
	CoveragePct  *float64
	ErrorMessage *string
}

// CreateRun stores a newly uploaded run in "pending" status, ready for the
// background worker to validate.
func (d *DB) CreateRun(ctx context.Context, userTrailID, name, wkt string, projectedSRID int) (*Run, error) {
	r := &Run{ID: uuid.NewString(), UserTrailID: userTrailID, Name: name, UploadedAt: time.Now().UTC(), Status: RunPending}
	_, err := d.conn.ExecContext(ctx,
		`INSERT INTO run (id, user_trail_id, name, uploaded_at, status, length_m) VALUES (?, ?, ?, ?, 'pending', 0)`,
		r.ID, r.UserTrailID, r.Name, formatTime(r.UploadedAt),
	)
	if err != nil {
		return nil, err
	}
	err = d.conn.QueryRowContext(ctx, `
		UPDATE run
		SET geom = ST_Multi(GeomFromText(?, 4326)),
		    length_m = ST_Length(ST_Transform(ST_Multi(GeomFromText(?, 4326)), ?))
		WHERE id = ?
		RETURNING length_m`,
		wkt, wkt, projectedSRID, r.ID,
	).Scan(&r.LengthM)
	if err != nil {
		return nil, err
	}
	return r, nil
}

func scanRun(row interface {
	Scan(dest ...any) error
}) (*Run, error) {
	var r Run
	var status, uploadedAt string
	var matchedLen, coveragePct sql.NullFloat64
	var errMsg sql.NullString
	err := row.Scan(&r.ID, &r.UserTrailID, &r.Name, &uploadedAt, &status, &r.LengthM, &matchedLen, &coveragePct, &errMsg)
	if err != nil {
		return nil, err
	}
	r.Status = RunStatus(status)
	if r.UploadedAt, err = parseTime(uploadedAt); err != nil {
		return nil, err
	}
	if matchedLen.Valid {
		r.MatchedLen = &matchedLen.Float64
	}
	if coveragePct.Valid {
		r.CoveragePct = &coveragePct.Float64
	}
	if errMsg.Valid {
		r.ErrorMessage = &errMsg.String
	}
	return &r, nil
}

const runColumns = `id, user_trail_id, name, uploaded_at, status, length_m, matched_len, coverage_pct, error_message`

// GetRun fetches a run by ID.
func (d *DB) GetRun(ctx context.Context, id string) (*Run, error) {
	row := d.conn.QueryRowContext(ctx, `SELECT `+runColumns+` FROM run WHERE id = ?`, id)
	r, err := scanRun(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return r, err
}

// ListRunsByUserTrail returns every run uploaded against a user's tracked
// trail, most recent first.
func (d *DB) ListRunsByUserTrail(ctx context.Context, userTrailID string) ([]*Run, error) {
	rows, err := d.conn.QueryContext(ctx, `SELECT `+runColumns+` FROM run WHERE user_trail_id = ? ORDER BY uploaded_at DESC`, userTrailID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*Run
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// MarkRunError records that validation failed for a run.
func (d *DB) MarkRunError(ctx context.Context, id, message string) error {
	_, err := d.conn.ExecContext(ctx, `UPDATE run SET status = 'error', error_message = ? WHERE id = ?`, message, id)
	return err
}

// ApplyRunCoverage persists a computed coverage result on the run row and
// marks it processed. gapWKT may be empty when the run leaves no gap.
func (d *DB) ApplyRunCoverage(ctx context.Context, id string, matchedLen, coveragePct float64, gapWKT string) error {
	if gapWKT == "" {
		_, err := d.conn.ExecContext(ctx,
			`UPDATE run SET status = 'processed', matched_len = ?, coverage_pct = ?, gap_geom = NULL WHERE id = ?`,
			matchedLen, coveragePct, id,
		)
		return err
	}
	_, err := d.conn.ExecContext(ctx,
		`UPDATE run SET status = 'processed', matched_len = ?, coverage_pct = ?, gap_geom = ST_Multi(GeomFromText(?, 4326)) WHERE id = ?`,
		matchedLen, coveragePct, gapWKT, id,
	)
	return err
}
