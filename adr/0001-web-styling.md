# 0001: Web experiment styling with the golden-angle palette

- Status: Accepted
- Date: 2026-11-14

## Context

`web/` hosts many small, unrelated experiments at junk.tomhummel.com. Each is a standalone static page with no build step and no shared stylesheet. Without a convention they either end up unstyled or all look the same, and nothing records why a given experiment looks the way it does. Any scheme that needs a shared registry (for example "keep seeds unique") adds bookkeeping that a junk drawer of experiments will not keep up.

The repo has a golden-angle palette tool (`web/golden-angle-palette/`) and a JSON API (`/api/golden-angle-palette/<hex>`) that turn one seed color into a `primary`, `support` and `accent` color. That gives a deterministic, reproducible way to get a coherent three-color scheme from a single choice.

## Decision

Every new web experiment gets its own color scheme, generated from a **random seed color** with the golden-angle palette API, following the [`golden-angle-styling` skill](../skill/golden-angle-styling/SKILL.md).

Specifically:

1. **A random seed per experiment.** The seed is rolled with `skill/golden-angle-styling/scripts/random-seed.mjs` (random hue, fixed saturation). Seeds are not tracked or checked for uniqueness; with a random hue, collisions are unlikely and harmless, and the author re-rolls if two experiments look too alike.
2. **The seed meets contrast by construction.** The script adjusts lightness until the seed reaches WCAG AA (4.5:1) against the experiment's background, darker for light backgrounds and lighter for dark ones.
3. **Baked in at authoring time.** The generated `primary`, `support` and `accent` colors are written into the experiment as CSS custom properties. Experiments do not call the API at runtime.
4. **Recorded in the code.** The seed and direction are recorded in a marker comment, `/* golden-angle seed: #RRGGBB cw|ccw */`, next to the variables, so the scheme can be reproduced.
5. **Accessible.** Text and interactive elements meet WCAG AA contrast (4.5:1 for body text, 3:1 for large text and UI). `support` and `accent` are not guaranteed by the seed script and must be checked before use as text. Neutrals (background and text) are chosen by hand per experiment.
6. **Migrated experiments are exempt until touched.** Experiments copied from the blog are migrated unchanged and receive a palette when they are next modified.

## Consequences

- Each experiment has its own identity with no registry to maintain, and the scheme is reproducible from one recorded value.
- The convention is cheap to follow (run one script, make one API call) and needs no build step, framework or shared CSS.
- The API is only a design-time tool, so an API outage or change cannot break a published experiment.
- Two experiments can end up with similar colors by chance. This is accepted; re-rolling is the remedy.
- The palette's three colors share one lightness but not equal contrast: hue rotation changes luminance, so `accent` in particular can fail on the background that `primary` passes on. It must be checked per use.
- The palette algorithm exists in two places (the page's inline JS and `api/golden-angle-palette.ts`). Changing it requires updating both, and colors already baked into experiments will not change.

## Alternatives considered

- **Unique, tracked seeds** (an earlier draft of this ADR). Guarantees distinct experiments but needs a registry or a scan of the code to check, which is bookkeeping this repo will not maintain.
- **One site-wide palette or shared stylesheet.** Consistent, but contradicts the goal of independent experiments with no shared build or CSS, and makes every page look alike.
- **Hand-picked colors per experiment with no tooling.** Flexible, but there is no record of intent, no contrast guarantee, and palettes drift in quality.
- **Calling the API at runtime from each page.** Would let palettes change without edits, but adds a network dependency to every experiment and makes pages non-static.
