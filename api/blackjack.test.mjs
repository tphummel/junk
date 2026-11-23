// Tests for the blackjack strategy engine in web/blackjack/engine/. The chart is computed, so these pin
// it to well-known published basic strategy (6 deck, H17, DAS, late surrender is the default rule set).
import assert from "node:assert/strict";
import test from "node:test";
import { CARD_VALUES, dealerDistribution, shoeCounts } from "../web/blackjack/engine/ev.js";
import { DEFAULT_RULES, describeRules, normalizeRules, rulesKey } from "../web/blackjack/engine/rules.js";
import { buildStrategy, describeHand, lookup, playerEdge } from "../web/blackjack/engine/strategy.js";

const A = 11;
const strategy = buildStrategy(DEFAULT_RULES);
const code = (kind, key, up, s = strategy) => s[kind][key][up].code;
const ups = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Assert one chart code for a range of upcards. */
function expectCodes(kind, key, upcards, expected, s = strategy) {
  for (const up of upcards) {
    assert.equal(code(kind, key, up, s), expected, `${kind} ${key} vs ${up}`);
  }
}

test("rules: defaults, validation and labels", () => {
  assert.deepEqual(normalizeRules(), DEFAULT_RULES);
  const bad = normalizeRules({ decks: 3, blackjackPays: 2, surrender: "early", maxHands: 99 });
  assert.equal(bad.decks, 6);
  assert.equal(bad.blackjackPays, 1.5);
  assert.equal(bad.surrender, "none");
  assert.equal(bad.maxHands, 4);
  assert.equal(rulesKey(DEFAULT_RULES), "6d-h17-32-das-ls-norsa");
  assert.match(describeRules(DEFAULT_RULES), /6 decks.*hits soft 17.*3:2.*late surrender/);
});

test("dealer distribution sums to 1 and bust rate matches the known upcard odds", () => {
  const counts = shoeCounts(8);
  const total = counts.reduce((a, b) => a + b, 0);
  const p = counts.map((c) => c / total);
  for (const up of CARD_VALUES) {
    const d = dealerDistribution({ ...DEFAULT_RULES, h17: false }, up, p);
    assert.ok(Math.abs(d.reduce((a, b) => a + b, 0) - 1) < 1e-9, `up ${up}`);
  }
  // Well known, S17 8 deck: a 6 busts about 42% of the time. A 10 busts about 21% before the dealer peeks;
  // given no blackjack (no ace in the hole) it is about 23%, which is what the solver needs.
  assert.ok(Math.abs(dealerDistribution({ ...DEFAULT_RULES, h17: false }, 6, p)[5] - 0.42) < 0.01);
  assert.ok(Math.abs(dealerDistribution({ ...DEFAULT_RULES, h17: false }, 10, p)[5] - 0.23) < 0.01);
});

test("hard totals, 6 deck H17 DAS late surrender", () => {
  expectCodes("hard", 8, ups(2, 11), "H");
  expectCodes("hard", 9, [2, 7, 10, A], "H");
  expectCodes("hard", 9, ups(3, 6), "D");
  expectCodes("hard", 10, ups(2, 9), "D");
  expectCodes("hard", 10, [10, A], "H");
  expectCodes("hard", 11, ups(2, A), "D"); // H17: double against the ace too
  expectCodes("hard", 12, [2, 3], "H");
  expectCodes("hard", 12, ups(4, 6), "S");
  expectCodes("hard", 12, ups(7, A), "H");
  for (const t of [13, 14]) {
    expectCodes("hard", t, ups(2, 6), "S");
    expectCodes("hard", t, ups(7, A), "H");
  }
  expectCodes("hard", 15, ups(2, 6), "S");
  expectCodes("hard", 15, ups(7, 9), "H");
  expectCodes("hard", 15, [10, A], "Rh");
  expectCodes("hard", 16, ups(2, 6), "S");
  expectCodes("hard", 16, [7, 8], "H");
  expectCodes("hard", 16, [9, 10, A], "Rh");
  expectCodes("hard", 17, ups(2, 10), "S");
  assert.equal(code("hard", 17, A), "Rs"); // H17: surrender 17 against the ace
});

test("soft totals, 6 deck H17", () => {
  expectCodes("soft", 13, [5, 6], "D");
  expectCodes("soft", 14, [5, 6], "D");
  expectCodes("soft", 15, ups(4, 6), "D");
  expectCodes("soft", 16, ups(4, 6), "D");
  expectCodes("soft", 17, ups(3, 6), "D");
  expectCodes("soft", 17, [2, 7, 8, 9, 10, A], "H");
  expectCodes("soft", 18, ups(3, 6).concat([2]), "Ds"); // H17: A,7 doubles against 2 too
  expectCodes("soft", 18, [7, 8], "S");
  expectCodes("soft", 18, [9, 10, A], "H");
  assert.equal(code("soft", 19, 6), "Ds"); // H17 only
  expectCodes("soft", 19, [2, 3, 4, 5], "S");
  expectCodes("soft", 20, ups(2, A), "S");
});

test("pairs, 6 deck H17 DAS", () => {
  expectCodes("pairs", A, ups(2, 10), "P");
  expectCodes("pairs", 10, ups(2, A), "S");
  expectCodes("pairs", 9, [2, 3, 4, 5, 6, 8, 9], "P");
  expectCodes("pairs", 9, [7, 10, A], "S");
  expectCodes("pairs", 8, ups(2, 9), "P");
  expectCodes("pairs", 7, ups(2, 7), "P");
  expectCodes("pairs", 7, [8, 9, 10, A], "H");
  expectCodes("pairs", 6, ups(2, 6), "P");
  expectCodes("pairs", 5, ups(2, 9), "D"); // never split fives: it is hard 10
  expectCodes("pairs", 4, [5, 6], "P"); // only because of DAS
  expectCodes("pairs", 3, ups(2, 7), "P");
  expectCodes("pairs", 2, ups(2, 7), "P");
});

test("rule changes move the right cells", () => {
  const s17 = buildStrategy(normalizeRules({ h17: false }));
  assert.equal(code("hard", 11, A, s17), "H"); // S17: just hit 11 against the ace
  assert.equal(code("soft", 18, 2, s17), "S");
  assert.equal(code("soft", 19, 6, s17), "S");
  assert.equal(code("hard", 15, A, s17), "H");
  assert.equal(code("hard", 17, A, s17), "S");

  const none = buildStrategy(normalizeRules({ surrender: "none" }));
  assert.equal(code("hard", 16, 10, none), "H");
  assert.equal(code("hard", 15, 10, none), "H");

  const noDas = buildStrategy(normalizeRules({ das: false }));
  expectCodes("pairs", 4, ups(2, A), "H", noDas);
  expectCodes("pairs", 2, [2, 3], "H", noDas);
  expectCodes("pairs", 6, [2], "H", noDas);
  expectCodes("pairs", 7, ups(2, 7), "P", noDas);

  // One deck doubles more hard totals and soft 17 against a 2.
  const single = buildStrategy(normalizeRules({ decks: 1 }));
  assert.equal(code("soft", 17, 2, single), "D");
});

test("house edge is in the known range and moves the right way", () => {
  const edge = (r) => -playerEdge(buildStrategy(normalizeRules(r))) * 100;
  const base = edge({});
  assert.ok(base > 0.35 && base < 0.7, `6D H17 DAS LS edge ${base}%`);
  assert.ok(edge({ h17: false }) < base - 0.1, "S17 is worth about 0.2%");
  assert.ok(edge({ surrender: "none" }) > base, "no surrender costs the player");
  assert.ok(edge({ blackjackPays: 1.2 }) > base + 1, "6:5 costs well over 1%");
  assert.ok(edge({ decks: 1 }) < base, "fewer decks favor the player");
});

test("lookup: pairs, soft and hard hands, with more than two cards", () => {
  assert.equal(lookup(strategy, [8, 8], 10).action, "split");
  assert.equal(lookup(strategy, [A, 7], 6).action, "double");
  assert.equal(lookup(strategy, [10, 6], 10).action, "surrender");
  // Three-card 16 cannot surrender or double; the hit/stand base applies.
  assert.equal(lookup(strategy, [5, 5, 6], 10).action, "hit");
  assert.equal(lookup(strategy, [3, 4, A], 6).action, "stand"); // soft 18 vs 6, doubling not allowed
  // Totals the chart does not list always stand.
  assert.equal(lookup(strategy, [10, 8], 10).action, "stand");
  assert.equal(lookup(strategy, [A, 10, 10], 6).action, "stand");
  assert.deepEqual(describeHand([A, A, 9]), { total: 21, soft: true, hard: 11, pair: false, blackjack: false });
  assert.equal(describeHand([A, 10]).blackjack, true);
});

test("every cell carries evs, and the chosen play has the highest EV", () => {
  for (const kind of ["hard", "soft", "pairs"]) {
    for (const row of Object.values(strategy[kind])) {
      for (const cell of Object.values(row)) {
        const all = [cell.evs.stand, cell.evs.hit, cell.evs.double, cell.evs.surrender, cell.evs.split].filter(
          (v) => typeof v === "number",
        );
        assert.ok(cell.ev >= Math.max(...all) - 1e-9);
        assert.ok(Number.isFinite(cell.ev));
      }
    }
  }
});
