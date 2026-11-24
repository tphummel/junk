// Expected-value solver for one blackjack situation.
//
// Cards are values 2..11: 11 is an ace and 10 stands for any ten-value card. All EVs are in units of
// the original bet and assume the dealer has already checked for blackjack and does not have it
// (US "peek" rules), so a player blackjack is handled by the caller.
//
// Approximation: every draw (player and dealer) comes from the shoe with the player's first two
// cards and the dealer's upcard removed, with replacement after that. It is exact for infinite
// decks and within a rounding error of the full composition-dependent answer for 4+ decks; for 1 and
// 2 decks it keeps the effect of the cards you can see, which is the part that matters.

export const CARD_VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export const UPCARDS = CARD_VALUES;

/**
 * Cards remaining in a full shoe, indexed by value (indexes 0 and 1 are unused).
 * @param {number} decks
 * @returns {number[]}
 */
export function shoeCounts(decks) {
  const counts = new Array(12).fill(0);
  for (const v of CARD_VALUES) counts[v] = (v === 10 ? 16 : 4) * decks;
  return counts;
}

/**
 * @param {number[]} counts
 * @param {number[]} cards values to take out
 */
export function removeCards(counts, cards) {
  const out = counts.slice();
  for (const c of cards) out[c] -= 1;
  return out;
}

/** @param {number} v card value */
const hardValue = (v) => (v === 11 ? 1 : v);
/** Best total for a hand with this hard total (aces counted as 1) and whether it holds an ace. */
const bestTotal = (/** @type {number} */ hard, /** @type {boolean} */ hasAce) => (hasAce && hard + 10 <= 21 ? hard + 10 : hard);

/** @typedef {{ stand: number, hit: number, double: number, surrender: number | null, split: number | null }} Evs */

/**
 * Everything the player could do with a hand against one upcard, for one shoe composition.
 * @param {import("./rules.js").Rules} rules
 * @param {number} up dealer upcard value
 * @param {number[]} counts remaining cards after the player's first two cards and the upcard
 */
export function createSolver(rules, up, counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  const p = counts.map((c) => c / total);

  // Dealer's final result: P(17), P(18), P(19), P(20), P(21), P(bust).
  const dealer = dealerDistribution(rules, up, p);

  /** @param {number} t player total */
  const standEV = (t) => {
    if (t > 21) return -1;
    let ev = dealer[5];
    for (let d = 17; d <= 21; d++) ev += t > d ? dealer[d - 17] : t < d ? -dealer[d - 17] : 0;
    return ev;
  };

  /** Best of stand/hit for a hand that cannot double or surrender (any hand after its first two cards). */
  const bestMemo = new Map();
  const hitEV = (/** @type {number} */ hard, /** @type {boolean} */ hasAce) => {
    let ev = 0;
    for (const r of CARD_VALUES) {
      if (!p[r]) continue;
      const h = hard + hardValue(r);
      ev += p[r] * (h > 21 ? -1 : best(h, hasAce || r === 11));
    }
    return ev;
  };
  const best = (/** @type {number} */ hard, /** @type {boolean} */ hasAce) => {
    const key = hard * 2 + (hasAce ? 1 : 0);
    let v = bestMemo.get(key);
    if (v === undefined) {
      v = Math.max(standEV(bestTotal(hard, hasAce)), hitEV(hard, hasAce));
      bestMemo.set(key, v);
    }
    return v;
  };

  const doubleEV = (/** @type {number} */ hard, /** @type {boolean} */ hasAce) => {
    let ev = 0;
    for (const r of CARD_VALUES) {
      if (!p[r]) continue;
      const h = hard + hardValue(r);
      ev += p[r] * (h > 21 ? -1 : standEV(bestTotal(h, hasAce || r === 11)));
    }
    return 2 * ev;
  };

  // Value of one hand of a split pair, as it will be played, with `k` more splits still allowed.
  const splitMemo = new Map();
  const handValue = (/** @type {number} */ c, /** @type {number} */ k) => {
    const key = c * 10 + k;
    const cached = splitMemo.get(key);
    if (cached !== undefined) return cached;
    let ev = 0;
    for (const r of CARD_VALUES) {
      if (!p[r]) continue;
      const hard = hardValue(c) + hardValue(r);
      const hasAce = c === 11 || r === 11;
      let v;
      if (c === 11) {
        // Split aces get one card each and cannot hit, double or (usually) resplit.
        v = standEV(bestTotal(hard, hasAce));
        if (r === 11 && rules.resplitAces && k > 0) v = Math.max(v, 2 * handValue(11, k - 1));
      } else {
        v = best(hard, hasAce);
        if (rules.das) v = Math.max(v, doubleEV(hard, hasAce));
        if (r === c && k > 0) v = Math.max(v, 2 * handValue(c, k - 1));
      }
      ev += p[r] * v;
    }
    splitMemo.set(key, ev);
    return ev;
  };

  /**
   * EV of every option for a two-card first decision.
   * @param {number} c1
   * @param {number} c2
   * @returns {Evs}
   */
  const evs = (c1, c2) => {
    const hard = hardValue(c1) + hardValue(c2);
    const hasAce = c1 === 11 || c2 === 11;
    return {
      stand: standEV(bestTotal(hard, hasAce)),
      hit: hitEV(hard, hasAce),
      double: doubleEV(hard, hasAce),
      surrender: rules.surrender === "late" ? -0.5 : null,
      split: c1 === c2 ? 2 * handValue(c1, rules.maxHands - 2) : null,
    };
  };

  return { evs, standEV, dealer };
}

/**
 * The dealer's final total, given a shoe composition. The hole card is drawn conditional on no
 * blackjack (ace up: not a ten; ten up: not an ace), because the dealer has peeked.
 * @param {import("./rules.js").Rules} rules
 * @param {number} up
 * @param {number[]} p probability of each card value
 * @returns {number[]} P(17), P(18), P(19), P(20), P(21), P(bust)
 */
export function dealerDistribution(rules, up, p) {
  const memo = new Map();
  /** @returns {number[]} */
  const play = (/** @type {number} */ hard, /** @type {boolean} */ hasAce) => {
    if (hard > 21) return [0, 0, 0, 0, 0, 1];
    const t = bestTotal(hard, hasAce);
    const soft = t !== hard;
    if (t >= 18 || (t === 17 && !(soft && rules.h17))) {
      const out = [0, 0, 0, 0, 0, 0];
      out[t - 17] = 1;
      return out;
    }
    const key = hard * 2 + (hasAce ? 1 : 0);
    let out = memo.get(key);
    if (out) return out;
    out = [0, 0, 0, 0, 0, 0];
    for (const r of CARD_VALUES) {
      if (!p[r]) continue;
      const sub = play(hard + hardValue(r), hasAce || r === 11);
      for (let i = 0; i < 6; i++) out[i] += p[r] * sub[i];
    }
    memo.set(key, out);
    return out;
  };

  const exclude = up === 11 ? 10 : up === 10 ? 11 : 0;
  const denom = 1 - (exclude ? p[exclude] : 0);
  const result = [0, 0, 0, 0, 0, 0];
  for (const r of CARD_VALUES) {
    if (r === exclude || !p[r]) continue;
    const sub = play(hardValue(up) + hardValue(r), up === 11 || r === 11);
    for (let i = 0; i < 6; i++) result[i] += (p[r] / denom) * sub[i];
  }
  return result;
}
