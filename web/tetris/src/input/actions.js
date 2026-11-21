// The one action layer every device maps onto, plus auto-repeat (DAS/ARR) counted in game ticks.
// Gamepads fire no repeat events, so repeat lives here and not in the devices.

/** @typedef {import("../game/state.js").GameAction} GameAction */
/** @typedef {GameAction | "pause" | "confirm" | "back"} Action */

/** Every action a device can produce. The game itself only understands the GameAction subset. */
export const ACTIONS = /** @type {const} */ ([
  "left", "right", "softDrop", "hardDrop", "rotateCW", "rotateCCW", "hold", "pause", "confirm", "back",
]);

/** Ticks a direction must be held before it starts repeating (about 167 ms). */
export const DEFAULT_DAS = 10;
/** Ticks between repeats once repeating (about 33 ms). */
export const DEFAULT_ARR = 2;

/**
 * Turns "which directions are held this tick" into left/right events: one on press, then after `das` ticks
 * one every `arr` ticks. If both are held, the most recently pressed wins. Call update() once per tick.
 * @param {{ das?: number, arr?: number }} [options]
 */
export function createRepeater(options = {}) {
  const das = options.das ?? DEFAULT_DAS;
  const arr = Math.max(1, options.arr ?? DEFAULT_ARR);
  /** @type {"left" | "right" | null} */
  let active = null;
  let heldTicks = 0;
  /** @type {Set<string>} */
  let previous = new Set();

  return {
    /**
     * @param {ReadonlySet<string>} held directions currently down
     * @returns {("left" | "right")[]} events for this tick
     */
    update(held) {
      /** @type {("left" | "right")[]} */
      const out = [];
      for (const dir of /** @type {const} */ (["left", "right"])) {
        if (held.has(dir) && !previous.has(dir)) {
          active = dir;
          heldTicks = 0;
          out.push(dir);
        }
      }
      if (active && !held.has(active)) {
        // Released: fall back to the other direction if it is still held, without re-firing it.
        const other = active === "left" ? "right" : "left";
        active = held.has(other) ? other : null;
        heldTicks = 0;
      } else if (active && out.length === 0) {
        heldTicks++;
        if (heldTicks >= das && (heldTicks - das) % arr === 0) out.push(active);
      }
      previous = new Set(held);
      return out;
    },
    reset() {
      active = null;
      heldTicks = 0;
      previous = new Set();
    },
  };
}
