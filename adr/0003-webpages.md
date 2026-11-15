# 0003: How webpages are built

- Status: Accepted
- Date: 2026-11-14

## Context

`web/` holds many small, unrelated webpages at `https://junk.tomhummel.com/<name>/`, written by different people and agent sessions. This ADR records the structure the first webpages (`math-game`, `card-shuffle-svelte`, `golden-angle-palette`) established, so new ones match. There is no build step ([ADR 0002](0002-no-web-build-step.md)), and colors follow [ADR 0001](0001-web-styling.md).

## Decision

1. **One directory per webpage.** `web/<name>/index.html`, with `<name>` in lowercase kebab-case, served at `/<name>/`.
2. **Self-contained.** Everything a webpage needs is in its own directory, referenced with relative paths. It does not import from another webpage, and there is no shared layout, navigation or stylesheet. Link to other pages and APIs with root-absolute paths. Only served files go in `web/`; tests live in `api/`.
3. **Register it.** Add one `<li>` to the list in `web/index.html`, in alphabetical order by name, with an `(api)` link if it has an API. The list is hand-maintained.
4. **Paired API.** A webpage with an API uses the same `<name>` for `web/<name>/` and `api/<name>.ts` and calls it with same-origin paths. Shared logic is a plain ES module in `web/<name>/` that the API imports.
5. **Migrating from the blog** (`tphummel/blog`, `static/<name>/`): copy the files unchanged, then make only the edits needed to work here, each stated in its commit message. Redirects from `tomhummel.com/<name>` are configured in Cloudflare, not in this repo.

The procedure, page template and checks are in the [`new-webpage` skill](../skill/new-webpage/SKILL.md).

## Consequences

- A webpage can be added, moved or deleted without touching any other, apart from its index entry.
- Webpages repeat some boilerplate.
- `web/index.html` is a registry that parallel sessions will conflict on; keep both entries.
- The index is not generated, so a forgotten entry means an unlisted but reachable webpage. Nothing checks it.
- No automated tests cover pages; only logic shared with an API is tested.

## Alternatives considered

- **A generated index.** Removes the conflicts but needs a build step.
- **A shared layout and stylesheet.** Consistent, but couples webpages and conflicts with one palette per webpage.
- **A README or notes file inside `web/<name>/`.** It would be served and clutter the site.

## Open

Whether the index should ever be generated, and whether migrated webpages get palettes.
