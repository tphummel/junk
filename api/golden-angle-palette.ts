import { Hono } from "hono";
import { cors } from "hono/cors";
// Shared with the page (web/golden-angle-palette/index.html); plain JS, no build step (ADR 0002).
import { contrastRatio, fitContrast, palette } from "../web/golden-angle-palette/palette.js";

/** Ratios are truncated, never rounded up, so a reported 4.50 really is >= 4.5. */
const floor2 = (n: number) => Math.floor(n * 100) / 100;

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
