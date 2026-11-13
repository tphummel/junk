# Notes

- Source: social-media poster "Golden ratio to build color palettes from one color" (example by Sanzuan).
- Steps: primary -> accent = hue +/- 137.5deg (360 - 360/1.618) -> support = primary with saturation cut ~60%.
- Implemented in HSL via Python `colorsys` (palette.py) and a plain-JS port (index.html). Both give identical output for the same inputs.
- Chose starting color E4572E (vermilion). Result: support AD7565, accent 2EE48C (green).
- Checked the poster's own example (008CBB):
  - Mine: support 387083, accent BBB300 (ccw) / BB0055 (cw).
  - Poster: support A1C5D1, accent FFC20F.
  - Poster's accent hue is ~45deg vs. primary ~195deg, i.e. ~150deg away, not exactly 137.5; it is also brightened. Looks hand-tuned.
  - Poster's support keeps hue, sat 100% -> ~34% (HSL), but lightness goes 37% -> 72%. A pure saturation cut doesn't lighten it, so mine is darker/muddier.
- Direction around the wheel is not specified; defaulted to clockwise (+), `--ccw` / checkbox flips it.
