// A purely visual ease for the falling piece when it rotates. The game turns a piece in a single step; this makes
// the drawing turn over a short moment instead of jumping. It never touches game state, so replays are unaffected.
// A pose is where the piece's center is (in cells, from the top-left of the visible board) and its rotation 0..3.

/** How long a turn takes to settle, in ms. */
export const TWEEN_MS = 90;

/** Fast at first, then settling. @param {number} t 0..1 */
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;

/**
 * @typedef {object} Pose
 * @property {number} id the piece's id: a new piece starts with no animation
 * @property {number} rot rotation 0 to 3
 * @property {number} cx center, in cells
 * @property {number} cy
 */
/** @typedef {{ cx: number, cy: number, angle: number }} Shown where to draw the piece's center, and how far (radians, clockwise) it is still turned back from its real rotation */

export function createPieceTween() {
  /** @type {Pose | null} */
  let last = null;
  /** @type {{ c0x: number, c0y: number, a0: number, start: number } | null} */
  let anim = null;

  /** @param {Pose} pose @param {number} now @returns {Shown} */
  function shown(pose, now) {
    if (!anim) return { cx: pose.cx, cy: pose.cy, angle: 0 };
    const t = (now - anim.start) / TWEEN_MS;
    if (t >= 1) {
      anim = null;
      return { cx: pose.cx, cy: pose.cy, angle: 0 };
    }
    const e = easeOutCubic(Math.max(0, t));
    return { cx: anim.c0x + (pose.cx - anim.c0x) * e, cy: anim.c0y + (pose.cy - anim.c0y) * e, angle: anim.a0 * (1 - e) };
  }

  return {
    /**
     * Call once per frame with the piece's real pose.
     * @param {Pose} pose
     * @param {number} now ms
     * @returns {Shown}
     */
    update(pose, now) {
      if (!last || last.id !== pose.id) anim = null;
      else if (last.rot !== pose.rot) {
        // Start from whatever is on screen now, so quick repeated turns carry on smoothly.
        const from = anim ? shown(last, now) : { cx: last.cx, cy: last.cy, angle: 0 };
        const turn = (pose.rot - last.rot + 4) % 4;
        const dir = turn === 1 ? 1 : turn === 3 ? -1 : 2;
        anim = { c0x: from.cx, c0y: from.cy, a0: from.angle - (dir * Math.PI) / 2, start: now };
      }
      last = pose;
      return shown(pose, now);
    },
    /** Forget the piece (none in play). */
    reset() {
      last = null;
      anim = null;
    },
  };
}
