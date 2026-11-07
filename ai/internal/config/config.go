// Package config loads VenueCheck settings from environment variables.
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Config holds all runtime settings.
type Config struct {
	Bind          string
	Port          string
	DataDir       string
	RPID          string
	RPOrigins     []string
	OSMAPIKey     string // never logged, never rendered
	OSMUserID     string
	OSMAPIBase    string
	OverpassURL   string
	OSMMinGap     time.Duration
	Hostname      string
	AllowRegister bool // open /register beyond the first account
}

// Load reads configuration from the environment.
func Load() (*Config, error) {
	host, _ := os.Hostname()
	c := &Config{
		Bind:          get("BIND", "0.0.0.0"),
		Port:          get("PORT", "8080"),
		DataDir:       get("DATA_DIR", "/data"),
		RPID:          get("RP_ID", "localhost"),
		OSMAPIKey:     os.Getenv("OSM_API_KEY"),
		OSMUserID:     os.Getenv("OSM_USER_ID"),
		OSMAPIBase:    strings.TrimRight(get("OSM_API_BASE", "https://api.openstreetmap.org/api/0.6"), "/"),
		OverpassURL:   get("OVERPASS_URL", "https://overpass-api.de/api/interpreter"),
		Hostname:      get("INSTANCE_HOSTNAME", host),
		AllowRegister: get("ALLOW_REGISTER", "false") == "true",
	}
	c.RPOrigins = splitList(get("RP_ORIGINS", "http://localhost:"+c.Port))
	gap, err := strconv.Atoi(get("OSM_MIN_GAP_SECONDS", "5"))
	if err != nil || gap < 0 {
		return nil, fmt.Errorf("OSM_MIN_GAP_SECONDS must be a non-negative integer")
	}
	c.OSMMinGap = time.Duration(gap) * time.Second
	return c, nil
}

// DBPath is the SQLite file location.
func (c *Config) DBPath() string { return filepath.Join(c.DataDir, "venue.db") }

// TilesDir is where pre-sliced raster tiles live.
func (c *Config) TilesDir() string { return filepath.Join(c.DataDir, "tiles") }

// Secure reports whether the first configured origin is https, which
// decides the cookie Secure flag.
func (c *Config) Secure() bool {
	return len(c.RPOrigins) > 0 && strings.HasPrefix(c.RPOrigins[0], "https://")
}

func get(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
