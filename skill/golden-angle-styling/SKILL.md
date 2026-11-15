---
name: golden-angle-styling
description: Choose a unique color scheme for a web experiment in this repo using the golden-angle palette API (junk.tomhummel.com/api/golden-angle-palette/<hex>), then apply it as CSS custom properties. Use when creating or restyling anything under web/, or when asked for a palette, theme, or colors for an experiment.
metadata:
  version: "1.0.0"
---

# Golden-angle styling for web experiments

Each experiment under `web/` gets its own color scheme, generated from one **seed color** by the golden-angle palette API. See [ADR 0001](../../adr/0001-web-styling.md) for why.

## How the palette works

`GET /api/golden-angle-palette/<hex>[?direction=cw|ccw]` returns three colors derived from the seed in HSL:

| Key | Derivation | Typical use |
| --- | --- | --- |
| `primary` | the seed itself | headings, links, main buttons |
| `support` | same hue and lightness, saturation cut by 60% | backgrounds, borders, muted text |
| `accent` | hue rotated by the golden angle (about 137.5°), same saturation and lightness | sparing highlights: active states, badges |

`direction=cw` (default) rotates the accent one way, `ccw` the other. Use `ccw` for a different accent hue from the same seed.

All three colors share the seed's **lightness**, so the seed's lightness decides whether they work against light or dark backgrounds. The API does not return neutrals; pick background and text neutrals yourself.

Input: 3 or 6 hex digits, no `#` (a bare `#` is a URL fragment; `%23` also works). Errors are 400 with `{"error": ...}`.

## Workflow

### 1. Choose a unique seed

List the seeds already in use and get a suggestion from the largest hue gap:

```bash
node skill/golden-angle-styling/scripts/seed-hues.mjs            # default s=0.65 l=0.40
node skill/golden-angle-styling/scripts/seed-hues.mjs --l 0.30   # darker seed
```

The script reads the marker comment `golden-angle seed: #RRGGBB cw|ccw` from files under `web/`. Rules:

- Never reuse an existing seed. Prefer a hue well away from existing ones, so experiments are visibly distinct.
- A hand-picked seed is fine (for example a color that suits the experiment); still check it against the existing list.
- Keep lightness around 30-45% if `primary` will be used as text or button color on a light background.

### 2. Generate the palette

```bash
curl -s https://junk.tomhummel.com/api/golden-angle-palette/E4572E
# {"input":"#E4572E","direction":"cw","primary":"#E4572E","support":"#AD7565","accent":"#2EE48C"}

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

The marker comment format is exact, because the script and reviewers search for it.

### 4. Check contrast

- Body text must be at least 4.5:1 against its background; large text and UI borders at least 3:1.
- Example: seed `#E4572E` is 3.68:1 on white (too low for body text, fine for large headings) and 5.13:1 on `#111111`.
- Fix a failing seed by lowering lightness (`--l 0.30` in the script) rather than darkening the palette by hand, so the three colors stay consistent.
- For text over a swatch of one of the colors, use black or white by luminance, as the palette page does: black if `0.299*R + 0.587*G + 0.114*B > 150`, else white.

### 5. Validate

- [ ] Seed is not used by any other experiment (script output)
- [ ] Marker comment `golden-angle seed: #RRGGBB cw|ccw` is present, with the direction used
- [ ] `--primary`, `--support`, `--accent` match the API response for that seed and direction
- [ ] Contrast checked for text and interactive elements
- [ ] No runtime call to the API

## Notes

- The API's behavior mirrors `web/golden-angle-palette/index.html`; the page is the interactive way to preview a seed before committing to it.
- Migrated experiments (copied from the blog) are not restyled during migration. Add a palette when you next change them.
