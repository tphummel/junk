# 0006: How Docker image projects are built and published

- Status: Accepted
- Date: 2026-11-14

## Context

Several top-level projects (`app-passkey`, `artifact-cache`, `jigseer`, `sworn`, `trail-check`, `lab_gear` and others) are server apps published as images at `ghcr.io/tphummel/<name>`. Their workflows come in three styles: `docker/metadata-action` tags with a test job first (`artifact-cache`, `app-passkey`, `sworn`, `trail-check`, `lab_gear`), plain `latest` plus commit SHA (`jigseer`, `face-analysis`), and date plus SHA with `docker build` (`rps`, `fast-note`). New projects should use one style. This ADR covers building and publishing; how images are run is outside this repo.

## Decision

1. **Layout.** One top-level folder per project with a `Dockerfile` at its root and a `README.md`, and one workflow `.github/workflows/<name>.yml`. The image is `ghcr.io/<owner>/<name>`, built from the folder.
2. **Workflow.** Copy [`sworn.yml`](../.github/workflows/sworn.yml) and change the name, paths, image name and test steps.
   - It runs on pushes to `main`, `v*` tags and PRs to `main`, filtered to `<name>/**` and the workflow file.
   - A `test` job must pass before the image is built.
   - PRs build without pushing; pushes to `main` and `v*` tags push, authenticating with `GITHUB_TOKEN` (`packages: write`) and no other secrets.
3. **Tags** come from `docker/metadata-action`: the branch name (so `main`), `pr-<n>`, semver (`1.2.3`, `1.2`, `1`) for `v*` tags, and the commit SHA. A release is a `v1.2.3` tag. There is no `latest`.
4. **Dockerfile:** pinned base images, a multi-stage build when there is a compile step, a non-root user, and state under an overridable volume path. Details are in the [`new-docker-app` skill](../skill/new-docker-app/SKILL.md).
5. **No deploy from this repo.** Publishing the image ends the workflow.
6. **Existing workflows** change to this style only when next touched for another reason.

## Consequences

- Every image has a traceable SHA tag, and releases have semver tags, with no manual tagging.
- A failing test stops the image from being published.
- Each project carries a copy of about 70 lines of workflow.
- With no `latest`, consumers pin `main`, a version or a SHA.
- Two older styles remain for now.

## Alternatives considered

- **`latest` plus SHA** (`jigseer`, `face-analysis`). Simpler, but no release versions and a silently moving tag.
- **Date plus SHA with plain `docker build`** (`rps`, `fast-note`). No cache and no PR build.
- **A reusable workflow shared by all projects.** Less duplication, but couples unrelated projects; deferred.
- **Deploying from the workflow.** Needs credentials for a private network, and there is no common target.

## Open

Whether images are public or private on GHCR, and how the homelab picks up new images.
