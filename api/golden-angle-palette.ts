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

/** Accepts "e4572e", "#e4572e", "e52" (shorthand). Returns 6 hex digits or null. */
function parseColor(input: string): string | null {
  const v = input.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(v)) return v;
  if (/^[0-9a-f]{3}$/i.test(v)) return [...v].map((ch) => ch + ch).join("");
  return null;
}

const app = new Hono();

app.use("*", cors());

// GET /api/golden-angle-palette/e4572e            -> clockwise
// GET /api/golden-angle-palette/e4572e?direction=ccw  -> counter-clockwise
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
  const p = palette(hex, direction === "ccw" ? -1 : 1);
  c.header("Cache-Control", "public, max-age=86400");
  return c.json({
    input: `#${hex.toUpperCase()}`,
    direction,
    primary: `#${p.primary}`,
    support: `#${p.support}`,
    accent: `#${p.accent}`,
  });
});

export default app;
