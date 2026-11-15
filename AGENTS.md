# Agent instructions

Two kinds of work happen here. Use the section that matches the task.

## Site and API work (`web/`, `api/`)

- Work on a branch and open a PR. Don't push to `main`.
- Use the skill for the task, and read the ADR it cites (the rules for this code; index in [`adr/`](adr/README.md)).
  - New static experiment: [`new-web-experiment`](skill/new-web-experiment/SKILL.md) ([0003](adr/0003-web-experiments.md)).
  - New API route: [`new-api-experiment`](skill/new-api-experiment/SKILL.md) ([0004](adr/0004-api-experiments.md)).
  - No build step in `web/`: [0002](adr/0002-no-web-build-step.md). Colors and light/dark mode: [0001](adr/0001-web-styling.md) and the [`golden-angle-styling` skill](skill/golden-angle-styling/SKILL.md).
- Don't create a project folder or `notes.md` for this work.
- Everything in `web/` is public and served as-is. Put no tests, notes or secrets in it.
- Before pushing: `npm run types && npm run typecheck && npm test`.
- Commit only the files for your change. Leave unrelated uncommitted files alone.
- Parallel sessions will conflict in two registries, the list in `web/index.html` and the routes in `api/index.ts`. Resolve by keeping both entries.
- Don't edit an accepted ADR's decision. Add a new ADR that supersedes it.

## Experiments and investigations (a new project folder)

Start by creating a new folder with an appropriate name, and work only in it. For a server app that ships as a Docker image, also follow the [`new-docker-app`](skill/new-docker-app/SKILL.md) skill.

- Create `notes.md` and append to it as you work: what you tried and what you learned.
- Write a `README.md` report at the end.
- The final commit contains just that folder, and in it only:
  - `notes.md` and `README.md`.
  - Any code you wrote.
  - If you modified an existing repo you checked out, the `git diff` against it saved as a file (not a copy of the repo).
  - Binary files you created, if useful and under 2 MB.
- Don't include full copies of code you fetched. Include only new files, or diffs showing your changes to existing code.
