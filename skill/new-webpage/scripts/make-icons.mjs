#!/usr/bin/env node
// Render an emoji to the icon files a webpage needs (ADR 0007). Usage:
//   node skill/new-webpage/scripts/make-icons.mjs <name> <emoji> [background-hex]
// Writes web/<name>/{apple-touch-icon.png,icon-192.png,icon-512.png,icon.svg}. Needs Playwright with Chromium
// (`npm i -D playwright` somewhere, or `NODE_PATH=$(npm root -g)`); nothing here runs at deploy time.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [name, emoji, bg = "#111111"] = process.argv.slice(2);
if (!name || !emoji || !/^#[0-9a-fA-F]{6}$/.test(bg)) {
  console.error("usage: make-icons.mjs <name> <emoji> [#background]");
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)("playwright");
const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../../web", name);
mkdirSync(out, { recursive: true });

writeFileSync(
  `${out}/icon.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="50" font-size="85" text-anchor="middle" dominant-baseline="central">${emoji}</text></svg>\n`,
);

const browser = await chromium.launch();
for (const [file, size] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  // Solid background (iOS fills transparency with black); ~62% emoji stays inside the maskable safe zone.
  await page.setContent(
    `<body style="margin:0;background:${bg};display:grid;place-items:center;height:100vh">` +
      `<div style="font-size:${Math.round(size * 0.62)}px;line-height:1;font-family:'Noto Color Emoji','Apple Color Emoji',sans-serif">${emoji}</div></body>`,
  );
  await page.screenshot({ path: `${out}/${file}` });
}
await browser.close();
console.log(`wrote icons to ${out}`);
