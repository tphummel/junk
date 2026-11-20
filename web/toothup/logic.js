// Pure logic for toothup: sessions, stats, calendar and import/export. No DOM, so the API test suite can import it.

/**
 * @typedef {{ id: string, start: number, seconds: number, flossed: boolean, quadrants: number }} Session
 *   start is epoch ms, seconds is time actually brushed, quadrants is 0-4 completed.
 */

export const QUADRANTS = ["Upper right", "Upper left", "Lower left", "Lower right"];
export const EXPORT_APP = "toothup";
export const EXPORT_VERSION = 1;

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

/** Validate and normalize one session; returns null if unusable. @param {any} s @returns {Session | null} */
export function normalizeSession(s) {
  if (!s || typeof s !== "object") return null;
  const start = Number(s.start);
  const seconds = Number(s.seconds);
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(seconds) || seconds < 0) return null;
  const quadrants = Math.max(0, Math.min(4, Math.round(Number(s.quadrants) || 0)));
  const id = typeof s.id === "string" && s.id ? s.id : `s${Math.round(start)}`;
  return { id, start: Math.round(start), seconds: Math.round(seconds), flossed: !!s.flossed, quadrants };
}

/** @param {Session[]} sessions */
export function buildExport(sessions, now = Date.now()) {
  return { app: EXPORT_APP, version: EXPORT_VERSION, exported: new Date(now).toISOString(), sessions };
}

/**
 * Parse an export file's text. Accepts the export object or a bare array of sessions.
 * @param {string} text @returns {{ sessions: Session[], skipped: number }}
 */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON");
  }
  if (data && !Array.isArray(data) && data.app !== EXPORT_APP) throw new Error("Not a toothup export");
  const list = Array.isArray(data) ? data : data?.sessions;
  if (!Array.isArray(list)) throw new Error("No sessions found");
  const sessions = [];
  let skipped = 0;
  for (const raw of list) {
    const s = normalizeSession(raw);
    if (s) sessions.push(s);
    else skipped++;
  }
  return { sessions, skipped };
}

/** Merge by id; incoming wins on conflict. Sorted by start. @param {Session[]} a @param {Session[]} b */
export function mergeSessions(a, b) {
  const map = new Map(a.map((s) => [s.id, s]));
  let added = 0;
  for (const s of b) {
    if (!map.has(s.id)) added++;
    map.set(s.id, s);
  }
  return { sessions: [...map.values()].sort((x, y) => x.start - y.start), added };
}

/** @param {Session[]} sessions @returns {Map<string, Session[]>} */
export function groupByDay(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const k = dayKey(s.start);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  }
  return map;
}

/** Consecutive days with a session, counting back from today (or from yesterday if today has none yet). */
export function currentStreak(sessions, today) {
  const days = groupByDay(sessions);
  let k = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(k)) {
    n++;
    k = addDays(k, -1);
  }
  return n;
}

export function longestStreak(sessions) {
  const keys = [...groupByDay(sessions).keys()].sort();
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

/** Stats over the last `days` days ending today. */
export function summarize(sessions, today, days) {
  const from = addDays(today, -(days - 1));
  const inRange = sessions.filter((s) => {
    const k = dayKey(s.start);
    return k >= from && k <= today;
  });
  const daysBrushed = new Set(inRange.map((s) => dayKey(s.start))).size;
  const flossDays = new Set(inRange.filter((s) => s.flossed).map((s) => dayKey(s.start))).size;
  const total = inRange.reduce((t, s) => t + s.seconds, 0);
  return {
    sessions: inRange.length,
    daysBrushed,
    flossDays,
    avgSeconds: inRange.length ? Math.round(total / inRange.length) : 0,
    perDay: Math.round((inRange.length / days) * 10) / 10,
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
