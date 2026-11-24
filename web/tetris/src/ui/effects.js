// Visual flourish for squares and line clears. This is state only (what is animating and until when); drawing is
// in render.js. It reads the events the game reports and never touches the game, so it cannot change play.
// Time is wall-clock milliseconds (performance.now) and randomness is Math.random: both are fine here, and both
// are injectable so the tests are exact.

/** @typedef {import("../game/state.js").GameEvent} GameEvent */
/** @typedef {"gold" | "silver" | "plain" | "danger"} Tone */
/**
 * @typedef {{ kind: "shine", tone: Tone, row: number, col: number, start: number, dur: number }
 *   | { kind: "ring", tone: Tone, row: number, col: number, start: number, dur: number }
 *   | { kind: "flash", tone: Tone, row: number, start: number, dur: number }
 *   | { kind: "spark", tone: Tone, x: number, y: number, vx: number, vy: number, start: number, dur: number }
 *   | { kind: "popup", tone: Tone, row: number, text: string, start: number, dur: number }} Effect
 * Positions are in cells: x is a column, y and row are board rows (including the hidden ones).
 */

const SQUARE = 4;
const COLS = 10;
const ROWS = 22; // board rows including the 2 hidden ones

/**
 * @param {{ rng?: () => number, reducedMotion?: () => boolean }} [options] `reducedMotion` is asked each time
 *   events are added: with it on there is no movement, only a brief glow and the points
 */
export function createEffects(options = {}) {
  const rng = options.rng ?? Math.random;
  const reduced = options.reducedMotion ?? (() => false);
  /** @type {Effect[]} */
  let list = [];

  /** Sparks flying out from a point, in cells per second. */
  function burst(/** @type {Tone} */ tone, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ n, /** @type {number} */ now, /** @type {number} */ speed) {
    for (let i = 0; i < n; i++) {
      const angle = rng() * Math.PI * 2;
      const v = speed * (0.5 + rng() * 0.8);
      list.push({ kind: "spark", tone, x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v - 1.5, start: now, dur: 600 + rng() * 500 });
    }
  }

  return {
    /**
     * Start effects for the events of one step.
     * @param {readonly GameEvent[]} events
     * @param {number} now
     */
    add(events, now) {
      const calm = reduced();
      for (const ev of events) {
        if (ev.type === "square") {
          const tone = ev.kind;
          list.push({ kind: "ring", tone, row: ev.row, col: ev.col, start: now, dur: calm ? 500 : 900 });
          if (!calm) {
            list.push({ kind: "shine", tone, row: ev.row, col: ev.col, start: now, dur: 1000 });
            burst(tone, ev.col + SQUARE / 2, ev.row + SQUARE / 2, 22, now, 6);
          }
        } else if (ev.type === "garbage") {
          // Rows rising from the bottom: a red flash on the rows that just arrived.
          for (let i = 0; i < ev.rows; i++) list.push({ kind: "flash", tone: "danger", row: ROWS - 1 - i, start: now, dur: 500 });
        } else {
          let best = /** @type {Tone} */ ("plain");
          ev.rows.forEach((row, i) => {
            const { gold, silver } = ev.rowSquares[i];
            const tone = /** @type {Tone} */ (gold > 0 ? "gold" : silver > 0 ? "silver" : "plain");
            if (tone === "gold" || (tone === "silver" && best === "plain")) best = tone;
            list.push({ kind: "flash", tone, row, start: now, dur: tone === "plain" ? 350 : 850 });
            if (!calm && tone !== "plain") {
              for (let k = 0; k < 8 + (gold + silver) * 6; k++) burst(tone, rng() * COLS, row + 0.5, 1, now, 5);
            }
          });
          // Points float up from the middle of the cleared rows, but only when a square made the clear special.
          if (best !== "plain") {
            const mid = ev.rows[Math.floor(ev.rows.length / 2)];
            list.push({ kind: "popup", tone: best, row: mid, text: `+${ev.points}`, start: now, dur: 1200 });
          }
        }
      }
    },
    /** Effects still animating at `now`; finished ones are dropped. @param {number} now @returns {readonly Effect[]} */
    active(now) {
      list = list.filter((e) => now - e.start < e.dur);
      return list;
    },
    clear() {
      list = [];
    },
    /** Reduced motion on right now? Drawing uses it to hold popups still. */
    get calm() {
      return reduced();
    },
  };
}
