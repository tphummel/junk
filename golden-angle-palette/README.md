# golden-angle-palette

Generate a 3-color palette (primary / support / accent) from one starting color using the golden angle, per a poster by Sanzuan.

## Algorithm
1. Pick a primary color.
2. Golden angle = 360 - 360/1.618 = 137.5deg. Accent = primary hue rotated by that angle (HSL; saturation and lightness unchanged).
3. Support = primary with saturation reduced by 60%.

## Use
```
python3 palette.py            # default start color E4572E
python3 palette.py 008CBB     # any hex
python3 palette.py 008CBB --ccw --json
```
Or open `index.html` for a color picker with live swatches (same algorithm in JS, no dependencies).

## Result for the chosen start color
| role | hex |
|---|---|
| primary | `#E4572E` |
| support | `#AD7565` |
| accent | `#2EE48C` |

## Caveat
Running the poster's own example (`008CBB`) gives support `387083` / accent `BBB300` (or `BB0055` going the other way), not the poster's `A1C5D1` / `FFC20F`. The poster's accent is ~150deg away and its support is lightened too, so it appears hand-adjusted. See `notes.md`.
