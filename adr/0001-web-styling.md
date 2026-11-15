# 0001: Web experiment styling with the golden-angle palette

- Status: Accepted
- Date: 2026-11-14

## Context

`web/` hosts many small, unrelated experiments at junk.tomhummel.com. Each is a standalone static page with no build step and no shared stylesheet. Without a convention they either end up unstyled or all look the same, and nothing records why a given experiment looks the way it does. Any scheme that needs a shared registry (for example "keep seeds unique") adds bookkeeping that a junk drawer of experiments will not keep up.

The repo has a golden-angle palette tool (`web/golden-angle-palette/`) and a JSON API (`/api/golden-angle-palette/<hex>`) that turn one seed color into a `primary`, `support` and `accent` color. That gives a deterministic, reproducible way to get a coherent three-color scheme from a single choice.

## Decision

Every new web experiment gets its own color scheme, generated from a **random seed color** with the golden-angle palette API, following the [`golden-angle-styling` skill](../skill/golden-angle-styling/SKILL.md). **Every experiment must support both light and dark mode.**

Specifically:

1. **A random seed per experiment.** The seed is rolled with `skill/golden-angle-styling/scripts/random-seed.mjs` (random hue, fixed saturation, mid lightness). Seeds are not tracked or checked for uniqueness; with a random hue, collisions are unlikely and harmless, and the author re-rolls if two experiments look too alike.
2. **Light and dark mode, always.** Colors are applied as CSS custom properties: light values by default and dark values in a `@media (prefers-color-scheme: dark)` override.
3. **Contrast is asserted per mode by the API.** No single color can reach WCAG AA (4.5:1) on both a white and a near-black background, so the API's `light` and `dark` sections return each palette color shifted in lightness (hue and saturation kept) to meet the requested ratio on that mode's background, and report the measured ratio. Experiments use those values, not the raw palette colors, and every `meets` must be true.
4. **Baked in at authoring time.** The generated colors are written into the experiment as static CSS. Experiments do not call the API at runtime.
5. **Recorded in the code.** The seed and direction are recorded in a marker comment, `/* golden-angle seed: #RRGGBB cw|ccw */`, next to the variables, so the scheme can be reproduced.
6. **Neutrals are the author's job.** Background and text colors are chosen by hand per experiment and per mode; the API is given those backgrounds, and text on them (and text on palette colors) is checked separately. Text and interactive elements meet 4.5:1, and large text and UI 3:1.
7. **Migrated experiments are exempt until touched.** Experiments copied from the blog are migrated unchanged and receive a palette, with both modes, when they are next modified.

## Consequences

- Each experiment has its own identity and works in light and dark mode, with no registry to maintain; the scheme is reproducible from one recorded seed.
- Contrast is checked by a tool rather than by eye, per mode, against the experiment's own backgrounds.
- The convention is cheap to follow (one script, one API call or the palette page's Copy CSS button) and needs no build step, framework or shared CSS.
- The API is only a design-time tool, so an API outage or change cannot break a published experiment.
- Two experiments can end up with similar colors by chance. This is accepted; re-rolling is the remedy.
- Adjustment is by lightness only, so in one mode a color can end up noticeably darker or lighter than the seed; the raw seed is not itself used in the mode where it fails.
- The palette and contrast logic exists in two places (the page's inline JS and `api/golden-angle-palette.ts`); `npm test` fails if they diverge. Colors already baked into experiments will not change if the algorithm does.
- Nothing in CI checks that an experiment actually follows this convention.

## Alternatives considered

- **Unique, tracked seeds** (an earlier draft of this ADR). Guarantees distinct experiments but needs a registry or a scan of the code to check, which is bookkeeping this repo will not maintain.
- **One site-wide palette or shared stylesheet.** Consistent, but contradicts the goal of independent experiments with no shared build or CSS, and makes every page look alike.
- **Hand-picked colors per experiment with no tooling.** Flexible, but there is no record of intent, no contrast guarantee, and palettes drift in quality.
- **Light mode only, or one palette for both modes.** Simpler, but one color cannot reach AA on both a light and a dark background, so a single palette fails contrast in at least one mode.
- **Calling the API at runtime from each page.** Would let palettes change without edits, but adds a network dependency to every experiment and makes pages non-static.
