// HUD: hold box, next 3, score (shown as "Lines"), level, raw lines, time, rate and grade. Reads the game, never changes it.

import { summarize } from "../game/stats.js";
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
      const stats = summarize(game.tick, game.score);
      time.textContent = stats.time;
      rate.textContent = stats.rate;
      grade.textContent = stats.grade;
      drawMini(hold, game.hold, theme, !game.canHold);
      next.forEach((canvas, i) => drawMini(canvas, game.queue[i] ?? null, theme));
    },
  };
}
