// Pure logic for toothup: events, stats, calendar and import/export. No DOM, so the API test suite can import it.

/**
 * One thing that happened, with a timestamp. Floss and mouthwash are their own events, not flags on a brush.
 * start is epoch ms. offset is the UTC offset in minutes (east positive) where you were at the time, so an event
 * stays on the calendar day you experienced it after you change time zones. Only brush events carry seconds
 * (timer time, pauses excluded) and steps (0-9 completed, see STEPS).
 * @typedef {{ id: string, type: "floss" | "mouthwash", start: number, offset: number }
 *   | { id: string, type: "brush", start: number, offset: number, seconds: number, steps: number }} Event
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
const ID_PREFIX = { brush: "s", floss: "f", mouthwash: "m" };

const pad = (n) => String(n).padStart(2, "0");

/** Local calendar day key, YYYY-MM-DD. @param {number | Date} t */
export function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A day runs from this hour (local clock) to the same hour the next morning, so a routine at 12:30am still belongs to the night before. */
export const DAY_STARTS_AT = 4;

/** The day (YYYY-MM-DD) a moment belongs to, given the UTC offset in minutes where you were. */
export function dayOf(ms, offset) {
  return new Date(ms + offset * 60000 - DAY_STARTS_AT * 3600000).toISOString().slice(0, 10);
}

/** The day an event belongs to, in the time zone you were in when it happened. @param {Event} e */
export function eventDay(e) {
  return dayOf(e.start, e.offset);
}

/** The current day on this device, using the same cutoff as events. */
export function todayKey(now = Date.now()) {
  return dayOf(now, -new Date(now).getTimezoneOffset());
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

/**
 * Validate one event from storage or an import; returns null if it is not a well-formed event.
 * @param {any} e @returns {Event | null}
 */
export function normalizeEvent(e) {
  if (!e || typeof e.id !== "string" || !e.id || !TYPES.includes(e.type)) return null;
  const start = Math.round(Number(e.start));
  const offset = Math.round(Number(e.offset));
  if (!(start > 0) || !(Math.abs(offset) <= 14 * 60)) return null;
  const base = { id: e.id, type: e.type, start, offset };
  if (e.type !== "brush") return base;
  const seconds = Math.round(Number(e.seconds));
  const steps = Math.round(Number(e.steps));
  if (!(seconds >= 0) || !(steps >= 0 && steps <= STEPS.length)) return null;
  return { ...base, seconds, steps };
}

/** Validate a list, dropping bad entries. @param {any[]} list @returns {{ events: Event[], skipped: number }} */
export function normalizeEvents(list) {
  const events = list.map(normalizeEvent).filter(Boolean);
  return { events, skipped: list.length - events.length };
}

/** @param {Event[]} events */
export function buildExport(events, now = Date.now()) {
  return { app: EXPORT_APP, version: EXPORT_VERSION, exported: new Date(now).toISOString(), events };
}

/** Parse an export file's text. @param {string} text @returns {{ events: Event[], skipped: number }} */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON");
  }
  if (data?.app !== EXPORT_APP) throw new Error("Not a toothup export");
  if (!Array.isArray(data.events)) throw new Error("No events found");
  return normalizeEvents(data.events);
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

/**
 * Create an event with an id derived from its type and timestamp, nudging `start` by a millisecond if that id is taken.
 * `offset` defaults to this device's current UTC offset.
 * @param {Event[]} events existing events
 * @param {Event["type"]} type
 * @param {number} start epoch ms
 * @param {{ seconds?: number, steps?: number, offset?: number }} [opts] seconds and steps are required for brush events
 * @returns {Event}
 */
export function makeEvent(events, type, start, opts = {}) {
  const ids = new Set(events.map((e) => e.id));
  start = Math.round(start);
  while (ids.has(`${ID_PREFIX[type]}${start}`)) start += 1;
  const offset = opts.offset ?? -new Date(start).getTimezoneOffset();
  const base = { id: `${ID_PREFIX[type]}${start}`, type, start, offset };
  return type === "brush" ? { ...base, seconds: opts.seconds, steps: opts.steps } : base;
}

/** Events grouped by the day they belong to (see eventDay). @param {Event[]} events @returns {Map<string, Event[]>} */
export function groupByDay(events) {
  const map = new Map();
  for (const e of events) {
    const k = eventDay(e);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  return map;
}

// ---------- daily goals ----------

/** What a day needs. Brushing is the key goal; floss and mouthwash sit on top of it. */
export const GOALS = { brush: 2, mouthwash: 2, floss: 1 };

/** A brush only counts if the whole routine was done. @param {Event} e */
const countable = (e) => e.type !== "brush" || e.steps >= STEPS.length;

/**
 * Check one day's events against GOALS. Events beyond a goal, and partial brushes, are extras.
 * `complete` means the key goal is met: two full brushes.
 * @param {Event[]} list the events of a single day
 */
export function dayGoals(list) {
  const done = { brush: 0, floss: 0, mouthwash: 0 };
  /** @type {Map<string, "goal" | "extra">} */
  const roles = new Map();
  for (const e of [...list].sort((a, b) => a.start - b.start)) {
    const credited = countable(e) && done[e.type] < GOALS[e.type];
    if (credited) done[e.type]++;
    roles.set(e.id, credited ? "goal" : "extra");
  }
  return { done, roles, extras: list.length - Object.values(done).reduce((a, b) => a + b, 0), complete: done.brush >= GOALS.brush };
}

/** Days on which both brushes were done. @param {Event[]} events @returns {Set<string>} */
function completeDays(events) {
  return new Set([...groupByDay(events)].filter(([, list]) => dayGoals(list).complete).map(([k]) => k));
}

/** Consecutive complete days up to today, or up to yesterday if today is not complete yet. */
export function currentStreak(events, today) {
  const days = completeDays(events);
  let k = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(k)) {
    n++;
    k = addDays(k, -1);
  }
  return n;
}

export function longestStreak(events) {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const k of [...completeDays(events)].sort()) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return best;
}

/**
 * Stats over the last `days` days ending today. Counting starts at your first event, and today only counts once its
 * brushes are done, so an unfinished day is never a miss.
 * @param {Event[]} events
 */
export function rangeStats(events, today, days) {
  const out = { days: 0, fullDays: 0, brushPct: null, flossDays: 0, mouthwashDays: 0, extras: 0, avgSeconds: 0 };
  if (!events.length) return out;
  const byDay = groupByDay(events);
  let k = addDays(today, -(days - 1));
  const first = [...byDay.keys()].sort()[0];
  if (k < first) k = first;
  let brushes = 0, brushSeconds = 0, brushEvents = 0;
  for (; k <= today; k = addDays(k, 1)) {
    const list = byDay.get(k) || [];
    const g = dayGoals(list);
    for (const e of list) {
      if (e.type === "brush") {
        brushSeconds += e.seconds;
        brushEvents++;
      }
    }
    if (k === today && !g.complete) continue;
    out.days++;
    out.fullDays += g.complete ? 1 : 0;
    out.flossDays += g.done.floss >= GOALS.floss ? 1 : 0;
    out.mouthwashDays += g.done.mouthwash >= GOALS.mouthwash ? 1 : 0;
    out.extras += g.extras;
    brushes += g.done.brush;
  }
  out.brushPct = out.days ? Math.round((brushes / (out.days * GOALS.brush)) * 100) : null;
  out.avgSeconds = brushEvents ? Math.round(brushSeconds / brushEvents) : 0;
  return out;
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
