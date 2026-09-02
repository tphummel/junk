// Package config loads app-passkey's runtime configuration from environment
// variables.
package config

import (
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

	// RPID, RPDisplayName and RPOrigins configure the WebAuthn relying
	// party. RPOrigins is the set of origins browsers are allowed to
	// complete ceremonies from (e.g. "https://passkey.example.com").
	RPID          string
	RPDisplayName string
	RPOrigins     []string

	// SessionSecret signs the session cookie. If empty, an ephemeral key is
	// generated at startup (existing sessions won't survive a restart).
	SessionSecret string
}

// Load reads configuration from environment variables with sensible
// defaults for local development.
func Load() *Config {
	return &Config{
		Port:          getEnvInt("PORT", 8080),
		MetricsPort:   getEnvInt("METRICS_PORT", 9090),
		DatabasePath:  getEnv("DATABASE_PATH", "/data/app-passkey.db"),
		LogLevel:      getEnv("LOG_LEVEL", "info"),
		RPID:          getEnv("RP_ID", "localhost"),
		RPDisplayName: getEnv("RP_DISPLAY_NAME", "app-passkey"),
		RPOrigins:     getEnvList("RP_ORIGINS", []string{"http://localhost:8080"}),
		SessionSecret: getEnv("SESSION_SECRET", ""),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intVal, err := strconv.Atoi(value); err == nil {
			return intVal
		}
	}
	return defaultValue
}

// getEnvList splits a comma-separated environment variable into a slice,
// trimming whitespace around each entry.
func getEnvList(key string, defaultValue []string) []string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return defaultValue
	}
	return out
}
