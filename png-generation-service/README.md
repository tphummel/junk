# PNG Generation Service

A small Go HTTP service that returns a deterministic PNG for a given seed,
caching every generated image on disk forever (no TTL, no eviction -- see
[`png-generation-service-design-doc.md`](./png-generation-service-design-doc.md)
for the full design). Also exposes Prometheus metrics, structured JSON logs,
and a `/healthz` endpoint.

## Requirements

- Go 1.25 (see `.tool-versions`)

## Development

### Running tests

```bash
go vet ./...
go test ./...
```

### Running locally

```bash
mkdir -p cache
CACHE_DIR=./cache PORT=8080 go run ./cmd/server
```

Then:

```bash
curl "http://localhost:8080/image?seed=hello" -o hello.png
curl http://localhost:8080/healthz
curl http://localhost:8080/metrics
```

Requesting the same seed twice returns byte-identical PNGs, the second one
served from `./cache` instead of regenerated. An empty `seed` skips the
cache entirely and returns a genuinely random image on every request (see
"Empty seed" below).

### Building

```bash
CGO_ENABLED=0 go build -o bin/server ./cmd/server
```

## API

| Endpoint | Description |
|---|---|
| `GET /image?seed=<text>` | Returns a `100x100` (configurable) PNG deterministically derived from `seed`. |
| `GET /healthz` | Returns `200 OK` with an empty body. No side effects. |
| `GET /metrics` | Prometheus exposition format. |

### Empty seed

Per the design doc, an empty `seed` means "true randomness" rather than a
deterministic image. Consequently, empty-seed requests are never read from
or written to the disk cache -- caching under the fixed empty-seed key would
make every subsequent empty-seed request deterministically return that one
cached image, defeating the point. Any non-empty seed is fully deterministic
and cached normally.

## Configuration

All configuration is via environment variables (defaults from the design
doc):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | TCP port the HTTP server listens on. |
| `CACHE_DIR` | `/data/cache` | Directory used for the disk cache. |
| `SEED_MAX_LEN` | `256` | Maximum accepted length for the `seed` query parameter; longer values get `400 Bad Request`. |
| `LOG_LEVEL` | `info` | Logger verbosity (`debug`, `info`, `warn`, `error`). |
| `METRICS_PATH` | `/metrics` | URL path for Prometheus scraping. |
| `HEALTH_PATH` | `/healthz` | URL path for health checks. |
| `IMAGE_WIDTH` / `IMAGE_HEIGHT` | `100` / `100` | Fixed image dimensions. |

The service fails to start if `CACHE_DIR` can't be created.

## Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | Counter | `handler` (`image`, `healthz`) | Requests per endpoint. |
| `cache_hits_total` | Counter | -- | PNGs served from the disk cache. |
| `cache_misses_total` | Counter | -- | PNGs generated because they weren't cached. |
| `generation_seconds` | Histogram | -- | Image generation latency (cache misses only). |
| `cache_files_total` | Gauge | -- | Current number of cached PNG files. |
| `cache_bytes_total` | Gauge | -- | Current total size (bytes) of the cache. |

## Cache

Files live under `CACHE_DIR`, named `sha256(seed).png`. Writes go to a temp
file in the same directory and are atomically renamed into place, so a
reader never sees a partial write. Nothing is ever deleted by the service --
that's left to an external process (cron job, sidecar, etc.) as noted in the
design doc.

## Docker

```bash
docker build -t png-generation-service .
docker run --rm -p 8080:8080 -v "$(pwd)/cache:/data/cache" png-generation-service
```

The image is a multi-stage build: a static (`CGO_ENABLED=0`) binary compiled
on `golang:1.25-alpine`, copied onto a `scratch` runtime image with just
`ca-certificates`, a non-root `appuser` (uid 1000), and the pre-owned
`/data/cache` directory. There's no shell or package manager in the runtime
image.

**Not verified in this environment**: this sandbox has no Docker daemon
available, so the image build/run above is untested here -- only `go build`,
`go vet`, `go test`, and running the binary directly were exercised. Please
do a local `docker build` + `docker run` smoke test before relying on it.
