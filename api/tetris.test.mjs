// Tests for the pure game logic in web/tetris/src/game/ and the input repeater, plus checks on the page's
// service worker and colors. No browser: the game takes actions in and exposes state out.
// Run with `npm test`.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { contrastRatio } from "../web/golden-angle-palette/palette.js";
import { createBag, makeRng } from "../web/tetris/src/game/bag.js";
import { clearLines, collides, COLS, createBoard, HIDDEN_ROWS, place, pushGarbageRow, ROWS } from "../web/tetris/src/game/board.js";
import { DIFFICULTIES, difficultyById } from "../web/tetris/src/game/difficulty.js";
import { PIECE_TYPES, pieceCells } from "../web/tetris/src/game/pieces.js";
import { FLOURISH_ENTRY_DELAY_TICKS, gravityTicks, linePoints, linePointsBreakdown, LOCK_DELAY_TICKS } from "../web/tetris/src/game/rules.js";
import { markSquares, squaresInRow } from "../web/tetris/src/game/squares.js";
import { formatTime, gameSeconds, gradePerf, isNatural, lineRate, naturalNumber, summarize } from "../web/tetris/src/game/stats.js";
import { createGame, landingY, replay, step } from "../web/tetris/src/game/state.js";
import { createRepeater } from "../web/tetris/src/input/actions.js";
import { axisDirection, BUTTON, createGamepad, describePad, dpadOnStick, hatDirections, mapPad, newPadState, observePad } from "../web/tetris/src/input/gamepad.js";
import { createEffects } from "../web/tetris/src/ui/effects.js";
import { buildScorecard, SCORECARD_FORMAT, scorecardFilename, scorecardJson, scorecardSections } from "../web/tetris/src/ui/scorecard.js";
import { bestByMode, loadScores, MAX_SCORES, saveScore, SCORES_KEY } from "../web/tetris/src/ui/scores.js";
import { createKeyboard } from "../web/tetris/src/input/keyboard.js";
import { GARBAGE_COLOR, INK, METAL, PIECE_COLORS } from "../web/tetris/src/ui/render.js";

const filled = (type = "T", pieceId = 99) => ({ type, pieceId });

/** Hard drop and lock the current piece in one go: press once to fall, and again to lock if it has not locked yet. */
function slam(game) {
  const placed = game.piecesPlaced;
  step(game, ["hardDrop"]);
  if (!game.over && game.piecesPlaced === placed) step(game, ["hardDrop"]);
}

/** Put the current piece on the floor so it is resting. */
function ground(game) {
  game.current.y = landingY(game);
}

// --- bag -------------------------------------------------------------------------------------------

test("rng and bag are pinned: a seed always gives the same sequence", () => {
  const r = makeRng(1);
  assert.deepEqual([r(), r(), r()], [0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  const bag = createBag(1);
  const first14 = Array.from({ length: 14 }, () => bag.take()).join("");
  assert.equal(first14, "ZITSLJOZLTSOIJ");
});

test("every 7 pieces from the bag are one of each type", () => {
  const bag = createBag(12345);
  for (let i = 0; i < 20; i++) {
    const seven = Array.from({ length: 7 }, () => bag.take());
    assert.deepEqual([...seven].sort(), [...PIECE_TYPES].sort());
  }
});

test("different seeds give different sequences", () => {
  const take = (seed) => { const b = createBag(seed); return Array.from({ length: 21 }, () => b.take()).join(""); };
  assert.notEqual(take(1), take(2));
});

// --- pieces and board ------------------------------------------------------------------------------

test("every piece has 4 blocks in every rotation, and O never changes", () => {
  for (const type of PIECE_TYPES) {
    for (const rot of [0, 1, 2, 3]) assert.equal(pieceCells(type, rot).length, 4, `${type} ${rot}`);
  }
  for (const rot of [1, 2, 3]) assert.deepEqual(pieceCells("O", rot), pieceCells("O", 0));
});

test("collides: walls, floor and the stack", () => {
  const board = createBoard();
  assert.equal(collides(board, "O", 0, 4, 0), false);
  assert.equal(collides(board, "O", 0, -1, 5), true, "left wall");
  assert.equal(collides(board, "O", 0, COLS - 1, 5), true, "right wall");
  assert.equal(collides(board, "O", 0, 4, ROWS - 1), true, "floor");
  board[10][4] = filled();
  assert.equal(collides(board, "O", 0, 4, 9), true, "block");
  assert.equal(collides(board, "O", 0, 5, 9), false);
});

test("clearLines removes full rows and drops the rest", () => {
  const board = createBoard();
  board[ROWS - 1] = Array.from({ length: COLS }, () => filled());
  board[ROWS - 2] = Array.from({ length: COLS }, () => filled());
  board[ROWS - 3][0] = filled("L", 5);
  assert.equal(clearLines(board), 2);
  assert.equal(board[ROWS - 1][0]?.pieceId, 5, "the row above fell to the bottom");
  assert.equal(board.length, ROWS);
  assert.ok(board[ROWS - 1].slice(1).every((c) => c === null));
});

test("SRS wall kick: a vertical I at the left wall rotates flat by kicking right", () => {
  const game = createGame(7);
  game.current = { type: "I", rot: 1, x: -2, y: 5, id: 50 };
  step(game, ["rotateCCW"]);
  assert.equal(game.current.rot, 0);
  assert.equal(game.current.x, 0);
});

// --- game rules ------------------------------------------------------------------------------------

test("a new game has a current piece and a queue of at least 4", () => {
  const game = createGame(3);
  assert.ok(game.current);
  assert.ok(game.queue.length >= 4);
  assert.equal(game.level, 1);
  assert.equal(game.over, false);
});

test("gravity drops one row per gravityTicks(level) ticks", () => {
  const game = createGame(3);
  const y0 = game.current.y;
  for (let i = 0; i < gravityTicks(1) - 1; i++) step(game, []);
  assert.equal(game.current.y, y0);
  step(game, []);
  assert.equal(game.current.y, y0 + 1);
});

test("hard drop falls at once but does not lock; a second press locks it", () => {
  const game = createGame(3);
  const landing = landingY(game);
  const nextType = game.queue[0];
  step(game, ["hardDrop"]);
  assert.equal(game.current.y, landing, "dropped to the bottom in one step");
  assert.equal(game.piecesPlaced, 0, "not locked yet");
  assert.equal(game.score, 0, "drops score nothing");
  step(game, ["hardDrop"]);
  assert.equal(game.piecesPlaced, 1, "pressing again locks it");
  assert.equal(game.current.type, nextType);
});

test("after a hard drop the piece can slide and turn before it settles", () => {
  const game = createGame(3);
  step(game, ["hardDrop"]);
  const x = game.current.x;
  for (let i = 0; i < 10; i++) step(game, []);
  step(game, ["left"]);
  assert.equal(game.current.x, x - 1, "slid left after dropping");
  assert.equal(game.piecesPlaced, 0);
  step(game, ["rotateCW"]);
  assert.equal(game.current.rot, 1, "and turned");
});

test("a hard-dropped piece that is left alone locks after the lock delay", () => {
  const game = createGame(3);
  step(game, ["hardDrop"]);
  for (let i = 0; i < LOCK_DELAY_TICKS - 2; i++) step(game, []);
  assert.equal(game.piecesPlaced, 0);
  for (let i = 0; i < 3; i++) step(game, []);
  assert.equal(game.piecesPlaced, 1);
});

test("soft drop moves the piece down faster and scores nothing", () => {
  const game = createGame(3);
  const y0 = game.current.y;
  step(game, ["softDrop"]);
  step(game, ["softDrop"]);
  assert.equal(game.current.y, y0 + 1);
  assert.equal(game.score, 0);
});

test("hold: once per piece, resets on lock, first hold pulls from the queue", () => {
  const game = createGame(7);
  const first = game.current.type;
  const queued = game.queue[0];
  const firstId = game.current.id;
  step(game, ["hold"]);
  assert.equal(game.hold, first);
  assert.equal(game.current.type, queued);
  assert.notEqual(game.current.id, firstId, "the swapped-in piece is a new piece");
  assert.equal(game.current.rot, 0);
  assert.equal(game.current.y, 0, "respawns at the top");
  assert.equal(game.holdsUsed, 1);

  const type = game.current.type;
  step(game, ["hold"]);
  assert.equal(game.current.type, type, "second hold is ignored");
  assert.equal(game.holdsUsed, 1);

  slam(game);
  assert.equal(game.canHold, true);
  step(game, ["hold"]);
  assert.equal(game.current.type, first, "swapped back to the held piece");
  assert.equal(game.holdsUsed, 2);
});

test("lock delay: a resting piece locks after LOCK_DELAY_TICKS", () => {
  const game = createGame(3);
  ground(game);
  for (let i = 0; i < LOCK_DELAY_TICKS - 1; i++) step(game, []);
  assert.equal(game.piecesPlaced, 0);
  step(game, []);
  assert.equal(game.piecesPlaced, 1);
});

test("lock delay resets on moves, but only a limited number of times", () => {
  const game = createGame(3);
  ground(game);
  for (let t = 1; t <= 40; t++) step(game, [t % 2 ? "left" : "right"]);
  assert.equal(game.piecesPlaced, 0, "moves keep the piece alive past the plain delay");
  for (let t = 41; t <= 60; t++) step(game, [t % 2 ? "left" : "right"]);
  assert.ok(game.piecesPlaced >= 1, "the reset cap eventually lets it lock");
});

test("clearing a plain line scores 1 and counts the line", () => {
  const game = createGame(3);
  game.board[ROWS - 1] = Array.from({ length: COLS }, (_, c) => (c < 6 ? filled() : null));
  game.current = { type: "I", rot: 0, x: 6, y: ROWS - 2, id: 77 };
  slam(game);
  assert.equal(game.lines, 1);
  assert.equal(game.score, 1);
  assert.ok(game.board[ROWS - 1].every((c) => c === null));
});

test("level goes up every 10 lines", () => {
  const game = createGame(3);
  game.lines = 9;
  game.board[ROWS - 1] = Array.from({ length: COLS }, (_, c) => (c < 6 ? filled() : null));
  game.current = { type: "I", rot: 0, x: 6, y: ROWS - 2, id: 77 };
  slam(game);
  assert.equal(game.score, 1, "no level multiplier");
  assert.equal(game.level, 2);
});

test("a blocked spawn ends the game", () => {
  const game = createGame(3);
  for (let r = 0; r < HIDDEN_ROWS; r++) game.board[r] = Array.from({ length: COLS }, () => filled());
  step(game, ["hold"]);
  assert.equal(game.over, true);
  assert.equal(game.current, null);
  const tick = game.tick;
  step(game, ["left"]);
  assert.equal(game.tick, tick, "a finished game ignores further steps");
});

test("locking entirely above the visible field ends the game", () => {
  const game = createGame(3);
  for (let r = HIDDEN_ROWS; r < ROWS; r++) game.board[r] = Array.from({ length: COLS }, (_, c) => (c === COLS - 1 ? null : filled()));
  slam(game);
  assert.equal(game.over, true);
});

// --- squares ---------------------------------------------------------------------------------------

/** Place four horizontal I pieces in rows top..top+3, columns col..col+3 (a gold square), ids from firstId. */
function stackIs(board, col, top, firstId) {
  for (let i = 0; i < 4; i++) place(board, "I", 0, col, top + i - 1, firstId + i);
}

test("four pieces of one type in a 4x4 make a gold square", () => {
  const board = createBoard();
  stackIs(board, 0, 18, 1);
  const found = markSquares(board, 1);
  assert.deepEqual(found, [{ id: 1, kind: "gold", row: 18, col: 0 }]);
  assert.equal(board[18][0].square, "gold");
  assert.equal(board[21][3].squareId, 1);
});

test("four pieces of mixed types in a 4x4 make a silver square", () => {
  const board = createBoard();
  place(board, "O", 0, 0, 18, 1);
  place(board, "O", 0, 2, 18, 2);
  place(board, "I", 0, 0, 19, 3); // fills row 20
  place(board, "I", 0, 0, 20, 4); // fills row 21
  assert.deepEqual(markSquares(board, 1), [{ id: 1, kind: "silver", row: 18, col: 0 }]);
});

test("no square: a gap, a partial piece, or too many pieces", () => {
  const gap = createBoard();
  stackIs(gap, 0, 18, 1);
  gap[19][2] = null;
  assert.deepEqual(markSquares(gap, 1), []);

  const cut = createBoard();
  stackIs(cut, 0, 18, 1);
  cut[21][3] = { type: "I", pieceId: 77 }; // one cell of a different piece: 5 pieces, one with a single cell
  assert.deepEqual(markSquares(cut, 1), []);

  const many = createBoard();
  for (let r = 18; r < 22; r++) for (let c = 0; c < 4; c++) many[r][c] = { type: "T", pieceId: 100 + r * 4 + c };
  assert.deepEqual(markSquares(many, 1), [], "16 single-cell pieces");
});

test("a piece in a square is never reused by an overlapping region", () => {
  const board = createBoard();
  stackIs(board, 0, 18, 1);
  stackIs(board, 4, 18, 5);
  assert.equal(markSquares(board, 1).length, 2);
  assert.equal(markSquares(board, 3).length, 0, "already marked");
  // A fifth I next to the first two squares cannot make a region with cells of a marked square.
  place(board, "I", 1, 7, 17, 9); // vertical I at column 9, rows 17-20 (box column 2)
  assert.equal(markSquares(board, 3).length, 0);
});

test("squaresInRow counts each square once, by kind", () => {
  const board = createBoard();
  stackIs(board, 0, 18, 1);
  place(board, "O", 0, 4, 18, 5);
  place(board, "O", 0, 6, 18, 6);
  place(board, "I", 0, 4, 19, 7);
  place(board, "I", 0, 4, 20, 8);
  markSquares(board, 1);
  assert.deepEqual(squaresInRow(board[19]), { gold: 1, silver: 1 });
  assert.deepEqual(squaresInRow(board[10]), { gold: 0, silver: 0 });
});

test("scoring table: every combination from the spec", () => {
  const mix = { "1 multi": { gold: 0, silver: 1 }, "2 multi": { gold: 0, silver: 2 }, "1 mono": { gold: 1, silver: 0 }, "1 & 1": { gold: 1, silver: 1 }, "2 mono": { gold: 2, silver: 0 } };
  const expected = {
    1: [6, 11, 11, 16, 21],
    2: [12, 22, 22, 32, 42],
    3: [18, 33, 33, 48, 63],
    4: [25, 45, 45, 65, 85],
  };
  for (const [lines, values] of Object.entries(expected)) {
    Object.entries(mix).forEach(([name, row], i) => {
      assert.equal(linePoints(Array.from({ length: Number(lines) }, () => row)), values[i], `${lines} lines, ${name}`);
    });
  }
  assert.equal(linePoints([{ gold: 0, silver: 0 }]), 1, "a plain line is 1");
  assert.equal(linePoints(Array.from({ length: 4 }, () => ({ gold: 0, silver: 0 }))), 5, "a plain tetris is 4 + 1");
});

/**
 * A board with squares in rows 18-21 at the given columns, junk filling the remaining columns up to column 8,
 * and column 9 left open for a vertical I. `fullRowsOnly` limits which of the four rows get their junk.
 */
function squareBoard(game, kinds, junkRows = [18, 19, 20, 21]) {
  let id = 1;
  kinds.forEach((kind, i) => {
    if (kind === "gold") stackIs(game.board, i * 4, 18, id);
    else {
      place(game.board, "O", 0, i * 4, 18, id);
      place(game.board, "O", 0, i * 4 + 2, 18, id + 1);
      place(game.board, "I", 0, i * 4, 19, id + 2);
      place(game.board, "I", 0, i * 4, 20, id + 3);
    }
    id += 4;
  });
  for (const r of junkRows) for (let c = kinds.length * 4; c < 9; c++) game.board[r][c] = { type: "T", pieceId: 1000 + r * 10 + c };
  game.current = { type: "I", rot: 1, x: 7, y: 18, id: 900 };
}

test("clearing 4 lines through one gold square scores 45, one silver 25, two gold 85", () => {
  for (const [kinds, points] of [[["gold"], 45], [["silver"], 25], [["gold", "gold"], 85], [["gold", "silver"], 65]]) {
    const game = createGame(3);
    squareBoard(game, kinds);
    slam(game);
    assert.equal(game.lines, 4, kinds.join());
    assert.equal(game.score, points, kinds.join());
  }
});

test("the real game scores all 20 cells of the spec's table", () => {
  // Columns of the table: the squares each cleared line passes through. 1 line, 2 lines and 3 lines clear the bottom
  // rows of the squares; "tetris" clears all four rows.
  const columns = [
    ["1 multi", ["silver"]],
    ["2 multi", ["silver", "silver"]],
    ["1 mono", ["gold"]],
    ["1 & 1", ["gold", "silver"]],
    ["2 mono", ["gold", "gold"]],
  ];
  const table = { 1: [6, 11, 11, 16, 21], 2: [12, 22, 22, 32, 42], 3: [18, 33, 33, 48, 63], 4: [25, 45, 45, 65, 85] };
  for (const [lines, values] of Object.entries(table)) {
    const n = Number(lines);
    columns.forEach(([name, kinds], i) => {
      const game = createGame(3);
      const bottomRows = Array.from({ length: n }, (_, k) => ROWS - n + k);
      squareBoard(game, kinds, bottomRows); // squares in rows 18-21; only the bottom n rows are filled in
      slam(game); // a vertical I drops into the open column 9
      assert.equal(game.lines, n, `${name}, ${lines} lines: rows cleared`);
      assert.equal(game.score, values[i], `${name}, ${lines} lines`);
    });
  }
});

test("a locked piece that completes a square forms it and counts it", () => {
  const game = createGame(3);
  for (let i = 0; i < 3; i++) place(game.board, "I", 0, 0, 18 + i - 1, i + 1);
  game.current = { type: "I", rot: 0, x: 0, y: 20, id: 600 };
  slam(game);
  assert.equal(game.goldSquares, 1);
  assert.equal(game.silverSquares, 0);
  assert.equal(game.board[21][0].square, "gold");
});

test("a partly cleared square keeps its bonus for the rows that are left", () => {
  const game = createGame(3);
  squareBoard(game, ["gold"], [21]); // only the bottom row can fill
  slam(game);
  assert.equal(game.lines, 1);
  assert.equal(game.score, 11, "1 line through a gold square");
  // Three rows of the square remain, still marked, now at rows 19-21.
  assert.equal(game.board[21][0].square, "gold");
  assert.equal(game.board[19][0].square, "gold");
  assert.equal(game.board[18][0], null);
  // The bottom row is full again (square, the old I at column 9, new junk): any lock clears it, and the
  // bonus for the square's remaining rows applies again.
  for (let c = 4; c < 9; c++) game.board[21][c] = { type: "T", pieceId: 2000 + c };
  game.current = { type: "O", rot: 0, x: 4, y: 0, id: 901 };
  slam(game);
  assert.equal(game.lines, 2);
  assert.equal(game.score, 22);
  assert.equal(game.board[21][0].square, "gold", "two rows of the square are left");
});

test("metal colors: the engraved glyph reads on every stop, and the slab stands out from the board", () => {
  for (const { stops } of Object.values(METAL)) {
    for (const c of stops) {
      assert.ok(contrastRatio(c.slice(1), INK.slice(1)) >= 4.5, `${INK} on ${c}`);
      for (const bg of ["#2A3440", "#1B222B"]) assert.ok(contrastRatio(c.slice(1), bg.slice(1)) >= 3, `${c} on ${bg}`);
    }
  }
});

// --- events and flourish ---------------------------------------------------------------------------

test("the game reports a square forming, and a clear with its points and the squares each row touched", () => {
  const game = createGame(3);
  squareBoard(game, ["gold"]);
  slam(game);
  const clear = game.events.find((e) => e.type === "clear");
  assert.deepEqual(clear.rows, [18, 19, 20, 21]);
  assert.equal(clear.points, 45);
  assert.deepEqual(clear.rowSquares, Array.from({ length: 4 }, () => ({ gold: 1, silver: 0 })));

  const formed = createGame(3);
  for (let i = 0; i < 3; i++) place(formed.board, "I", 0, 0, 18 + i - 1, i + 1);
  formed.current = { type: "I", rot: 0, x: 0, y: 20, id: 600 };
  slam(formed);
  assert.deepEqual(formed.events, [{ type: "square", id: 1, kind: "gold", row: 18, col: 0 }]);
  step(formed, []);
  assert.deepEqual(formed.events, [], "events last one step");
});

/** A fixed "random" source for exact effect counts. */
const fixedRng = () => 0.5;

test("effects: a new square gets a ring, a shine and sparks, which expire", () => {
  const fx = createEffects({ rng: fixedRng });
  fx.add([{ type: "square", id: 1, kind: "gold", row: 18, col: 0 }], 1000);
  const kinds = fx.active(1000).map((e) => e.kind);
  assert.equal(kinds.filter((k) => k === "ring").length, 1);
  assert.equal(kinds.filter((k) => k === "shine").length, 1);
  assert.ok(kinds.filter((k) => k === "spark").length >= 10);
  assert.ok(fx.active(1400).length > 0, "still animating");
  assert.equal(fx.active(1000 + 2000).length, 0, "all expired");
});

test("effects: a clear through a square flashes the rows and floats the points; a plain clear only flashes", () => {
  const fx = createEffects({ rng: fixedRng });
  fx.add([{ type: "clear", rows: [20, 21], rowSquares: [{ gold: 1, silver: 0 }, { gold: 1, silver: 0 }], points: 22 }], 0);
  const list = fx.active(0);
  assert.equal(list.filter((e) => e.kind === "flash").length, 2);
  const popup = list.find((e) => e.kind === "popup");
  assert.equal(popup.text, "+22");
  assert.equal(popup.tone, "gold");

  const plain = createEffects({ rng: fixedRng });
  plain.add([{ type: "clear", rows: [21], rowSquares: [{ gold: 0, silver: 0 }], points: 1 }], 0);
  const kinds = plain.active(0).map((e) => e.kind);
  assert.deepEqual(kinds, ["flash"], "no sparks or popup for a plain line");
});

test("effects: reduced motion keeps the glow and the points but drops sparks and shine", () => {
  const fx = createEffects({ rng: fixedRng, reducedMotion: () => true });
  fx.add([
    { type: "square", id: 1, kind: "silver", row: 18, col: 0 },
    { type: "clear", rows: [21], rowSquares: [{ gold: 0, silver: 1 }], points: 6 },
  ], 0);
  const kinds = new Set(fx.active(0).map((e) => e.kind));
  assert.ok(kinds.has("ring") && kinds.has("flash") && kinds.has("popup"));
  assert.ok(!kinds.has("spark") && !kinds.has("shine"));
  assert.equal(fx.calm, true);
});

// --- pause for the flourish ------------------------------------------------------------------------

test("a new square holds the next piece back for the flourish, ignoring input meanwhile", () => {
  const game = createGame(3);
  for (let i = 0; i < 3; i++) place(game.board, "I", 0, 0, 18 + i - 1, i + 1);
  game.current = { type: "I", rot: 0, x: 0, y: 20, id: 600 };
  const nextType = game.queue[0];
  slam(game);
  assert.equal(game.goldSquares, 1);
  assert.equal(game.current, null, "nothing in play");
  assert.equal(game.entryDelay, FLOURISH_ENTRY_DELAY_TICKS);
  assert.equal(game.queue[0], nextType, "the next piece is still waiting");
  for (let i = 0; i < FLOURISH_ENTRY_DELAY_TICKS - 1; i++) step(game, ["left", "hardDrop", "hold"]);
  assert.equal(game.current, null, "input did nothing and the piece has not entered");
  assert.equal(game.holdsUsed, 0);
  step(game, []);
  assert.equal(game.current.type, nextType, "then it enters");
  assert.equal(game.entryDelay, 0);
});

test("a clear through a square pauses; a plain clear does not", () => {
  const game = createGame(3);
  squareBoard(game, ["silver"]);
  slam(game);
  assert.equal(game.current, null);
  assert.equal(game.entryDelay, FLOURISH_ENTRY_DELAY_TICKS);

  const plain = createGame(3);
  plain.board[ROWS - 1] = Array.from({ length: COLS }, (_, c) => (c < 6 ? filled() : null));
  plain.current = { type: "I", rot: 0, x: 6, y: ROWS - 2, id: 77 };
  slam(plain);
  assert.equal(plain.lines, 1);
  assert.ok(plain.current, "the next piece is in play at once");
  assert.equal(plain.entryDelay, 0);
});

// --- stats -----------------------------------------------------------------------------------------

// The rating table as written in the original gradePerf(), top to bottom: [upper bound, grade].
const PHP_GRADES = [
  [0.6, "F"], [0.63, "D-"], [0.67, "D"], [0.7, "D+"], [0.73, "C-"], [0.77, "C"], [0.8, "C+"], [0.83, "B-"],
  [0.87, "B"], [0.9, "B+"], [0.93, "A-"], [0.97, "A"], [1.0, "A+"], [1.05, "1S-"], [1.15, "1S"], [1.2, "1S+"],
  [1.25, "2S-"], [1.35, "2S"], [1.4, "2S+"], [1.45, "3S-"], [1.55, "3S"], [1.6, "3S+"], [1.65, "4S-"],
  [1.75, "4S"], [1.8, "4S+"], [1.85, "5S-"], [1.95, "5S"], [2, "5S+"],
];

test("gradePerf: every boundary, just under and exactly at the bound", () => {
  // 1000 seconds, so lines / 1000 is the rate and the comparisons are exact.
  PHP_GRADES.forEach(([bound, grade], i) => {
    const at = Math.round(bound * 1000);
    assert.equal(gradePerf(1000, at - 1), grade, `just under ${bound}`);
    const above = i + 1 < PHP_GRADES.length ? PHP_GRADES[i + 1][1] : "XS";
    assert.equal(gradePerf(1000, at), above, `exactly ${bound}`);
  });
  assert.equal(gradePerf(1000, 5000), "XS", "well past 2 lines per second");
});

test("gradePerf: no time is rate 0 and an F, and a few spot checks", () => {
  assert.equal(lineRate(0, 10), 0);
  assert.equal(gradePerf(0, 10), "F");
  assert.equal(gradePerf(100, 0), "F");
  assert.equal(gradePerf(100, 85), "B");
  assert.equal(gradePerf(100, 99), "A+");
  assert.equal(gradePerf(100, 110), "1S");
  assert.equal(gradePerf(Number.NaN, 1), "F", "an unusable time counts as no time, like the original");
  assert.equal(gradePerf(100, Number.NaN), "NA");
});

test("summarize: time, score per second and grade, with a dash until something has scored", () => {
  assert.deepEqual(summarize(0, 0), { time: "0:00.0", rate: "0.00", grade: "-", natural: false });
  assert.deepEqual(summarize(600, 0), { time: "0:10.0", rate: "0.00", grade: "-", natural: false });
  // 10 seconds and 85 points is 8.5 lines per second.
  assert.deepEqual(summarize(600, 85), { time: "0:10.0", rate: "8.50", grade: "XS", natural: true });
  // 100 seconds and 85 points is 0.85 per second: a B.
  assert.deepEqual(summarize(6000, 85), { time: "1:40.0", rate: "0.85", grade: "B", natural: false });
});

test("the rate is judged on score, not on rows cleared", () => {
  const game = createGame(3);
  squareBoard(game, ["gold"]);
  slam(game);
  assert.equal(game.lines, 4, "four rows cleared");
  assert.equal(game.score, 45, "worth 45 with the gold square");
  for (let i = 0; i < 60 * 45; i++) step(game, []);
  assert.equal(summarize(game.tick, game.score).rate, (45 / (game.tick / 60)).toFixed(2));
});

test("game time counts ticks: 60 per second, shown as m:ss.t", () => {
  assert.equal(gameSeconds(120), 2);
  assert.equal(formatTime(0), "0:00.0");
  assert.equal(formatTime(59), "0:00.9");
  assert.equal(formatTime(60), "0:01.0");
  assert.equal(formatTime(60 * 65 + 30), "1:05.5");
  assert.equal(formatTime(60 * 60 * 10), "10:00.0");
  const game = createGame(3);
  for (let i = 0; i < 90; i++) step(game, []);
  assert.equal(formatTime(game.tick), "0:01.5");
});

// --- move counters ---------------------------------------------------------------------------------

test("counters: successful spins are counted by direction", () => {
  const game = createGame(3);
  step(game, ["rotateCW"]);
  step(game, ["rotateCW"]);
  step(game, ["rotateCCW"]);
  assert.equal(game.spinsCW, 2);
  assert.equal(game.spinsCCW, 1);
});

test("counters: a spin that is blocked is not counted", () => {
  const game = createGame(3);
  // A horizontal I walled in on every side: no rotation or kick can fit.
  for (let r = 10; r <= 14; r++) game.board[r] = Array.from({ length: COLS }, () => filled());
  for (let c = 3; c <= 6; c++) game.board[11][c] = null;
  game.current = { type: "I", rot: 0, x: 3, y: 10, id: 50 };
  step(game, ["rotateCW", "rotateCCW"]);
  assert.equal(game.current.rot, 0, "it did not turn");
  assert.equal(game.spinsCW, 0);
  assert.equal(game.spinsCCW, 0);
});

test("counters: each successful step left or right is counted, a blocked one is not", () => {
  const game = createGame(3);
  step(game, ["left"]);
  step(game, ["left"]);
  step(game, ["right"]);
  assert.equal(game.movesLeft, 2);
  assert.equal(game.movesRight, 1);
  // Push into the wall until the piece cannot go further left: those pushes count nothing.
  for (let i = 0; i < 10; i++) step(game, ["left"]);
  const p = game.current;
  assert.ok(collides(game.board, p.type, p.rot, p.x - 1, p.y), "the piece is against the wall");
  const atWall = game.movesLeft;
  step(game, ["left"]);
  step(game, ["left"]);
  assert.equal(game.movesLeft, atWall, "pushing into the wall counts nothing");
  assert.equal(game.movesRight, 1, "right steps are counted separately");
});

test("counters: soft drop counts rows fallen, not ticks held", () => {
  const game = createGame(3);
  const y0 = game.current.y;
  for (let i = 0; i < 10; i++) step(game, ["softDrop"]);
  assert.equal(game.softDrops, game.current.y - y0);
  assert.equal(game.softDrops, 5, "10 ticks at a row every 2 ticks");
  const before = game.softDrops;
  for (let i = 0; i < 5; i++) step(game, []);
  assert.equal(game.softDrops, before, "gravity alone is not a soft drop");
});

test("counters: a hard drop counts once per piece, however many presses it takes to lock", () => {
  const game = createGame(3);
  step(game, ["hardDrop"]);
  assert.equal(game.hardDrops, 1);
  step(game, ["hardDrop"]); // locks the same piece
  assert.equal(game.piecesPlaced, 1);
  assert.equal(game.hardDrops, 1, "the locking press is the same hard drop");
  step(game, ["hardDrop"]);
  step(game, ["hardDrop"]);
  assert.equal(game.hardDrops, 2, "the next piece is a second hard drop");
  // A piece that just locks by itself is not a hard drop.
  const idle = createGame(3);
  for (let i = 0; i < 2000 && idle.piecesPlaced === 0; i++) step(idle, []);
  assert.equal(idle.piecesPlaced, 1);
  assert.equal(idle.hardDrops, 0);
});

test("counters: mono (gold) and multi (silver) squares are counted as they are made", () => {
  const gold = createGame(3);
  for (let i = 0; i < 3; i++) place(gold.board, "I", 0, 0, 18 + i - 1, i + 1);
  gold.current = { type: "I", rot: 0, x: 0, y: 20, id: 600 };
  slam(gold);
  assert.deepEqual([gold.goldSquares, gold.silverSquares], [1, 0]);

  const silver = createGame(3);
  place(silver.board, "O", 0, 0, 18, 1);
  place(silver.board, "O", 0, 2, 18, 2);
  place(silver.board, "I", 0, 0, 19, 3); // fills row 20
  silver.current = { type: "I", rot: 0, x: 0, y: 20, id: 600 }; // fills row 21
  slam(silver);
  assert.deepEqual([silver.goldSquares, silver.silverSquares], [0, 1]);
});

test("counters: swaps are the successful holds only", () => {
  const game = createGame(3);
  step(game, ["hold"]);
  step(game, ["hold"]); // not allowed again for this piece
  assert.equal(game.holdsUsed, 1);
  slam(game);
  step(game, ["hold"]);
  assert.equal(game.holdsUsed, 2);
});

test("counters do not change the round, and a replay reproduces them", () => {
  const seed = 99;
  const log = [];
  const game = createGame(seed);
  for (let t = 0; t < 400; t++) {
    const actions = t % 50 === 3 ? ["rotateCW"] : t % 50 === 6 ? ["rotateCCW"] : t % 50 === 9 ? ["softDrop"] : t % 50 === 12 ? ["hold"] : t % 80 === 79 ? ["hardDrop"] : [];
    step(game, actions);
    for (const action of actions) log.push({ t: game.tick, action });
  }
  const again = replay(seed, log, game.tick);
  for (const k of ["spinsCW", "spinsCCW", "movesLeft", "movesRight", "softDrops", "hardDrops", "holdsUsed"]) assert.equal(again[k], game[k], k);
  assert.ok(game.spinsCW > 0 && game.holdsUsed > 0, "the counters actually moved");
});

// --- scorecard -------------------------------------------------------------------------------------

test("linePointsBreakdown splits points by source and adds up to linePoints", () => {
  const rows = Array.from({ length: 4 }, () => ({ gold: 1, silver: 1 }));
  assert.deepEqual(linePointsBreakdown(rows), { lines: 4, squares: 60, tetris: 1 });
  assert.equal(linePoints(rows), 65);
  assert.deepEqual(linePointsBreakdown([{ gold: 0, silver: 0 }]), { lines: 1, squares: 0, tetris: 0 });
  for (const n of [1, 2, 3, 4]) {
    for (const row of [{ gold: 0, silver: 0 }, { gold: 1, silver: 0 }, { gold: 0, silver: 2 }, { gold: 1, silver: 1 }]) {
      const rs = Array.from({ length: n }, () => row);
      const b = linePointsBreakdown(rs);
      assert.equal(b.lines + b.squares + b.tetris, linePoints(rs));
    }
  }
});

test("the game records the order pieces are dealt, when pieces lock, clears and where the points came from", () => {
  const game = createGame(3);
  const first = game.current.type;
  const queued = game.queue.slice();
  assert.deepEqual(game.dealt, [{ type: first, tick: 0 }]);
  slam(game);
  slam(game);
  assert.deepEqual(game.dealt.map((d) => d.type), [first, queued[0], queued[1]], "the order they came off the bag");
  assert.equal(game.locks.length, 2);
  assert.deepEqual(game.locks.map((l) => l.type), [first, queued[0]]);
  assert.ok(game.locks[1].tick >= game.locks[0].tick);
  // A swap deals a piece from the bag only when the hold slot is empty.
  const h = createGame(3);
  const dealtBefore = h.dealt.length;
  step(h, ["hold"]);
  assert.equal(h.dealt.length, dealtBefore + 1, "first hold pulls the next piece");
  slam(h);
  step(h, ["hold"]);
  assert.equal(h.dealt.length, dealtBefore + 2, "a swap returns the held piece, which is not dealt again; the slam dealt one");
});

test("clears, point sources and garbage rows are tallied", () => {
  const game = createGame(3);
  squareBoard(game, ["gold"]);
  slam(game);
  assert.deepEqual(game.clears, [0, 0, 0, 0, 1]);
  assert.deepEqual([game.pointsLines, game.pointsSquares, game.pointsTetris], [4, 40, 1]);
  assert.equal(game.pointsLines + game.pointsSquares + game.pointsTetris, game.score);

  const plain = createGame(3);
  plain.board[ROWS - 1] = Array.from({ length: COLS }, (_, c) => (c < 6 ? filled() : null));
  plain.current = { type: "I", rot: 0, x: 6, y: ROWS - 2, id: 77 };
  slam(plain);
  assert.deepEqual(plain.clears, [0, 1, 0, 0, 0]);

  const g = createGame(4, { garbagePerSecond: 0.65 });
  g.garbagePending = 3;
  slam(g);
  assert.equal(g.garbageRows, 3);
});

/** Play a short deterministic round and return the game and its log, like the page does. */
function playRound(seed, options) {
  const game = createGame(seed, options);
  const inputLog = [];
  for (let t = 0; t < 900 && !game.over; t++) {
    const actions = t % 40 === 5 ? ["rotateCW"] : t % 40 === 10 ? ["left"] : t % 40 === 15 ? ["hardDrop"] : t % 40 === 20 ? ["hardDrop"] : [];
    step(game, actions);
    for (const action of actions) inputLog.push({ t: game.tick, action });
  }
  return { game, inputLog };
}

test("buildScorecard: result, piece order and counters, all from the game", () => {
  const { game, inputLog } = playRound(21);
  const card = buildScorecard({ game, mode: "easy", garbagePerSecond: 0.65, ended: "ended", startedAt: Date.UTC(2026, 10, 21, 14, 30, 5), inputLog });
  assert.equal(card.app, "tetris");
  assert.equal(card.format, SCORECARD_FORMAT);
  assert.equal(card.mode, "easy");
  assert.equal(card.startedAt, "2026-11-21T14:30:05.000Z");
  assert.equal(card.seed, 21);
  assert.equal(card.tickRate, 60);
  assert.equal(card.result.ticks, game.tick);
  assert.equal(card.result.seconds, Math.round(game.tick / 60 * 1000) / 1000);
  assert.equal(card.result.time, formatTime(game.tick));
  assert.equal(card.pieces.played, game.piecesPlaced);
  assert.equal(card.pieces.sequence, game.dealt.map((d) => d.type).join(""));
  assert.equal(Object.values(card.pieces.byType).reduce((a, b) => a + b, 0), game.piecesPlaced, "the piece mix adds up to the pieces played");
  assert.equal(card.moves.hardDrops, game.hardDrops);
  assert.equal(card.moves.left, game.movesLeft);
  assert.equal(card.garbage.perSecond, 0.65);
  assert.equal(card.inputLog.length, inputLog.length);
  assert.ok(card.pieces.played > 3, "the round actually played");
});

test("the exported JSON parses back to the same data, and seed + inputLog replays the round", () => {
  const { game, inputLog } = playRound(77);
  const card = buildScorecard({ game, mode: "practice", garbagePerSecond: 0, ended: "topout", startedAt: 0, inputLog });
  const text = scorecardJson(card);
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(card)), "a faithful copy");
  assert.ok(text.endsWith("}\n"));
  assert.ok(text.includes('{"t":'), "inputs one per line");
  const back = JSON.parse(text);
  const again = replay(back.seed, back.inputLog, back.result.ticks);
  assert.equal(again.score, game.score);
  assert.equal(again.piecesPlaced, game.piecesPlaced);
  assert.equal(snapshot(again), snapshot(game));
  assert.equal(again.dealt.map((d) => d.type).join(""), back.pieces.sequence, "the same pieces in the same order");
});

test("scorecardJson also writes lists of saved scores; filenames carry the mode and start time", () => {
  const out = scorecardJson({ app: "tetris", format: 1, scores: [rec({ score: 1 }), rec({ score: 2 })] });
  assert.equal(JSON.parse(out).scores.length, 2);
  assert.equal(scorecardJson({ a: [], b: {} }), '{\n  "a": [],\n  "b": {}\n}\n');
  assert.equal(scorecardFilename({ mode: "hard", startedAt: "2026-11-21T14:30:05.000Z" }), "tetris-hard-20261121-143005.json");
});

test("scorecardSections: every group is present, garbage only when there was garbage", () => {
  const { game, inputLog } = playRound(5);
  const practice = buildScorecard({ game, mode: "practice", garbagePerSecond: 0, ended: "ended", startedAt: 0, inputLog });
  assert.deepEqual(scorecardSections(practice).map((s) => s.title), ["Time", "Lines", "Points", "Moves", "Piece mix"]);
  const hard = buildScorecard({ game, mode: "hard", garbagePerSecond: 1.1, ended: "ended", startedAt: 0, inputLog });
  assert.deepEqual(scorecardSections(hard).map((s) => s.title), ["Time", "Lines", "Points", "Moves", "Garbage", "Piece mix"]);
  const mix = scorecardSections(practice).find((s) => s.title === "Piece mix");
  assert.deepEqual(mix.items.map(([t]) => t), ["I", "O", "T", "S", "Z", "J", "L"]);
});

// --- natural ---------------------------------------------------------------------------------------

const at = (m, sec) => (m * 60 + sec) * 60; // ticks for m:ss

test("naturalNumber runs minutes and seconds together without the colon", () => {
  assert.equal(naturalNumber(at(0, 30)), 30);
  assert.equal(naturalNumber(at(0, 59)), 59);
  assert.equal(naturalNumber(at(1, 12)), 112);
  assert.equal(naturalNumber(at(2, 5)), 205);
  assert.equal(naturalNumber(at(10, 0)), 1000);
  assert.equal(naturalNumber(at(0, 59) + 59), 59, "whole seconds only: 0:59.9 is still 59");
  assert.equal(naturalNumber(0), 0);
});

test("naturals: 40 in 0:30, 70 in 0:59, 120 in 1:12 and 220 in 2:05", () => {
  assert.ok(isNatural(at(0, 30), 40));
  assert.ok(isNatural(at(0, 59), 70));
  assert.ok(isNatural(at(1, 12), 120));
  assert.ok(isNatural(at(2, 5), 220));
});

test("not naturals: equal is not greater, a bit short, and nothing scored", () => {
  assert.equal(isNatural(at(0, 30), 30), false, "equal");
  assert.equal(isNatural(at(0, 30), 29), false);
  assert.equal(isNatural(at(1, 12), 112), false, "equal");
  assert.ok(isNatural(at(1, 12), 113));
  assert.equal(isNatural(at(1, 0), 99), false, "1:00 is 100");
  assert.ok(isNatural(at(1, 0), 101));
  assert.equal(isNatural(at(2, 5), 205), false);
  assert.equal(isNatural(0, 0), false, "no score");
  assert.equal(isNatural(at(0, 30), 0), false);
});

// --- difficulty and garbage ------------------------------------------------------------------------

test("difficulties: Practice has no garbage; Easy, Medium and Hard run at a D, B and S rate", () => {
  assert.deepEqual(DIFFICULTIES.map((d) => d.id), ["practice", "easy", "medium", "hard"]);
  assert.equal(difficultyById("practice").garbagePerSecond, 0);
  assert.equal(gradePerf(1, difficultyById("easy").garbagePerSecond), "D");
  assert.equal(gradePerf(1, difficultyById("medium").garbagePerSecond), "B");
  assert.ok(gradePerf(1, difficultyById("hard").garbagePerSecond).endsWith("S"), "an S grade");
  assert.equal(difficultyById("nonsense").id, "practice", "unknown falls back to Practice");
});

test("Practice never gets garbage", () => {
  const game = createGame(4);
  for (let i = 0; i < 2000; i++) step(game, []);
  assert.equal(game.garbagePending, 0);
  assert.equal(game.nextGarbageId, -1);
});

test("garbage is owed at the difficulty's rate, after the 5 second warm-up", () => {
  const game = createGame(4, { garbagePerSecond: 0.65 });
  for (let i = 0; i < 300; i++) step(game, []);
  assert.equal(game.garbagePending, 0, "nothing in the warm-up");
  for (let i = 0; i < 92; i++) step(game, []);
  assert.equal(game.garbagePending, 0, "92 ticks is not yet 1/0.65 s");
  step(game, []);
  assert.equal(game.garbagePending, 1);
  // Run on to tick 992: 692 ticks past the warm-up is 692 x 650 / 60000 = 7.5 rows, so 7 are owed in all, whether
  // a lock has let some arrive already or they are all still waiting.
  while (game.tick < 992) step(game, []);
  assert.equal(game.over, false);
  assert.equal(game.garbagePending + (-1 - game.nextGarbageId) / COLS, 7);
});

test("garbage rows arrive after a lock, pushing the stack up, each with one hole", () => {
  const game = createGame(4, { garbagePerSecond: 0.65 });
  game.board[ROWS - 1][0] = filled("T", 77);
  game.garbagePending = 2;
  slam(game);
  assert.equal(game.garbagePending, 0);
  assert.equal(game.board[ROWS - 3][0]?.pieceId, 77, "the stack moved up two rows");
  for (const r of [ROWS - 1, ROWS - 2]) {
    assert.equal(game.board[r].filter((c) => c === null).length, 1, `row ${r} has one hole`);
    assert.ok(game.board[r].every((c) => c === null || c.type === "G"));
  }
  assert.deepEqual(game.events.find((e) => e.type === "garbage"), { type: "garbage", rows: 2 });
  assert.ok(game.current, "then the next piece is in play");
});

test("at most 6 garbage rows arrive at once; the rest wait", () => {
  const game = createGame(4, { garbagePerSecond: 1.1 });
  game.garbagePending = 10;
  slam(game);
  assert.equal(game.garbagePending, 4);
});

test("a stack pushed off the top ends the game; garbage never makes a square", () => {
  const game = createGame(4, { garbagePerSecond: 1.1 });
  game.board[0][0] = filled();
  game.garbagePending = 1;
  slam(game);
  assert.equal(game.over, true);

  const board = createBoard();
  for (let i = 0; i < 4; i++) assert.equal(pushGarbageRow(board, 9, -1 - i * COLS), true);
  assert.deepEqual(markSquares(board, 1), [], "four rows of rubble are not a square");
  const full = createBoard();
  full[0][5] = filled();
  assert.equal(pushGarbageRow(full, 0, -1), false, "blocked at the top");
  assert.ok(full[0][5], "and the board is unchanged");
});

test("garbage and the pause for a flourish: garbage waits for the next piece, and arrives with it", () => {
  const game = createGame(3, { garbagePerSecond: 0.85 });
  squareBoard(game, ["gold"]);
  game.garbagePending = 1;
  slam(game);
  assert.equal(game.current, null, "flourish pause");
  assert.equal(game.garbagePending, 1, "still owed during the pause");
  for (let i = 0; i < FLOURISH_ENTRY_DELAY_TICKS; i++) step(game, []);
  assert.ok(game.current);
  assert.equal(game.garbagePending, 0);
  assert.equal(game.board[ROWS - 1].filter((c) => c?.type === "G").length, 9);
});

test("a round with garbage replays exactly from its seed and inputs", () => {
  const seed = 31337;
  const options = { garbagePerSecond: 1.1 };
  const pick = makeRng(7);
  const game = createGame(seed, options);
  const inputLog = [];
  while (!game.over && game.tick < 3000) {
    const actions = [];
    if (game.tick % 40 === 0) {
      for (let i = pick() * 4 | 0; i > 0; i--) actions.push(pick() < 0.5 ? "left" : "right");
      actions.push("hardDrop");
    } else if (game.tick % 40 === 20) actions.push("hardDrop");
    step(game, actions);
    for (const action of actions) inputLog.push({ t: game.tick, action });
  }
  assert.ok(game.nextGarbageId < -1, "garbage actually arrived");
  assert.equal(snapshot(replay(seed, inputLog, game.tick, options)), snapshot(game));
  // Garbage must not change the piece sequence: the same seed with none gives the same first pieces.
  const withGarbage = createGame(seed, options);
  const without = createGame(seed);
  assert.deepEqual(withGarbage.queue, without.queue);
});

test("garbage color reads on the board stone, and the hatching ink reads on it", () => {
  for (const bg of ["#2A3440", "#323E4B", "#1B222B", "#232C36"]) {
    assert.ok(contrastRatio(GARBAGE_COLOR.slice(1), bg.slice(1)) >= 3, `${GARBAGE_COLOR} on ${bg}`);
  }
  assert.ok(contrastRatio(GARBAGE_COLOR.slice(1), INK.slice(1)) >= 4.5);
  assert.ok(!Object.values(PIECE_COLORS).includes(GARBAGE_COLOR), "distinct from every piece");
});

test("effects: arriving garbage flashes the new bottom rows red", () => {
  const fx = createEffects({ rng: fixedRng });
  fx.add([{ type: "garbage", rows: 2 }], 0);
  const flashes = fx.active(0).filter((e) => e.kind === "flash");
  assert.deepEqual(flashes.map((e) => [e.row, e.tone]), [[21, "danger"], [20, "danger"]]);
});

// --- saved scores ----------------------------------------------------------------------------------

/** A minimal in-memory Storage. */
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}
const rec = (over = {}) => ({ at: 1, mode: "easy", ended: "ended", score: 10, lines: 8, level: 1, ticks: 600, rate: "1.00", grade: "1S-", natural: false, piecesPlaced: 20, goldSquares: 0, silverSquares: 0, seed: 1, rulesVersion: 4, ...over });

test("scores: saved results persist, and bad storage reads as no scores", () => {
  const storage = fakeStorage();
  assert.deepEqual(loadScores(storage), []);
  assert.equal(saveScore(storage, rec({ score: 5 })), true);
  assert.equal(saveScore(storage, rec({ score: 9 })), true);
  assert.deepEqual(loadScores(storage).map((r) => r.score), [5, 9]);

  assert.deepEqual(loadScores(fakeStorage({ [SCORES_KEY]: "not json" })), []);
  assert.deepEqual(loadScores(fakeStorage({ [SCORES_KEY]: '{"a":1}' })), [], "not an array");
  assert.deepEqual(loadScores(fakeStorage({ [SCORES_KEY]: JSON.stringify([rec(), { junk: true }, null, 3]) })).length, 1, "bad entries are dropped");
  assert.deepEqual(loadScores(null), []);
  assert.deepEqual(loadScores({ getItem() { throw new Error("blocked"); } }), []);
});

test("scores: a full or blocked storage fails quietly, and only the newest results are kept", () => {
  assert.equal(saveScore(null, rec()), false);
  assert.equal(saveScore({ getItem: () => null, setItem() { throw new Error("quota"); } }, rec()), false);
  const storage = fakeStorage();
  for (let i = 0; i < MAX_SCORES + 5; i++) saveScore(storage, rec({ score: i, at: i }));
  const all = loadScores(storage);
  assert.equal(all.length, MAX_SCORES);
  assert.equal(all[0].score, 5, "the oldest were dropped");
});

test("bestByMode: the highest score per difficulty, ties to the faster round", () => {
  const best = bestByMode([
    rec({ mode: "easy", score: 10, ticks: 900 }),
    rec({ mode: "easy", score: 30, ticks: 1200 }),
    rec({ mode: "easy", score: 30, ticks: 600 }),
    rec({ mode: "hard", score: 5 }),
    rec({ mode: "medium", score: 0 }),
  ]);
  assert.equal(best.easy.score, 30);
  assert.equal(best.easy.ticks, 600);
  assert.equal(best.hard.score, 5);
  assert.equal(best.medium, undefined, "a round that scored nothing is not a best");
});

// --- keyboard --------------------------------------------------------------------------------------

/** A key event as the keyboard module reads it (Node has no KeyboardEvent). */
const key = (type, code, extra = {}) => Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, ...extra });

test("keyboard: arrows also move menu selection, and a very short tap still counts", () => {
  const target = new EventTarget();
  const kb = createKeyboard(target);
  target.dispatchEvent(key("keydown", "ArrowUp"));
  assert.deepEqual(kb.takePressed().sort(), ["rotateCW", "up"]);
  target.dispatchEvent(key("keydown", "ArrowDown"));
  assert.deepEqual(kb.takePressed(), ["down"]);
  target.dispatchEvent(key("keyup", "ArrowDown"));
  assert.ok(kb.held().has("softDrop"), "pressed and released within one tick: still seen once");
  assert.equal(kb.held().has("softDrop"), false, "and gone the next tick");
  target.dispatchEvent(key("keydown", "ArrowLeft"));
  assert.ok(kb.held().has("left"));
  assert.ok(kb.held().has("left"), "stays while held");
  target.dispatchEvent(key("keyup", "ArrowLeft"));
  assert.equal(kb.held().has("left"), false);
  target.dispatchEvent(key("keydown", "ArrowRight", { repeat: true }));
  assert.equal(kb.held().has("right"), false, "OS auto-repeat is ignored");
});

// --- determinism -----------------------------------------------------------------------------------

/** The parts of a game that must match between a round and its replay. */
const snapshot = (g) => JSON.stringify({
  tick: g.tick, board: g.board, queue: g.queue, current: g.current, hold: g.hold, canHold: g.canHold,
  score: g.score, lines: g.lines, level: g.level, piecesPlaced: g.piecesPlaced, holdsUsed: g.holdsUsed, over: g.over,
});

test("seed + inputLog reproduces a round exactly", () => {
  const seed = 987654;
  const pick = makeRng(42);
  const choices = ["left", "right", "rotateCW", "rotateCCW", "softDrop", "hold", "hardDrop"];
  const game = createGame(seed);
  const inputLog = [];
  while (!game.over && game.tick < 4000) {
    const actions = [];
    if (pick() < 0.4) actions.push(choices[Math.floor(pick() * choices.length)]);
    step(game, actions);
    for (const action of actions) inputLog.push({ t: game.tick, action });
  }
  assert.ok(game.piecesPlaced > 5, "the random round actually played");
  assert.equal(snapshot(replay(seed, inputLog, game.tick)), snapshot(game));
});

// --- input repeater --------------------------------------------------------------------------------

test("repeater: one event on press, then DAS, then ARR", () => {
  const rep = createRepeater({ das: 10, arr: 2 });
  const left = new Set(["left"]);
  const fired = [];
  for (let t = 0; t < 16; t++) if (rep.update(left).length) fired.push(t);
  assert.deepEqual(fired, [0, 10, 12, 14]);
  assert.deepEqual(rep.update(new Set()), []);
  assert.deepEqual(rep.update(left), ["left"], "a new press fires again");
});

test("repeater: the most recently pressed direction wins", () => {
  const rep = createRepeater({ das: 3, arr: 1 });
  assert.deepEqual(rep.update(new Set(["left"])), ["left"]);
  assert.deepEqual(rep.update(new Set(["left", "right"])), ["right"]);
});

// --- gamepad ---------------------------------------------------------------------------------------

/** A fake standard-mapping pad. `down` lists pressed button indexes; `axes` is [leftX, leftY]. */
function fakePad({ down = [], axes = [0, 0], mapping = "standard", connected = true, id = "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)" } = {}) {
  return {
    id, mapping, connected, axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), touched: false, value: down.includes(i) ? 1 : 0 })),
  };
}

test("mapPad: d-pad, face buttons, shoulders and start", () => {
  assert.deepEqual([...mapPad(fakePad({ down: [BUTTON.LEFT] }))], ["left"]);
  assert.deepEqual([...mapPad(fakePad({ down: [BUTTON.RIGHT] }))], ["right"]);
  assert.deepEqual([...mapPad(fakePad({ down: [BUTTON.DOWN] }))].sort(), ["down", "softDrop"]);
  assert.deepEqual([...mapPad(fakePad({ down: [BUTTON.UP] }))].sort(), ["hardDrop", "up"]);
  assert.deepEqual([...mapPad(fakePad({ down: [BUTTON.A] }))].sort(), ["confirm", "rotateCW"]);
  assert.deepEqual([...mapPad(fakePad({ down: [BUTTON.B] }))].sort(), ["back", "rotateCCW"]);
  assert.deepEqual([...mapPad(fakePad({ down: [BUTTON.LB] }))], ["hold"]);
  assert.deepEqual([...mapPad(fakePad({ down: [BUTTON.RB] }))], ["hold"]);
  assert.deepEqual([...mapPad(fakePad({ down: [BUTTON.START] }))], ["pause"]);
  assert.equal(mapPad(fakePad()).size, 0);
});

test("stick: dead zone ignores drift, a firm push moves, up never hard-drops", () => {
  assert.equal(axisDirection(0.15), 0);
  assert.equal(axisDirection(-0.2), 0);
  assert.equal(axisDirection(0.4), 0, "past the dead zone but not a firm push");
  assert.equal(axisDirection(0.6), 1);
  assert.equal(axisDirection(-0.9), -1);
  assert.deepEqual([...mapPad(fakePad({ axes: [-0.9, 0.1] }))], ["left"]);
  assert.deepEqual([...mapPad(fakePad({ axes: [0.1, 0.9] }))].sort(), ["down", "softDrop"]);
  assert.deepEqual([...mapPad(fakePad({ axes: [0, -1] }))], ["up"], "stick up moves menus but never hard-drops");
});

test("createGamepad: held directions are state, other buttons fire once per press", () => {
  let pad = fakePad({ down: [BUTTON.LEFT, BUTTON.A] });
  const gp = createGamepad(new EventTarget(), { nav: { getGamepads: () => [null, pad] } });
  let r = gp.poll();
  assert.deepEqual([...r.held], ["left"]);
  assert.deepEqual([...r.pressed].sort(), ["confirm", "rotateCW"]);
  r = gp.poll();
  assert.deepEqual([...r.held], ["left"], "still held");
  assert.deepEqual(r.pressed, [], "A does not repeat while held");
  pad = fakePad();
  r = gp.poll();
  assert.equal(r.held.size, 0);
  pad = fakePad({ down: [BUTTON.A] });
  assert.deepEqual([...gp.poll().pressed].sort(), ["confirm", "rotateCW"], "a new press fires again");
});

test("createGamepad: no pad or a disconnected pad gives nothing; the first connected pad wins", () => {
  let pads = [null];
  const gp = createGamepad(new EventTarget(), { nav: { getGamepads: () => pads } });
  assert.equal(gp.poll().pad, null);
  pads = [fakePad({ connected: false, down: [BUTTON.UP] }), fakePad({ down: [BUTTON.LEFT] }), fakePad({ down: [BUTTON.RIGHT] })];
  assert.deepEqual([...gp.poll().held], ["left"]);
});

test("createGamepad: connect and disconnect callbacks", () => {
  const target = new EventTarget();
  let pads = [fakePad()];
  const calls = [];
  createGamepad(target, {
    nav: { getGamepads: () => pads },
    onConnect: () => calls.push("connect"),
    onDisconnect: () => calls.push("disconnect"),
  });
  target.dispatchEvent(new Event("gamepadconnected"));
  pads = [fakePad({ connected: false })];
  target.dispatchEvent(new Event("gamepaddisconnected"));
  assert.deepEqual(calls, ["connect", "disconnect"]);
  pads = [fakePad({ connected: false }), fakePad()];
  target.dispatchEvent(new Event("gamepaddisconnected"));
  assert.deepEqual(calls, ["connect", "disconnect"], "another pad is still attached: no disconnect");
});

/** Poll a pad that is sending the given sequence of readings, returning what each poll produced. */
function pollSequence(readings) {
  let pad = readings[0];
  const gp = createGamepad(new EventTarget(), { nav: { getGamepads: () => [pad] } });
  return readings.map((r) => {
    pad = r;
    return gp.poll();
  });
}

test("a d-pad sent as the left stick hard-drops on its very first up press", () => {
  const [rest, up] = pollSequence([fakePad({ axes: [0, 0] }), fakePad({ axes: [0, -1] })]);
  assert.deepEqual(rest.pressed, []);
  assert.deepEqual([...up.pressed].sort(), ["hardDrop", "up"]);
});

test("a d-pad on the stick still moves left, right and down", () => {
  const [a, b, c] = pollSequence([fakePad({ axes: [-1, 0] }), fakePad({ axes: [1, 0] }), fakePad({ axes: [0, 1] })]);
  assert.deepEqual([...a.held], ["left"]);
  assert.deepEqual([...b.held], ["right"]);
  assert.deepEqual([...c.held], ["softDrop"]);
});

test("an analog stick never hard-drops, even pushed fully up", () => {
  const out = pollSequence([fakePad({ axes: [0, -0.5] }), fakePad({ axes: [0, -1] }), fakePad({ axes: [0, 0] }), fakePad({ axes: [0, -1] })]);
  for (const r of out) assert.ok(!r.pressed.includes("hardDrop"));
  assert.ok(out[1].pressed.includes("up"), "but it still moves menus");
});

test("a stick that shows one in-between value is analog for good", () => {
  const state = newPadState();
  observePad(fakePad({ axes: [0, -1] }), state);
  assert.equal(dpadOnStick(state), true);
  observePad(fakePad({ axes: [0.1, -0.4] }), state);
  assert.equal(dpadOnStick(state), false);
  observePad(fakePad({ axes: [0, -1] }), state);
  assert.equal(dpadOnStick(state), false, "it stays analog");
});

test("a pad whose d-pad buttons work keeps its stick as a stick", () => {
  const state = newPadState();
  observePad(fakePad({ down: [BUTTON.LEFT] }), state);
  observePad(fakePad({ axes: [0, -1] }), state);
  assert.equal(dpadOnStick(state), false);
});

test("a hat switch axis is read as a d-pad once it has been seen at rest", () => {
  const axes = (v) => [0, 0, 0, 0, 0, 0, 0, 0, 0, v];
  const [rest, up, upRight, neutral, left] = pollSequence([
    fakePad({ axes: axes(1.2857), mapping: "" }),
    fakePad({ axes: axes(-1), mapping: "" }),
    fakePad({ axes: axes(-0.7143), mapping: "" }),
    fakePad({ axes: axes(1.2857), mapping: "" }),
    fakePad({ axes: axes(0.7143), mapping: "" }),
  ]);
  assert.equal(rest.held.size, 0);
  assert.deepEqual([...up.pressed].sort(), ["hardDrop", "up"]);
  assert.deepEqual([...upRight.held], ["right"]);
  assert.equal(neutral.held.size, 0);
  assert.deepEqual([...left.held], ["left"]);
});

test("hatDirections decodes the eight positions and neutral", () => {
  assert.deepEqual(hatDirections(-1), { up: true, right: false, down: false, left: false });
  assert.deepEqual(hatDirections(-3 / 7), { up: false, right: true, down: false, left: false });
  assert.deepEqual(hatDirections(1 / 7), { up: false, right: false, down: true, left: false });
  assert.deepEqual(hatDirections(1), { up: true, right: false, down: false, left: true });
  assert.equal(hatDirections(9 / 7), null);
});

test("Y also hard-drops on a standard pad, but not on a non-standard one", () => {
  assert.deepEqual([...mapPad(fakePad({ down: [BUTTON.Y] }))].sort(), ["hardDrop", "up"]);
  assert.equal(mapPad(fakePad({ down: [BUTTON.Y], mapping: "" })).size, 0);
});

test("createGamepad.info says how the d-pad arrives", () => {
  let pad = fakePad({ axes: [0, -1] });
  const gp = createGamepad(new EventTarget(), { nav: { getGamepads: () => [pad] } });
  assert.equal(gp.info(), null, "nothing known before the first poll");
  gp.poll();
  assert.equal(gp.info()?.dpadOnStick, true);
  pad = fakePad({ down: [BUTTON.UP] });
  gp.poll();
  assert.equal(gp.info()?.dpadButtons, true);
  assert.equal(gp.info()?.dpadOnStick, false);
});

test("describePad names the pad and flags a non-standard mapping", () => {
  assert.equal(describePad(fakePad()), "Xbox 360 Controller");
  assert.match(describePad(fakePad({ mapping: "", id: "8BitDo Pro 2" })), /non-standard mapping/);
});

// --- page files ------------------------------------------------------------------------------------

test("piece colors: distinct, 3:1 on the board stone in both modes, and the engraved letter reads on them", () => {
  const colors = Object.values(PIECE_COLORS);
  assert.equal(new Set(colors).size, 7);
  // Both ends of the board's stone gradient in light mode (#2A3440 to #323E4B) and dark mode (#1B222B to #232C36).
  for (const c of colors) {
    for (const bg of ["#2A3440", "#323E4B", "#1B222B", "#232C36"]) {
      assert.ok(contrastRatio(c.slice(1), bg.slice(1)) >= 3, `${c} on ${bg}`);
    }
    assert.ok(contrastRatio(c.slice(1), INK.slice(1)) >= 4.5, `${INK} on ${c}`);
  }
});

test("service worker PRECACHE lists exactly the page's files, and they all exist", () => {
  const dir = new URL("../web/tetris/", import.meta.url).pathname;
  const sw = readFileSync(join(dir, "sw.js"), "utf8");
  const block = sw.match(/const PRECACHE = \[([\s\S]*?)\];/)?.[1] ?? "";
  const listed = [...block.matchAll(/'(\/tetris\/[^']*)'/g)].map((m) => m[1]);
  for (const path of listed) {
    const file = path === "/tetris/" ? "index.html" : path.slice("/tetris/".length);
    assert.ok(existsSync(join(dir, file)), `${path} is listed but missing`);
  }
  const onDisk = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name !== "sw.js")
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .map((p) => (p === "index.html" ? "/tetris/" : `/tetris/${p}`));
  const expected = onDisk;
  assert.deepEqual([...listed].sort(), [...expected].sort());
});
