// Tests for the Monopoly tracker logic (web/monopoly-tracker/tracker.js). Run with `npm test`.
import assert from "node:assert/strict";
import test from "node:test";
import { collectRent, gameStats, improve, newProperty, parseGames, sellImprovement, stats, toggleMortgage } from "../web/monopoly-tracker/tracker.js";

const boardwalk = () => newProperty({ name: "Boardwalk", group: "darkblue", price: 400, houseCost: 200, rent: 50 });

test("buying records the cost and nothing is broken even yet", () => {
  const s = stats(boardwalk());
  assert.equal(s.invested, 400);
  assert.equal(s.profit, -400);
  assert.equal(s.remaining, 400);
  assert.equal(s.hitsToBreakEven, 8); // 400 / 50 from the set rent
});

test("rent counts toward break even; avg rent replaces the set rent", () => {
  const p = boardwalk();
  assert.equal(collectRent(p, 200), null);
  const s = stats(p);
  assert.equal(s.remaining, 200);
  assert.equal(s.hitsToBreakEven, 1);
  collectRent(p, 200);
  const done = stats(p);
  assert.equal(done.broken, true);
  assert.equal(done.roi, 0);
  collectRent(p, 400);
  assert.equal(stats(p).roi, 1);
});

test("improvements add to cost; selling returns half", () => {
  const p = boardwalk();
  assert.equal(improve(p, 5), null);
  assert.equal(stats(p).invested, 600);
  assert.equal(sellImprovement(p), null);
  const s = stats(p);
  assert.equal(s.invested, 600);
  assert.equal(s.returned, 100);
  assert.equal(s.remaining, 500);
  assert.match(sellImprovement(p), /Nothing/);
});

test("mortgage is a loan: only the 10% interest costs you; no rent while mortgaged", () => {
  const p = boardwalk();
  toggleMortgage(p);
  assert.equal(stats(p).loan, 200);
  assert.equal(stats(p).profit, -400);
  assert.match(collectRent(p, 50), /Mortgaged/);
  toggleMortgage(p);
  const s = stats(p);
  assert.equal(s.loan, 0);
  assert.equal(s.invested, 420);
});

test("cannot mortgage improved property or build on mortgaged", () => {
  const p = boardwalk();
  improve(p, 5);
  assert.match(toggleMortgage(p), /Sell all/);
  sellImprovement(p);
  toggleMortgage(p);
  assert.match(improve(p, 5), /mortgage/);
});

test("level cap and game totals", () => {
  const p = boardwalk();
  for (let i = 0; i < 5; i++) improve(p, 5);
  assert.match(improve(p, 5), /fully built/);
  const g = { id: "g", name: "g", edition: "classic", properties: [p, boardwalk()] };
  const t = gameStats(g);
  assert.equal(t.invested, 400 + 1000 + 400);
  assert.equal(t.count, 2);
});

test("parseGames validates imports", () => {
  const g = { id: "g", name: "g", edition: "mega", properties: [boardwalk()] };
  assert.equal(parseGames([g]).length, 1);
  assert.equal(parseGames({ games: [g] }).length, 1);
  assert.equal(parseGames([{ ...g, edition: "x" }]), null);
  assert.equal(parseGames("nope"), null);
});
