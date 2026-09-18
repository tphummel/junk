// Package config loads service configuration from environment variables.
package config

import (
	"fmt"
	"os"
	"strconv"
)

// Config holds all application configuration, loaded from environment variables.
type Config struct {
	Port        int
	CacheDir    string
	SeedMaxLen  int
	LogLevel    string
	MetricsPath string
	HealthPath  string
	ImageWidth  int
	ImageHeight int
}

// Load reads configuration from environment variables with the defaults from
// the design doc.
func Load() (*Config, error) {
	cfg := &Config{
		Port:        getEnvInt("PORT", 8080),
		CacheDir:    getEnv("CACHE_DIR", "/data/cache"),
		SeedMaxLen:  getEnvInt("SEED_MAX_LEN", 256),
		LogLevel:    getEnv("LOG_LEVEL", "info"),
		MetricsPath: getEnv("METRICS_PATH", "/metrics"),
		HealthPath:  getEnv("HEALTH_PATH", "/healthz"),
		ImageWidth:  getEnvInt("IMAGE_WIDTH", 100),
		ImageHeight: getEnvInt("IMAGE_HEIGHT", 100),
	}

	if cfg.Port <= 0 || cfg.Port > 65535 {
		return nil, fmt.Errorf("invalid PORT: %d", cfg.Port)
	}
	if cfg.SeedMaxLen <= 0 {
		return nil, fmt.Errorf("invalid SEED_MAX_LEN: %d", cfg.SeedMaxLen)
	}
	if cfg.ImageWidth <= 0 || cfg.ImageHeight <= 0 {
		return nil, fmt.Errorf("invalid image dimensions: %dx%d", cfg.ImageWidth, cfg.ImageHeight)
	}

	return cfg, nil
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
