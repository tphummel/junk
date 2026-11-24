// Gamepad to actions. Browsers fire no events for button presses or repeats, so the pad is polled and
// turned into the same actions as the keyboard: held directions as state, everything else as one-shot presses.
// This is the standard mapping (Xbox layout). Pads that report another mapping still get these indexes,
// and describePad() says so.
//
// The d-pad is where pads differ most. On the standard mapping it is buttons 12 to 15. Some pads send it as the left
// stick instead, and some (in Chrome) as a hat switch on a spare axis. Left, right and down work the same either way,
// but up is also hard drop, so a d-pad that arrives as a stick or a hat has to be recognised as a d-pad and not a stick:
// a real analog stick must never drop a piece by accident. observePad() works that out from what the pad reports.

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
 * What we have worked out about how a pad sends its d-pad, from what it has reported so far.
 * @typedef {object} PadState
 * @property {boolean} analogStick the left stick has shown an in-between value, so it is a real analog stick
 * @property {boolean} digitalHit the left stick has reached full deflection
 * @property {boolean} dpadButtons a d-pad button (12 to 15) has been pressed, so the d-pad is on the buttons
 * @property {Set<number>} hatAxes axes seen resting at the hat switch's neutral value
 */

/** @returns {PadState} */
export const newPadState = () => ({ analogStick: false, digitalHit: false, dpadButtons: false, hatAxes: new Set() });

/** An axis value strictly between these (in size) is an in-between reading that only an analog stick gives. */
const IN_BETWEEN_MIN = 0.08;
const IN_BETWEEN_MAX = 0.93;
/** The neutral value of a Chrome-style hat switch: 9/7. */
const HAT_NEUTRAL = 9 / 7;
/** How close counts as matching one of the hat's eight positions. */
const HAT_MATCH = 0.07;

/**
 * Learn from one reading of a pad. A d-pad sent as the left stick gives only exact values (0, -1 and 1), where an
 * analog stick gives in-between ones as it moves; so a stick that has hit full deflection and never shown an in-between
 * value is a d-pad. Once any in-between value is seen it is an analog stick for good. A pad whose d-pad buttons have
 * been pressed has its d-pad on the buttons, so its stick is a stick. A hat is an extra axis that rests at 9/7.
 * @param {PadLike} pad
 * @param {PadState} state changed in place
 */
export function observePad(pad, state) {
  for (const i of [0, 1]) {
    const v = pad.axes[i];
    if (v === undefined) continue;
    const m = Math.abs(v);
    if (m > IN_BETWEEN_MIN && m < IN_BETWEEN_MAX) state.analogStick = true;
    if (m >= 0.99) state.digitalHit = true;
  }
  for (const i of [BUTTON.UP, BUTTON.DOWN, BUTTON.LEFT, BUTTON.RIGHT]) if (pad.buttons[i]?.pressed) state.dpadButtons = true;
  pad.axes.forEach((v, i) => {
    if (i >= 2 && Math.abs(v - HAT_NEUTRAL) < 0.02) state.hatAxes.add(i);
  });
}

/** Does this pad send its d-pad as the left stick? @param {PadState} state */
export const dpadOnStick = (state) => state.digitalHit && !state.analogStick && !state.dpadButtons;

/**
 * The directions a hat switch value stands for, or null if it is not one of its positions (including neutral).
 * The positions run clockwise from up: -1, -0.714, -0.429, -0.143, 0.143, 0.429, 0.714 and 1.
 * @param {number} v
 * @returns {{ up: boolean, right: boolean, down: boolean, left: boolean } | null}
 */
export function hatDirections(v) {
  const steps = [-1, -5 / 7, -3 / 7, -1 / 7, 1 / 7, 3 / 7, 5 / 7, 1];
  const i = steps.findIndex((s) => Math.abs(v - s) < HAT_MATCH);
  if (i < 0) return null;
  return {
    up: i === 0 || i === 1 || i === 7,
    right: i === 1 || i === 2 || i === 3,
    down: i === 3 || i === 4 || i === 5,
    left: i === 5 || i === 6 || i === 7,
  };
}

/**
 * Every action whose control is down on this pad right now.
 * A means rotate clockwise in the game and confirm in menus, B means rotate counter-clockwise and back;
 * the screen decides which one matters. Up on the d-pad is hard drop, wherever the pad puts its d-pad: buttons, a
 * digital stick or a hat. Up on an analog stick never is, so a stray flick cannot drop a piece. Y is hard drop too (on
 * the standard mapping), so there is always one more way to do it.
 * @param {PadLike} pad
 * @param {number} [deadzone]
 * @param {PadState} [state] what observePad has learned about this pad; without it only the standard d-pad buttons count
 * @returns {Set<Action>}
 */
export function mapPad(pad, deadzone = STICK_DEADZONE, state = newPadState()) {
  /** @type {Set<Action>} */
  const down = new Set();
  const button = (/** @type {number} */ i) => Boolean(pad.buttons[i]?.pressed);
  const x = axisDirection(pad.axes[0], deadzone);
  const y = axisDirection(pad.axes[1], deadzone);
  const stickIsDpad = dpadOnStick(state);

  let left = button(BUTTON.LEFT) || x < 0;
  let right = button(BUTTON.RIGHT) || x > 0;
  let downward = button(BUTTON.DOWN) || y > 0;
  let upward = button(BUTTON.UP) || (stickIsDpad && y < 0);
  for (const i of state.hatAxes) {
    const hat = hatDirections(pad.axes[i] ?? Number.NaN);
    if (!hat) continue;
    left ||= hat.left;
    right ||= hat.right;
    downward ||= hat.down;
    upward ||= hat.up;
  }

  if (left) down.add("left");
  if (right) down.add("right");
  if (downward) {
    down.add("softDrop");
    down.add("down");
  }
  if (y < 0) down.add("up"); // the stick moves menu selection; on its own it never drops a piece
  if (upward || (pad.mapping === "standard" && button(BUTTON.Y))) {
    down.add("hardDrop");
    down.add("up");
  }
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
 * @param {{
 *   onConnect?: (pad: PadLike) => void,
 *   onDisconnect?: () => void,
 *   nav?: { getGamepads(): ArrayLike<PadLike | null> },
 * }} [options]
 */
export function createGamepad(target, options = {}) {
  const nav = options.nav ?? navigator;
  /** @type {Set<Action>} */
  let previous = new Set();
  /** What has been learned about the current pad, kept only while it is the same pad. @type {{ key: string, state: PadState } | null} */
  let known = null;

  /** The first connected pad, or null. The first one wins when several are attached. @returns {PadLike | null} */
  const firstPad = () => Array.from(nav.getGamepads?.() ?? []).find((p) => p && p.connected) ?? null;

  /** @param {Event} ev */
  const onConnected = (ev) => {
    previous = new Set();
    known = null;
    const pad = firstPad() ?? /** @type {GamepadEvent} */ (ev).gamepad;
    options.onConnect?.(pad);
  };
  const onDisconnected = () => {
    previous = new Set();
    known = null;
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
        known = null;
        return { held: new Set(), pressed: [], pad: null };
      }
      // Learn from this reading before using it, so the very first press of a digital d-pad already counts.
      const key = pad.id;
      if (!known || known.key !== key) known = { key, state: newPadState() };
      observePad(pad, known.state);
      const down = mapPad(pad, STICK_DEADZONE, known.state);
      const held = new Set([...down].filter((a) => HELD.has(a)));
      const pressed = [...down].filter((a) => !HELD.has(a) && !previous.has(a));
      previous = down;
      return { held, pressed, pad };
    },
    /** How this pad sends its d-pad, as far as is known, for the status panel. @returns {{ dpadOnStick: boolean, analogStick: boolean, hat: boolean, dpadButtons: boolean } | null} */
    info() {
      if (!known) return null;
      const st = known.state;
      return { dpadOnStick: dpadOnStick(st), analogStick: st.analogStick, hat: st.hatAxes.size > 0, dpadButtons: st.dpadButtons };
    },
    destroy() {
      target.removeEventListener("gamepadconnected", onConnected);
      target.removeEventListener("gamepaddisconnected", onDisconnected);
    },
  };
}
