# Jigseer

Jigseer is a lightweight FrankenPHP application for tracking collaborative jigsaw puzzle progress. The service is designed to run next to a physical puzzle and keeps track of player "hits" as connections are made.

## Development

```bash
php -S 0.0.0.0:8080 -t public
```

The built-in development server will serve the application on port 8080.

## Docker

A Dockerfile based on the official FrankenPHP image is provided. To build the container locally:

```bash
docker build -t jigseer:local jigseer
```

Run the container:

```bash
docker run --rm -p 8080:8080 jigseer:local
```

The embedded Caddy server has automatic HTTPS disabled so it can sit behind infrastructure that provides TLS termination.

## Testing

A lightweight test harness is included. Run it with:

```bash
php tests/run.php
```

## Database

Jigseer stores data in SQLite. The default database path is `var/database.sqlite` relative to the project root. The database file and containing directory will be created automatically when the application first runs.

