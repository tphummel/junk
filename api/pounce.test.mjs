// Tests for the pure scoring and report logic in web/pounce/engine.js, plus the page's service worker file list.
// Run with `npm test`.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  cumulative, formatDuration, gameTotals, gameWinners, headToHead, headToHeadAll, isValidScore, paceStats, pounceStats,
  sessionExport, sessionReportHtml, standings, validateResults, venueStats,
} from "../web/pounce/engine.js";

const g = (id, results, extra = {}) => ({ id, sessionId: "s", venue: "Home", startedAt: Number(id), durationMs: 60000, bonus: 5, results, ...extra });
const r = (playerId, score, pounced = false) => ({ playerId, score, pounced });

const games = [
  g("1", [r("a", 20, true), r("b", 10), r("c", -5)]),
  g("2", [r("a", 8), r("b", 30, true)], { durationMs: 120000 }),
  g("3", [r("b", 12), r("c", 17, true)], { durationMs: 30000, venue: "Cafe" }),
];

test("score range is -26 to 60 whole numbers", () => {
  for (const n of [-26, 0, 60]) assert.ok(isValidScore(n));
  for (const n of [-27, 61, 1.5, NaN, "5"]) assert.ok(!isValidScore(n));
});

test("validateResults needs 2+ players, valid scores and exactly one pouncer", () => {
  assert.deepEqual(validateResults([r("a", 1, true), r("b", 2)]), []);
  assert.equal(validateResults([r("a", 1, true)]).length, 1);
  assert.equal(validateResults([r("a", 1), r("b", 2)]).length, 1);
  assert.equal(validateResults([r("a", 1, true), r("b", 2, true)]).length, 1);
  assert.equal(validateResults([r("a", NaN, true), r("b", 100)]).length, 1);
});

test("pouncer gets the game's bonus; winners can tie", () => {
  assert.deepEqual(gameTotals(games[0]).map((t) => t.total), [25, 10, -5]);
  assert.deepEqual(gameWinners(g("x", [r("a", 10, true), r("b", 15)])), ["a", "b"]);
  assert.equal(gameTotals(g("x", [r("a", 1, true)], { bonus: 9 }))[0].total, 10);
});

test("standings rank by average per game played, not total", () => {
  const s = standings(games);
  // b: 57 over 3 games = 19; a: 33 over 2 = 16.5; c: 12 over 2 = 6
  assert.deepEqual(s.map((x) => x.playerId), ["b", "a", "c"]);
  assert.equal(s[0].avg, 19);
  const late = standings([g("9", [r("x", 30, true), r("y", 5)]), g("10", [r("y", 6, true), r("z", 1)])]);
  assert.equal(late[0].playerId, "x");
  assert.equal(late[0].wins, 1);
  const b = s.find((x) => x.playerId === "b");
  assert.equal(b.total, 10 + 35 + 12);
  assert.equal(b.played, 3);
  assert.equal(b.wins, 1);
  assert.equal(s.find((x) => x.playerId === "c").pounces, 1);
});

test("cumulative repeats totals for games a player sat out", () => {
  const c = cumulative(games);
  assert.deepEqual(c.find((x) => x.playerId === "a").points, [25, 33, 33]);
  assert.deepEqual(c.find((x) => x.playerId === "c").points, [-5, -5, 17 + 5 - 5 + 0]);
});

test("pounce stats", () => {
  const p = pounceStats(games).find((x) => x.playerId === "b");
  assert.equal(p.pounces, 1);
  assert.equal(p.played, 3);
  assert.equal(p.avgScorePounced, 30);
  assert.equal(p.avgScoreOther, 11);
});

test("pace and venue stats", () => {
  const p = paceStats(games);
  assert.equal(p.avgMs, 70000);
  assert.equal(p.fastest.id, "3");
  assert.equal(p.longest.id, "2");
  assert.equal(paceStats([]).count, 0);
  assert.deepEqual(venueStats(games).map((v) => [v.venue, v.games]), [["Home", 2], ["Cafe", 1]]);
});

test("head to head counts only shared games", () => {
  const h = headToHead(games, "a", "c");
  assert.equal(h.shared, 1);
  assert.equal(h.aWins, 1);
  const bc = headToHead(games, "b", "c");
  assert.equal(bc.shared, 2);
  assert.equal(bc.aWins, 1);
  assert.equal(bc.bWins, 1);
  assert.equal(headToHeadAll(games).length, 3);
});

test("formatDuration", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(65400), "1:05");
});

test("service worker precaches files that exist", () => {
  const sw = readFileSync("web/pounce/sw.js", "utf8");
  const paths = [...sw.matchAll(/'\/pounce\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
  assert.ok(paths.length > 3);
  for (const p of paths) assert.ok(existsSync(`web/pounce/${p}`), p);
});

test("session export carries games and only the players involved", () => {
  const session = { id: "s", venue: "Home", bonus: 5, createdAt: 0, present: ["a", "b"], games: games.slice(0, 2), current: { startedAt: 1 } };
  const players = [{ id: "a", name: "Ann" }, { id: "b", name: "Bo" }, { id: "z", name: "Zed" }];
  const exp = sessionExport(session, players);
  assert.equal(exp.format, "pounce-session");
  assert.deepEqual(exp.players.map((p) => p.id), ["a", "b"]);
  assert.equal(exp.session.games.length, 2);
  assert.ok(!("current" in exp.session));
});

test("session html report is standalone and escapes names", () => {
  const session = { id: "s", venue: "<Cafe>", bonus: 5, createdAt: 0, present: ["a", "b"], games: [{ ...games[1], notes: "<b>x</b>" }] };
  const html = sessionReportHtml(sessionExport(session, [{ id: "a", name: "A&B" }, { id: "b", name: "Bo" }]));
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(!html.includes("<script"));
  assert.ok(html.includes("A&amp;B") && html.includes("&lt;Cafe&gt;") && html.includes("&lt;b&gt;x"));
});
