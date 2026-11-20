// Pure logic for toothup: sessions, stats, calendar and import/export. No DOM, so the API test suite can import it.

/**
 * One thing that happened, with a timestamp. Floss and mouthwash are their own events, not flags on a brush.
 * @typedef {{ id: string, type: "brush" | "floss" | "mouthwash", start: number, seconds: number, steps: number }} Event
 *   start is epoch ms. seconds and steps (0-9 completed, see STEPS) only matter for brush events and are 0 otherwise.
 */

export const QUADRANTS = ["Upper right", "Upper left", "Lower left", "Lower right"];
export const STEP_SECONDS = 15;
export const TONGUE_SECONDS = 5;

/**
 * The brushing routine: each quadrant's outer (facial) then inner (lingual) surfaces, then the tongue.
 * @typedef {{ label: string, quadrant: number | null, surface: "facial" | "lingual" | "tongue", seconds: number }} Step
 * @type {Step[]}
 */
export const STEPS = [
  ...QUADRANTS.flatMap((name, quadrant) =>
    /** @type {const} */ (["facial", "lingual"]).map((surface) => ({
      label: `${name} ${surface}`, quadrant, surface, seconds: STEP_SECONDS,
    }))),
  { label: "Tongue", quadrant: null, surface: "tongue", seconds: TONGUE_SECONDS },
];
export const TOTAL_SECONDS = STEPS.reduce((t, st) => t + st.seconds, 0);
export const TYPES = ["brush", "floss", "mouthwash"];
export const EXPORT_APP = "toothup";
export const EXPORT_VERSION = 2;
const ID_PREFIX = { brush: "s", floss: "f", mouthwash: "m" }; // brush keeps "s" so v1 ids stay stable

const pad = (n) => String(n).padStart(2, "0");

/** Local calendar day key, YYYY-MM-DD. @param {number | Date} t */
export function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** @param {string} key @returns {Date} local midnight */
export function parseDay(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** @param {string} key @param {number} n days to add */
export function addDays(key, n) {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Validate and normalize one event; returns null if unusable. A missing type means brush (v1 data). @param {any} e @returns {Event | null} */
export function normalizeEvent(e) {
  if (!e || typeof e !== "object") return null;
  const type = e.type === undefined ? "brush" : e.type;
  if (!TYPES.includes(type)) return null;
  const start = Number(e.start);
  if (!Number.isFinite(start) || start <= 0) return null;
  const brush = type === "brush";
  const seconds = brush ? Number(e.seconds) : 0;
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  // v1 recorded `quadrants` (0-4, outer and inner together); that is two steps each.
  const steps = !brush ? 0 : Math.max(0, Math.min(STEPS.length, Math.round(e.steps !== undefined ? Number(e.steps) || 0 : (Number(e.quadrants) || 0) * 2)));
  const id = typeof e.id === "string" && e.id ? e.id : `${ID_PREFIX[type]}${Math.round(start)}`;
  return { id, type, start: Math.round(start), seconds: Math.round(seconds), steps };
}

/**
 * Normalize a list of raw events. v1 sessions carried `flossed: true`; each becomes a brush event plus a separate
 * floss event stamped at the end of the brush (the real time was not recorded).
 * @param {any[]} list @returns {{ events: Event[], skipped: number }}
 */
export function normalizeAll(list) {
  const events = [];
  let skipped = 0;
  for (const raw of list) {
    const e = normalizeEvent(raw);
    if (!e) {
      skipped++;
      continue;
    }
    events.push(e);
    if (e.type === "brush" && raw.type === undefined && raw.flossed) {
      events.push({ id: `f${e.start}`, type: "floss", start: e.start + e.seconds * 1000, seconds: 0, steps: 0 });
    }
  }
  return { events, skipped };
}

/** @param {Event[]} events */
export function buildExport(events, now = Date.now()) {
  return { app: EXPORT_APP, version: EXPORT_VERSION, exported: new Date(now).toISOString(), events };
}

/**
 * Parse an export file's text. Accepts a v2 export (`events`), a v1 export (`sessions`) or a bare array.
 * @param {string} text @returns {{ events: Event[], skipped: number }}
 */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON");
  }
  if (data && !Array.isArray(data) && data.app !== EXPORT_APP) throw new Error("Not a toothup export");
  const list = Array.isArray(data) ? data : data?.events ?? data?.sessions;
  if (!Array.isArray(list)) throw new Error("No events found");
  return normalizeAll(list);
}

/** Merge by id; incoming wins on conflict. Sorted by start. @param {Event[]} a @param {Event[]} b */
export function mergeEvents(a, b) {
  const map = new Map(a.map((s) => [s.id, s]));
  let added = 0;
  for (const s of b) {
    if (!map.has(s.id)) added++;
    map.set(s.id, s);
  }
  return { events: [...map.values()].sort((x, y) => x.start - y.start), added };
}

/** Unused id for a new event of `type` at `start` (ids derive from the timestamp). @param {Event[]} events */
export function freshStart(events, type, start) {
  const ids = new Set(events.map((e) => e.id));
  while (ids.has(`${ID_PREFIX[type]}${start}`)) start += 1;
  return start;
}

/** Events grouped by local day, optionally only one type. @param {Event[]} events @param {Event["type"]} [type] @returns {Map<string, Event[]>} */
export function groupByDay(events, type) {
  const map = new Map();
  for (const s of events) {
    if (type && s.type !== type) continue;
    const k = dayKey(s.start);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  }
  return map;
}

/** Consecutive days with a session, counting back from today (or from yesterday if today has none yet). */
export function currentStreak(sessions, today) {
  const days = groupByDay(sessions, "brush");
  let k = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(k)) {
    n++;
    k = addDays(k, -1);
  }
  return n;
}

export function longestStreak(sessions) {
  const keys = [...groupByDay(sessions, "brush").keys()].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const k of keys) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return best;
}

/** Stats over the last `days` days ending today. @param {Event[]} events */
export function summarize(events, today, days) {
  const from = addDays(today, -(days - 1));
  const inRange = events.filter((s) => {
    const k = dayKey(s.start);
    return k >= from && k <= today;
  });
  const of = (type) => inRange.filter((s) => s.type === type);
  const distinctDays = (list) => new Set(list.map((s) => dayKey(s.start))).size;
  const brushes = of("brush");
  const total = brushes.reduce((t, s) => t + s.seconds, 0);
  return {
    brushes: brushes.length,
    daysBrushed: distinctDays(brushes),
    flossDays: distinctDays(of("floss")),
    mouthwashDays: distinctDays(of("mouthwash")),
    avgSeconds: brushes.length ? Math.round(total / brushes.length) : 0,
    perDay: Math.round((brushes.length / days) * 10) / 10,
  };
}

/** Weeks (Sunday first) of day keys for a month; days outside the month are null. @param {number} year @param {number} month 0-11 */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const count = new Date(year, month + 1, 0).getDate();
  const cells = Array(first.getDay()).fill(null);
  for (let d = 1; d <= count; d++) cells.push(`${year}-${pad(month + 1)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** @param {number} s seconds @returns {string} m:ss */
export function formatClock(s) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${pad(t % 60)}`;
}
