# Agent instructions

Find the kind of work below and follow its section. Rules for every kind:

- Work on a branch and open a PR. Don't push to `main`.
- Commit only the files for your change. Leave unrelated uncommitted files alone.

| Kind | Where it lives | Start with |
| --- | --- | --- |
| Web experiment | `web/<name>/` | [`new-web-experiment`](skill/new-web-experiment/SKILL.md), [ADR 0003](adr/0003-web-experiments.md) |
| API route | `api/<name>.ts` | [`new-api-experiment`](skill/new-api-experiment/SKILL.md), [ADR 0004](adr/0004-api-experiments.md) |
| Docker app | its own top-level folder | [`new-docker-app`](skill/new-docker-app/SKILL.md), [ADR 0006](adr/0006-docker-image-projects.md) |
| Legacy or miscellaneous project | its own top-level folder | the folder's own README |

The ADRs in [`adr/`](adr/README.md) are the rules for `web/`, `api/` and Docker apps; deployment is [0005](adr/0005-web-api-deployment.md) (web and API) and [0006](adr/0006-docker-image-projects.md) (images). Don't edit an accepted ADR's decision; add a new ADR that supersedes it.

## Web and API (`web/`, `api/`)

- No build step in `web/`: [0002](adr/0002-no-web-build-step.md). Colors and light/dark mode: [0001](adr/0001-web-styling.md) and the [`golden-angle-styling` skill](skill/golden-angle-styling/SKILL.md).
- No project folder or `notes.md` for this work.
- Everything in `web/` is served as-is, so keep tests (in `api/`) and notes out of it.
- Before pushing: `npm run types && npm run typecheck && npm test`.
- Parallel sessions will conflict in two registries, the list in `web/index.html` and the routes in `api/index.ts`. Resolve by keeping both entries.

## Docker apps

A server app that ships as an image gets its own top-level folder, a README, and a workflow that builds and publishes the image ([0006](adr/0006-docker-image-projects.md)). Follow the [`new-docker-app`](skill/new-docker-app/SKILL.md) skill. Reference apps: `jigseer/` and `artifact-cache/`.

## Legacy and miscellaneous projects

The other top-level folders are older, unrelated projects. They have no common structure, language or tooling, and the rules above don't apply to them.

- Read the folder's `README.md` (and `notes.md` if present) and follow its conventions.
- Change only that folder, and its workflow in `.github/workflows/` if it has one.
- Don't restructure, migrate or add tooling (`npm`, ADR conventions, skills) unless asked.

### Starting a new investigation

For a one-off experiment or investigation that is not a web, API or Docker project, create a new folder with an appropriate name and work only in it.

- Create `notes.md` and append to it as you work: what you tried and what you learned.
- Write a `README.md` report at the end.
- The final commit contains just that folder, and in it only:
  - `notes.md` and `README.md`.
  - Any code you wrote.
  - If you modified an existing repo you checked out, the `git diff` against it saved as a file (not a copy of the repo).
  - Binary files you created, if useful and under 2 MB.
- Don't include full copies of code you fetched. Include only new files, or diffs showing your changes to existing code.
