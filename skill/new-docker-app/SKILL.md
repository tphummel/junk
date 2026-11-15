---
name: new-docker-app
description: Build a homelab server app in its own junk subdirectory that produces a Docker image (PHP/FrankenPHP or Go, with SQLite state, health endpoints, and a GHCR build workflow). Use when asked to create a self-hosted tool, service, or container app, not for static pages or Worker APIs.
metadata:
  version: "1.0.0"
---

# New Docker app

For apps that run in a container with their own state. Static pages and Worker APIs use the [`new-web-experiment`](../new-web-experiment/SKILL.md) and [`new-api-experiment`](../new-api-experiment/SKILL.md) skills instead (deployed per [ADR 0005](../../adr/0005-web-api-deployment.md)). Reference apps: [`jigseer/`](../../jigseer/README.md) (PHP) and [`artifact-cache/`](../../artifact-cache/README.md) (Go, with a [design doc](../../artifact-cache/artifact-cache-design-doc.md)).

## Principles

1. **Self-contained container, TLS outside.** Ship a Dockerfile; run behind a reverse proxy. Disable HTTPS inside the container (jigseer: `auto_https off`) and document the Caddy block to paste.
2. **SQLite is the default store**, at a path an environment variable can override (`JIGSEER_DB_PATH`, `DATABASE_PATH`) so a volume can hold it.
3. **Health first.** `/health` before UI polish. Go apps also expose Prometheus `/metrics` on a separate port.
4. **Operations before features.** Export or download of the data, checksums, and stats before filtering, uploads, or automatic eviction.
5. **Data stays local.** Work with no upstream services. Document volumes and backups before any cloud option.
6. **Reproducible local dev.** The README leads with the run and test commands.

## Steps

1. **Folder and branch.** A new top-level folder named for the app, following the "Starting a new investigation" workflow in [AGENTS.md](../../AGENTS.md): `notes.md` while working, `README.md` at the end. This is not `web/` or `api/`.
2. **Write the contract first** (a short design brief in the README or a design doc): goals, non-goals, what persists and where, how an operator overrides paths and ports.
3. **Pick the stack.**
   - **PHP** for server-rendered forms and quick templating. Reuse jigseer's structure.
   - **Go** for API or streaming work, concurrent downloads, checksums, or metrics. Reuse artifact-cache's layering.
4. **Build it** using the matching pattern below.
5. **Dockerfile** (patterns below). Run it locally: `docker build -t <name> <name>/ && docker run --rm -p 8080:8080 -v <name>-data:/data <name>`.
6. **README:** what it is, `docker build` and `docker run`, environment variables, volumes, the proxy stanza, local test commands, what is not implemented.
7. **Workflow** `.github/workflows/<name>.yml`, copied from [`sworn.yml`](../../.github/workflows/sworn.yml) as [ADR 0006](../../adr/0006-docker-image-projects.md) says: a `test` job, then `build-and-push` to `ghcr.io/<owner>/<name>`, tagged by `docker/metadata-action` (`main`, PR, semver, SHA). PRs build without pushing. Release with a `v1.2.3` tag. Change the name, paths, image name and test steps.
8. **PR.** Confirm the workflow built the image.

## PHP / FrankenPHP pattern (jigseer)

- Base image `dunglas/frankenphp` (pinned, alpine), run with `frankenphp run --config /app/Caddyfile`, so static files, PHP and compression are one process.
- Caddyfile: `auto_https off`, `admin off`, listen on `:8080`, `php_server` and `file_server` over `public/`.
- One `Application` class routes to server-rendered templates in `templates/`. State changes are POST then redirect; SSE nudges clients to refresh.
- SQLite via PDO at `var/database.sqlite`, created on first run; `var/` owned by `www-data`.
- `COPY` only what runs (`Caddyfile`, `public/`, `src/`, `templates/`).
- Tests: an assertion script (`php tests/run.php`), not a framework.

## Go pattern (artifact-cache)

- Configuration from environment variables with defaults; structured JSON logs (`slog`); log the key settings at startup.
- Packages under `internal/`: `config`, `cache` (domain logic), `db`, `fetcher`, `handlers` (thin HTTP adapters), `metrics`; entry point `cmd/server`.
- Two `http.Server`s in one binary: the API, and `/metrics` on `METRICS_PORT`, so scraping cannot block requests.
- Multi-stage Dockerfile: `golang:<version>-alpine` builder (add `gcc musl-dev`, build with `CGO_ENABLED=1` when using SQLite via cgo), then a small `alpine` runtime with `ca-certificates`.
- Run as a non-root user (UID 1000); data directories (`/data/...`) are volumes.
- Tests: `go test ./...`.

## Checklist

- [ ] Contract written: persistence, paths, overrides.
- [ ] `/health` works in the container.
- [ ] An export, download, or stats path exists.
- [ ] Non-root user; state under a volume path.
- [ ] README has build, run, env vars, proxy stanza, test commands.
- [ ] Workflow tests, builds on PRs, and pushes to GHCR on `main` and `v*` tags.
- [ ] Only the app's folder and workflow are committed.
