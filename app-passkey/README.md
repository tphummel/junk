# app-passkey

A self-sovereign, passwordless identity service: [WebAuthn](https://webauthn.guide/) passkeys for
login, offline Argon2-hashed recovery codes as the only fallback, no email or password anywhere.
See [app-passkey-design-doc.md](./app-passkey-design-doc.md) for the full spec this implements.

## Requirements

- Go 1.25 (managed via asdf, see `.tool-versions`)
- CGO toolchain (`gcc`) -- `github.com/mattn/go-sqlite3` needs it

## Development

```bash
# Run tests
CGO_ENABLED=1 go test ./...

# Run go vet
CGO_ENABLED=1 go vet ./...

# Run the server locally
DATABASE_PATH=./data/app-passkey.db SESSION_SECRET=dev-secret \
  CGO_ENABLED=1 go run ./cmd/server
```

Then visit `http://localhost:8080`. Passkeys require either `localhost` or an HTTPS origin, so
local development works out of the box against `http://localhost:8080` (browsers treat `localhost`
as a secure context).

## Configuration

| Variable | Default | Description |
|----------|---------|--------------|
| `PORT` | 8080 | HTTP server port |
| `DATABASE_PATH` | /data/app-passkey.db | SQLite database path |
| `LOG_LEVEL` | info | Logging level (debug, info, warn, error) |
| `RP_ID` | localhost | WebAuthn Relying Party ID (the effective domain) |
| `RP_DISPLAY_NAME` | app-passkey | WebAuthn Relying Party display name |
| `RP_ORIGINS` | http://localhost:8080 | Comma-separated list of allowed origins |
| `SESSION_SECRET` | (generated) | HMAC secret signing session cookies; set this in production or sessions won't survive a restart |

## Project Structure

```
app-passkey/
├── cmd/
│   └── server/              # Main entry point
├── internal/
│   ├── auth/                # WebAuthn ceremonies, sessions, recovery orchestration
│   ├── config/               # Environment-driven configuration
│   ├── db/                   # SQLite schema and queries (users, credentials, recovery codes, challenges)
│   ├── handlers/              # HTTP routes, pages, and the vanilla-JS frontend
│   │   └── web/                 # Templates and static assets (embedded into the binary)
│   ├── recoverycode/          # Recovery code generation and Argon2 hashing
│   └── session/                # Signed, stateless session cookies
└── app-passkey-design-doc.md
```

## Pages & API

- `GET /`, `/signup`, `/login`, `/recovery` -- public pages
- `GET /home` -- protected: "You are logged in" + username
- `GET /keys` -- protected: security dashboard (add / label / revoke passkeys)
- `GET /admin` -- protected: all users, their key counts, and account creation dates
- `POST /api/signup/begin`, `/api/signup/finish`, `/api/signup/confirm`
- `POST /api/login/begin`, `/api/login/finish`
- `POST /api/logout`
- `POST /api/recovery/begin`, `/api/recovery/finish`
- `GET /api/keys`, `POST /api/keys/begin`, `POST /api/keys/finish`, `PATCH /api/keys/{id}`, `DELETE /api/keys/{id}`
- `GET /healthz`

## Testing

- **Unit tests** (`internal/recoverycode`, `internal/session`, `internal/config`): pure logic, no I/O.
- **Integration tests** (`internal/db`): full CRUD cycle against a real (temp-file) SQLite database.
- **Auth flow tests** (`internal/auth`, `internal/handlers`): drive complete WebAuthn ceremonies --
  signup, login, add-key, and recovery -- through the real `go-webauthn` server using
  [`github.com/descope/virtualwebauthn`](https://github.com/descope/virtualwebauthn) as a mock
  authenticator, exactly as described in the design doc's "no-mock" integration testing approach.
  The `internal/handlers` suite additionally drives the same flows through the real HTTP mux with a
  cookie jar, exercising the challenge/session cookie plumbing end to end.

Run everything with `CGO_ENABLED=1 go test ./...`.

## Docker

```bash
docker build -t app-passkey:latest .

docker run -d \
  -p 8080:8080 \
  -v $(pwd)/data:/data \
  -e SESSION_SECRET=change-me \
  -e RP_ID=passkey.example.com \
  -e RP_ORIGINS=https://passkey.example.com \
  --name app-passkey \
  app-passkey:latest
```

Images are automatically built and pushed to `ghcr.io` on every push to `main` and on tagged
releases (see `.github/workflows/app-passkey.yml`), after the test suite passes.
