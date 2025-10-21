# Jigseer

Jigseer is a FrankenPHP + Caddy application for tracking collaborative jigsaw puzzle progress. The service is designed to run on a phone or tablet next to an in-progress physical puzzle so everyone can record their contributions as connections are made.

## Feature overview

- **Puzzle lifecycle** – create a puzzle with an optional total piece count and receive a short code for revisiting it later.
- **Play tab (`/p/{id}/play`)** – mobile-friendly buttons for each active player sorted by most recent hit, overall progress tracking, and a reminder banner when the total piece count is unknown.
- **Leaderboard tab (`/p/{id}/leaderboard`)** – aggregate per-player hit counts with totals derived from the `hits` table.
- **Transcript tab (`/p/{id}/transcript`)** – most recent hit activity first so the team can review progress at a glance.
- **Settings tab (`/p/{id}/settings`)** – update the total piece count and add general notes about the puzzle.
- **SQLite persistence** – all puzzle metadata and hits are stored locally so the app can run offline.

The current implementation focuses on the server-rendered flows above. Query-string based sorting/filtering, transcript editing, and puzzle image uploads from the design brief are not yet implemented.

## Tech stack

- [FrankenPHP](https://frankenphp.dev/) runtime with the `dunglas/frankenphp:1.9.1-php8.2.29-alpine` base image.
- Embedded [Caddy](https://caddyserver.com/) server with automatic HTTPS disabled for easy behind-the-proxy deployments (see [`Caddyfile`](./Caddyfile)).
- Plain PHP 8.2 application code with lightweight HTTP/request/response helpers under [`src/`](./src).
- Server-side templates in [`templates/`](./templates) for each tab view.
- SQLite database accessed via PDO; the schema is auto-initialised on first run.

## Repository layout

```
jigseer/
├── Caddyfile          # FrankenPHP/Caddy runtime configuration
├── Dockerfile         # Container image definition
├── public/index.php   # Web entrypoint used by Caddy
├── src/               # Application, database layer, and bootstrap helpers
├── templates/         # Server-rendered HTML templates
├── tests/run.php      # Minimal PHPUnit-free test harness
└── var/               # Default location for the SQLite database (gitignored)
```

## Database schema

Two tables are maintained automatically:

- `puzzles` – puzzle id, name, optional `total_pieces`, optional `notes`, timestamps, and future `image_path` support.
- `hits` – puzzle foreign key, player name, `connection_count`, request IP, user-agent, and timestamps.

The default database lives at `var/database.sqlite`. Override with the `JIGSEER_DB_PATH` environment variable if you need to place the file elsewhere.

## Local development

Use the built-in PHP development server from the project root:

```bash
php -S 0.0.0.0:8080 -t public
```

By default the app will create `var/database.sqlite`. Set `JIGSEER_DB_PATH` before starting the server to use a different location:

```bash
JIGSEER_DB_PATH=/tmp/jigseer.sqlite php -S 0.0.0.0:8080 -t public
```

## Tests

A small assertion-based test harness verifies the main workflows:

```bash
php tests/run.php
```

The script bootstraps the application against temporary SQLite databases and will exit with a non-zero status on failure.

## Docker usage

Build and run the FrankenPHP image locally:

```bash
docker build -t jigseer:local jigseer
docker run --rm -p 8080:8080 jigseer:local
```

The container listens on port 8080 inside the image. Caddy serves static assets from `public/` and forwards dynamic requests to the PHP runtime. HTTPS is deliberately disabled in the container so it can sit behind an external TLS terminator.

## Continuous integration

The [`jigseer` GitHub Actions workflow](../.github/workflows/jigseer.yml) triggers on any change under `jigseer/`. It runs the test harness and, on pushes to the repository, builds and publishes a Docker image to GHCR tagged with both `latest` and the commit SHA.

## Deployment notes

- Ensure the container has write access to the mounted directory backing `JIGSEER_DB_PATH` (defaults to `/app/var`).
- Provide TLS termination outside the container if the app is exposed publicly.
- Backup the SQLite database regularly if puzzle history matters to your team.
