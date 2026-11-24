// Timing constants, gravity table and scoring. Everything is in ticks (one tick = 1/60 s of game time)
// and integers, so the game behaves identically on every machine.

/** Bump when any rule, constant or table below changes in a way that alters how a seed plays out. */
export const RULES_VERSION = 5;

export const TICKS_PER_SECOND = 60;

/** Grace period after a piece lands, in ticks (500 ms). */
export const LOCK_DELAY_TICKS = 30;
/** Successful moves or rotations that may restart the lock timer while a piece rests on the stack. */
export const MAX_LOCK_RESETS = 15;
/**
 * After a lock that makes a square, or clears a line through one, the next piece waits this long (ticks, 1 s)
 * so the flourish can play. Plain locks and plain line clears bring the next piece in at once.
 */
export const FLOURISH_ENTRY_DELAY_TICKS = 60;
/** While soft drop is held, a piece falls at least this often (ticks per row). */
export const SOFT_DROP_TICKS = 2;

/** Ticks per row of gravity for level 1, 2, 3...; the last entry applies to every later level. */
const GRAVITY_TICKS = [48, 43, 38, 33, 28, 23, 18, 13, 8, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1];

/** @param {number} level starting at 1 */
export function gravityTicks(level) {
  return GRAVITY_TICKS[Math.min(level, GRAVITY_TICKS.length) - 1];
}

// Scoring. A cleared line is worth LINE_POINT, plus a bonus for every square it passes through: a silver
// (multi-color) square adds SILVER_LINE_BONUS and a gold (single-color) square adds GOLD_LINE_BONUS. Clearing
// four lines at once adds TETRIS_BONUS. A row can pass through at most two squares (they are 4 wide, the board 10).
// There is no level multiplier, and dropping a piece scores nothing.
export const LINE_POINT = 1;
export const SILVER_LINE_BONUS = 5;
export const GOLD_LINE_BONUS = 10;
export const TETRIS_BONUS = 1;
export const SOFT_DROP_POINTS_PER_ROW = 0;
export const HARD_DROP_POINTS_PER_ROW = 0;

/**
 * Points for one line clear, split by where they came from.
 * @param {readonly { gold: number, silver: number }[]} rows one entry per cleared row: how many gold and silver
 *   squares that row passes through
 * @returns {{ lines: number, squares: number, tetris: number }}
 */
export function linePointsBreakdown(rows) {
  let squares = 0;
  for (const row of rows) squares += row.silver * SILVER_LINE_BONUS + row.gold * GOLD_LINE_BONUS;
  return { lines: rows.length * LINE_POINT, squares, tetris: rows.length === 4 ? TETRIS_BONUS : 0 };
}

/**
 * Points for one line clear.
 * @param {readonly { gold: number, silver: number }[]} rows as for linePointsBreakdown
 */
export function linePoints(rows) {
  const b = linePointsBreakdown(rows);
  return b.lines + b.squares + b.tetris;
}

export const LINES_PER_LEVEL = 10;

// Garbage (the difficulty levels). The game pushes grey rows up from the bottom at a steady rate, like an opponent
// sending garbage: clear rows at least that fast and the stack holds, clear slower and it climbs. Rows are owed as
// time passes and arrive between pieces (after a lock, or after a flourish pause), so they never shove a piece in
// play. Each row has one hole; it often stays in the same column as the row before, so streaks can be cleared.
/** Garbage starts this long into the round (5 s), so the first piece is not buried. */
export const GARBAGE_WARMUP_TICKS = 300;
/** Chance (out of 100) that a garbage row's hole stays in the column of the one before it. */
export const GARBAGE_SAME_HOLE_PERCENT = 50;
/** Most rows that arrive at once. */
export const GARBAGE_MAX_PER_ENTRY = 6;

/** @param {number} startLevel @param {number} totalLines */
export function levelFor(startLevel, totalLines) {
  return startLevel + Math.floor(totalLines / LINES_PER_LEVEL);
}
