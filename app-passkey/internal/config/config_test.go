package config

import (
	"reflect"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	cfg := Load()
	if cfg.Port != 8080 {
		t.Errorf("expected default port 8080, got %d", cfg.Port)
	}
	if cfg.DatabasePath != "/data/app-passkey.db" {
		t.Errorf("expected default database path, got %q", cfg.DatabasePath)
	}
	if cfg.RPID != "localhost" {
		t.Errorf("expected default RPID localhost, got %q", cfg.RPID)
	}
}

func TestLoadOverrides(t *testing.T) {
	t.Setenv("PORT", "9999")
	t.Setenv("RP_ID", "example.com")
	t.Setenv("RP_ORIGINS", "https://example.com, https://www.example.com")

	cfg := Load()
	if cfg.Port != 9999 {
		t.Errorf("expected overridden port 9999, got %d", cfg.Port)
	}
	if cfg.RPID != "example.com" {
		t.Errorf("expected overridden RPID, got %q", cfg.RPID)
	}
	want := []string{"https://example.com", "https://www.example.com"}
	if !reflect.DeepEqual(cfg.RPOrigins, want) {
		t.Errorf("expected origins %v, got %v", want, cfg.RPOrigins)
	}
}
