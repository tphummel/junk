// Basic strategy for a rule set, computed (not typed in) from the EV solver in ev.js.
//
// One source of truth: the reference chart, the printed cards, the quiz answers and the Anki
// cards all read from buildStrategy(), so they cannot disagree.

import { CARD_VALUES, UPCARDS, createSolver, removeCards, shoeCounts } from "./ev.js";

/** @typedef {"stand"|"hit"|"double"|"split"|"surrender"} Action */
/**
 * @typedef {object} Cell
 * @property {Action} action best play on the first two cards
 * @property {"stand"|"hit"} base best play when double/surrender/split are not available
 * @property {string} code chart code: S H D Ds P Rh Rs Rp
 * @property {import("./ev.js").Evs} evs EV (units of the bet) of every option
 * @property {number} ev EV of the best play
 */
/**
 * @typedef {object} Strategy
 * @property {import("./rules.js").Rules} rules
 * @property {Record<number, Record<number, Cell>>} hard hard totals 5..17 by dealer upcard
 * @property {Record<number, Record<number, Cell>>} soft soft totals 13..20 (A,2..A,9) by upcard
 * @property {Record<number, Record<number, Cell>>} pairs pairs by card value (2..11) and upcard
 */

export const ACTIONS = /** @type {Action[]} */ (["stand", "hit", "double", "split", "surrender"]);
export const HARD_TOTALS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
export const SOFT_TOTALS = [13, 14, 15, 16, 17, 18, 19, 20];
export const PAIR_CARDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const EPSILON = 1e-9;

/**
 * Pick the best play and name it with a chart code.
 * @param {import("./ev.js").Evs} evs
 * @returns {Cell}
 */
export function pickCell(evs) {
  /** @type {Action} */
  let action = "stand";
  let ev = evs.stand;
  for (const a of ACTIONS) {
    const v = evs[a];
    if (v === null || v === undefined) continue;
    if (v > ev + EPSILON) {
      action = a;
      ev = v;
    }
  }
  const base = evs.stand >= evs.hit - EPSILON ? "stand" : "hit";
  let code;
  if (action === "stand") code = "S";
  else if (action === "hit") code = "H";
  else if (action === "double") code = base === "stand" ? "Ds" : "D";
  else if (action === "split") code = "P";
  else {
    // Surrender, and what to do where it is not offered: stand, hit or split.
    const others = /** @type {Action[]} */ (["stand", "hit", "split"]);
    let fallback = "stand";
    let fv = -Infinity;
    for (const a of others) {
      const v = evs[a];
      if (v !== null && v !== undefined && v > fv + EPSILON) {
        fv = v;
        fallback = a;
      }
    }
    code = fallback === "stand" ? "Rs" : fallback === "hit" ? "Rh" : "Rp";
  }
  return { action, base, code, evs, ev };
}

/**
 * Weighted average of several EV sets, so a hard total is judged over every two-card way to make it.
 * @param {{ weight: number, evs: import("./ev.js").Evs }[]} parts
 * @returns {import("./ev.js").Evs}
 */
function averageEvs(parts) {
  const sum = parts.reduce((a, b) => a + b.weight, 0);
  const avg = (/** @type {"stand"|"hit"|"double"} */ k) => parts.reduce((a, b) => a + b.weight * b.evs[k], 0) / sum;
  return {
    stand: avg("stand"),
    hit: avg("hit"),
    double: avg("double"),
    surrender: parts[0].evs.surrender,
    split: null,
  };
}

/** Non-pair, ace-free ways to make a hard total from two cards (values 2..10, first < second). */
function hardCombos(/** @type {number} */ total) {
  const out = [];
  for (let a = 2; a <= 10; a++) {
    const b = total - a;
    if (b > a && b <= 10) out.push([a, b]);
  }
  return out;
}

/**
 * Compute basic strategy for a rule set.
 * @param {import("./rules.js").Rules} rules
 * @returns {Strategy}
 */
export function buildStrategy(rules) {
  /** @type {Strategy} */
  const strategy = { rules, hard: {}, soft: {}, pairs: {} };
  for (const t of HARD_TOTALS) strategy.hard[t] = {};
  for (const t of SOFT_TOTALS) strategy.soft[t] = {};
  for (const c of PAIR_CARDS) strategy.pairs[c] = {};

  for (const up of UPCARDS) {
    const deck = removeCards(shoeCounts(rules.decks), [up]);
    const solve = (/** @type {number} */ a, /** @type {number} */ b) =>
      createSolver(rules, up, removeCards(deck, [a, b])).evs(a, b);

    for (const c of PAIR_CARDS) strategy.pairs[c][up] = pickCell(solve(c, c));
    for (const t of SOFT_TOTALS) strategy.soft[t][up] = pickCell(solve(11, t - 11));
    for (const t of HARD_TOTALS) {
      const combos = hardCombos(t);
      if (combos.length === 0) {
        // Hard 5 and 6 are covered by (2,3) and (2,4); nothing else is missing.
        continue;
      }
      strategy.hard[t][up] = pickCell(
        averageEvs(combos.map(([a, b]) => ({ weight: deck[a] * deck[b], evs: solve(a, b) }))),
      );
    }
  }
  return strategy;
}

/** A cell for totals the chart does not list because the answer never changes. */
function forcedStand() {
  return /** @type {Cell} */ ({
    action: "stand",
    base: "stand",
    code: "S",
    evs: { stand: 0, hit: 0, double: 0, surrender: null, split: null },
    ev: 0,
  });
}

/**
 * Describe a hand for strategy purposes.
 * @param {number[]} cards card values 2..11 (11 is an ace, any ten-value card is 10)
 */
export function describeHand(cards) {
  let hard = 0;
  let aces = 0;
  for (const c of cards) {
    hard += c === 11 ? 1 : c;
    if (c === 11) aces++;
  }
  const soft = aces > 0 && hard + 10 <= 21;
  const total = soft ? hard + 10 : hard;
  const pair = cards.length === 2 && cards[0] === cards[1];
  return { total, soft, hard, pair, blackjack: cards.length === 2 && total === 21 };
}

/**
 * Find the correct play for a hand.
 * With two cards every option is open; with more only hit or stand are.
 * @param {Strategy} strategy
 * @param {number[]} cards
 * @param {number} up dealer upcard value
 * @returns {{ kind: "pair"|"soft"|"hard", key: number, cell: Cell, action: Action }}
 */
export function lookup(strategy, cards, up) {
  const h = describeHand(cards);
  const first = cards.length === 2;
  /** @type {"pair"|"soft"|"hard"} */
  let kind;
  /** @type {number} */
  let key;
  /** @type {Cell | undefined} */
  let cell;
  if (h.pair) {
    kind = "pair";
    key = cards[0];
    cell = strategy.pairs[key][up];
  } else if (h.soft) {
    kind = "soft";
    key = h.total;
    cell = strategy.soft[key]?.[up];
  } else {
    kind = "hard";
    key = Math.min(17, Math.max(5, h.total));
    cell = h.total >= 18 ? undefined : strategy.hard[key][up];
  }
  if (!cell) cell = forcedStand();
  // Hands with more than two cards cannot double, split or surrender: use the hit/stand base.
  const action = first ? cell.action : cell.base;
  return { kind, key, cell, action };
}

/**
 * Expected house edge (as a negative number for the player's loss, in units of the bet), for
 * players who follow the chart exactly. An estimate, not a promise: see the note in ev.js.
 * @param {Strategy} strategy
 * @returns {number} player EV per initial bet, e.g. -0.0046
 */
export function playerEdge(strategy) {
  const { rules } = strategy;
  const full = shoeCounts(rules.decks);
  const N = full.reduce((a, b) => a + b, 0);
  let ev = 0;
  for (const up of UPCARDS) {
    const pUp = full[up] / N;
    const afterUp = removeCards(full, [up]);
    const nUp = N - 1;
    for (const c1 of CARD_VALUES) {
      const p1 = afterUp[c1] / nUp;
      if (!p1) continue;
      const afterC1 = removeCards(afterUp, [c1]);
      for (const c2 of CARD_VALUES) {
        const p2 = afterC1[c2] / (nUp - 1);
        if (!p2) continue;
        const counts = removeCards(afterC1, [c2]);
        const left = nUp - 2;
        const pDealerBJ = up === 11 ? counts[10] / left : up === 10 ? counts[11] / left : 0;
        const bj = (c1 === 11 && c2 === 10) || (c1 === 10 && c2 === 11);
        let handEv;
        if (bj) {
          handEv = rules.blackjackPays;
        } else {
          const { cell } = lookup(strategy, [c1, c2], up);
          const evs = createSolver(rules, up, counts).evs(c1, c2);
          handEv = /** @type {number} */ (evs[cell.action] ?? evs.stand);
        }
        // With the dealer's blackjack out of the way the EVs above hold; otherwise lose (a push if you have one).
        ev += pUp * p1 * p2 * (pDealerBJ * (bj ? 0 : -1) + (1 - pDealerBJ) * handEv);
      }
    }
  }
  return ev;
}
