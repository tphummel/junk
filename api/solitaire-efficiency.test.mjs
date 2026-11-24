// Tests for web/solitaire/efficiency.js: wasted draws, back-from-foundation moves and longest idle
// gap, all derived from a move log. Run with `npm test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const solitaireEfficiency = new Function(
  `${readFileSync(new URL("../web/solitaire/efficiency.js", import.meta.url), "utf8")}\nreturn solitaireEfficiency;`,
)();

// build a log from short codes: d = draw, r = recycle, w = waste to tableau, f = foundation to
// tableau, t = tableau to tableau; every move is `step` ms after the last unless a [code, ms] pair
function logOf(codes, step = 1000) {
  let t = -step;
  return codes.map((c, i) => {
    const [code, gap = step] = Array.isArray(c) ? c : [c];
    t += gap;
    const base = { n: i + 1, t };
    if (code === "d") return { ...base, type: "draw", from: "s", to: "w" };
    if (code === "r") return { ...base, type: "recycle", from: "w", to: "s" };
    if (code === "w") return { ...base, type: "move", from: "w", to: "t1" };
    if (code === "f") return { ...base, type: "move", from: "f0", to: "t2" };
    return { ...base, type: "move", from: "t3", to: "t4" };
  });
}

test("an empty log has nothing to report", () => {
  assert.deepEqual(solitaireEfficiency([], 0), {
    wastedDraws: 0, fruitlessPasses: 0, backFromFoundation: 0, longestIdleMs: 0, idleAfterMove: 0,
  });
});

test("the first trip through the stock is never wasted, even with no waste play", () => {
  const e = solitaireEfficiency(logOf([..."dddr"]));
  assert.equal(e.wastedDraws, 0);
  assert.equal(e.fruitlessPasses, 0);
});

test("a repeat pass with no waste play wastes every draw in it", () => {
  const e = solitaireEfficiency(logOf([..."dddrdddr"]));
  assert.equal(e.wastedDraws, 3);
  assert.equal(e.fruitlessPasses, 1);
});

test("a repeat pass that plays a waste card is not wasted", () => {
  const e = solitaireEfficiency(logOf([..."dddrddwdr"]));
  assert.equal(e.wastedDraws, 0);
  assert.equal(e.fruitlessPasses, 0);
});

test("only the pass in progress is left uncounted; earlier ones add up", () => {
  const e = solitaireEfficiency(logOf([..."dddrdddrddrddd"]));
  assert.equal(e.wastedDraws, 3 + 2);
  assert.equal(e.fruitlessPasses, 2);
});

test("tableau-only moves do not rescue a repeat pass", () => {
  const e = solitaireEfficiency(logOf([..."dddrddtdr"]));
  assert.equal(e.wastedDraws, 3);
});

test("counts moves taken back from a foundation", () => {
  assert.equal(solitaireEfficiency(logOf([..."dfdtf"])).backFromFoundation, 2);
});

test("longest idle is the biggest gap between moves", () => {
  const e = solitaireEfficiency(logOf(["d", "d", ["t", 7000], "d"]));
  assert.equal(e.longestIdleMs, 7000);
  assert.equal(e.idleAfterMove, 2);
});

test("time since the last move counts as idle while it is the longest", () => {
  const log = logOf(["d", "d", ["t", 7000], "d"]); // last move at t = 9000
  assert.equal(solitaireEfficiency(log, 12000).longestIdleMs, 7000);
  const open = solitaireEfficiency(log, 25000);
  assert.equal(open.longestIdleMs, 16000);
  assert.equal(open.idleAfterMove, 4);
});

test("a won game ending on its last move adds no idle time", () => {
  const log = logOf(["d", ["t", 3000]]);
  assert.equal(solitaireEfficiency(log, log[1].t).longestIdleMs, 3000);
});
