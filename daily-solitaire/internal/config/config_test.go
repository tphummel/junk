package config

import "testing"

func TestDefaults(t *testing.T) {
	for _, k := range []string{"PORT", "RP_ORIGINS", "SIGNUPS", "BASE_URL", "TRUST_PROXY"} {
		t.Setenv(k, "")
	}
	c := Load()
	if c.Port != 8080 || c.RPID != "localhost" || !c.SignupsOpen() || c.Secure() || c.BaseURL != "http://localhost:8080" {
		t.Fatalf("defaults: %+v", c)
	}
}

func TestOverrides(t *testing.T) {
	t.Setenv("PORT", "9000")
	t.Setenv("SIGNUPS", "CLOSED")
	t.Setenv("RP_ORIGINS", "https://solitaire.example.com, https://alt.example.com")
	t.Setenv("BASE_URL", "")
	c := Load()
	if c.Port != 9000 || c.SignupsOpen() || !c.Secure() || len(c.RPOrigins) != 2 || c.BaseURL != "https://solitaire.example.com" {
		t.Fatalf("overrides: %+v", c)
	}
}
