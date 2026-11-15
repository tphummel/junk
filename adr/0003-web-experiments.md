# 0003: How web experiments are built

- Status: Accepted
- Date: 2026-11-14

## Context

`web/` holds many small, unrelated experiments served at `https://junk.tomhummel.com/<name>/`, written by different people and agent sessions, some migrated from tomhummel.com. [ADR 0002](0002-no-web-build-step.md) says there is no build step and [ADR 0001](0001-web-styling.md) says how they are colored. This ADR records the structure that the first experiments (`math-game`, `card-shuffle-svelte`, `golden-angle-palette`) established, so new ones match.

## Decision

1. **One directory per experiment.** `web/<name>/index.html`, with `<name>` in lowercase kebab-case. It is served at `/<name>/`; Workers redirects `/<name>` to the trailing-slash URL.
2. **Self-contained.** Everything an experiment needs (its scripts, modules, data, images) is in its own directory. An experiment does not import from another experiment's directory, and there is no shared layout, navigation or stylesheet.
3. **Paths.** Reference the experiment's own files with relative paths (`App.svelte`, `./palette.js`) so they resolve under `/<name>/`. Link to other pages and APIs with root-absolute paths (`/api/<name>/...`).
4. **Page basics.** `<!doctype html>`, `<meta charset="utf-8">`, a viewport meta tag, and a `<title>` naming the experiment. Colors and light/dark mode follow ADR 0001.
5. **Public by construction.** Everything under `web/` is served. Do not put tests, notes, drafts or secrets in it. Tests live in `api/` (see ADR 0004); documentation lives in the PR and the ADRs.
6. **Register it.** Add one `<li>` to the list in `web/index.html`, in alphabetical order by name. If the experiment has an API, add an `(api)` link beside it. The list is hand-maintained.
7. **An experiment with an API** uses the same `<name>` for `web/<name>/` and `api/<name>.ts`, and calls it with same-origin paths. Logic shared with the API is a plain ES module inside `web/<name>/` that `api/<name>.ts` imports (ADR 0002).
8. **Migrating from the blog** (`tphummel/blog`, `static/<name>/`). Copy the files unchanged, then make only the changes needed to work here: remove references to files that never existed, make self-links relative or root-absolute as above. State each deviation in the commit message. Redirects from `tomhummel.com/<name>` are configured in Cloudflare, not in this repo, and only after the new URL works.
9. **Check before merging.** Open the PR's preview (`https://<branch>.junk.tomhummel.com/<name>/`), exercise the page, and view it in both light and dark mode.

## Consequences

- An experiment can be added, moved or deleted without touching any other, apart from the one-line index entry.
- Experiments repeat some boilerplate; that is accepted.
- `web/index.html` is a registry that parallel sessions will conflict on; the resolution is to keep both entries.
- The index is not generated, so a forgotten entry means an unlisted (but reachable) experiment. Nothing checks it.
- No automated tests cover pages themselves; only logic shared with an API is tested.

## Alternatives considered

- **A generated index.** Would remove the conflicts but needs a build step (ADR 0002).
- **A shared layout and stylesheet.** Consistent, but couples experiments and conflicts with ADR 0001's one-palette-per-experiment idea.
- **A README or notes file per experiment inside `web/<name>/`.** It would be served publicly and clutter the site.

## Open

Whether the index should ever be generated, and whether migrated experiments get palettes, are left to future ADRs.
