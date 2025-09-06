# Fast Note

Fast Note is a tiny PHP web application for quickly sharing text snippets.
All notes are stored in a SQLite database and identified by a simple `note`
query parameter. No authentication is provided.

## Motivation and design trade-offs

Fast Note targets small, trusted networks where a quick shared scratch pad is useful.
To stay lightweight it intentionally omits user accounts, authentication and third-party
libraries. Anyone with access can read or overwrite any note and everything is persisted
in a single SQLite file.

## Running with Docker

```bash
# Build image
docker build -t fast-note .

# Run container with persistent storage
touch notes.sqlite
docker run -p 8080:8080 -v $(pwd)/notes.sqlite:/var/www/html/notes.sqlite --name fast-note fast-note
```

The application runs on port 8080 and includes Apache web server.

The application stores notes in `notes.sqlite`. The volume mount above ensures
the database survives container restarts.

### Configuration

Set the `FASTNOTE_DB` environment variable to override the database location
or to use special modes, for example:

```bash
FASTNOTE_DB="file:memdb1?mode=memory&cache=shared" php -S localhost:8000
```

This can be useful for ephemeral or test environments.
