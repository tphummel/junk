// Tests for the pure game logic in web/tetris/src/game/ and the input repeater, plus checks on the page's
// service worker and colors. No browser: the game takes actions in and exposes state out.
// Run with `npm test`.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { contrastRatio } from "../web/golden-angle-palette/palette.js";
import { createBag, makeRng } from "../web/tetris/src/game/bag.js";
import { clearLines, collides, COLS, createBoard, HIDDEN_ROWS, ROWS } from "../web/tetris/src/game/board.js";
import { PIECE_TYPES, pieceCells } from "../web/tetris/src/game/pieces.js";
import { gravityTicks, LOCK_DELAY_TICKS } from "../web/tetris/src/game/rules.js";
import { createGame, landingY, replay, step } from "../web/tetris/src/game/state.js";
import { createRepeater } from "../web/tetris/src/input/actions.js";
import { PIECE_COLORS } from "../web/tetris/src/ui/render.js";

const filled = (type = "T", pieceId = 99) => ({ type, pieceId });

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

test("hard drop scores 2 per row, locks and spawns the next piece", () => {
  const game = createGame(3);
  const rows = landingY(game) - game.current.y;
  const nextType = game.queue[0];
  step(game, ["hardDrop"]);
  assert.equal(game.score, rows * 2);
  assert.equal(game.piecesPlaced, 1);
  assert.equal(game.current.type, nextType);
});

test("soft drop scores 1 per row", () => {
  const game = createGame(3);
  step(game, ["softDrop"]);
  step(game, ["softDrop"]);
  assert.equal(game.score, 1);
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

  step(game, ["hardDrop"]);
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

test("clearing a line scores lineScore * level and counts lines", () => {
  const game = createGame(3);
  game.board[ROWS - 1] = Array.from({ length: COLS }, (_, c) => (c < 6 ? filled() : null));
  game.current = { type: "I", rot: 0, x: 6, y: ROWS - 2, id: 77 };
  step(game, ["hardDrop"]);
  assert.equal(game.lines, 1);
  assert.equal(game.score, 100);
  assert.ok(game.board[ROWS - 1].every((c) => c === null));
});

test("level goes up every 10 lines", () => {
  const game = createGame(3);
  game.lines = 9;
  game.board[ROWS - 1] = Array.from({ length: COLS }, (_, c) => (c < 6 ? filled() : null));
  game.current = { type: "I", rot: 0, x: 6, y: ROWS - 2, id: 77 };
  step(game, ["hardDrop"]);
  assert.equal(game.score, 100, "scored at the old level");
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
  step(game, ["hardDrop"]);
  assert.equal(game.over, true);
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

// --- page files ------------------------------------------------------------------------------------

test("piece colors: distinct, and readable (3:1) on both board backgrounds", () => {
  const colors = Object.values(PIECE_COLORS);
  assert.equal(new Set(colors).size, 7);
  for (const c of colors) {
    for (const bg of ["#F2F2F2", "#0A0A0A"]) {
      assert.ok(contrastRatio(c.slice(1), bg.slice(1)) >= 3, `${c} on ${bg}`);
    }
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
