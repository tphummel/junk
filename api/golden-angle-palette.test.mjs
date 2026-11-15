// The palette and contrast logic exists twice: inline in web/golden-angle-palette/index.html
// and in api/golden-angle-palette.ts. This test runs both over the same inputs and fails if
// they ever disagree, and checks the contrast guarantee itself.
//
//   npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { contrastRatio, fitContrast, palette } from "./golden-angle-palette.ts";

const html = fs.readFileSync(new URL("../web/golden-angle-palette/index.html", import.meta.url), "utf8");
// Everything before `const $=` is the DOM-free logic (palette, contrast, fit).
const logic = html.split("<script>")[1].split("const $=")[0];
const page = {};
vm.createContext(page);
vm.runInContext(`${logic};this.palette=palette;this.ratio=ratio;this.fit=fit;`, page);

const hexes = [
  "000000", "FFFFFF", "808080", "FF0000", "00FF00", "0000FF", "E4572E", "FFFF00", "00FFFF", "FF00FF",
  ...Array.from({ length: 3000 }, () => Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, "0")),
];
const backgrounds = ["FFFFFF", "111111", "FAFAFA", "000000", "1A1A2E", "F5F0E6"];

test("palette matches the page", () => {
  for (const hex of hexes) {
    for (const dir of [1, -1]) {
      // Compare serialized: the page runs in a vm context, so its objects have a different prototype.
      assert.equal(JSON.stringify(palette(hex, dir)), JSON.stringify(page.palette("#" + hex, dir)), `${hex} dir ${dir}`);
    }
  }
});

test("contrast ratio matches the page", () => {
  for (const hex of hexes) {
    for (const bg of backgrounds) {
      assert.equal(contrastRatio(hex, bg), page.ratio(hex, bg), `${hex} on ${bg}`);
    }
  }
});

test("fit matches the page and meets the target", () => {
  for (const hex of hexes) {
    for (const bg of backgrounds) {
      for (const target of [3, 4.5, 7]) {
        const a = fitContrast(hex, bg, target);
        const b = page.fit(hex, bg, target);
        assert.equal(a.hex, b.hex, `${hex} on ${bg} @${target}`);
        assert.equal(a.adjusted, b.adjusted);
        assert.ok(a.meets, `${hex} on ${bg} cannot reach ${target}:1`);
        assert.ok(contrastRatio(a.hex, bg) >= target, `${hex} on ${bg}: ${a.hex} is below ${target}:1`);
      }
    }
  }
});

test("fit keeps a passing color unchanged and only changes lightness", () => {
  assert.equal(fitContrast("E4572E", "111111", 4.5).hex, "E4572E");
  assert.equal(fitContrast("E4572E", "111111", 4.5).adjusted, false);
  const f = fitContrast("E4572E", "FFFFFF", 4.5);
  assert.equal(f.adjusted, true);
  assert.ok(f.ratio >= 4.5 && f.rawRatio < 4.5);
});

test("labels: best of black/white always reaches at least 4.58:1", () => {
  for (const hex of hexes) {
    assert.ok(Math.max(contrastRatio(hex, "FFFFFF"), contrastRatio(hex, "000000")) >= 4.58, hex);
  }
});
