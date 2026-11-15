# Agent instructions

Rules for every kind of work:

- Work on a branch and open a PR. Don't push to `main`.
- Commit only the files for your change. Leave unrelated uncommitted files alone.
- Check [`skill/`](skill/) for a skill that matches the task and follow it.
- Read the [ADRs](adr/README.md) that apply to what you change. They are the rules for this code. Don't edit an accepted ADR's decision; add a new ADR that supersedes it.

## Kinds of work

| Kind | Where it lives |
| --- | --- |
| Webpage | `web/<name>/` |
| API route | `api/<name>.ts` |
| Docker app | its own top-level folder |
| Legacy or miscellaneous project | its own top-level folder |

### Web and API (`web/`, `api/`)

- No project folder or `notes.md` for this work.
- Everything in `web/` is served as-is, so keep tests (in `api/`) and notes out of it.
- Before pushing: `npm run types && npm run typecheck && npm test`.
- Parallel sessions will conflict in two registries, the list in `web/index.html` and the routes in `api/index.ts`. Resolve by keeping both entries.

### Docker apps

A server app that ships as an image gets its own top-level folder, a README, and a workflow that builds and publishes the image.

### Legacy and miscellaneous projects

The other top-level folders are older, unrelated projects. They have no common structure, language or tooling, and the rules for the kinds above don't apply to them.

- Read the folder's `README.md` (and `notes.md` if present) and follow its conventions.
- Change only that folder, and its workflow in `.github/workflows/` if it has one.
- Don't restructure, migrate or add tooling unless asked.

### Everything else

For new work that doesn't fit any kind above, create a new folder with an appropriate name and work only in it.

- Create `notes.md` and append to it as you work: what you tried and what you learned.
- Write a `README.md` report at the end.
- The final commit contains just that folder, and in it only:
  - `notes.md` and `README.md`.
  - Any code you wrote.
  - If you modified an existing repo you checked out, the `git diff` against it saved as a file (not a copy of the repo).
  - Binary files you created, if useful and under 2 MB.
- Don't include full copies of code you fetched. Include only new files, or diffs showing your changes to existing code.
