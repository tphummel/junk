// Tests for the Monopoly tracker logic (web/monopoly-tracker/tracker.js). Run with `npm test`.
import assert from "node:assert/strict";
import test from "node:test";
import { CLASSIC, collectAutoRent, collectRent, gameStats, improve, migrateGames, newProperty, parseGames, rentFor, sellImprovement, stats, toggleMortgage } from "../web/monopoly-tracker/tracker.js";

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

const deed = (name) => newProperty(CLASSIC.find((c) => c.name === name));
const game = (...props) => ({ id: "g", name: "g", edition: "classic", properties: props });

test("card data: 28 deeds with sane tables", () => {
  assert.equal(CLASSIC.length, 28);
  for (const c of CLASSIC.filter((x) => x.kind === "street")) {
    assert.equal(c.rents.length, 6, c.name);
    assert.ok(c.rents.every((r, i) => i === 0 || r > c.rents[i - 1]), c.name);
  }
  assert.deepEqual(CLASSIC.find((c) => c.name === "Boardwalk").rents, [50, 200, 600, 1400, 1700, 2000]);
});

test("street rent follows level and full-set doubling", () => {
  const park = deed("Park Place"), board = deed("Boardwalk");
  const g = game(park);
  assert.equal(rentFor(g, park), 35); // only one of two owned
  g.properties.push(board);
  assert.equal(rentFor(g, park), 70); // full set doubles unimproved rent
  improve(park, 5);
  assert.equal(rentFor(g, park), 175); // no doubling once improved
  assert.equal(rentFor(g, board), 50 * 2);
});

test("railroads scale with count owned; utilities need dice", () => {
  const rr = CLASSIC.filter((c) => c.kind === "railroad").map((c) => newProperty(c));
  const g = game(rr[0]);
  assert.equal(rentFor(g, rr[0]), 25);
  g.properties.push(rr[1], rr[2]);
  assert.equal(rentFor(g, rr[0]), 100);
  const elec = deed("Electric Company");
  g.properties.push(elec);
  assert.equal(rentFor(g, elec), null);
  assert.equal(rentFor(g, elec, 8), 32);
  g.properties.push(deed("Water Works"));
  assert.equal(rentFor(g, elec, 8), 80);
});

test("collectAutoRent records the card rent without entering it", () => {
  const med = deed("Mediterranean Avenue");
  const g = game(med);
  assert.equal(collectAutoRent(g, med), null);
  assert.equal(stats(med, g).rent, 2);
  const elec = deed("Electric Company");
  g.properties.push(elec);
  assert.match(collectAutoRent(g, elec), /dice/);
  assert.equal(collectAutoRent(g, elec, 6), null);
  assert.equal(stats(elec, g).rent, 24);
  toggleMortgage(med);
  assert.match(collectAutoRent(g, med), /Mortgaged/);
});

test("custom card with no rent table falls back to the entered amount", () => {
  const p = newProperty({ name: "Custom Street", group: "other", price: 100 });
  const g = game(p);
  assert.equal(rentFor(g, p), null);
  assert.equal(collectAutoRent(g, p, 30), null);
  assert.equal(stats(p, g).rent, 30);
});

test("migrateGames backfills card data on older saves", () => {
  const old = newProperty({ name: "Boardwalk", group: "darkblue", price: 400 });
  delete old.kind; delete old.rents; delete old.groupSize;
  const g = game(old);
  migrateGames([g]);
  assert.equal(old.kind, "street");
  assert.equal(old.houseCost, 200);
  assert.equal(rentFor(g, old), 50);
});
