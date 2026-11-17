#!/usr/bin/env node
// Usage: node extract.mjs <export-dir> [--include-secrets] [--covers <out-dir>]
// <export-dir> is an already-extracted export (unzip it somewhere first).
import { readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { decodeExport, wantedPath } from './x4.mjs';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--covers');
const includeSecrets = args.includes('--include-secrets');
const ci = args.indexOf('--covers');
const coversDir = ci >= 0 ? args[ci + 1] : null;
if (!dir) { console.error('usage: extract.mjs <export-dir> [--include-secrets] [--covers <out-dir>]'); process.exit(2); }

const files = new Map();
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const rel = relative(dir, p).split('\\').join('/');
      if (wantedPath(rel, { includeSettings: includeSecrets })) files.set(rel, new Uint8Array(readFileSync(p)));
    }
  }
})(dir);

const out = decodeExport(files, { includeSecrets });
if (coversDir) {
  mkdirSync(coversDir, { recursive: true });
  for (const b of out.books) {
    const c = files.get(`metadata/epub/${b.id}/cover.jpg`);
    if (c) writeFileSync(join(coversDir, `${b.id}.jpg`), c);
  }
}
console.log(JSON.stringify(out, null, 2));
