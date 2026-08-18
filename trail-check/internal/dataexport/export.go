// Package dataexport builds the GDPR-style "export everything" ZIP archive
// for a user's account.
package dataexport

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"time"

	"trail-check/internal/db"
)

func base64Std(b []byte) string {
	return base64.StdEncoding.EncodeToString(b)
}

type exportedPasskey struct {
	ID           string     `json:"id"`
	CredentialID string     `json:"credential_id_base64"`
	Label        string     `json:"label"`
	Status       string     `json:"status"`
	CreatedAt    time.Time  `json:"created_at"`
	LastUsedAt   *time.Time `json:"last_used_at,omitempty"`
}

type exportedSession struct {
	ID          string     `json:"id"`
	ExpiresAt   time.Time  `json:"expires_at"`
	RevokedAt   *time.Time `json:"revoked_at,omitempty"`
	LastSeenAt  time.Time  `json:"last_seen_at"`
	DeviceLabel string     `json:"device_label"`
	CreatedAt   time.Time  `json:"created_at"`
}

type exportedRun struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	UploadedAt   time.Time `json:"uploaded_at"`
	Status       string    `json:"status"`
	LengthM      float64   `json:"length_m"`
	MatchedLenM  *float64  `json:"matched_len_m,omitempty"`
	CoveragePct  *float64  `json:"coverage_pct,omitempty"`
	ErrorMessage *string   `json:"error_message,omitempty"`
}

type exportedTrail struct {
	CatalogTrailName string        `json:"catalog_trail_name"`
	CatalogTrailSlug string        `json:"catalog_trail_slug"`
	TrackedSince     time.Time     `json:"tracked_since"`
	Runs             []exportedRun `json:"runs"`
}

// Build collects everything the design doc's GET /me/export endpoint
// promises and returns it as a ZIP archive: account metadata, passkeys,
// sessions, and every tracked trail with its uploaded runs.
func Build(ctx context.Context, database *db.DB, userID string) ([]byte, error) {
	user, err := database.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	passkeys, err := database.ListPasskeysByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	exportedPasskeys := make([]exportedPasskey, 0, len(passkeys))
	for _, pk := range passkeys {
		exportedPasskeys = append(exportedPasskeys, exportedPasskey{
			ID:           pk.ID,
			CredentialID: base64Std(pk.CredentialID),
			Label:        pk.Label,
			Status:       string(pk.Status),
			CreatedAt:    pk.CreatedAt,
			LastUsedAt:   pk.LastUsedAt,
		})
	}

	sessions, err := database.ListSessionsByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	exportedSessions := make([]exportedSession, 0, len(sessions))
	for _, s := range sessions {
		exportedSessions = append(exportedSessions, exportedSession{
			ID:          s.ID,
			ExpiresAt:   s.ExpiresAt,
			RevokedAt:   s.RevokedAt,
			LastSeenAt:  s.LastSeenAt,
			DeviceLabel: s.DeviceLabel,
			CreatedAt:   s.CreatedAt,
		})
	}

	userTrails, err := database.ListUserTrailsByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	exportedTrails := make([]exportedTrail, 0, len(userTrails))
	for _, ut := range userTrails {
		runs, err := database.ListRunsByUserTrail(ctx, ut.UserTrail.ID)
		if err != nil {
			return nil, err
		}
		exportedRuns := make([]exportedRun, 0, len(runs))
		for _, r := range runs {
			exportedRuns = append(exportedRuns, exportedRun{
				ID:           r.ID,
				Name:         r.Name,
				UploadedAt:   r.UploadedAt,
				Status:       string(r.Status),
				LengthM:      r.LengthM,
				MatchedLenM:  r.MatchedLen,
				CoveragePct:  r.CoveragePct,
				ErrorMessage: r.ErrorMessage,
			})
		}
		exportedTrails = append(exportedTrails, exportedTrail{
			CatalogTrailName: ut.CatalogTrail.Name,
			CatalogTrailSlug: ut.CatalogTrail.Slug,
			TrackedSince:     ut.UserTrail.CreatedAt,
			Runs:             exportedRuns,
		})
	}

	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)

	if err := writeJSONFile(zw, "account.json", map[string]any{
		"id":         user.ID,
		"created_at": user.CreatedAt,
	}); err != nil {
		return nil, err
	}
	if err := writeJSONFile(zw, "passkeys.json", exportedPasskeys); err != nil {
		return nil, err
	}
	if err := writeJSONFile(zw, "sessions.json", exportedSessions); err != nil {
		return nil, err
	}
	if err := writeJSONFile(zw, "trails.json", exportedTrails); err != nil {
		return nil, err
	}

	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func writeJSONFile(zw *zip.Writer, name string, v any) error {
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}
