// HUD: hold box, next 3, score, level and lines. Reads the game, never changes it.

import { formatTime, gameSeconds, gradePerf, lineRate } from "../game/stats.js";
import { drawMini } from "./render.js";

/** @typedef {import("../game/state.js").Game} Game */
/** @typedef {import("./render.js").Theme} Theme */

/**
 * @param {Document} doc
 */
export function createHud(doc) {
  const el = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const hold = /** @type {HTMLCanvasElement} */ (el("hold"));
  const next = [0, 1, 2].map((i) => /** @type {HTMLCanvasElement} */ (el(`next${i}`)));
  const score = el("score");
  const level = el("level");
  const lines = el("lines");
  const time = el("time");
  const rate = el("lps");
  const grade = el("grade");

  return {
    /** @param {Game} game @param {Theme} theme */
    update(game, theme) {
      score.textContent = String(game.score);
      level.textContent = String(game.level);
      lines.textContent = String(game.lines);
      const seconds = gameSeconds(game.tick);
      time.textContent = formatTime(game.tick);
      rate.textContent = lineRate(seconds, game.lines).toFixed(2);
      // No grade until a line is cleared: before that the rate is 0 and an "F" says nothing yet.
      grade.textContent = game.lines > 0 ? gradePerf(seconds, game.lines) : "-";
      drawMini(hold, game.hold, theme, !game.canHold);
      next.forEach((canvas, i) => drawMini(canvas, game.queue[i] ?? null, theme));
    },
  };
}
