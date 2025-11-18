# Generic Artifact Cache Service

A resilient, self-sufficient caching layer for HTTP-downloadable artifacts (zip, tar.gz, jar, binaries, etc.) designed for homelab environments.

## Requirements

- Go 1.25.4 (managed via asdf)
- SQLite support

## Development

### Running Tests

```bash
# Run all tests
asdf exec go test ./...

# Run tests with verbose output
asdf exec go test -v ./...

# Run tests with coverage
asdf exec go test -v -coverprofile=coverage.out ./...
asdf exec go tool cover -html=coverage.out -o coverage.html
```

### Building

```bash
# Build the binary
asdf exec go build -o bin/artifact-cache ./cmd/server
```

### Running

```bash
# Run directly without building
asdf exec go run ./cmd/server
```

### Code Quality

```bash
# Format code
asdf exec go fmt ./...

# Run go vet
asdf exec go vet ./...

# Tidy dependencies
asdf exec go mod tidy
```

## Configuration

Configuration is managed via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | HTTP server port |
| `METRICS_PORT` | 9090 | Prometheus metrics port |
| `STORAGE_PATH` | /data/cache | Cache storage directory |
| `DATABASE_PATH` | /data/metadata.db | SQLite database path |
| `UPSTREAM_TIMEOUT` | 600 | Upstream request timeout (seconds) |
| `LOG_LEVEL` | info | Logging level (debug, info, warn, error) |
| `USER_AGENT` | HomeLabArtifactCache/1.0 | HTTP User-Agent header |

## API Endpoints

- `GET /fetch?url=<source-url>&sha256=<checksum>` - Fetch and cache artifacts
- `GET /health` - Health check endpoint
- `GET /metrics` - Prometheus metrics endpoint

## Project Structure

```
artifact-cache/
├── cmd/
│   └── server/          # Main application entry point
├── internal/
│   ├── cache/           # Core cache logic
│   ├── db/              # Database operations
│   ├── fetcher/         # Upstream HTTP client
│   ├── handlers/        # HTTP request handlers
│   ├── metrics/         # Prometheus metrics
│   └── config/          # Configuration management
└── README.md
```

## Docker

### Building the Docker Image

```bash
docker build -t artifact-cache:latest .
```

### Running with Docker

```bash
docker run -d \
  -p 8080:8080 \
  -p 9090:9090 \
  -v $(pwd)/data:/data \
  -e LOG_LEVEL=info \
  --name artifact-cache \
  artifact-cache:latest
```

### Using Pre-built Image from GHCR

```bash
docker pull ghcr.io/OWNER/artifact-cache:latest
```

Images are automatically built and pushed to GitHub Container Registry on every push to `main` and on tagged releases.

### Testing the Service

```bash
# Health check
curl http://localhost:8080/health

# Expected response:
# {"status":"healthy","timestamp":"2024-11-17T10:30:45Z"}
```

## Deployment

The service is designed for homelab deployment behind a Caddy reverse proxy:

```caddy
artifactcache.lan {
    reverse_proxy localhost:8080

    log {
        output file /var/log/caddy/artifactcache.log
        format json
    }
}
```

## CI/CD

GitHub Actions workflow automatically:
- Runs tests on pull requests
- Builds Docker images on push to `main`
- Pushes images to GitHub Container Registry (ghcr.io)
- Tags images with commit SHA and version tags

## License

See design document for full specifications.
