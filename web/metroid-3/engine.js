// Metroid 3: pure logic for the Super Metroid 100% tracker.
//
// Plain JavaScript that runs in the browser as written (no build step, see ADR 0002). No DOM and
// no storage here, so api/metroid-3.test.mjs can import it under Node.

import { ROUTE } from "./route.js";

export const FORMAT = "metroid-3";
export const FORMAT_VERSION = 1;

/**
 * @typedef {{
 *   id: string,
 *   step: number,
 *   checkpoint: string,
 *   area: string | null,
 *   seq: number | null,
 *   room: string | null,
 *   note: string | null,
 *   ts: number | null,
 *   igt: string | null,
 *   log: string | null,
 * }} Step
 * @typedef {{ id: string, ts: number, title: string, body: string }} Entry
 * @typedef {{ id: string, ts: number, kind: "start" | "stop" }} SessionEvent
 * @typedef {{ start: number, end: number | null, startId: string, endId: string | null, ms: number }} Session
 * @typedef {{ system: string, goal: string, bosses: string, bossOrder: string, glitches: string }} Meta
 * @typedef {{
 *   id: string,
 *   name: string,
 *   createdAt: number,
 *   updatedAt: number,
 *   meta: Meta,
 *   steps: Step[],
 *   entries: Entry[],
 *   events: SessionEvent[],
 * }} Game
 */

/** Expected totals for a 100% run. */
export const TOTALS = Object.freeze({
  missile: 46,
  super: 10,
  pb: 10,
  etank: 14,
  rtank: 4,
  beam: 6,
  suit: 2,
  item: 8,
  boss: 10,
  all: 100,
});

/** Item% by area (the "Known Totals" sheet). */
export const AREA_TOTALS = Object.freeze({
  Brinstar: 31,
  Crateria: 13,
  Maridia: 18,
  Norfair: 30,
  "Wrecked Ship": 8,
});

export const AREAS = Object.keys(AREA_TOTALS);
export const ALL_AREAS = [...AREAS, "Tourian"];

/** Category metadata: label, short label, count against item%? */
export const CATEGORIES = Object.freeze({
  missile: { label: "Missile", short: "M", pickup: true },
  super: { label: "Super Missile", short: "S", pickup: true },
  pb: { label: "Power Bomb", short: "P", pickup: true },
  etank: { label: "Energy Tank", short: "E", pickup: true },
  rtank: { label: "Reserve Tank", short: "R", pickup: true },
  beam: { label: "Beam", short: "B", pickup: true },
  suit: { label: "Suit", short: "V", pickup: true },
  item: { label: "Item", short: "I", pickup: true },
  boss: { label: "Boss", short: "K", pickup: false },
  save: { label: "Save", short: "S", pickup: false },
  start: { label: "Start", short: "▶", pickup: false },
  milestone: { label: "Milestone", short: "◆", pickup: false },
  end: { label: "Finish", short: "★", pickup: false },
  custom: { label: "Other", short: "•", pickup: false },
});

/**
 * The fixed cells of the item grid, in spreadsheet order. `key` is the normalized item name.
 * @type {Record<"beam" | "suit" | "item", Array<{ key: string, name: string, abbr: string }>>}
 */
export const FIXED_ITEMS = Object.freeze({
  beam: [
    { key: "chargebeam", name: "Charge Beam", abbr: "CH" },
    { key: "spazer", name: "Spazer", abbr: "SZ" },
    { key: "icebeam", name: "Ice Beam", abbr: "IC" },
    { key: "wavebeam", name: "Wave Beam", abbr: "WV" },
    { key: "grapplingbeam", name: "Grappling Beam", abbr: "GR" },
    { key: "plasmabeam", name: "Plasma Beam", abbr: "PL" },
  ],
  suit: [
    { key: "variasuit", name: "Varia Suit", abbr: "VA" },
    { key: "gravitysuit", name: "Gravity Suit", abbr: "GV" },
  ],
  item: [
    { key: "morphingball", name: "Morphing Ball", abbr: "MB" },
    { key: "bomb", name: "Bomb", abbr: "BM" },
    { key: "hijumpboots", name: "Hi Jump Boots", abbr: "HJ" },
    { key: "spacejump", name: "Space Jump", abbr: "SJ" },
    { key: "speedbooster", name: "Speed Booster", abbr: "SB" },
    { key: "xrayscope", name: "X-Ray Scope", abbr: "XR" },
    { key: "springball", name: "Spring Ball", abbr: "SR" },
    { key: "screwattack", name: "Screw Attack", abbr: "SC" },
  ],
});

/** Bosses in route order. */
export const BOSSES = Object.freeze([
  { key: "torizo", name: "Bomb Torizo", letter: "" },
  { key: "sporespawn", name: "Spore Spawn", letter: "" },
  { key: "kraid", name: "Kraid", letter: "K" },
  { key: "crocomire", name: "Crocomire", letter: "" },
  { key: "phantoon", name: "Phantoon", letter: "P" },
  { key: "botwoon", name: "Botwoon", letter: "" },
  { key: "draygon", name: "Draygon", letter: "D" },
  { key: "goldentorizo", name: "Golden Torizo", letter: "" },
  { key: "ridley", name: "Ridley", letter: "R" },
  { key: "motherbrain", name: "Mother Brain", letter: "" },
]);

/** @param {string} s lowercase letters and digits only, for matching names */
export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const ITEM_CATEGORY = new Map();
for (const cat of /** @type {const} */ (["beam", "suit", "item"])) {
  for (const it of FIXED_ITEMS[cat]) ITEM_CATEGORY.set(it.key, cat);
}
// Names the route and common spellings use for the same item.
ITEM_CATEGORY.set("hijump", "item");
ITEM_CATEGORY.set("xray", "item");
ITEM_CATEGORY.set("grapple", "beam");
ITEM_CATEGORY.set("grapplebeam", "beam");
ITEM_CATEGORY.set("morphball", "item");

/**
 * Classify a checkpoint string such as "Item: Spazer" or "Boss Clear: Kraid".
 * @param {string} checkpoint
 * @returns {{ cat: keyof typeof CATEGORIES, name: string }}
 */
export function classify(checkpoint) {
  const text = String(checkpoint ?? "").trim();
  const lower = text.toLowerCase();
  const after = text.includes(":") ? text.slice(text.indexOf(":") + 1).trim() : "";
  if (lower === "game start") return { cat: "start", name: text };
  if (lower === "ceres escape") return { cat: "milestone", name: text };
  if (lower === "zebes escape") return { cat: "end", name: text };
  if (lower === "missile") return { cat: "missile", name: text };
  if (lower === "super missile") return { cat: "super", name: text };
  if (lower === "power bomb") return { cat: "pb", name: text };
  if (lower === "energy tank") return { cat: "etank", name: text };
  if (lower === "reserve tank") return { cat: "rtank", name: text };
  if (lower.startsWith("boss clear")) return { cat: "boss", name: after || text };
  if (lower.startsWith("save")) return { cat: "save", name: after || text };
  if (lower.startsWith("item")) {
    const cat = /** @type {"beam" | "suit" | "item"} */ (ITEM_CATEGORY.get(norm(after)) ?? "item");
    return { cat, name: after || text };
  }
  return { cat: "custom", name: text };
}

/** Checkpoints offered in the entry form. */
export const CHECKPOINT_CHOICES = Object.freeze([
  "Game Start",
  "Ceres Escape",
  "Missile",
  "Super Missile",
  "Power Bomb",
  "Energy Tank",
  "Reserve Tank",
  ...[...FIXED_ITEMS.item, ...FIXED_ITEMS.beam, ...FIXED_ITEMS.suit].map((i) => `Item: ${i.name}`),
  ...BOSSES.map((b) => `Boss Clear: ${b.name}`),
  "Save: ",
  "Zebes Escape",
]);

// ---------------------------------------------------------------------------------------------
// Games

/** @returns {string} */
export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** @returns {Meta} */
export function defaultMeta() {
  return {
    system: "",
    goal: "100% item collection",
    bosses: "All minor, all major",
    bossOrder: "KPDR",
    glitches: "None",
  };
}

/**
 * @param {Array<Partial<Step> & { checkpoint: string }>} steps
 * @returns {Step[]}
 */
function buildSteps(steps) {
  return steps.map((s, i) => ({
    id: s.id || uid(),
    step: i + 1,
    checkpoint: s.checkpoint,
    area: s.area ?? null,
    seq: s.seq ?? null,
    room: s.room ?? null,
    note: s.note ?? null,
    ts: s.ts ?? null,
    igt: s.igt ?? null,
    log: s.log ?? null,
  }));
}

/**
 * @param {{ name?: string, template?: "route" | "blank", meta?: Partial<Meta>, now?: number }} [opts]
 * @returns {Game}
 */
export function newGame(opts = {}) {
  const now = opts.now ?? Date.now();
  const template = opts.template ?? "route";
  const steps =
    template === "route"
      ? buildSteps(
          ROUTE.map(([checkpoint, area, seq, room, note]) => ({ checkpoint, area, seq, room, note })),
        )
      : [];
  return {
    id: uid(),
    name: (opts.name || "").trim() || "Super Metroid",
    createdAt: now,
    updatedAt: now,
    meta: { ...defaultMeta(), ...(opts.meta || {}) },
    steps,
    entries: [],
    events: [],
  };
}

/** Renumber steps 1..n after an insert, delete or move. @param {Game} game */
export function renumber(game) {
  game.steps.forEach((s, i) => {
    s.step = i + 1;
  });
}

/** @param {Game} game @returns {Game} */
export function cloneGame(game) {
  return JSON.parse(JSON.stringify(game));
}

// ---------------------------------------------------------------------------------------------
// State derived from a game

/**
 * @typedef {{
 *   counts: Record<string, number>,
 *   percent: number,
 *   done: Step[],
 *   byCat: Record<string, Step[]>,
 *   areas: Array<{ area: string, count: number, total: number }>,
 *   bosses: Array<{ key: string, name: string, done: boolean, step: Step | null }>,
 *   fixed: Record<string, Step | undefined>,
 *   current: Step | null,
 *   currentIndex: number,
 *   first: number | null,
 *   last: number | null,
 *   igt: string | null,
 *   complete: boolean,
 *   steps: number,
 *   stepsDone: number,
 *   sessions: Session[],
 *   playMs: number,
 *   playing: Session | null,
 * }} State
 */

/**
 * Pair start and stop events into sessions. A stray stop, or a second start while one is open,
 * is ignored. An open session runs until `now`.
 * @param {Game} game @param {number} [now]
 * @returns {Session[]}
 */
export function sessions(game, now = Date.now()) {
  const evs = [...(game.events ?? [])].sort((a, b) => a.ts - b.ts);
  /** @type {Session[]} */
  const out = [];
  /** @type {SessionEvent | null} */
  let open = null;
  for (const e of evs) {
    if (e.kind === "start" && !open) open = e;
    else if (e.kind === "stop" && open) {
      out.push({ start: open.ts, end: e.ts, startId: open.id, endId: e.id, ms: e.ts - open.ts });
      open = null;
    }
  }
  if (open) out.push({ start: open.ts, end: null, startId: open.id, endId: null, ms: Math.max(0, now - open.ts) });
  return out;
}

/**
 * Index of the session containing ts, or -1. Open sessions extend forever.
 * @param {Session[]} list @param {number} ts
 */
export function sessionIndex(list, ts) {
  return list.findIndex((x) => ts >= x.start && (x.end == null || ts <= x.end));
}

/**
 * Suggest start/stop events from step timestamps: a new session begins after a gap longer than
 * `gapMs`. Each session runs from its first to its last logged step.
 * @param {Game} game @param {number} [gapMs]
 * @returns {SessionEvent[]}
 */
export function inferSessions(game, gapMs = 30 * 60000) {
  const stamps = game.steps.filter(isDone).map((s) => /** @type {number} */ (s.ts)).sort((a, b) => a - b);
  /** @type {SessionEvent[]} */
  const evs = [];
  let from = 0;
  for (let i = 0; i < stamps.length; i++) {
    if (i === stamps.length - 1 || stamps[i + 1] - stamps[i] > gapMs) {
      evs.push({ id: uid(), ts: stamps[from], kind: "start" }, { id: uid(), ts: stamps[i], kind: "stop" });
      from = i + 1;
    }
  }
  return evs;
}

/** @param {Step} s */
export const isDone = (s) => s.ts != null;

/**
 * @param {Game} game
 * @param {number} [now]
 * @returns {State}
 */
export function deriveState(game, now = Date.now()) {
  const done = game.steps.filter(isDone);
  /** @type {Record<string, Step[]>} */
  const byCat = {};
  for (const key of Object.keys(CATEGORIES)) byCat[key] = [];
  /** @type {Record<string, Step | undefined>} */
  const fixed = {};
  /** @type {Record<string, number>} */
  const areaCount = {};
  for (const s of done) {
    const { cat, name } = classify(s.checkpoint);
    byCat[cat].push(s);
    if (cat === "beam" || cat === "suit" || cat === "item") fixed[fixedKey(name)] = s;
    if (CATEGORIES[cat].pickup && s.area) areaCount[s.area] = (areaCount[s.area] || 0) + 1;
  }
  /** @type {Record<string, number>} */
  const counts = {};
  for (const key of Object.keys(CATEGORIES)) counts[key] = byCat[key].length;
  const percent = Object.entries(CATEGORIES).reduce(
    (n, [key, c]) => n + (c.pickup ? counts[key] : 0),
    0,
  );

  const bossStep = new Map();
  for (const s of byCat.boss) bossStep.set(norm(classify(s.checkpoint).name), s);
  const bosses = BOSSES.map((b) => ({
    key: b.key,
    name: b.name,
    done: bossStep.has(b.key),
    step: bossStep.get(b.key) ?? null,
  }));

  const areas = AREAS.map((area) => ({
    area,
    count: areaCount[area] || 0,
    total: AREA_TOTALS[/** @type {keyof typeof AREA_TOTALS} */ (area)],
  }));

  const currentIndex = game.steps.findIndex((s) => !isDone(s));
  const stamps = done.map((s) => /** @type {number} */ (s.ts));
  const igtSteps = done.filter((s) => s.igt);
  const endStep = byCat.end[0];
  const sess = sessions(game, now);

  return {
    counts,
    percent,
    done,
    byCat,
    areas,
    bosses,
    fixed,
    current: currentIndex >= 0 ? game.steps[currentIndex] : null,
    currentIndex,
    first: stamps.length ? Math.min(...stamps) : null,
    last: stamps.length ? Math.max(...stamps) : null,
    igt: igtSteps.length ? (endStep?.igt ?? igtSteps[igtSteps.length - 1].igt) : null,
    complete: Boolean(endStep) || (game.steps.length > 0 && currentIndex < 0),
    steps: game.steps.length,
    stepsDone: done.length,
    sessions: sess,
    playMs: sess.reduce((n, x) => n + x.ms, 0),
    playing: sess.find((x) => x.end == null) ?? null,
  };
}

/** Normalized key for a fixed grid cell, tolerant of spelling. @param {string} name */
export function fixedKey(name) {
  const k = norm(name);
  const aliases = {
    hijump: "hijumpboots",
    xray: "xrayscope",
    grapple: "grapplingbeam",
    grapplebeam: "grapplingbeam",
    morphball: "morphingball",
  };
  return /** @type {Record<string, string>} */ (aliases)[k] ?? k;
}

/**
 * Number of the next pickup for an HUD counter: packs x 5 for the ammo types.
 * @param {State} state
 */
export function hud(state) {
  const c = state.counts;
  return {
    energy: 99 + 100 * c.etank,
    reserve: 100 * c.rtank,
    missiles: 5 * c.missile,
    supers: 5 * c.super,
    powerBombs: 5 * c.pb,
    etanks: c.etank,
    rtanks: c.rtank,
  };
}

/**
 * The upcoming window shown by the nav: the current step and the next `ahead` after it.
 * @param {Game} game
 * @param {State} state
 * @param {number} [ahead]
 */
export function upcoming(game, state, ahead = 5) {
  if (state.currentIndex < 0) return [];
  return game.steps.slice(state.currentIndex, state.currentIndex + 1 + ahead);
}

/**
 * Completed steps, most recent first, with the gap to the step logged just before each.
 * @param {Game} game
 * @param {number} [limit]
 * @returns {Array<{ step: Step, gapMs: number | null, fresh: boolean }>}
 */
export function history(game, limit = 15) {
  const done = game.steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => isDone(s))
    .sort((a, b) => /** @type {number} */ (b.s.ts) - /** @type {number} */ (a.s.ts) || b.i - a.i);
  const list = sessions(game);
  return done.slice(0, limit).map(({ s }, k) => {
    const prev = done[k + 1];
    const ts = /** @type {number} */ (s.ts);
    // With session events, a gap across sessions is not play time: mark a fresh session instead.
    const fresh = Boolean(prev) && list.length > 0 && sessionIndex(list, ts) !== sessionIndex(list, /** @type {number} */ (prev.s.ts));
    return {
      step: s,
      gapMs: prev && !fresh ? ts - /** @type {number} */ (prev.s.ts) : null,
      fresh,
    };
  });
}

/** Local date key, YYYY-MM-DD. @param {number} ts */
export function dayKey(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The journal: completed steps and free-form entries, grouped by local day, oldest first.
 * @param {Game} game
 * @returns {Array<{
 *   day: string,
 *   start: number,
 *   end: number,
 *   pickups: number,
 *   bosses: number,
 *   playMs: number,
 *   items: Array<{ kind: "step", ts: number, step: Step } | { kind: "entry", ts: number, entry: Entry } | { kind: "event", ts: number, event: SessionEvent }>,
 * }>}
 */
export function journalDays(game) {
  /** @type {Map<string, any>} */
  const days = new Map();
  /** @type {Array<any>} */
  const all = [];
  game.steps.forEach((s, i) => {
    if (isDone(s)) all.push({ kind: "step", ts: /** @type {number} */ (s.ts), step: s, i });
  });
  game.entries.forEach((e, i) => all.push({ kind: "entry", ts: e.ts, entry: e, i }));
  (game.events ?? []).forEach((e, i) => all.push({ kind: "event", ts: e.ts, event: e, i }));
  const rank = (it) => (it.kind === "event" ? (it.event.kind === "start" ? 0 : 3) : it.kind === "step" ? 1 : 2);
  all.sort((a, b) => a.ts - b.ts || rank(a) - rank(b) || a.i - b.i);
  for (const it of all) {
    const key = dayKey(it.ts);
    let day = days.get(key);
    if (!day) {
      day = { day: key, start: it.ts, end: it.ts, pickups: 0, bosses: 0, playMs: 0, items: [] };
      days.set(key, day);
    }
    day.end = Math.max(day.end, it.ts);
    day.items.push(it);
    if (it.kind === "step") {
      const { cat } = classify(it.step.checkpoint);
      if (CATEGORIES[cat].pickup) day.pickups++;
      if (cat === "boss") day.bosses++;
    }
  }
  for (const x of sessions(game)) {
    const day = days.get(dayKey(x.start));
    if (day) day.playMs += x.ms;
  }
  return [...days.values()];
}

/**
 * Items collected per local day, oldest first, for the pace chart.
 * @param {Game} game
 */
export function pace(game) {
  return journalDays(game).map((d) => ({ day: d.day, pickups: d.pickups }));
}

// ---------------------------------------------------------------------------------------------
// Editing

/**
 * Insert a step after the last completed one (for unplanned pickups), or at the end.
 * @param {Game} game
 * @param {Partial<Step> & { checkpoint: string }} fields
 * @param {"afterLast" | "end" | "afterCurrent"} [where]
 * @returns {Step}
 */
export function addStep(game, fields, where = "afterLast") {
  const [step] = buildSteps([fields]);
  let at = game.steps.length;
  if (where === "afterLast") {
    let last = -1;
    game.steps.forEach((s, i) => {
      if (isDone(s)) last = i;
    });
    at = last + 1;
  } else if (where === "afterCurrent") {
    const cur = game.steps.findIndex((s) => !isDone(s));
    at = cur < 0 ? game.steps.length : cur + 1;
  }
  game.steps.splice(at, 0, step);
  renumber(game);
  game.updatedAt = Date.now();
  return step;
}

/** @param {Game} game @param {string} id */
export function removeStep(game, id) {
  game.steps = game.steps.filter((s) => s.id !== id);
  renumber(game);
  game.updatedAt = Date.now();
}

/**
 * Move a step up (-1) or down (+1).
 * @param {Game} game @param {string} id @param {-1 | 1} dir
 */
export function moveStep(game, id, dir) {
  const i = game.steps.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= game.steps.length) return;
  [game.steps[i], game.steps[j]] = [game.steps[j], game.steps[i]];
  renumber(game);
  game.updatedAt = Date.now();
}

/**
 * Mark a step done (now by default), or clear it.
 * @param {Game} game @param {string} id @param {number | null} ts
 */
export function setDone(game, id, ts) {
  const s = game.steps.find((x) => x.id === id);
  if (!s) return;
  s.ts = ts;
  game.updatedAt = Date.now();
}

// ---------------------------------------------------------------------------------------------
// Formatting

const p2 = (n) => String(n).padStart(2, "0");

/** @param {number} ts */
export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** @param {number} ts */
export function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** @param {number} ts */
export function fmtStamp(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/** Value for <input type="datetime-local" step="1">. @param {number | null} ts */
export function toInputValue(ts) {
  if (ts == null) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/** @param {string} v datetime-local value @returns {number | null} */
export function fromInputValue(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/** "3 min", "2h 05m", "1d 4h". @param {number} ms */
export function fmtDuration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "<1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${p2(m % 60)}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** "5 min ago". @param {number} ts @param {number} now */
export function fmtAgo(ts, now) {
  const ms = now - ts;
  if (ms < 60000) return "just now";
  return `${fmtDuration(ms)} ago`;
}

/** Active play time from session events. @param {State} state */
export function fmtPlay(state) {
  return state.sessions.length ? fmtDuration(state.playMs) : "—";
}

/** Clock span between first and last completed step. @param {State} state */
export function fmtSpan(state) {
  if (state.first == null || state.last == null) return "—";
  return fmtDuration(state.last - state.first);
}

// ---------------------------------------------------------------------------------------------
// Import and export

/**
 * @param {Game[]} games
 * @param {number} [now]
 */
export function toExportJson(games, now = Date.now()) {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date(now).toISOString(),
    games: games.map((g) => ({
      ...g,
      createdAt: new Date(g.createdAt).toISOString(),
      updatedAt: new Date(g.updatedAt).toISOString(),
      steps: g.steps.map((s) => ({ ...s, ts: s.ts == null ? null : new Date(s.ts).toISOString() })),
      entries: g.entries.map((e) => ({ ...e, ts: new Date(e.ts).toISOString() })),
      events: (g.events ?? []).map((e) => ({ ...e, ts: new Date(e.ts).toISOString() })),
    })),
  };
}

/**
 * Accepts epoch milliseconds, an ISO string (with or without an offset; none means local time),
 * or a spreadsheet-style "YYYY-MM-DD HH:MM:SS" / "M/D/YYYY H:MM:SS" string.
 * @param {unknown} v
 * @returns {number | null}
 */
export function parseTime(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const text = String(v).trim();
  if (!text) return null;
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    const ms = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
    if (m[8]) {
      const t = Date.parse(text.replace(" ", "T"));
      return Number.isNaN(t) ? null : t;
    }
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, ms).getTime();
  }
  m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (m) {
    let h = +m[4];
    if (m[7]) h = (h % 12) + (m[7].toUpperCase() === "PM" ? 12 : 0);
    return new Date(+m[3], +m[1] - 1, +m[2], h, +m[5], m[6] ? +m[6] : 0).getTime();
  }
  const t = Date.parse(text);
  return Number.isNaN(t) ? null : t;
}

/** @param {unknown} v @returns {string | null} */
const str = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};

/**
 * Validate and normalize one game from an import.
 * @param {any} raw
 * @returns {Game}
 */
export function normalizeGame(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.steps)) {
    throw new Error("Not a Metroid 3 game: missing steps.");
  }
  const now = Date.now();
  const steps = buildSteps(
    raw.steps
      .filter((s) => s && str(s.checkpoint))
      .map((s) => ({
        id: str(s.id) ?? undefined,
        checkpoint: String(s.checkpoint).trim(),
        area: str(s.area),
        seq: s.seq == null || s.seq === "" || Number.isNaN(Number(s.seq)) ? null : Number(s.seq),
        room: str(s.room),
        note: str(s.note),
        ts: parseTime(s.ts),
        igt: str(s.igt),
        log: str(s.log),
      })),
  );
  const seen = new Set();
  for (const s of steps) {
    if (seen.has(s.id)) s.id = uid();
    seen.add(s.id);
  }
  const entries = (Array.isArray(raw.entries) ? raw.entries : [])
    .map((e) => ({
      id: str(e?.id) ?? uid(),
      ts: parseTime(e?.ts) ?? now,
      title: str(e?.title) ?? "",
      body: str(e?.body) ?? "",
    }))
    .filter((e) => e.title || e.body);
  const events = (Array.isArray(raw.events) ? raw.events : [])
    .map((e) => ({ id: str(e?.id) ?? uid(), ts: parseTime(e?.ts), kind: e?.kind === "stop" ? "stop" : e?.kind === "start" ? "start" : null }))
    .filter((e) => e.ts != null && e.kind)
    .sort((a, b) => a.ts - b.ts);
  return {
    id: str(raw.id) ?? uid(),
    name: str(raw.name) ?? "Super Metroid",
    createdAt: parseTime(raw.createdAt) ?? now,
    updatedAt: parseTime(raw.updatedAt) ?? now,
    meta: { ...defaultMeta(), ...(raw.meta && typeof raw.meta === "object" ? raw.meta : {}) },
    steps,
    entries,
    events: /** @type {SessionEvent[]} */ (events),
  };
}

/**
 * Parse an exported JSON document (one game, or the multi-game format) into games.
 * @param {string} text
 * @returns {Game[]}
 */
export function parseImportJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (Array.isArray(data?.games)) return data.games.map(normalizeGame);
  if (Array.isArray(data?.steps)) return [normalizeGame(data)];
  if (Array.isArray(data)) return [normalizeGame({ steps: data })];
  throw new Error("That file is not a Metroid 3 export.");
}

/**
 * Pull the embedded game JSON out of an exported journal page.
 * @param {string} html
 * @returns {Game[]}
 */
export function parseImportHtml(html) {
  const m = html.match(/<script[^>]*id="metroid3-data"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) throw new Error("No Metroid 3 data found in that HTML file.");
  return parseImportJson(m[1].replace(/<\\\//g, "</"));
}

/**
 * Minimal CSV parser (quoted fields, doubled quotes, CRLF).
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  /** @type {string[][]} */
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Import the spreadsheet's Entry sheet exported as CSV. Looks for the header row containing
 * "Checkpoint"; reads Timestamp, IGT, Checkpoint, Note, Area, Seq and Room columns.
 * @param {string} text
 * @param {string} [name]
 * @returns {Game}
 */
export function parseImportCsv(text, name = "Imported game") {
  const rows = parseCsv(text);
  const h = rows.findIndex((r) => r.some((c) => c.trim().toLowerCase() === "checkpoint"));
  if (h < 0) throw new Error('No "Checkpoint" column found in that CSV.');
  const cols = rows[h].map((c) => c.trim().toLowerCase());
  const at = (key) => cols.indexOf(key);
  const iT = at("timestamp"), iI = at("igt"), iC = at("checkpoint"), iN = at("note");
  const iA = at("area"), iS = at("seq"), iR = at("room");
  const get = (r, i) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const steps = [];
  for (const r of rows.slice(h + 1)) {
    const checkpoint = get(r, iC);
    if (!checkpoint) continue;
    steps.push({
      checkpoint,
      ts: parseTime(get(r, iT)),
      igt: get(r, iI) || null,
      note: get(r, iN) || null,
      area: get(r, iA) || null,
      seq: get(r, iS) ? Number(get(r, iS)) : null,
      room: get(r, iR) || null,
    });
  }
  if (!steps.length) throw new Error("No checkpoints found in that CSV.");
  return normalizeGame({ name, steps });
}

/**
 * Detect the file kind by content and parse it into games.
 * @param {string} text
 * @param {string} [filename]
 * @returns {Game[]}
 */
export function parseImport(text, filename = "") {
  const t = text.trimStart();
  const base = filename.replace(/\.[^.]+$/, "") || "Imported game";
  if (t.startsWith("{") || t.startsWith("[")) return parseImportJson(text);
  if (/<html|<!doctype/i.test(t.slice(0, 200))) return parseImportHtml(text);
  return [parseImportCsv(text, base)];
}

/**
 * Give an imported game a fresh id (and fresh step ids) when its id is already taken.
 * @param {Game} game
 * @param {Set<string>} takenIds
 * @returns {Game}
 */
export function dedupeId(game, takenIds) {
  if (!takenIds.has(game.id)) return game;
  return { ...game, id: uid(), name: `${game.name} (imported)` };
}

/** File-name-safe slug. @param {string} s */
export function slug(s) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "game"
  );
}
