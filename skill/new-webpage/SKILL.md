---
name: new-webpage
description: Add or migrate a static webpage under web/ in the junk repo (served at junk.tomhummel.com/<name>/). Use when asked to create, port, or move a page, tool, or toy into web/, including migrating one from tomhummel.com (tphummel/blog static/).
metadata:
  version: "1.0.0"
---

# New webpage

Rules are in [ADR 0003](../../adr/0003-webpages.md) (structure), [0002](../../adr/0002-no-web-build-step.md) (no build step) and [0001](../../adr/0001-web-styling.md) (colors). This is the procedure.

## Steps

1. **Branch.** `git switch -c <name>` from an up-to-date `main`. Name is lowercase kebab-case.
2. **Create `web/<name>/index.html`** from the template below. Put every other file the page needs (scripts, modules, data, images) in the same directory and reference it relatively.
3. **Style it** with the [`golden-angle-styling` skill](../golden-angle-styling/SKILL.md): random seed, light and dark variables. Migrated webpages are exempt until they are next changed.
4. **Register it.** Add one `<li>` to the Pages list in `web/index.html`, in alphabetical order:
   ```html
   <li><a href="/<name>/">display name</a></li>
   ```
   An API for the page is listed separately in the API list (the `new-api` skill covers it), not as a link on the page entry.
5. **If it needs an API**, use the [`new-api` skill](../new-api/SKILL.md) with the same `<name>`. Call it with a same-origin path (`fetch("/api/<name>/...")`). Logic both sides need goes in `web/<name>/<something>.js` as a plain ES module with JSDoc types; the API imports it.
6. **Check locally:** do the one-time setup in the [README](../../README.md#site-and-api) if needed, then `npm run dev` and open `http://localhost:8787/<name>/`. Pages that import ES modules do not work from `file://`.
7. **Push and open a PR.** Open the preview at `https://<branch>.junk.tomhummel.com/<name>/`, exercise the page, and view it in light and dark mode (browser or OS setting). Fix console errors and 404s.

## Template

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>display name</title>
  <style>
    /* palette variables from the golden-angle-styling skill */
  </style>
</head>
<body>
  <!-- ... -->
</body>
</html>
```

## Do not

- Add a build step, bundler, `package.json`, or generated files under `web/` (ADR 0002).
- Put tests, notes, or drafts in `web/`; everything there is served as-is. Tests for shared logic go in `api/<name>.test.mjs`.
- Import from another webpage's directory, or add a shared layout or stylesheet.
- Create a project folder or `notes.md` for this work.

## Migrating from tomhummel.com

Source: `https://github.com/tphummel/blog/tree/main/static/<name>/`.

1. Copy the files unchanged into `web/<name>/` and commit that first.
2. Make only the edits needed to work here, as separate commits, and state each in the commit message. Typical ones: remove links to files that never existed (the blog returns its 404 page with status 200, so a "working" icon link may be dead), make self-links relative or root-absolute.
3. Check for calls to external APIs or hard-coded `tomhummel.com` URLs; list them in the PR rather than silently changing them.
4. Keep CDN-loaded libraries (for example Svelte) as they are unless asked to vendor them.
5. Do not add a redirect in this repo. Redirects from `tomhummel.com/<name>` are Cloudflare rules, added by the owner after the new URL works in production.

## Done when

- `/<name>/` loads in the PR preview with no console errors, in both color schemes.
- The entry is in the Pages list in `web/index.html`, in order.
- `npm run types && npm run typecheck && npm test` pass (if an API or shared module is involved).
