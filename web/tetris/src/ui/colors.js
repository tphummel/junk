// Color shading and piece outlines for drawing blocks. Pure: no canvas, so the tests can check it.

/** @param {string} hex "#RRGGBB" @returns {[number, number, number]} */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** @param {[number, number, number]} c @returns {string} */
const toHex = (c) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/**
 * Move a color toward white (amount above 0) or black (below 0): 0.5 is halfway, 1 is white, -1 is black.
 * @param {string} hex "#RRGGBB"
 * @param {number} amount -1 to 1
 * @returns {string} "#RRGGBB"
 */
export function shade(hex, amount) {
  const target = amount >= 0 ? 255 : 0;
  const t = Math.min(1, Math.abs(amount));
  return toHex(/** @type {[number, number, number]} */ (rgb(hex).map((v) => v + (target - v) * t)));
}

/**
 * @typedef {{ top: boolean, right: boolean, bottom: boolean, left: boolean }} Edges
 * Which sides of a block face something that is not part of the same piece, and so get the piece's outline.
 */

/**
 * The outline edges for block `i` of a piece, given all of the piece's blocks as [x, y] pairs.
 * @param {readonly (readonly [number, number])[]} cells
 * @param {number} i
 * @returns {Edges}
 */
export function edgesInPiece(cells, i) {
  const [x, y] = cells[i];
  const has = (/** @type {number} */ dx, /** @type {number} */ dy) => cells.some(([cx, cy]) => cx === x + dx && cy === y + dy);
  return { top: !has(0, -1), right: !has(1, 0), bottom: !has(0, 1), left: !has(-1, 0) };
}

/**
 * The outline edges for a settled block on the board: a side is outlined unless the neighbor there belongs to the same piece.
 * @param {readonly (readonly ({ pieceId: number } | null)[])[]} board
 * @param {number} r row
 * @param {number} c column
 * @returns {Edges}
 */
export function edgesOnBoard(board, r, c) {
  const id = board[r][c]?.pieceId;
  const same = (/** @type {number} */ rr, /** @type {number} */ cc) => id !== undefined && board[rr]?.[cc]?.pieceId === id;
  return { top: !same(r - 1, c), right: !same(r, c + 1), bottom: !same(r + 1, c), left: !same(r, c - 1) };
}
