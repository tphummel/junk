// Tests for the pure game logic in web/tetris/src/game/ and the input repeater, plus checks on the page's
// service worker and colors. No browser: the game takes actions in and exposes state out.
// Run with `npm test`.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { contrastRatio } from "../web/golden-angle-palette/palette.js";
import { createBag, makeRng } from "../web/tetris/src/game/bag.js";
import { clearLines, collides, COLS, createBoard, HIDDEN_ROWS, place, ROWS } from "../web/tetris/src/game/board.js";
import { PIECE_TYPES, pieceCells } from "../web/tetris/src/game/pieces.js";
import { FLOURISH_ENTRY_DELAY_TICKS, gravityTicks, linePoints, LOCK_DELAY_TICKS } from "../web/tetris/src/game/rules.js";
import { markSquares, squaresInRow } from "../web/tetris/src/game/squares.js";
import { formatTime, gameSeconds, gradePerf, lineRate } from "../web/tetris/src/game/stats.js";
import { createGame, landingY, replay, step } from "../web/tetris/src/game/state.js";
import { createRepeater } from "../web/tetris/src/input/actions.js";
import { axisDirection, bindingDown, BUTTON, createGamepad, describeBinding, describePad, detectBinding, mapPad, snapshotPad } from "../web/tetris/src/input/gamepad.js";
import { createEffects } from "../web/tetris/src/ui/effects.js";
import { INK, METAL, PIECE_COLORS } from "../web/tetris/src/ui/render.js";

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
  assert.deepEqual([...mapPad(fakePad({ down: [BUTTON.DOWN] }))], ["softDrop"]);
  assert.deepEqual([...mapPad(fakePad({ down: [BUTTON.UP] }))], ["hardDrop"]);
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
  assert.deepEqual([...mapPad(fakePad({ axes: [0.1, 0.9] }))], ["softDrop"]);
  assert.equal(mapPad(fakePad({ axes: [0, -1] })).size, 0, "stick up does nothing");
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

test("detectBinding finds the control that was pressed, ignoring what was already down", () => {
  const rest = snapshotPad(fakePad({ down: [BUTTON.A], axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1.29] }));
  assert.equal(detectBinding(rest, fakePad({ down: [BUTTON.A], axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1.29] })), null, "nothing new");
  assert.deepEqual(detectBinding(rest, fakePad({ down: [BUTTON.A, 12], axes: [0, 0] })), { type: "button", index: 12 });
  assert.deepEqual(detectBinding(rest, fakePad({ axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, -1] })), { type: "axis", index: 9, value: -1 }, "a hat switch");
  assert.equal(detectBinding(rest, fakePad({ axes: [0, 0.3] })), null, "a small wobble is not a press");
});

test("a learned axis or button binds hard drop on top of d-pad up", () => {
  const hat = { hardDrop: { type: "axis", index: 9, value: -1 } };
  const axes = (v) => [0, 0, 0, 0, 0, 0, 0, 0, 0, v];
  assert.deepEqual([...mapPad(fakePad({ axes: axes(-1) }), 0.2, hat)], ["hardDrop"]);
  assert.equal(mapPad(fakePad({ axes: axes(1.29) }), 0.2, hat).size, 0, "neutral hat");
  assert.equal(mapPad(fakePad({ axes: axes(-0.43) }), 0.2, hat).size, 0, "another hat direction");
  assert.deepEqual([...mapPad(fakePad({ down: [BUTTON.UP] }), 0.2, hat)], ["hardDrop"], "d-pad up still works");
  const btn = { hardDrop: { type: "button", index: 3 } };
  assert.ok(bindingDown(fakePad({ down: [3] }), btn.hardDrop));
  assert.equal(describeBinding(hat.hardDrop), "axis 9 at -1.00");
  assert.equal(describeBinding(btn.hardDrop), "button 3");
});

test("createGamepad.learn: captures the next control, fires no action for it, then uses it", () => {
  let pad = fakePad({ axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1.29] });
  let saved = {};
  const gp = createGamepad(new EventTarget(), { nav: { getGamepads: () => [pad] }, bindings: () => saved });
  assert.equal(gp.learn((b) => { saved = { hardDrop: b }; }), true);
  assert.equal(gp.learning, true);
  assert.deepEqual(gp.poll().pressed, [], "nothing while learning and nothing pressed yet");
  pad = fakePad({ axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, -1] });
  const r = gp.poll();
  assert.deepEqual(r.pressed, [], "the learning press is not also a drop");
  assert.equal(gp.learning, false);
  assert.deepEqual(saved, { hardDrop: { type: "axis", index: 9, value: -1 } });
  assert.deepEqual(gp.poll().pressed, [], "still held: no edge");
  pad = fakePad({ axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1.29] });
  gp.poll();
  pad = fakePad({ axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, -1] });
  assert.deepEqual(gp.poll().pressed, ["hardDrop"], "pressing it again hard-drops");
});

test("createGamepad.learn needs a pad, and can be cancelled", () => {
  const none = createGamepad(new EventTarget(), { nav: { getGamepads: () => [null] } });
  assert.equal(none.learn(() => {}), false);
  const gp = createGamepad(new EventTarget(), { nav: { getGamepads: () => [fakePad()] } });
  gp.learn(() => assert.fail("cancelled"));
  gp.cancelLearn();
  assert.equal(gp.learning, false);
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
