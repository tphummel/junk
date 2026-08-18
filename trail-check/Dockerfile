# Build stage.
#
# trail-check needs real SpatiaLite (the loadable SQLite extension), which
# means CGO and mattn/go-sqlite3 rather than a pure-Go SQLite driver -- pure
# Go drivers can't dlopen third-party .so extensions. The Debian-based image
# (rather than Alpine, unlike this repo's other Go services) matches the
# glibc dynamic linker this was developed and tested against; SpatiaLite's
# extension loading has enough native-library surface (proj, geos, rttopo,
# freexl) that it isn't worth re-verifying against musl.
FROM golang:1.25-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libc6-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=1 GOOS=linux go build -o trail-check ./cmd/server

# Runtime stage.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-mod-spatialite \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /build/trail-check .

RUN mkdir -p /data /cache && \
    groupadd -r trailcheck && useradd -r -g trailcheck -d /app trailcheck && \
    chown -R trailcheck:trailcheck /app /data /cache

USER trailcheck

ENV DATABASE_PATH=/data/trail.db \
    TILE_CACHE_ROOT=/cache \
    PORT=8080 \
    METRICS_PORT=9090

EXPOSE 8080 9090

VOLUME ["/data", "/cache"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD ["/app/trail-check", "-healthcheck"]

CMD ["./trail-check"]
