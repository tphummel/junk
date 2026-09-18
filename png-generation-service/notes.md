# Notes

## Task
Implement the service described in `png-generation-service-design-doc.md`:
a Go HTTP service that returns a deterministic PNG for `GET /image?seed=...`,
caches generated PNGs on disk (no TTL/eviction), exposes Prometheus metrics,
logs structured JSON, and has a `/healthz` endpoint. Dockerized, non-root.

## Conventions followed
Looked at `trail-check/` (existing Go service in this repo) for conventions:
module-per-project `go.mod`, `.tool-versions` pinning the Go version,
`internal/` package layout, zerolog + prometheus/client_golang, a
`Dockerfile` with a builder + slim runtime stage running as non-root, and a
`.dockerignore`/`.gitignore` pair. Reused the same shape here so the repo
stays consistent, adapted to this service's much simpler requirements (no
CGO, no DB).

## Design decisions / things not fully spelled out in the doc

- **Empty seed ("true randomness")**: the doc says an empty seed means true
  randomness rather than deterministic generation. If the cache key were
  still derived from the (empty) seed, the first request would cache an
  image under a fixed key and every subsequent empty-seed request would
  then deterministically get that same cached image back - contradicting
  "true randomness". So: requests with an empty seed always generate fresh
  and are never read from or written to the cache. This only affects empty
  seed; any non-empty seed is fully deterministic and cached normally.
- **Cache size/file gauges**: doc says a `sync.RWMutex`-protected in-process
  counter tracks cache size for metrics. Implemented as an in-memory
  files/bytes counter on the `Cache` struct, seeded by scanning `CACHE_DIR`
  once at startup (so metrics are correct across restarts against an
  existing volume) and updated on every cache write.
- **Graceful shutdown**: doc explicitly scopes this out of v1 ("current
  implementation terminates on SIGTERM"; listed again under Future
  Extensions), so `main.go` just calls `ListenAndServe` and relies on the
  Go runtime's default SIGTERM handling - no `http.Server.Shutdown`.
- **Rectangle generator**: doc doesn't pin an exact algorithm beyond "a
  small set of random coloured rectangles" on a white canvas. Implemented
  as N (12) axis-aligned filled rectangles with random position/size/color,
  driven by a `math/rand` source seeded from the first 8 bytes of
  `sha256(seed)` for determinism, or a crypto/rand-seeded source when the
  seed is empty.
- **Docker base image**: doc offers Alpine or `scratch`. Went with
  `CGO_ENABLED=0` static build on a `scratch` runtime stage for the
  smallest footprint, since there's no C/graphics dependency (pure
  `image`/`image/png` from the standard library) to fight with on `scratch`.
  Still need a non-root user and `ca-certificates`/`/data/cache`
  ownership, so the builder stage prepares a minimal `/etc/passwd` and the
  cache dir before copying them into `scratch`.

## Testing
- `go vet ./...` — clean.
- `go test ./...` — unit tests per package (imagegen determinism, cache
  put/get + atomicity + stats, handlers via `httptest`) — all pass.
- Manual: `go run ./cmd/server` against a scratch cache dir, then curled
  `/image?seed=foo` twice (byte-identical response, second one logged
  `cache_hit:true`), curled `/healthz` (200, empty body), curled a
  300-char seed (400, `SEED_MAX_LEN` rejection), and curled `/metrics` —
  all six series present and incrementing as expected.
- **Not done**: no Docker daemon available in this sandbox
  (`/var/run/docker.sock` doesn't exist), so `docker build`/`docker run`
  against the `Dockerfile` is unverified. Flagged in the README as a
  follow-up smoke test to run locally before deploying.

## Final layout
```
cmd/server/main.go            wiring: config, logger, cache, mux, promhttp
internal/config/config.go     env-var config + defaults from the design doc
internal/imagegen/            seeded PNG rendering (+ tests)
internal/cache/               disk cache: hash-named files, atomic write (+ tests)
internal/metrics/metrics.go   the six Prometheus series from the design doc
internal/handlers/            /image and /healthz HTTP handlers (+ tests)
Dockerfile, .dockerignore     multi-stage build -> scratch, non-root
.gitignore, .tool-versions
png-generation-service-design-doc.md   the design doc as given
README.md                     usage/config/metrics/docker reference
```
