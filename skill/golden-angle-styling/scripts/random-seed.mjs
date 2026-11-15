#!/usr/bin/env node
// Prints a random seed color for the golden-angle palette: random hue, fixed saturation,
// with lightness adjusted until the seed meets a contrast ratio against a background
// (darkened for light backgrounds, lightened for dark ones).
//
//   node skill/golden-angle-styling/scripts/random-seed.mjs [--s 0.65] [--l 0.40] [--bg FFFFFF] [--ratio 4.5] [--hue 0-359]
//
// --hue pins the hue (useful for testing); omit it for a random one.
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const S = Number(arg("s", 0.65));
const BG = arg("bg", "FFFFFF").replace(/^#/, "");
const RATIO = Number(arg("ratio", 4.5));
const darkBg = (() => { const n = parseInt(BG, 16); return 0.2126 * ((n >> 16) / 255) + 0.7152 * (((n >> 8) & 255) / 255) + 0.0722 * ((n & 255) / 255) < 0.4; })();
const startL = Number(arg("l", darkBg ? 0.6 : 0.4));
const hue = arg("hue") !== undefined ? Number(arg("hue")) : Math.floor(Math.random() * 360);

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

const step = darkBg ? 0.01 : -0.01;
let l = startL;
let hex = hslToHex(hue, S, l);
while (contrast(hex, BG) < RATIO && l > 0.1 && l < 0.9) {
  l = Math.round((l + step) * 100) / 100;
  hex = hslToHex(hue, S, l);
}
const ok = contrast(hex, BG) >= RATIO;
console.log(`#${hex}`);
console.error(`hue ${hue}°, s=${S}, l=${l}; contrast vs #${BG}: ${contrast(hex, BG).toFixed(2)}:1${ok ? "" : " (below target; try a different --hue)"}`);
