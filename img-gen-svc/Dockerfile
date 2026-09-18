# Build stage.
FROM golang:1.25-alpine AS builder

RUN apk add --no-cache ca-certificates

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o server ./cmd/server

# Non-root user for the runtime stage. scratch has no useradd/adduser, so the
# passwd/group entries and the pre-owned cache directory are prepared here
# and copied over.
RUN addgroup -g 1000 appuser && \
    adduser -D -u 1000 -G appuser appuser && \
    mkdir -p /data/cache && \
    chown -R appuser:appuser /data

# Runtime stage: no shell, no package manager, nothing beyond the static
# binary and the few files it needs -- smallest possible attack surface.
FROM scratch

COPY --from=builder /etc/passwd /etc/passwd
COPY --from=builder /etc/group /etc/group
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=builder --chown=appuser:appuser /data /data
COPY --from=builder /build/server /app/server

USER appuser

ENV PORT=8080 \
    CACHE_DIR=/data/cache

EXPOSE 8080

VOLUME ["/data/cache"]

ENTRYPOINT ["/app/server"]
