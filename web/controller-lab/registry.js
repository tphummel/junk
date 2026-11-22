// Registering controllers, and recording in detail how each one behaves. Pure: it is given the list of pads (as
// navigator.getGamepads() returns it) and a time on every update, so it can be tested with fake pads.
//
// A controller is *registered* by pressing a button on it. Browsers only reveal a pad after a press anyway, and
// registering on a press (not on connect) means every player visibly claims their own slot. The first to press gets
// slot 1, the next slot 2, and so on. A slot is kept when its controller disconnects, and handed back if a controller
// with the same id reconnects, even at a different index.
//
// For each registered controller it keeps a transcript (every input, with the gap since that controller's previous
// input, hold times and press counts, and the device's own timestamp), per-button and per-stick statistics, and a
// performance record: how often the device reports, how stale a report is when we see it, and how often we poll.

import { approxBits, parsePadId, unavailable } from "./deviceinfo.js";
import { axisName, buttonName } from "./names.js";

/**
 * A pad as the Gamepad API gives it. The extras exist in some browsers only; none is guaranteed.
 * @typedef {Pick<Gamepad, "index" | "id" | "mapping" | "connected" | "buttons" | "axes"> & {
 *   timestamp?: number,
 *   hand?: string,
 *   displayId?: number,
 *   vibrationActuator?: { type?: string, playEffect?: unknown } | null,
 *   hapticActuators?: ArrayLike<unknown>,
 *   touches?: ArrayLike<unknown>,
 *   pose?: unknown,
 * }} PadLike
 */

/**
 * A running summary of numbers, with a short memory of the latest ones for percentiles.
 * @typedef {{ n: number, sum: number, sumSq: number, min: number, max: number, recent: number[] }} Stats
 */

/**
 * @typedef {object} ButtonStats
 * @property {number} presses
 * @property {number} releases
 * @property {Stats} holds how long each press was held, ms
 * @property {number | null} lastDownAt
 * @property {number | null} minPressGap the shortest time between two presses, ms
 */

/**
 * @typedef {object} AxisStats
 * @property {number} min
 * @property {number} max
 * @property {number} last
 * @property {number} events
 * @property {number} restN samples taken near the center (within 0.2)
 * @property {number} restSum
 * @property {number} restMin
 * @property {number} restMax
 * @property {{ t: number, v: number }[]} recent the last 150 ms of values, to tell a stick at rest from one passing through the middle
 */

/**
 * @typedef {object} Perf
 * @property {number} polls how many frames this controller was read
 * @property {number} stateChanges how many times the device's own timestamp changed
 * @property {boolean} timestamps whether the browser reports usable device timestamps
 * @property {number} lastTs the device timestamp last seen, or NaN
 * @property {number | null} lastPollAt
 * @property {Stats} report time between device state changes while it is streaming values, such as a stick or trigger moving (gaps over 50 ms are presses or pauses, not counted), ms
 * @property {Stats} poll time between our polls, ms
 * @property {Stats} age how old a device report was when we first saw it, ms
 * @property {number[]} recentInputs times of inputs in the last second
 * @property {number} peakRate most inputs seen in any one second
 */

/**
 * Everything else the browser would tell us about a controller, and its connection history.
 * @typedef {object} Info
 * @property {import("./deviceinfo.js").PadIdentity} identity
 * @property {number} connects how many times it has connected (the first registration counts)
 * @property {number} disconnects
 * @property {number} connectedMs time spent connected before the current stretch
 * @property {number | null} connectedSince when the current connected stretch began, or null while disconnected
 * @property {string} hand
 * @property {number | null} displayId
 * @property {{ type: string, playEffect: boolean } | null} vibration the vibration actuator, if the browser shows one
 * @property {number} hapticActuators the older haptics list (Firefox)
 * @property {number} touchesMax most touch points seen at once (a touchpad)
 * @property {boolean} pose whether a pose (motion tracking) was ever present
 * @property {Set<number>} touchable buttons that have reported being touched
 * @property {Set<number>} analog buttons that have reported a value between 0 and 1
 * @property {number[]} axisLast the last raw value of each axis
 * @property {(number | null)[]} axisSmallest the smallest step each axis has been seen to move
 * @property {number[]} axisSteps how many steps were measured for each
 */

/**
 * @typedef {object} Slot
 * @property {number} slot 1-based player number
 * @property {string} id
 * @property {string} mapping
 * @property {number | null} index the pad's index right now, or null while it is disconnected
 * @property {boolean} connected
 * @property {number} registeredAt ms on the registry clock
 * @property {number} nButtons
 * @property {number} nAxes
 * @property {{ pressed: boolean, value: number }[]} buttons live state, for drawing
 * @property {number[]} axes live state, for drawing
 * @property {boolean[]} pressedBefore buttons pressed in the previous frame
 * @property {number[]} axisLogged the last value logged for each axis
 * @property {{ presses: number, releases: number, axisEvents: number }} stats
 * @property {{ what: string, t: number } | null} last the latest input, for the card
 * @property {number | null} lastEventAt when this controller last did anything, for gaps and idle time
 * @property {LogEvent[]} log this controller's transcript, oldest first
 * @property {number} logDropped how many of its oldest entries were dropped to stay within the limit
 * @property {ButtonStats[]} buttonStats
 * @property {AxisStats[]} axisStats
 * @property {Perf} perf
 * @property {Info} info
 */

/**
 * Every entry has the time on the registry clock, the frame and the player. `gap` is the time since that player's
 * previous entry. Inputs also carry the device's own timestamp and how old it was when seen, when the browser gives one.
 * @typedef {{ t: number, frame: number, slot: number, gap: number | null } & (
 *   | { type: "register", index: number, id: string, mapping: string, buttons: number, axes: number }
 *   | { type: "disconnect" }
 *   | { type: "reconnect", index: number }
 *   | { type: "button", index: number, name: string, state: "down", value: number, count: number, sinceLast: number | null, ts?: number, age?: number }
 *   | { type: "button", index: number, name: string, state: "up", value: number, heldMs: number | null, ts?: number, age?: number }
 *   | { type: "axis", index: number, name: string, value: number, change: number, ts?: number, age?: number }
 * )} LogEvent
 */

/** An axis is logged again when it has moved this far from the last logged value. */
const AXIS_STEP = 0.1;
/** Within this of zero counts as centered; leaving it or returning to it is always logged. */
const AXIS_CENTER = 0.05;
/** Samples within this of zero count as the stick at rest, for measuring drift... */
const AXIS_REST = 0.2;
/** ...but only once the stick has been steady: its values over the last REST_WINDOW_MS all within this of each other, */
const REST_STEADY = 0.06;
/** looking back this far, */
const REST_WINDOW_MS = 150;
/** and with at least this much time actually observed (so the first moments after a change do not count). */
const REST_MIN_SPAN_MS = 80;
/**
 * Time between device state changes longer than this is not a controller streaming values (a stick or trigger moving
 * sends a new reading every few milliseconds); it is button presses or a pause. Only shorter gaps measure the report rate.
 */
const IDLE_GAP_MS = 50;
/** Axis bit depth is only estimated once this many steps have been measured: a few coarse moves would overstate the step. */
const MIN_STEPS_FOR_BITS = 8;
/** How many recent values a Stats keeps for percentiles. */
const RECENT = 300;

/** @param {number} x @param {number} places */
const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;

/** @returns {Stats} */
const makeStats = () => ({ n: 0, sum: 0, sumSq: 0, min: Infinity, max: -Infinity, recent: [] });

/** @param {number} v the axis's first value @returns {AxisStats} */
const makeAxisStats = (v) => ({ min: Infinity, max: -Infinity, last: v, events: 0, restN: 0, restSum: 0, restMin: Infinity, restMax: -Infinity, recent: [] });

/** @param {PadLike} p @param {number} t @returns {Info} */
const makeInfo = (p, t) => ({
  identity: parsePadId(p.id), connects: 1, disconnects: 0, connectedMs: 0, connectedSince: t, hand: "", displayId: null,
  vibration: null, hapticActuators: 0, touchesMax: 0, pose: false, touchable: new Set(), analog: new Set(),
  axisLast: [], axisSmallest: [], axisSteps: [],
});

/** Note what this frame shows about the device itself. @param {Slot} s @param {PadLike} p */
function observeDevice(s, p) {
  const i = s.info;
  if (p.hand) i.hand = p.hand;
  if (typeof p.displayId === "number" && p.displayId) i.displayId = p.displayId;
  const va = p.vibrationActuator;
  if (va) i.vibration = { type: va.type ?? "unknown", playEffect: typeof va.playEffect === "function" };
  if (p.hapticActuators && p.hapticActuators.length) i.hapticActuators = p.hapticActuators.length;
  if (p.touches && p.touches.length > i.touchesMax) i.touchesMax = p.touches.length;
  if (p.pose) i.pose = true;
  Array.from(p.buttons).forEach((b, idx) => {
    if (b.touched) i.touchable.add(idx);
    if (b.value > 0 && b.value < 1) i.analog.add(idx);
  });
  Array.from(p.axes).forEach((v, idx) => {
    const last = i.axisLast[idx];
    if (last !== undefined) {
      const d = Math.abs(v - last);
      if (d > 1e-6) {
        const prev = i.axisSmallest[idx] ?? null;
        if (prev === null || d < prev) i.axisSmallest[idx] = d;
        i.axisSteps[idx] = (i.axisSteps[idx] ?? 0) + 1;
      }
    }
    i.axisLast[idx] = v;
  });
}

/** @param {Stats} s @param {number} x */
function addStat(s, x) {
  s.n++;
  s.sum += x;
  s.sumSq += x * x;
  if (x < s.min) s.min = x;
  if (x > s.max) s.max = x;
  s.recent.push(x);
  if (s.recent.length > RECENT) s.recent.shift();
}

/** @param {Stats} s @returns {number | null} */
const mean = (s) => (s.n ? s.sum / s.n : null);

/** Standard deviation of everything added. @param {Stats} s @returns {number | null} */
function stdev(s) {
  if (s.n < 2) return null;
  const m = s.sum / s.n;
  return Math.sqrt(Math.max(0, s.sumSq / s.n - m * m));
}

/** The p-th percentile (0 to 100) of the recent values, by nearest rank. @param {Stats} s @param {number} p @returns {number | null} */
function percentile(s, p) {
  if (!s.recent.length) return null;
  const sorted = [...s.recent].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/** @param {number | null} x @param {number} places @returns {number | null} */
const r = (x, places) => (x === null || !Number.isFinite(x) ? null : round(x, places));

/**
 * How a controller has been behaving, as plain numbers.
 * @param {Slot} s
 * @param {number} now registry clock, ms
 */
export function summarize(s, now) {
  const p = s.perf;
  const reportMean = mean(p.report);
  const pollMean = mean(p.poll);
  const ageMean = mean(p.age);
  const i = s.info;
  const uptimeMs = i.connectedSince === null ? 0 : Math.max(0, now - i.connectedSince);
  return {
    slot: s.slot,
    id: s.id,
    mapping: s.mapping,
    index: s.index,
    connected: s.connected,
    controls: { buttons: s.nButtons, axes: s.nAxes },
    connection: {
      connected: s.connected,
      connects: i.connects,
      disconnects: i.disconnects,
      uptimeMs: r(uptimeMs, 0),
      totalConnectedMs: r(i.connectedMs + uptimeMs, 0),
      sinceRegistrationMs: r(now - s.registeredAt, 0),
    },
    device: {
      identity: i.identity,
      hand: i.hand || null,
      displayId: i.displayId,
      vibration: i.vibration,
      hapticActuators: i.hapticActuators,
      touchesMax: i.touchesMax,
      pose: i.pose,
      analogButtons: [...i.analog].sort((a, b) => a - b).map((idx) => buttonName(s.mapping, idx)),
      touchSensitiveButtons: [...i.touchable].sort((a, b) => a - b).map((idx) => buttonName(s.mapping, idx)),
      axisResolution: i.axisSmallest
        .map((step, idx) => ({ index: idx, name: axisName(s.mapping, idx), smallestStep: step === null || step === undefined ? null : round(step, 6), approxBits: (i.axisSteps[idx] ?? 0) >= MIN_STEPS_FOR_BITS ? approxBits(step ?? null) : null, steps: i.axisSteps[idx] ?? 0 }))
        .filter((a) => a.smallestStep !== null),
    },
    polls: p.polls,
    stateChanges: p.stateChanges,
    deviceTimestamps: p.timestamps,
    report: {
      samples: p.report.n,
      avgMs: r(reportMean, 2), minMs: r(p.report.n ? p.report.min : null, 2), p50Ms: r(percentile(p.report, 50), 2),
      p95Ms: r(percentile(p.report, 95), 2), maxMs: r(p.report.n ? p.report.max : null, 2), jitterMs: r(stdev(p.report), 2),
      approxHz: r(reportMean ? 1000 / reportMean : null, 1),
    },
    poll: {
      samples: p.poll.n, avgMs: r(pollMean, 2), minMs: r(p.poll.n ? p.poll.min : null, 2), maxMs: r(p.poll.n ? p.poll.max : null, 2),
      approxHz: r(pollMean ? 1000 / pollMean : null, 1),
    },
    age: p.age.n
      ? { samples: p.age.n, avgMs: r(ageMean, 2), minMs: r(p.age.min, 2), p95Ms: r(percentile(p.age, 95), 2), maxMs: r(p.age.max, 2) }
      : null,
    inputs: {
      total: s.stats.presses + s.stats.releases + s.stats.axisEvents,
      presses: s.stats.presses, releases: s.stats.releases, axisEvents: s.stats.axisEvents,
      perSecondNow: p.recentInputs.filter((t) => now - t <= 1000).length,
      perSecondPeak: p.peakRate,
      idleMs: s.lastEventAt === null ? null : r(now - s.lastEventAt, 0),
    },
    buttons: s.buttonStats
      .map((b, i) => ({
        index: i, name: buttonName(s.mapping, i), presses: b.presses, releases: b.releases,
        holdAvgMs: r(mean(b.holds), 1), holdMinMs: r(b.holds.n ? b.holds.min : null, 1), holdMaxMs: r(b.holds.n ? b.holds.max : null, 1),
        fastestRepeatMs: r(b.minPressGap, 1),
      }))
      .filter((b) => b.presses > 0 || b.releases > 0),
    axes: s.axisStats.map((a, i) => ({
      index: i, name: axisName(s.mapping, i), min: a.min === Infinity ? null : a.min, max: a.max === -Infinity ? null : a.max, last: a.last,
      events: a.events, restAvg: r(a.restN ? a.restSum / a.restN : null, 3), restNoise: r(a.restN ? a.restMax - a.restMin : null, 3), restSamples: a.restN,
    })),
  };
}

/**
 * @param {{ maxSlots?: number, maxEvents?: number, maxSlotEvents?: number, origin?: number }} [options] maxSlots: how many
 *   controllers can register (default 8); maxEvents: entries kept in the all-controllers log, oldest dropped first
 *   (default 20000); maxSlotEvents: the same for each controller's own transcript (default 20000); origin: the clock
 *   value that counts as time zero, such as the page's start (default 0)
 */
export function createRegistry(options = {}) {
  const maxSlots = options.maxSlots ?? 8;
  const maxEvents = options.maxEvents ?? 20000;
  const maxSlotEvents = options.maxSlotEvents ?? 20000;
  const origin = options.origin ?? 0;
  /** @type {Slot[]} */
  const slots = [];
  /** @type {LogEvent[]} */
  let events = [];
  let dropped = 0;
  let recording = true;
  /** Pressed buttons per unregistered pad index, as last seen: a press that was already down when we first saw it does not register. */
  /** @type {Map<number, boolean[]>} */
  const pending = new Map();

  /** @returns {Perf} */
  const makePerf = () => ({
    polls: 0, stateChanges: 0, timestamps: false, lastTs: NaN, lastPollAt: null,
    report: makeStats(), poll: makeStats(), age: makeStats(), recentInputs: [], peakRate: 0,
  });

  /** Is this entry kept? Records into the all-controllers log and the controller's own transcript. @param {Slot | null} s @param {LogEvent} ev */
  function record(s, ev) {
    if (!recording) return false;
    events.push(ev);
    if (events.length > maxEvents) {
      events.shift();
      dropped++;
    }
    if (s) {
      s.log.push(ev);
      if (s.log.length > maxSlotEvents) {
        s.log.shift();
        s.logDropped++;
      }
    }
    return true;
  }

  /** The lowest free player number, or 0 if all are taken. */
  function freeSlotNumber() {
    for (let n = 1; n <= maxSlots; n++) if (!slots.some((s) => s.slot === n)) return n;
    return 0;
  }

  return {
    /**
     * Look at every pad once. Returns the log entries this frame produced (empty while recording is off).
     * @param {ArrayLike<PadLike | null>} pads as navigator.getGamepads() returns them
     * @param {number} now ms on a steady clock, such as performance.now(); this is the same clock as the pads' timestamps
     * @param {number} frame a frame counter
     * @returns {LogEvent[]}
     */
    update(pads, now, frame) {
      const t = round(now - origin, 1);
      /** @type {LogEvent[]} */
      const out = [];
      /** Add an entry for a slot (its gap since the slot's previous entry is filled in here). */
      const emit = (/** @type {Slot} */ s, /** @type {Record<string, unknown>} */ fields) => {
        const ev = /** @type {LogEvent} */ ({ t, frame, slot: s.slot, gap: s.lastEventAt === null ? null : round(t - s.lastEventAt, 1), ...fields });
        s.lastEventAt = t;
        if (record(s, ev)) out.push(ev);
      };
      /** @type {Map<number, PadLike>} */
      const live = new Map();
      for (const p of Array.from(pads)) if (p && p.connected) live.set(p.index, p);

      // Controllers that went away (or whose index now belongs to a different device).
      for (const s of slots) {
        if (s.index === null) continue;
        const p = live.get(s.index);
        if (!p || p.id !== s.id) {
          emit(s, { type: "disconnect" });
          s.info.disconnects++;
          if (s.info.connectedSince !== null) s.info.connectedMs += t - s.info.connectedSince;
          s.info.connectedSince = null;
          s.index = null;
          s.connected = false;
          s.perf.lastTs = NaN;
          s.perf.lastPollAt = null;
        }
      }

      // New arrivals: reconnect a known controller, or wait for a press to register an unknown one.
      const claimed = new Set(slots.filter((s) => s.index !== null).map((s) => s.index));
      for (const p of live.values()) {
        if (claimed.has(p.index)) continue;
        const down = Array.from(p.buttons, (b) => b.pressed);
        const gone = slots.find((s) => s.index === null && s.id === p.id);
        if (gone) {
          gone.index = p.index;
          gone.connected = true;
          gone.mapping = p.mapping;
          gone.pressedBefore = down;
          gone.axisLogged = Array.from(p.axes, (v) => round(v, 2));
          claimed.add(p.index);
          pending.delete(p.index);
          gone.info.connects++;
          gone.info.connectedSince = t;
          gone.info.axisLast = [];
          emit(gone, { type: "reconnect", index: p.index });
          continue;
        }
        const before = pending.get(p.index);
        pending.set(p.index, down);
        if (!before) continue; // first sighting: remember what was held, so a button held at page load does not count
        const pressedNew = down.some((d, i) => d && !before[i]);
        if (!pressedNew) continue;
        const n = freeSlotNumber();
        if (n === 0) continue; // every slot is taken
        /** @type {Slot} */
        const s = {
          slot: n, id: p.id, mapping: p.mapping, index: p.index, connected: true, registeredAt: t,
          nButtons: p.buttons.length, nAxes: p.axes.length, buttons: [], axes: [], pressedBefore: before,
          axisLogged: Array.from(p.axes, (v) => round(v, 2)), stats: { presses: 0, releases: 0, axisEvents: 0 }, last: null,
          lastEventAt: null, log: [], logDropped: 0,
          buttonStats: Array.from(p.buttons, () => ({ presses: 0, releases: 0, holds: makeStats(), lastDownAt: null, minPressGap: null })),
          axisStats: Array.from(p.axes, (v) => makeAxisStats(round(v, 2))),
          perf: makePerf(), info: makeInfo(p, t),
        };
        slots.push(s);
        slots.sort((a, b) => a.slot - b.slot);
        claimed.add(p.index);
        pending.delete(p.index);
        emit(s, { type: "register", index: p.index, id: p.id, mapping: p.mapping, buttons: p.buttons.length, axes: p.axes.length });
      }
      for (const index of [...pending.keys()]) if (!live.has(index)) pending.delete(index);

      // Inputs and performance from every registered, connected controller.
      for (const s of slots) {
        if (s.index === null) continue;
        const p = /** @type {PadLike} */ (live.get(s.index));
        const perf = s.perf;

        // Performance: how often we poll, how often the device reports, and how old a report is when we see it.
        perf.polls++;
        if (perf.lastPollAt !== null) addStat(perf.poll, now - perf.lastPollAt);
        perf.lastPollAt = now;
        const ts = p.timestamp;
        /** Device timestamp and age of this report, if the browser gives them. @type {{ ts?: number, age?: number }} */
        let stamp = {};
        if (typeof ts === "number" && Number.isFinite(ts) && ts > 0) {
          perf.timestamps = true;
          if (ts !== perf.lastTs) {
            if (Number.isFinite(perf.lastTs)) {
              perf.stateChanges++;
              const gap = ts - perf.lastTs;
              if (gap > 0 && gap <= IDLE_GAP_MS) addStat(perf.report, gap);
            }
            perf.lastTs = ts;
            addStat(perf.age, Math.max(0, now - ts));
          }
          stamp = { ts: round(ts - origin, 1), age: round(Math.max(0, now - ts), 1) };
        }

        s.buttons = Array.from(p.buttons, (b) => ({ pressed: b.pressed, value: round(b.value, 2) }));
        s.axes = Array.from(p.axes, (v) => round(v, 2));
        s.nButtons = p.buttons.length;
        s.nAxes = p.axes.length;
        observeDevice(s, p);
        let inputsThisFrame = 0;

        s.buttons.forEach((b, i) => {
          const was = s.pressedBefore[i] ?? false;
          if (b.pressed === was) return;
          const name = buttonName(s.mapping, i);
          const bs = s.buttonStats[i] ?? (s.buttonStats[i] = { presses: 0, releases: 0, holds: makeStats(), lastDownAt: null, minPressGap: null });
          inputsThisFrame++;
          if (b.pressed) {
            s.stats.presses++;
            bs.presses++;
            const sinceLast = bs.lastDownAt === null ? null : round(t - bs.lastDownAt, 1);
            if (sinceLast !== null && (bs.minPressGap === null || sinceLast < bs.minPressGap)) bs.minPressGap = sinceLast;
            bs.lastDownAt = t;
            s.last = { what: `${name} down`, t };
            emit(s, { type: "button", index: i, name, state: "down", value: b.value, count: bs.presses, sinceLast, ...stamp });
          } else {
            s.stats.releases++;
            bs.releases++;
            const heldMs = bs.lastDownAt === null ? null : round(t - bs.lastDownAt, 1);
            if (heldMs !== null) addStat(bs.holds, heldMs);
            s.last = { what: `${name} up`, t };
            emit(s, { type: "button", index: i, name, state: "up", value: b.value, heldMs, ...stamp });
          }
        });
        s.pressedBefore = s.buttons.map((b) => b.pressed);

        s.axes.forEach((v, i) => {
          const a = s.axisStats[i] ?? (s.axisStats[i] = makeAxisStats(v));
          if (v < a.min) a.min = v;
          if (v > a.max) a.max = v;
          a.last = v;
          a.recent.push({ t, v });
          while (a.recent.length > 1 && t - a.recent[0].t > REST_WINDOW_MS) a.recent.shift();
          const values = a.recent.map((x) => x.v);
          const steady = t - a.recent[0].t >= REST_MIN_SPAN_MS && Math.max(...values) - Math.min(...values) < REST_STEADY;
          if (Math.abs(v) < AXIS_REST && steady) {
            a.restN++;
            a.restSum += v;
            if (v < a.restMin) a.restMin = v;
            if (v > a.restMax) a.restMax = v;
          }
          const last = s.axisLogged[i] ?? 0;
          const moved = Math.abs(v - last) >= AXIS_STEP;
          const recentered = Math.abs(v) < AXIS_CENTER && Math.abs(last) >= AXIS_CENTER;
          if (!moved && !recentered) return;
          const name = axisName(s.mapping, i);
          s.axisLogged[i] = v;
          s.stats.axisEvents++;
          a.events++;
          inputsThisFrame++;
          s.last = { what: `${name} ${v.toFixed(2)}`, t };
          emit(s, { type: "axis", index: i, name, value: v, change: round(v - last, 2), ...stamp });
        });

        // Inputs per second, over the last second.
        for (let k = 0; k < inputsThisFrame; k++) perf.recentInputs.push(t);
        while (perf.recentInputs.length && t - perf.recentInputs[0] > 1000) perf.recentInputs.shift();
        if (perf.recentInputs.length > perf.peakRate) perf.peakRate = perf.recentInputs.length;
      }
      return out;
    },

    /** Registered controllers, in player order. */
    get slots() {
      return slots;
    },

    /** Controllers the browser shows that have not registered yet, waiting for a press. @returns {{ index: number, id: string }[]} */
    unregistered(/** @type {ArrayLike<PadLike | null>} */ pads) {
      const taken = new Set(slots.filter((s) => s.index !== null).map((s) => s.index));
      return Array.from(pads)
        .filter((p) => p && p.connected && !taken.has(p.index) && !slots.some((s) => s.index === null && s.id === p.id))
        .map((p) => ({ index: /** @type {PadLike} */ (p).index, id: /** @type {PadLike} */ (p).id }));
    },

    /** Free a player number so another controller can take it. Its transcript and statistics go with it. @param {number} slot */
    forget(slot) {
      const i = slots.findIndex((s) => s.slot === slot);
      if (i >= 0) slots.splice(i, 1);
    },

    /**
     * Start measuring afresh: zero a controller's statistics, counts and performance record, keeping its transcript and
     * slot. Useful for measuring one stretch, such as after changing how it is connected.
     * @param {number} slot
     * @returns {boolean} whether there was such a controller
     */
    resetStats(slot) {
      const s = slots.find((x) => x.slot === slot);
      if (!s) return false;
      s.stats = { presses: 0, releases: 0, axisEvents: 0 };
      s.buttonStats = s.buttonStats.map(() => ({ presses: 0, releases: 0, holds: makeStats(), lastDownAt: null, minPressGap: null }));
      s.axisStats = s.axisStats.map((a) => makeAxisStats(a.last));
      s.perf = makePerf();
      return true;
    },

    /** How a registered controller is performing, or null. @param {number} slot @param {number} now registry-clock time, ms */
    summary(slot, now) {
      const s = slots.find((x) => x.slot === slot);
      return s ? summarize(s, round(now - origin, 1)) : null;
    },

    get events() {
      return events;
    },
    get dropped() {
      return dropped;
    },
    get recording() {
      return recording;
    },
    set recording(on) {
      recording = on;
    },

    /** Empty the logs and transcripts; registered controllers and their statistics stay. */
    clearLog() {
      events = [];
      dropped = 0;
      for (const s of slots) {
        s.log = [];
        s.logDropped = 0;
      }
    },

    /**
     * Everything as plain data, for the export: each controller's summary and transcript, and the combined log.
     * @param {{ startedAt: string, exportedAt: string, now: number, environment?: import("./deviceinfo.js").Environment }} meta now is the current clock reading (ms)
     * @param {number} [only] export just this player
     */
    toExport(meta, only) {
      const chosen = only === undefined ? slots : slots.filter((s) => s.slot === only);
      return {
        app: "controller-lab",
        format: 3,
        startedAt: meta.startedAt,
        exportedAt: meta.exportedAt,
        ...(meta.environment ? { environment: meta.environment, notAvailableInThisBrowser: unavailable(meta.environment) } : {}),
        pads: chosen.map((s) => ({
          ...summarize(s, round(meta.now - origin, 1)),
          registeredAtMs: s.registeredAt,
          transcriptDropped: s.logDropped,
          transcript: s.log,
        })),
        droppedEvents: dropped,
        ...(only === undefined ? { events } : {}),
      };
    },
  };
}

/**
 * The export as JSON text: readable at the top level, with the long lists one entry per line.
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
export function exportJson(data) {
  const lists = new Set(["events", "transcript"]);
  /** @param {unknown} v @param {string} key @param {string} pad @returns {string} */
  const show = (v, key, pad) => {
    if (Array.isArray(v) && lists.has(key)) {
      if (v.length === 0) return "[]";
      return `[\n${v.map((e) => `${pad}  ${JSON.stringify(e)}`).join(",\n")}\n${pad}]`;
    }
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      return `[\n${v.map((e) => `${pad}  ${show(e, "", `${pad}  `)}`).join(",\n")}\n${pad}]`;
    }
    if (v && typeof v === "object") {
      const entries = Object.entries(v);
      if (entries.length === 0) return "{}";
      return `{\n${entries.map(([k, x]) => `${pad}  ${JSON.stringify(k)}: ${show(x, k, `${pad}  `)}`).join(",\n")}\n${pad}}`;
    }
    return JSON.stringify(v);
  };
  return show(data, "", "") + "\n";
}
