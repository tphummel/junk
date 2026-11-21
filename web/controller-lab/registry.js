// Registering controllers and turning their raw state into a log of who did what, when. Pure: it is given the list of
// pads (as navigator.getGamepads() returns it) and a time on every update, so it can be tested with fake pads.
//
// A controller is *registered* by pressing a button on it. Browsers only reveal a pad after a press anyway, and
// registering on a press (not on connect) means every player visibly claims their own slot. The first to press gets
// slot 1, the next slot 2, and so on. A slot is kept when its controller disconnects, and handed back if a controller
// with the same id reconnects, even at a different index.

import { axisName, buttonName } from "./names.js";

/** @typedef {Pick<Gamepad, "index" | "id" | "mapping" | "connected" | "buttons" | "axes">} PadLike */

/** A slot's controller as last seen, kept so the next frame can be compared with it. */
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
 */

/**
 * @typedef {{ t: number, frame: number, slot: number, type: "register", index: number, id: string, mapping: string }
 *   | { t: number, frame: number, slot: number, type: "disconnect" }
 *   | { t: number, frame: number, slot: number, type: "reconnect", index: number }
 *   | { t: number, frame: number, slot: number, type: "button", index: number, name: string, state: "down" | "up", value: number }
 *   | { t: number, frame: number, slot: number, type: "axis", index: number, name: string, value: number }} LogEvent
 */

/** An axis is logged again when it has moved this far from the last logged value. */
const AXIS_STEP = 0.1;
/** Within this of zero counts as centered; leaving it or returning to it is always logged. */
const AXIS_CENTER = 0.05;

/** @param {number} x @param {number} places */
const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;

/**
 * @param {{ maxSlots?: number, maxEvents?: number }} [options] maxSlots: how many controllers can register (default 8);
 *   maxEvents: how many log entries are kept, oldest dropped first (default 5000)
 */
export function createRegistry(options = {}) {
  const maxSlots = options.maxSlots ?? 8;
  const maxEvents = options.maxEvents ?? 5000;
  /** @type {Slot[]} */
  const slots = [];
  /** @type {LogEvent[]} */
  let events = [];
  let dropped = 0;
  let recording = true;
  /** Pressed buttons per unregistered pad index, as last seen: a press that was already down when we first saw it does not register. */
  /** @type {Map<number, boolean[]>} */
  const pending = new Map();

  /** @param {LogEvent} ev */
  function record(ev) {
    if (!recording) return false;
    events.push(ev);
    if (events.length > maxEvents) {
      events.shift();
      dropped++;
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
     * @param {number} now ms on any steady clock, such as performance.now()
     * @param {number} frame a frame counter
     * @returns {LogEvent[]}
     */
    update(pads, now, frame) {
      const t = round(now, 1);
      /** @type {LogEvent[]} */
      const out = [];
      const emit = (/** @type {LogEvent} */ ev) => {
        if (record(ev)) out.push(ev);
      };
      /** @type {Map<number, PadLike>} */
      const live = new Map();
      for (const p of Array.from(pads)) if (p && p.connected) live.set(p.index, p);

      // Controllers that went away (or whose index now belongs to a different device).
      for (const s of slots) {
        if (s.index === null) continue;
        const p = live.get(s.index);
        if (!p || p.id !== s.id) {
          emit({ t, frame, slot: s.slot, type: "disconnect" });
          s.index = null;
          s.connected = false;
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
          emit({ t, frame, slot: gone.slot, type: "reconnect", index: p.index });
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
        };
        slots.push(s);
        slots.sort((a, b) => a.slot - b.slot);
        claimed.add(p.index);
        pending.delete(p.index);
        emit({ t, frame, slot: n, type: "register", index: p.index, id: p.id, mapping: p.mapping });
      }
      for (const index of [...pending.keys()]) if (!live.has(index)) pending.delete(index);

      // Inputs from every registered, connected controller.
      for (const s of slots) {
        if (s.index === null) continue;
        const p = /** @type {PadLike} */ (live.get(s.index));
        s.buttons = Array.from(p.buttons, (b) => ({ pressed: b.pressed, value: round(b.value, 2) }));
        s.axes = Array.from(p.axes, (v) => round(v, 2));
        s.nButtons = p.buttons.length;
        s.nAxes = p.axes.length;
        s.buttons.forEach((b, i) => {
          const was = s.pressedBefore[i] ?? false;
          if (b.pressed === was) return;
          const name = buttonName(s.mapping, i);
          const state = b.pressed ? "down" : "up";
          if (b.pressed) s.stats.presses++;
          else s.stats.releases++;
          s.last = { what: `${name} ${state}`, t };
          emit({ t, frame, slot: s.slot, type: "button", index: i, name, state, value: b.value });
        });
        s.pressedBefore = s.buttons.map((b) => b.pressed);
        s.axes.forEach((v, i) => {
          const last = s.axisLogged[i] ?? 0;
          const moved = Math.abs(v - last) >= AXIS_STEP;
          const recentered = Math.abs(v) < AXIS_CENTER && Math.abs(last) >= AXIS_CENTER;
          if (!moved && !recentered) return;
          s.axisLogged[i] = v;
          const name = axisName(s.mapping, i);
          s.stats.axisEvents++;
          s.last = { what: `${name} ${v.toFixed(2)}`, t };
          emit({ t, frame, slot: s.slot, type: "axis", index: i, name, value: v });
        });
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

    /** Free a player number so another controller can take it. @param {number} slot */
    forget(slot) {
      const i = slots.findIndex((s) => s.slot === slot);
      if (i >= 0) slots.splice(i, 1);
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

    /** Empty the log; registered controllers stay. */
    clearLog() {
      events = [];
      dropped = 0;
    },

    /**
     * Everything as plain data, for the export.
     * @param {{ startedAt: string, exportedAt: string }} meta
     */
    toExport(meta) {
      return {
        app: "controller-lab",
        format: 1,
        startedAt: meta.startedAt,
        exportedAt: meta.exportedAt,
        pads: slots.map((s) => ({
          slot: s.slot, id: s.id, mapping: s.mapping, index: s.index, connected: s.connected, buttons: s.nButtons, axes: s.nAxes,
          registeredAtMs: s.registeredAt, presses: s.stats.presses, releases: s.stats.releases, axisEvents: s.stats.axisEvents,
        })),
        droppedEvents: dropped,
        events,
      };
    },
  };
}

/**
 * The export as JSON text: readable at the top level, with the log one entry per line.
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
export function exportJson(data) {
  /** @param {unknown} v @param {string} key @param {string} pad @returns {string} */
  const show = (v, key, pad) => {
    if (Array.isArray(v) && (key === "events" || key === "pads")) {
      if (v.length === 0) return "[]";
      return `[\n${v.map((e) => `${pad}  ${JSON.stringify(e)}`).join(",\n")}\n${pad}]`;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const entries = Object.entries(v);
      if (entries.length === 0) return "{}";
      return `{\n${entries.map(([k, x]) => `${pad}  ${JSON.stringify(k)}: ${show(x, k, `${pad}  `)}`).join(",\n")}\n${pad}}`;
    }
    return JSON.stringify(v);
  };
  return show(data, "", "") + "\n";
}
