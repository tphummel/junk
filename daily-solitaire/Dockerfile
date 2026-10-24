# Build stage: pure-Go (modernc SQLite), so no CGO toolchain is needed.
FROM golang:1.25-alpine AS builder

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .

ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/daily-solitaire ./cmd/server && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-s -w" -o /out/admin ./cmd/admin

# Litestream binary (continuous replication of /data/app.db).
FROM litestream/litestream:0.3.13 AS litestream

# Runtime stage: distroless, no shell. time/tzdata is compiled in, so no zoneinfo is needed.
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /out/daily-solitaire /app/daily-solitaire
COPY --from=builder /out/admin /app/admin
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY litestream.yml /etc/litestream.yml

ENV DATABASE_PATH=/data/app.db \
    PORT=8080 \
    METRICS_PORT=9090

EXPOSE 8080 9090
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD ["/app/daily-solitaire", "-healthcheck"]

# Litestream is PID 1 and starts the app with -exec, so replication is running
# before the first write. To run without replication (local use), override the
# entrypoint: docker run --entrypoint /app/daily-solitaire ...
ENTRYPOINT ["/usr/local/bin/litestream"]
CMD ["replicate", "-config", "/etc/litestream.yml", "-exec", "/app/daily-solitaire"]
