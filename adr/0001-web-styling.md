# 0001: Webpage styling with the golden-angle palette

- Status: Accepted
- Date: 2026-11-14

## Context

`web/` hosts many small, unrelated static pages with no shared stylesheet. Without a convention they end up unstyled or all alike, and any scheme that needs a registry (for example "keep seeds unique") adds bookkeeping a junk drawer will not keep up. The repo's golden-angle palette tool and API (`/api/golden-angle-palette/<hex>`) turn one seed color into `primary`, `support` and `accent` colors.

## Decision

Every new webpage gets its own color scheme from a **random seed color**, generated with the golden-angle palette API as described in the [`golden-angle-styling` skill](../skill/golden-angle-styling/SKILL.md). **Every webpage must support both light and dark mode.**

1. **A random seed per webpage.** Seeds are not tracked or checked for uniqueness; if two webpages look too alike, re-roll.
2. **Light and dark mode, always.** Colors are CSS custom properties: light values by default, dark values in a `@media (prefers-color-scheme: dark)` override.
3. **Contrast is asserted per mode.** No single color reaches WCAG AA (4.5:1) on both white and near-black, so the API's `light` and `dark` sections shift each color's lightness to meet the ratio on that mode's background. Webpages use those values, and every `meets` must be true.
4. **Baked in at authoring time.** The colors are written into the page as static CSS; pages never call the API at runtime. The seed and direction are recorded next to the variables as `/* golden-angle seed: #RRGGBB cw|ccw */`.
5. **Neutrals are chosen by hand** per webpage and mode. Text on them, and on palette colors, meets 4.5:1 (large text and UI 3:1).
6. **Migrated webpages are exempt** until they are next modified.

## Consequences

- Each webpage has its own identity in both modes, with no registry, and the scheme is reproducible from the recorded seed.
- Two webpages can look similar by chance.
- Only lightness is adjusted, so in one mode a color can end up noticeably darker or lighter than the seed.
- The palette logic is one shared module ([ADR 0002](0002-no-web-build-step.md)). Colors already baked into pages do not change if the algorithm does.
- Nothing in CI checks that a page follows this convention.

## Alternatives considered

- **Unique, tracked seeds.** Needs a registry or a code scan to check.
- **One site-wide palette or shared stylesheet.** Couples the pages and makes them all alike.
- **Hand-picked colors with no tooling.** No record of intent and no contrast guarantee.
- **One palette for both modes.** One color cannot reach AA on both backgrounds.
- **Calling the API at runtime.** Adds a network dependency and makes pages non-static.
