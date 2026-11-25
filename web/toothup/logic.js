// Pure logic for toothup: events, stats, calendar and import/export. No DOM, so the API test suite can import it.

/**
 * One thing that happened, with a timestamp. Floss and mouthwash are their own events, not flags on a brush.
 * start is epoch ms. offset is the UTC offset in minutes (east positive) where you were at the time, so an event
 * stays on the calendar day you experienced it after you change time zones. Only brush events carry seconds
 * (timer time, pauses excluded) and steps (0-9 completed, see STEPS).
 * Every event carries its location: lat and lon in degrees and acc, the accuracy radius in meters. lat and lon are
 * null when the place is unknown (a backdated entry, or location was denied); acc is also null for a place whose
 * accuracy was never recorded, such as one imported from Nomie.
 * @typedef {{ lat: number | null, lon: number | null, acc: number | null }} Place
 * @typedef {({ id: string, type: "floss" | "mouthwash", start: number, offset: number }
 *   | { id: string, type: "brush", start: number, offset: number, seconds: number, steps: number }) & Place} Event
 */

/** Validate a location; lat and lon together or all null, acc null if unknown. @param {any} e @returns {Place} */
export function normalizePlace(e) {
  const lat = e?.lat == null ? NaN : Number(e.lat);
  const lon = e?.lon == null ? NaN : Number(e.lon);
  const acc = e?.acc == null ? NaN : Number(e.acc);
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return { lat: null, lon: null, acc: null };
  return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, acc: acc >= 0 && Number.isFinite(acc) ? Math.round(acc) : null };
}

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

/**
 * User settings, stored with the data and included in exports.
 * dayStartsAt: a day runs from this hour (local clock) to the same hour the next morning, so a routine at 12:30am
 * still belongs to the night before.
 * reminders: things done every few months. `last` is the day it was last done (null if never recorded) and the
 * next one is due everyMonths after it.
 * @typedef {{ everyMonths: number, last: string | null }} Reminder
 * @typedef {{ dayStartsAt: number, reminders: { dentist: Reminder, head: Reminder } }} Settings
 */
export const DEFAULT_SETTINGS = {
  dayStartsAt: 4,
  reminders: { dentist: { everyMonths: 6, last: null }, head: { everyMonths: 3, last: null } },
};
export const MAX_DAY_STARTS_AT = 6;
export const MAX_REMINDER_MONTHS = 36;
export const REMINDER_TYPES = /** @type {const} */ (["dentist", "head"]);

/** @param {any} d */
const isDay = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && dayKey(parseDay(d)) === d;

/** @param {any} r @returns {Reminder | null} */
function normalizeReminder(r) {
  const ok = Number.isInteger(r?.everyMonths) && r.everyMonths >= 1 && r.everyMonths <= MAX_REMINDER_MONTHS && (r.last === null || isDay(r.last));
  return ok ? { everyMonths: r.everyMonths, last: r.last } : null;
}

/** Validate settings from storage or an import; returns null if malformed. @param {any} s @returns {Settings | null} */
export function normalizeSettings(s) {
  const h = s?.dayStartsAt;
  const dentist = normalizeReminder(s?.reminders?.dentist);
  const head = normalizeReminder(s?.reminders?.head);
  if (!(Number.isInteger(h) && h >= 0 && h <= MAX_DAY_STARTS_AT) || !dentist || !head) return null;
  return { dayStartsAt: h, reminders: { dentist, head } };
}

/** The day `n` calendar months after `day`, clamped to the end of a shorter month (Aug 31 + 6 months is Feb 28). */
export function addMonths(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  const daysInTarget = new Date(y, m - 1 + n + 1, 0).getDate();
  return dayKey(new Date(y, m - 1 + n, Math.min(d, daysInTarget)));
}

/** Whole days from day `a` to day `b` (negative if b is earlier). */
export function daysBetween(a, b) {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000);
}

/**
 * Whether a data backup is due: a month after the last one, or at once if there is data and none was ever made.
 * @param {string | null} last day of the last backup @param {string} today @param {boolean} hasData
 */
export function backupDue(last, today, hasData) {
  if (!isDay(last)) return hasData;
  return addMonths(/** @type {string} */ (last), 1) <= today;
}

/**
 * When a reminder is next due and how many days are left (negative once overdue); null if no date is recorded.
 * @param {Reminder} reminder @param {string} today
 */
export function reminderStatus(reminder, today) {
  if (!reminder.last) return null;
  const due = addMonths(reminder.last, reminder.everyMonths);
  return { due, days: daysBetween(today, due) };
}

/** The day (YYYY-MM-DD) a moment belongs to, given the UTC offset in minutes where you were. @param {Settings} settings */
export function dayOf(ms, offset, settings) {
  return new Date(ms + offset * 60000 - settings.dayStartsAt * 3600000).toISOString().slice(0, 10);
}

/** The day an event belongs to, in the time zone you were in when it happened. @param {Event} e @param {Settings} settings */
export function eventDay(e, settings) {
  return dayOf(e.start, e.offset, settings);
}

/** The current day on this device. @param {Settings} settings */
export function todayKey(settings, now = Date.now()) {
  return dayOf(now, -new Date(now).getTimezoneOffset(), settings);
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
  const base = { id: e.id, type: e.type, start, offset, ...normalizePlace(e) };
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

/** @param {Event[]} events @param {Settings} settings */
export function buildExport(events, settings, now = Date.now()) {
  return { app: EXPORT_APP, version: EXPORT_VERSION, exported: new Date(now).toISOString(), settings, events };
}

/** Parse an export file's text. @param {string} text @returns {{ events: Event[], skipped: number, settings: Settings }} */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON");
  }
  if (data?.app !== EXPORT_APP) throw new Error("Not a toothup export");
  const settings = normalizeSettings(data.settings);
  if (!settings) throw new Error("Invalid settings");
  if (!Array.isArray(data.events)) throw new Error("No events found");
  return { ...normalizeEvents(data.events), settings };
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
 * @param {{ seconds?: number, steps?: number, offset?: number, lat?: number | null, lon?: number | null, acc?: number | null }} [opts]
 *   seconds and steps are required for brush events; lat, lon and acc default to unknown (null)
 * @returns {Event}
 */
export function makeEvent(events, type, start, opts = {}) {
  const ids = new Set(events.map((e) => e.id));
  start = Math.round(start);
  while (ids.has(`${ID_PREFIX[type]}${start}`)) start += 1;
  const offset = opts.offset ?? -new Date(start).getTimezoneOffset();
  const base = { id: `${ID_PREFIX[type]}${start}`, type, start, offset, ...normalizePlace(opts) };
  return type === "brush" ? { ...base, seconds: opts.seconds, steps: opts.steps } : base;
}

/** Events grouped by the day they belong to (see eventDay). @param {Event[]} events @param {Settings} settings @returns {Map<string, Event[]>} */
export function groupByDay(events, settings) {
  const map = new Map();
  for (const e of events) {
    const k = eventDay(e, settings);
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

/** Days on which both brushes were done. @param {Event[]} events @param {Settings} settings @returns {Set<string>} */
function completeDays(events, settings) {
  return new Set([...groupByDay(events, settings)].filter(([, list]) => dayGoals(list).complete).map(([k]) => k));
}

/** Consecutive complete days up to today, or up to yesterday if today is not complete yet. */
export function currentStreak(events, today, settings) {
  const days = completeDays(events, settings);
  let k = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(k)) {
    n++;
    k = addDays(k, -1);
  }
  return n;
}

export function longestStreak(events, settings) {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const k of [...completeDays(events, settings)].sort()) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return best;
}

/**
 * Stats for the days from `from` to `to` (inclusive day keys). Counting starts at your first event and stops at today,
 * and today only counts once its brushes are done, so an unfinished day is never a miss.
 * `levels` maps each day shown to 2 (both brushes), 1 (one) or 0 (none); today appears even while unfinished.
 * @param {Event[]} events
 * @param {string} from
 * @param {string} to
 * @param {string} today
 * @param {Settings} settings
 */
export function periodStats(events, from, to, today, settings) {
  const out = {
    days: 0, fullDays: 0, brushPct: null, flossDays: 0, mouthwashDays: 0, extras: 0, avgSeconds: 0,
    brushCount: 0, brushSeconds: 0, flossCount: 0, mouthwashCount: 0,
    bestStreak: { length: 0, start: /** @type {string | null} */ (null), end: /** @type {string | null} */ (null) },
    /** @type {Map<string, 0 | 1 | 2>} */ levels: new Map(),
    weekdays: Array.from({ length: 7 }, () => ({ days: 0, fullDays: 0 })),
  };
  if (!events.length) return out;
  const byDay = groupByDay(events, settings);
  const first = [...byDay.keys()].sort()[0];
  const last = to < today ? to : today;
  let brushes = 0, run = 0, runStart = "";
  for (let k = from < first ? first : from; k <= last; k = addDays(k, 1)) {
    const list = byDay.get(k) || [];
    const g = dayGoals(list);
    out.levels.set(k, g.complete ? 2 : g.done.brush > 0 ? 1 : 0);
    for (const e of list) {
      if (e.type === "brush") {
        out.brushSeconds += e.seconds;
        out.brushCount++;
      } else if (e.type === "floss") out.flossCount++;
      else out.mouthwashCount++;
    }
    if (k === today && !g.complete) continue;
    out.days++;
    out.fullDays += g.complete ? 1 : 0;
    out.flossDays += g.done.floss >= GOALS.floss ? 1 : 0;
    out.mouthwashDays += g.done.mouthwash >= GOALS.mouthwash ? 1 : 0;
    out.extras += g.extras;
    brushes += g.done.brush;
    const wd = out.weekdays[parseDay(k).getDay()];
    wd.days++;
    wd.fullDays += g.complete ? 1 : 0;
    if (g.complete) {
      if (!run++) runStart = k;
      if (run > out.bestStreak.length) out.bestStreak = { length: run, start: runStart, end: k };
    } else run = 0;
  }
  out.brushPct = out.days ? Math.round((brushes / (out.days * GOALS.brush)) * 100) : null;
  out.avgSeconds = out.brushCount ? Math.round(out.brushSeconds / out.brushCount) : 0;
  return out;
}

/** Stats over the last `days` days ending today. @param {Event[]} events @param {string} today @param {number} days @param {Settings} settings */
export function rangeStats(events, today, days, settings) {
  const r = periodStats(events, addDays(today, -(days - 1)), today, today, settings);
  const { days: n, fullDays, brushPct, flossDays, mouthwashDays, extras, avgSeconds } = r;
  return { days: n, fullDays, brushPct, flossDays, mouthwashDays, extras, avgSeconds };
}

// ---------- monthly and annual reports ----------

/** First and last day of a month. @param {string} ym YYYY-MM */
export function monthRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  return { from: `${ym}-01`, to: dayKey(new Date(y, m, 0)) };
}

/** The month `n` months from `ym`. @param {string} ym YYYY-MM @param {number} n */
export function addMonthKey(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** The year of the earliest event, or null with no events. @param {Event[]} events @param {Settings} settings */
export function firstYear(events, settings) {
  return events.length ? Number([...groupByDay(events, settings).keys()].sort()[0].slice(0, 4)) : null;
}

/** The month of the earliest event (YYYY-MM), or null with no events. @param {Event[]} events @param {Settings} settings */
export function firstMonth(events, settings) {
  return events.length ? [...groupByDay(events, settings).keys()].sort()[0].slice(0, 7) : null;
}

/**
 * Report for one month: its stats, the month before for comparison, and the days with fewer than two brushes.
 * @param {Event[]} events @param {string} ym YYYY-MM @param {string} today @param {Settings} settings
 */
export function monthReport(events, ym, today, settings) {
  const { from, to } = monthRange(ym);
  const stats = periodStats(events, from, to, today, settings);
  const prevRange = monthRange(addMonthKey(ym, -1));
  const prev = periodStats(events, prevRange.from, prevRange.to, today, settings);
  const short = [...stats.levels].filter(([k, level]) => level < 2 && k < today).map(([k, level]) => ({ day: k, level }));
  return { ym, from, to, ...stats, prev, short };
}

/**
 * Report for one calendar year: overall stats, each month, and the best and worst month by brushing percentage.
 * @param {Event[]} events @param {number} year @param {string} today @param {Settings} settings
 */
export function yearReport(events, year, today, settings) {
  const stats = periodStats(events, `${year}-01-01`, `${year}-12-31`, today, settings);
  const months = Array.from({ length: 12 }, (_, i) => {
    const ym = `${year}-${pad(i + 1)}`;
    const { from, to } = monthRange(ym);
    return { ym, month: i, ...periodStats(events, from, to, today, settings) };
  });
  const rated = months.filter((m) => m.brushPct !== null);
  const best = rated.reduce((a, m) => (!a || m.brushPct > a.brushPct ? m : a), null);
  const worst = rated.length > 1 ? rated.reduce((a, m) => (!a || m.brushPct < a.brushPct ? m : a), null) : null;
  return { year, from: `${year}-01-01`, to: `${year}-12-31`, ...stats, months, bestMonth: best, worstMonth: worst && worst !== best ? worst : null };
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

/** The page version string (the #version element, ADR 0010) in a page's HTML, or null if there is none. @param {string} html */
export function versionOf(html) {
  return /<[a-z]+[^>]*\bid="version"[^>]*>\s*([^<\s][^<]*?)\s*</i.exec(html)?.[1] ?? null;
}
