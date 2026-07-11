# Notes

- Created new project folder `http-client-web` per repo AGENTS instructions.
- Need to inspect existing CI workflow patterns for GHCR publish on changes to a specific subdir on `main`.
- Collected initial requirements from user: client-only HTTP tool, local storage config import/export, request builder, send/save behavior, audit log for last 1000 requests with response details.
- Reviewed existing workflows `.github/workflows/fast-note.yml` and `.github/workflows/jigseer.yml` to mirror path-based build/publish triggers and image tag strategy.
- User confirmed stack direction: Svelte + TypeScript.
- User requested Apache/httpd runtime for smallest practical static-serving image.
- User wants multiple named request configs persisted in browser storage.
- Updated planning doc with concrete decisions and proposed candidate project names under ghcr.io/tphummel/<name>.
- User selected final project name: `http-rocket`.
- Renamed project directory from `http-client-web` to `http-rocket`.
- Added Svelte + TypeScript + Vite scaffold files.
- Added Apache httpd multi-stage Dockerfile for static asset serving.
