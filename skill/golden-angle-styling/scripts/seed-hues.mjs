#!/usr/bin/env node
// Lists the golden-angle seeds already used by experiments under web/ and suggests
// a new seed whose hue sits in the largest gap between them.
//
//   node skill/golden-angle-styling/scripts/seed-hues.mjs [--s 0.65] [--l 0.40]
//
// Seeds are found via the marker comment:  /* golden-angle seed: #E4572E cw */
import fs from "node:fs";
import path from "node:path";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : dflt;
};
const S = arg("s", 0.65);
const L = arg("l", 0.4);
const root = path.resolve(import.meta.dirname, "../../../web");

function hue(hex) {
  const n = parseInt(hex, 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const n = parseInt(hex, 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

const seeds = [];
for (const f of fs.readdirSync(root, { recursive: true })) {
  const p = path.join(root, f);
  if (!/\.(html|css|svelte|js)$/.test(p) || !fs.statSync(p).isFile()) continue;
  for (const m of fs.readFileSync(p, "utf8").matchAll(/golden-angle seed: #([0-9a-f]{6}) (cw|ccw)/gi)) {
    seeds.push({ file: path.relative(root, p), hex: m[1].toUpperCase(), dir: m[2], hue: hue(m[1]) });
  }
}

seeds.sort((a, b) => a.hue - b.hue);
console.log(seeds.length ? "Existing seeds (by hue):" : "No seeds in use yet.");
for (const s of seeds) console.log(`  ${s.hue.toFixed(0).padStart(3)}°  #${s.hex} ${s.dir.padEnd(3)}  web/${s.file}`);

let suggested = 15;
if (seeds.length) {
  let best = -1;
  for (let i = 0; i < seeds.length; i++) {
    const a = seeds[i].hue;
    const b = i + 1 < seeds.length ? seeds[i + 1].hue : seeds[0].hue + 360;
    if (b - a > best) { best = b - a; suggested = (a + (b - a) / 2) % 360; }
  }
}
const hex = hslToHex(suggested, S, L);
console.log(`\nSuggested seed: #${hex}  (hue ${suggested.toFixed(0)}°, s=${S}, l=${L})`);
console.log(`  contrast vs #FFFFFF: ${contrast(hex, "FFFFFF").toFixed(2)}:1   vs #111111: ${contrast(hex, "111111").toFixed(2)}:1`);
