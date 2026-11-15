# Homelab app strategy (PHP and Go)

Patterns from two server apps, so new homelab tools follow the same priorities. This is for apps that run in a container with their own state. Static pages and Worker APIs follow the [ADRs](adr/README.md) instead.

## Reference apps

| Project | Stack | Purpose |
| --- | --- | --- |
| [`jigseer/`](jigseer/README.md) | PHP 8.2 on FrankenPHP (embedded Caddy), SQLite via PDO | Track collaborative jigsaw progress from phones next to the puzzle. Server-rendered tabs, live updates over SSE, an admin panel with database download, JSON export. Has a `fly.toml`. |
| [`artifact-cache/`](artifact-cache/README.md) | Go 1.25, one binary, SQLite metadata plus blobs on disk | Cache for HTTP-downloadable artifacts in a homelab. Content-addressed storage, SHA256 verification, Prometheus metrics, [design doc](artifact-cache/artifact-cache-design-doc.md). |

## Principles

1. **Self-contained container, TLS outside.** Each ships a Dockerfile and sits behind a reverse proxy. Jigseer disables HTTPS inside the container; artifact-cache documents the Caddy block to paste.
2. **SQLite is the default store.** Easy to back up, no extra service. The path is overridable (`JIGSEER_DB_PATH`, `DATABASE_PATH`) so a volume can hold it.
3. **Health endpoints first.** Jigseer has `/status` and `/health`; artifact-cache has `/health` and `/metrics`. Ship them before UI polish.
4. **Operations before features.** Admin export and download, checksum checks and cache stats came before filtering, uploads or automated eviction. Jigseer's README lists what is not implemented yet.
5. **Data stays local.** Both work without upstream services, and document backups and volumes before any cloud option.
6. **Reproducible local dev.** The README leads with the run and test commands (`php tests/run.php`; `asdf exec go test ./...`).

## PHP / FrankenPHP pattern (`jigseer/`)

- Base image `dunglas/frankenphp`, run with `frankenphp run --config /app/Caddyfile`, so static files, PHP and compression are one process.
- One `Application` class (`src/Application.php`) routes to server-rendered templates in `templates/`. State changes are POST plus redirect; SSE nudges clients to refresh.
- The SQLite file defaults to `var/database.sqlite`, created on first run.
- Tests are an assertion script, `tests/run.php`, not a framework.

## Go pattern (`artifact-cache/`)

- Configuration from environment variables, with structured JSON logging (`slog`) and the key settings logged at startup.
- Packages under `internal/`: `config`, `cache` (hit/miss, checksum, storage, metadata), `db`, `fetcher`, `handlers` (thin HTTP adapters), `metrics`.
- Two `http.Server`s in one binary: the API, and Prometheus `/metrics` on `METRICS_PORT`, so scraping cannot block fetches.
- Multi-stage Dockerfile built with `CGO_ENABLED=1` for SQLite, running as a non-root user (UID 1000) with data directories as volumes.

## Checklist for a new app

1. Write the offline contract first: what persists, where, and how an operator overrides the path.
2. Decide the proxy story and publish the Caddy stanza.
3. Add `/health` (and `/metrics` for Go) before launch.
4. Add an export, download or stats path before user-facing niceties.
5. Put `docker build` and `docker run` and the local test commands in the README.
6. Write a short design brief: goals, non-goals, operational expectations.

## PHP or Go

- **PHP** for server-rendered forms and quick templating; reuse jigseer's routing and SSE structure.
- **Go** for API or streaming work, concurrent downloads, checksums, or Prometheus out of the box; reuse artifact-cache's layering.
