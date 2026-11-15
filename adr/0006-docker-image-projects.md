# 0006: How Docker image projects are built and published

- Status: Accepted
- Date: 2026-11-14

## Context

Several top-level projects (`app-passkey`, `artifact-cache`, `jigseer`, `sworn`, `trail-check`, `lab_gear` and others) are server apps that ship as container images to `ghcr.io/tphummel/<name>`. Their workflows grew separately and now come in three styles: tags from `docker/metadata-action` with a test job first (`artifact-cache`, `app-passkey`, `sworn`, `trail-check`, `lab_gear`), a plain `latest` plus commit SHA (`jigseer`, `face-analysis`), and a date and SHA tag built with `docker build` (`rps`, `fast-note`). New projects should use one style. This ADR covers building and publishing the image; how it is run is outside this repo.

## Decision

1. **Layout.** One top-level folder per project with a `Dockerfile` at its root, a `README.md`, and one workflow `.github/workflows/<name>.yml`. The image is `ghcr.io/<owner>/<name>`, where `<name>` is the folder name. The build context is the folder.
2. **Workflow.** Copy [`sworn.yml`](../.github/workflows/sworn.yml) and change the name, paths, image name and test steps.
   - **Triggers:** push to `main`, push of `v*` tags, and pull requests to `main`, each filtered to `<name>/**` and the workflow file.
   - **Job `test`:** run the project's tests and linters. The image is not built unless they pass (`needs: test`).
   - **Job `build-and-push`:** `docker/setup-buildx-action`, `docker/login-action` to `ghcr.io` with `github.actor` and `GITHUB_TOKEN` (skipped on PRs), `docker/metadata-action`, then `docker/build-push-action` with `cache-from` and `cache-to` set to `type=gha`.
   - **Pull requests build and do not push.** Pushes to `main` and `v*` tags build and push.
   - **Permissions:** `contents: read` and `packages: write` on the job. No other secrets.
3. **Tags** come from `docker/metadata-action`: `type=ref,event=branch` (so `main`), `type=ref,event=pr`, `type=semver` (`{{version}}`, `{{major}}.{{minor}}`, `{{major}}`) for `v*` tags, and `type=sha`. A release is a `v1.2.3` tag. `main` is the moving development tag. `latest` is not used.
4. **Dockerfile.** Pin base image versions. Use a multi-stage build when there is a compile step. Run as a non-root user, keep state under a volume path with an environment variable to override it, and expose a health endpoint ([`new-docker-app` skill](../skill/new-docker-app/SKILL.md)).
5. **No deploy from this repo.** Publishing the image is the end of the workflow. Pulling and running it, and any restart, belong to the homelab's own tooling.
6. **Existing workflows are not rewritten** to match. They are changed to this style only when next touched for another reason.

## Consequences

- Every image gets a traceable SHA tag and, for releases, semver tags, with no manual tagging.
- A broken test or lint stops the image from being built and published.
- Each project carries a copy of the workflow. That duplicates about 70 lines but keeps projects independent, and a reusable workflow is a possible later step.
- `latest` does not exist, so consumers must pin `main`, a version, or a SHA.
- Two older styles remain in the repo for now.

## Alternatives considered

- **`latest` plus SHA, no metadata action** (`jigseer`, `face-analysis`). Simpler, but no release versions and a tag that moves silently.
- **Date and SHA tags with a plain `docker build`** (`rps`, `fast-note`). Readable, but no cache and no PR build.
- **A reusable workflow or a matrix over all projects.** Less duplication, but it couples unrelated projects; deferred.
- **Deploying from the workflow** (SSH, webhook). Needs credentials in GitHub for a private network, and there is no common target.

## Open

Whether images are public or private on GHCR, and how the homelab picks up new images, are not recorded in this repo and are left to the owner.
