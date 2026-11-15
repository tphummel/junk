import { Hono } from "hono";
import { cors } from "hono/cors";

// Port of the palette logic in web/golden-angle-palette/index.html.
// Keep the constants and math identical to the page.
const GOLDEN_ANGLE = 360 - 360 / 1.618;
const SAT_CUT = 0.6;

function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hsl2hex(h: number, s: number, l: number): string {
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

export function palette(hex6: string, dir: 1 | -1) {
  const n = parseInt(hex6, 16);
  const [h, s, l] = rgb2hsl(n >> 16, (n >> 8) & 255, n & 255);
  return {
    primary: hex6.toUpperCase(),
    support: hsl2hex(h, s * (1 - SAT_CUT), l),
    accent: hsl2hex(h + dir * GOLDEN_ANGLE, s, l),
  };
}

const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG relative luminance of a 6-digit hex color. */
export function luminance(hex6: string): number {
  const n = parseInt(hex6, 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** WCAG contrast ratio (1 to 21) between two 6-digit hex colors. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Ratios are truncated, never rounded up, so a reported 4.50 really is >= 4.5. */
const floor2 = (n: number) => Math.floor(n * 100) / 100;

/**
 * Shift a color's lightness (keeping hue and saturation) just far enough that it meets
 * `target` contrast against `bg`: darker on light backgrounds, lighter on dark ones.
 * A color that already meets the target is returned unchanged.
 */
export function fitContrast(hex6: string, bg6: string, target: number) {
  const raw = hex6.toUpperCase();
  const rawRatio = contrastRatio(raw, bg6);
  if (rawRatio >= target) return { hex: raw, ratio: rawRatio, rawRatio, adjusted: false, meets: true };

  const [h, s, l] = rgb2hsl(parseInt(raw, 16) >> 16, (parseInt(raw, 16) >> 8) & 255, parseInt(raw, 16) & 255);
  const lighten = luminance(bg6) <= 0.18;
  const safeEnd = lighten ? 1 : 0;
  let far = safeEnd; // lightness that is known to meet (or come closest to) the target
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

function modeReport(p: { primary: string; support: string; accent: string }, bg6: string, target: number) {
  const entry = (hex: string) => {
    const f = fitContrast(hex, bg6, target);
    return { color: `#${f.hex}`, ratio: floor2(f.ratio), rawRatio: floor2(f.rawRatio), adjusted: f.adjusted, meets: f.meets };
  };
  return {
    background: `#${bg6.toUpperCase()}`,
    minRatio: target,
    primary: entry(p.primary),
    support: entry(p.support),
    accent: entry(p.accent),
  };
}

/** Accepts "e4572e", "#e4572e", "e52" (shorthand). Returns 6 hex digits or null. */
function parseColor(input: string): string | null {
  const v = input.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(v)) return v;
  if (/^[0-9a-f]{3}$/i.test(v)) return [...v].map((ch) => ch + ch).join("");
  return null;
}

const app = new Hono();

app.use("*", cors());

// GET /api/golden-angle-palette/e4572e
//   ?direction=cw|ccw   accent rotation (default cw)
//   ?ratio=4.5          minimum WCAG contrast ratio, 1-21 (default 4.5)
//   ?light=FFFFFF       light-mode background (default FFFFFF)
//   ?dark=111111        dark-mode background  (default 111111)
//
// primary/support/accent are the raw palette. `light` and `dark` give each color adjusted
// (lightness only) to meet `ratio` on that background, with the measured contrast. No single
// color can reach 4.5:1 on both white and a near-black, hence one variant per mode.
app.get("/:color", (c) => {
  const hex = parseColor(c.req.param("color"));
  if (!hex) {
    return c.json(
      { error: "invalid color: use 3 or 6 hex digits in the path, e.g. /api/golden-angle-palette/e4572e" },
      400,
    );
  }
  const direction = c.req.query("direction") ?? "cw";
  if (direction !== "cw" && direction !== "ccw") {
    return c.json({ error: 'invalid direction: use "cw" or "ccw"' }, 400);
  }
  const ratioParam = c.req.query("ratio");
  const ratio = ratioParam === undefined ? 4.5 : Number(ratioParam);
  if (ratioParam !== undefined && (ratioParam.trim() === "" || !Number.isFinite(ratio) || ratio < 1 || ratio > 21)) {
    return c.json({ error: "invalid ratio: use a number from 1 to 21, e.g. ratio=4.5" }, 400);
  }
  const light = parseColor(c.req.query("light") ?? "FFFFFF");
  const dark = parseColor(c.req.query("dark") ?? "111111");
  if (!light || !dark) {
    return c.json({ error: "invalid light/dark background: use 3 or 6 hex digits, e.g. light=ffffff&dark=111111" }, 400);
  }

  const p = palette(hex, direction === "ccw" ? -1 : 1);
  c.header("Cache-Control", "public, max-age=86400");
  return c.json({
    input: `#${hex.toUpperCase()}`,
    direction,
    primary: `#${p.primary}`,
    support: `#${p.support}`,
    accent: `#${p.accent}`,
    light: modeReport(p, light, ratio),
    dark: modeReport(p, dark, ratio),
  });
});

export default app;
