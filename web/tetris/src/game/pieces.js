// Tetromino shapes, rotation states and Super Rotation System (SRS) wall kicks.
// Pure data and functions: no DOM, canvas, devices, clock or randomness.

/** @typedef {"I" | "O" | "T" | "S" | "Z" | "J" | "L"} PieceType */
/** @typedef {0 | 1 | 2 | 3} Rotation */
/** @typedef {[number, number]} Cell [column, row] offset inside the piece's box */

/** @type {readonly PieceType[]} */
export const PIECE_TYPES = ["I", "O", "T", "S", "Z", "J", "L"];

/** Spawn orientation as a matrix; 1 is a block. Boxes are 4x4 for I, 2x2 for O and 3x3 otherwise. */
const SPAWN = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};

/** @param {number[][]} m @returns {number[][]} the matrix turned 90 degrees clockwise */
function rotateMatrix(m) {
  const n = m.length;
  return m.map((_, r) => m.map((__, c) => m[n - 1 - c][r]));
}

/** @param {number[][]} m @returns {Cell[]} */
function cellsOf(m) {
  /** @type {Cell[]} */
  const out = [];
  m.forEach((row, r) => row.forEach((v, c) => v && out.push([c, r])));
  return out;
}

/** @type {Record<PieceType, Cell[][]>} cells[type][rotation] */
const CELLS = /** @type {any} */ ({});
for (const type of PIECE_TYPES) {
  /** @type {Cell[][]} */
  const states = [];
  let m = SPAWN[type];
  for (let r = 0; r < 4; r++) {
    states.push(cellsOf(m));
    // O fills its whole box, so every rotation is the same four cells.
    m = type === "O" ? m : rotateMatrix(m);
  }
  CELLS[type] = states;
}

/**
 * The four [column, row] offsets of a piece's blocks, relative to the piece position.
 * @param {PieceType} type
 * @param {Rotation} rot
 * @returns {Cell[]}
 */
export function pieceCells(type, rot) {
  return CELLS[type][rot];
}

/** Column where a piece spawns (its box is placed at row 0, in the hidden rows). @param {PieceType} type */
export function spawnX(type) {
  return type === "O" ? 4 : 3;
}

// SRS kick offsets from the Tetris guideline, written with y up as published; kicksFor flips y for our y-down grid.
/** @type {Record<string, Cell[]>} */
const JLSTZ_KICKS = {
  "0>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "1>0": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "1>2": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "2>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "2>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "3>2": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "3>0": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "0>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
/** @type {Record<string, Cell[]>} */
const I_KICKS = {
  "0>1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "1>0": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "1>2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  "2>1": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "2>3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "3>2": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "3>0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "0>3": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

/**
 * Ordered [dx, dy] offsets to try when rotating `from` to `to`, in grid coordinates (y grows downward).
 * @param {PieceType} type
 * @param {Rotation} from
 * @param {Rotation} to
 * @returns {Cell[]}
 */
export function kicksFor(type, from, to) {
  if (type === "O") return [[0, 0]];
  const table = type === "I" ? I_KICKS : JLSTZ_KICKS;
  return table[`${from}>${to}`].map(([dx, dy]) => [dx, -dy]);
}
