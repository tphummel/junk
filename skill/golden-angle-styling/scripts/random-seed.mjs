#!/usr/bin/env node
// Prints a random seed color for the golden-angle palette: random hue, fixed saturation and
// a mid lightness, so the per-mode contrast adjustment (done by the API) is small either way.
//
//   node skill/golden-angle-styling/scripts/random-seed.mjs [--s 0.65] [--l 0.50] [--hue 0-359]
//
// --hue pins the hue (useful for testing); omit it for a random one.
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : dflt;
};
const S = arg("s", 0.65);
const L = arg("l", 0.5);
const hue = arg("hue", Math.floor(Math.random() * 360));

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

console.log(`#${hslToHex(hue, S, L)}`);
console.error(`hue ${hue}°, s=${S}, l=${L}`);
