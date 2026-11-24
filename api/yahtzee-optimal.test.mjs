// Tests for web/yahtzee/optimal.js, the hindsight benchmark behind the end-of-game efficiency
// report. The engine is the source of truth for scoring, so the best game is replayed through it.
// Run with `npm test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (f) => readFileSync(new URL(`../web/yahtzee/${f}`, import.meta.url), "utf8");
// classic browser scripts: run both in one function scope and hand back what the tests need
const E = new Function(`${read("engine.js")}\n${read("optimal.js")}
return { replay, totals, apply, newState, legalCats, tapeDie, CATS, CAT_CHARS, points, O: globalThis.YahtzeeOptimal };`)();
const { O } = E;

// a deterministic, mediocre player: random keeps and boxes, but always on the puzzle's dice
function playGame(puzzle, seed) {
  let x = seed;
  const rnd = (n) => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x % n; };
  const s = E.newState();
  let tokens = "";
  const push = (tok) => { assert.ok(E.apply(s, tok)); tokens += tok; };
  while (!s.over) {
    push("r" + [0, 1, 2, 3, 4].map((i) => E.tapeDie(puzzle, s.turn, 1, i)).join(""));
    for (let extra = rnd(3); extra > 0; extra--) {
      const mask = rnd(31);
      push("x" + mask.toString(32) + s.dice.map((d, i) => (mask & (1 << i) ? d : E.tapeDie(puzzle, s.turn, s.rolls + 1, i))).join(""));
    }
    const legal = E.legalCats(s);
    push("s" + E.CAT_CHARS[legal[rnd(legal.length)]]);
  }
  return tokens;
}

test("the best game replays through the engine to exactly the score the search claims", () => {
  for (const puzzle of [1, 100, 366]) {
    const g = O.optimalGame(puzzle);
    const r = E.replay(g.tokens);
    assert.equal(r.tokens, g.tokens, "every move is legal");
    assert.ok(r.s.over);
    assert.equal(E.totals(r.s).total, g.total);
  }
});

test("the best game beats a spread of random games on the same dice", () => {
  const best = O.optimalGame(200).total;
  for (let seed = 1; seed <= 20; seed++) {
    const r = E.replay(playGame(200, seed));
    assert.ok(E.totals(r.s).total <= best);
  }
});

// Exhaustive reference for a position with turns left: try every keep and every box, using only
// the engine's own rules (legalCats, points, totals) on a bare { scores, dice, bonus } card.
function exhaustive(puzzle, turn, scores, bonus) {
  if (turn > 13) return E.totals({ scores, bonus }).total;
  let best = 0;
  const finish = (dice) => {
    const card = { scores, dice };
    for (const cat of E.legalCats(card)) {
      const joker = dice.every((d) => d === dice[0]) && scores[11] !== null;
      const next = scores.slice();
      next[cat] = E.points(cat, dice, joker);
      const bump = dice.every((d) => d === dice[0]) && scores[11] === 50 ? 1 : 0;
      best = Math.max(best, exhaustive(puzzle, turn + 1, next, bonus + bump));
    }
  };
  const walk = (dice, rolls) => {
    finish(dice);
    if (rolls >= 3) return;
    for (let mask = 0; mask < 31; mask++) {
      walk(dice.map((d, i) => (mask & (1 << i) ? d : E.tapeDie(puzzle, turn, rolls + 1, i))), rolls + 1);
    }
  };
  walk([0, 1, 2, 3, 4].map((i) => E.tapeDie(puzzle, turn, 1, i)), 1);
  return best;
}

test("from two turns out, the search agrees with trying every play through the engine", () => {
  for (const [puzzle, seed] of [[50, 3], [300, 21]]) {
    const tokens = playGame(puzzle, seed);
    const turnTokens = tokens.match(/r[1-6]{5}(?:x[0-9a-v][1-6]{5})*s[a-m]/g);
    const s = E.replay(turnTokens.slice(0, 11).join("")).s;
    assert.equal(s.turn, 12);
    const want = exhaustive(puzzle, 12, s.scores, s.bonus);
    // the report's value of the position after 11 turns: what the last two turns scored plus what they cost
    const report = O.efficiencyReport(puzzle, tokens);
    const last2 = report.turns.slice(11);
    const gained = E.totals(E.replay(tokens).s).total - E.totals(s).total;
    assert.equal(gained + last2.reduce((n, t) => n + t.loss, 0), want - E.totals(s).total);
  }
});

test("report: turn costs add up to the gap, and split into dice and box losses", () => {
  for (const seed of [2, 5, 11]) {
    const tokens = playGame(123, seed);
    const r = O.efficiencyReport(123, tokens);
    assert.equal(r.total, E.totals(E.replay(tokens).s).total);
    assert.equal(r.best, O.optimalGame(123).total);
    assert.equal(r.turns.length, 13);
    assert.equal(r.turns.reduce((n, t) => n + t.loss, 0), r.best - r.total);
    assert.equal(r.rollLoss + r.catLoss, r.best - r.total);
    for (const t of r.turns) {
      assert.ok(t.rollLoss >= 0 && t.catLoss >= 0, `turn ${t.turn} costs are not negative`);
      assert.equal(t.loss, t.rollLoss + t.catLoss);
      assert.equal(Boolean(t.best), t.loss > 0, "a best line is given exactly when the turn cost something");
    }
  }
});

test("report: the best game has no cost anywhere", () => {
  const g = O.optimalGame(77);
  const r = O.efficiencyReport(77, g.tokens);
  assert.equal(r.total, r.best);
  assert.ok(r.turns.every((t) => t.loss === 0 && !t.best));
});

test("report: a turn's best line follows the puzzle's dice and its points are real box scores", () => {
  const puzzle = 88;
  const r = O.efficiencyReport(puzzle, playGame(puzzle, 4));
  const lines = r.turns.filter((t) => t.best);
  assert.ok(lines.length > 0);
  for (const t of lines) {
    const { steps } = t.best;
    assert.ok(steps.length >= 1 && steps.length <= 3);
    steps.forEach((st, j) => st.dice.forEach((d, i) => {
      const fixed = j > 0 && st.kept[i];
      assert.equal(d, fixed ? steps[j - 1].dice[i] : E.tapeDie(puzzle, t.turn, j + 1, i));
    }));
    const dice = steps[steps.length - 1].dice;
    assert.ok([false, true].some((joker) => E.points(t.best.cat, dice, joker) === t.best.points));
  }
});

test("report: unfinished games give nothing, and dice that are not the puzzle's are flagged", () => {
  const tokens = playGame(9, 1);
  assert.equal(O.efficiencyReport(9, tokens.slice(0, 40)), null);
  assert.deepEqual(O.efficiencyReport(10, tokens), { mismatch: true }, "puzzle 9's dice are not puzzle 10's");
});
