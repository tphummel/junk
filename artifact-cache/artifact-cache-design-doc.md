# Generic Artifact Cache Service - Design Document

**Version:** 1.0  
**Date:** November 17, 2024  
**Author:** Homelab Infrastructure

---

## Table of Contents

1. [Overview](#overview)
2. [Requirements](#requirements)
3. [Architecture](#architecture)
4. [API Contract](#api-contract)
5. [Data Model](#data-model)
6. [Storage Strategy](#storage-strategy)
7. [Implementation Details](#implementation-details)
8. [Deployment](#deployment)
9. [Observability](#observability)
10. [Usage Examples](#usage-examples)
11. [Future Considerations](#future-considerations)

---

## Overview

### Purpose

The Generic Artifact Cache Service provides a resilient, self-sufficient caching layer for arbitrary HTTP-downloadable artifacts (zip, tar.gz, jar, binaries, etc.) within a homelab environment. It acts as both a transparent cache and a passive archive, ensuring files remain available even if upstream sources move, change, or are deleted.

### Key Goals

- **Resilience**: Continue operating during internet outages or upstream failures
- **Archival**: Preserve artifacts long-term (12+ months) on-demand
- **Simplicity**: Minimal operational complexity (SQLite, single binary)
- **Observability**: Rich metrics and structured logging
- **Self-sufficiency**: Upgrade components on your schedule, not upstream's

### Design Philosophy

- **Operational simplicity over features**: SQLite over PostgreSQL, single service over microservices
- **Explicit over implicit**: Human-readable URLs, clear cache hit/miss status
- **Observability first**: Prometheus metrics and structured JSON logs built-in
- **Standard patterns**: Follows homelab conventions (Caddy reverse proxy, Docker containers, subdomain routing)

---

## Requirements

### Functional Requirements

1. **Cache arbitrary public HTTP artifacts**
   - Support for any publicly accessible HTTP/HTTPS URL
   - No authentication or private resource support
   - Support for large files (multi-GB)

2. **Content verification**
   - Optional SHA256 checksum verification
   - Detect upstream content changes
   - Fail gracefully on mismatch

3. **Long-term storage**
   - Retain cached artifacts indefinitely (or until manually removed)
   - No automatic expiration or LRU eviction
   - Assume sufficient storage capacity

4. **Deduplication**
   - Content-addressed storage
   - Identical content from different URLs shares storage

### Non-Functional Requirements

1. **Performance**
   - Cache hits serve files directly from disk
   - Minimal overhead for metadata lookups
   - Support concurrent requests

2. **Reliability**
   - Graceful handling of upstream failures
   - Clear error messages with appropriate HTTP status codes
   - Transactional metadata updates

3. **Observability**
   - Prometheus metrics for all operations
   - Structured JSON logging
   - Cache hit/miss tracking
   - Access statistics

4. **Operational Simplicity**
   - Single binary deployment
   - SQLite for metadata (no separate database server)
   - Filesystem-based storage
   - Easy backup and restore

---

## Architecture

### System Context

```
┌─────────────────┐
│  Client Tools   │
│  (Ansible, etc) │
└────────┬────────┘
         │ HTTPS
         ▼
┌─────────────────┐
│      Caddy      │  (TLS termination, reverse proxy)
│  *.cache.lan    │
└────────┬────────┘
         │ HTTP
         ▼
┌─────────────────────────────────────────┐
│    Generic Artifact Cache Service       │
│                                         │
│  ┌─────────┐  ┌──────────┐  ┌────────┐│
│  │   API   │  │  Cache   │  │ Metrics││
│  │ Handler │─▶│  Engine  │  │        ││
│  └─────────┘  └────┬─────┘  └────────┘│
│                    │                    │
│           ┌────────┴────────┐          │
│           ▼                 ▼          │
│      ┌────────┐      ┌──────────┐     │
│      │ SQLite │      │Filesystem│     │
│      │   DB   │      │ Storage  │     │
│      └────────┘      └──────────┘     │
└─────────────────────────────────────────┘
         │
         │ HTTPS (on cache miss)
         ▼
┌─────────────────┐
│  Upstream       │
│  Artifact Hosts │
└─────────────────┘
```

### Component Responsibilities

**API Handler**
- Parse and validate requests
- Route to appropriate cache operations
- Format responses and errors
- Update metrics

**Cache Engine**
- Check cache for existing artifacts
- Download from upstream on cache miss
- Compute and verify checksums
- Store artifacts and metadata
- Track access statistics

**SQLite Database**
- Store artifact metadata
- Track access patterns
- Provide cache statistics

**Filesystem Storage**
- Content-addressed file storage
- Organized by hash prefix for performance

**Metrics Exporter**
- Expose Prometheus metrics
- Track cache performance

---

## API Contract

### Base URL

```
https://artifactcache.lan
```

### Endpoints

#### 1. Fetch Artifact

**Primary endpoint for retrieving cached artifacts**

```http
GET /fetch?url=<source-url>&sha256=<checksum>
```

**Query Parameters:**

| Parameter | Type   | Required | Description                           |
|-----------|--------|----------|---------------------------------------|
| `url`     | string | Yes      | Full URL of upstream artifact         |
| `sha256`  | string | No       | Expected SHA256 hash for verification |

**Success Response:**

```http
HTTP/1.1 200 OK
Content-Type: application/octet-stream
Content-Length: 95847362
X-Cache-Status: HIT
X-Content-SHA256: 7a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d...

<binary content>
```

**Response Headers:**

| Header | Description |
|--------|-------------|
| `Content-Type` | MIME type of artifact (from upstream or detected) |
| `Content-Length` | File size in bytes |
| `X-Cache-Status` | `HIT` or `MISS` |
| `X-Content-SHA256` | SHA256 hash of content |

**Error Responses:**

**Missing URL Parameter**
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": "missing_parameter",
  "parameter": "url",
  "message": "Missing required 'url' parameter"
}
```

**Checksum Mismatch**
```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "error": "checksum_mismatch",
  "expected": "abc123def456...",
  "actual": "789ghi012jkl...",
  "source_url": "https://example.com/file.tar.gz",
  "message": "Artifact checksum does not match expected value"
}
```

**Upstream Error**
```http
HTTP/1.1 502 Bad Gateway
Content-Type: application/json

{
  "error": "upstream_error",
  "status_code": 404,
  "source_url": "https://example.com/file.tar.gz",
  "message": "Upstream server returned status 404"
}
```

**Upstream Timeout**
```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/json

{
  "error": "upstream_unavailable",
  "source_url": "https://example.com/file.tar.gz",
  "message": "Upstream server timeout or unreachable"
}
```

**Internal Server Error**
```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{
  "error": "internal_error",
  "message": "Failed to write to cache storage",
  "details": "disk full"
}
```

#### 2. Health Check

```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-11-17T10:30:45Z"
}
```

#### 3. Cache Statistics

```http
GET /api/stats
```

**Response:**
```json
{
  "total_items": 42,
  "total_size_bytes": 5368709120,
  "total_accesses": 156
}
```

#### 4. Prometheus Metrics

```http
GET /metrics
```

**Response:** Prometheus text format

```
# HELP artifact_cache_requests_total Total number of cache requests
# TYPE artifact_cache_requests_total counter
artifact_cache_requests_total{status="hit"} 89
artifact_cache_requests_total{status="miss"} 23
artifact_cache_requests_total{status="error"} 2

# HELP artifact_cache_downloads_total Total number of upstream downloads
# TYPE artifact_cache_downloads_total counter
artifact_cache_downloads_total 23

# HELP artifact_cache_bytes_downloaded_total Total bytes downloaded from upstream
# TYPE artifact_cache_bytes_downloaded_total counter
artifact_cache_bytes_downloaded_total 5368709120

# HELP artifact_cache_bytes_served_total Total bytes served to clients
# TYPE artifact_cache_bytes_served_total counter
artifact_cache_bytes_served_total 8053063680

# HELP artifact_cache_request_duration_seconds Request duration in seconds
# TYPE artifact_cache_request_duration_seconds histogram
artifact_cache_request_duration_seconds_bucket{le="0.005"} 45
artifact_cache_request_duration_seconds_bucket{le="0.01"} 78
...
```

---

## Data Model

### SQLite Schema

```sql
CREATE TABLE artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_url TEXT NOT NULL UNIQUE,
    content_hash TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    content_type TEXT,
    first_cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    access_count INTEGER DEFAULT 0
);

CREATE INDEX idx_source_url ON artifacts(source_url);
CREATE INDEX idx_content_hash ON artifacts(content_hash);
CREATE INDEX idx_last_accessed ON artifacts(last_accessed_at);
```

### Entity: Artifact

| Field | Type | Description |
|-------|------|-------------|
| `id` | INTEGER | Primary key |
| `source_url` | TEXT | Original upstream URL (unique) |
| `content_hash` | TEXT | SHA256 hash of file content |
| `storage_path` | TEXT | Filesystem path to cached file |
| `file_size` | INTEGER | Size in bytes |
| `content_type` | TEXT | MIME type |
| `first_cached_at` | TIMESTAMP | When first downloaded |
| `last_accessed_at` | TIMESTAMP | Most recent access |
| `access_count` | INTEGER | Number of times served |

---

## Storage Strategy

### Content-Addressed Storage

Files are stored by SHA256 hash of their content, enabling deduplication.

**Path Structure:**
```
/data/cache/{hash[0:2]}/{hash[2:4]}/{full_hash}
```

**Example:**
```
Hash: 7a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b

Path: /data/cache/7a/1b/7a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b
```

### Benefits

- **Deduplication**: Identical files from different URLs stored once
- **Integrity**: Hash mismatch indicates corruption
- **Distribution**: Two-level directory structure prevents filesystem performance degradation
- **Immutable**: Content never changes; hash serves as stable identifier

### Storage Layout

```
/data/
├── cache/
│   ├── 00/
│   │   ├── 01/
│   │   │   └── 0001abc...
│   │   └── 02/
│   │       └── 0002def...
│   ├── 7a/
│   │   └── 1b/
│   │       └── 7a1b2c3...
│   └── ff/
│       └── fe/
│           └── fffedcb...
└── metadata.db
```

---

## Implementation Details

### Technology Stack

- **Language**: Go 1.21+
- **Database**: SQLite (modernc.org/sqlite - pure Go driver)
- **HTTP Framework**: Standard library (net/http)
- **Metrics**: Prometheus client_golang
- **Logging**: Standard library (log/slog)
- **Container**: Docker with Alpine base

### Key Dependencies

```go
module artifact-cache

go 1.21

require (
    github.com/prometheus/client_golang v1.17.0
    modernc.org/sqlite v1.27.0
)
```

### Project Structure

```
artifact-cache/
├── cmd/
│   └── server/
│       └── main.go              # Entry point
├── internal/
│   ├── cache/
│   │   ├── cache.go             # Core cache logic
│   │   ├── storage.go           # Filesystem operations
│   │   └── errors.go            # Custom error types
│   ├── db/
│   │   ├── db.go                # SQLite connection
│   │   └── queries.go           # Database operations
│   ├── fetcher/
│   │   └── fetcher.go           # Upstream HTTP client
│   ├── handlers/
│   │   └── handlers.go          # HTTP request handlers
│   └── metrics/
│       └── metrics.go           # Prometheus metrics
├── config.yaml                   # Configuration
├── go.mod
├── go.sum
├── Dockerfile
└── docker-compose.yml
```

### Configuration

**config.yaml:**
```yaml
server:
  host: 0.0.0.0
  port: 8080

storage:
  base_path: /data/cache
  database: /data/metadata.db

logging:
  level: info
  format: json

upstream:
  timeout_seconds: 600
  user_agent: "HomeLabArtifactCache/1.0"
  max_retries: 3
```

### Core Algorithms

#### Fetch Flow

```
1. Parse request (extract url and sha256 parameters)
2. Query database for source_url
3. IF artifact exists in DB:
     a. Verify file exists on filesystem
     b. IF sha256 provided AND mismatch:
          → Return 409 Conflict
     c. Update last_accessed_at and access_count
     d. Return file (200 OK, X-Cache-Status: HIT)
4. ELSE (cache miss):
     a. Download from upstream URL
     b. Compute SHA256 of content during download
     c. IF sha256 provided AND mismatch:
          → Return 409 Conflict
     d. Store to content-addressed path
     e. Insert metadata into database
     f. Return file (200 OK, X-Cache-Status: MISS)
5. Handle errors:
     - Upstream 4xx/5xx → 502 Bad Gateway
     - Upstream timeout → 503 Service Unavailable
     - Internal error → 500 Internal Server Error
```

#### Content Addressing

```go
func contentAddressedPath(basePath, hash string) string {
    // /data/cache/ab/cd/abcd1234...
    return filepath.Join(basePath, hash[:2], hash[2:4], hash)
}
```

#### SHA256 Computation

```go
func downloadAndHash(url string) ([]byte, string, error) {
    resp, err := http.Get(url)
    if err != nil {
        return nil, "", err
    }
    defer resp.Body.Close()
    
    hash := sha256.New()
    var buf bytes.Buffer
    
    // Write to both buffer and hash simultaneously
    multiWriter := io.MultiWriter(&buf, hash)
    io.Copy(multiWriter, resp.Body)
    
    return buf.Bytes(), hex.EncodeToString(hash.Sum(nil)), nil
}
```

### Error Handling

**Custom Error Types:**

```go
type ChecksumMismatchError struct {
    Expected string
    Actual   string
}

type UpstreamError struct {
    StatusCode int
    URL        string
}

type UpstreamTimeoutError struct {
    URL string
}
```

**Error Response Mapping:**

| Error Type | HTTP Status | Error Code |
|------------|-------------|------------|
| Missing URL | 400 | `missing_parameter` |
| Checksum mismatch | 409 | `checksum_mismatch` |
| Upstream 4xx/5xx | 502 | `upstream_error` |
| Upstream timeout | 503 | `upstream_unavailable` |
| Internal error | 500 | `internal_error` |

---

## Deployment

### Docker Container

**Dockerfile:**
```dockerfile
FROM golang:1.21-alpine AS builder

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -o artifact-cache ./cmd/server

FROM alpine:latest

RUN apk --no-cache add ca-certificates
WORKDIR /app

COPY --from=builder /build/artifact-cache .
COPY config.yaml .

RUN mkdir -p /data/cache

EXPOSE 8080 9090

CMD ["./artifact-cache"]
```

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  artifact-cache:
    build: .
    container_name: artifact-cache
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:8080"  # API
      - "127.0.0.1:9090:9090"  # Metrics
    volumes:
      - ./data:/data
      - ./config.yaml:/app/config.yaml:ro
    environment:
      - TZ=America/Los_Angeles
```

### Caddy Reverse Proxy

**Caddyfile:**
```caddy
artifactcache.lan {
    reverse_proxy localhost:8080
    
    log {
        output file /var/log/caddy/artifactcache.log
        format json
    }
}
```

### DNS Configuration

```
artifactcache.lan  A  192.168.x.x
```

### Deployment Steps

```bash
# 1. Clone or create project structure
mkdir -p artifact-cache/{cmd/server,internal/{cache,db,handlers,metrics},data}

# 2. Copy source files
# (implement Go files as per design)

# 3. Build and start
docker-compose up -d

# 4. Verify health
curl http://localhost:8080/health

# 5. Check metrics
curl http://localhost:9090/metrics
```

---

## Observability

### Structured Logging

All logs are JSON formatted for easy parsing and aggregation.

**Cache HIT Example:**
```json
{
  "time": "2024-11-17T10:30:45Z",
  "level": "INFO",
  "msg": "cache HIT",
  "source_url": "https://github.com/prometheus/prometheus/releases/download/v2.45.0/prometheus-2.45.0.linux-amd64.tar.gz",
  "size_bytes": 95847362,
  "duration_ms": 45,
  "client_ip": "192.168.1.100:54321"
}
```

**Cache MISS Example:**
```json
{
  "time": "2024-11-17T10:31:12Z",
  "level": "INFO",
  "msg": "cache MISS - downloaded from upstream",
  "source_url": "https://adoptium.net/temurin.tar.gz",
  "size_bytes": 123456789,
  "duration_ms": 3421,
  "client_ip": "192.168.1.100:54322"
}
```

**Error Example:**
```json
{
  "time": "2024-11-17T10:32:00Z",
  "level": "ERROR",
  "msg": "fetch failed",
  "source_url": "https://example.com/missing.jar",
  "error": "upstream returned status 404",
  "client_ip": "192.168.1.100:54323"
}
```

### Prometheus Metrics

**Counters:**
- `artifact_cache_requests_total{status="hit|miss|error"}` - Request count by outcome
- `artifact_cache_downloads_total` - Number of upstream downloads
- `artifact_cache_bytes_downloaded_total` - Bytes downloaded from upstream
- `artifact_cache_bytes_served_total` - Bytes served to clients

**Gauges:**
- `artifact_cache_items_total` - Number of cached artifacts
- `artifact_cache_size_bytes` - Total cache size

**Histograms:**
- `artifact_cache_request_duration_seconds` - Request latency distribution
- `artifact_cache_download_size_bytes` - Download size distribution

### Uptime Kuma Monitoring

```yaml
Monitor: Artifact Cache Service
Type: HTTP(s)
URL: https://artifactcache.lan/health
Expected: 200
Keyword: "healthy"
Heartbeat Interval: 60 seconds

Monitor: Artifact Cache Metrics
Type: HTTP(s)
URL: http://cache-server:9090/metrics
Keyword: "artifact_cache_requests_total"
Heartbeat Interval: 300 seconds
```

### Grafana Dashboard Queries

**Cache Hit Rate:**
```promql
sum(rate(artifact_cache_requests_total{status="hit"}[5m])) 
/ 
sum(rate(artifact_cache_requests_total[5m])) * 100
```

**Total Cache Size:**
```promql
artifact_cache_size_bytes / 1024 / 1024 / 1024
```

**Request Duration p95:**
```promql
histogram_quantile(0.95, 
  rate(artifact_cache_request_duration_seconds_bucket[5m])
)
```

---

## Usage Examples

### cURL

**Simple fetch:**
```bash
curl -o prometheus.tar.gz \
  "https://artifactcache.lan/fetch?url=https://github.com/prometheus/prometheus/releases/download/v2.45.0/prometheus-2.45.0.linux-amd64.tar.gz"
```

**With checksum verification:**
```bash
curl -o file.jar \
  "https://artifactcache.lan/fetch?url=https://repo1.maven.org/maven2/org/example/artifact.jar&sha256=abc123def456..."
```

### wget

```bash
wget -O output.tar.gz \
  "https://artifactcache.lan/fetch?url=https://example.com/file.tar.gz"
```

### Ansible Playbook

**Simple download:**
```yaml
- name: Download Prometheus through cache
  get_url:
    url: "https://artifactcache.lan/fetch?url=https://github.com/prometheus/prometheus/releases/download/v2.45.0/prometheus-2.45.0.linux-amd64.tar.gz"
    dest: /opt/prometheus/prometheus.tar.gz
```

**With variables and checksum:**
```yaml
- name: Download Java application
  get_url:
    url: "https://artifactcache.lan/fetch?url={{ artifact_url | urlencode }}&sha256={{ artifact_checksum }}"
    dest: "{{ app_dir }}/app.jar"
    checksum: "sha256:{{ artifact_checksum }}"
  vars:
    artifact_url: "https://repo1.maven.org/maven2/com/example/app.jar"
    artifact_checksum: "abc123def456..."
```

**Reusable role:**
```yaml
# roles/cached_download/tasks/main.yml
- name: Download artifacts through cache
  get_url:
    url: "https://artifactcache.lan/fetch?url={{ item.url | urlencode }}&sha256={{ item.checksum | default('') }}"
    dest: "{{ item.dest }}"
  loop: "{{ artifacts }}"

# Usage in playbook:
- hosts: appservers
  roles:
    - cached_download
  vars:
    artifacts:
      - url: "https://github.com/prometheus/prometheus/releases/download/v2.45.0/prometheus-2.45.0.linux-amd64.tar.gz"
        dest: "/opt/prometheus/prometheus.tar.gz"
        checksum: "7a1b2c3d..."
      - url: "https://adoptium.net/temurin-17.tar.gz"
        dest: "/opt/java/jdk.tar.gz"
        checksum: "4e5f6a7b..."
```

### Python Script

```python
import requests

def download_cached(source_url, dest_path, checksum=None):
    """Download artifact through cache"""
    params = {"url": source_url}
    if checksum:
        params["sha256"] = checksum
    
    response = requests.get(
        "https://artifactcache.lan/fetch",
        params=params,
        stream=True
    )
    
    if response.status_code == 200:
        with open(dest_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        cache_status = response.headers.get("X-Cache-Status")
        content_hash = response.headers.get("X-Content-SHA256")
        
        return {
            "success": True,
            "cache_hit": cache_status == "HIT",
            "hash": content_hash
        }
    else:
        error = response.json()
        return {
            "success": False,
            "error": error
        }

# Usage
result = download_cached(
    "https://github.com/prometheus/prometheus/releases/download/v2.45.0/prometheus-2.45.0.linux-amd64.tar.gz",
    "/tmp/prometheus.tar.gz",
    checksum="7a1b2c3d4e5f..."
)

print(f"Cache hit: {result['cache_hit']}")
```

---

## Future Considerations

These features are **not implemented** in the initial version but noted for potential future development:

### Optional Enhancements

1. **HEAD endpoint**: Check cache status without downloading
   ```http
   HEAD /fetch?url=https://example.com/file.tar.gz
   X-Cache-Status: HIT
   ```

2. **Manual cache management API**:
   - `GET /api/artifacts` - List all cached artifacts
   - `GET /api/artifacts/<id>` - Get artifact metadata
   - `DELETE /api/artifacts/<id>` - Manual eviction

3. **Background upstream verification**:
   - Periodic check if upstream still exists
   - Update metadata with upstream status
   - Alert on upstream changes

4. **LRU eviction** (if storage becomes constrained):
   - Configurable cache size limit
   - Automatic removal of least-recently-used items
   - Preserve recently accessed artifacts

5. **Authentication**:
   - API keys for access control
   - Per-client quotas
   - Audit log of who downloaded what

6. **Multi-checksum support**:
   - Support SHA1, SHA512, MD5 in addition to SHA256
   - Verify against multiple hashes

7. **Bandwidth throttling**:
   - Rate limit upstream downloads
   - Per-client download limits

8. **Cache warming**:
   - Pre-populate cache from a manifest
   - Scheduled background downloads

9. **Replication**:
   - Sync cache between multiple instances
   - Distributed cache cluster

10. **Web UI**:
    - Browse cached artifacts
    - View statistics and graphs
    - Manual cache management

---

## Backup and Disaster Recovery

### Backup Strategy

**What to back up:**
1. SQLite database: `/data/metadata.db`
2. Cached files: `/data/cache/`
3. Configuration: `config.yaml`

**Backup script example:**
```bash
#!/bin/bash
BACKUP_DIR="/backup/artifact-cache/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

# Stop service (optional, for consistency)
docker-compose stop artifact-cache

# Backup database
cp /data/metadata.db "$BACKUP_DIR/"

# Backup cache (incremental with rsync)
rsync -av --delete /data/cache/ "$BACKUP_DIR/cache/"

# Backup config
cp config.yaml "$BACKUP_DIR/"

# Restart service
docker-compose start artifact-cache

# Compress backup
tar -czf "$BACKUP_DIR.tar.gz" -C /backup/artifact-cache "$(date +%Y%m%d)"
rm -rf "$BACKUP_DIR"
```

### Recovery Procedure

```bash
# 1. Stop service
docker-compose down

# 2. Restore from backup
tar -xzf backup-20241117.tar.gz -C /tmp/
cp /tmp/20241117/metadata.db /data/
rsync -av /tmp/20241117/cache/ /data/cache/

# 3. Verify database
sqlite3 /data/metadata.db "PRAGMA integrity_check;"

# 4. Restart service
docker-compose up -d

# 5. Verify health
curl http://localhost:8080/health
```

---

## Maintenance

### Routine Operations

**Check cache statistics:**
```bash
curl http://localhost:8080/api/stats | jq
```

**View recent logs:**
```bash
docker-compose logs -f --tail=100 artifact-cache
```

**Verify disk space:**
```bash
du -sh /data/cache
df -h /data
```

**Database maintenance:**
```bash
# Vacuum database to reclaim space
sqlite3 /data/metadata.db "VACUUM;"

# Analyze for query optimization
sqlite3 /data/metadata.db "ANALYZE;"
```

### Troubleshooting

**Cache miss for previously cached item:**
- Check if file exists: `ls -la /data/cache/ab/cd/abcd1234...`
- Check database: `sqlite3 /data/metadata.db "SELECT * FROM artifacts WHERE source_url='...';"`
- Verify storage path matches

**High disk usage:**
- Check cache statistics: `curl localhost:8080/api/stats`
- Identify large files: `find /data/cache -type f -size +1G -exec ls -lh {} \;`
- Consider manual eviction of old/unused items

**Slow downloads:**
- Check upstream performance: `time curl -I <upstream-url>`
- Review metrics: `curl localhost:9090/metrics | grep duration`
- Consider increasing timeout in config

**Database locked errors:**
- Check for concurrent writes
- Verify no stale processes holding locks
- Consider WAL mode: `PRAGMA journal_mode=WAL;`

---

## Security Considerations

### Threat Model

**In scope:**
- Malicious upstream content (malware, viruses)
- Resource exhaustion (disk space, bandwidth)
- Cache poisoning attempts

**Out of scope (for initial version):**
- Authentication/authorization (all public artifacts)
- DDoS protection (homelab environment)
- Multi-tenancy isolation

### Security Measures

1. **Input validation**:
   - URL format validation
   - Checksum format validation
   - Reject non-HTTP(S) schemes

2. **Resource limits**:
   - Request timeout (10 minutes default)
   - Maximum file size (configurable)
   - Disk space monitoring

3. **Content verification**:
   - SHA256 checksum validation
   - Detect upstream content changes
   - Immutable storage (content-addressed)

4. **Network security**:
   - TLS for client connections (via Caddy)
   - Respect upstream HTTPS certificates
   - No proxy to internal/private networks

5. **Operational security**:
   - Run as non-root user in container
   - Read-only filesystem where possible
   - Regular security updates

### Recommendations

- **Scan downloaded files**: Integrate with ClamAV or similar
- **Monitor access patterns**: Alert on unusual download spikes
- **Restrict source URLs**: Optional allowlist/denylist of domains
- **Regular audits**: Review cached artifacts and access logs

---

## Performance Characteristics

### Expected Performance

**Cache Hit (typical):**
- Latency: 5-50ms (filesystem read)
- Throughput: Limited by disk I/O and network egress

**Cache Miss (typical):**
- Latency: Upstream download time + 10-100ms overhead
- Throughput: Limited by upstream server and network bandwidth

**Concurrent Requests:**
- Handles multiple simultaneous cache hits efficiently
- Serializes downloads from same URL to prevent duplicate fetches
- Independent downloads can proceed in parallel

### Scaling Limits

**Single Instance Capacity:**
- Artifacts: Millions (limited by disk space)
- Concurrent requests: 100+ (configurable)
- Disk I/O: Depends on storage backend (SSD recommended)

**Bottlenecks:**
- Upstream download bandwidth
- Disk I/O for large files
- SQLite write concurrency (mitigated by quick transactions)

### Optimization Opportunities

1. **SSD storage**: Dramatically improves cache hit performance
2. **Separate data/metadata disks**: Reduce I/O contention
3. **Increase file descriptors**: Support more concurrent connections
4. **Tune SQLite**: WAL mode, larger cache size
5. **CDN for cache**: Put cache behind CDN for geographic distribution

---

## Compliance and Legal

### Copyright and Licensing

- Service only caches publicly accessible content
- No responsibility for upstream content licensing
- User must have right to access/distribute cached content
- Logs track source URLs for audit trail

### Data Retention

- Artifacts retained indefinitely (until manual deletion)
- Access logs retained per configuration
- No automatic deletion or expiration

### Privacy

- Logs include client IP addresses
- No user authentication or personal information stored
- Consider log retention policies for privacy compliance

---

## Appendix

### Glossary

- **Artifact**: A file downloaded and cached by the service
- **Cache Hit**: Request served from local storage
- **Cache Miss**: Request requires upstream download
- **Content-Addressed Storage**: Files stored by hash of content
- **Checksum**: SHA256 hash for content verification
- **Upstream**: Original source of artifacts

### References

- [Prometheus Metrics Best Practices](https://prometheus.io/docs/practices/naming/)
- [HTTP Status Codes RFC 7231](https://tools.ietf.org/html/rfc7231)
- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [Content-Addressed Storage](https://en.wikipedia.org/wiki/Content-addressable_storage)

### Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-11-17 | Initial design document |

---

## Contact and Support

For questions, issues, or contributions related to this service, please refer to your homelab documentation or infrastructure team.

**Document End**
