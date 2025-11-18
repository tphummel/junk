# Build stage
FROM golang:1.25-alpine AS builder

# Install build dependencies for CGO (required by SQLite)
RUN apk add --no-cache gcc musl-dev

WORKDIR /build

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the binary
RUN CGO_ENABLED=1 GOOS=linux go build -o artifact-cache ./cmd/server

# Runtime stage
FROM alpine:latest

# Install ca-certificates for HTTPS requests
RUN apk --no-cache add ca-certificates

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/artifact-cache .

# Create data directory
RUN mkdir -p /data/cache

# Expose ports
EXPOSE 8080 9090

# Run as non-root user
RUN adduser -D -u 1000 appuser && \
    chown -R appuser:appuser /app /data
USER appuser

CMD ["./artifact-cache"]
