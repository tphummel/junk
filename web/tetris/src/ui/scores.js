// Saved results, kept in the browser's localStorage so they outlive the tab. Storage can be missing, blocked (private
// windows) or full, and the value can be anything, so every access is guarded and a bad value reads as "no scores".
// The storage object is passed in, which keeps this testable without a browser.

export const SCORES_KEY = "tetris-scores";
/** Keep this many of the newest results. */
export const MAX_SCORES = 200;

/**
 * One finished round, as saved.
 * @typedef {object} ScoreRecord
 * @property {number} at when it ended, epoch ms
 * @property {string} mode difficulty id: practice, easy, medium or hard
 * @property {"topout" | "ended"} ended how it finished: the stack overflowed, or the player ended it from the pause menu
 * @property {number} score what the game calls Lines (the points)
 * @property {number} lines rows actually cleared ("Lines raw")
 * @property {number} level
 * @property {number} ticks game time in ticks (60 per second)
 * @property {string} rate score per second, two decimals
 * @property {string} grade letter grade for that rate, or "-" with no score
 * @property {boolean} natural whether the score beat the time with its colon removed
 * @property {number} piecesPlaced
 * @property {number} goldSquares
 * @property {number} silverSquares
 * @property {number} [spinsCW] successful clockwise rotations (this and the next four are missing from older saves)
 * @property {number} [spinsCCW]
 * @property {number} [movesLeft] columns moved left
 * @property {number} [movesRight] columns moved right
 * @property {number} [softDrops] rows fallen under soft drop
 * @property {number} [hardDrops] pieces hard-dropped
 * @property {number} [swaps] swaps with the held piece
 * @property {number} seed
 * @property {number} rulesVersion
 */

/** @typedef {Pick<Storage, "getItem" | "setItem">} StorageLike */

/** @param {unknown} r @returns {r is ScoreRecord} */
function isRecord(r) {
  if (!r || typeof r !== "object") return false;
  const o = /** @type {Record<string, unknown>} */ (r);
  return typeof o.mode === "string" && Number.isFinite(o.score) && Number.isFinite(o.ticks) && Number.isFinite(o.at);
}

/** @param {StorageLike | null} storage @returns {ScoreRecord[]} saved results, oldest first; [] if none or unreadable */
export function loadScores(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(SCORES_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

/**
 * Add a result. Returns false if it could not be saved (no storage, blocked, or full); the game carries on either way.
 * @param {StorageLike | null} storage
 * @param {ScoreRecord} record
 */
export function saveScore(storage, record) {
  if (!storage) return false;
  try {
    const all = [...loadScores(storage), record].slice(-MAX_SCORES);
    storage.setItem(SCORES_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/**
 * The best result per difficulty: the highest score, and for equal scores the one reached sooner. A round that scored
 * nothing is not a best.
 * @param {readonly ScoreRecord[]} records
 * @returns {Record<string, ScoreRecord>}
 */
export function bestByMode(records) {
  /** @type {Record<string, ScoreRecord>} */
  const best = {};
  for (const r of records) {
    if (r.score <= 0) continue;
    const b = best[r.mode];
    if (!b || r.score > b.score || (r.score === b.score && r.ticks < b.ticks)) best[r.mode] = r;
  }
  return best;
}

/** localStorage if the browser lets us touch it, else null (reading the property itself can throw). @returns {StorageLike | null} */
export function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
