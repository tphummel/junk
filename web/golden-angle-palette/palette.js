// Golden-angle palette and WCAG contrast logic.
//
// Plain JavaScript that runs in the browser as written (no build step, see ADR 0002). It is the
// single source of truth: web/golden-angle-palette/index.html loads it as a module and
// api/golden-angle-palette.ts imports it (Wrangler bundles it into the Worker).
// Colors are 6-digit hex strings without "#".

export const GOLDEN_ANGLE = 360 - 360 / 1.618;
export const SAT_CUT = 0.6;

/** @typedef {{ primary: string, support: string, accent: string }} Palette */
/** @typedef {{ hex: string, ratio: number, rawRatio: number, adjusted: boolean, meets: boolean }} Fit */

/**
 * @param {number} r 0-255
 * @param {number} g 0-255
 * @param {number} b 0-255
 * @returns {[number, number, number]} hue 0-360, saturation 0-1, lightness 0-1
 */
export function rgb2hsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

/**
 * @param {number} h hue in degrees (any value)
 * @param {number} s saturation 0-1
 * @param {number} l lightness 0-1
 * @returns {string} 6 uppercase hex digits
 */
export function hsl2hex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(h / 60) % 6];
  return [r, g, b]
    .map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** @param {string} hex 6 hex digits @returns {[number, number, number]} */
function hexToRgb(hex) {
  const n = parseInt(hex, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/**
 * The raw palette: the seed, a desaturated support color, and an accent rotated by the golden angle.
 * @param {string} hex6 seed
 * @param {1 | -1} dir 1 clockwise, -1 counter-clockwise
 * @returns {Palette}
 */
export function palette(hex6, dir) {
  const [h, s, l] = rgb2hsl(...hexToRgb(hex6));
  return {
    primary: hex6.toUpperCase(),
    support: hsl2hex(h, s * (1 - SAT_CUT), l),
    accent: hsl2hex(h + dir * GOLDEN_ANGLE, s, l),
  };
}

/** @param {number} c 0-255 */
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG relative luminance. @param {string} hex6 */
export function luminance(hex6) {
  const [r, g, b] = hexToRgb(hex6);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1 to 21. @param {string} a @param {string} b */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Shift a color's lightness (keeping hue and saturation) just far enough that it meets `target`
 * contrast against `bg6`: darker on light backgrounds, lighter on dark ones. A color that already
 * meets the target is returned unchanged (uppercased).
 * @param {string} hex6
 * @param {string} bg6
 * @param {number} target minimum contrast ratio
 * @returns {Fit}
 */
export function fitContrast(hex6, bg6, target) {
  const raw = hex6.toUpperCase();
  const rawRatio = contrastRatio(raw, bg6);
  if (rawRatio >= target) return { hex: raw, ratio: rawRatio, rawRatio, adjusted: false, meets: true };

  const [h, s, l] = rgb2hsl(...hexToRgb(raw));
  const lighten = luminance(bg6) <= 0.18;
  const safeEnd = lighten ? 1 : 0;
  let far = safeEnd; // lightness known to meet (or come closest to) the target
  let near = l;
  for (let i = 0; i < 30; i++) {
    const mid = (far + near) / 2;
    if (contrastRatio(hsl2hex(h, s, mid), bg6) >= target) far = mid;
    else near = mid;
  }
  // Quantizing to 8-bit hex can land a hair under the target; nudge toward the safe end.
  let hex = hsl2hex(h, s, far);
  for (let i = 0; i < 100 && contrastRatio(hex, bg6) < target && far !== safeEnd; i++) {
    far = lighten ? Math.min(1, far + 0.001) : Math.max(0, far - 0.001);
    hex = hsl2hex(h, s, far);
  }
  const ratio = contrastRatio(hex, bg6);
  return { hex, ratio, rawRatio, adjusted: true, meets: ratio >= target };
}
