// @ts-check
// Pure logic for face guide: head pose from MediaPipe's transformation matrix, the 0-100 score,
// smoothing, and which single correction to show. No DOM, so it is unit-tested from api/ (`npm test`).
// The score mirrors face-analysis/score_face.py (pose + neutral expression, equal weights), with a
// wider pose tolerance because a live webcam estimate is only good to a few degrees.

export const CONFIG = {
  poseFull: 4, // degrees from zero that still count as perfect
  poseZero: 15, // degrees from zero that score nothing
  exprFull: 0.05, // blendshape activation that still counts as neutral
  exprZero: 0.5, // activation that scores nothing
};

/** Blendshape groups that should be near zero for a neutral face (same set as score_face.py). */
export const EXPRESSION_PARTS = {
  smile: ["mouthSmileLeft", "mouthSmileRight"],
  frown: ["mouthFrownLeft", "mouthFrownRight"],
  mouth_open: ["jawOpen"],
  pucker: ["mouthPucker"],
  blink: ["eyeBlinkLeft", "eyeBlinkRight"],
  squint: ["eyeSquintLeft", "eyeSquintRight"],
  brow_down: ["browDownLeft", "browDownRight"],
};

/** 1 at or below `full`, 0 at or above `zero`, linear between. */
export function ramp(value, full, zero) {
  if (value <= full) return 1;
  if (value >= zero) return 0;
  return 1 - (value - full) / (zero - full);
}

/**
 * Pitch, yaw and roll in degrees from a MediaPipe facial transformation matrix. The JS API gives a
 * flat 16-number array in column-major order, so element (row, col) is data[col * 4 + row]. The
 * formulas are the ones in analyze_face.py's calculate_head_pose.
 * @param {ArrayLike<number>} data
 * @returns {{pitch: number, yaw: number, roll: number}}
 */
export function poseFromMatrix(data) {
  const r = (row, col) => data[col * 4 + row];
  const sy = Math.hypot(r(0, 0), r(1, 0));
  const deg = (x) => (x * 180) / Math.PI;
  if (sy >= 1e-6) {
    return {
      pitch: deg(Math.atan2(r(2, 1), r(2, 2))),
      yaw: deg(Math.atan2(-r(2, 0), sy)),
      roll: deg(Math.atan2(r(1, 0), r(0, 0))),
    };
  }
  return { pitch: deg(Math.atan2(-r(1, 2), r(1, 1))), yaw: deg(Math.atan2(-r(2, 0), sy)), roll: 0 };
}

/**
 * Score one frame.
 * @param {{pose: {pitch: number, yaw: number, roll: number}, blendshapes: Record<string, number>}} frame
 * @param {typeof CONFIG} [cfg]
 */
export function scoreFrame({ pose, blendshapes }, cfg = CONFIG) {
  /** @type {Record<string, {kind: "pose" | "expr", value: number, score: number, penalty: number}>} */
  const parts = {};
  for (const axis of /** @type {const} */ (["pitch", "yaw", "roll"])) {
    const score = ramp(Math.abs(pose[axis]), cfg.poseFull, cfg.poseZero);
    parts[axis] = { kind: "pose", value: pose[axis], score, penalty: 1 - score };
  }
  for (const [name, keys] of Object.entries(EXPRESSION_PARTS)) {
    const present = keys.filter((k) => k in blendshapes).map((k) => blendshapes[k]);
    if (!present.length) continue;
    const value = present.reduce((a, b) => a + b, 0) / present.length;
    const score = ramp(value, cfg.exprFull, cfg.exprZero);
    parts[name] = { kind: "expr", value, score, penalty: 1 - score };
  }
  const mean = (kind) => {
    const list = Object.values(parts).filter((p) => p.kind === kind);
    return list.length ? (100 * list.reduce((a, p) => a + p.score, 0)) / list.length : 0;
  };
  const poseScore = mean("pose");
  const exprScore = mean("expr");
  return {
    total: (poseScore + exprScore) / 2,
    pose: poseScore,
    expression: exprScore,
    parts,
    perfect: Object.values(parts).every((p) => p.penalty === 0),
  };
}

/** Exponential smoothing per key; blink is smoothed harder so one blink does not register. */
export class Smoother {
  constructor(alpha = 0.4, slowAlpha = 0.12) {
    this.alpha = alpha;
    this.slowAlpha = slowAlpha;
    /** @type {Record<string, number>} */
    this.state = {};
  }
  /** @param {Record<string, number>} values */
  update(values) {
    for (const [k, v] of Object.entries(values)) {
      const a = k.startsWith("eyeBlink") ? this.slowAlpha : this.alpha;
      this.state[k] = k in this.state ? this.state[k] + a * (v - this.state[k]) : v;
    }
    return { ...this.state };
  }
  reset() {
    this.state = {};
  }
}

/**
 * Chooses the one correction to show. Pose outranks expression; within a group the biggest penalty
 * wins. A hint appears once its penalty passes `showAbove`, stays until it falls under `clearBelow`,
 * and a different hint only replaces it after `holdMs` and if clearly worse (`margin`), so the text
 * does not flicker.
 */
export class AdviceTracker {
  constructor({ showAbove = 0.1, clearBelow = 0.03, margin = 0.15, holdMs = 600 } = {}) {
    Object.assign(this, { showAbove, clearBelow, margin, holdMs });
    /** @type {string | null} */
    this.key = null;
    this.since = 0;
  }
  /** @param {ReturnType<typeof scoreFrame>["parts"]} parts @param {number} now ms */
  update(parts, now) {
    const pick = () => {
      let best = null;
      for (const [key, p] of Object.entries(parts)) {
        if (p.penalty <= this.showAbove) continue;
        const rank = (p.kind === "pose" ? 10 : 0) + p.penalty;
        if (!best || rank > best.rank) best = { key, rank, penalty: p.penalty };
      }
      return best;
    };
    const cur = this.key ? parts[this.key] : null;
    const best = pick();
    if (cur && cur.penalty > this.clearBelow) {
      if (best && best.key !== this.key && best.penalty >= cur.penalty + this.margin && now - this.since >= this.holdMs) {
        this.key = best.key;
        this.since = now;
      }
    } else {
      this.key = best ? best.key : null;
      this.since = now;
    }
    return this.key;
  }
  reset() {
    this.key = null;
    this.since = 0;
  }
}

/**
 * Direction conventions. Multiplying a `poseFromMatrix` angle by its sign gives a "screen" value as
 * the person sees it in the mirrored preview: positive means turned toward their right, chin up, or
 * tilted toward their right shoulder.
 */
export const POSE_SIGNS = { yaw: -1, pitch: -1, roll: 1 };
// Checked against MediaPipe output on a real photo with synthetic variants (picture rotated, nose
// pushed sideways / up / down): matrix yaw > 0 means turned toward the person's left, matrix pitch
// > 0 means chin down, matrix roll > 0 means tilted toward their right shoulder (in the mirror).

/** Instruction text for a part, given its signed value (pose) or just its name (expression). */
export function adviceText(key, value = 0) {
  const positive = (axis) => value * POSE_SIGNS[axis] > 0; // already past centre toward right / up
  switch (key) {
    case "yaw":
      return positive("yaw") ? "Turn a little to your left" : "Turn a little to your right";
    case "pitch":
      return positive("pitch") ? "Lower your chin a little" : "Raise your chin a little";
    case "roll":
      return positive("roll") ? "Tilt your head toward your left shoulder" : "Tilt your head toward your right shoulder";
    case "smile":
      return "Relax your smile";
    case "frown":
      return "Soften your frown";
    case "mouth_open":
      return "Close your mouth gently";
    case "pucker":
      return "Relax your lips";
    case "blink":
      return "Open your eyes";
    case "squint":
      return "Ease the squint: relax your eyes";
    case "brow_down":
      return "Relax your brow";
    default:
      return "";
  }
}
