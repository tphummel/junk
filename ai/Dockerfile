# Build stage
FROM golang:1.25-alpine AS builder

# CGO toolchain for mattn/go-sqlite3
RUN apk add --no-cache gcc musl-dev

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# sqlite_fts5 enables the FTS5 extension used for venue search
RUN CGO_ENABLED=1 GOOS=linux go build -tags sqlite_fts5 -ldflags="-s -w" -o venuecheck ./cmd/venuecheck

# Runtime stage
FROM alpine:3.22

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

COPY --from=builder /build/venuecheck /usr/local/bin/venuecheck

RUN mkdir -p /data/tiles /data/backup && \
    adduser -D -u 1000 appuser && \
    chown -R appuser:appuser /data
USER appuser

ENV DATA_DIR=/data \
    PORT=8080 \
    BIND=0.0.0.0

EXPOSE 8080

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD ["venuecheck", "-healthcheck"]

ENTRYPOINT ["venuecheck"]
