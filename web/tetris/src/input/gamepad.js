// Gamepad to actions. Browsers fire no events for button presses or repeats, so the pad is polled and
// turned into the same actions as the keyboard: held directions as state, everything else as one-shot presses.
// This is the standard mapping (Xbox layout). Pads that report another mapping still get these indexes,
// and describePad() says so; a remap screen is the planned fix.

/** @typedef {import("./actions.js").Action} Action */
/** @typedef {Pick<Gamepad, "buttons" | "axes" | "mapping" | "id" | "connected">} PadLike */
/**
 * A learned control for one action, for pads that report their d-pad in a way the standard mapping does not
 * expect (as an axis, or a hat switch, instead of buttons 12 to 15). `value` is what the axis reads when pressed.
 * @typedef {{ type: "button", index: number } | { type: "axis", index: number, value: number }} Binding
 */
/** @typedef {{ hardDrop?: Binding }} Bindings */

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

/** An axis counts as "at" a learned value when it is this close to it. */
const AXIS_MATCH = 0.15;
/** While learning, an axis must move this far from where it rested to count as the pressed control. */
const AXIS_LEARN_TRAVEL = 0.6;

/** Is the control a binding points at pressed right now? @param {PadLike} pad @param {Binding} b */
export function bindingDown(pad, b) {
  if (b.type === "button") return Boolean(pad.buttons[b.index]?.pressed);
  const v = pad.axes[b.index];
  return v !== undefined && Math.abs(v - b.value) <= AXIS_MATCH;
}

/** A short description of a binding for the status panel. @param {Binding} b */
export function describeBinding(b) {
  return b.type === "button" ? `button ${b.index}` : `axis ${b.index} at ${b.value.toFixed(2)}`;
}

/** What a pad looked like at rest, to tell later which control was pressed. @param {PadLike} pad */
export function snapshotPad(pad) {
  return { buttons: Array.from(pad.buttons, (b) => b.pressed), axes: Array.from(pad.axes) };
}

/**
 * The control pressed since `rest` was taken, or null: the first button that went down, else the first axis that
 * moved well away from where it rested.
 * @param {ReturnType<typeof snapshotPad>} rest
 * @param {PadLike} pad
 * @returns {Binding | null}
 */
export function detectBinding(rest, pad) {
  for (let i = 0; i < pad.buttons.length; i++) {
    if (pad.buttons[i].pressed && !rest.buttons[i]) return { type: "button", index: i };
  }
  for (let i = 0; i < pad.axes.length; i++) {
    if (Math.abs(pad.axes[i] - (rest.axes[i] ?? 0)) > AXIS_LEARN_TRAVEL) return { type: "axis", index: i, value: pad.axes[i] };
  }
  return null;
}

/**
 * Every action whose control is down on this pad right now.
 * A means rotate clockwise in the game and confirm in menus, B means rotate counter-clockwise and back;
 * the screen decides which one matters. Hard drop is the d-pad only, never the stick, so a stray
 * flick cannot drop a piece.
 * @param {PadLike} pad
 * @param {number} [deadzone]
 * @param {Bindings} [bindings] learned controls, added to the standard ones
 * @returns {Set<Action>}
 */
export function mapPad(pad, deadzone = STICK_DEADZONE, bindings = {}) {
  /** @type {Set<Action>} */
  const down = new Set();
  const button = (/** @type {number} */ i) => Boolean(pad.buttons[i]?.pressed);
  const x = axisDirection(pad.axes[0], deadzone);
  const y = axisDirection(pad.axes[1], deadzone);

  if (button(BUTTON.LEFT) || x < 0) down.add("left");
  if (button(BUTTON.RIGHT) || x > 0) down.add("right");
  if (button(BUTTON.DOWN) || y > 0) down.add("softDrop");
  if (button(BUTTON.UP) || (bindings.hardDrop && bindingDown(pad, bindings.hardDrop))) down.add("hardDrop");
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
 *   bindings?: (pad: PadLike) => Bindings,
 *   nav?: { getGamepads(): ArrayLike<PadLike | null> },
 * }} [options] `bindings` returns the learned controls for a pad
 */
export function createGamepad(target, options = {}) {
  const nav = options.nav ?? navigator;
  /** @type {Set<Action>} */
  let previous = new Set();
  /** @type {{ rest: ReturnType<typeof snapshotPad>, done: (b: Binding) => void } | null} */
  let learning = null;
  const bindingsFor = (/** @type {PadLike} */ pad) => options.bindings?.(pad) ?? {};

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
      if (learning) {
        const binding = detectBinding(learning.rest, pad);
        if (binding) {
          const { done } = learning;
          learning = null;
          done(binding);
          // The control is still held: count it as already down so it does not also fire as an action.
          previous = mapPad(pad, STICK_DEADZONE, bindingsFor(pad));
        }
        return { held: new Set(), pressed: [], pad };
      }
      const down = mapPad(pad, STICK_DEADZONE, bindingsFor(pad));
      const held = new Set([...down].filter((a) => HELD.has(a)));
      const pressed = [...down].filter((a) => !HELD.has(a) && !previous.has(a));
      previous = down;
      return { held, pressed, pad };
    },
    /**
     * Listen for the next control pressed on the pad and call `done` with it. While learning, poll() reports no
     * actions. Returns false if no pad is connected.
     * @param {(binding: Binding) => void} done
     */
    learn(done) {
      const pad = firstPad();
      if (!pad) return false;
      learning = { rest: snapshotPad(pad), done };
      return true;
    },
    cancelLearn() {
      learning = null;
    },
    get learning() {
      return learning !== null;
    },
    destroy() {
      target.removeEventListener("gamepadconnected", onConnected);
      target.removeEventListener("gamepaddisconnected", onDisconnected);
    },
  };
}
