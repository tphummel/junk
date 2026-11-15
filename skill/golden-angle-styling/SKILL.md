---
name: golden-angle-styling
description: Choose a random seed color and generate a color scheme for a web experiment in this repo using the golden-angle palette API (junk.tomhummel.com/api/golden-angle-palette/<hex>), then apply it as CSS custom properties. Use when creating or restyling anything under web/, or when asked for a palette, theme, or colors for an experiment.
metadata:
  version: "1.1.0"
---

# Golden-angle styling for web experiments

Each experiment under `web/` gets its own color scheme, generated from one random **seed color** by the golden-angle palette API. See [ADR 0001](../../adr/0001-web-styling.md) for why.

## How the palette works

`GET /api/golden-angle-palette/<hex>[?direction=cw|ccw]` returns three colors derived from the seed in HSL:

| Key | Derivation | Typical use |
| --- | --- | --- |
| `primary` | the seed itself | headings, links, main buttons |
| `support` | same hue and lightness, saturation cut by 60% | backgrounds, borders, muted text |
| `accent` | hue rotated by the golden angle (about 137.5°), same saturation and lightness | sparing highlights: active states, badges |

`direction=cw` (default) rotates the accent one way, `ccw` the other. Use `ccw` for a different accent hue from the same seed.

All three colors share the seed's **lightness**, but not its perceived brightness: rotating the hue changes luminance, so the accent can have very different contrast from the primary (a green accent on white is often far below 4.5:1). The API does not return neutrals; pick background and text neutrals yourself.

Input: 3 or 6 hex digits, no `#` (a bare `#` is a URL fragment; `%23` also works). Errors are 400 with `{"error": ...}`.

## Workflow

### 1. Roll a random seed

```bash
node skill/golden-angle-styling/scripts/random-seed.mjs                  # for a light background (#FFFFFF)
node skill/golden-angle-styling/scripts/random-seed.mjs --bg 111111      # for a dark background
node skill/golden-angle-styling/scripts/random-seed.mjs --bg FAFAFA --ratio 7   # stricter (AAA)
```

It picks a random hue at fixed saturation, then adjusts lightness (darker for light backgrounds, lighter for dark ones) until the seed meets the contrast ratio (default 4.5:1). The seed is printed to stdout and the details to stderr. Nothing tracks which seeds other experiments use; if the result is not to your taste, or looks too much like a neighbor, roll again.

A hand-picked seed is also fine. Check it against your background with the contrast guidance in step 4.

### 2. Generate the palette

```bash
curl -s https://junk.tomhummel.com/api/golden-angle-palette/E4572E
curl -s 'https://junk.tomhummel.com/api/golden-angle-palette/E4572E?direction=ccw' | jq -r '.accent'
```

Against local dev use `http://localhost:8787` (`npm run dev`). Run it once at authoring time and **write the results into the experiment as static CSS**. Experiments must not call the API at runtime.

### 3. Apply as CSS custom properties

Put the marker comment and variables at the top of the experiment's CSS (inline `<style>` is fine, there is no build step):

```css
:root {
  /* golden-angle seed: #E4572E cw */
  --primary: #E4572E;
  --support: #AD7565;
  --accent:  #2EE48C;

  --bg: #FFFFFF;      /* neutrals are chosen by hand */
  --text: #111111;
}
body { background: var(--bg); color: var(--text); }
a, h1, h2 { color: var(--primary); }
button { background: var(--primary); color: var(--bg); border: 0; }
.muted, hr { color: var(--support); border-color: var(--support); }
.active { outline: 2px solid var(--accent); }
```

The marker comment records the seed and direction so the scheme can be reproduced; keep its format exact.

### 4. Check contrast

- Body text must be at least 4.5:1 against its background; large text and UI borders at least 3:1.
- The seed script guarantees `primary` against the background you gave it. `support` and `accent` are **not** guaranteed: check them before using them for text. If the API response includes a `contrast` section, use it (ratios and AA pass/fail for each color on white and on `#111111`); otherwise compute WCAG ratios yourself.
- If `accent` fails, use it only for non-text decoration (3:1 for UI components), or try `direction=ccw` for a different accent hue.
- If `support` is too faint for text, use it for backgrounds and borders only.
- For text over a swatch of one of the colors, pick black or white by whichever has the higher contrast ratio; the better of the two is always at least 4.58:1.

### 5. Validate

- [ ] Marker comment `golden-angle seed: #RRGGBB cw|ccw` is present, with the direction used
- [ ] `--primary`, `--support`, `--accent` match the API response for that seed and direction
- [ ] Contrast checked for text and interactive elements, including `support` and `accent` where used as text
- [ ] No runtime call to the API

## Notes

- The API's behavior mirrors `web/golden-angle-palette/index.html`; the page is the interactive way to preview a seed.
- Migrated experiments (copied from the blog) are not restyled during migration. Add a palette when you next change them.
