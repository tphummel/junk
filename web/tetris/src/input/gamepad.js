// Gamepad to actions. Browsers fire no events for button presses or repeats, so the pad is polled and
// turned into the same actions as the keyboard: held directions as state, everything else as one-shot presses.
// This is the standard mapping (Xbox layout). Pads that report another mapping still get these indexes,
// and describePad() says so; a remap screen is the planned fix.

/** @typedef {import("./actions.js").Action} Action */
/** @typedef {Pick<Gamepad, "buttons" | "axes" | "mapping" | "id" | "connected">} PadLike */

/** Radius of the stick's dead zone: drift below this is ignored. Worn sticks drift 0.15 to 0.2. */
export const STICK_DEADZONE = 0.2;
/** After the dead zone is removed and the rest rescaled to 0..1, a stick counts as pressed past this. */
const STICK_PRESS = 0.4;

/** Standard-mapping button indexes (the Gamepad API "standard" layout). */
export const BUTTON = /** @type {const} */ ({
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
});

/** Actions that are state while a button is down; the rest fire once per press. */
const HELD = new Set(["left", "right", "softDrop"]);

/**
 * Stick axis to -1, 0 or 1, with the dead zone removed.
 * @param {number | undefined} v raw axis value, -1 to 1
 * @param {number} [deadzone]
 * @returns {-1 | 0 | 1}
 */
export function axisDirection(v = 0, deadzone = STICK_DEADZONE) {
  const mag = Math.abs(v);
  if (mag <= deadzone) return 0;
  return (mag - deadzone) / (1 - deadzone) > STICK_PRESS ? (v < 0 ? -1 : 1) : 0;
}

/**
 * Every action whose control is down on this pad right now.
 * A means rotate clockwise in the game and confirm in menus, B means rotate counter-clockwise and back;
 * the screen decides which one matters. Hard drop is the d-pad only, never the stick, so a stray
 * flick cannot drop a piece.
 * @param {PadLike} pad
 * @param {number} [deadzone]
 * @returns {Set<Action>}
 */
export function mapPad(pad, deadzone = STICK_DEADZONE) {
  /** @type {Set<Action>} */
  const down = new Set();
  const button = (/** @type {number} */ i) => Boolean(pad.buttons[i]?.pressed);
  const x = axisDirection(pad.axes[0], deadzone);
  const y = axisDirection(pad.axes[1], deadzone);

  if (button(BUTTON.LEFT) || x < 0) down.add("left");
  if (button(BUTTON.RIGHT) || x > 0) down.add("right");
  if (button(BUTTON.DOWN) || y > 0) down.add("softDrop");
  if (button(BUTTON.UP)) down.add("hardDrop");
  if (button(BUTTON.A)) {
    down.add("rotateCW");
    down.add("confirm");
  }
  if (button(BUTTON.B)) {
    down.add("rotateCCW");
    down.add("back");
  }
  if (button(BUTTON.LB) || button(BUTTON.RB)) down.add("hold");
  if (button(BUTTON.START)) down.add("pause");
  return down;
}

/** A short label for the connected pad, noting a non-standard mapping. @param {PadLike} pad */
export function describePad(pad) {
  const name = pad.id.replace(/\s*\(.*?\)\s*/g, " ").trim() || "gamepad";
  return pad.mapping === "standard" ? name : `${name} (non-standard mapping: buttons may be wrong)`;
}

/**
 * Poll the first connected pad each time poll() is called. Call it once per tick (or per frame in menus).
 * @param {EventTarget} target where gamepadconnected / gamepaddisconnected fire, normally `window`
 * @param {{ onConnect?: (pad: PadLike) => void, onDisconnect?: () => void, nav?: { getGamepads(): ArrayLike<PadLike | null> } }} [options]
 */
export function createGamepad(target, options = {}) {
  const nav = options.nav ?? navigator;
  /** @type {Set<Action>} */
  let previous = new Set();

  /** The first connected pad, or null. The first one wins when several are attached. @returns {PadLike | null} */
  const firstPad = () => Array.from(nav.getGamepads?.() ?? []).find((p) => p && p.connected) ?? null;

  /** @param {Event} ev */
  const onConnected = (ev) => {
    previous = new Set();
    const pad = firstPad() ?? /** @type {GamepadEvent} */ (ev).gamepad;
    options.onConnect?.(pad);
  };
  const onDisconnected = () => {
    previous = new Set();
    if (!firstPad()) options.onDisconnect?.();
  };
  target.addEventListener("gamepadconnected", onConnected);
  target.addEventListener("gamepaddisconnected", onDisconnected);

  return {
    pad: firstPad,
    /**
     * @returns {{ held: Set<Action>, pressed: Action[], pad: PadLike | null }} held directions now, and
     * one-shot actions whose button went down since the last poll
     */
    poll() {
      const pad = firstPad();
      if (!pad) {
        previous = new Set();
        return { held: new Set(), pressed: [], pad: null };
      }
      const down = mapPad(pad);
      const held = new Set([...down].filter((a) => HELD.has(a)));
      const pressed = [...down].filter((a) => !HELD.has(a) && !previous.has(a));
      previous = down;
      return { held, pressed, pad };
    },
    destroy() {
      target.removeEventListener("gamepadconnected", onConnected);
      target.removeEventListener("gamepaddisconnected", onDisconnected);
    },
  };
}
