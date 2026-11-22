// Driving a controller's vibration motors from a page, and reporting what the browser says it can do. Pure: the
// actuator and the clock are passed in, so it is tested with fakes.
//
// The Gamepad API's output side is gamepad.vibrationActuator, with playEffect(type, params) and reset(). The two
// effect types are "dual-rumble" (a strong low-frequency motor and a weak high-frequency one) and, on some devices,
// "trigger-rumble" (a motor in each trigger). It resolves when the effect ends, with "complete" or "preempted" (a
// newer effect replaced it). Browsers differ in whether they offer an actuator at all, which is what this is for.

/** @typedef {"dual-rumble" | "trigger-rumble"} EffectType */

/**
 * One effect to play. Magnitudes run from 0 (off) to 1 (full).
 * @typedef {object} Step
 * @property {EffectType} effect
 * @property {number} [startDelay] ms before the effect starts
 * @property {number} duration ms
 * @property {number} [strong] the strong (low-frequency) motor
 * @property {number} [weak] the weak (high-frequency) motor
 * @property {number} [left] the left trigger motor (trigger-rumble only)
 * @property {number} [right] the right trigger motor (trigger-rumble only)
 * @property {number} [gapAfter] ms to wait after it before the next step
 */

/** @typedef {Step & { result: string, tookMs: number }} StepResult */

export const EFFECT_TYPES = /** @type {const} */ (["dual-rumble", "trigger-rumble"]);
export const MAX_DURATION_MS = 5000;
export const MAX_DELAY_MS = 1000;

/** @param {number} x @returns {number} x limited to 0..1, with anything unusable counted as 0 */
export const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** @param {number} x @param {number} max @returns {number} a whole number of ms from 0 to max */
const clampMs = (x, max) => (Number.isFinite(x) ? Math.min(max, Math.max(0, Math.round(x))) : 0);

/**
 * The parameter object playEffect wants for a step. Out-of-range numbers are brought into range rather than rejected, so
 * a slider can never produce an invalid call. trigger-rumble also carries the dual-rumble motors, as the spec allows.
 * @param {Step} step
 */
export function effectParams(step) {
  const base = {
    startDelay: clampMs(step.startDelay ?? 0, MAX_DELAY_MS),
    duration: clampMs(step.duration, MAX_DURATION_MS),
    strongMagnitude: clamp01(step.strong ?? 0),
    weakMagnitude: clamp01(step.weak ?? 0),
  };
  return step.effect === "trigger-rumble" ? { ...base, leftTrigger: clamp01(step.left ?? 0), rightTrigger: clamp01(step.right ?? 0) } : base;
}

/**
 * Ready-made patterns. "Tap" is the one used to find which controller is which.
 * @type {readonly { id: string, label: string, hint: string, steps: Step[] }[]}
 */
export const PRESETS = [
  { id: "tap", label: "Tap", hint: "a short buzz on both motors", steps: [{ effect: "dual-rumble", duration: 150, strong: 1, weak: 1 }] },
  { id: "strong", label: "Strong motor", hint: "only the strong, low-frequency motor", steps: [{ effect: "dual-rumble", duration: 600, strong: 1, weak: 0 }] },
  { id: "weak", label: "Weak motor", hint: "only the weak, high-frequency motor", steps: [{ effect: "dual-rumble", duration: 600, strong: 0, weak: 1 }] },
  {
    id: "pulses", label: "Three pulses", hint: "three taps with gaps, to feel the timing",
    steps: [0, 1, 2].map(() => /** @type {Step} */ ({ effect: "dual-rumble", duration: 200, strong: 1, weak: 1, gapAfter: 150 })),
  },
  {
    id: "ramp", label: "Ramp up", hint: "five steps from gentle to full, to feel how many strength levels it has",
    steps: [0.2, 0.4, 0.6, 0.8, 1].map((m) => /** @type {Step} */ ({ effect: "dual-rumble", duration: 250, strong: m, weak: m })),
  },
  {
    id: "triggers", label: "Triggers", hint: "left trigger, then right trigger (only if the controller has trigger motors)",
    steps: [
      { effect: "trigger-rumble", duration: 400, left: 1, right: 0, gapAfter: 100 },
      { effect: "trigger-rumble", duration: 400, left: 0, right: 1 },
    ],
  },
];

/**
 * @typedef {object} ActuatorLike
 * @property {(type: string, params?: object) => Promise<unknown>} [playEffect]
 * @property {() => Promise<unknown>} [reset]
 * @property {string} [type]
 * @property {ArrayLike<string>} [effects]
 */

/**
 * What the browser says about a controller's vibration, in plain terms.
 * @param {ActuatorLike | null | undefined} actuator the pad's vibrationActuator
 * @param {number} [legacyActuators] how many entries the older hapticActuators list had
 */
export function describeHaptics(actuator, legacyActuators = 0) {
  if (!actuator) {
    return {
      present: false, type: null, canPlay: false, canReset: false, effects: /** @type {string[] | null} */ (null),
      summary: legacyActuators
        ? `Only the older hapticActuators list (${legacyActuators}) is exposed, which this panel does not drive.`
        : "No vibration actuator is exposed for this controller in this browser. The controller may still have motors, but a web page cannot drive them here.",
    };
  }
  const effects = actuator.effects ? Array.from(actuator.effects) : null;
  const canPlay = typeof actuator.playEffect === "function";
  const canReset = typeof actuator.reset === "function";
  return {
    present: true,
    type: actuator.type ?? "unknown",
    canPlay,
    canReset,
    effects,
    summary: `Vibration actuator present: type ${actuator.type ?? "unknown"}, playEffect ${canPlay ? "yes" : "no"}, reset ${canReset ? "yes" : "no"}, effects ${effects ? `listed: ${effects.join(", ") || "none"}` : "not listed by this browser (try an effect and see what happens)"}.`,
  };
}

/**
 * Play steps one after another, resolving with how each went.
 * @param {ActuatorLike | null | undefined} actuator
 * @param {readonly Step[]} steps
 * @param {{ sleep?: (ms: number) => Promise<void>, clock?: () => number, onResult?: (r: StepResult) => void }} [hooks]
 *   sleep and clock can be replaced for tests; onResult is called as each step finishes
 * @returns {Promise<StepResult[]>}
 */
export async function playSteps(actuator, steps, hooks = {}) {
  const sleep = hooks.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const clock = hooks.clock ?? (() => performance.now());
  /** @type {StepResult[]} */
  const out = [];
  for (const step of steps) {
    const t0 = clock();
    let result;
    if (!actuator || typeof actuator.playEffect !== "function") result = "unsupported";
    else {
      try {
        result = String(await actuator.playEffect(step.effect, effectParams(step)));
      } catch (e) {
        const err = /** @type {{ name?: string, message?: string }} */ (e);
        result = `error: ${err?.name ?? "Error"}${err?.message ? ` (${err.message})` : ""}`;
      }
    }
    const done = { ...step, result, tookMs: Math.round((clock() - t0) * 10) / 10 };
    out.push(done);
    hooks.onResult?.(done);
    if (step.gapAfter) await sleep(step.gapAfter);
  }
  return out;
}

/**
 * Stop whatever is playing. @param {ActuatorLike | null | undefined} actuator @returns {Promise<string>}
 */
export async function stopHaptics(actuator) {
  if (!actuator || typeof actuator.reset !== "function") return "unsupported";
  try {
    return String(await actuator.reset());
  } catch (e) {
    const err = /** @type {{ name?: string }} */ (e);
    return `error: ${err?.name ?? "Error"}`;
  }
}

/**
 * How a result string counts: played to the end, replaced by a newer effect, or a failure of some kind.
 * @param {string} result
 * @returns {"complete" | "preempted" | "failed"}
 */
export function classifyResult(result) {
  return result === "complete" ? "complete" : result === "preempted" ? "preempted" : "failed";
}
