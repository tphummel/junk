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
  const natural = el("natural");
  const modeEl = el("mode");
  const counts = {
    spinsCCW: el("spins-ccw"),
    spinsCW: el("spins-cw"),
    movesLeft: el("moves-left"),
    movesRight: el("moves-right"),
    softDrops: el("soft-drops"),
    goldSquares: el("mono-squares"),
    silverSquares: el("multi-squares"),
    hardDrops: el("hard-drops"),
    holdsUsed: el("swaps"),
  };

  return {
    /** @param {Game} game @param {Theme} theme @param {string} modeLabel the difficulty being played */
    update(game, theme, modeLabel) {
      score.textContent = String(game.score);
      level.textContent = String(game.level);
      lines.textContent = String(game.lines);
      const stats = summarize(game.tick, game.score);
      time.textContent = stats.time;
      rate.textContent = stats.rate;
      grade.textContent = stats.grade;
      natural.hidden = !stats.natural;
      modeEl.textContent = modeLabel;
      for (const [key, node] of Object.entries(counts)) node.textContent = String(game[/** @type {keyof typeof counts} */ (key)]);
      drawMini(hold, game.hold, theme, !game.canHold);
      next.forEach((canvas, i) => drawMini(canvas, game.queue[i] ?? null, theme));
    },
  };
}
