# 0009: Style sheets: shared looks with a storybook

- Status: Accepted
- Date: 2026-11-22

## Context

[ADR 0001](0001-web-styling.md) gives every webpage its own random palette and [ADR 0003](0003-webpages.md) forbids a shared stylesheet, so pages stay independent and look different. That is right for most pages, but sometimes a look is worth keeping: designed by hand rather than rolled, named, and reused by several pages. There is nowhere for that to live, and no way to see it without building a page around it.

This ADR adds a kind of project for that: a **style sheet**, a named look with the sheet itself and a storybook page that documents and demonstrates it. The first is `celebration`, inspired by the Sierra Nevada Celebration can.

## Decision

1. **One directory per style sheet.** `web/styles/<name>/`, served at `/styles/<name>/`, with `<name>` in lowercase kebab-case. The name is the look's name, not a page's.
2. **Two files do the work.**
   - `<name>.css` is the sheet. Pages link it at `/styles/<name>/<name>.css`.
   - `index.html` is the storybook: one page showing every token and component rendered live, with its markup next to it.
   The directory also has the icons and manifest every webpage ships, and a service worker, because the storybook has no external dependencies ([ADR 0008](0008-pwa-for-all-offline-for-self-contained.md)). `PRECACHE` lists the sheet.
3. **The sheet is plain CSS** with no build step ([ADR 0002](0002-no-web-build-step.md)): no `@import`, no web fonts or images from other origins (use system font stacks), no script.
   - **Prefixed.** Classes start with a short prefix (`cel-`) and custom properties with `--<prefix>-`, so linking the sheet cannot collide with a page's own CSS.
   - **Opt in.** The only element selectors sit under one page class (`.cel`), so linking the sheet changes nothing until a page adds the class.
   - **Light and dark, always.** Tokens are custom properties on `:root`: light values by default, dark values in `@media (prefers-color-scheme: dark)`, as in ADR 0001. The sheet also honors `data-theme="light"` or `"dark"` on `<html>`, so the storybook can preview each.
   - **Contrast per mode.** Text meets 4.5:1 and lines and controls 3:1 against what they sit on, in both modes. The ratios are recorded in comments next to the tokens, and the storybook computes and shows them from the live values.
   - **Context variables.** Components read `--<prefix>-fg`, `-line`, `-accent`, `-heading` and `-field` rather than palette colors directly, so the same markup works on the page background and inside a reversed panel.
4. **The storybook is the documentation, and it is complete.** Every class in the sheet appears in it, and the markup shown is taken from the rendered demo so it cannot drift. It loads only its own directory's sheet, by relative path, and has a light, dark and auto switch.
5. **Consuming a sheet.** A page links it with a root-absolute path. This is the one permitted cross-page dependency, and it narrows two earlier rules for pages that use it:
   - ADR 0003 item 2 (no shared stylesheet): style sheets under `web/styles/` are the exception.
   - ADR 0001 item 1 (random seed per page): the page takes the sheet's palette instead, and records `/* style sheet: <name> */` where the seed comment would go. Light and dark support and contrast still hold.
   The sheet is same-origin, so it is not an external dependency under ADR 0008. A consuming page with a service worker adds the sheet to its `PRECACHE` and to the paths its `fetch` handler serves, or it will lose its styling offline.
6. **Changing a sheet.** Edits go live on every consumer at once, so additive changes (new classes, new tokens) are fine in place. A breaking change (renaming or removing a class or token, or changing what one means) goes in a new file, `<name>-2.css`, next to the old one. The old file stays until `grep -r "styles/<name>/<name>.css" web` finds no consumer.
7. **Register it.** Add one `<li>` under a **Style sheets** heading in `web/index.html`, in alphabetical order, linking to the storybook (`/styles/<name>/`) and naming the sheet path in the description:
   ```html
   <li data-icon="icon.svg"><a href="/styles/<name>/">name</a>: short description</li>
   ```
   `data-icon` works because the icon is at `/styles/<name>/icon.svg`.
8. **Procedure.** Copy the structure of `web/styles/celebration/`. Make icons with `skill/new-webpage/scripts/make-icons.mjs styles/<name> <emoji> [#background]`, which accepts the nested name.

## Consequences

- A look can be designed once, previewed in one place and reused, and a page that wants it is one `<link>` and one class away.
- Consumers move together: a change to a sheet changes every page that links it, and nothing in CI checks consumers. The rule in item 6 is the only guard.
- Pages that use a sheet are no longer fully self-contained. Deleting a sheet breaks them; retire sheets through the `-2` path above.
- Style sheets are hand-designed, so unlike ADR 0001 palettes they have no recorded seed and cannot be regenerated; the CSS is the source.
- System font stacks mean the display type differs by device (Clarendon, Rockwell, Roboto Slab or Georgia), in exchange for no font files and offline use.
- `web/styles/` has no index page of its own; the home page's Style sheets section is the listing.

## Alternatives considered

- **Per-page copies of the CSS.** Keeps pages independent, but a fix or refinement has to be repeated everywhere and the copies drift.
- **One site-wide stylesheet.** Makes every page alike and conflicts with ADR 0001.
- **A package or build step** (npm package, Sass, bundler). Conflicts with ADR 0002 and adds tooling a junk drawer will not keep up.
- **Web fonts for exact type.** More faithful to a source design, but adds files, another dependency to cache, and a flash of unstyled text.
- **Putting the sheet at `web/<name>/` like other pages.** Mixes looks with tools and games and risks name collisions; a `styles/` namespace keeps them apart.
- **Versioned filenames from the start** (`<name>-1.css`). Safer for consumers, but every consumer must be edited to adopt even a compatible fix.
