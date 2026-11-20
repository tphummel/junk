// The grid: collision, placing a locked piece and clearing lines.

import { pieceCells } from "./pieces.js";

/** @typedef {import("./pieces.js").PieceType} PieceType */
/** @typedef {import("./pieces.js").Rotation} Rotation */
/** @typedef {{ type: PieceType, pieceId: number }} Cell a filled cell; pieceId is what makes squares detectable */
/** @typedef {(Cell | null)[][]} Board rows from the top; row 0 is the first hidden row */

export const COLS = 10;
export const VISIBLE_ROWS = 20;
export const HIDDEN_ROWS = 2;
export const ROWS = VISIBLE_ROWS + HIDDEN_ROWS;

/** @returns {Board} */
export function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

/**
 * True if the piece would overlap a block or leave the board (sides and floor; the top is open).
 * @param {Board} board
 * @param {PieceType} type
 * @param {Rotation} rot
 * @param {number} x
 * @param {number} y
 */
export function collides(board, type, rot, x, y) {
  for (const [dx, dy] of pieceCells(type, rot)) {
    const cx = x + dx;
    const cy = y + dy;
    if (cx < 0 || cx >= COLS || cy >= ROWS) return true;
    if (cy >= 0 && board[cy][cx]) return true;
  }
  return false;
}

/**
 * Write a piece into the board.
 * @param {Board} board
 * @param {PieceType} type
 * @param {Rotation} rot
 * @param {number} x
 * @param {number} y
 * @param {number} pieceId
 */
export function place(board, type, rot, x, y, pieceId) {
  for (const [dx, dy] of pieceCells(type, rot)) {
    board[y + dy][x + dx] = { type, pieceId };
  }
}

/**
 * Remove every full row and let the rows above fall.
 * @param {Board} board
 * @returns {number} how many rows were cleared
 */
export function clearLines(board) {
  const kept = board.filter((row) => row.some((c) => c === null));
  const cleared = board.length - kept.length;
  for (let i = 0; i < cleared; i++) kept.unshift(Array(COLS).fill(null));
  for (let r = 0; r < board.length; r++) board[r] = kept[r];
  return cleared;
}
