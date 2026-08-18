package config

import (
	"os"
	"strconv"
)

// Config holds all application configuration, loaded from environment variables.
type Config struct {
	Port              int
	MetricsPort       int
	DatabasePath      string
	SpatialiteLib     string
	TileCacheRoot     string
	TileUpstream      string
	LogLevel          string
	SessionTTLDays    int
	JWTPrivateKeyPEM  string
	JWTPrivateKeyFile string
	RPID              string
	RPDisplayName     string
	RPOrigins         []string
	MatchBufferMeters float64
	ProjectedSRID     int
}

// Load reads configuration from environment variables with sensible defaults.
func Load() *Config {
	return &Config{
		Port:              getEnvInt("PORT", 8080),
		MetricsPort:       getEnvInt("METRICS_PORT", 9090),
		DatabasePath:      getEnv("DATABASE_PATH", "/data/trail.db"),
		SpatialiteLib:     getEnv("SPATIALITE_LIB", "mod_spatialite"),
		TileCacheRoot:     getEnv("TILE_CACHE_ROOT", "/cache"),
		TileUpstream:      getEnv("TILE_UPSTREAM", "https://tile.openstreetmap.org"),
		LogLevel:          getEnv("LOG_LEVEL", "info"),
		SessionTTLDays:    getEnvInt("SESSION_TTL_DAYS", 182),
		JWTPrivateKeyPEM:  getEnv("JWT_RSA_PRIVATE_KEY", ""),
		JWTPrivateKeyFile: getEnv("JWT_RSA_PRIVATE_KEY_FILE", ""),
		RPID:              getEnv("RP_ID", "localhost"),
		RPDisplayName:     getEnv("RP_DISPLAY_NAME", "Trail Check"),
		RPOrigins:         splitCSV(getEnv("RP_ORIGINS", "http://localhost:8080")),
		MatchBufferMeters: getEnvFloat("MATCH_BUFFER_METERS", 20.0),
		ProjectedSRID:     getEnvInt("PROJECTED_SRID", 32611),
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

func getEnvFloat(key string, defaultValue float64) float64 {
	if value := os.Getenv(key); value != "" {
		if f, err := strconv.ParseFloat(value, 64); err == nil {
			return f
		}
	}
	return defaultValue
}

func splitCSV(value string) []string {
	var out []string
	start := 0
	for i := 0; i <= len(value); i++ {
		if i == len(value) || value[i] == ',' {
			if i > start {
				out = append(out, value[start:i])
			}
			start = i + 1
		}
	}
	return out
}
