// Timing constants, gravity table and scoring. Everything is in ticks (one tick = 1/60 s of game time)
// and integers, so the game behaves identically on every machine.

/** Bump when any rule, constant or table below changes in a way that alters how a seed plays out. */
export const RULES_VERSION = 1;

export const TICKS_PER_SECOND = 60;

/** Grace period after a piece lands, in ticks (500 ms). */
export const LOCK_DELAY_TICKS = 30;
/** Successful moves or rotations that may restart the lock timer while a piece rests on the stack. */
export const MAX_LOCK_RESETS = 15;
/** While soft drop is held, a piece falls at least this often (ticks per row). */
export const SOFT_DROP_TICKS = 2;

/** Ticks per row of gravity for level 1, 2, 3...; the last entry applies to every later level. */
const GRAVITY_TICKS = [48, 43, 38, 33, 28, 23, 18, 13, 8, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1];

/** @param {number} level starting at 1 */
export function gravityTicks(level) {
  return GRAVITY_TICKS[Math.min(level, GRAVITY_TICKS.length) - 1];
}

/** Base points for clearing 0 to 4 lines at once, multiplied by the level. */
const LINE_POINTS = [0, 100, 300, 500, 800];

/** @param {number} lines 0 to 4 @param {number} level */
export function lineScore(lines, level) {
  return LINE_POINTS[lines] * level;
}

export const SOFT_DROP_POINTS_PER_ROW = 1;
export const HARD_DROP_POINTS_PER_ROW = 2;
export const LINES_PER_LEVEL = 10;

/** @param {number} startLevel @param {number} totalLines */
export function levelFor(startLevel, totalLines) {
  return startLevel + Math.floor(totalLines / LINES_PER_LEVEL);
}
