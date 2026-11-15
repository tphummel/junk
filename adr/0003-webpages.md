# 0003: How webpages are built

- Status: Accepted
- Date: 2026-11-14

## Context

`web/` holds many small, unrelated webpages served at `https://junk.tomhummel.com/<name>/`, written by different people and agent sessions, some migrated from tomhummel.com. [ADR 0002](0002-no-web-build-step.md) says there is no build step and [ADR 0001](0001-web-styling.md) says how they are colored. This ADR records the structure that the first webpages (`math-game`, `card-shuffle-svelte`, `golden-angle-palette`) established, so new ones match.

## Decision

1. **One directory per webpage.** `web/<name>/index.html`, with `<name>` in lowercase kebab-case. It is served at `/<name>/`; Workers redirects `/<name>` to the trailing-slash URL.
2. **Self-contained.** Everything a webpage needs (its scripts, modules, data, images) is in its own directory. A webpage does not import from another webpage's directory, and there is no shared layout, navigation or stylesheet.
3. **Paths.** Reference the webpage's own files with relative paths (`App.svelte`, `./palette.js`) so they resolve under `/<name>/`. Link to other pages and APIs with root-absolute paths (`/api/<name>/...`).
4. **Page basics.** `<!doctype html>`, `<meta charset="utf-8">`, a viewport meta tag, and a `<title>` naming the webpage. Colors and light/dark mode follow ADR 0001.
5. **Only served files.** Everything under `web/` is served as-is. Tests live in `api/` (see ADR 0004); documentation lives in the PR and the ADRs.
6. **Register it.** Add one `<li>` to the list in `web/index.html`, in alphabetical order by name. If the webpage has an API, add an `(api)` link beside it. The list is hand-maintained.
7. **A webpage with an API** uses the same `<name>` for `web/<name>/` and `api/<name>.ts`, and calls it with same-origin paths. Logic shared with the API is a plain ES module inside `web/<name>/` that `api/<name>.ts` imports (ADR 0002).
8. **Migrating from the blog** (`tphummel/blog`, `static/<name>/`) means copying the files unchanged and making only the edits needed to work here, each stated in its commit message. Redirects from `tomhummel.com/<name>` are configured in Cloudflare, not in this repo.
9. **Verify in the PR preview** (`https://<branch>.junk.tomhummel.com/<name>/`) in both light and dark mode before merging.

The step-by-step procedure, page template and migration details are in the [`new-webpage` skill](../skill/new-webpage/SKILL.md).

## Consequences

- A webpage can be added, moved or deleted without touching any other, apart from the one-line index entry.
- Webpages repeat some boilerplate; that is accepted.
- `web/index.html` is a registry that parallel sessions will conflict on; the resolution is to keep both entries.
- The index is not generated, so a forgotten entry means an unlisted (but reachable) webpage. Nothing checks it.
- No automated tests cover pages themselves; only logic shared with an API is tested.

## Alternatives considered

- **A generated index.** Would remove the conflicts but needs a build step (ADR 0002).
- **A shared layout and stylesheet.** Consistent, but couples webpages and conflicts with ADR 0001's one-palette-per-webpage idea.
- **A README or notes file per webpage inside `web/<name>/`.** It would be served and clutter the site.

## Open

Whether the index should ever be generated, and whether migrated webpages get palettes, are left to future ADRs.
