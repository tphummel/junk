// The scorecard: everything about a finished round, built once as plain data. The on-screen view and the JSON export
// both come from this object, so they cannot disagree. Pure: no DOM, clock or storage.

import { TICKS_PER_SECOND } from "../game/rules.js";
import { summarize } from "../game/stats.js";
import { PIECE_TYPES } from "../game/pieces.js";

/** @typedef {import("../game/state.js").Game} Game */
/** @typedef {import("../game/state.js").GameAction} GameAction */
/** @typedef {import("./scores.js").ScoreRecord} ScoreRecord */

/** Bump when the shape of the exported JSON changes. */
export const SCORECARD_FORMAT = 1;

/**
 * @typedef {object} Scorecard
 * @property {string} app
 * @property {number} format
 * @property {string} mode difficulty id
 * @property {"topout" | "ended" | "timeup"} ended
 * @property {string} startedAt ISO time
 * @property {number} seed with the inputLog and rulesVersion, enough to replay the round exactly
 * @property {number} rulesVersion
 * @property {number} tickRate game ticks per second; all times below are in ticks unless named otherwise
 * @property {{ score: number, linesRaw: number, level: number, ticks: number, seconds: number, time: string, rate: string, grade: string, natural: boolean }} result
 * @property {{ lines: number, squares: number, tetris: number }} points where the score came from
 * @property {{ single: number, double: number, triple: number, tetris: number }} clears
 * @property {{ mono: number, multi: number }} squares made
 * @property {{ played: number, perSecond: string, byType: Record<string, number>, sequence: string, dealt: { type: string, tick: number }[], locks: { type: string, tick: number }[] }} pieces
 *   played = locked; sequence is the order pieces were dealt from the bag, as letters; dealt and locks carry the tick of each
 * @property {{ spinsCW: number, spinsCCW: number, left: number, right: number, softDropRows: number, hardDrops: number, swaps: number }} moves
 * @property {{ perSecond: number, rowsReceived: number }} garbage
 * @property {{ t: number, action: GameAction }[]} inputLog
 */

/**
 * @param {object} args
 * @param {Game} args.game the finished (or ended) game
 * @param {string} args.mode difficulty id
 * @param {number} args.garbagePerSecond the difficulty's garbage rate
 * @param {"topout" | "ended" | "timeup"} args.ended
 * @param {number} args.startedAt epoch ms
 * @param {readonly { t: number, action: GameAction }[]} args.inputLog
 * @returns {Scorecard}
 */
export function buildScorecard({ game, mode, garbagePerSecond, ended, startedAt, inputLog }) {
  const stats = summarize(game.tick, game.score);
  const seconds = game.tick / TICKS_PER_SECOND;
  /** @type {Record<string, number>} */
  const byType = Object.fromEntries(PIECE_TYPES.map((t) => [t, 0]));
  for (const l of game.locks) byType[l.type]++;
  return {
    app: "tetris",
    format: SCORECARD_FORMAT,
    mode,
    ended,
    startedAt: new Date(startedAt).toISOString(),
    seed: game.seed,
    rulesVersion: game.rulesVersion,
    tickRate: TICKS_PER_SECOND,
    result: {
      score: game.score, linesRaw: game.lines, level: game.level, ticks: game.tick,
      seconds: Math.round(seconds * 1000) / 1000, time: stats.time, rate: stats.rate, grade: stats.grade, natural: stats.natural,
    },
    points: { lines: game.pointsLines, squares: game.pointsSquares, tetris: game.pointsTetris },
    clears: { single: game.clears[1], double: game.clears[2], triple: game.clears[3], tetris: game.clears[4] },
    squares: { mono: game.goldSquares, multi: game.silverSquares },
    pieces: {
      played: game.piecesPlaced,
      perSecond: (seconds > 0 ? game.piecesPlaced / seconds : 0).toFixed(2),
      byType,
      sequence: game.dealt.map((d) => d.type).join(""),
      dealt: game.dealt.map((d) => ({ type: d.type, tick: d.tick })),
      locks: game.locks.map((l) => ({ type: l.type, tick: l.tick })),
    },
    moves: {
      spinsCW: game.spinsCW, spinsCCW: game.spinsCCW, left: game.movesLeft, right: game.movesRight,
      softDropRows: game.softDrops, hardDrops: game.hardDrops, swaps: game.holdsUsed,
    },
    garbage: { perSecond: garbagePerSecond, rowsReceived: game.garbageRows },
    inputLog: inputLog.map((e) => ({ t: e.t, action: e.action })),
  };
}

/**
 * The on-screen view: titled groups of label and value.
 * @param {Scorecard} card
 * @returns {{ title: string, items: [string, string][] }[]}
 */
export function scorecardSections(card) {
  const n = (/** @type {number} */ v) => String(v);
  const piecesOf = Object.entries(card.pieces.byType).map(([t, c]) => /** @type {[string, string]} */ ([t, n(c)]));
  return [
    {
      title: "Time",
      items: [
        ["Game time", card.result.time],
        ["Lines/sec", card.result.rate],
        ["Pieces", n(card.pieces.played)],
        ["Pieces/sec", card.pieces.perSecond],
        ["Level", n(card.result.level)],
      ],
    },
    {
      title: "Lines",
      items: [
        ["Lines raw", n(card.result.linesRaw)],
        ["1 line", n(card.clears.single)],
        ["2 lines", n(card.clears.double)],
        ["3 lines", n(card.clears.triple)],
        ["4 lines", n(card.clears.tetris)],
      ],
    },
    {
      title: "Points",
      items: [
        ["From lines", n(card.points.lines)],
        ["From squares", n(card.points.squares)],
        ["Tetris bonus", n(card.points.tetris)],
        ["Mono squares", n(card.squares.mono)],
        ["Multi squares", n(card.squares.multi)],
      ],
    },
    {
      title: "Moves",
      items: [
        ["Spin CCW", n(card.moves.spinsCCW)],
        ["Spin CW", n(card.moves.spinsCW)],
        ["Left", n(card.moves.left)],
        ["Right", n(card.moves.right)],
        ["Soft-drop rows", n(card.moves.softDropRows)],
        ["Hard drops", n(card.moves.hardDrops)],
        ["Swaps", n(card.moves.swaps)],
      ],
    },
    ...(card.garbage.perSecond > 0 ? [{ title: "Garbage", items: /** @type {[string, string][]} */ ([["Rate/sec", card.garbage.perSecond.toFixed(2)], ["Rows received", n(card.garbage.rowsReceived)]]) }] : []),
    { title: "Piece mix", items: piecesOf },
  ];
}

/**
 * The export as JSON text. Readable at the top level, with the long lists (the piece sequence and the inputs) one
 * entry per line so they diff and paste well.
 * @param {Scorecard | Record<string, unknown>} card
 * @returns {string}
 */
export function scorecardJson(card) {
  const lists = new Set(["dealt", "locks", "inputLog", "scores"]);
  /** @param {unknown} v @param {string} key @param {string} pad @returns {string} */
  const show = (v, key, pad) => {
    if (Array.isArray(v) && lists.has(key)) {
      if (v.length === 0) return "[]";
      return `[\n${v.map((e) => `${pad}  ${JSON.stringify(e)}`).join(",\n")}\n${pad}]`;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const entries = Object.entries(v);
      if (entries.length === 0) return "{}";
      return `{\n${entries.map(([k, x]) => `${pad}  ${JSON.stringify(k)}: ${show(x, k, `${pad}  `)}`).join(",\n")}\n${pad}}`;
    }
    return JSON.stringify(v);
  };
  return show(card, "", "") + "\n";
}

/** A file name for a round's export, like tetris-hard-20261121-143005.json. @param {Scorecard} card */
export function scorecardFilename(card) {
  const d = new Date(card.startedAt);
  const pad = (/** @type {number} */ x) => String(x).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `tetris-${card.mode}-${stamp}.json`;
}
