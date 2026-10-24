// Package config loads daily-solitaire's runtime configuration from
// environment variables.
package config

import (
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Config holds all application configuration.
type Config struct {
	Port         int
	MetricsPort  int
	DatabasePath string
	LogLevel     string

	// RPID, RPDisplayName and RPOrigins configure the WebAuthn relying party.
	// Passkeys are bound to RPID: pick the final hostname before launch,
	// because changing it strands every credential.
	RPID          string
	RPDisplayName string
	RPOrigins     []string

	// SessionSecret keys CSRF tokens. If empty an ephemeral key is generated
	// at startup (open forms stop validating after a restart).
	SessionSecret string

	// Signups is "open" (default) or "closed"; when closed only the admin CLI
	// can create accounts.
	Signups string

	// BaseURL is the public origin, used by the admin CLI to print links.
	BaseURL string

	// TrustProxy makes the app read the client address from X-Forwarded-For
	// (set it when running behind Caddy / a tunnel).
	TrustProxy bool
}

// Load reads configuration from the environment with defaults suited to local
// development.
func Load() *Config {
	c := &Config{
		Port:          getInt("PORT", 8080),
		MetricsPort:   getInt("METRICS_PORT", 9090),
		DatabasePath:  get("DATABASE_PATH", "/data/app.db"),
		LogLevel:      get("LOG_LEVEL", "info"),
		RPID:          get("RP_ID", "localhost"),
		RPDisplayName: get("RP_DISPLAY_NAME", "Daily Solitaire"),
		RPOrigins:     getList("RP_ORIGINS", []string{"http://localhost:8080"}),
		SessionSecret: get("SESSION_SECRET", ""),
		Signups:       strings.ToLower(get("SIGNUPS", "open")),
		TrustProxy:    get("TRUST_PROXY", "") == "true",
	}
	c.BaseURL = strings.TrimRight(get("BASE_URL", c.RPOrigins[0]), "/")
	return c
}

// SignupsOpen reports whether public registration is enabled.
func (c *Config) SignupsOpen() bool { return c.Signups != "closed" }

// Secure reports whether the site is served over HTTPS (cookies get the
// Secure attribute and the __Host- prefix).
func (c *Config) Secure() bool {
	u, err := url.Parse(c.BaseURL)
	return err == nil && u.Scheme == "https"
}

func get(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func getList(key string, def []string) []string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	var out []string
	for _, p := range strings.Split(v, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return def
	}
	return out
}
