# Build stage
FROM golang:1.25-alpine AS builder

# Install build dependencies for CGO (required by mattn/go-sqlite3)
RUN apk add --no-cache gcc musl-dev

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=1 GOOS=linux go build -o app-passkey ./cmd/server

# Runtime stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /app

COPY --from=builder /build/app-passkey .

RUN mkdir -p /data && \
    adduser -D -u 1000 appuser && \
    chown -R appuser:appuser /app /data
USER appuser

ENV DATABASE_PATH=/data/app-passkey.db \
    PORT=8080

EXPOSE 8080

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD ["/app/app-passkey", "-healthcheck"]

CMD ["./app-passkey"]
