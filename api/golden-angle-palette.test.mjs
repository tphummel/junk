// Tests for the shared palette module (web/golden-angle-palette/palette.js, used by both the page
// and the API) and for the API route. Run with `npm test`.
import assert from "node:assert/strict";
import test from "node:test";
import app from "./golden-angle-palette.ts";
import { contrastRatio, fitContrast, hsl2hex, palette, rgb2hsl } from "../web/golden-angle-palette/palette.js";

const randomHexes = Array.from({ length: 3000 }, () => Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, "0"));
const hexes = ["000000", "FFFFFF", "808080", "FF0000", "00FF00", "0000FF", "E4572E", "FFFF00", "00FFFF", "FF00FF", ...randomHexes];
const backgrounds = ["FFFFFF", "111111", "FAFAFA", "000000", "1A1A2E", "F5F0E6"];

test("palette: known values for the default seed", () => {
  assert.deepEqual(palette("E4572E", 1), { primary: "E4572E", support: "AD7565", accent: "2EE48C" });
  assert.deepEqual(palette("e4572e", -1), { primary: "E4572E", support: "AD7565", accent: "2E3AE4" });
});

test("palette: support keeps hue and lightness, accent keeps saturation and lightness", () => {
  const [h, s, l] = rgb2hsl(0xe4, 0x57, 0x2e);
  const hsl = (hex) => rgb2hsl(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4), 16));
  const p = palette("E4572E", 1);
  const [sh, ss, sl] = hsl(p.support);
  const [ah, as, al] = hsl(p.accent);
  assert.ok(Math.abs(sh - h) < 1 && Math.abs(sl - l) < 0.01 && Math.abs(ss - s * 0.4) < 0.01);
  assert.ok(Math.abs(as - s) < 0.01 && Math.abs(al - l) < 0.01);
  assert.ok(Math.abs(((ah - h + 360) % 360) - 137.5) < 1);
});

test("hsl2hex: round-trips primaries", () => {
  assert.equal(hsl2hex(0, 1, 0.5), "FF0000");
  assert.equal(hsl2hex(120, 1, 0.5), "00FF00");
  assert.equal(hsl2hex(-120, 1, 0.5), "0000FF");
});

test("contrast ratio: known values", () => {
  assert.equal(contrastRatio("000000", "FFFFFF"), 21);
  assert.equal(contrastRatio("FFFFFF", "FFFFFF"), 1);
  assert.ok(Math.abs(contrastRatio("E4572E", "FFFFFF") - 3.68) < 0.01);
});

test("fit: every color reaches the target on every background, in both directions", () => {
  for (const hex of hexes) {
    for (const bg of backgrounds) {
      for (const target of [3, 4.5, 7]) {
        const f = fitContrast(hex, bg, target);
        assert.ok(f.meets, `${hex} on ${bg} cannot reach ${target}:1`);
        assert.ok(contrastRatio(f.hex, bg) >= target, `${hex} on ${bg}: ${f.hex} is below ${target}:1`);
      }
    }
  }
});

test("fit: a passing color is unchanged; a failing one changes lightness only", () => {
  const same = fitContrast("e4572e", "111111", 4.5);
  assert.deepEqual([same.hex, same.adjusted], ["E4572E", false]);
  const f = fitContrast("E4572E", "FFFFFF", 4.5);
  assert.equal(f.hex, "D4451B");
  assert.ok(f.adjusted && f.ratio >= 4.5 && f.rawRatio < 4.5);
  const [h0, s0] = rgb2hsl(0xe4, 0x57, 0x2e);
  const [h1, s1] = rgb2hsl(parseInt(f.hex.slice(0, 2), 16), parseInt(f.hex.slice(2, 4), 16), parseInt(f.hex.slice(4), 16));
  assert.ok(Math.abs(h1 - h0) < 2 && Math.abs(s1 - s0) < 0.03, "hue and saturation are kept (to 8-bit rounding)");
});

test("fit: a background that cannot reach the ratio is reported, not hidden", () => {
  const f = fitContrast("E4572E", "777777", 7);
  assert.equal(f.meets, false);
  assert.ok(f.ratio < 7);
});

test("labels: the better of black and white is always at least 4.58:1", () => {
  for (const hex of hexes) {
    assert.ok(Math.max(contrastRatio(hex, "FFFFFF"), contrastRatio(hex, "000000")) >= 4.58, hex);
  }
});

const get = async (path) => {
  const res = await app.request(`/${path}`);
  return { res, body: await res.json() };
};

test("api: default response", async () => {
  const { res, body } = await get("e4572e");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.equal(res.headers.get("cache-control"), "public, max-age=86400");
  assert.deepEqual([body.input, body.direction, body.primary, body.support, body.accent], ["#E4572E", "cw", "#E4572E", "#AD7565", "#2EE48C"]);
  assert.deepEqual(body.light.primary, { color: "#D4451B", ratio: 4.5, rawRatio: 3.68, adjusted: true, meets: true });
  assert.deepEqual(body.dark.primary, { color: "#E4572E", ratio: 5.12, rawRatio: 5.12, adjusted: false, meets: true });
  assert.equal(body.light.background, "#FFFFFF");
  assert.equal(body.dark.background, "#111111");
});

test("api: every returned color meets the ratio in both modes", async () => {
  for (const hex of ["e4572e", "00ff66", "ffff00", "123", "000000", "ffffff", "808080", ...randomHexes.slice(0, 50)]) {
    for (const q of ["", "?direction=ccw", "?ratio=7", "?light=faf6ee&dark=1a1a2e"]) {
      const { body } = await get(`${hex}${q}`);
      for (const mode of [body.light, body.dark]) {
        for (const k of ["primary", "support", "accent"]) {
          assert.ok(mode[k].meets, `${hex}${q} ${k}`);
          assert.ok(mode[k].ratio >= mode.minRatio, `${hex}${q} ${k} ${mode[k].ratio} < ${mode.minRatio}`);
        }
      }
    }
  }
});

test("api: direction, ratio, shorthand, # prefix and custom backgrounds", async () => {
  assert.equal((await get("e4572e?direction=ccw")).body.accent, "#2E3AE4");
  assert.equal((await get("e4572e?ratio=7")).body.light.minRatio, 7);
  assert.equal((await get("e52")).body.input, "#EE5522");
  assert.equal((await get("%23E4572E")).body.input, "#E4572E");
  const custom = (await get("2e8be4?light=faf6ee&dark=1a1a2e")).body;
  assert.deepEqual([custom.light.background, custom.dark.background], ["#FAF6EE", "#1A1A2E"]);
});

test("api: bad input gets a 400 with a JSON error", async () => {
  for (const path of ["nothex", "zzz", "e4572e?direction=up", "e4572e?ratio=0.5", "e4572e?ratio=22", "e4572e?ratio=abc", "e4572e?ratio=", "e4572e?light=zzz", "e4572e?dark=12"]) {
    const { res, body } = await get(path);
    assert.equal(res.status, 400, path);
    assert.ok(typeof body.error === "string" && body.error.length > 0, path);
  }
});
