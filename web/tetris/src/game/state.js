// Game state and the per-tick step function. The only way to advance a game is step(game, actions):
// no clocks, no randomness beyond the seeded bag, no DOM, so seed + inputLog reproduces a round exactly.

import { createBag } from "./bag.js";
import { clearLines, collides, createBoard, fullRows, HIDDEN_ROWS, place } from "./board.js";
import { kicksFor, pieceCells, spawnX } from "./pieces.js";
import {
  gravityTicks,
  HARD_DROP_POINTS_PER_ROW,
  levelFor,
  linePoints,
  LOCK_DELAY_TICKS,
  MAX_LOCK_RESETS,
  RULES_VERSION,
  SOFT_DROP_POINTS_PER_ROW,
  SOFT_DROP_TICKS,
} from "./rules.js";
import { markSquares, squaresInRow } from "./squares.js";

/** @typedef {import("./pieces.js").PieceType} PieceType */
/** @typedef {import("./pieces.js").Rotation} Rotation */
/** @typedef {import("./board.js").Board} Board */
/** @typedef {{ type: PieceType, rot: Rotation, x: number, y: number, id: number }} Piece */
/**
 * Actions the game understands. `softDrop` means "held this tick"; every other action is a single event
 * (auto-repeat for left/right happens in input/actions.js, which turns held keys into events per tick).
 * @typedef {"left" | "right" | "softDrop" | "hardDrop" | "rotateCW" | "rotateCCW" | "hold"} GameAction
 */
/**
 * @typedef {object} Game
 * @property {number} rulesVersion
 * @property {number} seed
 * @property {number} tick ticks simulated so far
 * @property {Board} board
 * @property {{ take(): PieceType }} bag
 * @property {PieceType[]} queue upcoming pieces, always at least QUEUE_MIN long; the first 3 are shown
 * @property {Piece | null} current null only when the game is over
 * @property {PieceType | null} hold
 * @property {boolean} canHold
 * @property {number} nextPieceId
 * @property {number} score
 * @property {number} lines
 * @property {number} level
 * @property {number} startLevel
 * @property {number} piecesPlaced
 * @property {number} nextSquareId id for the next square formed; ids start at 1
 * @property {number} goldSquares gold (single-color) squares formed so far
 * @property {number} silverSquares silver (mixed) squares formed so far
 * @property {number} holdsUsed
 * @property {boolean} over
 * @property {number} gravityCount ticks since the piece last fell
 * @property {number} lockTimer ticks the piece has rested on the stack
 * @property {number} lockResets how many times a move or rotation restarted the lock timer
 * @property {number} lowestY lowest row the current piece has reached
 */

/** The queue is topped up to at least this many pieces; the HUD shows 3 of them. */
export const QUEUE_MIN = 4;

/**
 * @param {number} seed
 * @param {{ startLevel?: number }} [options]
 * @returns {Game}
 */
export function createGame(seed, options = {}) {
  const startLevel = options.startLevel ?? 1;
  /** @type {Game} */
  const game = {
    rulesVersion: RULES_VERSION,
    seed,
    tick: 0,
    board: createBoard(),
    bag: createBag(seed),
    queue: [],
    current: null,
    hold: null,
    canHold: true,
    nextPieceId: 1,
    score: 0,
    lines: 0,
    level: startLevel,
    startLevel,
    piecesPlaced: 0,
    nextSquareId: 1,
    goldSquares: 0,
    silverSquares: 0,
    holdsUsed: 0,
    over: false,
    gravityCount: 0,
    lockTimer: 0,
    lockResets: 0,
    lowestY: 0,
  };
  refillQueue(game);
  spawn(game, takeNext(game));
  return game;
}

/** @param {Game} game */
function refillQueue(game) {
  while (game.queue.length < QUEUE_MIN) game.queue.push(game.bag.take());
}

/** @param {Game} game @returns {PieceType} */
function takeNext(game) {
  const type = /** @type {PieceType} */ (game.queue.shift());
  refillQueue(game);
  return type;
}

/** Put a fresh piece at the top in its default rotation. A blocked spawn ends the game. */
function spawn(/** @type {Game} */ game, /** @type {PieceType} */ type) {
  const piece = { type, rot: /** @type {Rotation} */ (0), x: spawnX(type), y: 0, id: game.nextPieceId++ };
  game.gravityCount = 0;
  game.lockTimer = 0;
  game.lockResets = 0;
  game.lowestY = piece.y;
  if (collides(game.board, type, piece.rot, piece.x, piece.y)) {
    game.current = null;
    game.over = true;
    return;
  }
  game.current = piece;
}

/** @param {Game} game */
function grounded(game) {
  const p = /** @type {Piece} */ (game.current);
  return collides(game.board, p.type, p.rot, p.x, p.y + 1);
}

/** After a successful move or rotation: restart the lock timer if the piece is resting and resets remain. */
function afterMove(/** @type {Game} */ game) {
  if (grounded(game) && game.lockResets < MAX_LOCK_RESETS) {
    game.lockTimer = 0;
    game.lockResets++;
  }
}

/** @param {Game} game @param {number} dx */
function tryMove(game, dx) {
  const p = /** @type {Piece} */ (game.current);
  if (collides(game.board, p.type, p.rot, p.x + dx, p.y)) return;
  p.x += dx;
  afterMove(game);
}

/** @param {Game} game @param {1 | -1} dir */
function tryRotate(game, dir) {
  const p = /** @type {Piece} */ (game.current);
  const to = /** @type {Rotation} */ ((p.rot + dir + 4) % 4);
  for (const [dx, dy] of kicksFor(p.type, p.rot, to)) {
    if (!collides(game.board, p.type, to, p.x + dx, p.y + dy)) {
      p.rot = to;
      p.x += dx;
      p.y += dy;
      if (p.y > game.lowestY) newLowest(game);
      afterMove(game);
      return;
    }
  }
}

/** Reaching a new lowest row earns a fresh set of lock resets. */
function newLowest(/** @type {Game} */ game) {
  const p = /** @type {Piece} */ (game.current);
  game.lowestY = p.y;
  game.lockResets = 0;
  game.lockTimer = 0;
}

/** Move down one row. Returns false if the piece is resting on something. @param {Game} game */
function tryFall(game) {
  const p = /** @type {Piece} */ (game.current);
  if (collides(game.board, p.type, p.rot, p.x, p.y + 1)) return false;
  p.y++;
  game.gravityCount = 0;
  if (p.y > game.lowestY) newLowest(game);
  return true;
}

/** Swap the current piece with the held one (or the next one if the slot is empty), once per piece. @param {Game} game */
function doHold(game) {
  if (!game.canHold) return;
  const p = /** @type {Piece} */ (game.current);
  const incoming = game.hold ?? takeNext(game);
  game.hold = p.type;
  game.canHold = false;
  game.holdsUsed++;
  spawn(game, incoming);
}

/** Mark any new squares on the board and count them. @param {Game} game */
function formSquares(game) {
  for (const sq of markSquares(game.board, game.nextSquareId)) {
    game.nextSquareId = sq.id + 1;
    if (sq.kind === "gold") game.goldSquares++;
    else game.silverSquares++;
  }
}

/**
 * Write the piece into the board, find squares, clear lines (scoring any squares they pass through), level up,
 * and spawn the next piece. Squares are found before the clear, so a piece that completes a square can clear a
 * line through it at once, and again after it, because the rows above fall and can line up into a new one.
 * @param {Game} game
 */
function lock(game) {
  const p = /** @type {Piece} */ (game.current);
  place(game.board, p.type, p.rot, p.x, p.y, p.id);
  game.piecesPlaced++;
  game.canHold = true;

  // Lock-out: the whole piece is above the visible field.
  const lockedOut = pieceCells(p.type, p.rot).every(([, dy]) => p.y + dy < HIDDEN_ROWS);
  formSquares(game);
  const rows = fullRows(game.board).map((r) => squaresInRow(game.board[r]));
  const cleared = clearLines(game.board);
  if (cleared > 0) {
    game.score += linePoints(rows);
    game.lines += cleared;
    game.level = levelFor(game.startLevel, game.lines);
    formSquares(game);
  }
  if (lockedOut && cleared === 0) {
    game.current = null;
    game.over = true;
    return;
  }
  spawn(game, takeNext(game));
}

/** Drop to the lowest legal row without locking. Returns rows dropped. @param {Game} game */
function dropToBottom(game) {
  const p = /** @type {Piece} */ (game.current);
  let rows = 0;
  while (!collides(game.board, p.type, p.rot, p.x, p.y + 1)) {
    p.y++;
    rows++;
  }
  return rows;
}

/**
 * Where the current piece would land if hard-dropped (for the ghost piece). Does not change the game.
 * @param {Game} game
 * @returns {number | null} row of the piece's box, or null if there is no current piece
 */
export function landingY(game) {
  const p = game.current;
  if (!p) return null;
  let y = p.y;
  while (!collides(game.board, p.type, p.rot, p.x, y + 1)) y++;
  return y;
}

/**
 * Advance the game by one tick (1/60 s of game time). Order each tick: apply actions, apply gravity,
 * resolve lock. Does nothing once the game is over.
 * @param {Game} game
 * @param {readonly GameAction[]} actions
 */
export function step(game, actions) {
  if (game.over) return;
  game.tick++;

  let hardDropped = false;
  let soft = false;
  for (const action of actions) {
    if (game.over || !game.current) break;
    switch (action) {
      case "hold": doHold(game); break;
      case "left": tryMove(game, -1); break;
      case "right": tryMove(game, 1); break;
      case "rotateCW": tryRotate(game, 1); break;
      case "rotateCCW": tryRotate(game, -1); break;
      case "softDrop": soft = true; break;
      case "hardDrop": hardDropped = true; break;
      default: break;
    }
    if (hardDropped) break;
  }
  if (game.over || !game.current) return;

  if (hardDropped) {
    game.score += dropToBottom(game) * HARD_DROP_POINTS_PER_ROW;
    lock(game);
    return;
  }

  // Gravity: one row per `interval` ticks; soft drop shortens the interval.
  game.gravityCount++;
  const interval = soft ? Math.min(gravityTicks(game.level), SOFT_DROP_TICKS) : gravityTicks(game.level);
  if (game.gravityCount >= interval && tryFall(game) && soft) game.score += SOFT_DROP_POINTS_PER_ROW;

  // Lock: a resting piece locks after the delay.
  if (grounded(game)) {
    game.lockTimer++;
    if (game.lockTimer >= LOCK_DELAY_TICKS) lock(game);
  } else {
    game.lockTimer = 0;
  }
}

/**
 * Re-run a round from its seed and recorded inputs.
 * @param {number} seed
 * @param {readonly { t: number, action: GameAction }[]} inputLog t is the tick the action was applied on (1-based)
 * @param {number} ticks how many ticks the round lasted
 * @param {{ startLevel?: number }} [options]
 * @returns {Game}
 */
export function replay(seed, inputLog, ticks, options) {
  const game = createGame(seed, options);
  let i = 0;
  for (let t = 1; t <= ticks && !game.over; t++) {
    /** @type {GameAction[]} */
    const actions = [];
    while (i < inputLog.length && inputLog[i].t === t) actions.push(inputLog[i++].action);
    step(game, actions);
  }
  return game;
}
