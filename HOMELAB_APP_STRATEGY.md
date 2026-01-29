# Homelab App Strategy (PHP + Go)

This document distills the patterns used in the `jigseer` FrankenPHP/Caddy app and the Go-based `artifact-cache` service so future tools can be built with the same priorities.

## Reference Implementations at a Glance

| Project | Runtime | Purpose | Highlights |
| --- | --- | --- | --- |
| `jigseer/` | PHP 8.2 on FrankenPHP + embedded Caddy | Track collaborative jigsaw progress on phones/tablets next to the puzzle | Server-rendered tabs for play/leaderboard/transcript/settings, admin DB browser/export, SSE updates, SQLite persistence, Fly.io-ready container image. | 
| `artifact-cache/` | Go 1.25 single binary + Prometheus metrics sidecar | Resilient cache for HTTP-downloadable artifacts in a homelab | Content-addressed storage, checksum enforcement, SQLite metadata, dual HTTP + metrics servers, extensive design spec, Docker image with non-root runtime. |

【F:jigseer/README.md†L3-L47】【F:artifact-cache/README.md†L1-L99】【F:artifact-cache/cmd/server/main.go†L23-L131】【F:artifact-cache/Dockerfile†L1-L41】

## Shared DNA Between the Apps

1. **Self-contained deployments.** Both apps ship with Dockerfiles and expect to sit behind the same Caddy reverse proxy pattern (FrankenPHP bundles Caddy; artifact-cache documents an external Caddy block). This keeps TLS and routing concerns out of the app logic and lets containers run with simple `docker run` invocations.【F:jigseer/README.md†L29-L119】【F:jigseer/Caddyfile†L1-L10】【F:artifact-cache/README.md†L101-L153】
2. **SQLite as the default state store.** Each app favors SQLite for easy backups and zero extra infrastructure. Jigseer stores puzzle metadata/hits locally so it can run offline; artifact-cache keeps metadata in SQLite while blobs live on disk, prioritizing simplicity over heavier databases.【F:jigseer/README.md†L24-L57】【F:artifact-cache/README.md†L8-L15】【F:artifact-cache/artifact-cache-design-doc.md†L31-L94】
3. **Operational clarity first.** Health endpoints (`/status`, `/health`, `/metrics`) ship before advanced UX. Artifact-cache adds Prometheus metrics and structured logging, while Jigseer exposes `/health` with DB status and Fly environment metadata to aid Fly.io orchestration.【F:jigseer/README.md†L59-L63】【F:jigseer/src/Application.php†L36-L125】【F:artifact-cache/README.md†L79-L84】【F:artifact-cache/internal/metrics/metrics.go†L9-L77】
4. **Offline-friendly + admin tooling.** Jigseer includes an admin dashboard and DB download/export options; artifact-cache focuses on long-term caching with manual control over storage via SQLite plus file system deduplication. Both emphasize retaining data locally rather than depending on upstream services.【F:jigseer/src/Application.php†L137-L451】【F:artifact-cache/internal/cache/cache.go†L37-L142】【F:artifact-cache/artifact-cache-design-doc.md†L31-L70】
5. **Reproducible local development.** Each README leads with local dev/test commands (built-in PHP server with custom DB path for Jigseer; `asdf exec go test`/`go run` for artifact-cache) so contributors can reproduce behavior without bespoke tooling.【F:jigseer/README.md†L64-L87】【F:artifact-cache/README.md†L22-L64】

## What Was Prioritized Over Other Features

- **Operational simplicity over breadth.** The artifact-cache design explicitly chooses SQLite + a single binary over microservices, and Jigseer’s README lists unimplemented niceties (sorting, image uploads) to highlight that a reliable baseline shipped first.【F:artifact-cache/artifact-cache-design-doc.md†L31-L44】【F:jigseer/README.md†L24-L28】
- **Resilience/offline guarantees.** Both apps default to local persistence and document backup/volume practices before talking about optional cloud features (Fly volume mount for Jigseer; artifact-cache framing as homelab infrastructure during outages).【F:jigseer/README.md†L24-L27】【F:jigseer/README.md†L103-L126】【F:artifact-cache/README.md†L1-L20】【F:artifact-cache/artifact-cache-design-doc.md†L33-L70】
- **Transparent operations + observability.** Artifact-cache dedicates large sections to Prometheus metrics, Grafana queries, and JSON logging examples, while Jigseer bakes environment metadata into `/health` and uses SSE to nudge clients rather than relying on opaque background processes. This favors debuggability over UI flourish.【F:artifact-cache/artifact-cache-design-doc.md†L31-L165】【F:artifact-cache/artifact-cache-design-doc.md†L681-L780】【F:jigseer/src/Application.php†L220-L355】
- **Admin/maintenance features before automation.** Jigseer implements CSV/ZIP exports, DB download, transcript deletion, and puzzle destruction flow instead of background jobs. Artifact-cache includes checksum conflict handling and manual cache stats before automated eviction. These guardrails were prioritized ahead of speculative features like advanced filtering or scheduling.【F:jigseer/src/Application.php†L137-L451】【F:artifact-cache/internal/cache/cache.go†L37-L142】【F:artifact-cache/internal/handlers/handlers.go†L39-L172】

## Implementation Playbooks

### PHP/FrankenPHP pattern

1. **Bundle PHP runtime with Caddy.** Use the FrankenPHP base image, copy only runtime assets, and run `frankenphp run --config Caddyfile` so static assets, PHP execution, and compression are handled uniformly inside the container.【F:jigseer/Dockerfile†L1-L16】【F:jigseer/Caddyfile†L1-L10】
2. **Lean server-rendered flows + SSE.** Route everything through a single `Application` class, dispatching to tab-specific templates and SSE endpoints. Favor POST redirects + server-rendered HTML for state changes so mobile devices remain stateless and easy to test.【F:jigseer/src/Application.php†L23-L375】
3. **SQLite-first bootstrap.** Auto-create the DB under `/app/var`, but allow overriding via `JIGSEER_DB_PATH` for deployments (Fly volume mount instructions highlight this).【F:jigseer/README.md†L57-L76】【F:jigseer/Dockerfile†L5-L16】
4. **Operational utilities in-app.** Provide admin listings, downloads, and CSV/ZIP export code paths before building APIs. This matches the expectation that a single operator might be interacting from the device hosting the service.【F:jigseer/src/Application.php†L137-L451】
5. **Testing via lightweight harness.** Rely on assertion-based scripts (`php tests/run.php`) instead of heavyweight frameworks to keep onboarding friction low while still validating DB workflows.【F:jigseer/README.md†L78-L87】

### Go single-binary pattern

1. **Bootstrap via config + slog.** Load env-based config, set up a JSON logger, and announce key settings at startup for traceability. This keeps runtime choices visible without extra tooling.【F:artifact-cache/cmd/server/main.go†L23-L67】【F:artifact-cache/README.md†L65-L77】
2. **Compose internal packages around cache/db/fetch/metrics.** The cache orchestrator handles hit/miss logic, checksum enforcement, storage writes, and metadata updates in one place, while handlers stay thin HTTP adapters.【F:artifact-cache/internal/cache/cache.go†L37-L142】【F:artifact-cache/internal/handlers/handlers.go†L39-L172】
3. **Expose metrics & dual servers.** Run the main API and Prometheus `/metrics` endpoint on separate `http.Server` instances so scraping cannot block artifact fetches. Record hit/miss/error counters + histograms for latency/size.【F:artifact-cache/cmd/server/main.go†L71-L131】【F:artifact-cache/internal/metrics/metrics.go†L9-L77】
4. **Container builds with CGO + non-root runtime.** Multi-stage Dockerfile compiles with CGO for SQLite, installs CA certs, and runs as UID 1000 with dedicated data directories exposed as volumes.【F:artifact-cache/Dockerfile†L1-L41】
5. **Homelab-focused documentation.** Keep design specs close to code (the `artifact-cache-design-doc.md` covers requirements, architecture, observability, and deployment) so future contributors can reason about trade-offs without guesswork.【F:artifact-cache/artifact-cache-design-doc.md†L25-L780】

## Checklist for New Apps Built “This Way”

1. **Define the offline-first contract.** Document what data must persist locally, the default storage path, and how operators can override it before building UI features.【F:jigseer/README.md†L24-L76】【F:artifact-cache/artifact-cache-design-doc.md†L31-L94】
2. **Decide on runtime integration with Caddy or single binary.** For PHP, rely on embedded Caddy; for Go, describe the reverse proxy in docs and keep TLS termination out of the app. Either way, publish the Caddy stanza operators should paste in.【F:jigseer/Caddyfile†L1-L10】【F:artifact-cache/README.md†L139-L153】
3. **Ship health/metrics endpoints early.** Expose at least `/health` and, for Go services, `/metrics` with Prometheus-compatible names so you can hook the app into Uptime Kuma/Grafana before launch.【F:jigseer/README.md†L59-L63】【F:artifact-cache/README.md†L79-L84】【F:artifact-cache/artifact-cache-design-doc.md†L681-L780】
4. **Bake in admin/maintenance flows.** Provide CSV/JSON exports, database downloads, or stats endpoints prior to user-facing niceties. This ensures data can be audited/backed up even if UI work stalls.【F:jigseer/src/Application.php†L137-L451】【F:artifact-cache/internal/cache/cache.go†L37-L142】
5. **Document docker + local dev parity.** Include `docker build/run` snippets and lightweight local testing commands in the README so contributors can exercise the same paths as CI/CD.【F:jigseer/README.md†L90-L119】【F:artifact-cache/README.md†L101-L137】
6. **Capture design intent in-repo.** Mirroring the artifact-cache design doc keeps priority trade-offs explicit. Add a similar markdown brief outlining goals, non-goals, and operational expectations whenever you start a new app.【F:artifact-cache/artifact-cache-design-doc.md†L25-L780】

## Choosing Between Go and PHP for Future Apps

- **Pick PHP (FrankenPHP) when** you need rapid server-rendered flows, templating, or a tight loop with HTML forms, and can reuse the Jigseer routing + SSE template structure. Its runtime already handles SQLite and static assets without extra services.【F:jigseer/src/Application.php†L23-L375】【F:jigseer/Dockerfile†L1-L16】
- **Pick Go when** the workload is API/stream heavy, needs concurrent downloads, checksum validation, or Prometheus integration out of the box. The artifact-cache layering (config → cache → handlers → metrics) is a ready-made skeleton for such services.【F:artifact-cache/cmd/server/main.go†L23-L131】【F:artifact-cache/internal/cache/cache.go†L37-L142】【F:artifact-cache/internal/metrics/metrics.go†L9-L77】

Regardless of language, stay anchored to the principles above—self-contained deployments, SQLite-backed durability, observable operations, and admin-friendly tooling—so new apps slot cleanly into the same homelab ecosystem.
