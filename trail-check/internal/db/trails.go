package db

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

// CatalogTrail is a reference trail geometry that runs are validated against.
type CatalogTrail struct {
	ID        string
	Name      string
	Slug      string
	LengthM   float64
	CreatedAt time.Time
}

// CreateCatalogTrail inserts a reference trail from a WKT MULTILINESTRING and
// computes its length (meters) by projecting into projectedSRID.
func (d *DB) CreateCatalogTrail(ctx context.Context, name, slug, wkt string, projectedSRID int) (*CatalogTrail, error) {
	ct := &CatalogTrail{ID: uuid.NewString(), Name: name, Slug: slug, CreatedAt: time.Now().UTC()}
	_, err := d.conn.ExecContext(ctx,
		`INSERT INTO catalog_trail (id, name, slug, length_m, created_at) VALUES (?, ?, ?, 0, ?)`,
		ct.ID, ct.Name, ct.Slug, formatTime(ct.CreatedAt),
	)
	if err != nil {
		return nil, err
	}
	err = d.conn.QueryRowContext(ctx, `
		UPDATE catalog_trail
		SET geom = ST_Multi(GeomFromText(?, 4326)),
		    length_m = ST_Length(ST_Transform(ST_Multi(GeomFromText(?, 4326)), ?))
		WHERE id = ?
		RETURNING length_m`,
		wkt, wkt, projectedSRID, ct.ID,
	).Scan(&ct.LengthM)
	if err != nil {
		return nil, err
	}
	return ct, nil
}

// GetCatalogTrailBySlug looks up a reference trail by its slug.
func (d *DB) GetCatalogTrailBySlug(ctx context.Context, slug string) (*CatalogTrail, error) {
	return d.scanCatalogTrail(ctx, `SELECT id, name, slug, length_m, created_at FROM catalog_trail WHERE slug = ?`, slug)
}

// GetCatalogTrail looks up a reference trail by ID.
func (d *DB) GetCatalogTrail(ctx context.Context, id string) (*CatalogTrail, error) {
	return d.scanCatalogTrail(ctx, `SELECT id, name, slug, length_m, created_at FROM catalog_trail WHERE id = ?`, id)
}

func (d *DB) scanCatalogTrail(ctx context.Context, query string, arg any) (*CatalogTrail, error) {
	var ct CatalogTrail
	var createdAt string
	err := d.conn.QueryRowContext(ctx, query, arg).Scan(&ct.ID, &ct.Name, &ct.Slug, &ct.LengthM, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	ct.CreatedAt, err = parseTime(createdAt)
	if err != nil {
		return nil, err
	}
	return &ct, nil
}

// ListCatalogTrails returns every reference trail, alphabetically by name.
func (d *DB) ListCatalogTrails(ctx context.Context) ([]*CatalogTrail, error) {
	rows, err := d.conn.QueryContext(ctx, `SELECT id, name, slug, length_m, created_at FROM catalog_trail ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*CatalogTrail
	for rows.Next() {
		var ct CatalogTrail
		var createdAt string
		if err := rows.Scan(&ct.ID, &ct.Name, &ct.Slug, &ct.LengthM, &createdAt); err != nil {
			return nil, err
		}
		if ct.CreatedAt, err = parseTime(createdAt); err != nil {
			return nil, err
		}
		out = append(out, &ct)
	}
	return out, rows.Err()
}

// GetCatalogTrailGeoJSON returns the reference geometry as a GeoJSON string.
func (d *DB) GetCatalogTrailGeoJSON(ctx context.Context, id string) (string, error) {
	var geojson sql.NullString
	err := d.conn.QueryRowContext(ctx, `SELECT AsGeoJSON(geom) FROM catalog_trail WHERE id = ?`, id).Scan(&geojson)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return geojson.String, nil
}

// UserTrail links a user to a catalog trail they are tracking progress on.
type UserTrail struct {
	ID             string
	UserID         string
	CatalogTrailID string
	CreatedAt      time.Time
}

// CreateUserTrail enrolls a user in tracking a catalog trail, or returns the
// existing enrollment if one already exists.
func (d *DB) CreateUserTrail(ctx context.Context, userID, catalogTrailID string) (*UserTrail, error) {
	ut := &UserTrail{ID: uuid.NewString(), UserID: userID, CatalogTrailID: catalogTrailID, CreatedAt: time.Now().UTC()}
	_, err := d.conn.ExecContext(ctx, `
		INSERT INTO user_trail (id, user_id, catalog_trail_id, created_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT (user_id, catalog_trail_id) DO NOTHING`,
		ut.ID, ut.UserID, ut.CatalogTrailID, formatTime(ut.CreatedAt),
	)
	if err != nil {
		return nil, err
	}
	return d.GetUserTrailByUserAndCatalog(ctx, userID, catalogTrailID)
}

// GetUserTrailByUserAndCatalog fetches an existing enrollment.
func (d *DB) GetUserTrailByUserAndCatalog(ctx context.Context, userID, catalogTrailID string) (*UserTrail, error) {
	var ut UserTrail
	var createdAt string
	err := d.conn.QueryRowContext(ctx,
		`SELECT id, user_id, catalog_trail_id, created_at FROM user_trail WHERE user_id = ? AND catalog_trail_id = ?`,
		userID, catalogTrailID,
	).Scan(&ut.ID, &ut.UserID, &ut.CatalogTrailID, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	ut.CreatedAt, err = parseTime(createdAt)
	return &ut, err
}

// GetUserTrail fetches an enrollment by ID, scoped to the owning user.
func (d *DB) GetUserTrail(ctx context.Context, id, userID string) (*UserTrail, error) {
	var ut UserTrail
	var createdAt string
	err := d.conn.QueryRowContext(ctx,
		`SELECT id, user_id, catalog_trail_id, created_at FROM user_trail WHERE id = ? AND user_id = ?`,
		id, userID,
	).Scan(&ut.ID, &ut.UserID, &ut.CatalogTrailID, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	ut.CreatedAt, err = parseTime(createdAt)
	return &ut, err
}

// UserTrailWithCatalog joins a user's enrollment with the catalog trail it points to.
type UserTrailWithCatalog struct {
	UserTrail
	CatalogTrail CatalogTrail
}

// ListUserTrailsByUser returns every trail a user is tracking, with the
// catalog trail details joined in for display.
func (d *DB) ListUserTrailsByUser(ctx context.Context, userID string) ([]*UserTrailWithCatalog, error) {
	rows, err := d.conn.QueryContext(ctx, `
		SELECT ut.id, ut.user_id, ut.catalog_trail_id, ut.created_at,
		       ct.id, ct.name, ct.slug, ct.length_m, ct.created_at
		FROM user_trail ut
		JOIN catalog_trail ct ON ct.id = ut.catalog_trail_id
		WHERE ut.user_id = ?
		ORDER BY ct.name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*UserTrailWithCatalog
	for rows.Next() {
		var row UserTrailWithCatalog
		var utCreatedAt, ctCreatedAt string
		if err := rows.Scan(
			&row.UserTrail.ID, &row.UserTrail.UserID, &row.UserTrail.CatalogTrailID, &utCreatedAt,
			&row.CatalogTrail.ID, &row.CatalogTrail.Name, &row.CatalogTrail.Slug, &row.CatalogTrail.LengthM, &ctCreatedAt,
		); err != nil {
			return nil, err
		}
		if row.UserTrail.CreatedAt, err = parseTime(utCreatedAt); err != nil {
			return nil, err
		}
		if row.CatalogTrail.CreatedAt, err = parseTime(ctCreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &row)
	}
	return out, rows.Err()
}
