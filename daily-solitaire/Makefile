.PHONY: build run test cover vet fmt docker-build docker-run seeds clean

VERSION ?= $(shell git describe --tags --always 2>/dev/null || echo dev)

build:
	CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o bin/daily-solitaire ./cmd/server
	CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o bin/admin ./cmd/admin
	CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o bin/solver ./cmd/solver

run:
	DATABASE_PATH=./data/app.db go run ./cmd/server

test:
	go test -race ./...

cover:
	go test -race -coverprofile=coverage.out -covermode=atomic ./...
	go tool cover -func=coverage.out | tail -1

vet:
	go vet ./...

fmt:
	gofmt -w .

# Produce the production seed pool (hours of CPU; run offline, keep the file private),
# then load it with: bin/admin load-seeds seed-pool.jsonl
seeds: build
	bin/solver -random -want 10000 -out seed-pool.jsonl

docker-build:
	docker build --build-arg VERSION=$(VERSION) -t daily-solitaire .

# Local container without replication.
docker-run:
	docker run --rm -p 8080:8080 -v $$PWD/data:/data --entrypoint /app/daily-solitaire daily-solitaire

clean:
	rm -rf bin/ coverage.out coverage.html
