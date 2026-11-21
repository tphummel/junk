// Gold and silver squares: a 4x4 block of the board made of exactly four complete pieces. All four the same
// piece type (color) makes a gold "mono" square, a mix makes a silver "multi" square. Squares are marked on
// the cells so they survive line clears, and a line that passes through one scores a bonus (see rules.js).

import { COLS, ROWS } from "./board.js";

/** @typedef {import("./board.js").Board} Board */
/** @typedef {"gold" | "silver"} SquareKind */

export const SQUARE_SIZE = 4;

/**
 * The kind of square the 4x4 region at (row0, col0) makes, or null. A region qualifies when all 16 cells are
 * filled and none is already in a square, and they belong to exactly four pieces with four cells each there.
 * A piece has only four cells, so four in the region means the piece is whole.
 * @param {Board} board
 * @param {number} row0
 * @param {number} col0
 * @returns {SquareKind | null}
 */
function squareKindAt(board, row0, col0) {
  /** @type {Map<number, number>} */
  const perPiece = new Map();
  /** @type {Set<string>} */
  const types = new Set();
  for (let r = row0; r < row0 + SQUARE_SIZE; r++) {
    for (let c = col0; c < col0 + SQUARE_SIZE; c++) {
      const cell = board[r][c];
      if (!cell || cell.squareId) return null;
      perPiece.set(cell.pieceId, (perPiece.get(cell.pieceId) ?? 0) + 1);
      types.add(cell.type);
    }
  }
  if (perPiece.size !== SQUARE_SIZE) return null;
  for (const n of perPiece.values()) if (n !== SQUARE_SIZE) return null;
  return types.size === 1 ? "gold" : "silver";
}

/**
 * Find every new square on the board and mark its cells. Regions are scanned top to bottom, left to right, and
 * cells already in a square are never reused, so overlapping candidates resolve the same way every time.
 * @param {Board} board changed in place
 * @param {number} startId the id for the first new square; ids are 1 and up
 * @returns {{ id: number, kind: SquareKind, row: number, col: number }[]} the squares found, in id order
 */
export function markSquares(board, startId) {
  const found = [];
  let id = startId;
  for (let row = 0; row + SQUARE_SIZE <= ROWS; row++) {
    for (let col = 0; col + SQUARE_SIZE <= COLS; col++) {
      const kind = squareKindAt(board, row, col);
      if (!kind) continue;
      for (let r = row; r < row + SQUARE_SIZE; r++) {
        for (let c = col; c < col + SQUARE_SIZE; c++) {
          const cell = /** @type {NonNullable<typeof board[number][number]>} */ (board[r][c]);
          cell.squareId = id;
          cell.square = kind;
        }
      }
      found.push({ id, kind, row, col });
      id++;
    }
  }
  return found;
}

/**
 * How many gold and silver squares a row passes through (each square counted once).
 * @param {Board[number]} row
 * @returns {{ gold: number, silver: number }}
 */
export function squaresInRow(row) {
  /** @type {Map<number, SquareKind>} */
  const ids = new Map();
  for (const cell of row) if (cell?.squareId && cell.square) ids.set(cell.squareId, cell.square);
  let gold = 0;
  let silver = 0;
  for (const kind of ids.values()) kind === "gold" ? gold++ : silver++;
  return { gold, silver };
}
