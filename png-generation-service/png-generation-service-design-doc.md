# Design Document – Dynamic PNG Generation Service (Disk‑Cache Only)  
**Version:** 1.0 – 2026‑09‑18  
**Author:** (you)

---

## Table of Contents
1. [Purpose & Scope](#purpose--scope)  
2. [Key Requirements](#key-requirements)  
3. [High‑Level Architecture](#high‑level-architecture)  
4. [Component Design Decisions](#component-design-decisions)  
   - 4.1 [Image Generation](#image-generation)  
   - 4.2 [Disk‑Based Cache (no TTL / size cleanup)](#disk‑based-cache-no-ttl--size-cleanup)  
   - 4.3 [Prometheus Metrics](#prometheus-metrics)  
   - 4.4 [Structured JSON Logging](#structured-json-logging)  
   - 4.5 [Health‑Check Endpoint](#health‑check-endpoint)  
   - 4.6 [Configuration (Env‑Vars)](#configuration-env-vars)  
   - 4.7 [Docker Image & Runtime](#docker-image--runtime)  
   - 4.8 [Security & Hardening](#security--hardening)  
5. [Operational Concerns](#operational-concerns)  
6. [Future Extensions (Optional)](#future-extensions-optional)  
7. [Glossary](#glossary)  

---

## 1. Purpose & Scope
Provide a **REST‑ful web service** that returns a PNG image generated on‑the‑fly from a deterministic seed.  
The service must:

* **Cache generated PNGs on disk** – a simple “write‑once, read‑many” file store with **no automatic expiration or size‑based pruning**.  
* Expose **Prometheus‑compatible metrics**.  
* Emit **structured JSON logs** (single‑line) to stdout.  
* Provide a lightweight **`/healthz`** endpoint for liveness probing.  
* Run inside a **Docker container** with a minimal footprint.

The cache is intentionally **persistent until manually cleaned**; any cleanup logic (TTL, size limits, etc.) will be handled by a separate tool if required.

---

## 2. Key Requirements

| Category | Requirement | Rationale |
|----------|-------------|-----------|
| **Functional** | Return a PNG for `GET /image?seed=<text>` | Seed guarantees reproducible images. |
| **Functional** | Fixed image dimensions (default 100 × 100 px) | Keeps generation fast and predictable. |
| **Non‑functional** | **Disk‑based cache** without TTL or size limits | Guarantees no recomputation while keeping the service code simple. |
| **Non‑functional** | **Prometheus metrics** (`/metrics`) | Enables monitoring of request volume, cache hit/miss ratio, generation latency, etc. |
| **Non‑functional** | **JSON structured logs** → stdout | Facilitates ingestion by container‑orchestrated log pipelines. |
| **Non‑functional** | **`/healthz`** endpoint returning HTTP 200 | Required for health checking in orchestration platforms. |
| **Non‑functional** | **Dockerised** with a small base image (Alpine, optionally `scratch`) | Easy deployment, low surface area. |
| **Security** | Run as non‑root user; limit query‑parameter length | Reduces attack surface and prevents abuse. |
| **Scalability** | No artificial concurrency limits; rely on Go scheduler | Allows the service to scale horizontally without code changes. |

---

## 3. High‑Level Architecture

```
+-------------------+          +---------------------+          +-------------------+
|   HTTP Client     |  <--->   |  Go HTTP Server     |  <--->   |   Disk Cache       |
| (browser/curl)   | Request   |  (net/http)         |  File I/O |   (/data/cache)    |
+-------------------+          +---------------------+          +-------------------+

        |                                 |
        | 1. /image?seed=abc              |
        |                                 |
        v                                 v
   HTTP request                     Image Generation
        |                                 |
        | 2. Cache lookup (hash → file)   |
        |   - Hit → read file             |
        |   - Miss → generate PNG         |
        |                                 |
        +----------> Return PNG ---------+

Side‑car endpoints:
- /metrics → Prometheus exporter
- /healthz → 200 OK
- Logs → JSON on stdout
```

*All components run in a single process; the cache lives solely on the filesystem.*

---

## 4. Component Design Decisions

### 4.1 Image Generation
* **Algorithm** – Fixed‑size canvas (default 100 × 100 px) filled with white, then a small set of random coloured rectangles are drawn.  
* **Determinism** – RNG seeded with a SHA‑256 hash of the user‑provided `seed` string (empty seed → true randomness).  
* **Library** – Pure Go standard library (`image`, `image/draw`, `image/png`). No external graphics dependencies.  
* **Output** – PNG (lossless, universally supported).  

### 4.2 Disk‑Based Cache (No TTL / Size Cleanup)
| Aspect | Decision |
|--------|----------|
| **Location** | Configurable directory (`CACHE_DIR`), default `/data/cache`. |
| **Naming** | SHA‑256 hash of the canonical request string (currently only the seed) with a `.png` suffix. Guarantees deterministic mapping and avoids illegal characters. |
| **Write Path** | Images are written once to a temporary file and then atomically renamed to the final name, ensuring readers never see a partially written file. |
| **Read Path** | Simple file read; if the file exists, it is served directly. No locking is required for reads because the file is immutable after creation. |
| **No Eviction** | The service **does not** delete any cached files automatically. Cache growth is unlimited from the service’s perspective; external processes are responsible for cleanup if needed. |
| **Thread‑Safety** | A lightweight `sync.RWMutex` protects updates to an in‑process counter that tracks total cache size (used only for metrics). File reads themselves are lock‑free. |
| **Persistence** | If the container is restarted with the same volume mounted, the cache survives; otherwise it starts empty. |
| **Safety** | The service only ever writes inside `CACHE_DIR`; filenames are derived from cryptographic hashes, eliminating path‑traversal risk. |

### 4.3 Prometheus Metrics
| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | Counter | `handler={"image","healthz"}` | Number of HTTP requests per endpoint. |
| `cache_hits_total` | Counter | – | Number of PNGs served from the disk cache. |
| `cache_misses_total` | Counter | – | Number of PNGs generated because they were not cached. |
| `generation_seconds` | Histogram | – | Latency for image generation (only on cache miss). |
| `cache_files_total` | Gauge | – | Current number of cached PNG files. |
| `cache_bytes_total` | Gauge | – | Current total size (bytes) of all cached PNG files. |

All metrics are exposed on **`/metrics`** via the Prometheus client library.

### 4.4 Structured JSON Logging
* **Library** – `zerolog` (or any minimal zero‑allocation logger).  
* **Destination** – Stdout (Docker captures this automatically).  
* **Standard fields** – `timestamp`, `level`, `msg`.  
* **Additional contextual fields** – `handler`, `seed`, `status`, `duration_ms`, `error` (if any).  
* **Log levels** – `Info` for normal request flow, `Error` for failures, `Debug` can be enabled via `LOG_LEVEL` env var.  

### 4.5 Health‑Check Endpoint
* **Path** – `/healthz` (GET).  
* **Response** – HTTP 200 with an empty body.  
* **Metrics** – Counted in `http_requests_total{handler="healthz"}`.  
* **Side Effects** – None; does not touch the cache or image generation.  

### 4.6 Configuration (Env‑Vars)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | TCP port the HTTP server listens on. |
| `CACHE_DIR` | `/data/cache` | Directory used for the disk cache. |
| `SEED_MAX_LEN` | `256` | Maximum accepted length for the `seed` query parameter (prevents abuse). |
| `LOG_LEVEL` | `info` | Logger verbosity (`debug`, `info`, `warn`, `error`). |
| `METRICS_PATH` | `/metrics` | URL path for Prometheus scraping. |
| `HEALTH_PATH` | `/healthz` | URL path for health checks. |
| `IMAGE_WIDTH` / `IMAGE_HEIGHT` | `100` / `100` | Fixed image dimensions (can be overridden if needed later). |

All variables are read at start‑up; failure to create `CACHE_DIR` will cause the service to exit with an error.

### 4.7 Docker Image & Runtime
| Stage | Base Image | Reason |
|-------|------------|--------|
| **Builder** | `golang:1.22-alpine` | Provides Go toolchain; easy to compile. |
| **Runtime** | `alpine:3.19` (or `scratch` for final) | Small footprint; includes `ca-certificates` for any downstream HTTPS calls. |
| **User** | Non‑root user (`appuser`, UID 1000) | Follows Docker security best practice. |
| **Filesystem** | Create `CACHE_DIR` with proper ownership; volume can be mounted at runtime (`-v ./cache:/data/cache`). |
| **Entrypoint** | Binary `/app/server` | Exposes the HTTP server on the configured `PORT`. |

*If absolute minimal size is required, replace the runtime stage with `scratch` and compile the binary with `CGO_ENABLED=0` for static linking.*

### 4.8 Security & Hardening
| Threat | Mitigation |
|--------|------------|
| **Unrestricted seed length** | Enforce `SEED_MAX_LEN`; reject longer values with `400 Bad Request`. |
| **DoS via image generation** | Fixed image size and deterministic algorithm; generation is cheap (< 10 ms). |
| **File‑system abuse** | All writes confined to `CACHE_DIR`; filenames are deterministic hashes, eliminating path traversal. |
| **Running as root** | Dockerfile creates a non‑root user and runs the binary under that user. |
| **Log injection** | Logs emitted as valid JSON; special characters are escaped automatically. |
| **Open metrics endpoint** | If metrics need protection, place the service behind a firewall or add optional basic auth (outside current scope). |

---

## 5. Operational Concerns

| Concern | Monitoring / Action |
|----------|---------------------|
| **Cache growth** | Metrics `cache_files_total` and `cache_bytes_total` expose current usage; set alerts if they exceed expected thresholds. |
| **Request latency** | Histogram `generation_seconds`; alert on high percentiles (> 95th). |
| **Service health** | Liveness probe (`/healthz`) should return 200; orchestrators can restart the container if it fails. |
| **Log ingestion** | Ensure container stdout is collected by the orchestration platform (Kubernetes, Docker, etc.). |
| **Graceful shutdown** | Current implementation terminates on SIGTERM; can be extended with `http.Server.Shutdown` if needed. |
| **Resource limits** | CPU and memory limits can be set at deployment time; the service is lightweight and stays well within typical default limits. |

---

## 6. Future Extensions (Optional)

| Feature | Why consider it | Implementation hint |
|---------|----------------|---------------------|
| **Variable image dimensions** | Allow clients to request custom sizes. | Add `w`/`h` query parameters, validate against a maximum, and include them in the cache key. |
| **More graphics primitives** | Provide richer visual output. | Replace the simple rectangle generator with a higher‑level drawing library (`gg`, `fogleman/gg`). |
| **External cache (Redis / Memcached)** | Share cached images across multiple pods. | Abstract the cache interface; supply a Redis implementation that stores the PNG bytes. |
| **TTL / Size eviction** | Automatic cleanup when cache grows too large. | Add a separate background process or side‑car that scans `CACHE_DIR` and removes old/large files. |
| **Authentication / API keys** | Restrict usage to authorized clients. | Add a middleware that checks a header or query token against a secret list. |
| **Compressed formats (JPEG/WebP)** | Reduce bandwidth for larger images. | Add a `fmt` query parameter and implement appropriate encoders. |
| **Graceful shutdown / draining** | Enable zero‑downtime rolling updates. | Use `http.Server.Shutdown` with a context timeout. |
| **Edge‑cache via CDN** | Reduce latency for end‑users globally. | After generation, copy the PNG to an object store (S3) and serve via a CDN. |

These extensions can be layered on top of the existing design without breaking the current API contract.

---

## 7. Glossary

| Term | Definition |
|------|------------|
| **PNG** | Portable Network Graphics – lossless raster image format. |
| **TTL** | Time‑to‑Live – not used in this version (cache persists indefinitely). |
| **Prometheus** | Open‑source monitoring system that scrapes HTTP endpoints for metrics. |
| **Zero‑allocation logger** | Logging library that avoids heap allocations for high performance (e.g., `zerolog`). |
| **Docker `scratch`** | Empty base image; used for statically linked binaries to achieve minimal container size. |
| **CGO** | Go toolchain feature that allows calls to C code; disabled for static linking. |
| **Liveness probe** | Health check used by orchestrators to decide if a container should be restarted. |
| **Readiness probe** | Health check used to decide when a container is ready to receive traffic (not required here). |

--- 

**End of Document**
