// Pure decoder for an Xteink X4 (CrossPoint-style firmware) SD/flash export.
// No fs/Node APIs: input is a Map<string, Uint8Array> of export-relative paths
// (e.g. "metadata/books.bin"), so the same module can run in a browser later.
//
// Formats are reverse engineered from one export plus the upstream CrossPoint
// source (older binary layout). Fields marked "guess" are unverified.

const td = new TextDecoder('utf-8');

class Reader {
  constructor(bytes) {
    this.b = bytes;
    this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.o = 0;
  }
  get left() { return this.b.length - this.o; }
  u8() { const x = this.v.getUint8(this.o); this.o += 1; return x; }
  u16() { const x = this.v.getUint16(this.o, true); this.o += 2; return x; }
  i16() { const x = this.v.getInt16(this.o, true); this.o += 2; return x; }
  u32() { const x = this.v.getUint32(this.o, true); this.o += 4; return x; }
  f32() { const x = this.v.getFloat32(this.o, true); this.o += 4; return x; }
  // u32 length + bytes (the firmware's serialization::writeString)
  str() {
    const n = this.u32();
    if (n > this.left) throw new RangeError(`string length ${n} exceeds remaining ${this.left}`);
    const s = td.decode(this.b.subarray(this.o, this.o + n));
    this.o += n;
    return s;
  }
}

const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

// metadata/books.bin: library index.
// u8 version(=2), u32 nextId? (guess), u32 count, then per book:
// str path, str title, str author, u32 id (guess), u8 type (guess; 2 for epub?)
export function parseBooks(bytes) {
  const r = new Reader(bytes);
  const version = r.u8();
  const field1 = r.u32();
  const count = r.u32();
  const books = [];
  for (let i = 0; i < count; i++) {
    books.push({ path: r.str(), title: r.str(), author: r.str(), id: r.u32(), type: r.u8() });
  }
  return { version, field1, books };
}

// metadata/recent.bin: u8 version(=4), u8 count, per entry:
// str path, str cacheDir, str title, str author, f32 progress fraction (verified vs progress.bin)
export function parseRecent(bytes) {
  const r = new Reader(bytes);
  const version = r.u8();
  const count = r.u8();
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({ path: r.str(), cacheDir: r.str(), title: r.str(), author: r.str(), percent: round(r.f32() * 100) });
  }
  return { version, entries };
}

// system/state.bin: u8 version(=2), str openEpubPath, u8 (guess: flag)
export function parseState(bytes) {
  const r = new Reader(bytes);
  const version = r.u8();
  const openEpubPath = r.str();
  const flag = r.left ? r.u8() : null;
  return { version, openEpubPath, flag };
}

// metadata/epub/<id>/progress.bin (16 bytes), as observed:
// u16 spine, u16 page, u16 pageCount?, u16 ?, u32 cumulativeBytes, f32 percent
// Two of four books have u16 page=0 and pageCount-like value in the next u16
// instead; layout is ambiguous, so raw u16s are kept alongside.
export function parseProgress(bytes) {
  const r = new Reader(bytes);
  const u16s = [r.u16(), r.u16(), r.u16(), r.u16()];
  const cumulativeBytes = r.u32();
  const percent = r.f32();
  return { spine: u16s[0], rawU16: u16s, cumulativeBytes, percent: round(percent) };
}

// metadata/epub/<id>/statistics.bin. Layout confirmed against the firmware source
// (obijuankenobiii/inx src/state/Statistics.cpp, BookReadingStats, STATS_FILE_VERSION 2):
// u32 magic "STAT", u32 version, u32 totalReadingTimeMs, u32 totalPagesRead (pages with 5 s+ dwell),
// u32 totalChaptersRead, u32 lastReadTimeMs (millis() = uptime since boot, NOT a date),
// f32 progressPercent, u16 lastSpineIndex, u16 lastPageNumber, u32 avgPageTimeMs,
// u32 sessionCount (counted after 45 s of reading), str path, str title, str author.
export function parseBookStats(bytes) {
  const r = new Reader(bytes);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== 'TATS') throw new Error(`bad stats magic ${magic}`);
  r.o = 4;
  const version = r.u32();
  const readingMs = r.u32();
  const pagesRead = r.u32();
  const chaptersRead = r.u32();
  const lastReadUptimeMs = r.u32();
  const percent = r.f32();
  const spine = r.u16();
  const page = r.u16();
  const avgPageMs = r.u32();
  const sessions = version >= 2 ? r.u32() : 0;
  return {
    version, readingMs, readingMinutes: round(readingMs / 60000, 1), pagesRead, chaptersRead,
    lastReadUptimeMs, percent: round(percent), spine, page, avgPageMs, sessions,
    cacheDir: r.str(), title: r.str(), author: r.str(),
  };
}

// system/statistics.bin: GlobalReadingStats, six u32s (confirmed: fields 2-5 equal the sums over the
// per-book files; the book open at export time was not yet included in the totals).
// u32 totalBooksStarted, totalBooksFinished, totalReadingTimeMs, totalPagesRead, totalChaptersRead, totalSessions
export function parseSystemStats(bytes) {
  const r = new Reader(bytes);
  const f = [];
  while (r.left >= 4) f.push(r.u32());
  const [booksStarted, booksFinished, totalReadingMs, totalPagesRead, totalChaptersRead, totalSessions] = f;
  return { booksStarted, booksFinished, totalReadingMs, totalReadingHours: round(totalReadingMs / 3600000, 1), totalPagesRead, totalChaptersRead, totalSessions };
}

// metadata/epub/<id>/book.bin: u8 version(=6), u32 lutOffset, u16 spineCount, u16 tocCount,
// u16 ? (always 1 so far), str title, str author, str language, str coverHref, str textRefHref,
// u32[spineCount+tocCount] LUT, then spine entries (str href, u32 cumulativeSize, i16 tocIndex)
// and toc entries (str title, str href, str anchor, u8 level, i16 spineIndex).
// Exports may truncate the file (8192 bytes seen), so entry parsing is best-effort.
export function parseBookCache(bytes) {
  const r = new Reader(bytes);
  const version = r.u8();
  const lutOffset = r.u32();
  const spineCount = r.u16();
  const tocCount = r.u16();
  const unknown = r.u16();
  const out = {
    version, spineCount, tocCount, unknown,
    title: r.str(), author: r.str(), language: r.str(), coverHref: r.str(), textRefHref: r.str(),
    spine: [], toc: [], truncated: false,
  };
  r.o = lutOffset;
  const lut = [];
  for (let i = 0; i < spineCount + tocCount; i++) lut.push(r.u32());
  try {
    for (let i = 0; i < spineCount; i++) {
      r.o = lut[i];
      out.spine.push({ href: r.str(), cumulativeSize: r.u32(), tocIndex: r.i16() });
    }
    for (let i = 0; i < tocCount; i++) {
      r.o = lut[spineCount + i];
      out.toc.push({ title: r.str(), href: r.str(), anchor: r.str(), level: r.u8(), spineIndex: r.i16() });
    }
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    out.truncated = true;
  }
  return out;
}

// system/settings.bin: layout not decoded. Only the length-prefixed strings are
// read (OPDS url, username, password in order seen). Password redacted by default.
export function parseSettings(bytes, { includeSecrets = false } = {}) {
  const r = new Reader(bytes);
  const strings = [];
  while (r.left > 4) {
    const start = r.o;
    const n = r.u32();
    const ok = n > 0 && n <= r.left && bytes.subarray(r.o, r.o + n).every((c) => c >= 32 && c < 127);
    if (ok) { r.o = start; strings.push(r.str()); } else { r.o = start + 1; }
  }
  const [opdsUrl, opdsUsername, opdsPassword] = strings;
  return {
    size: bytes.length, opdsUrl, opdsUsername,
    opdsPassword: includeSecrets ? opdsPassword : opdsPassword === undefined ? undefined : '[redacted]',
  };
}

// system/wifi.bin holds credentials; only shape is reported, never contents.
export function describeWifi(bytes) {
  return { size: bytes.length, contents: '[omitted]' };
}

const has = (files, p) => files.has(p);
const attempt = (fn) => { try { return fn(); } catch (e) { return { error: String(e.message || e) }; } };

// Which files the decoder reads. A loader (CLI or browser) should only read paths where
// this returns true: skips sections/ and images/ (the bulk of the data) and never reads
// wifi.bin. settings.bin is opt-in because it holds credentials and no reading data.
export function wantedPath(path, { includeSettings = false } = {}) {
  const p = path.replace(/^\.?\//, '');
  if (/(^|\/)\.?system\/settings\.bin$/.test(p)) return includeSettings;
  if (/(^|\/)\.?system\/(state|statistics)\.bin$/.test(p)) return true;
  if (/(^|\/)\.?metadata\/(books|recent)\.bin$/.test(p)) return true;
  return /(^|\/)\.?metadata\/epub\/[^/]+\/(book|progress|statistics)\.bin$/.test(p)
    || /(^|\/)\.?metadata\/epub\/[^/]+\/cover\.jpg$/.test(p);
}

// Accept both the SD card layout (".metadata/", ".system/") and dot-less copies, with or
// without a leading "./" or a single wrapping folder.
export function normalizePaths(files) {
  const out = new Map();
  for (const [p, b] of files) {
    const i = p.search(/(^|\/)\.?(metadata|system)\//);
    if (i < 0) continue;
    out.set(p.slice(i).replace(/^\/?\.?/, ''), b);
  }
  return out;
}

export function decodeExport(rawFiles, opts = {}) {
  const files = normalizePaths(rawFiles);
  const result = { system: {}, library: null, recent: null, books: [] };
  if (has(files, 'system/settings.bin')) result.system.settings = attempt(() => parseSettings(files.get('system/settings.bin'), opts));
  if (has(files, 'system/state.bin')) result.system.state = attempt(() => parseState(files.get('system/state.bin')));
  if (has(files, 'system/statistics.bin')) result.system.statistics = attempt(() => parseSystemStats(files.get('system/statistics.bin')));
  if (has(files, 'system/wifi.bin')) result.system.wifi = describeWifi(files.get('system/wifi.bin'));
  if (has(files, 'metadata/books.bin')) result.library = attempt(() => parseBooks(files.get('metadata/books.bin')));
  if (has(files, 'metadata/recent.bin')) result.recent = attempt(() => parseRecent(files.get('metadata/recent.bin')));

  const ids = new Set();
  for (const p of files.keys()) {
    const m = /^metadata\/epub\/([^/]+)\//.exec(p);
    if (m) ids.add(m[1]);
  }
  const pathByDir = new Map((result.recent?.entries ?? []).map((e) => [e.cacheDir.split('/').pop(), e.path]));
  for (const id of [...ids].sort()) {
    const base = `metadata/epub/${id}/`;
    const f = (n) => files.get(base + n);
    const sections = [...files.keys()].filter((p) => p.startsWith(base + 'sections/')).length;
    const images = [...files.keys()].filter((p) => p.startsWith(base + 'images/')).map((p) => p.slice(base.length));
    const book = { id, path: pathByDir.get(id) ?? null, sectionFiles: sections, images, hasCover: !!f('cover.jpg') };
    if (f('book.bin')) book.cache = attempt(() => parseBookCache(f('book.bin')));
    if (f('progress.bin')) book.progress = attempt(() => parseProgress(f('progress.bin')));
    if (f('statistics.bin')) book.statistics = attempt(() => parseBookStats(f('statistics.bin')));
    result.books.push(book);
  }
  return result;
}
