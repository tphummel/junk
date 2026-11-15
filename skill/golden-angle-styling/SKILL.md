---
name: golden-angle-styling
description: Roll a random seed color and generate a light and dark mode color scheme for a web experiment in this repo using the golden-angle palette API (junk.tomhummel.com/api/golden-angle-palette/<hex>), then apply it as CSS custom properties with a prefers-color-scheme override. Use when creating or restyling anything under web/, or when asked for a palette, theme, or colors for an experiment.
metadata:
  version: "2.0.0"
---

# Golden-angle styling for web experiments

Each experiment under `web/` gets its own color scheme, generated from one random **seed color** by the golden-angle palette API, and it must work in **both light and dark mode**. See [ADR 0001](../../adr/0001-web-styling.md) for why.

## How the palette works

`GET /api/golden-angle-palette/<hex>` derives three colors from the seed in HSL:

| Key | Derivation | Typical use |
| --- | --- | --- |
| `primary` | the seed itself | headings, links, main buttons |
| `support` | same hue and lightness, saturation cut by 60% | borders, secondary and muted elements |
| `accent` | hue rotated by the golden angle (about 137.5°), same saturation and lightness | sparing highlights: active states, badges |

Those are the raw colors. Rotating the hue changes luminance, and no single color can reach 4.5:1 on both a white and a near-black background (white needs luminance <= 0.18, `#111111` needs >= 0.20). So the response also has a **`light`** and a **`dark`** section: each color shifted in lightness only (hue and saturation kept) just far enough to meet the minimum contrast ratio on that mode's background:

```json
"light": { "background": "#FFFFFF", "minRatio": 4.5,
  "primary": { "color": "#D4451B", "ratio": 4.5, "rawRatio": 3.68, "adjusted": true, "meets": true }, ... },
"dark":  { "background": "#111111", "minRatio": 4.5,
  "primary": { "color": "#E4572E", "ratio": 5.12, "rawRatio": 5.12, "adjusted": false, "meets": true }, ... }
```

Parameters: `?direction=cw|ccw` (accent rotation; `ccw` gives a different accent hue), `?ratio=4.5` (minimum, 1-21; use 7 for AAA), `?light=<hex>` and `?dark=<hex>` (the backgrounds, defaults `FFFFFF` and `111111`). Colors are 3 or 6 hex digits without `#` (a bare `#` is a URL fragment; `%23` works). Errors are 400 with `{"error": ...}`. If `meets` is false the background cannot reach the ratio with that hue (for example a mid-gray at 7:1); choose a lighter or darker background.

## Workflow

### 1. Choose the backgrounds

Pick your experiment's light and dark background colors (and body text colors) first; the API checks contrast against them. The defaults `#FFFFFF` and `#111111` are fine if you have no preference.

### 2. Roll a random seed

```bash
node skill/golden-angle-styling/scripts/random-seed.mjs     # prints e.g. #E4572E
```

Random hue at fixed saturation and mid lightness. Nothing tracks which seeds other experiments use; if you do not like the result, or it looks too much like a neighbor, roll again. A hand-picked seed is also fine.

### 3. Generate the palette for both modes

```bash
curl -s 'https://junk.tomhummel.com/api/golden-angle-palette/E4572E?light=FFFFFF&dark=111111' \
  | jq '{light: (.light | {primary: .primary.color, support: .support.color, accent: .accent.color}),
         dark:  (.dark  | {primary: .primary.color, support: .support.color, accent: .accent.color})}'
```

Against local dev use `http://localhost:8787` (`npm run dev`). Run it once at authoring time and **write the results into the experiment as static CSS**; experiments must not call the API at runtime. The interactive page at `/golden-angle-palette/` does the same and its **Copy CSS** button outputs the block in step 4 directly (including the marker comment).

### 4. Apply as CSS custom properties

Light values are the default; dark values go in a `prefers-color-scheme` override. Put the marker comment first so the seed is recorded:

```css
:root {
  color-scheme: light dark;
  /* golden-angle seed: #E4572E cw */
  /* >= 4.5:1 on #FFFFFF (light) and #111111 (dark) */
  --primary: #D4451B;
  --support: #A36757;
  --accent:  #12884F;
  --bg: #FFFFFF;
  --text: #111111;
}
@media (prefers-color-scheme: dark) {
  :root {
    --primary: #E4572E;
    --support: #AD7565;
    --accent:  #2EE48C;
    --bg: #111111;
    --text: #EEEEEE;
  }
}
body { background: var(--bg); color: var(--text); }
a, h1, h2 { color: var(--primary); }
button { background: var(--primary); color: var(--bg); border: 0; }
.muted, hr { color: var(--support); border-color: var(--support); }
.active { outline: 2px solid var(--accent); }
```

(These are the API's actual values for seed `E4572E`, clockwise, on `#FFFFFF` and `#111111`; use what it returns for your seed.) The marker comment format is exact: `golden-angle seed: #RRGGBB cw|ccw`.

### 5. Check what the API does not cover

- Your hand-chosen `--text` on `--bg` must also reach 4.5:1 in each mode (the API checks the three palette colors, not your neutrals).
- Text placed on top of a palette color (a button label, for example) needs its own contrast: use whichever of black or white has the higher ratio; the better of the two is always at least 4.58:1.
- Large text and UI borders need 3:1; body text 4.5:1.

### 6. Validate

- [ ] Marker comment `golden-angle seed: #RRGGBB cw|ccw` is present, with the direction used
- [ ] Light values are the default and dark values are in `@media (prefers-color-scheme: dark)`
- [ ] `--primary`, `--support`, `--accent` for each mode match the API's `color` values for that seed, direction and backgrounds, and every `meets` was true
- [ ] `--bg` in each mode equals the background passed to the API
- [ ] Text neutrals and text-on-color checked (step 5)
- [ ] No runtime call to the API
- [ ] Looked at in both modes (OS or browser dark-mode emulation)

## Notes

- The page and the API share one implementation, `web/golden-angle-palette/palette.js`; `npm test` (from the repo root) tests it and the API route.
- Migrated experiments (copied from the blog) are not restyled during migration. Add a palette, with both modes, when you next change them.
