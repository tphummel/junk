// Import toothbrushing history from an Apple Health export (export.zip, or the export.xml inside it).
// Everything runs in the browser and streams the file, because export.xml is often hundreds of MB. Needs Blob,
// TextDecoderStream and DecompressionStream, so the API test suite can import it under Node too.
import { ROUTINE_STEPS } from "./logic.js";

const BRUSH_TYPE = "HKCategoryTypeIdentifierToothbrushingEvent";
const RECORD = new RegExp(`<Record\\b[^>]*\\btype="${BRUSH_TYPE}"[^>]*>`, "g");
/** Health has no per-surface data, so a session of at least this long counts as the whole routine. */
export const FULL_BRUSH_SECONDS = 60;

/** Parse Health's "2024-03-05 07:31:02 -0500" into epoch ms and the UTC offset in minutes; null if malformed. @param {string} s */
export function parseHealthDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const [y, mo, d, h, mi, sec, , oh, om] = m.slice(1).map(Number);
  const offset = (m[7] === "-" ? -1 : 1) * (oh * 60 + om);
  const ms = Date.UTC(y, mo - 1, d, h, mi, sec) - offset * 60000;
  return Number.isFinite(ms) ? { ms, offset } : null;
}

/** One brush event from a Record tag's attributes; null if its dates are unusable. @param {string} tag @returns {import("./logic.js").Event | null} */
export function brushFromRecord(tag) {
  const attrs = Object.fromEntries([...tag.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const a = parseHealthDate(attrs.startDate);
  const b = parseHealthDate(attrs.endDate);
  if (!a || !b || !(b.ms > a.ms)) return null;
  const seconds = Math.round((b.ms - a.ms) / 1000);
  const steps = seconds >= FULL_BRUSH_SECONDS ? ROUTINE_STEPS : Math.floor((seconds * ROUTINE_STEPS) / FULL_BRUSH_SECONDS);
  // The id depends only on the start time, so importing the same export twice, or the same brush from a watch and a phone, adds it once.
  return { id: `s${a.ms}`, type: "brush", start: a.ms, offset: a.offset, lat: null, lon: null, acc: null, seconds, steps };
}

/**
 * Pull brush events out of a chunk of export.xml. `rest` is an unfinished tag at the end of the chunk; prepend it to the next one.
 * @param {string} text @returns {{ events: import("./logic.js").Event[], skipped: number, rest: string }}
 */
export function scanBrushes(text) {
  const events = [];
  let skipped = 0;
  for (const [tag] of text.matchAll(RECORD)) {
    const e = brushFromRecord(tag);
    if (e) events.push(e);
    else skipped++;
  }
  const i = text.lastIndexOf("<");
  return { events, skipped, rest: i >= 0 && text.indexOf(">", i) === -1 ? text.slice(i) : "" };
}

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

/** Find export.xml in a zip by reading only its central directory, and return its still-compressed bytes. @param {Blob} file */
async function zipEntry(file) {
  const tailStart = Math.max(0, file.size - 70000);
  const tail = new DataView(await file.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a zip file");
  const count = u16(tail, eocd + 10);
  const dirSize = u32(tail, eocd + 12);
  const dirOffset = u32(tail, eocd + 16);
  if (count === 0xffff || dirOffset === 0xffffffff) throw new Error("Zip is too large for this importer; unzip it and choose export.xml");
  const dir = new DataView(await file.slice(dirOffset, dirOffset + dirSize).arrayBuffer());
  const names = new TextDecoder();
  for (let p = 0; p + 46 <= dir.byteLength && u32(dir, p) === 0x02014b50; ) {
    const nameLen = u16(dir, p + 28);
    const name = names.decode(new Uint8Array(dir.buffer, p + 46, nameLen));
    if (/(^|\/)export\.xml$/.test(name)) {
      const method = u16(dir, p + 10);
      const size = u32(dir, p + 20);
      const local = u32(dir, p + 42);
      if (size === 0xffffffff || local === 0xffffffff) throw new Error("Zip is too large for this importer; unzip it and choose export.xml");
      const head = new DataView(await file.slice(local, local + 30).arrayBuffer());
      const start = local + 30 + u16(head, 26) + u16(head, 28);
      if (method !== 0 && method !== 8) throw new Error("Unsupported zip compression");
      return { data: file.slice(start, start + size), deflated: method === 8 };
    }
    p += 46 + nameLen + u16(dir, p + 30) + u16(dir, p + 32);
  }
  throw new Error("No export.xml in this zip");
}

/**
 * Read every toothbrushing record in an Apple Health export.
 * @param {Blob} file export.zip or export.xml
 * @param {(fraction: number, found: number) => void} [onProgress]
 * @returns {Promise<{ events: import("./logic.js").Event[], skipped: number }>}
 */
export async function readHealthExport(file, onProgress = () => {}) {
  const isZip = new TextDecoder().decode(await file.slice(0, 2).arrayBuffer()) === "PK";
  const { data, deflated } = isZip ? await zipEntry(file) : { data: file, deflated: false };
  let read = 0;
  const counted = new TransformStream({
    transform(chunk, controller) {
      read += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  let stream = data.stream().pipeThrough(counted);
  if (deflated) stream = stream.pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  const found = new Map();
  let skipped = 0;
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const r = scanBrushes(rest + value);
    rest = r.rest;
    skipped += r.skipped;
    for (const e of r.events) found.set(e.id, e);
    onProgress(data.size ? Math.min(1, read / data.size) : 1, found.size);
  }
  if (rest) {
    const r = scanBrushes(rest);
    skipped += r.skipped;
    for (const e of r.events) found.set(e.id, e);
  }
  return { events: [...found.values()], skipped };
}
