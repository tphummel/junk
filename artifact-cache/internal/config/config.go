package config

import (
	"os"
	"strconv"
)

// Config holds all application configuration
type Config struct {
	Port          int
	MetricsPort   int
	StoragePath   string
	DatabasePath  string
	UpstreamTimeout int
	LogLevel      string
	UserAgent     string
}

// Load reads configuration from environment variables with sensible defaults
func Load() *Config {
	return &Config{
		Port:            getEnvInt("PORT", 8080),
		MetricsPort:     getEnvInt("METRICS_PORT", 9090),
		StoragePath:     getEnv("STORAGE_PATH", "/data/cache"),
		DatabasePath:    getEnv("DATABASE_PATH", "/data/metadata.db"),
		UpstreamTimeout: getEnvInt("UPSTREAM_TIMEOUT", 600),
		LogLevel:        getEnv("LOG_LEVEL", "info"),
		UserAgent:       getEnv("USER_AGENT", "HomeLabArtifactCache/1.0"),
	}
}

// getEnv retrieves an environment variable or returns a default value
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getEnvInt retrieves an environment variable as an integer or returns a default value
func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intVal, err := strconv.Atoi(value); err == nil {
			return intVal
		}
	}
	return defaultValue
}
