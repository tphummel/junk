# 0001: Web experiment styling with the golden-angle palette

- Status: Accepted
- Date: 2026-11-14

## Context

`web/` hosts many small, unrelated experiments at junk.tomhummel.com. Each is a standalone static page with no build step and no shared stylesheet. Without a convention they either end up unstyled or all look the same, and nothing records why a given experiment looks the way it does.

The repo has a golden-angle palette tool (`web/golden-angle-palette/`) and a JSON API (`/api/golden-angle-palette/<hex>`) that turn one seed color into a `primary`, `support` and `accent` color. That gives a deterministic, reproducible way to get a coherent three-color scheme from a single choice.

## Decision

Every new web experiment gets its own color scheme, generated from a unique seed color with the golden-angle palette API, following the [`golden-angle-styling` skill](../skill/golden-angle-styling/SKILL.md).

Specifically:

1. **One seed per experiment.** No two experiments share a seed. Seeds are chosen to be visibly distinct in hue from existing ones; `skill/golden-angle-styling/scripts/seed-hues.mjs` lists the seeds in use and suggests one.
2. **Baked in at authoring time.** The generated `primary`, `support` and `accent` colors are written into the experiment as CSS custom properties. Experiments do not call the API at runtime.
3. **Recorded in the code.** The seed and direction are recorded in a marker comment, `/* golden-angle seed: #RRGGBB cw|ccw */`, next to the variables, so seeds can be found by search.
4. **Accessible.** Text and interactive elements meet WCAG AA contrast (4.5:1 for body text, 3:1 for large text and UI). Neutrals (background and text) are chosen by hand per experiment.
5. **Migrated experiments are exempt until touched.** Experiments copied from the blog are migrated unchanged and receive a palette when they are next modified.

## Consequences

- Each experiment has its own identity, and the scheme is reproducible from one recorded value.
- The convention is cheap to follow (one API call or one use of the palette page) and needs no build step, framework or shared CSS.
- The API is only a design-time tool, so an API outage or change cannot break a published experiment.
- Uniqueness is enforced by convention and by running the helper script, not automatically; nothing in CI fails if two experiments share a seed.
- The palette's three colors share one lightness, so contrast depends on the seed's lightness and neutrals must be chosen separately.
- The palette algorithm exists in two places (the page's inline JS and `api/golden-angle-palette.ts`). Changing it requires updating both, and colors already baked into experiments will not change.

## Alternatives considered

- **One site-wide palette or shared stylesheet.** Consistent, but contradicts the goal of independent experiments with no shared build or CSS, and makes every page look alike.
- **Hand-picked colors per experiment with no tooling.** Flexible, but there is no record of intent, no uniqueness check, and palettes drift in quality.
- **Random seed per experiment.** Unique but not reproducible from a recorded decision, and can yield low-contrast results.
- **Calling the API at runtime from each page.** Would let palettes change without edits, but adds a network dependency to every experiment and makes pages non-static.
