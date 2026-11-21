// Keyboard to actions. Held keys (move, soft drop) are tracked as state; everything else is a one-shot
// press queued until the next tick reads it.

/** @typedef {import("./actions.js").Action} Action */

/** @type {Record<string, Action>} KeyboardEvent.code to action */
const KEYMAP = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowDown: "softDrop",
  KeyS: "softDrop",
  ArrowUp: "rotateCW",
  KeyW: "rotateCW",
  KeyX: "rotateCW",
  KeyZ: "rotateCCW",
  Space: "hardDrop",
  KeyC: "hold",
  ShiftLeft: "hold",
  ShiftRight: "hold",
  Escape: "pause",
  KeyP: "pause",
  Enter: "confirm",
  Backspace: "back",
  KeyT: "stage",
};

const HELD = new Set(["left", "right", "softDrop"]);

/**
 * @param {EventTarget} target where to listen, normally `window`
 */
export function createKeyboard(target) {
  /** @type {Map<string, Action>} keys currently down that map to held actions */
  const down = new Map();
  /** @type {Action[]} */
  let pressed = [];
  /** @type {Set<Action>} held actions pressed since the last tick, so a tap shorter than a tick still counts */
  let tapped = new Set();

  /** @param {Event} ev */
  const onKeyDown = (ev) => {
    const e = /** @type {KeyboardEvent} */ (ev);
    const action = KEYMAP[e.code];
    if (!action || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (e.repeat) return; // auto-repeat is ours, not the OS's
    if (HELD.has(action)) {
      down.set(e.code, action);
      tapped.add(action);
    }
    else pressed.push(action);
  };
  /** @param {Event} ev */
  const onKeyUp = (ev) => {
    down.delete(/** @type {KeyboardEvent} */ (ev).code);
  };
  const onBlur = () => down.clear();

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", onBlur);

  return {
    /** Actions held at any point since the last call (left, right, softDrop). Call once per tick. @returns {Set<Action>} */
    held() {
      const out = new Set([...down.values(), ...tapped]);
      tapped = new Set();
      return out;
    },
    /** One-shot actions pressed since the last call. @returns {Action[]} */
    takePressed() {
      const out = pressed;
      pressed = [];
      return out;
    },
    clear() {
      down.clear();
      tapped = new Set();
      pressed = [];
    },
    destroy() {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", onBlur);
    },
  };
}
