package config

import (
	"os"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	// Clear any existing env vars that might interfere
	os.Clearenv()

	cfg := Load()

	if cfg.Port != 8080 {
		t.Errorf("expected Port to be 8080, got %d", cfg.Port)
	}

	if cfg.MetricsPort != 9090 {
		t.Errorf("expected MetricsPort to be 9090, got %d", cfg.MetricsPort)
	}

	if cfg.StoragePath != "/data/cache" {
		t.Errorf("expected StoragePath to be '/data/cache', got %s", cfg.StoragePath)
	}

	if cfg.DatabasePath != "/data/metadata.db" {
		t.Errorf("expected DatabasePath to be '/data/metadata.db', got %s", cfg.DatabasePath)
	}

	if cfg.UpstreamTimeout != 600 {
		t.Errorf("expected UpstreamTimeout to be 600, got %d", cfg.UpstreamTimeout)
	}

	if cfg.LogLevel != "info" {
		t.Errorf("expected LogLevel to be 'info', got %s", cfg.LogLevel)
	}

	if cfg.UserAgent != "HomeLabArtifactCache/1.0" {
		t.Errorf("expected UserAgent to be 'HomeLabArtifactCache/1.0', got %s", cfg.UserAgent)
	}
}

func TestLoadFromEnv(t *testing.T) {
	// Set environment variables
	os.Setenv("PORT", "3000")
	os.Setenv("METRICS_PORT", "9091")
	os.Setenv("STORAGE_PATH", "/tmp/test-cache")
	os.Setenv("DATABASE_PATH", "/tmp/test.db")
	os.Setenv("UPSTREAM_TIMEOUT", "300")
	os.Setenv("LOG_LEVEL", "debug")
	os.Setenv("USER_AGENT", "TestAgent/1.0")

	defer os.Clearenv() // Clean up after test

	cfg := Load()

	if cfg.Port != 3000 {
		t.Errorf("expected Port to be 3000, got %d", cfg.Port)
	}

	if cfg.MetricsPort != 9091 {
		t.Errorf("expected MetricsPort to be 9091, got %d", cfg.MetricsPort)
	}

	if cfg.StoragePath != "/tmp/test-cache" {
		t.Errorf("expected StoragePath to be '/tmp/test-cache', got %s", cfg.StoragePath)
	}

	if cfg.DatabasePath != "/tmp/test.db" {
		t.Errorf("expected DatabasePath to be '/tmp/test.db', got %s", cfg.DatabasePath)
	}

	if cfg.UpstreamTimeout != 300 {
		t.Errorf("expected UpstreamTimeout to be 300, got %d", cfg.UpstreamTimeout)
	}

	if cfg.LogLevel != "debug" {
		t.Errorf("expected LogLevel to be 'debug', got %s", cfg.LogLevel)
	}

	if cfg.UserAgent != "TestAgent/1.0" {
		t.Errorf("expected UserAgent to be 'TestAgent/1.0', got %s", cfg.UserAgent)
	}
}

func TestGetEnvInt_InvalidValue(t *testing.T) {
	os.Setenv("TEST_INT", "not-a-number")
	defer os.Unsetenv("TEST_INT")

	result := getEnvInt("TEST_INT", 42)

	if result != 42 {
		t.Errorf("expected getEnvInt to return default value 42 for invalid input, got %d", result)
	}
}
